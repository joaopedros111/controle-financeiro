import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, writeBatch, serverTimestamp, Timestamp, deleteDoc } from 'firebase/firestore';
import { recordEntityKey } from '../sync-core.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const value = (id = 'synthetic', amount = 10) => ({ month: '2026-11', type: 'receitas', id,
    record: { id, nome: 'Synthetic only', valor: amount }, deleted: false });
async function denied(promise) {
    await assert.rejects(promise, error => {
        assert.equal(error.code, 'permission-denied');
        // The Emulator may report errors from speculative create/update branches
        // alongside the final false decision. Positive controls and the mutation
        // tests below establish causality; denial alone is not our evidence.
        assert.doesNotMatch(error.message, /expression.{0,30}limit|maximum.{0,30}expression|Null value error|Property .*undefined/i);
        assert.match(error.message, /false for '(create|update|delete|get|list)'/);
        return true;
    });
}
for (const generation of ['legacy', 'synthetic-generation']) test(`integrity candidate: ${generation}`, {
    skip: !host && 'Requires Firestore Emulator'
}, async t => {
    const [hostname, port] = host.split(':');
    assert.match(hostname, /^(127\.0\.0\.1|localhost)$/);
    const rules = await readFile(new URL('../firestore.integrity.rules', import.meta.url), 'utf8');
    const env = await initializeTestEnvironment({ projectId: `demo-integrity-${generation}`, firestore: { host: hostname, port: Number(port), rules } });
    await env.clearFirestore(); // Only this isolated demo project, never browser storage.
    const uid = 'synthetic-owner', db = env.authenticatedContext(uid).firestore();
    const prefix = ['users', uid, ...(generation === 'legacy' ? [] : ['financeGenerations', generation])];
    const ref = (kind, id, instance = db) => doc(instance, ...prefix, kind, id);
    const envelope = (v, op) => ({ ...v, revision: op, updatedAt: serverTimestamp() });
    const wrap = v => generation === 'legacy' ? v : { value: v };
    const unwrap = snap => generation === 'legacy' ? snap.data() : snap.data().value;
    async function pair(v, op, base = null, { key = recordEntityKey(v), receiptKey = key, instance = db, receipt = true, record = true, stamp } = {}) {
        const batch = writeBatch(instance);
        if (record) batch.set(ref('records', key, instance), wrap({ ...envelope(v, op), ...(stamp ? { updatedAt: stamp } : {}) }));
        if (receipt) batch.set(ref('operations', op, instance), { status: 'applied', createdAt: serverTimestamp(), local: { entityKey: receiptKey, baseRevision: base, value: v } });
        return batch.commit();
    }
    async function seed(key, v) {
        await env.withSecurityRulesDisabled(ctx => setDoc(ref('records', key, ctx.firestore()), wrap(v)));
    }
    try {
        if (generation !== 'legacy') await env.withSecurityRulesDisabled(async ctx => {
            const admin = ctx.firestore();
            await setDoc(doc(admin, 'users', uid, 'control', 'restore'), { protocol: 2, activeGeneration: generation, previousGeneration: 'legacy', activatedAt: Timestamp.now() });
            await setDoc(doc(admin, ...prefix), { status: 'ready' });
        });
        await t.test('valid create, update, receipt and owner read', async () => {
            await pair(value(), 'create');
            await pair(value('synthetic', 20), 'edit', 'create');
            assert.equal(unwrap(await getDoc(ref('records', recordEntityKey(value())))).record.valor, 20);
            assert.equal((await getDoc(ref('operations', 'edit'))).data().local.baseRevision, 'create');
        });
        await t.test('anonymous and another UID cannot read or write; unknown paths closed', async () => {
            for (const stranger of [env.unauthenticatedContext().firestore(), env.authenticatedContext('outsider').firestore()]) {
                await denied(getDoc(ref('records', recordEntityKey(value()), stranger)));
                await denied(pair(value('unauthorized'), 'unauthorized', null, { instance: stranger }));
            }
            await denied(setDoc(doc(db, 'users', uid, 'unrecognized', 'entry'), { synthetic: true }));
        });
        await t.test('missing receipt, detached receipt, partial write and client timestamp denied atomically', async () => {
            await denied(pair(value('no-receipt'), 'no-receipt', null, { receipt: false }));
            await denied(pair(value('detached'), 'detached', null, { record: false }));
            await denied(pair(value('mismatch'), 'mismatch', null, { receiptKey: recordEntityKey(value('elsewhere')) }));
            await denied(pair(value('timestamp'), 'timestamp', null, { stamp: Timestamp.fromMillis(1) }));
            for (const id of ['no-receipt', 'detached', 'mismatch', 'timestamp']) {
                assert.equal((await getDoc(ref('records', recordEntityKey(value(id))))).exists(), false);
                assert.equal((await getDoc(ref('operations', id))).exists(), false);
            }
        });
        await t.test('stale base, repeated revision and overwrite cannot change existing state', async () => {
            await denied(pair(value('synthetic', 99), 'stale', 'create'));
            await denied(pair(value('synthetic', 99), 'edit', 'edit'));
            await denied(pair(value('synthetic', 99), 'overwrite'));
            await denied(setDoc(ref('operations', 'edit'), { status: 'conflict', createdAt: serverTimestamp() }));
            assert.equal(unwrap(await getDoc(ref('records', recordEntityKey(value())))).record.valor, 20);
        });
        await t.test('financial schema remains enforced with a correctly paired receipt', async () => {
            const invalid = [
                v => ({ ...v, record: { ...v.record, valor: -0.01 } }),
                v => ({ ...v, record: { ...v.record, valor: 0.001 } }),
                v => ({ ...v, record: { ...v.record, nome: '   ' } }),
                v => ({ ...v, record: { ...v.record, id: 'other' } }),
                v => ({ ...v, unexpected: true }),
                v => ({ ...v, deleted: 'true' })
            ];
            for (const [index, corrupt] of invalid.entries()) {
                const v = value(`schema-${index}`), prior = `schema-valid-${index}`;
                await pair(v, prior);
                await denied(pair(corrupt(v), `schema-invalid-${index}`, prior));
                assert.equal(unwrap(await getDoc(ref('records', recordEntityKey(v)))).revision, prior);
            }
        });
        await t.test('two concurrent batches based on the same revision have exactly one winner', async () => {
            const results = await Promise.allSettled([pair(value('synthetic', 30), 'race-a', 'edit'), pair(value('synthetic', 40), 'race-b', 'edit')]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            const loser = results.find(r => r.status === 'rejected');
            assert.equal(loser.reason.code, 'permission-denied');
            assert.equal((await getDoc(ref('operations', 'race-a'))).exists() !== (await getDoc(ref('operations', 'race-b'))).exists(), true);
        });
        await t.test('identity fields cannot change, even with matching receipt and base', async () => {
            const key = recordEntityKey(value()), old = unwrap(await getDoc(ref('records', key)));
            for (const [field, replacement] of [['month', '2026-12'], ['type', 'despesas'], ['id', 'other']]) {
                const changed = { ...value(), [field]: replacement };
                if (field === 'id') changed.record = { ...changed.record, id: replacement };
                await denied(pair(changed, `identity-${field}`, old.revision, { key }));
            }
        });
        await t.test('logical deletion, no resurrection, immutable tombstone and no physical deletion', async () => {
            const key = recordEntityKey(value()), old = unwrap(await getDoc(ref('records', key)));
            const dead = { month: value().month, type: value().type, id: value().id, deleted: true };
            await pair(dead, 'delete', old.revision);
            await denied(pair(value(), 'resurrect', 'delete'));
            await denied(deleteDoc(ref('records', key)));
            await pair(dead, 'delete-again', 'delete');
            const final = unwrap(await getDoc(ref('records', key)));
            assert.equal(final.deleted, true); assert.equal(Object.hasOwn(final, 'record'), false);
        });
        await t.test('canonical UTF-8 hex preserves separators, accents, emoji and percent characters without aliases', async () => {
            for (const [index, id] of ['a/b', 'a%2Fb', 'a.b_-', 'ação', '😀', 'i'.repeat(128), '😀'.repeat(64), 'a\nb', '\tvalid\t', 'a\u0000b'].entries()) {
                const v = value(id); await pair(v, `unicode-${index}`);
                assert.equal(unwrap(await getDoc(ref('records', recordEntityKey(v)))).id, id);
                await denied(pair(v, `alias-${index}`, null, { key: `alias-${index}` }));
            }
            assert.notEqual(recordEntityKey(value('a/b')), recordEntityKey(value('a%2Fb')));
        });
        await t.test('wrong key, uppercase hex, duplicate alias and invalid or ambiguous IDs denied', async () => {
            for (const [index, id] of ['', ' ', '\u00a0', 'i'.repeat(129), '😀'.repeat(65)].entries()) {
                await denied(pair(value(id), `bad-id-${index}`));
            }
            const v = value('correct-key');
            await denied(pair(v, 'wrong-key', null, { key: 'arbitrary' }));
            await denied(pair(v, 'uppercase', null, { key: recordEntityKey(v).toUpperCase() }));
        });
        await t.test('legacy canonical record updates without migrating revisions or requiring an old receipt', async () => {
            const v = value('legacy-canonical'), key = recordEntityKey(v);
            await seed(key, { ...v, revision: 'opaque-old-revision', updatedAt: Timestamp.fromMillis(1) });
            await pair(value(v.id, 50), 'legacy-edit', 'opaque-old-revision');
            assert.equal(unwrap(await getDoc(ref('records', key))).record.valor, 50);
        });
        await t.test('noncanonical legacy data remains readable and immutable for recovery', async () => {
            const v = value('legacy-alias'), stored = { ...v, revision: 'old', updatedAt: Timestamp.fromMillis(1) };
            await seed('legacy-alias-document', stored);
            assert.equal(unwrap(await getDoc(ref('records', 'legacy-alias-document'))).record.valor, 10);
            await denied(pair(value(v.id, 60), 'alias-edit', 'old', { key: 'legacy-alias-document' }));
        });
        await t.test('published 1.1.109 receipt cannot authorize a new financial write; old receipts remain readable', async () => {
            const batch = writeBatch(db), v = value('old-client'), key = recordEntityKey(v);
            batch.set(ref('records', key), wrap(envelope(v, 'old-client')));
            batch.set(ref('operations', 'old-client'), { status: 'applied', createdAt: serverTimestamp() });
            await denied(batch.commit());
            assert.equal((await getDoc(ref('records', key))).exists(), false);
            await env.withSecurityRulesDisabled(ctx => setDoc(ref('operations', 'old-receipt', ctx.firestore()), { status: 'applied', createdAt: Timestamp.fromMillis(1) }));
            assert.equal((await getDoc(ref('operations', 'old-receipt'))).data().status, 'applied');
        });
    } finally { await env.cleanup(); }
});

test('causal controls: removing each candidate guard admits exactly the tested attack', {
    skip: !host && 'Requires Firestore Emulator'
}, async t => {
    const [hostname, port] = host.split(':');
    assert.match(hostname, /^(127\.0\.0\.1|localhost)$/);
    const candidate = await readFile(new URL('../firestore.integrity.rules', import.meta.url), 'utf8');
    const cases = [
        { name: 'receipt', from: "? pairedRecord(uid, 'legacy', recordId, request.resource.data) : false", to: '? true : false', receipt: false },
        { name: 'revision', from: 'base == old.revision', to: 'true', old: { revision: 'previous', deleted: false }, base: 'stale' },
        { name: 'canonical-key', from: "key == (value.month + '/' + value.type + '/' + value.id).toUtf8().toHexString().lower()", to: 'true', key: 'aa' },
        { name: 'resurrection', from: '(!old.deleted || next.deleted)', to: 'true', old: { revision: 'previous', deleted: true }, base: 'previous' }
    ];
    for (const item of cases) await t.test(item.name, async () => {
        assert.ok(candidate.includes(item.from));
        const projectId = `demo-integrity-control-${item.name}`;
        let env = await initializeTestEnvironment({ projectId, firestore: { host: hostname, port: Number(port), rules: candidate } });
        await env.clearFirestore();
        const v = value(item.name), key = item.key || recordEntityKey(v);
        const parts = ['users', 'control-owner'];
        if (item.old) await env.withSecurityRulesDisabled(async ctx => {
            const old = { ...v, ...item.old, updatedAt: Timestamp.fromMillis(1) };
            if (old.deleted) delete old.record;
            await setDoc(doc(ctx.firestore(), ...parts, 'records', key), old);
        });
        const attack = instance => {
            const batch = writeBatch(instance);
            batch.set(doc(instance, ...parts, 'records', key), { ...v, revision: 'attack', updatedAt: serverTimestamp() });
            if (item.receipt !== false) batch.set(doc(instance, ...parts, 'operations', 'attack'), {
                status: 'applied', createdAt: serverTimestamp(), local: { entityKey: key, baseRevision: item.base || null, value: v }
            });
            return batch.commit();
        };
        try {
            await denied(attack(env.authenticatedContext('control-owner').firestore()));
            await env.cleanup();
            // Mutation is loaded exclusively into this synthetic emulator project.
            // Neither the candidate file nor the production rule file is relaxed.
            env = await initializeTestEnvironment({ projectId, firestore: { host: hostname, port: Number(port), rules: candidate.replace(item.from, item.to) } });
            await attack(env.authenticatedContext('control-owner').firestore());
            const saved = await getDoc(doc(env.authenticatedContext('control-owner').firestore(), ...parts, 'records', key));
            assert.equal(saved.data().revision, 'attack');
        } finally { await env.cleanup(); }
    });
});
