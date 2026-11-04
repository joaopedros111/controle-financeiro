import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, create, income, queue, accounts, password, deferred } from './fixtures/vault-composition-cases.mjs';
import { createRealVaultAdapter } from '../experimental/finance-vault-real-adapter.js';
test('composition: serialized SDK auth intents fence old results and final SDK owner matches the lifecycle owner', async () => {
    const h = await setup(); let release; try {
        await create(h); await income(h.c); const before = (await h.c.snapshot()).documents;
        const gate = h.holdAuth(); release = gate.release.resolve;
        const first = h.c.login(accounts[0]).then(() => null, e => e.code); await gate.entered.promise;
        const last = h.c.login(accounts[1]); assert.equal(h.c.view().data, null); await assert.rejects(h.c.unlock(password));
        release(); assert.equal(await first, 'composition/stale-session'); await last;
        assert.equal((await h.client.ready()).uid, accounts[1]); assert.equal(h.c.lifecycleState().owner.uid, accounts[1]);
        await h.c.login(accounts[0]); await h.c.unlock(password); assert.deepEqual((await h.c.snapshot()).documents, before);
    } finally { release?.(); await h.c.shutdown(); }
});
test('composition: confirmed enrollment, independent recovery, custody, explicit unlock and no blank fallback', async () => {
    const h = await setup(); try {
        assert.equal(h.c.view().phase, 'signed-out'); await h.c.login(accounts[0]); assert.equal(h.c.view().phase, 'missing'); await assert.rejects(h.c.snapshot());
        const secret = await h.c.create(password); assert.equal(h.c.view().phase, 'custody'); assert.equal(h.c.view().data, null); await assert.rejects(income(h.c));
        await assert.rejects(h.c.confirm(secret, false, password)); await h.c.confirm(secret, true, password); await income(h.c); const before = await h.c.snapshot();
        await h.c.lock(); assert.equal(h.c.view().data, null); await assert.rejects(h.c.unlock('synthetic-wrong-password')); assert.equal(h.c.view().data, null);
        await h.c.recover(secret); assert.deepEqual((await h.c.snapshot()).documents, before.documents); assert.ok(h.stores.size >= 3);
    } finally { await h.c.shutdown(); }
});
test('composition: logout drains local write and denies new work before Auth signout', async () => {
    const h = await setup(); try {
        await create(h); const gate = h.holdWrite(), write = income(h.c); await gate.entered.promise;
        const logout = h.c.logout(); assert.equal(h.c.view().phase, 'closing'); assert.equal(h.c.view().data, null); await assert.rejects(income(h.c, 'synthetic-too-late'));
        gate.release.resolve(); assert.equal((await write).durable, true); await logout; assert.equal(h.c.view().phase, 'signed-out');
        await h.c.login(accounts[0]); await h.c.unlock(password); assert.equal((await queue(h.c)).outbox.length, 1);
    } finally { await h.c.shutdown(); }
});
test('CP-01: pending precedes local commit and an earlier global ACK cannot turn an in-flight command green', async () => {
    const h = await setup(); try {
        h.connectivity.navigator.onLine = true; await create(h);
        for (let i = 0; i < 100 && h.c.view().sync !== 'synced'; i++) await new Promise(r => setTimeout(r, 50));
        assert.equal(h.c.view().sync, 'synced'); const gate = h.holdWrite(), write = income(h.c);
        assert.notEqual(h.c.view().sync, 'synced'); await gate.entered.promise; const refreshing = h.c.refresh(); assert.notEqual(h.c.view().sync, 'synced');
        gate.release.resolve(); await write; await refreshing;
        for (let i = 0; i < 100 && h.c.view().sync !== 'synced'; i++) await new Promise(r => setTimeout(r, 50));
        assert.equal((await queue(h.c)).outbox.length, 0); assert.equal(h.c.view().sync, 'synced');
    } finally { await h.c.shutdown(); }
});
test('composition: A-B-A, same UID reauthentication and explicit offline owner preserve exact queue', async () => {
    const h = await setup(); try {
        await create(h); await income(h.c); const before = (await h.c.snapshot()).documents;
        await create(h, accounts[1]); assert.equal((await queue(h.c)).outbox.length, 0);
        await h.c.login(accounts[0]); assert.equal(h.c.view().data, null); await h.c.unlock(password); assert.deepEqual((await h.c.snapshot()).documents, before);
        await h.c.login(accounts[0]); assert.equal(h.c.view().phase, 'locked'); assert.equal(h.c.view().data, null);
        await h.c.offline(accounts[0]); await h.c.unlock(password); assert.equal(h.c.lifecycleState().ownership, 'unconfirmed'); await assert.rejects(h.c.synchronize()); assert.deepEqual((await h.c.snapshot()).documents, before);
    } finally { await h.c.shutdown(); }
});
test('composition: unavailable Auth never becomes empty finance; explicit offline reopens then network reauthentication reaches real sync ACK', async () => {
    const h = await setup(); try {
        await create(h); await income(h.c); const before = (await h.c.snapshot()).documents; await h.c.logout(); h.failAuth(true);
        await assert.rejects(h.c.login(accounts[0])); assert.equal(h.c.view().phase, 'error'); assert.equal(h.c.view().data, null);
        await h.c.offline(accounts[0]); await h.c.unlock(password); assert.deepEqual((await h.c.snapshot()).documents, before);
        h.failAuth(false); h.connectivity.navigator.onLine = true; await h.c.login(accounts[0]); await h.c.unlock(password); await h.c.synchronize();
        for (let i = 0; i < 100 && h.c.view().sync !== 'synced'; i++) await new Promise(r => setTimeout(r, 50));
        assert.equal((await queue(h.c)).outbox.length, 0); assert.equal(h.c.view().sync, 'synced');
    } finally { await h.c.shutdown(); }
});
test('composition: real automatic sync late ACK cannot confirm reopened lifecycle session', async () => {
    const h = await setup(); let release; try {
        await create(h); await income(h.c); h.connectivity.navigator.onLine = true;
        // Existing controller observed offline at start; explicit run can be requested
        // after a fresh confirmed opening with the new connectivity.
        await h.c.lock(); const entered = deferred(), gate = deferred(); release = gate.resolve;
        const original = h.client.commit; h.client.commit = async (...args) => { const result = await original(...args); entered.resolve(); await gate.promise; return result; };
        await h.c.unlock(password); const syncing = h.c.synchronize().catch(e => e.code); await entered.promise;
        await h.c.logout(); await h.c.login(accounts[0]); h.connectivity.navigator.onLine = false; await h.c.unlock(password); const q = await queue(h.c);
        assert.equal(q.outbox.length, 1); release(); await syncing; assert.deepEqual((await queue(h.c)).outbox, q.outbox);
    } finally { release?.(); await h.c.shutdown(); }
});
test('composition: recovery and offline reopen retain tombstones, conflicts and transitive archived queue exactly', async () => {
    const h = await setup(); try {
        const secret = await create(h); await income(h.c); await h.c.edit(s => { s.meses['2026-11'].receitas = []; }); await h.c.lock();
        const selected = { projectId: 'demo-vault-integration', uid: accounts[0] }, storage = [...h.stores.values()][0];
        const adapter = createRealVaultAdapter({ store: storage.store, owner: selected });
        try {
            const lease = await adapter.unlock(password), key = `snapshot:${selected.uid}:synthetic-retained`, queueKey = `fila:${selected.uid}`;
            await lease.db.alterarDocumentos([queueKey, key], docs => { const q = docs.get(queueKey), previous = structuredClone(q);
                q.conflicts.push({ id: 'synthetic-preserved-conflict', kind: 'synthetic-preserved' }); q.recoveryKeys.push(key);
                docs.set(queueKey, q); docs.set(key, { queue: previous, reason: 'synthetic-preservation-test' }); return docs;
            });
            await adapter.lock();
        } finally { adapter.close(); }
        await h.c.unlock(password); const before = (await h.c.snapshot()).documents;
        assert.ok(before[`fila:${selected.uid}`].outbox.some(op => op.value.deleted)); assert.equal(before[`fila:${selected.uid}`].conflicts.length, 1);
        await h.c.lock(); await h.c.recover(secret); assert.deepEqual((await h.c.snapshot()).documents, before);
        await h.c.logout(); await h.c.offline(selected.uid); await h.c.unlock(password); assert.deepEqual((await h.c.snapshot()).documents, before);
    } finally { await h.c.shutdown(); }
});
test('composition: rejected remote operation remains durable and a polling refresh cannot erase the recoverable error', async () => {
    const h = await setup(); try {
        await create(h); await income(h.c); const before = await queue(h.c); await h.client.list(accounts[0]);
        h.remotes.get(accounts[0]).remote.failNext('permission-denied'); await h.c.lock(); h.connectivity.navigator.onLine = true; await h.c.unlock(password);
        for (let i = 0; i < 100 && h.c.view().phase !== 'error'; i++) await new Promise(r => setTimeout(r, 50));
        assert.equal(h.c.view().phase, 'error'); await h.c.refresh(); assert.equal(h.c.view().phase, 'error'); assert.deepEqual((await queue(h.c)).outbox, before.outbox);
        await h.c.login(accounts[0]); await h.c.unlock(password);
        for (let i = 0; i < 100 && h.c.view().sync !== 'synced'; i++) await new Promise(r => setTimeout(r, 50));
        assert.equal(h.c.view().sync, 'synced'); assert.equal((await queue(h.c)).outbox.length, 0);
    } finally { await h.c.shutdown(); }
});
