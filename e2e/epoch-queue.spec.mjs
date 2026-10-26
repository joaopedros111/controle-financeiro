import { test, expect, chromium } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
const project = 'demo-controle-financeiro';
const firestore = 'http://127.0.0.1:8080';
const auth = 'http://127.0.0.1:9099';
const root = `${firestore}/v1/projects/${project}/databases/(default)/documents`;
async function control(request, uid, epoch = 'e1') {
    const result = await request.patch(`${root}/users/${uid}/control/finance`, { headers: { Authorization: 'Bearer owner' }, data: {
        fields: { protocol: { integerValue: '1' }, activeEpoch: { stringValue: epoch }, status: { stringValue: 'active' } }
    } });
    expect(result.ok()).toBeTruthy();
}
async function account(request, name = 'alice') {
    const email = `${name}@local.test`;
    const result = await request.post(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only`, {
        data: { email, password: 'synthetic-password-only', returnSecureToken: true }
    });
    expect(result.ok()).toBeTruthy();
    const value = await result.json();
    await control(request, value.localId);
    return { email, uid: value.localId, idToken: value.idToken };
}
async function prepare(context) {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient'));
}
async function setup(page, user, epoch = 'e1') {
    await page.goto('/');
    await page.evaluate(async ({ user, epoch }) => {
        window.fixture = await import('/epoch-queue-fixture.js');
        await fixture.setup(user.email, user.uid, epoch);
    }, { user, epoch });
}
const stored = page => page.evaluate(() => qa.cache.read());
async function remote(request, uid, kind = 'records', epoch = 'e1') {
    const response = await request.get(`${root}/users/${uid}/financeEpochs/${epoch}/${kind}`, { headers: { Authorization: 'Bearer owner' } });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).documents || [];
}
test.beforeEach(async ({ request, context }) => {
    expect(process.env.LOCAL_TEST_EPOCH_BROWSER).toBe('1');
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    expect((await request.delete(`${firestore}/emulator/v1/projects/${project}/databases/(default)/documents`)).ok()).toBeTruthy();
    expect((await request.delete(`${auth}/emulator/v1/projects/${project}/accounts`)).ok()).toBeTruthy();
    await prepare(context);
});

test('offline intent and projection survive page close; reconnection sends once', async ({ context, page, request }) => {
    const user = await account(request); await setup(page, user);
    await context.setOffline(true);
    await page.evaluate(async () => { qa.worker.setOnline(false); await qa.cache.enqueue(fixture.command({ operationId: 'offline-op' })); await qa.worker.flush(); });
    expect(await page.evaluate(() => qa.worker.status())).toBe('offline');
    expect((await stored(page)).projection['records/record1'].payload.amountCents).toBe(100);
    await page.close();
    await context.setOffline(false);
    const reopened = await context.newPage(); await setup(reopened, user);
    expect((await stored(reopened)).operations[0].command.operationId).toBe('offline-op');
    expect(await pageIsPending(reopened)).toBe(true);
    await reopened.evaluate(() => qa.worker.flush());
    expect(await reopened.evaluate(() => qa.worker.status())).toBe('sincronizado');
    expect((await remote(request, user.uid)).length).toBe(1);
    expect((await remote(request, user.uid, 'operations')).length).toBe(1);
});
async function pageIsPending(page) { return page.evaluate(async () => (await qa.cache.read()).operations.some(item => item.status === 'pending')); }

test('remote commit before lost ACK is retried after reload without duplicate or extra revision', async ({ page, request }) => {
    const user = await account(request); await setup(page, user);
    await page.evaluate(async () => {
        await qa.cache.enqueue(fixture.command({ operationId: 'lost-ack' }));
        const commit = qa.transport.commit;
        qa.transport.commit = async c => { await commit(c); throw Object.assign(new Error('Synthetic connection lost after commit'), { code: 'unavailable' }); };
        await qa.worker.flush().catch(() => {});
    });
    expect(await pageIsPending(page)).toBe(true);
    expect((await remote(request, user.uid)).length).toBe(1);
    await setup(page, user);
    await page.evaluate(() => qa.worker.flush());
    const state = await stored(page);
    expect(state.operations[0].status).toBe('applied');
    expect(state.operations[0].result.duplicate).toBe(true);
    expect((await remote(request, user.uid))[0].fields.revision.integerValue).toBe('1');
    expect((await remote(request, user.uid, 'operations')).length).toBe(1);
});

test('two tabs share one durable queue and only one lease sends; enqueue during ACK is retained', async ({ context, page, request }) => {
    const user = await account(request); await setup(page, user);
    const other = await context.newPage(); await setup(other, user);
    await page.evaluate(async () => {
        await qa.cache.enqueue(fixture.command({ operationId: 'first' }));
        const commit = qa.transport.commit;
        window.gate = new Promise(resolve => window.release = resolve);
        qa.transport.commit = async c => { window.entered = true; await window.gate; return commit(c); };
        window.sending = qa.worker.flush();
    });
    await page.waitForFunction(() => window.entered);
    await other.evaluate(async () => {
        window.commits = 0;
        const commit = qa.transport.commit; qa.transport.commit = c => { window.commits++; return commit(c); };
        await qa.worker.flush();
        await qa.cache.enqueue(fixture.command({ entityId: 'record2', operationId: 'second' }));
    });
    expect(await other.evaluate(() => window.commits)).toBe(0);
    await page.evaluate(() => window.release());
    await page.evaluate(() => window.sending);
    expect((await stored(other)).operations.every(item => item.status === 'applied')).toBe(true);
    expect((await remote(request, user.uid)).length).toBe(2);
});

test('real browser process closure and reopen preserve the committed queue on disk', async ({ request }, testInfo) => {
    const user = await account(request);
    const profile = await mkdtemp(path.join(process.env.LOCAL_TEST_OUTPUT, 'epoch-profile-'));
    const launch = () => chromium.launchPersistentContext(profile, { channel: testInfo.project.use.channel, headless: true });
    let persistent = await launch();
    try {
        await prepare(persistent);
        let tab = persistent.pages()[0]; await setup(tab, user);
        await persistent.setOffline(true);
        await tab.evaluate(async () => { qa.worker.setOnline(false); await qa.cache.enqueue(fixture.command({ operationId: 'disk-pending' })); });
        await persistent.close();
        persistent = await launch(); await prepare(persistent);
        tab = persistent.pages()[0]; await setup(tab, user);
        const state = await stored(tab);
        expect(state.operations[0].command.operationId).toBe('disk-pending');
        expect(state.operations[0].status).toBe('pending');
        expect(state.projection['records/record1'].payload.amountCents).toBe(100);
        await tab.evaluate(() => qa.worker.flush());
        expect((await remote(request, user.uid)).length).toBe(1);
        expect((await remote(request, user.uid, 'operations')).length).toBe(1);
    } finally { await persistent.close(); }
});

test('expired lease is recovered by another tab; stale ACK cannot revert a newer server projection', async ({ context, page, request }) => {
    const user = await account(request); await setup(page, user);
    const other = await context.newPage(); await setup(other, user);
    await page.evaluate(async () => {
        qa.worker.deactivate(); qa.worker = new fixture.EpochQueueSync({ now: () => 1000, leaseMs: 100 }); qa.worker.activate(qa.cache, qa.transport);
        await qa.cache.enqueue(fixture.command({ operationId: 'expired' }));
        const commit = qa.transport.commit;
        qa.transport.commit = async c => { const result = await commit(c); window.entered = true; await new Promise(resolve => window.release = resolve); return result; };
        window.sending = qa.worker.flush();
    });
    await page.waitForFunction(() => window.entered);
    await other.evaluate(async () => {
        qa.worker.deactivate(); qa.worker = new fixture.EpochQueueSync({ now: () => 1200, leaseMs: 100 }); qa.worker.activate(qa.cache, qa.transport);
        await qa.worker.flush();
        await qa.cache.enqueue(fixture.command({ operationId: 'newer', baseRevision: 1,
            payload: { month: '2026-10', type: 'despesas', nome: 'Newer', amountCents: 222 } }));
        await qa.worker.flush();
    });
    await page.evaluate(async () => { window.release(); await window.sending; });
    const state = await stored(page);
    expect(state.operations.every(item => item.status === 'applied')).toBe(true);
    expect(state.projection['records/record1'].revision).toBe(2);
    expect(state.projection['records/record1'].payload.amountCents).toBe(222);
    expect((await remote(request, user.uid)).length).toBe(1);
    expect((await remote(request, user.uid, 'operations')).length).toBe(2);
});

test('UID switch while send is in flight preserves old queue and never sends the next old operation', async ({ page, request }) => {
    const alice = await account(request), bob = await account(request, 'bob'); await setup(page, alice);
    await page.evaluate(async bob => {
        await qa.cache.enqueue(fixture.command({ entityId: 'a1', operationId: 'a1' }));
        await qa.cache.enqueue(fixture.command({ entityId: 'a2', operationId: 'a2' }));
        window.oldCache = qa.cache;
        const commit = qa.transport.commit;
        qa.transport.commit = async c => { const result = await commit(c); window.entered = true; await new Promise(resolve => window.release = resolve); return result; };
        window.oldWorker = qa.worker; window.sending = qa.worker.flush();
        window.bob = bob;
    }, bob);
    await page.waitForFunction(() => window.entered);
    await page.evaluate(async () => {
        oldWorker.deactivate();
        await fixture.setup(bob.email, bob.uid);
        window.release(); await window.sending;
    });
    expect((await page.evaluate(() => oldCache.read())).operations.every(item => item.status === 'pending')).toBe(true);
    expect((await remote(request, alice.uid)).length).toBe(1);
    expect((await remote(request, bob.uid)).length).toBe(0);
    expect((await stored(page)).operations).toHaveLength(0);
});

test('epoch rotation preserves old pending commands and gives new generation an empty namespace', async ({ page, request }) => {
    const user = await account(request); await setup(page, user);
    await page.evaluate(() => qa.cache.enqueue(fixture.command({ operationId: 'old' })));
    await control(request, user.uid, 'e2');
    await page.evaluate(() => qa.worker.flush().catch(() => {}));
    expect(await page.evaluate(() => qa.worker.status())).toBe('erro');
    expect(await pageIsPending(page)).toBe(true);
    await setup(page, user, 'e2');
    expect((await stored(page)).operations).toHaveLength(0);
    await page.evaluate(async () => { await qa.cache.enqueue(fixture.command({ operationId: 'new' })); await qa.worker.flush(); });
    expect((await remote(request, user.uid, 'records', 'e1')).length).toBe(0);
    expect((await remote(request, user.uid, 'records', 'e2')).length).toBe(1);
});

test('independent devices: delete wins, delayed edit and dependent intents remain for review after reload', async ({ browser, context, page, request }) => {
    const user = await account(request); await setup(page, user);
    await page.evaluate(async () => { await qa.cache.enqueue(fixture.command()); await qa.worker.flush(); });
    const secondContext = await browser.newContext(); await prepare(secondContext);
    const second = await secondContext.newPage();
    try {
        await setup(second, user); await second.evaluate(() => qa.worker.flush());
        await second.evaluate(async () => {
            qa.worker.setOnline(false);
            await qa.cache.enqueue(fixture.command({ operationId: 'late', baseRevision: 1, payload: { month: '2026-10', type: 'despesas', nome: 'Late intention', amountCents: 999 } }));
            await qa.cache.enqueue(fixture.command({ operationId: 'dependent', baseRevision: 2, payload: { month: '2026-10', type: 'despesas', nome: 'Dependent intention', amountCents: 1000 } }));
        });
        await page.evaluate(async () => { await qa.cache.enqueue(fixture.command({ operationId: 'delete', action: 'delete', payload: {}, baseRevision: 1 })); await qa.worker.flush(); });
        await second.evaluate(async () => { qa.worker.setOnline(true); await qa.worker.flush(); });
        expect(await second.evaluate(() => qa.worker.status())).toBe('erro');
        await setup(second, user);
        const state = await stored(second);
        expect(state.operations[0].status).toBe('conflict');
        expect(state.operations[0].command.payload.amountCents).toBe(999);
        expect(state.operations[0].result.current.deleted).toBe(true);
        expect(state.operations[1].status).toBe('pending');
        expect(state.projection['records/record1'].conflict).toBe(true);
        await second.evaluate(() => qa.worker.flush());
        expect((await remote(request, user.uid))[0].fields.deleted.booleanValue).toBe(true);
        expect((await remote(request, user.uid, 'operations')).length).toBe(2);
    } finally { await secondContext.close(); }
});

test('concurrent device edits retain the exact rejected command across browser reload', async ({ browser, page, request }) => {
    const user = await account(request); await setup(page, user);
    await page.evaluate(async () => { await qa.cache.enqueue(fixture.command()); await qa.worker.flush(); });
    const secondContext = await browser.newContext(); await prepare(secondContext);
    const other = await secondContext.newPage();
    try {
        await setup(other, user); await other.evaluate(() => qa.worker.flush());
        const attempted = await other.evaluate(async () => {
            const c = fixture.command({ operationId: 'rejected-edit', baseRevision: 1,
                payload: { month: '2026-10', type: 'despesas', nome: 'Preserve this', amountCents: 9999 } });
            await qa.cache.enqueue(c); return c;
        });
        await page.evaluate(async () => {
            await qa.cache.enqueue(fixture.command({ operationId: 'winning-edit', baseRevision: 1,
                payload: { month: '2026-10', type: 'despesas', nome: 'Winner', amountCents: 2222 } }));
            await qa.worker.flush();
        });
        await other.evaluate(() => qa.worker.flush()); await setup(other, user);
        const rejected = (await stored(other)).operations[0];
        expect(rejected.status).toBe('conflict'); expect(rejected.command).toEqual(attempted);
        expect(rejected.result.current.payload.amountCents).toBe(2222);
        expect(await other.evaluate(() => qa.worker.status())).toBe('erro');
        expect((await remote(request, user.uid))[0].fields.payload.mapValue.fields.amountCents.integerValue).toBe('2222');
    } finally { await secondContext.close(); }
});

test('quota, aborted transaction and unavailable IndexedDB never declare saved; recovery succeeds', async ({ page, request }) => {
    const user = await account(request); await setup(page, user);
    const result = await page.evaluate(async () => {
        const before = await qa.cache.read();
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic full disk', 'QuotaExceededError'); };
        let quota;
        try { await qa.cache.enqueue(fixture.command({ operationId: 'quota' })); } catch (error) { quota = error.name; }
        finally { IDBObjectStore.prototype.put = put; }
        const status = await qa.worker.status(), after = await qa.cache.read();
        await qa.cache.recover();
        let abort;
        try { await qa.cache.mutate(state => { state.operations.push({ partial: true }); throw new DOMException('Synthetic abort', 'AbortError'); }); }
        catch (error) { abort = error.name; }
        await qa.cache.recover();
        let unavailable;
        try { await fixture.openEpochCache(qa.scope, { indexedDB: null }); } catch (error) { unavailable = error.code; }
        return { unchanged: JSON.stringify(before) === JSON.stringify(after), quota, abort, unavailable, status,
            partial: (await qa.cache.read()).operations.length };
    });
    expect(result).toEqual({ unchanged: true, quota: 'QuotaExceededError', abort: 'AbortError', unavailable: 'cache/unavailable', status: 'erro', partial: 0 });
    await page.evaluate(async () => { await qa.cache.enqueue(fixture.command({ operationId: 'recovered' })); await qa.worker.flush(); });
    expect(await page.evaluate(() => qa.worker.status())).toBe('sincronizado');
});

test('remote snapshots cannot enqueue, overwrite pending intent or cross project/UID/epoch', async ({ page, request }) => {
    const user = await account(request); await setup(page, user);
    const result = await page.evaluate(async () => {
        await qa.cache.enqueue(fixture.command({ operationId: 'pending' }));
        const snapshot = { scope: qa.scope, confirmed: true, complete: true, entities: [{ collection: 'records', entityId: 'record1',
            value: { payload: { month: '2026-10', type: 'despesas', nome: 'Remote', amountCents: 500 }, deleted: false, revision: 1, operationId: 'remote' } }] };
        await qa.cache.applyRemoteSnapshot(snapshot);
        let rejected = 0;
        for (const change of [{ projectId: 'demo-other' }, { uid: 'other' }, { epoch: 'e2' }]) {
            try { await qa.cache.applyRemoteSnapshot({ ...snapshot, scope: { ...qa.scope, ...change } }); } catch { rejected++; }
        }
        const state = await qa.cache.read();
        const isolated = await fixture.openEpochCache({ ...qa.scope, projectId: 'demo-other' });
        const empty = (await isolated.read()).operations.length; isolated.close();
        return { count: state.operations.length, value: state.projection['records/record1'].payload.amountCents, rejected, empty };
    });
    expect(result).toEqual({ count: 1, value: 100, rejected: 3, empty: 0 });
});

test('connectivity observer automatically flushes the offline queue after reconnect', async ({ context, page, request }) => {
    const user = await account(request); await setup(page, user);
    await page.evaluate(() => { window.disposeConnectivity = qa.worker.observeConnectivity(window); });
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => qa.worker.status())).toBe('offline');
    await page.evaluate(async () => { await qa.cache.enqueue(fixture.command({ operationId: 'auto-reconnect' })); await qa.worker.flush(); });
    expect(await pageIsPending(page)).toBe(true);
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => qa.worker.status())).toBe('sincronizado');
    expect((await remote(request, user.uid)).length).toBe(1);
    expect((await remote(request, user.uid, 'operations')).length).toBe(1);
    await page.evaluate(() => window.disposeConnectivity());
});

test('legacy localStorage and IndexedDB are neither imported nor modified', async ({ page, request }) => {
    const user = await account(request); await setup(page, user);
    const result = await page.evaluate(async () => {
        const legacyKey = `controleFinanceiro:v3:uid:${qa.scope.uid}`;
        const raw = JSON.stringify({ syntheticLegacy: true, amount: 999 });
        localStorage.setItem(legacyKey, raw);
        localStorage.setItem(`controleFinanceiro:sync:${qa.scope.uid}`, raw);
        const legacy = await new Promise((resolve, reject) => {
            const request = indexedDB.open('controleFinanceiro:integridade:v1', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('documents');
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const key = `fila:${qa.scope.uid}`;
        await new Promise((resolve, reject) => {
            const tx = legacy.transaction('documents', 'readwrite'); tx.objectStore('documents').put(raw, key);
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
        const fresh = await fixture.openEpochCache({ ...qa.scope, epoch: 'fresh-with-legacy' });
        const state = await fresh.read(); fresh.close();
        const legacyValue = await new Promise((resolve, reject) => {
            const tx = legacy.transaction('documents', 'readonly'), read = tx.objectStore('documents').get(key);
            read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
        });
        legacy.close();
        return { operations: state.operations.length, projection: Object.keys(state.projection).length,
            unchanged: legacyValue === raw && localStorage.getItem(legacyKey) === raw };
    });
    expect(result).toEqual({ operations: 0, projection: 0, unchanged: true });
});
