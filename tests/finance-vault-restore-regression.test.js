import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestoreProbe } from './fixtures/vault-restore-probe.mjs';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { realContractClient } from './fixtures/vault-real-client.mjs';
for (const point of ['old-read', 'committed-before-delivery']) test(`restore regression (${point}): stale diagnostic polling is rejected; exact durable state/queue recover and publish`, async () => {
    const uid = 'synthetic-integrated-restore-node', projectId = 'demo-vault-integration', backend = realContractClient({ projectId, uid });
    let user = null; const subscribers = new Set(), stores = new Map();
    const client = Object.assign(backend.client, { ready: async () => user, onUser(fn) { subscribers.add(fn); queueMicrotask(() => { if (subscribers.has(fn)) fn(user); }); return () => subscribers.delete(fn); } });
    const config = { experimentalVault: true, projectId, authEmulator: 'http://127.0.0.1:9099', firestoreEmulator: 'http://127.0.0.1:8080', databaseName: 'controleFinanceiro:cofre-isolado:v1:synthetic-integrated-restore-node', accounts: [uid] };
    const connectivity = { navigator: { onLine: false }, addEventListener() {}, removeEventListener() {} };
    const probe = await createRestoreProbe({ config, client, connectivity, auth: {
        async login(uid) { user = { uid }; for (const fn of subscribers) fn(user); return user; }, logout: async () => { user = null; for (const fn of subscribers) fn(null); }
    }, makeStore: async name => { if (!stores.has(name)) stores.set(name, memoryVaultFactory()); return stores.get(name).store; } });
    try { await probe.prepare(); const result = await (point === 'old-read' ? probe.reproduce() : probe.reproduceAtCommit()); assert.equal(result.rejected.code, 'cancelled');
        if (point === 'old-read') assert.ok(result.events.findIndex(e => e.event === 'restore-settled') < result.events.findIndex(e => e.event === 'old-read-settled'));
        connectivity.navigator.onLine = true; await probe.reopenAndPublish(result);
    } finally { await probe.close(); }
});
