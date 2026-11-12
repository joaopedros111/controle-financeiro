import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { criarFirebaseSync } from '../firebase-sync-entry.js';
import { makeOperation, recordEntityKey, inspectRemoteKeys } from '../sync-core.js';
import { normalizarEstado } from '../finance-core.js';
import { loadPublishedClient } from './fixtures/published-source.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const entry = (id, valor = 10) => ({ month: '2026-11', type: 'receitas', id, deleted: false, record: { id, nome: 'Synthetic', valor } });
const client = (factory, db, uid) => factory({ projectId: 'demo-compatibility' }, {
    createApp: () => ({}), createAuth: () => ({ currentUser: { uid } }), createFirestore: () => db,
    checkAuthPersistence() {}, getRedirectResult: async () => null
});

test('pinned 1.1.109 compatibility matrix, offline intents and mixed versions', { skip: !host && 'Requires Firestore Emulator' }, async t => {
    const [hostname, port] = host.split(':'); assert.match(hostname, /^(127\.0\.0\.1|localhost)$/);
    const published = await loadPublishedClient();
    for (const rulesFile of ['firestore.rules', 'firestore.integrity.rules']) {
        for (const generation of ['legacy', 'restored']) await t.test(`${rulesFile}: ${generation}`, async t => {
            const projectId = `demo-compat-${rulesFile === 'firestore.rules' ? 'old' : 'new'}-${generation}`;
            let env = await initializeTestEnvironment({ projectId, firestore: { host: hostname, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
            await env.clearFirestore();
            const uid = 'synthetic-owner';
            let old = client(published.criarFirebaseSync, env.authenticatedContext(uid).firestore(), uid);
            if (generation !== 'legacy') await old.publishRestore(uid, { generation, baseGeneration: 'legacy', state: normalizarEstado({ meses: {} }) });
            const v = entry('ação / % espaço 😀');
            const create = { ...published.makeOperation(published.recordEntityKey(v), v), generation };
            await old.commit(uid, create);
            const pending = JSON.parse(JSON.stringify([{ ...published.makeOperation(create.entityKey, entry(v.id, 20), create.id), generation }]));
            const savedIntent = JSON.stringify(pending);
            // Rules change while the device is offline. No operation is re-keyed.
            await env.cleanup();
            env = await initializeTestEnvironment({ projectId, firestore: { host: hostname, port: Number(port), rules: await readFile(new URL(`../${rulesFile}`, import.meta.url), 'utf8') } });
            old = client(published.criarFirebaseSync, env.authenticatedContext(uid).firestore(), uid);
            const fresh = client(criarFirebaseSync, env.authenticatedContext(uid).firestore(), uid);
            try {
                await t.test('new client reads legacy identities and lost ACK receipts', async () => {
                    const rows = await fresh.list(uid, { generation });
                    assert.deepEqual(inspectRemoteKeys(rows), { duplicates: [], mismatches: [] });
                    assert.equal(rows[0].revision, create.id);
                    assert.equal((await fresh.commit(uid, create)).duplicate, true);
                });
                await t.test('old client pending write has explicit outcome and preserves exact intent', async () => {
                    if (rulesFile === 'firestore.rules') assert.equal((await old.commit(uid, pending[0])).acknowledged, true);
                    else {
                        await assert.rejects(old.commit(uid, pending[0]), { code: 'permission-denied' });
                        assert.equal((await fresh.list(uid, { generation }))[0].revision, create.id);
                    }
                    assert.equal(JSON.stringify(pending), savedIntent);
                });
                await t.test('upgrade sends the original queue and ACKs once without duplication', async () => {
                    assert.equal((await fresh.commit(uid, pending[0])).acknowledged, true);
                    assert.equal((await fresh.commit(uid, pending[0])).duplicate, true);
                    const rows = await old.list(uid, { generation });
                    assert.equal(rows.length, 1); assert.equal(rows[0].record.valor, 20);
                    assert.equal(rows[0].revision, pending[0].id);
                    assert.equal(JSON.stringify(pending), savedIntent);
                });
                await t.test('mixed versions reject stale edits and preserve a shared tombstone', async () => {
                    const remove = { ...makeOperation(create.entityKey, { month: v.month, type: v.type, id: v.id, deleted: true }, pending[0].id), generation };
                    await fresh.commit(uid, remove);
                    const stale = { ...published.makeOperation(create.entityKey, entry(v.id, 99), pending[0].id), generation };
                    assert.equal((await old.commit(uid, stale)).conflict, true);
                    assert.equal((await fresh.commit(uid, stale)).duplicate, true);
                    assert.equal((await old.list(uid, { generation }))[0].deleted, true);
                    const base = ['users', uid, ...(generation === 'legacy' ? [] : ['financeGenerations', generation])];
                    assert.equal((await getDoc(doc(env.authenticatedContext(uid).firestore(), ...base, 'operations', pending[0].id))).data().status, 'applied');
                });
            } finally { await env.cleanup(); }
        });
    }
});
