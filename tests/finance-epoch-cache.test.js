import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeKey, stageIntent, openEpochCache, EPOCH_DATABASE } from '../finance-epoch-cache.js';
import { makeCommand } from '../finance-epoch.js';
import { queueStatus, EpochQueueSync } from '../finance-epoch-queue.js';

const scope = { projectId: 'demo-queue', uid: 'alice', epoch: 'e1' };
const c = extra => makeCommand({ ...scope, entityId: 'r1', operationId: 'op1', payload: { amountCents: 100 }, ...extra });
const empty = () => ({ version: 1, nextSequence: 1, operations: [], remote: {}, projection: {}, serverReady: false, lease: null });
test('cache scope includes project, UID and epoch and has a separate database', () => {
    assert.notEqual(EPOCH_DATABASE, 'controleFinanceiro:integridade:v1');
    for (const change of [{ projectId: 'demo-other' }, { uid: 'bob' }, { epoch: 'e2' }]) assert.notEqual(scopeKey(scope), scopeKey({ ...scope, ...change }));
    assert.throws(() => scopeKey({ ...scope, uid: '../bob' }));
});
test('intention retains exact command; repetition is idempotent and edits keep stable identity', () => {
    const state = stageIntent(empty(), c());
    stageIntent(state, c());
    assert.equal(state.operations.length, 1);
    assert.deepEqual(state.operations[0].command, c());
    assert.throws(() => stageIntent(state, c({ payload: { amountCents: 999 } })), { code: 'epoch/id-reused' });
    stageIntent(state, c({ operationId: 'edit', baseRevision: 1, payload: { amountCents: 200 } }));
    assert.equal(state.projection['records/r1'].revision, 2);
    assert.equal(state.operations.length, 2);
    state.operations[0].status = 'conflict';
    stageIntent(state, c({ operationId: 'dependent', baseRevision: 2, payload: { amountCents: 300 } }));
    assert.equal(state.projection['records/r1'].conflict, true);
});
test('stale local edits and tombstone resurrection never overwrite local intent', () => {
    const state = stageIntent(empty(), c());
    const before = structuredClone(state);
    assert.throws(() => stageIntent(state, c({ operationId: 'stale' })), { code: 'cache/stale-base' });
    assert.deepEqual(state, before);
    stageIntent(state, c({ operationId: 'delete', baseRevision: 1, action: 'delete', payload: {} }));
    assert.throws(() => stageIntent(state, c({ operationId: 'resurrect', baseRevision: 2 })), { code: 'cache/stale-base' });
});
test('status never reports synchronized with pending, conflicts, errors or missing server baseline', () => {
    const state = empty();
    assert.equal(queueStatus(state), 'sincronizando');
    state.serverReady = true;
    assert.equal(queueStatus(state), 'sincronizado');
    assert.equal(queueStatus(state, { busy: true }), 'sincronizando');
    stageIntent(state, c());
    assert.equal(queueStatus(state), 'sincronizando');
    assert.equal(queueStatus(state, { online: false }), 'offline');
    state.operations[0].status = 'conflict';
    assert.equal(queueStatus(state), 'erro');
    assert.equal(queueStatus(state, { error: new Error() }), 'erro');
});
test('unavailable or failing IndexedDB rejects without reporting saved', async () => {
    await assert.rejects(openEpochCache(scope, { indexedDB: null }), { code: 'cache/unavailable' });
    await assert.rejects(openEpochCache(scope, { indexedDB: { open() { throw new DOMException('quota', 'QuotaExceededError'); } } }), { name: 'QuotaExceededError' });
});
test('processor rejects transport crossing scope and has no active synchronized state', async () => {
    const worker = new EpochQueueSync();
    assert.equal(await worker.status(), 'erro');
    assert.throws(() => worker.activate({ scope }, { scope: { ...scope, uid: 'bob' } }));
});
test('connectivity observer resumes flushing and its disposer stops callbacks', async () => {
    const worker = new EpochQueueSync(), target = new EventTarget();
    let calls = 0;
    worker.flush = async () => { calls++; };
    const dispose = worker.observeConnectivity(target);
    target.dispatchEvent(new Event('offline'));
    assert.equal(worker.online, false);
    target.dispatchEvent(new Event('online'));
    assert.equal(worker.online, true);
    assert.equal(calls, 1);
    dispose(); target.dispatchEvent(new Event('online'));
    assert.equal(calls, 1);
});
test('invalid lease cannot cause unbounded retry or a permanently pending ACK', () => {
    for (const leaseMs of [0, -1, NaN, Infinity]) assert.throws(() => new EpochQueueSync({ leaseMs }));
});
