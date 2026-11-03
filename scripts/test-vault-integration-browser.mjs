// Standalone test site, in-memory bundle, fresh synthetic profiles; no app or SW.
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../tests/fixtures/vault-integration-browser.mjs', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, target: 'es2022', logLevel: 'silent' });
const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><title>Synthetic vault integration</title>'); }
    else if (req.url === '/integration.js') res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].contents);
    else res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, persistent, passed = 0, failed = 0;
async function isolate(context) {
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
}
try {
    for (const channel of process.platform === 'win32' ? ['msedge', 'chrome'] : ['chromium']) {
        const options = { headless: true, ...(channel === 'chromium' ? {} : { channel }) };
        browser = await chromium.launch(options); const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context);
        const page = await context.newPage(); await page.goto(origin);
        const results = await page.evaluate(async () => {
            const f = await import('/integration.js'), factory = f.browserStoreFactory(), results = [];
            try {
                for (const scenario of f.integrationCases({ makeStore: factory.makeStore, crypto })) {
                    try { await scenario.run(); results.push({ name: scenario.name, passed: true }); }
                    catch (error) { results.push({ name: scenario.name, passed: false, code: error.code || error.name }); }
                }
                const names = (await indexedDB.databases()).map(db => db.name);
                results.push({ name: 'only dedicated synthetic vault databases; no local/session/cache financial persistence', passed:
                    names.every(name => name.startsWith(`${f.VAULT_DATABASE}:synthetic-`)) && localStorage.length === 0 && sessionStorage.length === 0 && (await caches.keys()).length === 0 });
            } finally { factory.close(); }
            return results;
        });
        for (const r of results) { if (r.passed) passed++; else { failed++; console.error(`${channel}: FAIL ${r.name} (${r.code || 'isolation'})`); } }
        console.log(`${channel}: ${results.filter(r => r.passed).length}/${results.length} real IndexedDB integration cases passed.`);
        const seed = await page.evaluate(async () => {
            const f = await import('/integration.js'); window.f = f; window.messages = [];
            const name = `${f.VAULT_DATABASE}:synthetic-real-integration-tabs-${crypto.randomUUID()}`;
            window.account = f.createExperimentalAccount({ store: await f.openVaultStore({ databaseName: name }), owner: f.integrationOwner,
                channelFactory: name => { const channel = new BroadcastChannel(name); return {
                    postMessage: value => { window.messages.push(value); channel.postMessage(value); },
                    addEventListener: (...args) => channel.addEventListener(...args), removeEventListener: (...args) => channel.removeEventListener(...args), close: () => channel.close()
                }; } });
            window.session = (await window.account.create({ password: f.integrationPassword, generation: 'synthetic-generation-1', documents: f.integrationDocuments() })).session;
            await f.addIncome(window.session); return { name };
        });
        const tab = await context.newPage(); await tab.goto(origin);
        await tab.evaluate(async ({ name }) => {
            const f = await import('/integration.js'); window.f = f;
            window.account = f.createExperimentalAccount({ store: await f.openVaultStore({ databaseName: name }), owner: f.integrationOwner });
            window.session = await window.account.unlockWithPassword(f.integrationPassword);
        }, seed);
        await Promise.all([page.evaluate(() => window.f.addIncome(window.session, window.f.integrationOwner.uid, 'synthetic-real-tab-a')),
            tab.evaluate(() => window.f.addIncome(window.session, window.f.integrationOwner.uid, 'synthetic-real-tab-b'))]);
        const merged = await page.evaluate(async () => ({ count: (await window.session.db.ler(`estado:${window.f.integrationOwner.uid}`)).dados.meses[window.f.month].receitas.length,
            pending: (await window.session.service.lerFila(window.f.integrationOwner.uid)).outbox.length }));
        assert.deepEqual(merged, { count: 3, pending: 3 }); passed++;
        await page.evaluate(() => window.account.lock());
        const fenced = await tab.evaluate(async () => { try { await window.f.addIncome(window.session, window.f.integrationOwner.uid, 'synthetic-revoked'); return false; } catch (error) { return ['cancelled', 'locked'].includes(error.code); } });
        assert.equal(fenced, true); passed++;
        const messages = await page.evaluate(() => window.messages);
        assert.ok(messages.length > 0); assert.ok(messages.every(m => Object.keys(m).sort().join() === 'epoch,logicalScope,type,version')); passed++;
        await page.evaluate(() => window.account.close()); await tab.evaluate(() => window.account.close()); await browser.close(); browser = null;

        const profile = await mkdtemp(path.join(tmpdir(), `cf-vault-integration-${channel}-`));
        const launch = async () => { const c = await chromium.launchPersistentContext(profile, { ...options, serviceWorkers: 'block' }); await isolate(c); return c; };
        persistent = await launch(); let p = await persistent.newPage(); await p.goto(origin);
        const pending = await p.evaluate(async () => {
            const f = await import('/integration.js');
            const account = f.createExperimentalAccount({ store: await f.openVaultStore({ databaseName: `${f.VAULT_DATABASE}:synthetic-integration-process` }), owner: f.integrationOwner });
            const session = (await account.create({ password: f.integrationPassword, generation: 'synthetic-generation-1', documents: f.integrationDocuments() })).session;
            await f.addIncome(session); const q = await session.service.lerFila(f.integrationOwner.uid);
            await session.service.alterarFila(f.integrationOwner.uid, queue => { queue.attempted[q.outbox[0].id] = true; return queue; });
            // Close the browser while unlocked; secrets are never written to its profile.
            return q.outbox.map(op => op.id);
        }); await persistent.close(); persistent = null;
        persistent = await launch(); p = await persistent.newPage(); await p.goto(origin);
        await p.evaluate(async () => { window.f = await import('/integration.js'); const f = window.f;
            window.account = f.createExperimentalAccount({ store: await f.openVaultStore({ databaseName: `${f.VAULT_DATABASE}:synthetic-integration-process` }), owner: f.integrationOwner }); });
        await persistent.setOffline(true);
        const reopened = await p.evaluate(async () => {
            const before = await window.account.vault.status(), f = window.f, session = await window.account.unlockWithPassword(f.integrationPassword);
            const queue = await session.service.lerFila(f.integrationOwner.uid);
            const financial = await session.db.ler(`estado:${f.integrationOwner.uid}`); window.account.close();
            return { state: before.state, pending: queue.outbox.map(op => op.id), attempted: !!queue.attempted[queue.outbox[0].id], name: financial.dados.meses[f.month].receitas[0].nome };
        });
        assert.equal(reopened.state, 'locked'); assert.deepEqual(reopened.pending, pending); assert.equal(reopened.attempted, true);
        assert.equal(reopened.name, 'SYNTHETIC FINANCIAL VAULT MARKER'); passed++;
        await persistent.close(); persistent = null;
        console.log(`${channel}: real tabs, epoch fencing, metadata-only messages and full offline process restart passed. Synthetic profile retained: ${profile}`);
    }
    console.log(`Integration browser QA: ${passed} passed, ${failed} failed, 0 skipped.`); if (failed) process.exitCode = 1;
} finally { await persistent?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
