import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFirebaseSyncLifecycle } from '../experimental/firebase-sync-lifecycle-poc.js';
import { createVaultLifecycle } from '../experimental/finance-vault-lifecycle.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };

// Auth delivery is controlled at the client boundary; lifecycle transition rules stay real.
function fixture(t, consumer = () => undefined) {
    const users = ['A', 'B'].map(name => ({ uid: `synthetic-fault-${name}`, tenantId: null }));
    const auth = { app: { options: { projectId: 'demo-controle-financeiro' } },
        emulatorConfig: { host: '127.0.0.1', port: 9099 }, currentUser: null };
    const calls = { subscriptions: 0, cancellations: 0, logouts: 0, reloads: 0, tokens: 0 };
    const deliveries = [], faults = { identifyGate: null, identifyError: null, closeGate: null, closeError: null };
    let callback, stop, real;
    const source = {
        ready: async () => auth.currentUser,
        login: () => 'original-login-return',
        onUser(fn) { calls.subscriptions++; callback = fn; return () => { calls.cancellations++; }; },
        logout() { calls.logouts++; auth.currentUser = null; return Promise.resolve('original-logout-return'); }
    };
    const sdk = {
        async reload() { calls.reloads++; },
        async getIdTokenResult(user) { calls.tokens++; return { claims: { aud: 'demo-controle-financeiro', sub: user.uid, firebase: {} } }; }
    };
    const bridge = composeFirebaseSyncLifecycle({ client: source, auth, sdk,
        allowedUids: users.map(u => u.uid), createLifecycle(options) {
            real = createVaultLifecycle(options);
            return { ...real,
                identify(identity) {
                    if (faults.identifyError) return Promise.reject(faults.identifyError);
                    const result = real.identify(identity), gate = faults.identifyGate;
                    return gate ? result.then(() => gate.promise) : result;
                },
                close(reason) {
                    // Always perform the real synchronous fencing before injecting completion faults.
                    const result = real.close(reason), gate = faults.closeGate, error = faults.closeError;
                    if (error) return result.then(() => { throw error; });
                    return gate ? result.then(() => gate.promise) : result;
                }
            };
        } });
    stop = bridge.client.onUser(user => { deliveries.push(user?.uid ?? null); return consumer(user); });
    function emit(user) { auth.currentUser = user; return callback(user); }
    t.after(async () => {
        faults.identifyGate?.resolve(); faults.closeGate?.resolve();
        faults.identifyGate = faults.closeGate = faults.identifyError = faults.closeError = null;
        stop();
        await bridge.session.dispose();
    });
    function safe() {
        assert.equal(calls.subscriptions, 1);
        assert.equal(bridge.session.stats.adapterOpens, 0);
        assert.ok(bridge.session.states.every(s => s.data === null && s.inFlight === 0
            && !['unlocking', 'ready', 'operating'].includes(s.phase)));
    }
    return { bridge, auth, users, calls, deliveries, faults, emit, stop,
        get captured() { return callback; }, get lifecycle() { return real; }, safe,
        async initialize() { emit(null); await bridge.session.ready; },
        async identifyA() { emit(users[0]); await flush(); assert.equal(bridge.session.lifecycle.state().owner?.uid, users[0].uid); } };
}

test('composition preserves legacy return values and ordered delivery while real lifecycle completion is held', async t => {
    const sentinel = {}, h = fixture(t, () => sentinel);
    await h.initialize(); h.faults.identifyGate = deferred();
    assert.equal(h.emit(h.users[0]), sentinel); await flush();
    assert.equal(h.emit(h.users[1]), sentinel);
    assert.equal(h.emit(null), sentinel);
    assert.deepEqual(h.deliveries, [null, ...h.users.map(u => u.uid), null]);
    h.faults.identifyGate.resolve(); await flush();
    assert.equal(h.bridge.session.lifecycle.state().owner, null);
    assert.equal(h.bridge.session.stats.proofs, 0); h.safe();
});

test('lifecycle failure never replaces or blocks legacy delivery and leaves no confirmed authority', async t => {
    const sentinel = {}, h = fixture(t, () => sentinel);
    await h.initialize(); h.faults.identifyError = new Error('Synthetic lifecycle identify failure');
    assert.equal(h.emit(h.users[0]), sentinel); await flush();
    assert.equal(h.emit(h.users[1]), sentinel); await flush();
    assert.equal(h.emit(null), sentinel); await flush();
    assert.deepEqual(h.deliveries, [null, ...h.users.map(u => u.uid), null]);
    assert.equal(h.bridge.session.lifecycle.state().owner, null);
    assert.equal(h.bridge.session.stats.proofs, 0); h.safe();
});

test('consumer exception is propagated by identity while experimental session is fenced, without SDK logout', async t => {
    const sentinel = new Error('Synthetic legacy callback failure'); let fail = false;
    const h = fixture(t, () => { if (fail) throw sentinel; return 42; });
    await h.initialize(); await h.identifyA();
    h.faults.identifyGate = deferred();
    const proving = h.bridge.session.revalidate(); await flush();
    fail = true; assert.throws(() => h.emit(h.users[0]), error => error === sentinel);
    fail = false;
    assert.equal(h.emit(h.users[1]), 42); // Legacy subscription must survive its own failure.
    h.faults.identifyGate.resolve(); assert.equal(await proving, false); await flush();
    assert.equal(h.calls.logouts, 0);
    assert.equal(h.bridge.session.lifecycle.state().owner, null);
    assert.equal(h.bridge.session.stats.proofs, 0); h.safe();
});

test('cancelled subscription ignores captured and queued callbacks and unsubscribes exactly once', async t => {
    const h = fixture(t); await h.initialize();
    const captured = h.captured;
    h.emit(h.users[0]); // Microtask delivery is queued but not yet observed experimentally.
    h.stop(); h.stop();
    captured(h.users[1]); await flush();
    assert.deepEqual(h.deliveries, [null, h.users[0].uid]);
    assert.equal(h.calls.cancellations, 1);
    assert.equal(h.bridge.session.lifecycle.state().owner, null);
    assert.equal(h.bridge.session.stats.proofs, 0); h.safe();
});

test('logout in first legacy Auth delivery wins the experimental microtask queued for that user', async t => {
    let leaving, h;
    h = fixture(t, user => { if (user) leaving = h.bridge.client.logout(); });
    h.emit(h.users[0]);
    await leaving; await flush();
    assert.equal(h.calls.logouts, 1);
    assert.equal(h.auth.currentUser, null);
    assert.equal(h.bridge.session.lifecycle.state().owner, null);
    assert.equal(h.bridge.session.stats.proofs, 0); h.safe();
});

for (const failure of ['held', 'rejected']) test(`legacy SDK signOut proceeds when lifecycle close completion is ${failure}`, async t => {
    const h = fixture(t); await h.initialize(); await h.identifyA();
    if (failure === 'held') h.faults.closeGate = deferred();
    else h.faults.closeError = new Error('Synthetic lifecycle close failure');
    const leaving = h.bridge.client.logout();
    await flush();
    assert.equal(h.calls.logouts, 1, 'Lifecycle completion must not delay the legacy SDK command');
    assert.equal(h.auth.currentUser, null);
    h.faults.closeGate?.resolve(); await leaving; await flush();
    assert.equal(h.bridge.session.lifecycle.state().owner, null);
    assert.equal(h.bridge.session.stats.proofs, 0); h.safe();
});

test('cancelling during retained real lifecycle validation never confirms the old context', async t => {
    const h = fixture(t); await h.initialize(); await h.identifyA();
    h.faults.identifyGate = deferred();
    const proving = h.bridge.session.revalidate(); await flush();
    h.stop(); h.faults.identifyGate.resolve();
    assert.equal(await proving, false); await flush();
    assert.equal(h.calls.cancellations, 1);
    assert.equal(h.calls.tokens, 0);
    assert.equal(h.bridge.session.lifecycle.state().owner, null);
    assert.equal(h.bridge.session.stats.proofs, 0); h.safe();
});
