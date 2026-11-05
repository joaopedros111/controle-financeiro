// Isolated synthetic QA; no app, Firebase, SW, existing profiles or deletion.
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const paths = ['finance-vault-limits.js', 'finance-vault-crypto.js', 'finance-vault-store.js', 'finance-vault-backend.js', 'finance-vault-codec.js',
    'finance-vault-catalog.js', 'finance-vault-recovery.js', 'finance-vault-controller.js',
    'tests/fixtures/vault-stage4-scenarios.mjs', 'tests/fixtures/vault-browser-store.mjs', 'tests/fixtures/vault-contract.mjs'];
const files = new Map(await Promise.all(paths.map(async file => [`/${file}`, await readFile(new URL(`../${file}`, import.meta.url))])));
const server = createServer((request, response) => {
    if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end('<!doctype html><meta charset="utf-8"><title>Synthetic vault stage 4 QA</title>'); return; }
    const file = files.get(request.url); response.writeHead(file ? 200 : 404, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(file || '');
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, persistent, passed = 0, failed = 0;
const isolate = async context => context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
try {
    for (const channel of process.platform === 'win32' ? ['msedge', 'chrome'] : ['chromium']) {
        const launchOptions = { headless: true, ...(channel === 'chromium' ? {} : { channel }) };
        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context);
        const page = await context.newPage(); await page.goto(origin);
        const results = await page.evaluate(async () => {
            const { stage4Cases } = await import('/tests/fixtures/vault-stage4-scenarios.mjs');
            const { browserStoreFactory } = await import('/tests/fixtures/vault-browser-store.mjs');
            const factory = browserStoreFactory(), results = [];
            try {
                for (const scenario of stage4Cases({ makeStore: factory.makeStore, crypto })) {
                    try { await scenario.run(); results.push({ name: scenario.name, passed: true }); }
                    catch (error) { results.push({ name: scenario.name, passed: false, code: error.code || error.name, message: error.message }); }
                }
            } finally { factory.close(); }
            return results;
        });
        for (const r of results) { if (r.passed) passed++; else { failed++; console.error(`${channel}: FAIL ${r.name} (${r.code}: ${r.message})`); } }
        console.log(`${channel}: ${results.filter(r => r.passed).length}/${results.length} real IndexedDB stage4 scenarios passed.`);
        const upgraded = await page.evaluate(async () => {
            const { openVaultStore, VAULT_DATABASE } = await import('/finance-vault-store.js');
            const name = `${VAULT_DATABASE}:synthetic-schema-v1-${crypto.randomUUID()}`;
            const db = await new Promise((resolve, reject) => {
                const r = indexedDB.open(name, 1);
                r.onupgradeneeded = () => { for (const key of ['snapshots', 'heads', 'nonceKeys']) r.result.createObjectStore(key); r.result.createObjectStore('nonces').createIndex('byKey', 'keyFingerprint'); };
                r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
            });
            const keyFingerprint = 'A'.repeat(43), iv = 'B'.repeat(16);
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['nonces', 'nonceKeys'], 'readwrite', { durability: 'strict' });
                tx.objectStore('nonces').add({ version: 1, keyFingerprint, iv }, [keyFingerprint, iv]); tx.objectStore('nonceKeys').put({ version: 1, count: 1 }, keyFingerprint);
                tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
            }); db.close();
            const store = await openVaultStore({ databaseName: name });
            const duplicate = await store.reserveIV({ keyFingerprint, iv });
            const next = await store.reserveIV({ keyFingerprint, iv: 'C'.repeat(16) }); store.close(); return { duplicate, next };
        }); assert.deepEqual(upgraded, { duplicate: false, next: true }); passed++;
        console.log(`${channel}: additive schema upgrade retained durable IV reservations.`);
        const seed = await page.evaluate(async () => {
            const { openVaultStore, VAULT_DATABASE } = await import('/finance-vault-store.js');
            const { createVaultController } = await import('/finance-vault-controller.js');
            const f = await import('/tests/fixtures/vault-stage4-scenarios.mjs');
            const name = `${VAULT_DATABASE}:synthetic-stage4-tabs-${crypto.randomUUID()}`;
            window.messages = [];
            window.c = createVaultController({ store: await openVaultStore({ databaseName: name }), owner: f.stage4Owner, vaultId: f.stage4Vault, codec: f.stage4Codec(),
                channelFactory: channel => { const bc = new BroadcastChannel(channel); return { postMessage: m => { window.messages.push(m); bc.postMessage(m); }, addEventListener: (...a) => bc.addEventListener(...a), removeEventListener: (...a) => bc.removeEventListener(...a), close: () => bc.close() }; } });
            await window.c.create({ password: f.stage4Password, generation: 'generation-a', documents: f.stage4Documents() });
            return { name };
        });
        const other = await context.newPage(); await other.goto(origin);
        await other.evaluate(async ({ name }) => {
            const { openVaultStore } = await import('/finance-vault-store.js');
            const { createVaultController } = await import('/finance-vault-controller.js');
            const f = await import('/tests/fixtures/vault-stage4-scenarios.mjs');
            window.c = createVaultController({ store: await openVaultStore({ databaseName: name }), owner: f.stage4Owner, vaultId: f.stage4Vault, codec: f.stage4Codec() });
            window.received = []; window.tap = new BroadcastChannel('cf-vault-lock-v1'); window.tap.onmessage = event => window.received.push(event.data);
            await window.c.unlockWithPassword(f.stage4Password);
            window.token = await window.c.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { 'estado:synthetic-A': { unsafeOldUpdate: true } } });
        }, seed);
        await page.evaluate(() => window.c.lock());
        await other.waitForFunction(() => window.received.some(m => m.type === 'invalidate'));
        const revoked = await other.evaluate(async () => {
            try { await window.c.commit(window.token); return 'UNSAFE'; } catch (e) { return e.code; }
        });
        assert.ok(['locked', 'cancelled'].includes(revoked));
        const pending = await other.evaluate(async () => {
            const f = await import('/tests/fixtures/vault-stage4-scenarios.mjs');
            await window.c.unlockWithPassword(f.stage4Password); return (await window.c.read()).documents['fila:synthetic-A'].outbox.length;
        }); assert.equal(pending, 2);
        const messages = await page.evaluate(() => window.messages);
        assert.equal(messages.length, 1); assert.deepEqual(Object.keys(messages[0]).sort(), ['epoch', 'logicalScope', 'type', 'version']);
        assert.ok(!JSON.stringify(messages).includes('ciphertext')); assert.ok(!JSON.stringify(messages).includes('synthetic-pending'));
        passed++; console.log(`${channel}: native BroadcastChannel revocation across real tabs passed (control metadata only).`);
        await page.evaluate(() => window.c.close()); await other.evaluate(() => { window.c.close(); window.tap.close(); });
        await browser.close(); browser = null;

        const profile = await mkdtemp(path.join(tmpdir(), `cf-vault-stage4-${channel}-`));
        const launch = async () => { const context = await chromium.launchPersistentContext(profile, { ...launchOptions, serviceWorkers: 'block' }); await isolate(context); return context; };
        persistent = await launch(); const p = await persistent.newPage(); await p.goto(origin);
        await p.evaluate(async () => {
            const { openVaultStore, VAULT_DATABASE } = await import('/finance-vault-store.js');
            const { createVaultController } = await import('/finance-vault-controller.js');
            const f = await import('/tests/fixtures/vault-stage4-scenarios.mjs');
            const c = createVaultController({ store: await openVaultStore({ databaseName: `${VAULT_DATABASE}:synthetic-stage4-process` }), owner: f.stage4Owner, vaultId: f.stage4Vault, codec: f.stage4Codec() });
            await c.create({ password: f.stage4Password, generation: 'generation-a', documents: f.stage4Documents() }); await c.lock(); c.close();
        }); await persistent.close(); persistent = null;
        persistent = await launch(); const resumedPage = await persistent.newPage(); await resumedPage.goto(origin);
        // Load modules on localhost first, then remove network entirely for unlock/read.
        await resumedPage.evaluate(async () => {
            const { openVaultStore, VAULT_DATABASE } = await import('/finance-vault-store.js');
            const { createVaultController } = await import('/finance-vault-controller.js');
            const f = await import('/tests/fixtures/vault-stage4-scenarios.mjs'); window.f = f;
            window.c = createVaultController({ store: await openVaultStore({ databaseName: `${VAULT_DATABASE}:synthetic-stage4-process` }), owner: f.stage4Owner, vaultId: f.stage4Vault, codec: f.stage4Codec() });
        }); await persistent.setOffline(true);
        const resumed = await resumedPage.evaluate(async () => {
            const state = await window.c.status(); await window.c.unlockWithPassword(window.f.stage4Password);
            const snapshot = await window.c.read(); window.c.close(); return { state, revision: snapshot.catalog.revision, pending: snapshot.documents['fila:synthetic-A'].outbox.length };
        }); assert.equal(resumed.state.state, 'locked'); assert.equal(resumed.revision, 1); assert.equal(resumed.pending, 2);
        passed++; await persistent.close(); persistent = null;
        console.log(`${channel}: full process restart + catalog-only discovery + offline unlock passed. Synthetic profile retained: ${profile}`);
    }
    console.log(`Stage4 browser QA: ${passed} passed, ${failed} failed, 0 skipped.`); if (failed) process.exitCode = 1;
} finally { await persistent?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
