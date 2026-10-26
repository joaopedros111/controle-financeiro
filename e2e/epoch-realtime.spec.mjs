import { test, expect, chromium } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';

const project = 'demo-controle-financeiro';
const firestore = 'http://127.0.0.1:8080', auth = 'http://127.0.0.1:9099';
const root = `${firestore}/v1/projects/${project}/databases/(default)/documents`;
let secondary = [];
async function control(request, uid, epoch = 'e1') {
    const result = await request.patch(`${root}/users/${uid}/control/finance`, {
        headers: { Authorization: 'Bearer owner' }, data: { fields: { protocol: { integerValue: '1' },
            activeEpoch: { stringValue: epoch }, status: { stringValue: 'active' } } }
    });
    expect(result.ok()).toBeTruthy();
}
async function account(request, name = 'alice') {
    const email = `${name}@local.test`;
    const result = await request.post(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only`, {
        data: { email, password: 'synthetic-password-only', returnSecureToken: true }
    });
    expect(result.ok()).toBeTruthy();
    const user = { email, uid: (await result.json()).localId };
    await control(request, user.uid); return user;
}
async function prepare(context) {
    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
        return route.continue();
    });
}
async function setup(page, user, epoch = 'e1', options = {}) {
    await page.goto('/');
    await initialize(page, user, epoch, options);
}
async function initialize(page, user, epoch = 'e1', options = {}) {
    await page.evaluate(async ({ user, epoch, options }) => {
        window.fixture = await import('/epoch-queue-fixture.js');
        await fixture.setup(user.email, user.uid, epoch, 'demo-controle-financeiro', options);
        window.starts = 0; window.activeStreams = 0;
        const listen = qa.transport.listen;
        qa.transport.listen = (receive, failure) => {
            window.starts++; window.activeStreams++;
            window.lastReceive = receive; window.lastFailure = failure;
            const stop = listen(receive, failure); let stopped = false;
            return () => { if (!stopped) { stopped = true; window.activeStreams--; stop(); } };
        };
        qa.rt = new fixture.EpochRealtimeSync(qa.cache, qa.transport, { retryMs: 30 });
        qa.rt.start();
    }, { user, epoch, options });
}
const view = page => page.evaluate(() => qa.rt.view());
const stored = page => page.evaluate(() => qa.cache.read());
const ready = page => expect.poll(async () => (await view(page)).status).toBe('sincronizado');
async function put(page, extra = {}) {
    return page.evaluate(async extra => { const c = fixture.command(extra); await qa.rt.enqueue(c); return c; }, extra);
}
async function remote(request, uid, kind = 'records', epoch = 'e1') {
    const result = await request.get(`${root}/users/${uid}/financeEpochs/${epoch}/${kind}`, { headers: { Authorization: 'Bearer owner' } });
    expect(result.ok()).toBeTruthy(); return (await result.json()).documents || [];
}
async function pair(page, context, request, testInfo) {
    const user = await account(request); await setup(page, user); await ready(page);
    const channel = testInfo.project.use.channel === 'msedge' ? 'chrome' : 'msedge';
    const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel } : {}) });
    secondary.push(browser);
    const otherContext = await browser.newContext({ baseURL: process.env.LOCAL_TEST_BASE_URL });
    await prepare(otherContext); const other = await otherContext.newPage(); await setup(other, user); await ready(other);
    return { user, other, otherContext, context };
}
test.beforeEach(async ({ request, context }) => {
    expect(process.env.LOCAL_TEST_EPOCH_REALTIME).toBe('1');
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    expect((await request.delete(`${firestore}/emulator/v1/projects/${project}/databases/(default)/documents`)).ok()).toBeTruthy();
    expect((await request.delete(`${auth}/emulator/v1/projects/${project}/accounts`)).ok()).toBeTruthy();
    secondary = []; await prepare(context);
});
test.afterEach(async ({ page }, info) => {
    if (info.status !== info.expectedStatus) {
        await info.attach('realtime-state', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(async () => ({
            view: await qa.rt.view(), cache: await qa.cache.read(), starts: window.starts,
            sessionError: qa.rt.session?.error?.message, cacheError: qa.cache.error?.message
        })).catch(() => ({ pageClosed: true })), null, 2) });
    }
    for (const browser of secondary) await browser.close().catch(() => {});
});

test('A creates, B edits, A deletes: both independent browsers converge without reload or echo', async ({ page, context, request }, info) => {
    const { user, other } = await pair(page, context, request, info);
    await put(page, { operationId: 'create' });
    await expect.poll(async () => (await view(other)).confirmed['records/record1']?.payload.amountCents).toBe(100);
    expect((await stored(other)).operations).toHaveLength(0);
    await ready(page);
    await put(other, { operationId: 'edit', baseRevision: 1,
        payload: { month: '2026-10', type: 'despesas', nome: 'Edited on B', amountCents: 222 } });
    await expect.poll(async () => (await view(page)).confirmed['records/record1']?.payload.amountCents).toBe(222);
    await ready(other);
    await page.evaluate(() => window.lastReceive({ type: 'snapshot', snapshot: { scope: qa.scope,
        confirmed: true, complete: true, entities: [{ collection: 'records', entityId: 'record1', value: {
            payload: { month: '2026-10', type: 'despesas', nome: 'Synthetic', amountCents: 100 },
            deleted: false, revision: 1, operationId: 'create'
        } }] } }));
    await expect.poll(async () => (await view(page)).confirmed['records/record1']?.revision).toBe(2);
    await put(page, { operationId: 'delete', baseRevision: 2, action: 'delete', payload: {} });
    await expect.poll(async () => (await view(other)).confirmed['records/record1']?.deleted).toBe(true);
    await ready(page); await ready(other);
    expect((await view(page)).confirmed).toEqual((await view(other)).confirmed);
    expect((await remote(request, user.uid, 'operations'))).toHaveLength(3);
    await other.evaluate(() => { qa.rt.restartListeners(); qa.rt.start(); qa.rt.start(); });
    await ready(other);
    expect((await view(other)).optimistic['records/record1'].deleted).toBe(true);
    expect(await other.evaluate(() => window.activeStreams)).toBe(1);
    expect((await remote(request, user.uid, 'operations'))).toHaveLength(3);
});

test('simultaneous different records converge and remote snapshots create no extra operations', async ({ page, context, request }, info) => {
    const { user, other } = await pair(page, context, request, info);
    await Promise.all([put(page, { entityId: 'from-a', operationId: 'from-a' }), put(other, { entityId: 'from-b', operationId: 'from-b' })]);
    await expect.poll(async () => Object.keys((await view(page)).confirmed).length).toBe(2);
    await expect.poll(async () => Object.keys((await view(other)).confirmed).length).toBe(2);
    await ready(page); await ready(other);
    expect((await view(page)).confirmed).toEqual((await view(other)).confirmed);
    expect((await stored(page)).operations).toHaveLength(1);
    expect((await stored(other)).operations).toHaveLength(1);
    expect((await remote(request, user.uid, 'operations'))).toHaveLength(2);
});

test('same-record concurrent edits converge canonically and preserve the losing local intention', async ({ page, context, request }, info) => {
    const { user, other, otherContext } = await pair(page, context, request, info);
    await put(page, { operationId: 'initial' }); await ready(page);
    await expect.poll(async () => (await view(other)).confirmed['records/record1']?.revision).toBe(1);
    await Promise.all([context.setOffline(true), otherContext.setOffline(true)]);
    await expect.poll(async () => (await view(page)).status).toBe('offline');
    const a = await put(page, { operationId: 'a-edit', baseRevision: 1, payload: { month: '2026-10', type: 'despesas', nome: 'A edit', amountCents: 200 } });
    const b = await put(other, { operationId: 'b-edit', baseRevision: 1, payload: { month: '2026-10', type: 'despesas', nome: 'B edit', amountCents: 300 } });
    await context.setOffline(false); await ready(page);
    await otherContext.setOffline(false);
    await expect.poll(async () => (await view(other)).status).toBe('erro');
    const rejected = (await view(other)).conflicts[0];
    expect(rejected.command).toEqual(b);
    expect((await view(other)).optimistic['records/record1'].payload.amountCents).toBe(300);
    expect((await view(other)).optimistic['records/record1'].conflict).toBe(true);
    expect((await view(other)).confirmed['records/record1'].payload.amountCents).toBe(200);
    expect((await view(page)).confirmed).toEqual((await view(other)).confirmed);
    expect(a.entityId).toBe(b.entityId);
    expect((await remote(request, user.uid, 'operations'))).toHaveLength(2);
    await put(other, { entityId: 'unrelated', operationId: 'unrelated' });
    await expect.poll(async () => (await view(page)).confirmed['records/unrelated']?.revision).toBe(1);
    expect((await view(other)).conflicts[0].command).toEqual(b);
    expect((await remote(request, user.uid, 'operations'))).toHaveLength(3);
});

test('listener restart during remote ACK and repeated ACK never duplicate a record', async ({ page, context, request }, info) => {
    const { user, other } = await pair(page, context, request, info);
    await page.evaluate(() => {
        const commit = qa.transport.commit;
        window.originalCommit = commit;
        qa.transport.commit = async c => { const result = await commit(c); window.entered = true; await new Promise(resolve => window.release = resolve); return result; };
    });
    const original = await put(page, { operationId: 'restart-ack' });
    await page.waitForFunction(() => window.entered);
    await expect.poll(async () => (await view(other)).confirmed['records/record1']?.revision).toBe(1);
    await page.evaluate(() => { qa.rt.restartListeners(); qa.rt.start(); });
    await page.evaluate(() => { qa.transport.commit = window.originalCommit; window.release(); });
    await ready(page);
    // Replay the actual server commit and its local ACK under a valid lease.
    await page.evaluate(async command => {
        const result = await qa.transport.commit(command);
        await qa.cache.acquireLease('repeat-ack', Date.now(), 30000);
        await qa.cache.acknowledge(command, result, 'repeat-ack', Date.now());
        await qa.cache.acknowledge(command, result, 'repeat-ack', Date.now());
        await qa.cache.releaseLease('repeat-ack');
    }, original);
    expect((await remote(request, user.uid))).toHaveLength(1);
    expect((await remote(request, user.uid, 'operations'))).toHaveLength(1);
    expect((await stored(page)).operations).toHaveLength(1);
    expect((await view(page)).confirmed).toEqual((await view(other)).confirmed);
    expect(await page.evaluate(() => window.activeStreams)).toBe(1);
});

test('recoverable listener interruption resubscribes automatically and catches remote changes', async ({ page, context, request }, info) => {
    const { user, other } = await pair(page, context, request, info);
    await other.evaluate(() => window.lastFailure(Object.assign(new Error('Synthetic stream interruption'), { code: 'unavailable' })));
    await put(page, { operationId: 'after-interruption' });
    await expect.poll(async () => (await view(other)).confirmed['records/record1']?.revision).toBe(1);
    await ready(other);
    expect(await other.evaluate(() => window.starts)).toBe(2);
    expect(await other.evaluate(() => window.activeStreams)).toBe(1);
    expect((await stored(other)).operations).toHaveLength(0);
    expect((await remote(request, user.uid, 'operations'))).toHaveLength(1);
});

test('UID signout/switch hides old data and stops old callbacks before a new account starts', async ({ page, context, request }, info) => {
    const { user, other } = await pair(page, context, request, info);
    const bob = await account(request, 'bob');
    await put(page); await expect.poll(async () => (await view(other)).confirmed['records/record1']?.revision).toBe(1);
    const empty = await other.evaluate(async () => {
        window.oldRealtime = qa.rt; window.oldReceive = window.lastReceive;
        await fixture.signOut(qa.auth); return oldRealtime.view();
    });
    expect(empty.status).toBe('erro'); expect(empty.confirmed).toEqual({});
    await other.evaluate(async bob => {
        oldRealtime.stop(); await fixture.setup(bob.email, bob.uid);
        qa.rt = new fixture.EpochRealtimeSync(qa.cache, qa.transport); qa.rt.start();
        oldReceive({ type: 'snapshot', snapshot: { scope: qa.scope, entities: [], confirmed: true, complete: true } });
    }, bob);
    await ready(other);
    expect((await view(other)).confirmed).toEqual({});
    expect((await remote(request, bob.uid))).toHaveLength(0);
    expect((await remote(request, user.uid))).toHaveLength(1);
});

test('generation rotation conceals old cache, preserves pending commands and blocks late publication', async ({ page, context, request }, info) => {
    const { user, other, otherContext } = await pair(page, context, request, info);
    await put(page, { operationId: 'old-confirmed' }); await ready(page);
    await expect.poll(async () => (await view(other)).confirmed['records/record1']?.revision).toBe(1);
    await otherContext.setOffline(true);
    await put(other, { operationId: 'old-pending', entityId: 'old-pending' });
    await control(request, user.uid, 'e2');
    await expect.poll(async () => (await view(page)).status).toBe('erro');
    expect((await view(page)).confirmed).toEqual({});
    await otherContext.setOffline(false);
    await expect.poll(async () => (await view(other)).status).toBe('erro');
    expect((await view(other)).optimistic).toEqual({});
    expect((await stored(other)).operations.find(item => item.command.operationId === 'old-pending').status).toBe('pending');
    await expect.poll(async () => (await stored(other)).inactive).toBe(true);
    expect((await remote(request, user.uid, 'records', 'e1'))).toHaveLength(1);
    const failed = await other.evaluate(async () => { try { await qa.rt.enqueue(fixture.command({ entityId: 'late' })); return false; } catch { return true; } });
    expect(failed).toBe(true);
    await setup(page, user, 'e2'); await setup(other, user, 'e2'); await ready(page); await ready(other);
    expect((await view(page)).confirmed).toEqual({}); expect((await view(other)).confirmed).toEqual({});
    await put(page, { entityId: 'new-epoch', operationId: 'new-epoch' });
    await expect.poll(async () => (await view(other)).confirmed['records/new-epoch']?.revision).toBe(1);
    expect((await view(other)).confirmed['records/record1']).toBeUndefined();
});

test('categories, budgets, installments and finance settings replicate bidirectionally', async ({ page, context, request }, info) => {
    const { other } = await pair(page, context, request, info);
    await put(page, { collection: 'categories', entityId: 'home', payload: { name: 'Casa personalizada' } });
    await expect.poll(async () => (await view(other)).confirmed['categories/home']?.payload.name).toBe('Casa personalizada');
    await put(other, { collection: 'budgets', entityId: 'home-default', payload: { categoryId: 'home', amountCents: 50000 } });
    await expect.poll(async () => (await view(page)).confirmed['budgets/home-default']?.payload.amountCents).toBe(50000);
    await put(page, { payload: { month: '2026-10', type: 'despesas', nome: 'Parcela', amountCents: 1234,
        categoryId: 'home', paid: false, fixed: false, seriesId: 'series-1', installment: { current: 1, total: 12 } } });
    await put(other, { collection: 'settings', entityId: 'finance', payload: { currency: 'USD' } });
    await expect.poll(async () => (await view(other)).confirmed['records/record1']?.payload.installment).toEqual({ current: 1, total: 12 });
    await expect.poll(async () => (await view(page)).confirmed['settings/finance']?.payload.currency).toBe('USD');
    await ready(page); await ready(other);
    expect((await view(page)).confirmed).toEqual((await view(other)).confirmed);
});

test('offline edit survives full browser restart, reconnects and converges automatically', async ({ page, context, request }, info) => {
    const user = await account(request); await setup(page, user); await ready(page);
    await put(page, { operationId: 'initial' }); await ready(page);
    const profile = await mkdtemp(path.join(process.env.LOCAL_TEST_OUTPUT, 'realtime-offline-profile-'));
    const channel = info.project.use.channel === 'msedge' ? 'chrome' : 'msedge';
    const launch = () => chromium.launchPersistentContext(profile, { headless: true, baseURL: process.env.LOCAL_TEST_BASE_URL,
        ...(process.platform === 'win32' ? { channel } : {}) });
    let persistent = await launch();
    try {
        await prepare(persistent); let b = persistent.pages()[0];
        const appName = `durable-realtime-${user.uid}`;
        await setup(b, user, 'e1', { appName }); await ready(b);
        await persistent.setOffline(true);
        await put(b, { operationId: 'offline-edit', baseRevision: 1, payload: { month: '2026-10', type: 'despesas', nome: 'Offline durable', amountCents: 888 } });
        expect((await view(b)).confirmed['records/record1'].payload.amountCents).toBe(100);
        expect((await view(b)).optimistic['records/record1'].payload.amountCents).toBe(888);
        await persistent.close(); persistent = await launch();
        await prepare(persistent); b = persistent.pages()[0];
        // Load only static QA assets. Auth, cache and realtime restart below OFFLINE.
        await b.goto('/'); await b.evaluate(async () => { window.fixture = await import('/epoch-queue-fixture.js'); });
        await persistent.setOffline(true);
        await initialize(b, user, 'e1', { appName, restoreOnly: true });
        expect((await view(b)).status).toBe('offline');
        expect((await stored(b)).operations[0].command.operationId).toBe('offline-edit');
        await persistent.setOffline(false);
        await expect.poll(async () => (await view(page)).confirmed['records/record1']?.payload.amountCents).toBe(888);
        await ready(b); await ready(page);
        expect((await view(page)).confirmed).toEqual((await view(b)).confirmed);
        expect((await remote(request, user.uid, 'operations'))).toHaveLength(2);
    } finally { await persistent.close(); }
});
