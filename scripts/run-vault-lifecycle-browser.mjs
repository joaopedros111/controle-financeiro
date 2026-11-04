import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const bundle = await build({ absWorkingDir: process.cwd(), entryPoints: ['tests/fixtures/vault-lifecycle-browser.mjs'], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
const server = createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; object-src 'none'");
    if (req.url === '/fixture.js') return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].contents);
    if (['/', '/away'].includes(req.url)) return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Synthetic lifecycle</title><a href="/away">Away</a>');
    res.writeHead(404).end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
let context, passed = 0; const requests = [], failures = [];
async function init(page, name, create = false) { await page.goto(origin); await page.evaluate(async ({ name, create }) => { window.f = await import('/fixture.js'); window.h = await f.attach(name, create); }, { name, create }); }
async function unlock(page, kind = 'confirmed') { await page.evaluate(async kind => { await h.controller.identify({ kind, owner: f.ownerA }); await h.controller.unlock(f.password); }, kind); }
try {
    for (const channel of ['msedge', 'chrome']) {
        const profile = await mkdtemp(path.join(tmpdir(), `cf-lifecycle-${channel}-`));
        const launch = async () => {
            const c = await chromium.launchPersistentContext(profile, { channel, headless: true, serviceWorkers: 'block', ignoreDefaultArgs: ['--disable-back-forward-cache'] });
            c.on('request', r => requests.push(r.url())); c.on('page', p => p.on('pageerror', e => failures.push(e.message))); return c;
        };
        context = await launch(); let page = await context.newPage(); await page.goto(origin);
        const results = await page.evaluate(async () => {
            const f = await import('/fixture.js'), stores = f.browserStoreFactory();
            const result = []; try { for (const s of f.lifecycleCases({ makeStore: stores.makeStore, crypto, locks: navigator.locks })) {
                try { await s.run(); result.push({ name: s.name, pass: true }); } catch (e) { result.push({ name: s.name, pass: false, code: e.code || e.message }); break; }
            } } finally { stores.close(); } return result;
        });
        for (const r of results) { console.log(`${channel}: ${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.code ? ' '+r.code : ''}`); assert.equal(r.pass, true); passed++; }
        const name = `controleFinanceiro:cofre-isolado:v1:synthetic-lifecycle-${channel}-${crypto.randomUUID()}`;
        await init(page, name, true); await unlock(page); let peer = await context.newPage(); await init(peer, name); await unlock(peer);
        await Promise.all([page.evaluate(() => f.income(h.controller, 'synthetic-tab-A')), peer.evaluate(() => f.income(h.controller, 'synthetic-tab-B'))]);
        assert.equal(await page.evaluate(async () => (await f.queue(h.controller)).outbox.length), 2); passed++; console.log(`${channel}: real concurrent tabs passed.`);
        const cdp = await context.newCDPSession(peer); await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
        await page.evaluate(() => h.controller.close('logout')); await cdp.send('Page.setWebLifecycleState', { state: 'active' });
        assert.equal(await peer.evaluate(async () => { try { await f.income(h.controller, 'synthetic-frozen-old'); return false; } catch { return true; } }), true); passed++; console.log(`${channel}: real frozen tab revoked without messages.`);
        await peer.evaluate(() => h.controller.close('logout')); await peer.close();
        // Full process restart retains only ciphertext and durable queue, no Auth/key.
        await unlock(page); const before = await page.evaluate(async () => (await h.controller.read()).documents);
        await context.close(); context = await launch(); page = await context.newPage(); await init(page, name);
        assert.equal(await page.evaluate(() => h.controller.state().phase), 'signed-out');
        await context.setOffline(true); await unlock(page, 'unconfirmed');
        assert.deepEqual(await page.evaluate(async () => (await h.controller.read()).documents), before); passed++; console.log(`${channel}: offline full-process reopen passed.`);
        await context.setOffline(false);
        // Real history traversal. Assert persisted=true, never substitute reload.
        await page.locator('a').click(); await page.waitForURL(`${origin}/away`); await page.goBack({ waitUntil: 'commit' });
        await page.waitForFunction(() => window.h?.persisted === true);
        await page.evaluate(() => h.resumed); assert.equal(await page.evaluate(() => h.controller.state().phase), 'locked');
        assert.equal(await page.evaluate(async () => { try { await h.controller.read(); return false; } catch { return true; } }), true);
        await page.evaluate(() => h.controller.unlock(f.password));
        assert.deepEqual(await page.evaluate(async () => (await h.controller.read()).documents), before); passed++; console.log(`${channel}: real BFCache persisted resume passed.`);
        // Inspect every dedicated store; no plaintext financial marker/password/DEK.
        await page.evaluate(async () => {
            const names = await indexedDB.databases(); f.ok(names.every(d => d.name.startsWith('controleFinanceiro:cofre-isolado:v1:synthetic-')));
            for (const { name } of names) {
                const db = await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
                try { for (const store of db.objectStoreNames) {
                    const values = await new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
                    const text = JSON.stringify(values); for (const marker of ['SYNTHETIC LIFECYCLE INCOME', 'SYNTHETIC RECOVERY RETAINED', '321.09', f.password, 'synthetic-tab-A', 'synthetic-tab-B']) f.ok(!text.includes(marker));
                    function inspect(v) { if (v instanceof CryptoKey) throw new Error('Persisted CryptoKey'); if (v && typeof v === 'object') for (const item of Object.values(v)) inspect(item); } inspect(values);
                } } finally { db.close(); }
            }
            f.equal(localStorage.length, 0); f.equal(sessionStorage.length, 0); f.equal((await caches.keys()).length, 0); await h.controller.close('logout');
        }); passed++;
        await context.close(); context = null; console.log(`${channel}: profile retained ${profile}`);
    }
    assert.deepEqual(failures, []); assert.ok(requests.every(url => new URL(url).origin === origin));
    console.log(`Lifecycle browser QA: ${passed} passed, 0 failed, 0 skipped; real BFCache both engines; 0 external requests.`);
} finally { await context?.close(); await new Promise(r => server.close(r)); }
