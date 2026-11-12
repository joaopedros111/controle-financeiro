import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { withFinanceGenerations } from '../finance-generation-transport.js';
import { operationId } from '../sync-core.js';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulator && 'Requires Firestore Emulator';
const uid = 'synthetic-settings-owner';
const manifest = (generation, categoryCount = 0, budgetCount = 0) => ({ version: 4, theme: 'claro', categoryCount, budgetCount, generation, revision: generation });
const encodeCategory = name => 'c_' + encodeURIComponent(name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const financial = { version: 3, categories: ['Casa'], theme: 'claro', budgets: { padrao: { Casa: 10 }, meses: {} } };
async function denied(action) {
    await assert.rejects(action, error => {
        assert.equal(error.code, 'permission-denied');
        assert.doesNotMatch(error.message, /maximum.*expressions|expression.{0,25}limit|Null value error|Property .*undefined/i);
        return true;
    });
}
async function environment(rulesFile, suffix, callback) {
    const [host, port] = emulator.split(':');
    assert.match(host, /^(127\.0\.0\.1|localhost)$/);
    const env = await initializeTestEnvironment({ projectId: `demo-settings-${suffix}`, firestore: { host, port: Number(port),
        rules: await readFile(new URL(`../${rulesFile}`, import.meta.url), 'utf8') } });
    await env.clearFirestore();
    try { await callback(env, env.authenticatedContext(uid).firestore()); } finally { await env.cleanup(); }
}

test('settings candidate preserves V2 preparation/publication and rejects demonstrated malformed writes', { skip }, async t => {
    await environment('firestore.integrity.rules', 'v2-candidate', async (env, db) => {
        const pointer = doc(db, 'users', uid, 'settingsV2', 'finance');
        const category = (generation, name, id = encodeCategory(name)) => doc(db, 'users', uid, 'settingsV2', 'finance', 'generations', generation, 'categories', id);
        await t.test('published client contract: prepare immutable categories, then publish matching revision/generation', async () => {
            await setDoc(category('prepared', 'Casa'), { name: 'Casa', budget: 10 });
            await setDoc(category('prepared', 'ação 😀'), { name: 'ação 😀' });
            await setDoc(pointer, manifest('prepared', 2, 1));
            assert.equal((await getDoc(pointer)).data().generation, 'prepared');
            assert.equal((await getDoc(category('prepared', 'ação 😀'))).data().name, 'ação 😀');
        });
        await t.test('extra categories cannot corrupt the currently published immutable generation', async () => {
            await denied(setDoc(category('prepared', 'Extra'), { name: 'Extra' }));
            await denied(updateDoc(category('prepared', 'Casa'), { budget: 99 }));
            await setDoc(category('next', 'Extra'), { name: 'Extra' });
            assert.equal((await getDoc(category('prepared', 'Extra'))).exists(), false);
        });
        await t.test('budget count cannot exceed category count; generation must equal revision', async () => {
            await denied(setDoc(pointer, manifest('bad-count', 1, 2)));
            await denied(setDoc(pointer, { ...manifest('same-generation'), revision: 'different-revision' }));
            assert.equal((await getDoc(pointer)).data().generation, 'prepared');
        });
        await t.test('whitespace and UTF-16 overflow rejected, valid Unicode and non-whitespace spaces preserved', async () => {
            for (const [index, name] of [' ', '\u00a0\ufeff', '😀'.repeat(21)].entries()) {
                await denied(setDoc(category('names', name, 'c_invalid_' + index), { name }));
            }
            for (const name of [' Casa ', 'ação/😀', '😀'.repeat(20)]) await setDoc(category('names', name), { name });
        });
        await t.test('owner authorization and unknown paths remain closed', async () => {
            for (const stranger of [env.authenticatedContext('synthetic-outsider').firestore(), env.unauthenticatedContext().firestore()]) {
                await denied(getDoc(doc(stranger, 'users', uid, 'settingsV2', 'finance')));
                await denied(setDoc(doc(stranger, 'users', uid, 'settingsV2', 'finance'), manifest('intruder')));
            }
            await denied(setDoc(doc(db, 'users', uid, 'settingsUnexpected', 'finance'), {}));
        });
    });
});

test('published rules positive controls demonstrate why V2 checks were necessary', { skip }, async () => {
    await environment('firestore.rules', 'v2-before', async (_env, db) => {
        const pointer = doc(db, 'users', uid, 'settingsV2', 'finance');
        await setDoc(pointer, { ...manifest('published', 1, 2), revision: 'unrelated' });
        await setDoc(doc(db, 'users', uid, 'settingsV2', 'finance', 'generations', 'published', 'categories', 'c_extra'), { name: ' ' });
        assert.equal((await getDoc(pointer)).data().budgetCount, 2);
    });
});

for (const rulesFile of ['firestore.rules', 'firestore.integrity.rules']) test(`known blockers stay explicit: stale V2 pointer and incomplete generations: ${rulesFile}`, { skip }, async () => {
    await environment(rulesFile, rulesFile === 'firestore.rules' ? 'v2-blockers-before' : 'v2-blockers-after', async (_env, db) => {
        const pointer = doc(db, 'users', uid, 'settingsV2', 'finance');
        await setDoc(pointer, manifest('older'));
        await setDoc(pointer, manifest('newer'));
        await setDoc(pointer, manifest('older'));
        assert.equal((await getDoc(pointer)).data().revision, 'older', 'server cannot infer a base revision absent from the wire contract');
        await setDoc(pointer, manifest('missing-categories', 2, 1));
        assert.equal((await getDoc(pointer)).data().categoryCount, 2, 'no server-side collection count/seal in V2');
        await setDoc(doc(db, 'users', uid, 'settingsV2', 'finance', 'generations', 'another', 'categories', 'c_wrong-key'), { name: 'Canonical name' });
    });
});

test('settings snapshots enforce stage/advance/seal, active generation and read isolation', { skip }, async t => {
    await environment('firestore.integrity.rules', 'snapshots-candidate', async (env, db) => {
        const generation = 'synthetic-generation';
        const root = doc(db, 'users', uid, 'financeGenerations', generation);
        const snapshot = id => doc(root, 'settingsSnapshots', id);
        const pointer = doc(root, 'settings', 'finance');
        await env.withSecurityRulesDisabled(async ctx => {
            await setDoc(doc(ctx.firestore(), root.path), { status: 'ready' });
            await setDoc(doc(ctx.firestore(), 'users', uid, 'control', 'restore'), { protocol: 2, activeGeneration: generation,
                previousGeneration: 'legacy', activatedAt: Timestamp.fromMillis(1) });
        });
        const stage = (id, text = JSON.stringify(financial), hash = operationId('settings-content', null, financial)) => setDoc(snapshot(id), { count: 1, written: 0, hash, status: 'staging' });
        async function piece(id, text = JSON.stringify(financial)) {
            const batch = writeBatch(db);
            batch.set(doc(snapshot(id), 'chunks', '0'), { index: 0, text });
            batch.update(snapshot(id), { written: 1 });
            await batch.commit();
        }
        async function ready(id) { await stage(id); await piece(id); await updateDoc(snapshot(id), { status: 'ready' }); }
        await t.test('complete preparation and immutable parts succeed; premature seal and detached writes fail', async () => {
            await stage('first');
            await denied(updateDoc(snapshot('first'), { status: 'ready' }));
            await denied(updateDoc(snapshot('first'), { written: 1 }));
            await denied(setDoc(doc(snapshot('first'), 'chunks', '0'), { index: 0, text: JSON.stringify(financial) }));
            await piece('first'); await updateDoc(snapshot('first'), { status: 'ready' });
            await setDoc(pointer, { snapshot: 'first', updatedAt: serverTimestamp() });
            await denied(updateDoc(doc(snapshot('first'), 'chunks', '0'), { text: '{}' }));
            await denied(updateDoc(snapshot('first'), { hash: 'replacement' }));
            await denied(setDoc(pointer, { snapshot: 'absent', updatedAt: serverTimestamp() }));
        });
        await t.test('empty content hash is rejected without requiring a new client field', async () => {
            await denied(stage('empty-hash', '{}', ''));
            assert.equal((await getDoc(snapshot('empty-hash'))).exists(), false);
        });
        await t.test('real generation client serializes concurrent settings by its transaction CAS', async () => {
            const client = withFinanceGenerations({}, db, requestedUid => assert.equal(requestedUid, uid));
            const base = (await client.getSettings(uid, { generation })).revision;
            const choices = [11, 22].map(amount => ({ ...financial, budgets: { padrao: { Casa: amount }, meses: {} } }));
            const results = await Promise.all(choices.map(settings => client.saveSettings(uid, settings, base, () => true, generation)));
            assert.equal(results.filter(result => result.conflict).length, 1);
            assert.equal(results.filter(result => result.acknowledged).length, 1);
            assert.ok([11, 22].includes((await client.getSettings(uid, { generation })).budgets.padrao.Casa));
        });
        await t.test('known blocker: stale ready snapshot can still overwrite a newer pointer', async () => {
            await ready('second'); await setDoc(pointer, { snapshot: 'second', updatedAt: serverTimestamp() });
            await setDoc(pointer, { snapshot: 'first', updatedAt: serverTimestamp() });
            assert.equal((await getDoc(pointer)).data().snapshot, 'first');
        });
        await t.test('known blocker: JSON/hash semantic validation is client-side; reader fails closed', async () => {
            await stage('malformed', '{"broken":', 'opaque-hash'); await piece('malformed', '{"broken":');
            await updateDoc(snapshot('malformed'), { status: 'ready' });
            await setDoc(pointer, { snapshot: 'malformed', updatedAt: serverTimestamp() });
            const client = withFinanceGenerations({}, db, requestedUid => assert.equal(requestedUid, uid));
            await assert.rejects(client.getSettings(uid, { generation }), SyntaxError);
            await setDoc(pointer, { snapshot: 'first', updatedAt: serverTimestamp() });
        });
        await t.test('another UID cannot inspect snapshots; previous generation cannot publish settings', async () => {
            const outsider = env.authenticatedContext('synthetic-outsider').firestore();
            await denied(getDoc(doc(outsider, pointer.path)));
            await denied(getDoc(doc(outsider, snapshot('first').path)));
            await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users', uid, 'control', 'restore'), {
                protocol: 2, activeGeneration: 'synthetic-other', previousGeneration: generation, activatedAt: Timestamp.fromMillis(2)
            }));
            await denied(setDoc(pointer, { snapshot: 'first', updatedAt: serverTimestamp() }));
        });
    });
});
