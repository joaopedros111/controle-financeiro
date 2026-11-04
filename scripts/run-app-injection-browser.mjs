import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
const root = fileURLToPath(new URL('../', import.meta.url));
// Bundle only the test composition; app.js is served and imported unchanged.
const fixture = await build({ absWorkingDir: root, entryPoints: ['tests/fixtures/app-injection-bootstrap.mjs'], bundle: true, format: 'esm', platform: 'browser', write: false,
    plugins: [{ name: 'keep-app-module-identity', setup(b) { b.onResolve({ filter: /(?:storage|indexeddb-persistence|financial-atomic-service|automatic-finance-sync|app)\.js$/ }, args => {
        if (args.importer.endsWith('app-injection-bootstrap.mjs')) return { path: '/' + path.basename(args.path), external: true };
    }); } }], logLevel: 'silent' });
const html = await readFile(path.join(root, 'index.html'), 'utf8');
// Optional before/after comparison; baseline is an exact preserved local source.
const baselineSource = process.env.BOOTSTRAP_BASELINE_APP ? await readFile(process.env.BOOTSTRAP_BASELINE_APP, 'utf8') : null;
const comparisons = new Map(), pictures = baselineSource ? await mkdtemp(path.join(tmpdir(), 'cf-bootstrap-visual-')) : null;
let beforeVariant = false, compared = 0;
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('Cache-Control', 'no-store');
    try {
        if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(url.searchParams.has('mode') ? html.replace('src="app.js"', 'src="/injection-bootstrap.js"') : html);
        if (url.pathname === '/injection-bootstrap.js') return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(fixture.outputFiles[0].contents);
        if (url.pathname === '/firebase-config.js') return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end("export const firebaseConfig={projectId:'demo-injection',apiKey:'demo-only'};export const firebaseConfigurado=()=>['sync','firebase-fail'].includes(new URL(location.href).searchParams.get('mode'));");
        if (url.pathname === '/firebase-sync.bundle.js' || url.pathname === '/sw.js') return res.writeHead(404).end();
        if (url.pathname === '/app.js' && beforeVariant) return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(baselineSource);
        const target = path.resolve(root, '.' + decodeURIComponent(url.pathname)); if (!target.startsWith(root)) return res.writeHead(403).end();
        const data = await readFile(target), type = { '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[path.extname(target)] || 'text/plain';
        res.writeHead(200, { 'Content-Type': type }).end(data);
    } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser, persistent, passed = 0;
const isolate = context => context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const ready = page => page.waitForFunction(() => !document.documentElement.classList.contains('app-inicializando'));
const read = (page, key, injected) => page.evaluate(async ({ key, injected }) => {
    const db = injected ? window.injectionEvidence.db : await (await import('/indexeddb-persistence.js')).abrirPersistenciaFinanceira();
    try { return await db.ler(key); } finally { if (!injected) db.fechar(); }
}, { key, injected });
async function addIncome(page, name) {
    if (!await page.locator('#conteudo-receitas').isVisible()) await page.locator('[aria-controls="conteudo-receitas"]').click();
    await page.locator('#adicionar-receita').click(); await page.locator('#receita-nome').fill(name); await page.locator('#receita-valor').fill('123.45');
    await page.locator('#form-receita button[type="submit"]').click();
}
const rows = state => Object.values(state?.dados?.meses || {}).flatMap(m => m.receitas);
async function until(fn) { for (let i = 0; i < 120; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Synthetic browser condition timed out'); }
async function comparePicture(page, key) {
    if (!baselineSource) return;
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', style: '#aviso { visibility: hidden !important; }' });
    await writeFile(path.join(pictures, `${beforeVariant ? 'before' : 'after'}-${key}.png`), png);
    if (beforeVariant) comparisons.set(key, png);
    else { assert.ok(png.equals(comparisons.get(key)), `visual regression: ${key}; artifacts ${pictures}`); compared++; }
}
try {
    for (const variant of baselineSource ? ['before', 'after'] : ['after']) {
    beforeVariant = variant === 'before';
    for (const channel of ['msedge', 'chrome']) {
        browser = await chromium.launch({ channel, headless: true });
        for (const injected of [false, true]) {
            const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context); const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
            await page.goto(origin + (injected ? '/?mode=injected' : '/')); await ready(page); if (injected) await page.waitForFunction(() => window.injectionEvidence?.ready);
            await comparePicture(page, `${channel}-${injected}-empty`);
            await addIncome(page, 'SYNTHETIC BOOTSTRAP INCOME'); await until(async () => rows(await read(page, 'estado:@local', injected)).length === 1);
            const before = await read(page, 'estado:@local', injected), queueBefore = await read(page, 'fila:@local', injected); await page.reload(); await ready(page);
            await comparePicture(page, `${channel}-${injected}-persisted`);
            assert.deepEqual(await read(page, 'estado:@local', injected), before); assert.deepEqual(await read(page, 'fila:@local', injected), queueBefore);
            const names = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
            assert.ok(names.every(name => name === (injected ? 'controleFinanceiro:integridade:v1:synthetic-injection' : 'controleFinanceiro:integridade:v1')));
            if (injected) assert.deepEqual(await page.evaluate(() => window.injectionEvidence.events), ['open', 'service']);
            assert.deepEqual(errors, []); passed++; await context.close();
        }
        {
            const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context); const page = await context.newPage();
            await page.goto(origin + '/?mode=fail'); await page.waitForFunction(() => window.injectionEvidence?.ready); await ready(page);
            assert.deepEqual(await page.evaluate(() => window.injectionEvidence.events), ['open']);
            assert.equal(await page.evaluate(() => window.injectionEvidence.db), null); assert.deepEqual(await page.evaluate(() => indexedDB.databases()), []); passed++; await context.close();
        }
        {
            const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context); const page = await context.newPage();
            await page.goto(origin + '/?mode=firebase-fail'); await ready(page); await page.waitForFunction(() => document.getElementById('estado-sincronizacao').dataset.state === 'error');
            assert.deepEqual(await page.evaluate(() => window.injectionEvidence.events), ['open', 'service', 'firebase']);
            assert.equal(await page.evaluate(() => window.injectionEvidence.controller), null); assert.ok(await read(page, 'estado:@local', true)); passed++; await context.close();
        }
        {
            const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context); const page = await context.newPage();
            await page.goto(origin + '/?mode=sync'); await ready(page); await page.locator('#abrir-ajustes').click(); await page.locator('#entrar-google').click();
            await page.waitForFunction(() => document.getElementById('estado-sincronizacao').dataset.state === 'synced'); await page.locator('#fechar-ajustes').click();
            await context.setOffline(true); await addIncome(page, 'SYNTHETIC OFFLINE INCOME');
            await until(async () => (await read(page, 'fila:synthetic-injection-A', true)).outbox.length === 1);
            await context.setOffline(false); await page.waitForFunction(() => document.getElementById('estado-sincronizacao').dataset.state === 'synced');
            assert.equal((await read(page, 'fila:synthetic-injection-A', true)).outbox.length, 0);
            const before = await read(page, 'estado:synthetic-injection-A', true);
            await page.evaluate(() => window.injectionEvidence.switchAccount('synthetic-injection-B'));
            await until(async () => (await read(page, 'estado:synthetic-injection-B', true)) !== null); assert.equal(rows(await read(page, 'estado:synthetic-injection-B', true)).length, 0);
            await page.evaluate(() => window.injectionEvidence.switchAccount('synthetic-injection-A')); await until(async () => documentSafe(page));
            async function documentSafe(p) { return p.evaluate(() => document.getElementById('estado-sincronizacao').dataset.state === 'synced'); }
            assert.deepEqual(rows(await read(page, 'estado:synthetic-injection-A', true)), rows(before));
            await page.locator('#abrir-ajustes').click(); await page.locator('#sair-google').click(); await until(async () => (await page.locator('#entrar-google').isVisible()));
            assert.ok((await page.evaluate(() => window.injectionEvidence.events)).includes('sync')); passed++; await context.close();
        }
        if (baselineSource) {
            const context = await browser.newContext({ serviceWorkers: 'block' }); await isolate(context);
            const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
            await page.goto(origin + '/?mode=sync&bootstrap_seed=1');
            await page.waitForFunction(() => !!window.injectionEvidence?.beforeAuth);
            const early = await page.evaluate(() => ({ beforeAuth: injectionEvidence.beforeAuth, events: injectionEvidence.events,
                counts: injectionEvidence.counts, busy: document.documentElement.classList.contains('app-inicializando') }));
            assert.equal(rows(early.beforeAuth.state)[0].id, 'synthetic-before-auth');
            assert.ok(early.beforeAuth.text.includes('SYNTHETIC BEFORE AUTH'));
            assert.equal(early.busy, true); assert.deepEqual(early.events, ['open', 'service', 'firebase']);
            assert.deepEqual(early.counts, { clients: 0, observers: 0 });
            await page.evaluate(() => { dispatchEvent(new Event('online')); dispatchEvent(new Event('focus')); });
            assert.deepEqual(await page.evaluate(() => injectionEvidence.events), ['open', 'service', 'firebase']);
            await page.evaluate(() => injectionEvidence.releaseFirebase()); await ready(page);
            await page.evaluate(() => import('/app.js')); // ESM repeat must not initialize twice.
            const evidence = await page.evaluate(() => ({ trace: injectionEvidence.trace, counts: injectionEvidence.counts, events: injectionEvidence.events }));
            assert.deepEqual(evidence.counts, { clients: 1, observers: 1 });
            for (const step of ['open', 'service', 'firebase', 'sync']) assert.equal(evidence.events.filter(e => e === step).length, 1);
            const ordered = ['financial-read', 'open', 'service', 'firebase', 'sync', 'auth-observer'].map(step => evidence.trace.indexOf(step));
            assert.ok(ordered.every((index, i) => index >= 0 && (!i || index > ordered[i - 1])));
            assert.deepEqual(errors, []); passed++; await context.close();
        }
        await browser.close(); browser = null;
        for (const injected of [false, true]) {
        const profile = await mkdtemp(path.join(tmpdir(), `cf-app-injection-${channel}-`));
        const launch = async () => { const c = await chromium.launchPersistentContext(profile, { channel, headless: true, serviceWorkers: 'block' }); await isolate(c); return c; };
        const url = origin + (injected ? '/?mode=injected' : '/');
        persistent = await launch(); let page = await persistent.newPage(); await page.goto(url); await ready(page); await addIncome(page, 'SYNTHETIC RESTART INCOME');
        await until(async () => rows(await read(page, 'estado:@local', injected)).length === 1);
        const before = await read(page, 'estado:@local', injected), beforeQueue = await read(page, 'fila:@local', injected); await persistent.close(); persistent = null;
        persistent = await launch(); page = await persistent.newPage(); await page.goto(url); await ready(page); await persistent.setOffline(true);
        assert.deepEqual(await read(page, 'estado:@local', injected), before);
        assert.deepEqual(await read(page, 'fila:@local', injected), beforeQueue);
        passed++; await persistent.close(); persistent = null;
        console.log(`${variant}/${channel}: full restart with ${injected ? 'injected' : 'default'} adapter preserved state/queue. Profile retained: ${profile}`);
        }
    }
    }
    if (baselineSource) console.log(`Bootstrap comparison: ${compared} exact PNG matches; visual artifacts ${pictures}; before-Auth financial hydration and single initialization passed in both versions/engines.`);
    console.log(`App injection browser QA: ${passed} passed, 0 failed, 0 skipped.`);
} finally { await persistent?.close(); await browser?.close(); await new Promise(r => server.close(r)); }
