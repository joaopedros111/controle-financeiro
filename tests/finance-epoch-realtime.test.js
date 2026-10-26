import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EpochRealtimeSync, realtimeStatus } from '../finance-epoch-realtime.js';
import { stageIntent } from '../finance-epoch-cache.js';
import { makeCommand } from '../finance-epoch.js';

const scope = { projectId: 'demo-realtime', uid: 'alice', epoch: 'e1' };
function harness() {
    const state = { version: 1, operations: [], remote: {}, projection: {}, serverReady: true };
    const cache = { scope, state, writes: 0, read: async () => structuredClone(state),
        async applyRemoteSnapshot(snapshot, current) {
            await cache.gate;
            if (!current()) return;
            cache.writes++; state.serverReady = true; state.remote = snapshot.marker || {};
        },
        async retireGeneration(current) { if (current()) state.inactive = true; }
    };
    const streams = [];
    const transport = { scope, uid: 'alice', reads: 0, sends: 0,
        assertIdentity() { if (transport.uid !== scope.uid) throw Object.assign(new Error('UID changed'), { code: 'epoch/auth-changed' }); },
        listen(receive, failure) { const entry = { receive, failure, stopped: false }; streams.push(entry); return () => { entry.stopped = true; }; },
        async readSnapshot() { transport.reads++; throw new Error('No queue should be flushed'); },
        async commit() { transport.sends++; throw new Error('No echo permitted'); }
    };
    const realtime = new EpochRealtimeSync(cache, transport, { connectivity: new EventTarget(), retryMs: 5 });
    const emit = (marker = {}, stream = streams.at(-1)) => stream.receive({ type: 'snapshot', snapshot: { scope, marker } });
    return { cache, transport, streams, realtime, emit };
}
test('realtime status requires a current session baseline, not a persisted ready bit', () => {
    const state = { serverReady: true, operations: [] };
    const s = { online: true, ready: false, applying: 0 };
    assert.equal(realtimeStatus(state, s), 'sincronizando');
    s.ready = true; assert.equal(realtimeStatus(state, s), 'sincronizado');
    s.applying = 1; assert.equal(realtimeStatus(state, s), 'sincronizando');
    s.applying = 0; s.online = false; assert.equal(realtimeStatus(state, s), 'offline');
    state.operations.push({ status: 'pending' }); s.online = true;
    assert.equal(realtimeStatus(state, s), 'sincronizando');
    state.operations[0].status = 'conflict'; assert.equal(realtimeStatus(state, s), 'erro');
    assert.equal(realtimeStatus(state, s, false, new Error('quota')), 'erro');
});
test('start is idempotent; confirmed read never stages or sends an operation', async () => {
    const h = harness(); h.realtime.start(); h.realtime.start();
    assert.equal(h.streams.length, 1);
    assert.deepEqual((await h.realtime.view()).confirmed, {});
    h.emit({ canonical: true }); await h.realtime.session.chain; await delay(0);
    assert.equal((await h.realtime.view()).status, 'sincronizado');
    assert.equal(h.transport.sends, 0); assert.equal(h.transport.reads, 0);
    assert.equal(h.cache.state.operations.length, 0);
    h.realtime.stop(); assert.equal(h.streams[0].stopped, true);
});
test('stale callbacks and delayed cache mutations cannot escape a listener restart', async () => {
    const h = harness(); h.realtime.start();
    let release; h.cache.gate = new Promise(resolve => { release = resolve; });
    h.emit({ stale: true }); await delay(0);
    h.realtime.restartListeners();
    h.emit({ oldCallback: true }, h.streams[0]);
    h.emit({ fresh: true }); release(); await h.realtime.session.chain; await delay(0);
    assert.equal(h.cache.writes, 1);
    assert.deepEqual((await h.realtime.view()).confirmed, { fresh: true });
    assert.equal(h.streams.filter(entry => !entry.stopped).length, 1);
    h.realtime.stop();
});
test('recoverable listener failure restarts once without operation echo', async () => {
    const h = harness(); h.realtime.start();
    h.streams[0].failure(Object.assign(new Error('Synthetic disconnect'), { code: 'unavailable' }));
    assert.equal((await h.realtime.view()).status, 'offline');
    await delay(20); assert.equal(h.streams.length, 2);
    h.emit(); await h.realtime.session.chain; await delay(0);
    assert.equal((await h.realtime.view()).status, 'sincronizado');
    assert.equal(h.transport.sends, 0); h.realtime.stop();
});
test('a newer unconfirmed metadata event fences an older snapshot still awaiting IndexedDB', async () => {
    const h = harness(); h.realtime.start();
    let release; h.cache.gate = new Promise(resolve => { release = resolve; });
    h.emit({ oldConfirmed: true }); await delay(0);
    h.streams[0].receive({ type: 'waiting', reason: 'pending' });
    release(); await h.realtime.session.chain;
    assert.equal(h.cache.writes, 0);
    assert.equal((await h.realtime.view()).status, 'sincronizando');
    h.emit({ latestConfirmed: true }); await h.realtime.session.chain; await delay(0);
    assert.deepEqual((await h.realtime.view()).confirmed, { latestConfirmed: true });
    h.realtime.stop();
});
test('UID changes hide financial state immediately and terminal epochs preserve but conceal old cache', async () => {
    const h = harness(); h.realtime.start(); h.emit({ financial: true }); await h.realtime.session.chain;
    h.transport.uid = 'bob';
    assert.deepEqual((await h.realtime.view()).confirmed, {});
    h.realtime.stop(); h.transport.uid = 'alice'; h.realtime.start();
    h.streams.at(-1).failure(Object.assign(new Error('Retired epoch'), { code: 'epoch/inactive' }));
    await delay(0);
    assert.equal(h.cache.state.inactive, true);
    assert.deepEqual(h.cache.state.remote, { financial: true });
    assert.deepEqual((await h.realtime.view()).confirmed, {});
    const command = makeCommand({ uid: 'alice', epoch: 'e1', payload: {} });
    assert.throws(() => stageIntent(h.cache.state, command), { code: 'epoch/inactive' });
    h.realtime.stop();
});
