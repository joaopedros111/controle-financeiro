import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
const root = fileURLToPath(new URL('../', import.meta.url));
const authPocOnly = process.env.AUTH_EMULATOR_POC_ONLY === '1';
const financialIdbOnly = authPocOnly && process.env.FIREBASE_SYNC_IDB_ONLY === '1';
const authEmulatorOrigin = 'http://127.0.0.1:9099', authProject = 'demo-controle-financeiro';
if (authPocOnly) {
    const config = JSON.parse((await readFile(path.join(root, 'firebase.auth-emulator.poc.json'), 'utf8')).replace(/^\uFEFF/, ''));
    assert.equal(config.emulators?.auth?.host, '127.0.0.1'); assert.equal(config.emulators?.auth?.port, 9099);
    const health = await fetch(`${authEmulatorOrigin}/emulator/v1/projects/${authProject}/config`, { redirect: 'error', signal: AbortSignal.timeout(2500) });
    assert.equal(health.status, 200, 'Auth Emulator unavailable; no browser started');
    if (financialIdbOnly) {
        const response = await fetch('http://127.0.0.1:8080/v1/projects/demo-controle-financeiro/databases/(default)/documents/users/synthetic-connectivity/records/synthetic-absent', { redirect: 'error', signal: AbortSignal.timeout(2500) });
        assert.ok([200, 403, 404].includes(response.status), 'Firestore Emulator unavailable');
    }
}
// Bundle only the test composition; app.js is served and imported unchanged.
const fixture = await build({ absWorkingDir: root, entryPoints: [financialIdbOnly ? 'tests/fixtures/firebase-sync-lifecycle-idb.mjs' : authPocOnly ? 'tests/fixtures/auth-emulator-browser.mjs' : 'tests/fixtures/app-injection-bootstrap.mjs'], bundle: true, format: 'esm', platform: 'browser', write: false,
    plugins: [{ name: 'keep-app-module-identity', setup(b) { b.onResolve({ filter: /(?:storage|indexeddb-persistence|financial-atomic-service|automatic-finance-sync|app)\.js$/ }, args => {
        if (args.importer.endsWith('app-injection-bootstrap.mjs')) return { path: '/' + path.basename(args.path), external: true };
    }); } }], logLevel: 'silent' });
const html = authPocOnly ? null : await readFile(path.join(root, 'index.html'), 'utf8');
// Optional before/after comparison; baseline is an exact preserved local source.
const baselineSource = !authPocOnly && process.env.BOOTSTRAP_BASELINE_APP ? await readFile(process.env.BOOTSTRAP_BASELINE_APP, 'utf8') : null;
const comparisons = new Map(), pictures = baselineSource ? await mkdtemp(path.join(tmpdir(), 'cf-bootstrap-visual-')) : null;
let beforeVariant = false, compared = 0;
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('Cache-Control', 'no-store');
    try {
        if (authPocOnly) {
            res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:9099${financialIdbOnly ? ' http://127.0.0.1:8080' : ''}; base-uri 'none'; object-src 'none'`);
            if (url.pathname === '/auth-away') return res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'private, max-age=60' }).end('<!doctype html><title>Away</title><p>Isolated navigation</p>');
            if (url.pathname === '/auth-poc.js') return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(fixture.outputFiles[0].contents);
            const run = url.searchParams.get('run');
            if (url.pathname !== '/auth-poc' || !/^[a-f0-9-]{36}$/.test(run || '')) return res.writeHead(404).end();
            return res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'private, max-age=60' }).end(`<!doctype html><meta charset="utf-8"><title>Auth Emulator isolated PoC</title><p>Isolated synthetic test</p><script>globalThis.authPocConfiguration=${JSON.stringify({ projectId: authProject, run, ...(financialIdbOnly ? { composed: url.searchParams.get('composition') === '1' } : {}) })}</script><script type="module" src="/auth-poc.js"></script>`);
        }
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
if (authPocOnly) {
    try { if (financialIdbOnly) await runFinancialIdb(); else if (process.env.AUTH_EMULATOR_TABS_ONLY === '1') await runAuthTabs(); else await runAuthOnlyBrowsers(); } finally { await new Promise(r => server.close(r)); }
} else {
let browser, persistent, passed = 0, lifecyclePassed = 0, syntheticAuthPassed = 0;
async function testLifecycleProbe(browser, origin) {
    const context = await browser.newContext({
        serviceWorkers: 'block'
    });

    try {
        await context.route('**/*', route =>
            new URL(route.request().url()).origin === origin
                ? route.continue()
                : route.abort()
        );

        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(origin + '/?mode=injected&lifecycle_probe=1');

        await page.waitForFunction(() =>
            window.injectionEvidence?.ready === true
        );

        const result = await page.evaluate(async () => {
            const evidence = window.injectionEvidence;
            const lifecycle = evidence.lifecycle;

            if (!lifecycle) throw new Error('Lifecycle missing');

            const initial = lifecycle.state();
            const beforeState = await evidence.db.ler('estado:@local');
            const beforeQueue = await evidence.db.ler('fila:@local');

            await lifecycle.identify({
                kind: 'confirmed',
                owner: {
                    projectId: 'demo-injection',
                    uid: 'synthetic-injection-A'
                }
            });

            const identified = lifecycle.state();

            await lifecycle.identify({
                kind: 'confirmed',
                owner: {
                    projectId: 'demo-injection',
                    uid: 'synthetic-injection-B'
                }
            });
            const switched = lifecycle.state();

            await lifecycle.suspend();
            const suspended = lifecycle.state();

            await lifecycle.resume();
            const resumed = lifecycle.state();

            await lifecycle.close('logout');
            const loggedOut = lifecycle.state();

            return {
                initial,
                identified,
                switched,
                suspended,
                resumed,
                loggedOut,
                states: evidence.lifecycleStates,
                events: evidence.events,
                adapterOpenAttempts: evidence.lifecycleAdapterOpenAttempts,
                beforeState,
                beforeQueue,
                afterState: await evidence.db.ler('estado:@local'),
                afterQueue: await evidence.db.ler('fila:@local')
            };
        });

        assert.equal(result.initial.phase, 'signed-out');
        assert.equal(result.initial.owner, null);
        assert.equal(result.initial.ownership, 'none');
        assert.equal(result.identified.phase, 'locked');
        assert.deepEqual(result.identified.owner, { projectId: 'demo-injection', uid: 'synthetic-injection-A' });
        assert.equal(result.identified.ownership, 'confirmed');
        assert.equal(result.switched.phase, 'locked');
        assert.deepEqual(result.switched.owner, { projectId: 'demo-injection', uid: 'synthetic-injection-B' });
        assert.equal(result.switched.ownership, 'confirmed');
        assert.equal(result.suspended.phase, 'suspended');
        assert.deepEqual(result.suspended.owner, result.switched.owner);
        assert.equal(result.resumed.phase, 'locked');
        assert.deepEqual(result.resumed.owner, result.switched.owner);
        assert.equal(result.resumed.ownership, 'unconfirmed');
        assert.equal(result.loggedOut.phase, 'signed-out');
        assert.equal(result.loggedOut.owner, null);
        assert.equal(result.loggedOut.ownership, 'none');

        for (const state of result.states) assert.ok(!['unlocking', 'ready', 'operating'].includes(state.phase));
        for (const state of [result.initial, result.identified, result.switched, result.suspended, result.resumed, result.loggedOut]) {
            assert.equal(state.data, null);
            assert.equal(state.inFlight, 0);
        }
        assert.equal(result.adapterOpenAttempts, 0);
        assert.deepEqual(result.afterState, result.beforeState);
        assert.deepEqual(result.afterQueue, result.beforeQueue);

        assert.deepEqual(result.events, ['open', 'service']);
        assert.deepEqual(errors, []);

        console.log('Lifecycle probe: isolamento e transições aprovados.');
    } finally {
        await context.close();
    }
}
async function testSyntheticAuthProbe(browser, origin) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const errors = [];
    try {
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/?mode=injected&lifecycle_probe=1');
        await page.waitForFunction(() => window.injectionEvidence?.ready === true);
        const result = await page.evaluate(async () => {
            const e = window.injectionEvidence, auth = e.lifecycleAuth, lc = e.lifecycle;
            const snapshot = async () => Object.fromEntries(await Promise.all([
                'estado:@local', 'fila:@local', 'estado:synthetic-injection-A', 'fila:synthetic-injection-A',
                'estado:synthetic-injection-B', 'fila:synthetic-injection-B'
            ].map(async key => [key, await e.db.ler(key)])));
            const before = await snapshot(), samples = {}, initial = lc.state();
            await auth.switchAccount('synthetic-injection-A'); samples.A = lc.state();
            const duplicate = auth.duplicateCallback(), duplicateSize = e.lifecycleStates.length;
            await duplicate(); await duplicate(); const duplicateUnchanged = duplicateSize === e.lifecycleStates.length;
            await auth.switchAccount('synthetic-injection-B'); samples.B = lc.state();
            const oldLogin = auth.delayedCallback('synthetic-injection-A');
            await auth.switchAccount(null); samples.logout = lc.state(); const lateLogin = await oldLogin();
            const oldB = auth.delayedCallback('synthetic-injection-B');
            await auth.switchAccount('synthetic-injection-A'); const lateB = await oldB();
            await Promise.all([auth.switchAccount('synthetic-injection-A'), auth.switchAccount('synthetic-injection-B'), auth.switchAccount('synthetic-injection-A')]);
            samples.rapid = lc.state();
            const oldLogout = auth.delayedCallback(null);
            await auth.switchAccount('synthetic-injection-B'); const lateLogout = await oldLogout(); samples.newer = lc.state();
            const beforeFailure = auth.delayedCallback('synthetic-injection-A');
            await auth.failAuth(); samples.failure = lc.state(); const lateFailure = await beforeFailure();
            const failureDuplicate = auth.duplicateCallback(), failureSize = e.lifecycleStates.length;
            await failureDuplicate(); const errorUnchanged = failureSize === e.lifecycleStates.length;
            await auth.switchAccount('synthetic-injection-B'); samples.recovered = lc.state();
            const beforeSuspend = auth.delayedCallback('synthetic-injection-A');
            await lc.suspend(); samples.suspended = lc.state();
            await lc.resume(); samples.resumed = lc.state(); const lateSuspend = await beforeSuspend();
            await auth.switchAccount(null); samples.final = lc.state();
            return { initial, samples, duplicateUnchanged, errorUnchanged, rejected: [lateLogin, lateB, lateLogout, lateFailure, lateSuspend],
                before, after: await snapshot(), states: e.lifecycleStates, events: e.events, counts: e.counts,
                adapterAttempts: e.lifecycleAdapterOpenAttempts };
        });
        assert.equal(result.initial.phase, 'signed-out');
        for (const [name, uid] of [['A', 'A'], ['B', 'B'], ['rapid', 'A'], ['newer', 'B'], ['recovered', 'B']]) {
            const s = result.samples[name]; assert.equal(s.phase, 'locked');
            assert.deepEqual(s.owner, { projectId: 'demo-injection', uid: `synthetic-injection-${uid}` }); assert.equal(s.ownership, 'confirmed');
        }
        for (const name of ['logout', 'final']) { assert.equal(result.samples[name].phase, 'signed-out'); assert.equal(result.samples[name].owner, null); assert.equal(result.samples[name].ownership, 'none'); }
        assert.equal(result.samples.failure.phase, 'error'); assert.equal(result.samples.failure.error, 'lifecycle/auth-failed');
        assert.equal(result.samples.failure.owner, null); assert.equal(result.samples.failure.ownership, 'failed');
        assert.equal(result.samples.suspended.phase, 'suspended');
        assert.equal(result.samples.resumed.phase, 'locked'); assert.equal(result.samples.resumed.ownership, 'unconfirmed');
        assert.equal(result.samples.resumed.owner.uid, 'synthetic-injection-B');
        assert.deepEqual(result.rejected, [false, false, false, false, false]);
        assert.equal(result.duplicateUnchanged, true); assert.equal(result.errorUnchanged, true);
        for (const state of Object.values(result.samples)) { assert.equal(state.data, null); assert.equal(state.inFlight, 0); }
        assert.ok(result.states.every(s => !['unlocking', 'ready', 'operating'].includes(s.phase)));
        assert.equal(result.adapterAttempts, 0); assert.deepEqual(result.before, result.after);
        assert.deepEqual(result.events, ['open', 'service']); assert.deepEqual(result.counts, { clients: 0, observers: 1 });
        // With automatic sync present, its existing observer is reused too.
        const shared = await context.newPage(); shared.on('pageerror', error => errors.push(error.message));
        await shared.goto(origin + '/?mode=sync&lifecycle_probe=1');
        await shared.waitForFunction(() => window.injectionEvidence?.ready && !document.documentElement.classList.contains('app-inicializando'));
        const sharedEvidence = await shared.evaluate(async () => ({ counts: injectionEvidence.counts, events: injectionEvidence.events,
            state: injectionEvidence.lifecycle.state(), attempts: injectionEvidence.lifecycleAdapterOpenAttempts,
            stored: await injectionEvidence.db.ler('estado:@local'), queue: await injectionEvidence.db.ler('fila:@local') }));
        assert.deepEqual(sharedEvidence.counts, { clients: 1, observers: 1 });
        assert.deepEqual(sharedEvidence.events, ['open', 'service', 'firebase', 'sync']);
        assert.equal(sharedEvidence.state.phase, 'signed-out'); assert.equal(sharedEvidence.attempts, 0);
        assert.deepEqual(sharedEvidence.stored, result.before['estado:@local']); assert.deepEqual(sharedEvidence.queue, result.before['fila:@local']);
        assert.deepEqual(errors, []);
        console.log('Synthetic Auth probe: transitions, stale/duplicate callbacks, shared observer and financial preservation passed.');
    } finally { await context.close(); }
}
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
        if (variant === 'after') {
            await testLifecycleProbe(browser, origin);
            lifecyclePassed++;
            await testSyntheticAuthProbe(browser, origin);
            syntheticAuthPassed++;
        }
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
            if (injected) {
                assert.deepEqual(await page.evaluate(() => window.injectionEvidence.events), ['open', 'service']);
                assert.equal(await page.evaluate(() => 'lifecycle' in window.injectionEvidence), false);
            }
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
            assert.equal(await page.evaluate(() => window.injectionEvidence.counts.observers), 1);
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
    console.log(`Lifecycle probe QA: ${lifecyclePassed} passed, 0 failed, 0 skipped; no adapter opened or automatic unlock.`);
    console.log(`Synthetic Auth probe QA: ${syntheticAuthPassed} passed, 0 failed, 0 skipped; one observer, no adapter or financial changes.`);
    console.log(`App injection browser QA: ${passed} passed, 0 failed, 0 skipped.`);
} finally { await persistent?.close(); await browser?.close(); await new Promise(r => server.close(r)); }
}

async function runAuthOnlyBrowsers() {
    let context, passed = 0; const errors = [], external = [];
    const snapshot = page => page.evaluate(() => authPoc.snapshot());
    const loaded = page => page.waitForFunction(() => globalThis.authPoc?.ready === true);
    function locked(s, uid, ownership) {
        assert.equal(s.state.phase, 'locked'); assert.equal(s.state.owner.uid, uid); assert.equal(s.state.ownership, ownership);
        assert.equal(s.stats.adapterOpens, 0); assert.equal(s.observers, 1); assert.equal(s.safe, true);
    }
    async function scenario(name, work) {
        await work(); passed++; console.log(JSON.stringify({ scenario: name, result: 'approved' }));
    }
    try {
        for (const channel of ['msedge', 'chrome']) {
            const run = crypto.randomUUID(), a = `synthetic-auth-browser-A-${run}`, b = `synthetic-auth-browser-B-${run}`;
            const profile = await mkdtemp(path.join(tmpdir(), `cf-auth-emulator-${channel}-`)), url = `${origin}/auth-poc?run=${run}`;
            let offlineAuth = false;
            const launch = async () => {
                const c = await chromium.launchPersistentContext(profile, { channel, headless: true, serviceWorkers: 'block' });
                c.on('request', request => { if (![origin, authEmulatorOrigin].includes(new URL(request.url()).origin)) external.push(new URL(request.url()).origin); });
                c.on('page', page => page.on('pageerror', e => errors.push(e.message)));
                await c.route('**/*', route => {
                    const target = new URL(route.request().url()).origin;
                    return target === origin || target === authEmulatorOrigin && !offlineAuth ? route.continue() : route.abort();
                });
                return c;
            };
            context = await launch(); let page = await context.newPage(); await page.goto(url); await loaded(page);
            await scenario(`${channel}: login A requires remote proof`, async () => {
                assert.equal((await snapshot(page)).state.phase, 'signed-out');
                await page.evaluate(() => authPoc.holdProof()); const signingIn = page.evaluate(() => authPoc.login('A'));
                await page.waitForFunction(() => authPoc.proofHeld()); locked(await snapshot(page), a, 'unconfirmed');
                await page.evaluate(() => authPoc.releaseProof()); assert.equal(await signingIn, true); locked(await snapshot(page), a, 'confirmed');
            });
            await scenario(`${channel}: duplicate and delayed callback; A to B`, async () => {
                await page.evaluate(() => authPoc.captureCallback()); const before = await snapshot(page);
                await page.evaluate(() => authPoc.replayCallback()); assert.equal((await snapshot(page)).stats.proofs, before.stats.proofs);
                assert.equal(await page.evaluate(() => authPoc.login('B')), true); locked(await snapshot(page), b, 'confirmed');
                assert.equal(await page.evaluate(() => authPoc.replayCallback()), false);
            });
            await scenario(`${channel}: reload restores only unconfirmed`, async () => {
                await page.reload(); await loaded(page); const s = await snapshot(page);
                locked(s, b, 'unconfirmed'); assert.equal(s.stats.proofs, 0);
                assert.equal(await page.evaluate(() => authPoc.revalidate()), true); locked(await snapshot(page), b, 'confirmed');
            });
            await scenario(`${channel}: full browser restart preserves Auth, not authority`, async () => {
                await page.evaluate(() => authPoc.close()); await context.close(); context = await launch();
                page = await context.newPage(); await page.goto(url); await loaded(page);
                locked(await snapshot(page), b, 'unconfirmed'); assert.equal((await snapshot(page)).stats.proofs, 0);
                assert.equal(await page.evaluate(() => authPoc.revalidate()), true);
            });
            await scenario(`${channel}: Emulator-only network failure and offline reload`, async () => {
                offlineAuth = true; assert.equal(await page.evaluate(() => authPoc.revalidate()), false);
                locked(await snapshot(page), b, 'unconfirmed');
                await page.reload(); await loaded(page); locked(await snapshot(page), b, 'unconfirmed');
                assert.equal((await snapshot(page)).stats.proofs, 0);
                assert.equal(await page.evaluate(() => authPoc.revalidate()), false);
                offlineAuth = false; assert.equal(await page.evaluate(() => authPoc.revalidate()), true);
            });
            await scenario(`${channel}: logout rejects stale callback and survives reload`, async () => {
                await page.evaluate(() => authPoc.captureCallback()); assert.equal(await page.evaluate(() => authPoc.logout()), true);
                assert.equal(await page.evaluate(() => authPoc.replayCallback()), false);
                await page.reload(); await loaded(page); const s = await snapshot(page);
                assert.equal(s.state.phase, 'signed-out'); assert.equal(s.state.owner, null); assert.equal(s.sdkUid, null); assert.equal(s.marker.revoked, true);
            });
            await scenario(`${channel}: failed signOut revocation survives reload and restart`, async () => {
                assert.equal(await page.evaluate(() => authPoc.login('A')), true);
                await page.evaluate(() => { authPoc.captureCallback(); authPoc.failSignOut(true); });
                await assert.rejects(page.evaluate(() => authPoc.logout()), /Synthetic signOut failure/);
                let s = await snapshot(page); assert.equal(s.sdkUid, a); assert.equal(s.state.owner, null); assert.equal(s.marker.revoked, true);
                assert.equal(await page.evaluate(() => authPoc.replayCallback()), false);
                await page.reload(); await loaded(page); s = await snapshot(page);
                assert.equal(s.sdkUid, a); assert.equal(s.state.phase, 'signed-out'); assert.equal(s.state.owner, null); assert.equal(s.stats.proofs, 0);
                await assert.rejects(page.evaluate(() => authPoc.revalidate()), /Revalidation forbidden/);
                await assert.rejects(page.evaluate(() => authPoc.clearMarker()), /SDK logout required/);
                await page.evaluate(() => authPoc.close()); await context.close(); context = await launch();
                page = await context.newPage(); await page.goto(url); await loaded(page); s = await snapshot(page);
                assert.equal(s.sdkUid, a); assert.equal(s.state.owner, null); assert.equal(s.stats.proofs, 0); assert.equal(s.marker.revoked, true);
                await assert.rejects(page.evaluate(() => authPoc.login('B')), /reconciliation required/);
                assert.equal(await page.evaluate(() => authPoc.logout()), true);
                assert.equal(await page.evaluate(() => authPoc.login('B')), true); locked(await snapshot(page), b, 'confirmed');
            });
            await scenario(`${channel}: suspension and resume do not auto-confirm`, async () => {
                const before = await snapshot(page); await page.evaluate(() => authPoc.captureCallback());
                await page.evaluate(() => authPoc.suspend()); assert.equal((await snapshot(page)).state.phase, 'suspended');
                await page.evaluate(() => authPoc.resume()); locked(await snapshot(page), b, 'unconfirmed');
                assert.equal(await page.evaluate(() => authPoc.replayCallback()), false);
                assert.equal((await snapshot(page)).stats.proofs, before.stats.proofs);
            });
            await scenario(`${channel}: controlled PoC-only cleanup and isolation`, async () => {
                assert.equal(await page.evaluate(() => authPoc.logout()), true); const before = await snapshot(page);
                await page.evaluate(() => authPoc.clearMarker()); const after = await snapshot(page);
                assert.equal(after.marker, null); assert.deepEqual(after.localKeys, before.localKeys.filter(key => key !== before.markerKey));
                assert.ok(after.localKeys.every(key => key.startsWith('firebase:')));
                assert.ok(after.databases.every(name => name.startsWith('firebase-')));
                assert.equal(after.observers, 1); assert.equal(after.stats.adapterOpens, 0); assert.equal(after.safe, true);
                assert.equal(after.state.data, null); assert.equal(after.state.inFlight, 0);
                assert.deepEqual(errors, []); assert.deepEqual(external, []);
            });
            await page.evaluate(() => authPoc.close()); await context.close(); context = null;
            console.log(`${channel}: synthetic profile retained ${profile}`);
        }
        console.log(`Auth Emulator browser PoC: ${passed} passed, 0 failed, 0 skipped; no application bootstrap or financial operations.`);
    } catch (error) { console.error(`Auth Emulator browser PoC failed after ${passed} approvals: ${error.message}`); throw error; }
    finally { await context?.close(); }
}

async function runAuthTabs() {
 let passed=0, unavailable=0;
 for(const channel of ['msedge','chrome']) {
  const run=crypto.randomUUID(), profile=await mkdtemp(path.join(tmpdir(), 'cf-auth-tabs-'+channel+'-'));
  const context=await chromium.launchPersistentContext(profile,{channel,headless:true,serviceWorkers:'block',ignoreDefaultArgs:['--disable-back-forward-cache']});
  const errors=[],external=[];
  await context.route('**/*',route=>[origin,authEmulatorOrigin].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  context.on('request',r=>{if(![origin,authEmulatorOrigin].includes(new URL(r.url()).origin))external.push(r.url());});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const url=origin+'/auth-poc?run='+run, uid=n=>'synthetic-auth-browser-'+n+'-'+run;
  const open=async()=>{const p=await context.newPage();await p.goto(url);await p.waitForFunction(()=>globalThis.authPoc?.ready);return p;};
  const snap=p=>p.evaluate(()=>authPoc.snapshot());
  const wait=async(p,owner,ownership)=>{await p.waitForFunction(async({owner,ownership})=>{const s=await authPoc.snapshot();return (s.state.owner?.uid||null)===owner && (!ownership||s.state.ownership===ownership);},{owner,ownership},{timeout:15000});};
  const ok=name=>{passed++;console.log(JSON.stringify({channel,scenario:name,result:'approved'}));};
  try {
   const a=await open();let b=await open();
   assert.equal(await a.evaluate(()=>authPoc.login('A')),true);await wait(b,uid('A'),'unconfirmed');await b.evaluate(()=>authPoc.revalidate());ok('login propagation and explicit B proof');
   await b.evaluate(()=>authPoc.captureCallback());await a.evaluate(()=>authPoc.logout());await wait(b,null);assert.equal(await b.evaluate(()=>authPoc.replayCallback()),false);ok('logout revokes other tab');
   await a.evaluate(()=>authPoc.login('A'));await wait(b,uid('A'),'unconfirmed');await b.evaluate(()=>authPoc.revalidate());
   await a.evaluate(()=>authPoc.failSignOut(true));await assert.rejects(a.evaluate(()=>authPoc.logout()),/Synthetic signOut failure/);await wait(b,null);await assert.rejects(b.evaluate(()=>authPoc.revalidate()),/Revalidation forbidden/);ok('failed signOut propagates durable revocation');
   await a.evaluate(()=>authPoc.failSignOut(false));await a.evaluate(()=>authPoc.logout());await a.evaluate(()=>authPoc.login('A'));await wait(b,uid('A'),'unconfirmed');await b.evaluate(()=>authPoc.captureCallback());
   await a.evaluate(()=>authPoc.login('B'));await wait(b,uid('B'),'unconfirmed');assert.equal(await b.evaluate(()=>authPoc.replayCallback()),false);ok('account switch rejects old callback');
   await b.close();b=await open();await wait(b,uid('B'),'unconfirmed');assert.equal((await snap(b)).stats.proofs,0);ok('tab reopen without old authority');
   for(const revoke of [false,true]) {
    await b.evaluate(()=>authPoc.revalidate());await b.goto(origin+'/auth-away');
    if(revoke)await a.evaluate(()=>authPoc.logout());
    await b.goBack({waitUntil:'commit'});await b.waitForFunction(()=>globalThis.authPoc?.ready);await wait(b,revoke?null:uid('B'),revoke?null:'unconfirmed');
    const s=await snap(b), real=s.pageEvents.some(e=>e.type==='pageshow'&&e.persisted);
    if(real){assert.ok(s.pageEvents.some(e=>e.type==='pagehide'&&e.persisted));ok(revoke?'BFCache logout while away':'BFCache restores unconfirmed');}
    else{unavailable++;console.log(JSON.stringify({channel,scenario:revoke?'BFCache revoked':'BFCache unconfirmed',result:'not-executed',reason:'pageshow.persisted=false',events:s.pageEvents}));}
    if(!revoke){assert.equal(await b.evaluate(()=>authPoc.revalidate()),true);assert.equal((await snap(b)).state.ownership,'confirmed');}
    else assert.equal(s.state.owner,null);
   }
   for(const p of [a,b]){const s=await snap(p);assert.equal(s.observers,1);assert.equal(s.stats.adapterOpens,0);assert.equal(s.safe,true);assert.equal(s.state.data,null);}
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);ok('single observer, no adapters, finances, page errors or external destinations');
  } finally {await context.close();console.log(channel+': retained '+profile);}
 }
 console.log(JSON.stringify({suite:'Auth Emulator tabs/BFCache',passed,failed:0,notExecuted:unavailable}));
}

async function runFinancialIdb() {
 let passed=0;
 for(const channel of ['msedge','chrome']){
  const comparisons=[], errors=[],external=[];
  for(const composed of [false,true]){
   const profile=await mkdtemp(path.join(tmpdir(),'cf-sync-idb-'+channel+'-')),run=crypto.randomUUID();
   const url=origin+'/auth-poc?run='+run+'&composition='+(composed?'1':'0');let context,page;
   const launch=async()=>{const c=await chromium.launchPersistentContext(profile,{channel,headless:true,serviceWorkers:'block'});c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));await c.route('**/*',route=>{const target=new URL(route.request().url()).origin;if([origin,authEmulatorOrigin,'http://127.0.0.1:8080'].includes(target))return route.continue();external.push(target);return route.abort();});return c;};
   const open=async()=>{page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>globalThis.financialPoc?.ready);};
   const inspect=()=>page.evaluate(()=>financialPoc.inspect());
   const checked=s=>{assert.equal(s.registrations,1);assert.equal(s.stats.adapterOpens,0);assert.equal(s.safe,true);assert.deepEqual(s.compositionErrors,[]);assert.deepEqual(s.failures,[]);};
   const points=[];const capture=async name=>{const s=await inspect();checked(s);const documents=structuredClone(s.documents);for(const row of documents)if(row.queue.lastConfirmed){assert.ok(Number.isFinite(Date.parse(row.queue.lastConfirmed)));row.queue.lastConfirmed='<validated-confirmation-time>'; }points.push({name,documents,acks:s.acks});return s;};
   try{
    context=await launch();await open();await page.evaluate(()=>financialPoc.loginA());await page.evaluate(()=>financialPoc.cycle());
    await page.evaluate(()=>financialPoc.queueIncome('synthetic-restart-pending',12.34));const pending=await capture('pending-before-reload');assert.equal(pending.queue.outbox.length,1);assert.equal(pending.acks.length,0);
    await page.reload();await page.waitForFunction(()=>globalThis.financialPoc?.ready);await page.evaluate(()=>financialPoc.loginA());const reloaded=await capture('pending-after-reload');assert.deepEqual(reloaded.documents,pending.documents);assert.equal(reloaded.acks.length,0);if(composed)assert.equal(reloaded.authPhase.ownership,'unconfirmed');
    await page.evaluate(()=>financialPoc.close());await context.close();context=await launch();await open();await page.evaluate(()=>financialPoc.loginA());const reopened=await capture('pending-after-process-restart');assert.deepEqual(reopened.documents,pending.documents);assert.deepEqual(reopened.acks,pending.acks);if(composed)assert.equal(reopened.authPhase.ownership,'unconfirmed');
    await page.evaluate(()=>financialPoc.cycle());const confirmed=await capture('confirmed-after-restart');assert.equal(confirmed.queue.outbox.length,0);assert.equal(confirmed.acks.length,1);assert.equal(confirmed.acks[0].id,pending.queue.outbox[0].id);assert.equal(confirmed.acks[0].ack.acknowledged,true);
    assert.equal((await page.evaluate(()=>financialPoc.remoteRecords())).length,1);
    await page.evaluate(()=>financialPoc.close());await context.close();context=await launch();await open();await page.evaluate(()=>financialPoc.loginA());const durable=await capture('confirmed-after-second-restart');assert.deepEqual(durable.documents,confirmed.documents);assert.deepEqual(durable.acks,confirmed.acks);
    await page.evaluate(()=>financialPoc.cycle());const retried=await capture('no-extra-ACK-on-retry');assert.equal(retried.acks.length,1);assert.equal((await page.evaluate(()=>financialPoc.remoteRecords())).length,1);
    await page.evaluate(()=>financialPoc.logout());const loggedOut=await capture('logout-preserves-documents');assert.deepEqual(loggedOut.documents,retried.documents);assert.deepEqual(loggedOut.acks,retried.acks);if(composed)assert.equal(loggedOut.authPhase.owner,null);
    comparisons.push(points);passed++;console.log(JSON.stringify({channel,scenario:composed?'composed IndexedDB restart':'control IndexedDB restart',result:'approved',checkpoints:points.length}));
   }finally{await page?.evaluate(()=>financialPoc.close()).catch(()=>{});await context?.close();console.log(channel+': synthetic profile retained '+profile);}
  }
  assert.deepEqual(comparisons[1],comparisons[0]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);passed++;console.log(JSON.stringify({channel,scenario:'exact IndexedDB state/revision/queue/ID/ACK equivalence',result:'approved'}));
 }
 console.log(JSON.stringify({suite:'financial IndexedDB restart',passed,failed:0,skipped:0}));
}
