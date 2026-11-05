// Migration QA: synthetic source + dedicated encrypted targets, never the app.
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../tests/fixtures/vault-migration-browser.mjs', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, target: 'es2022', logLevel: 'silent' });
const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/') res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><title>Synthetic migration QA</title>');
    else if (req.url === '/migration.js') res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].contents);
    else res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser, persistent, passed = 0, failed = 0;
const isolate = context => context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
try {
    for (const channel of process.platform === 'win32' ? ['msedge', 'chrome'] : ['chromium']) {
        const options = { headless: true, ...(channel === 'chromium' ? {} : { channel }) };
        browser = await chromium.launch(options); const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context);
        const page = await context.newPage(); await page.goto(origin);
        const results = await page.evaluate(async () => {
            const f = await import('/migration.js'), factory = f.browserStoreFactory({ prefix: 'migration-' }), sources = [], results = [];
            const makeSource = async () => {
                const source = await f.openSyntheticMigrationSource({ databaseName: `${f.SYNTHETIC_SOURCE_PREFIX}${crypto.randomUUID()}`, initialSnapshot: f.migrationSourceFixture() }); sources.push(source); return source;
            };
            try {
                for (const scenario of f.migrationCases({ makeStore: factory.makeStore, makeSource, crypto })) {
                    try { await scenario.run(); results.push({ name: scenario.name, passed: true }); }
                    catch (error) { results.push({ name: scenario.name, passed: false, code: error.code || error.name }); }
                }
                const names = (await indexedDB.databases()).map(db => db.name);
                results.push({ name: 'only dedicated synthetic source/target databases and no local/session/cache persistence', passed:
                    names.every(name => name.startsWith(f.SYNTHETIC_SOURCE_PREFIX) || name.startsWith(f.SYNTHETIC_TARGET_PREFIX))
                    && localStorage.length === 0 && sessionStorage.length === 0 && (await caches.keys()).length === 0 });
            } finally { factory.close(); sources.forEach(s => s.close()); }
            return results;
        });
        for (const result of results) { if (result.passed) passed++; else { failed++; console.error(`${channel}: FAIL ${result.name} (${result.code})`); } }
        console.log(`${channel}: ${results.filter(r => r.passed).length}/${results.length} migration cases on real IndexedDB passed.`);
        const seed = await page.evaluate(async () => {
            const f = await import('/migration.js'); window.f = f;
            const sourceName = `${f.SYNTHETIC_SOURCE_PREFIX}tabs-${crypto.randomUUID()}`, targetName = `${f.SYNTHETIC_TARGET_PREFIX}tabs-${crypto.randomUUID()}`;
            window.source = await f.openSyntheticMigrationSource({ databaseName: sourceName, initialSnapshot: f.migrationSourceFixture() });
            window.target = await f.openSyntheticMigrationTarget({ databaseName: targetName });
            window.beforeSourceHash = await f.vaultDigest(f.migrationCanonicalBytes(f.createFinancialCodec(), await window.source.read()));
            window.migrate = f.createSyntheticMigrator({ source: window.source.source, target: window.target, owner: f.migrationOwner,
                onPhase: async name => { if (name === 'before-create') { window.ready = true; await new Promise(resolve => { window.release = resolve; }); } } });
            window.result = window.migrate.prepare({ password: f.migrationPassword }).then(result => ({ passed: true, evidence: result.evidence }), e => ({ passed: false, code: e.code }));
            return { sourceName, targetName };
        });
        const tab = await context.newPage(); await tab.goto(origin);
        await tab.evaluate(async seed => {
            const f = await import('/migration.js'); window.f = f;
            window.source = await f.openSyntheticMigrationSource({ databaseName: seed.sourceName }); window.target = await f.openSyntheticMigrationTarget({ databaseName: seed.targetName });
            window.migrate = f.createSyntheticMigrator({ source: window.source.source, target: window.target, owner: f.migrationOwner,
                onPhase: async name => { if (name === 'before-create') { window.ready = true; await new Promise(resolve => { window.release = resolve; }); } } });
            window.result = window.migrate.prepare({ password: f.migrationPassword }).then(result => ({ passed: true, evidence: result.evidence }), e => ({ passed: false, code: e.code }));
        }, seed);
        await Promise.all([page.waitForFunction(() => window.ready), tab.waitForFunction(() => window.ready)]);
        await Promise.all([page.evaluate(() => window.release()), tab.evaluate(() => window.release())]);
        const race = await Promise.all([page.evaluate(() => window.result), tab.evaluate(() => window.result)]);
        assert.equal(race.filter(r => r.passed).length, 1); assert.ok(race.filter(r => !r.passed).every(r => ['cancelled', 'already-exists', 'stale-revision'].includes(r.code)));
        const stable = await page.evaluate(async () => {
            const repeated = await window.migrate.prepare({ password: window.f.migrationPassword });
            const after = await window.f.vaultDigest(window.f.migrationCanonicalBytes(window.f.createFinancialCodec(), await window.source.read()));
            return { alreadyCopied: repeated.alreadyCopied, sourcePreserved: after === window.beforeSourceHash, digest: repeated.evidence.sourceDigest, counts: repeated.evidence.counts };
        });
        assert.equal(stable.alreadyCopied, true); assert.equal(stable.sourcePreserved, true); passed++;
        console.log(JSON.stringify({ engine: channel, scenario: 'two-real-tabs-preserved-source', sha256: stable.digest, counts: stable.counts }));
        await page.evaluate(() => { window.migrate.close(); window.target.store.close(); window.source.close(); });
        await tab.evaluate(() => { window.migrate.close(); window.target.store.close(); window.source.close(); }); await browser.close(); browser = null;

        const profile = await mkdtemp(path.join(tmpdir(), `cf-vault-migration-${channel}-`));
        const launch = async () => { const c = await chromium.launchPersistentContext(profile, { ...options, serviceWorkers: 'block' }); await isolate(c); return c; };
        persistent = await launch(); let p = await persistent.newPage(); await p.goto(origin);
        // Only this Node harness retains the synthetic recovery secret in RAM,
        // modelling a user re-entering an independently held secret after restart.
        const custody = await p.evaluate(async () => {
            const f = await import('/migration.js');
            const source = await f.openSyntheticMigrationSource({ databaseName: `${f.SYNTHETIC_SOURCE_PREFIX}process`, initialSnapshot: f.migrationSourceFixture() });
            const target = await f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}process` });
            const m = f.createSyntheticMigrator({ source: source.source, target, owner: f.migrationOwner });
            const prepared = await m.prepare({ password: f.migrationPassword });
            m.close(); source.close(); target.store.close(); return { recoverySecret: prepared.recoverySecret, digest: prepared.evidence.sourceDigest };
        }); await persistent.close(); persistent = null;
        persistent = await launch(); p = await persistent.newPage(); await p.goto(origin);
        await p.evaluate(async () => {
            const f = await import('/migration.js'); window.f = f;
            window.source = await f.openSyntheticMigrationSource({ databaseName: `${f.SYNTHETIC_SOURCE_PREFIX}process` });
            window.target = await f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}process` });
            window.migrate = f.createSyntheticMigrator({ source: window.source.source, target: window.target, owner: f.migrationOwner });
        }); await persistent.setOffline(true);
        const resumed = await p.evaluate(async ({ recoverySecret }) => {
            const f = window.f, repeated = await window.migrate.prepare({ password: f.migrationPassword });
            const recovery = await f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}recovery-${crypto.randomUUID()}` });
            const active = await window.migrate.activate({ password: f.migrationPassword, recoverySecret, externalCustodyConfirmed: true, recoveryTarget: recovery });
            const data = await active.read(), source = await window.source.read();
            const bytes = f.migrationCanonicalBytes(f.createFinancialCodec(), data), original = f.migrationCanonicalBytes(f.createFinancialCodec(), source.documents);
            const equal = bytes.length === original.length && bytes.every((v, i) => v === original[i]); bytes.fill(0); original.fill(0);
            window.migrate.deactivate(); let revoked = false; try { await active.read(); } catch (e) { revoked = e.code === 'cancelled'; }
            window.migrate.close(); window.source.close(); window.target.store.close(); recovery.store.close();
            return { alreadyCopied: repeated.alreadyCopied, secretNotPersisted: repeated.recoverySecret === null, equal, revoked, digest: repeated.evidence.sourceDigest, recovered: active.evidence.recoveryVerified };
        }, { recoverySecret: custody.recoverySecret });
        assert.equal(resumed.digest, custody.digest); for (const key of ['alreadyCopied', 'secretNotPersisted', 'equal', 'revoked', 'recovered']) assert.equal(resumed[key], true);
        passed++; await persistent.close(); persistent = null;
        console.log(`${channel}: full process restart, offline recovery, equivalence and revocation passed. Synthetic profile retained: ${profile}`);
    }
    console.log(`Migration browser QA: ${passed} passed, ${failed} failed, 0 skipped.`); if (failed) process.exitCode = 1;
} finally { await persistent?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
