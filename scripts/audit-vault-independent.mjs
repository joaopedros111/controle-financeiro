// Independent diagnostic harness. Exit 1 means a secure invariant was violated.
// It never patches implementations, initializes Firebase, or deletes storage.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { independentAuditCases } from '../tests/fixtures/vault-independent-audit.mjs';
import { realFormatAudit } from '../tests/fixtures/vault-real-format-audit.mjs';
import { memoryVaultFactory } from '../tests/fixtures/vault-memory-store.mjs';

const report = [];
function record(engine, result) {
    report.push({ engine, ...result });
    console.log(JSON.stringify({ engine, ...result })); // identifiers/booleans/counts only; never keys or payloads
}
async function executeCases(engine, cases) {
    for (const probe of cases) {
        try { record(engine, { id: probe.id, name: probe.name, ...await probe.run() }); }
        catch (error) { record(engine, { id: probe.id, secure: null, unexpectedError: error.code || error.name }); }
    }
}
await executeCases('node', independentAuditCases({ makeStore: async () => memoryVaultFactory(), crypto: webcrypto }));
for (const result of realFormatAudit()) record('node', result);

const paths = ['finance-vault-limits.js', 'finance-core.js', 'sync-core.js', 'automatic-sync-policy.js', 'finance-vault-crypto.js', 'finance-vault-store.js', 'finance-vault-backend.js', 'finance-vault-codec.js',
    'finance-vault-catalog.js', 'finance-vault-recovery.js', 'finance-vault-controller.js',
    'tests/fixtures/vault-independent-audit.mjs', 'tests/fixtures/vault-browser-store.mjs'];
const files = new Map(await Promise.all(paths.map(async file => [`/${file}`, await readFile(new URL(`../${file}`, import.meta.url))])));
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../tests/fixtures/vault-real-format-audit.mjs', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, target: 'es2022', logLevel: 'silent' });
files.set('/real-format-sdk.js', bundled.outputFiles[0].contents);
const server = createServer((request, response) => {
    if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end('<!doctype html><meta charset="utf-8"><title>Synthetic independent vault audit</title>'); return; }
    const file = files.get(request.url); response.writeHead(file ? 200 : 404, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(file || '');
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    for (const channel of process.platform === 'win32' ? ['msedge', 'chrome'] : ['chromium']) {
        browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
        const page = await context.newPage(); await page.goto(origin);
        const results = await page.evaluate(async () => {
            const { independentAuditCases } = await import('/tests/fixtures/vault-independent-audit.mjs');
            const { browserStoreFactory } = await import('/tests/fixtures/vault-browser-store.mjs');
            const { realFormatAudit } = await import('/real-format-sdk.js');
            const factory = browserStoreFactory(), results = [];
            try {
                for (const probe of independentAuditCases({ makeStore: factory.makeStore, crypto })) {
                    try { results.push({ id: probe.id, name: probe.name, ...await probe.run() }); }
                    catch (error) { results.push({ id: probe.id, secure: null, unexpectedError: error.code || error.name }); }
                }
                results.push(...realFormatAudit());
            } finally { factory.close(); }
            return results;
        });
        for (const result of results) record(channel, result);
        await browser.close(); browser = null;
    }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
const summary = { secureChecksPassed: report.filter(r => r.secure === true).length,
    secureChecksViolated: report.filter(r => r.secure === false).length, unexpectedErrors: report.filter(r => r.secure === null).length, skipped: 0 };
console.log(JSON.stringify({ summary }));
if (summary.secureChecksViolated || summary.unexpectedErrors) process.exitCode = 1;
