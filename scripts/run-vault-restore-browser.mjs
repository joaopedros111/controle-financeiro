import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
if (process.env.LOCAL_VAULT_EMULATORS !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Explicit isolated emulators required');
const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['tests/fixtures/vault-restore-browser.mjs'], bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:8080 http://127.0.0.1:9099; base-uri 'none'; object-src 'none'");
    if (req.url === '/probe.js') return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].contents);
    if (req.url !== '/') return res.writeHead(404).end();
    const id = crypto.randomUUID(), config = { experimentalVault: true, projectId: 'demo-vault-integration', authEmulator: 'http://127.0.0.1:9099', firestoreEmulator: 'http://127.0.0.1:8080', databaseName: `controleFinanceiro:cofre-isolado:v1:synthetic-integrated-restore-${id}`, accounts: [`synthetic-integrated-restore-${id}`] };
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Synthetic restore probe</title><script>globalThis.restoreConfiguration=${JSON.stringify(config)}</script><script type="module" src="/probe.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
let context, passed = 0; const blocked = [], errors = [];
try {
    for (const channel of ['msedge', 'chrome']) {
      for (const point of ['old-read', 'committed-before-delivery']) {
        const profile = await mkdtemp(path.join(tmpdir(), `cf-restore-${channel}-`));
        context = await chromium.launchPersistentContext(profile, { channel, headless: true, serviceWorkers: 'block' });
        await context.route('**/*', route => { const target = new URL(route.request().url()).origin;
            if ([origin, 'http://127.0.0.1:8080', 'http://127.0.0.1:9099'].includes(target)) return route.continue(); blocked.push(target); return route.abort();
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(origin); await page.waitForFunction(() => !!globalThis.restoreQA);
        await page.evaluate(() => restoreQA.prepare()); await context.setOffline(true);
        const result = await page.evaluate(point => restoreQA.reproduce(point), point);
        assert.equal(result.rejected.code, 'cancelled'); assert.equal(result.rejected.name, 'VaultControllerError');
        console.log(JSON.stringify({ engine: channel, point, test: 'old-harness-read-reproduced', ...result })); passed++;
        await context.setOffline(false); const completed = await page.evaluate(() => restoreQA.publish());
        assert.ok(['synced', 'recovery-history'].includes(completed.phase)); console.log(JSON.stringify({ engine: channel, test: 'awaited-restore-published-with-exact-archive', ...completed })); passed++;
        await page.evaluate(() => restoreQA.close()); await context.close(); context = null; console.log(`${channel}: profile retained ${profile}`);
      }
    }
    assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
    console.log(`Isolated restore QA: ${passed} passed, 0 failed, 0 skipped; original cancellation reproduced in both engines; 0 production requests.`);
} finally { await context?.close(); await new Promise(r => server.close(r)); }
