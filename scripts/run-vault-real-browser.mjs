import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { realContractClient } from '../tests/fixtures/vault-real-client.mjs';
import { owner } from '../tests/fixtures/vault-real-scenarios.mjs';
const backend = realContractClient(owner);
const bundle = await build({ entryPoints: ['tests/fixtures/vault-real-browser.mjs'], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
const methods = new Set(['list', 'getSettings', 'listConflicts', 'commit', 'saveSettings', 'saveAutomaticHistory', 'resolveConflict', 'generationSnapshot', 'generationMarker', 'listAutomaticHistory']);
const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Synthetic real adapters</title>');
    if (req.url === '/fixture.js') return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].contents);
    if (req.url !== '/rpc' || req.method !== 'POST') return res.writeHead(404).end();
    try {
        let body = ''; for await (const bytes of req) { body += bytes.toString(); if (body.length > 65536) throw new Error('Synthetic request too large'); }
        const { method, args } = JSON.parse(body); if (!methods.has(method) || args[0] !== owner.uid) throw new Error('Synthetic request required');
        if (method === 'saveSettings') args.push(() => true);
        const result = await backend.client[method](...args); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result ?? null));
    } catch (e) { res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: e.code || 'synthetic-failed' })); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser, persistent, passed = 0;
const isolate = c => c.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
try {
    for (const channel of ['msedge', 'chrome']) {
        browser = await chromium.launch({ channel, headless: true }); const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context);
        const page = await context.newPage(); await page.goto(origin);
        const results = await page.evaluate(async () => {
            const f = await import('/fixture.js'), stores = f.browserStoreFactory(), results = [];
            try { for (const c of f.adapterCases({ makeStore: stores.makeStore, crypto, locks: navigator.locks })) {
                try { await c.run(); results.push({ name: c.name, passed: true }); } catch (e) { results.push({ name: c.name, passed: false, code: e.code || e.message }); }
            } } finally { stores.close(); } return results;
        });
        for (const r of results) { console.log(`${channel}: ${r.passed ? 'PASS' : 'FAIL'} ${r.name}${r.passed ? '' : ` (${r.code})`}`); assert.equal(r.passed, true); passed++; }
        await page.evaluate(async () => {
            const f = await import('/fixture.js'), name = `synthetic-real-contract-${crypto.randomUUID()}`;
            // REAL legacy adapter. The injected factory remaps its single open to a dedicated DB.
            const db = await f.abrirPersistenciaFinanceira({ open(requested, version) { f.equal(requested, 'controleFinanceiro:integridade:v1'); return indexedDB.open(name, version); } });
            try {
                await db.alterarDocumentos(['synthetic-state', 'synthetic-queue'], docs => { docs.set('synthetic-state', { revision: 1 }); docs.set('synthetic-queue', { outbox: ['synthetic-id'] }); return docs; });
                let failed = false; try { await db.alterarDocumentos(['synthetic-state', 'synthetic-queue'], docs => { docs.set('synthetic-state', { revision: 2 }); throw new Error('Synthetic abort'); }); } catch { failed = true; }
                f.ok(failed); f.equal(await db.ler('synthetic-state'), { revision: 1 }); f.equal(await db.ler('synthetic-queue'), { outbox: ['synthetic-id'] });
            } finally { db.fechar(); }
            f.ok((await indexedDB.databases()).every(d => d.name.startsWith('controleFinanceiro:cofre-isolado:v1:synthetic-') || d.name.startsWith('synthetic-real-contract-')));
            f.equal(localStorage.length, 0); f.equal(sessionStorage.length, 0); f.equal((await caches.keys()).length, 0);
        }); passed++;
        const name = await page.evaluate(async () => {
            const f = await import('/fixture.js'); window.f = f; const stores = f.browserStoreFactory(); window.stores = stores;
            window.store = await stores.makeStore(); window.adapter = f.createRealVaultAdapter({ store: window.store.store, owner: f.owner });
            const created = await window.adapter.create({ password: f.password, generation: 'legacy', documents: f.documents() });
            window.h = { owner: f.owner, session: created.session }; return window.store.name;
        });
        const tab = await context.newPage(); await tab.goto(origin);
        await tab.evaluate(async name => { const f = await import('/fixture.js'); window.f = f;
            window.adapter = f.createRealVaultAdapter({ store: await f.openVaultStore({ databaseName: name }), owner: f.owner }); window.h = { owner: f.owner, session: await window.adapter.unlock(f.password) };
        }, name);
        await Promise.all([page.evaluate(() => window.f.income(window.h, 'synthetic-tab-a')), tab.evaluate(() => window.f.income(window.h, 'synthetic-tab-b'))]);
        assert.equal(await page.evaluate(async () => (await window.h.session.service.lerFila(window.f.owner.uid)).outbox.length), 2); passed++;
        await page.evaluate(() => window.adapter.lock());
        assert.equal(await tab.evaluate(async () => { try { await window.f.income(window.h, 'synthetic-stale-tab'); return false; } catch { return true; } }), true); passed++;
        await browser.close(); browser = null;
        const profile = await mkdtemp(path.join(tmpdir(), `cf-real-adapters-${channel}-`));
        const launch = async () => { const c = await chromium.launchPersistentContext(profile, { channel, headless: true, serviceWorkers: 'block' }); await isolate(c); return c; };
        persistent = await launch(); let p = await persistent.newPage(); await p.goto(origin); backend.remote.loseNextAck();
        const durable = await p.evaluate(async channel => {
            const f = await import('/fixture.js'), stores = f.browserStoreFactory(), store = await stores.makeStore();
            const adapter = f.createRealVaultAdapter({ store: store.store, owner: f.owner }); const created = await adapter.create({ password: f.password, generation: 'legacy', documents: f.documents() });
            const h = { owner: f.owner, session: created.session, client: f.httpClient() }; f.connect(h); await h.sync.useAccount({ uid: f.owner.uid });
            await f.income(h, `synthetic-process-${channel}`); let code; try { await h.sync.cycle(h.sync.session); } catch (e) { code = e.code; }
            const q = await h.session.service.lerFila(f.owner.uid); f.equal(code, 'unavailable'); f.ok(q.attempted[q.outbox[0].id]);
            const result = { name: store.name, id: q.outbox[0].id }; adapter.close(); stores.close(); return result;
        }, channel);
        await persistent.close(); persistent = null; persistent = await launch(); p = await persistent.newPage(); await p.goto(origin);
        await p.evaluate(async name => { const f = await import('/fixture.js'); window.f = f; window.adapter = f.createRealVaultAdapter({ store: await f.openVaultStore({ databaseName: name }), owner: f.owner }); }, durable.name);
        await persistent.setOffline(true);
        assert.equal(await p.evaluate(async () => { const f = window.f; window.h = { owner: f.owner, session: await window.adapter.unlock(f.password), client: f.httpClient() }; const q = await window.h.session.service.lerFila(f.owner.uid); f.ok(q.attempted[q.outbox[0].id]); return q.outbox[0].id; }), durable.id);
        await persistent.setOffline(false);
        await p.evaluate(async () => { const f = window.f, h = window.h; f.connect(h); await h.sync.useAccount({ uid: f.owner.uid }); await h.sync.cycle(h.sync.session); f.equal((await h.session.service.lerFila(f.owner.uid)).outbox.length, 0); window.adapter.close(); });
        assert.equal(backend.remote.inspect(owner).records.filter(([, r]) => r.id === `synthetic-process-${channel}`).length, 1); passed++;
        await persistent.close(); persistent = null; console.log(`${channel}: profiles retained: ${profile}`);
    }
    console.log(`Real adapter browser QA: ${passed} passed, 0 failed, 0 skipped.`);
} finally { await persistent?.close(); await browser?.close(); await new Promise(r => server.close(r)); }
