// Loopback-only synthetic site/server. Bundles never include the application.
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { syntheticWriteRemote } from '../tests/fixtures/vault-write-remote.mjs';
import { writeOwner } from '../tests/fixtures/vault-write-scenarios.mjs';
const remote = syntheticWriteRemote();
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../tests/fixtures/vault-write-browser.mjs', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, target: 'es2022', logLevel: 'silent' });
const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><title>Synthetic write QA</title>');
    if (req.url === '/writes.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].contents);
    if (req.url !== '/rpc' || req.method !== 'POST') return res.writeHead(404).end();
    try {
        let text = ''; for await (const bytes of req) { text += bytes.toString('utf8'); if (text.length > 65536) throw new Error('Synthetic request too large'); }
        const data = JSON.parse(text);
        if (Object.keys(data).sort().join() !== 'action,operation,owner' || data.owner.projectId !== writeOwner.projectId || !data.owner.uid.startsWith('synthetic-write-')) throw new Error('Synthetic owner required');
        const result = data.action === 'record' ? await remote.commit(data.owner, data.operation) : data.action === 'settings' ? await remote.commitSettings(data.owner, data.operation) : null;
        if (!result) throw new Error('Invalid action'); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) { res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: error.code || 'synthetic-rejected' })); }
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
            const f = await import('/writes.js'), factory = f.browserStoreFactory({ prefix: 'migration-' }), sources = [], results = [];
            const makeSource = async snapshot => { const s = await f.openSyntheticMigrationSource({ databaseName: `${f.SYNTHETIC_SOURCE_PREFIX}${crypto.randomUUID()}`, initialSnapshot: snapshot }); sources.push(s); return s; };
            try {
                for (const scenario of f.writeCases({ makeStore: factory.makeStore, makeSource, crypto })) {
                    try { await scenario.run(); results.push({ name: scenario.name, passed: true }); }
                    catch (error) { results.push({ name: scenario.name, passed: false, code: error.code || error.name }); }
                }
                results.push({ name: 'isolated stores with no local/session/cache financial data', passed: (await indexedDB.databases()).every(d => d.name.startsWith(f.SYNTHETIC_SOURCE_PREFIX) || d.name.startsWith(f.SYNTHETIC_TARGET_PREFIX))
                    && localStorage.length === 0 && sessionStorage.length === 0 && (await caches.keys()).length === 0 });
            } finally { sources.forEach(s => s.close()); factory.close(); } return results;
        });
        for (const r of results) { if (r.passed) passed++; else { failed++; console.error(`${channel}: FAIL ${r.name} (${r.code})`); } }
        console.log(`${channel}: ${results.filter(r => r.passed).length}/${results.length} real IndexedDB write/reconciliation cases passed.`);
        const custody = await page.evaluate(async () => {
            const f = await import('/writes.js'); window.f = f;
            const sourceName = `${f.SYNTHETIC_SOURCE_PREFIX}write-tabs-${crypto.randomUUID()}`, targetName = `${f.SYNTHETIC_TARGET_PREFIX}write-tabs-${crypto.randomUUID()}`;
            window.source = await f.openSyntheticMigrationSource({ databaseName: sourceName, initialSnapshot: f.writingSourceFixture() });
            window.target = await f.openSyntheticMigrationTarget({ databaseName: targetName });
            const migrate = f.createSyntheticMigrator({ source: window.source.source, target: window.target, owner: f.writeOwner });
            const prepared = await migrate.prepare({ password: f.writePassword }); migrate.close();
            window.writer = f.createSyntheticWriter({ source: window.source.source, target: window.target, owner: f.writeOwner,
                createRecoveryTarget: () => f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}proof-${crypto.randomUUID()}` }) });
            window.lease = await window.writer.open({ password: f.writePassword, recoverySecret: prepared.recoverySecret, externalCustodyConfirmed: true });
            return { sourceName, targetName, recoverySecret: prepared.recoverySecret };
        });
        const tab = await context.newPage(); await tab.goto(origin);
        await tab.evaluate(async ({ sourceName, targetName, recoverySecret }) => {
            const f = await import('/writes.js'); window.f = f;
            window.source = await f.openSyntheticMigrationSource({ databaseName: sourceName }); window.target = await f.openSyntheticMigrationTarget({ databaseName: targetName });
            window.writer = f.createSyntheticWriter({ source: window.source.source, target: window.target, owner: f.writeOwner,
                createRecoveryTarget: () => f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}proof-${crypto.randomUUID()}` }) });
            window.lease = await window.writer.open({ password: f.writePassword, recoverySecret, externalCustodyConfirmed: true });
        }, custody);
        await Promise.all([page.evaluate(() => window.f.writeIncome(window.lease, window.f.writeOwner.uid, 'synthetic-tab-write-a')),
            tab.evaluate(() => window.f.writeIncome(window.lease, window.f.writeOwner.uid, 'synthetic-tab-write-b'))]);
        const concurrent = await page.evaluate(async () => { const s = await window.lease.read(), f = window.f; return { records: s.documents[`estado:${f.writeOwner.uid}`].dados.meses[f.writeMonth].receitas.length, pending: s.documents[`fila:${f.writeOwner.uid}`].outbox.length }; });
        assert.deepEqual(concurrent, { records: 3, pending: 2 }); passed++;
        await page.evaluate(() => window.writer.lock());
        const fenced = await tab.evaluate(async () => { try { await window.f.writeIncome(window.lease, window.f.writeOwner.uid, 'synthetic-revoked'); return false; } catch (e) { return ['cancelled', 'locked', 'persistence/cancelled'].includes(e.code); } });
        assert.equal(fenced, true); passed++;
        await page.evaluate(() => { window.writer.close(); window.source.close(); window.target.store.close(); }); await tab.evaluate(() => { window.writer.close(); window.source.close(); window.target.store.close(); });
        await browser.close(); browser = null;

        const profile = await mkdtemp(path.join(tmpdir(), `cf-vault-writes-${channel}-`));
        const launch = async () => { const c = await chromium.launchPersistentContext(profile, { ...options, serviceWorkers: 'block' }); await isolate(c); return c; };
        persistent = await launch(); let p = await persistent.newPage(); await p.goto(origin); remote.loseNextAck();
        const durable = await p.evaluate(async channel => {
            const f = await import('/writes.js'), source = await f.openSyntheticMigrationSource({ databaseName: `${f.SYNTHETIC_SOURCE_PREFIX}write-process`, initialSnapshot: f.writingSourceFixture() });
            const target = await f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}write-process` });
            const migrate = f.createSyntheticMigrator({ source: source.source, target, owner: f.writeOwner }), prepared = await migrate.prepare({ password: f.writePassword }); migrate.close();
            const writer = f.createSyntheticWriter({ source: source.source, target, owner: f.writeOwner, createRecoveryTarget: () => f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}proof-${crypto.randomUUID()}` }) });
            const lease = await writer.open({ password: f.writePassword, recoverySecret: prepared.recoverySecret, externalCustodyConfirmed: true });
            await f.writeIncome(lease, f.writeOwner.uid, `synthetic-process-${channel}`); let rejected;
            try { await lease.synchronize(f.httpWriteRemote()); } catch (e) { rejected = e.code; }
            const q = (await lease.read()).documents[`fila:${f.writeOwner.uid}`]; writer.close(); source.close(); target.store.close();
            return { recoverySecret: prepared.recoverySecret, id: q.outbox[0].id, attempted: !!q.attempted[q.outbox[0].id], rejected };
        }, channel);
        assert.equal(durable.rejected, 'unavailable'); assert.equal(durable.attempted, true);
        await persistent.close(); persistent = null; persistent = await launch(); p = await persistent.newPage(); await p.goto(origin);
        await p.evaluate(async () => { window.f = await import('/writes.js'); const f = window.f;
            window.source = await f.openSyntheticMigrationSource({ databaseName: `${f.SYNTHETIC_SOURCE_PREFIX}write-process` }); window.target = await f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}write-process` });
            window.writer = f.createSyntheticWriter({ source: window.source.source, target: window.target, owner: f.writeOwner, createRecoveryTarget: () => f.openSyntheticMigrationTarget({ databaseName: `${f.SYNTHETIC_TARGET_PREFIX}proof-${crypto.randomUUID()}` }) });
        }); await persistent.setOffline(true);
        const offline = await p.evaluate(async ({ recoverySecret }) => { const f = window.f; window.lease = await window.writer.open({ password: f.writePassword, recoverySecret, externalCustodyConfirmed: true });
            const q = (await window.lease.read()).documents[`fila:${f.writeOwner.uid}`]; return { id: q.outbox[0].id, attempted: !!q.attempted[q.outbox[0].id] }; }, { recoverySecret: durable.recoverySecret });
        assert.deepEqual(offline, { id: durable.id, attempted: true }); await persistent.setOffline(false);
        const pending = await p.evaluate(async () => { await window.lease.synchronize(window.f.httpWriteRemote()); const q = (await window.lease.read()).documents[`fila:${window.f.writeOwner.uid}`]; window.writer.close(); window.source.close(); window.target.store.close(); return q.outbox.length; });
        assert.equal(pending, 0); assert.equal(remote.inspect(writeOwner).records.filter(([, r]) => r.id === `synthetic-process-${channel}`).length, 1); passed++;
        await persistent.close(); persistent = null; console.log(`${channel}: real tabs, durable epoch and full process restart with idempotent loopback ACK passed. Synthetic profile retained: ${profile}`);
    }
    console.log(`Write browser QA: ${passed} passed, ${failed} failed, 0 skipped.`); if (failed) process.exitCode = 1;
} finally { await persistent?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
