import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, writeBatch, Timestamp, serverTimestamp } from 'firebase/firestore';
import { criarFirebaseSync } from '../firebase-sync-entry.js';
import { makeOperation, operationId, recordEntityKey } from '../sync-core.js';
import { loadPublishedClient } from './fixtures/published-source.mjs';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulator && 'Requires Firestore Emulator';
const uid = 'synthetic-conflict-owner';
const value = (id, amount = 10) => ({ month: '2026-11', type: 'receitas', id, deleted: false, record: { id, nome: 'Synthetic conflict', valor: amount } });
async function denied(action) {
    await assert.rejects(action, error => {
        assert.equal(error.code, 'permission-denied');
        assert.doesNotMatch(error.message, /maximum.*expressions|expression.{0,25}limit|Null value error|Property .*undefined/i);
        return true;
    });
}
async function environment(rulesFile, suffix, callback) {
    const [host, port] = emulator.split(':'); assert.match(host, /^(127\.0\.0\.1|localhost)$/);
    const env = await initializeTestEnvironment({ projectId: 'demo-conflict-' + suffix, firestore: { host, port: Number(port),
        rules: await readFile(new URL('../' + rulesFile, import.meta.url), 'utf8') } });
    await env.clearFirestore();
    try { await callback(env, env.authenticatedContext(uid).firestore()); } finally { await env.cleanup(); }
}
const factory = (create, db) => create({ projectId: 'demo-conflict-factory' }, {
    createApp: () => ({}), createAuth: () => ({ currentUser: { uid } }), createFirestore: () => db,
    checkAuthPersistence() {}, getRedirectResult: async () => null
});

for (const generation of ['legacy', 'synthetic-generation']) test(`paired conflict/history candidate: ${generation}`, { skip }, async t => {
    const published = await loadPublishedClient();
    await environment('firestore.integrity.rules', generation, async (env, db) => {
        const prefix = ['users', uid, ...(generation === 'legacy' ? [] : ['financeGenerations', generation])];
        const ref = (kind, id) => doc(db, ...prefix, kind, id);
        const v = value('漢'.repeat(128)), key = recordEntityKey(v);
        assert.ok(key.length > 512, 'long Unicode canonical identities must retain conflict continuity');
        const stored = { ...v, revision: 'server-revision', updatedAt: Timestamp.fromMillis(1) };
        const wrap = data => generation === 'legacy' ? data : { value: data };
        await env.withSecurityRulesDisabled(async ctx => {
            const admin = ctx.firestore();
            await setDoc(doc(admin, ...prefix, 'records', key), wrap(stored));
            if (generation !== 'legacy') {
                await setDoc(doc(admin, ...prefix), { status: 'ready' });
                await setDoc(doc(admin, 'users', uid, 'control', 'restore'), { protocol: 2, activeGeneration: generation,
                    previousGeneration: 'legacy', activatedAt: Timestamp.fromMillis(1) });
            }
        });
        const rawPair = (id, { receipt = true, conflict = true, local = v, remote = stored, conflictId = id } = {}) => {
            const batch = writeBatch(db);
            if (receipt) batch.set(ref('operations', id), { status: 'conflict', createdAt: serverTimestamp() });
            if (conflict) batch.set(ref('conflicts', conflictId), { operationId: conflictId, entityKey: key, local, remote, createdAt: serverTimestamp() });
            return batch.commit();
        };
        await t.test('detached receipt cannot preclaim the ID of a pending operation', async () => {
            const op = { ...makeOperation(key, value(v.id, 20), 'stale-base'), generation };
            await denied(rawPair(op.id, { conflict: false }));
            assert.equal((await getDoc(ref('operations', op.id))).exists(), false);
        });
        await t.test('old and new real clients create paired conflicts, replay them and preserve long keys', async () => {
            for (const [index, create] of [published.criarFirebaseSync, criarFirebaseSync].entries()) {
                const client = factory(create, db);
                const op = { ...makeOperation(key, value(v.id, 20 + index), 'stale-base'), generation };
                const result = await client.commit(uid, op);
                assert.equal(result.conflict, true); assert.equal(result.acknowledged, true);
                const repeated = await client.commit(uid, op);
                assert.equal(repeated.conflict, true); assert.equal(repeated.duplicate, true);
                assert.equal((await getDoc(ref('conflicts', op.id))).data().entityKey, key);
                assert.equal((await getDoc(ref('conflicts', op.id))).data().remote.revision, stored.revision);
                await client.resolveConflict(uid, op.id, 'remote', generation);
                assert.equal((await getDoc(ref('conflicts', op.id))).data().resolved, true);
            }
        });
        await t.test('partial/mismatched pairs, forged remote and mismatched local identity are rejected', async () => {
            await denied(rawPair('only-document', { receipt: false }));
            await denied(rawPair('wrong-pair', { conflictId: 'other-document' }));
            await denied(rawPair('forged-remote', { remote: { ...stored, record: { ...stored.record, valor: 999 } } }));
            await denied(rawPair('wrong-local-key', { local: value('other-id') }));
            for (const id of ['only-document', 'wrong-pair', 'other-document', 'forged-remote', 'wrong-local-key']) {
                assert.equal((await getDoc(ref('operations', id))).exists(), false);
                assert.equal((await getDoc(ref('conflicts', id))).exists(), false);
            }
        });
        await t.test('old/new automatic recovery histories remain independent, immutable and reserved', async () => {
            for (const [index, create] of [published.criarFirebaseSync, criarFirebaseSync].entries()) {
                const client = factory(create, db), id = 'auto-history-' + operationId('synthetic-history', null, index);
                const item = { id, entityKey: key, policy: 'server-confirmed-wins', local: { record: v.record }, remote: stored, uploaded: false };
                await client.saveAutomaticHistory(uid, item, generation);
                await client.saveAutomaticHistory(uid, { ...item, policy: 'changed' }, generation);
                assert.equal((await getDoc(ref('operations', id))).data().status, 'conflict');
                assert.equal((await getDoc(ref('conflicts', id))).exists(), false);
                await denied(setDoc(ref('operations', id), { status: 'conflict', createdAt: serverTimestamp() }));
            }
            const data = generation === 'legacy'
                ? { status: 'conflict', operationId: 'normal-operation', entityKey: key, local: { policy: 'fake-history', value: {} }, remote: {}, createdAt: serverTimestamp() }
                : { status: 'conflict', local: { id: 'normal-operation', entityKey: key, policy: 'fake-history' }, createdAt: serverTimestamp() };
            await denied(setDoc(ref('operations', 'normal-operation'), data));
        });
        await t.test('historical unpaired conflicts stay readable and resolvable without rewriting old receipts', async () => {
            await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), ...prefix, 'conflicts', 'historical'), {
                operationId: 'historical', entityKey: key, local: v, remote: stored, createdAt: Timestamp.fromMillis(1)
            }));
            const client = factory(criarFirebaseSync, db);
            assert.equal((await getDoc(ref('conflicts', 'historical'))).data().operationId, 'historical');
            await client.resolveConflict(uid, 'historical', 'remote', generation);
            assert.equal((await getDoc(ref('conflicts', 'historical'))).data().resolved, true);
        });
        await t.test('known blocker: complete conflict pair cannot prove the absent base revision or recompute operation hash', async () => {
            await rawPair('synthetic-false-conflict');
            assert.equal((await getDoc(ref('operations', 'synthetic-false-conflict'))).data().status, 'conflict');
            const after = (await getDoc(ref('records', key))).data();
            assert.equal(generation === 'legacy' ? after.revision : after.value.revision, stored.revision);
        });
    });
});

test('published rules positive control: detached conflict receipt was accepted', { skip }, async () => {
    await environment('firestore.rules', 'before', async (_env, db) => {
        await setDoc(doc(db, 'users', uid, 'operations', 'synthetic-preclaimed'), { status: 'conflict', createdAt: serverTimestamp() });
        assert.equal((await getDoc(doc(db, 'users', uid, 'conflicts', 'synthetic-preclaimed'))).exists(), false);
    });
});
