import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { makeCommand, epochPath, entityPath } from '../finance-epoch.js';
import { commitEpochOperation } from '../finance-epoch-emulator.js';

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080';
const payload = { month: '2026-10', type: 'despesas', nome: 'Synthetic', amountCents: 1234 };
const command = (overrides = {}) => makeCommand({ uid: 'alice', epoch: 'e1', entityId: 'record1', payload, ...overrides });
async function denied(promise) {
    await assert.rejects(promise, error => {
        assert.equal(error.code, 'permission-denied');
        // Emulator may label a false function evaluation "evaluation error".
        // Reject actual runtime faults/budget exhaustion, not that generic label.
        assert.doesNotMatch(error.message, /maximum.*expressions|expression.{0,20}limit|Null value error|Property .*undefined/i);
        return true;
    });
}
function rawPair(db, c, { entity = {}, receipt = {} } = {}) {
    const batch = writeBatch(db);
    batch.set(doc(db, entityPath(c)), { payload: c.payload, deleted: c.action === 'delete', revision: c.baseRevision + 1,
        operationId: c.operationId, updatedAt: serverTimestamp(), ...entity });
    batch.set(doc(db, `${epochPath(c.uid, c.epoch)}/operations/${c.operationId}`), {
        command: c, resultRevision: c.baseRevision + 1, appliedAt: serverTimestamp(), ...receipt });
    return batch.commit();
}

test('epoch emulator: protocol and server-enforced invariants', { skip: !enabled }, async t => {
    const env = await initializeTestEnvironment({ projectId: 'demo-controle-financeiro-epoch',
        firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.epoch.rules', import.meta.url), 'utf8') } });
    const alice = env.authenticatedContext('alice').firestore();
    const second = env.authenticatedContext('alice', { device: 'second' }).firestore();
    const bob = env.authenticatedContext('bob').firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    const control = async data => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users/alice/control/finance'),
        { protocol: 1, activeEpoch: 'e1', status: 'active', ...data }));
    try {
        await env.clearFirestore();
        await control({});
        await t.test('create, repeat after newer edit, and reject reused operation identity', async () => {
            const c = command({ operationId: 'create' });
            assert.deepEqual(await commitEpochOperation(alice, c), { status: 'applied', duplicate: false, revision: 1 });
            const edit = command({ operationId: 'edit', baseRevision: 1, payload: { ...payload, amountCents: 2000 } });
            assert.equal((await commitEpochOperation(alice, edit)).revision, 2);
            assert.deepEqual(await commitEpochOperation(alice, c), { status: 'applied', duplicate: true, revision: 1 });
            assert.equal((await getDoc(doc(alice, entityPath(c)))).data().payload.amountCents, 2000);
            await assert.rejects(commitEpochOperation(alice, { ...c, payload: { ...payload, amountCents: 9000 } }), { code: 'epoch/id-reused' });
        });
        await t.test('two concurrent edits preserve rejected intent and exactly one wins', async () => {
            const a = command({ operationId: 'race-a', baseRevision: 2, payload: { ...payload, amountCents: 3000 } });
            const b = command({ operationId: 'race-b', baseRevision: 2, payload: { ...payload, amountCents: 4000 } });
            const results = await Promise.all([commitEpochOperation(alice, a), commitEpochOperation(second, b)]);
            assert.equal(results.filter(r => r.status === 'applied').length, 1);
            const rejected = results.find(r => r.status === 'conflict');
            assert.ok(rejected.command.operationId);
            assert.equal(rejected.current.revision, 3);
            assert.notEqual(rejected.current.payload.amountCents, rejected.command.payload.amountCents);
            await denied(rawPair(alice, command({ operationId: 'bypass-stale', baseRevision: 2 })));
        });
        await t.test('durable deletion, duplicate delete, no resurrection or physical delete', async () => {
            const c = command({ operationId: 'delete', baseRevision: 3, action: 'delete', payload: {} });
            assert.equal((await commitEpochOperation(alice, c)).revision, 4);
            assert.equal((await commitEpochOperation(second, c)).duplicate, true);
            assert.equal((await getDoc(doc(alice, entityPath(c)))).data().deleted, true);
            assert.equal((await commitEpochOperation(alice, command({ baseRevision: 4 }))).status, 'conflict');
            await denied(rawPair(alice, command({ operationId: 'resurrect', baseRevision: 4 })));
            await denied(deleteDoc(doc(alice, entityPath(c))));
            await denied(rawPair(alice, command({ entityId: 'missing', action: 'delete', payload: {} })));
        });
        await t.test('UID authorization, control protection and all legacy paths denied', async () => {
            for (const db of [bob, anonymous]) {
                await denied(getDoc(doc(db, entityPath(command()))));
                await denied(rawPair(db, command({ entityId: 'forbidden' })));
            }
            await denied(updateDoc(doc(alice, 'users/alice/control/finance'), { activeEpoch: 'evil' }));
            for (const path of ['records/r', 'settings/finance', 'settingsV2/finance',
                'settingsV2/finance/generations/old/categories/c', 'operations/o', 'conflicts/c', 'meta/sync']) {
                await denied(setDoc(doc(alice, `users/alice/${path}`), { legacy: true }));
            }
        });
        await t.test('paired writes, immutable receipts, shape, revisions and timestamps enforced', async () => {
            const c = command({ entityId: 'guarded', operationId: 'guarded-op' });
            await denied(setDoc(doc(alice, entityPath(c)), { payload, deleted: false, revision: 1, operationId: c.operationId, updatedAt: serverTimestamp() }));
            await denied(setDoc(doc(alice, `${epochPath('alice', 'e1')}/operations/lone`), {
                command: { ...c, operationId: 'lone' }, resultRevision: 1, appliedAt: serverTimestamp() }));
            for (const change of [{ entity: { revision: 9 } }, { entity: { updatedAt: new Date(0) } },
                { receipt: { resultRevision: 9 } }, { receipt: { extra: true } }, { entity: { extra: true } }]) {
                await denied(rawPair(alice, c, change));
            }
            for (const bad of [{ ...payload, amountCents: -1 }, { ...payload, amountCents: 1.5 },
                { ...payload, month: '2026-13' }, { ...payload, nome: '   ' }, { ...payload, extra: true },
                { ...payload, installment: { current: 3, total: 2 } }]) {
                await denied(rawPair(alice, command({ entityId: 'bad', payload: bad })));
            }
            await denied(updateDoc(doc(alice, `${epochPath('alice', 'e1')}/operations/create`), { resultRevision: 99 }));
            await denied(deleteDoc(doc(alice, `${epochPath('alice', 'e1')}/operations/create`)));
        });
        await t.test('categories, budgets, settings, series and installment metadata', async () => {
            for (const [collection, entityId, data] of [
                ['categories', 'home', { name: 'Casa' }], ['budgets', 'home-default', { categoryId: 'home', amountCents: 50000 }],
                ['settings', 'finance', { currency: 'BRL' }], ['records', 'installment', { ...payload, categoryId: 'home', paid: false,
                    fixed: false, seriesId: 'series1', installment: { current: 1, total: 12 } }]]) {
                assert.equal((await commitEpochOperation(alice, command({ collection, entityId, payload: data }))).status, 'applied');
            }
        });
        await t.test('simultaneous retries apply once, and independent records both apply', async () => {
            const c = command({ entityId: 'retry-record', operationId: 'retry-operation' });
            const results = await Promise.all([commitEpochOperation(alice, c), commitEpochOperation(second, c)]);
            assert.equal(results.filter(r => r.duplicate).length, 1);
            assert.equal((await getDoc(doc(alice, entityPath(c)))).data().revision, 1);
            const independent = await Promise.all(['independent-a', 'independent-b'].map(entityId =>
                commitEpochOperation(alice, command({ entityId }))));
            assert.ok(independent.every(r => r.status === 'applied'));
        });
        await t.test('edit versus delete races preserve both intentions without resurrection (20 runs)', async () => {
            for (let index = 0; index < 20; index++) {
                const entityId = `delete-race-${index}`;
                await commitEpochOperation(alice, command({ entityId }));
                const deletion = command({ entityId, baseRevision: 1, action: 'delete', payload: {} });
                const edit = command({ entityId, baseRevision: 1, payload: { ...payload, amountCents: 9999 } });
                const results = await Promise.all(index % 2
                    ? [commitEpochOperation(second, edit), commitEpochOperation(alice, deletion)]
                    : [commitEpochOperation(alice, deletion), commitEpochOperation(second, edit)]);
                assert.equal(results.filter(r => r.status === 'applied').length, 1);
                assert.equal(results.filter(r => r.status === 'conflict').length, 1);
                const rejected = results.find(r => r.status === 'conflict');
                assert.equal(rejected.current.revision, 2);
                assert.deepEqual(rejected.command, rejected.command.action === 'delete' ? deletion : edit);
                const snapshot = (await getDoc(doc(alice, entityPath(deletion)))).data();
                assert.equal(snapshot.revision, 2);
                if (!snapshot.deleted) {
                    await commitEpochOperation(alice, command({ ...deletion, operationId: `final-delete-${index}`, baseRevision: 2 }));
                }
                const replay = await commitEpochOperation(second, edit);
                assert.equal(replay.status, rejected.command.action === 'delete' ? 'applied' : 'conflict');
                if (replay.status === 'applied') assert.equal(replay.duplicate, true);
                assert.equal((await getDoc(doc(alice, entityPath(deletion)))).data().deleted, true);
            }
        });
        await t.test('maintenance and epoch rotation reject queued old commands at server', async () => {
            await control({ status: 'maintenance' });
            await denied(rawPair(alice, command({ entityId: 'maintenance' })));
            await assert.rejects(commitEpochOperation(alice, command()), error => ['permission-denied', 'epoch/inactive'].includes(error.code));
            await control({ activeEpoch: 'e2' });
            await denied(rawPair(alice, command({ entityId: 'stale-epoch' })));
            await denied(getDoc(doc(alice, entityPath(command()))));
            assert.equal((await commitEpochOperation(alice, command({ epoch: 'e2', entityId: 'fresh' }))).status, 'applied');
        });
    } finally { await env.cleanup(); }
});
