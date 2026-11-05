// Standalone crypto QA. Never serves the application or connects to Firebase.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createVaultCrypto } from '../finance-vault-crypto.js';
import { syntheticContext, syntheticDocumentContext, syntheticPassword } from '../tests/fixtures/vault-crypto-scenarios.mjs';

const files = new Map(await Promise.all([
    ['/finance-vault-crypto.js', new URL('../finance-vault-crypto.js', import.meta.url)],
    ['/tests/fixtures/vault-crypto-scenarios.mjs', new URL('../tests/fixtures/vault-crypto-scenarios.mjs', import.meta.url)]
].map(async ([route, file]) => [route, await readFile(file)])));
const server = createServer((request, response) => {
    if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end('<!doctype html><meta charset="utf-8"><title>Synthetic vault crypto QA</title>'); return; }
    const file = files.get(request.url);
    response.writeHead(file ? 200 : 404, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    response.end(file || '');
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const nodeCrypto = createVaultCrypto({ crypto: webcrypto });
const key = await nodeCrypto.generateDataKey(syntheticContext());
const passwordEnvelope = await nodeCrypto.protectWithPassword(key, syntheticPassword);
const recovery = await nodeCrypto.protectWithRecovery(key);
const payload = new TextEncoder().encode('synthetic-cross-engine-document');
const document = await nodeCrypto.encryptDocument(key, payload, syntheticDocumentContext());
let browser;
let failures = 0, passes = 0;
try {
    for (const channel of process.platform === 'win32' ? ['msedge', 'chrome'] : ['chromium']) {
        browser = await chromium.launch({ headless: true, ...(channel !== 'chromium' ? { channel } : {}) });
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
        const page = await context.newPage();
        await page.goto(origin);
        const report = await page.evaluate(async seed => {
            const { cryptoCases, syntheticContext, syntheticDocumentContext, syntheticPassword } = await import('/tests/fixtures/vault-crypto-scenarios.mjs');
            const { createVaultCrypto } = await import('/finance-vault-crypto.js');
            const results = [];
            for (const scenario of cryptoCases(globalThis.crypto)) {
                try { await scenario.run(); results.push({ name: scenario.name, passed: true }); }
                catch { results.push({ name: scenario.name, passed: false }); }
            }
            const api = createVaultCrypto();
            const expected = { ...syntheticContext(), wrapRevision: 1 };
            const key = await api.unlockWithPassword(seed.passwordEnvelope, syntheticPassword, expected);
            const recovered = await api.recoverDataKey(seed.recovery.envelope, seed.recovery.recoverySecret, expected);
            const bytes = await api.decryptDocument(key, seed.document, syntheticDocumentContext());
            const recoveredBytes = await api.decryptDocument(recovered, seed.document, syntheticDocumentContext());
            const document = await api.encryptDocument(key, bytes, syntheticDocumentContext());
            const passwordEnvelope = await api.protectWithPassword(recovered, syntheticPassword, 2);
            const recovery = await api.protectWithRecovery(key, 2);
            api.destroyKey(key); api.destroyKey(recovered);
            return { results, document, passwordEnvelope, recovery,
                text: new TextDecoder().decode(bytes), recoveredText: new TextDecoder().decode(recoveredBytes),
                secure: isSecureContext };
        }, { passwordEnvelope, document, recovery });
        for (const result of report.results) {
            if (result.passed) passes++;
            else { failures++; console.error(`${channel}: FAIL ${result.name}`); }
        }
        assert.equal(report.secure, true);
        assert.equal(report.text, 'synthetic-cross-engine-document');
        assert.equal(report.recoveredText, report.text);
        const passwordKey = await nodeCrypto.unlockWithPassword(report.passwordEnvelope, syntheticPassword, { ...syntheticContext(), wrapRevision: 2 });
        const recoveryKey = await nodeCrypto.recoverDataKey(report.recovery.envelope, report.recovery.recoverySecret, { ...syntheticContext(), wrapRevision: 2 });
        assert.deepEqual(await nodeCrypto.decryptDocument(passwordKey, report.document, syntheticDocumentContext()), payload);
        assert.deepEqual(await nodeCrypto.decryptDocument(recoveryKey, report.document, syntheticDocumentContext()), payload);
        nodeCrypto.destroyKey(passwordKey); nodeCrypto.destroyKey(recoveryKey);
        passes++; // One bidirectional Node/browser interoperability case per engine.
        console.log(`${channel}: ${report.results.filter(r => r.passed).length}/${report.results.length} scenarios passed; Node/browser bidirectional password + recovery passed.`);
        await browser.close(); browser = null;
    }
    console.log(`Browser crypto QA: ${passes} passed, ${failures} failed, 0 skipped.`);
    if (failures) process.exitCode = 1;
} finally {
    nodeCrypto.destroyKey(key);
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
