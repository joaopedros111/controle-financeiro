// Fresh synthetic contexts only. No Firebase, app pages, SW, production or deletion.
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const paths = ['finance-vault-crypto.js', 'finance-vault-store.js', 'finance-vault-backend.js',
    'tests/fixtures/vault-backend-scenarios.mjs', 'tests/fixtures/vault-browser-store.mjs', 'tests/fixtures/vault-contract.mjs'];
const files = new Map(await Promise.all(paths.map(async file => [`/${file}`, await readFile(new URL(`../${file}`, import.meta.url))])));
const server = createServer((request, response) => {
    if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end('<!doctype html><meta charset="utf-8"><title>Synthetic vault backend QA</title>'); return; }
    const file = files.get(request.url);
    response.writeHead(file ? 200 : 404, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(file || '');
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, persistent, passed = 0, failed = 0;
try {
    for (const channel of process.platform === 'win32' ? ['msedge', 'chrome'] : ['chromium']) {
        browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
        const page = await context.newPage(); await page.goto(origin);
        const results = await page.evaluate(async () => {
            const { backendCases } = await import('/tests/fixtures/vault-backend-scenarios.mjs');
            const { browserStoreFactory } = await import('/tests/fixtures/vault-browser-store.mjs');
            const factory = browserStoreFactory(), results = [];
            try {
                for (const scenario of backendCases({ makeStore: factory.makeStore, crypto })) {
                    try { await scenario.run(); results.push({ name: scenario.name, passed: true }); }
                    catch (error) { results.push({ name: scenario.name, passed: false, code: error.code || error.name, message: error.message }); }
                }
            } finally { factory.close(); }
            return results;
        });
        for (const result of results) {
            if (result.passed) passed++;
            else { failed++; console.error(`${channel}: FAIL ${result.name} (${result.code}: ${result.message})`); }
        }
        console.log(`${channel}: ${results.filter(r => r.passed).length}/${results.length} real IndexedDB scenarios passed.`);

        // Actual separate tabs/connections, not just two instances in one realm.
        const setup = await page.evaluate(async () => {
            const { openVaultStore, VAULT_DATABASE } = await import('/finance-vault-store.js');
            const { createVaultBackend } = await import('/finance-vault-backend.js');
            const { preservationFixture } = await import('/tests/fixtures/vault-contract.mjs');
            const { vaultContext, vaultPassword } = await import('/tests/fixtures/vault-backend-scenarios.mjs');
            const name = `${VAULT_DATABASE}:synthetic-tabs-${crypto.randomUUID()}`, context = vaultContext('synthetic-A');
            window.vaultStore = await openVaultStore({ databaseName: name });
            window.vaultBackend = createVaultBackend({ store: window.vaultStore, context });
            await window.vaultBackend.createKey();
            const envelope = await window.vaultBackend.protectWithPassword(vaultPassword);
            await window.vaultBackend.initialize({ generation: 'generation-a', documents: preservationFixture().documents });
            window.token = await window.vaultBackend.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { 'estado:synthetic-A': { winner: 'tab-A' } } });
            return { name, context, envelope };
        });
        const other = await context.newPage(); await other.goto(origin);
        await other.evaluate(async seed => {
            const { openVaultStore } = await import('/finance-vault-store.js');
            const { createVaultBackend } = await import('/finance-vault-backend.js');
            const { vaultPassword } = await import('/tests/fixtures/vault-backend-scenarios.mjs');
            window.vaultStore = await openVaultStore({ databaseName: seed.name });
            window.vaultBackend = createVaultBackend({ store: window.vaultStore, context: seed.context });
            await window.vaultBackend.unlockWithPassword(seed.envelope, vaultPassword);
            window.token = await window.vaultBackend.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { 'estado:synthetic-A': { winner: 'tab-B' } } });
        }, setup);
        const commits = await Promise.all([page, other].map(tab => tab.evaluate(async () => {
            try { return { revision: await window.vaultBackend.commit(window.token) }; }
            catch (error) { return { code: error.code }; }
        })));
        assert.equal(commits.filter(r => r.revision === 2).length, 1);
        assert.equal(commits.filter(r => r.code === 'stale-revision').length, 1);
        await Promise.all([page, other].map(tab => tab.evaluate(() => window.vaultBackend.close())));
        await other.close(); await page.close();
        const restarted = await context.newPage(); await restarted.goto(origin);
        const revision = await restarted.evaluate(async seed => {
            const { openVaultStore } = await import('/finance-vault-store.js');
            const { createVaultBackend } = await import('/finance-vault-backend.js');
            const { vaultPassword } = await import('/tests/fixtures/vault-backend-scenarios.mjs');
            const backend = createVaultBackend({ store: await openVaultStore({ databaseName: seed.name }), context: seed.context });
            await backend.unlockWithPassword(seed.envelope, vaultPassword);
            const snapshot = await backend.read(); await backend.close(); return snapshot.revision;
        }, setup);
        assert.equal(revision, 2); passed++;
        console.log(`${channel}: separate-tab CAS + page restart passed.`);
        await browser.close(); browser = null;

        // Fresh synthetic persistent profile: full browser process restart.
        // Retain the test profile; never delete/clear any database or cache.
        const profile = await mkdtemp(path.join(tmpdir(), `cf-vault-backend-${channel}-`));
        const launch = async () => {
            const ctx = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'block', ...(channel === 'chromium' ? {} : { channel }) });
            await ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
            return ctx;
        };
        persistent = await launch();
        const firstPage = await persistent.newPage(); await firstPage.goto(origin);
        const seed = await firstPage.evaluate(async () => {
            const { openVaultStore, VAULT_DATABASE } = await import('/finance-vault-store.js');
            const { createVaultBackend } = await import('/finance-vault-backend.js');
            const { preservationFixture } = await import('/tests/fixtures/vault-contract.mjs');
            const { vaultContext, vaultPassword } = await import('/tests/fixtures/vault-backend-scenarios.mjs');
            const name = `${VAULT_DATABASE}:synthetic-process-restart`, context = vaultContext('synthetic-A');
            const backend = createVaultBackend({ store: await openVaultStore({ databaseName: name }), context });
            await backend.createKey();
            const envelope = await backend.protectWithPassword(vaultPassword);
            await backend.initialize({ generation: 'generation-a', documents: preservationFixture().documents });
            // Prepared ciphertext deliberately never committed: its IVs stay burned.
            await backend.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { 'estado:synthetic-A': { pendingAfterRestart: true } } });
            await backend.close(); return { name, context, envelope };
        });
        await persistent.close(); persistent = null;
        persistent = await launch();
        const resumedPage = await persistent.newPage(); await resumedPage.goto(origin);
        const resumed = await resumedPage.evaluate(async seed => {
            const { openVaultStore } = await import('/finance-vault-store.js');
            const { createVaultBackend } = await import('/finance-vault-backend.js');
            const { vaultPassword } = await import('/tests/fixtures/vault-backend-scenarios.mjs');
            const backend = createVaultBackend({ store: await openVaultStore({ databaseName: seed.name }), context: seed.context });
            await backend.unlockWithPassword(seed.envelope, vaultPassword);
            const previous = await backend.read();
            const pending = previous.documents['fila:synthetic-A'].outbox.map(op => op.id);
            const token = await backend.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { 'estado:synthetic-A': { resumed: true } } });
            await backend.commit(token); const next = await backend.read(); await backend.close();
            const db = await new Promise((resolve, reject) => { const request = indexedDB.open(seed.name, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            const nonces = await new Promise((resolve, reject) => { const tx = db.transaction('nonces', 'readonly'), r = tx.objectStore('nonces').getAll(); tx.oncomplete = () => resolve(r.result); tx.onabort = () => reject(tx.error); }); db.close();
            return { before: previous.revision, after: next.revision, pending, nonceCount: nonces.length, unique: new Set(nonces.map(n => `${n.keyFingerprint}:${n.iv}`)).size };
        }, seed);
        assert.equal(resumed.before, 1); assert.equal(resumed.after, 2);
        assert.deepEqual(resumed.pending, ['synthetic-pending', 'synthetic-delete']);
        assert.equal(resumed.nonceCount, 16); // 1 wrap + 3 snapshots (4 docs + manifest)
        assert.equal(resumed.unique, resumed.nonceCount);
        passed++; await persistent.close(); persistent = null;
        console.log(`${channel}: full browser restart + uncommitted reservations + offline queue passed. Synthetic profile retained: ${profile}`);
    }
    console.log(`Backend browser QA: ${passed} passed, ${failed} failed, 0 skipped.`);
    if (failed) process.exitCode = 1;
} finally { await persistent?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
