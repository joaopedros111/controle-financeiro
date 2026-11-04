import test from 'node:test';
import assert from 'node:assert/strict';
import { criarFirebaseSync } from '../firebase-sync-entry.js';
function fixture() {
    const calls = [], app = {}, db = {}, auth = { currentUser: null, authStateReady: async () => { calls.push('ready'); } };
    const runtime = {
        createApp(config) { calls.push('app'); assert.equal(config.projectId, 'demo-injection'); return app; },
        checkAuthPersistence() { calls.push('probe'); },
        createAuth(value, options) { calls.push('auth'); assert.equal(value, app); assert.equal(options.persistence.length, 3); assert.ok(options.popupRedirectResolver); return auth; },
        createFirestore(value) { calls.push('firestore'); assert.equal(value, app); return db; },
        async getRedirectResult(value) { calls.push('redirect'); assert.equal(value, auth); return null; }
    };
    return { calls, runtime };
}
test('official Firebase runtime injects only SDK construction and keeps ready ordering', async () => {
    const h = fixture(), client = criarFirebaseSync({ projectId: 'demo-injection' }, h.runtime);
    assert.deepEqual(h.calls, ['app', 'probe', 'auth', 'firestore']); await client.ready();
    assert.deepEqual(h.calls, ['app', 'probe', 'auth', 'firestore', 'ready', 'probe', 'redirect']); assert.equal(client.protocolVersion, 2);
});
test('explicit Firebase runtime errors propagate without initializing a default replacement', () => {
    for (const failure of ['createApp', 'checkAuthPersistence', 'createAuth', 'createFirestore']) {
        const h = fixture(); h.runtime[failure] = () => { h.calls.push('failure'); throw new Error('Synthetic initialization failure'); };
        assert.throws(() => criarFirebaseSync({ projectId: 'demo-injection' }, h.runtime), /Synthetic initialization failure/);
        assert.equal(h.calls.at(-1), 'failure');
    }
});
test('unknown or malformed Firebase runtime is rejected before any SDK initialization', () => {
    for (const runtime of [null, [], false, { vaultEnabled: true }, { createFirestore: null }]) assert.throws(() => criarFirebaseSync({ projectId: 'demo-injection' }, runtime), /Runtime Firebase inválido/);
});
