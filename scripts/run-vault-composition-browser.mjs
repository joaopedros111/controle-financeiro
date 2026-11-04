import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { clickAndWait } from '../tests/fixtures/vault-ui-action.mjs';
import { loadRealEmulatorFactory } from '../tests/fixtures/vault-real-emulator-factory.mjs';
if (process.env.LOCAL_VAULT_EMULATORS !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Explicit loopback emulators required');
const password = 'synthetic-composition-password';
const cp05Only = process.env.VAULT_COMPOSITION_CP05_ONLY === '1';
const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['tests/fixtures/vault-composition-browser.mjs'], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
const server = createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:8080 http://127.0.0.1:9099; base-uri 'none'; object-src 'none'");
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/bundle.js') return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].contents);
    if (url.pathname === '/away') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Synthetic away</title>');
    if (url.pathname !== '/') return res.writeHead(404).end();
    const run = url.searchParams.get('run');
    if (url.searchParams.get('experimental_vault') !== '1') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><p>Explicit synthetic opt-in required</p>');
    if (!/^synthetic-[\w-]{1,55}$/.test(run || '')) return res.writeHead(400).end();
    const config = { experimentalVault: true, projectId: 'demo-vault-integration', authEmulator: 'http://127.0.0.1:9099', firestoreEmulator: 'http://127.0.0.1:8080', databaseName: `controleFinanceiro:cofre-isolado:v1:synthetic-integrated-composition-${run}`, accounts: [`synthetic-integrated-${run}-A`, `synthetic-integrated-${run}-B`] };
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><meta charset="utf-8"><title>Composição experimental sintética</title>
    <h1>Ensaio isolado</h1><output id="phase">initializing</output><output id="owner"></output><output id="sync-state"></output><output id="pending">?</output>
    <select id="account" aria-label="Conta sintética"></select><button id="login">Entrar</button><button id="logout">Sair</button><button id="offline-open">Abrir local offline</button>
    <label>Senha <input id="password" type="password" autocomplete="off"></label><button id="create">Criar</button><button id="unlock">Desbloquear</button><button id="lock">Bloquear</button>
    <output id="new-secret"></output><label>Recuperação <input id="recovery-secret" type="password" autocomplete="off"></label><label><input id="custody" type="checkbox">Custódia externa</label><button id="confirm">Confirmar</button><button id="recover">Recuperar</button>
    <input id="record-name" aria-label="Nome sintético"><input id="record-value" type="number" step="0.01" aria-label="Valor sintético"><button id="add-income">Receita</button><button id="sync">Sincronizar</button>
    <p id="error" role="alert"></p><p id="action-error" role="alert"></p><ul id="finance"></ul><a href="/away">Sair da página de teste</a>
    <script>globalThis.compositionConfiguration=${JSON.stringify(config)}</script><script type="module" src="/bundle.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
let context, sdk; const requests = [], errors = []; let passed = 0;
const wait = async (p, fn) => { try { await p.waitForFunction(fn, undefined, { timeout: 45000 }); } catch (e) { console.error(await p.evaluate(() => ({ phase: document.getElementById('phase')?.textContent, error: document.getElementById('error')?.textContent, action: document.getElementById('action-error')?.textContent }))); throw e; } };
const phase = (p, expected) => p.waitForFunction(value => [].concat(value).includes(document.getElementById('phase').textContent), expected, { timeout: 45000 });
const synced = p => wait(p, () => compositionQA.view().sync === 'synced');
const snapshot = p => p.evaluate(() => compositionQA.snapshot());
const q = (s, uid) => s.documents[`fila:${uid}`];
async function login(p, uid, expected = 'locked') { await p.selectOption('#account', uid); await clickAndWait(p, 'login'); await phase(p, expected); }
async function unlock(p) { await p.fill('#password', password); await clickAndWait(p, 'unlock'); await phase(p, ['unlocked', 'pending']); }
async function create(p) { await p.fill('#password', password); await clickAndWait(p, 'create'); await phase(p, 'custody'); assert.equal(await p.locator('#finance').textContent(), '');
    const secret = await p.locator('#new-secret').textContent(); assert.ok(secret); await p.fill('#password', password); await p.fill('#recovery-secret', secret); await p.check('#custody'); await clickAndWait(p, 'confirm'); await synced(p); return secret; }
async function add(p, name) { await p.fill('#record-name', name); await p.fill('#record-value', '123.45'); return clickAndWait(p, 'add-income'); }
try {
    for (const channel of ['msedge', 'chrome']) {
        const run = `synthetic-${crypto.randomUUID()}`, a = `synthetic-integrated-${run}-A`, b = `synthetic-integrated-${run}-B`, url = `${origin}/?experimental_vault=1&run=${run}`;
        const profile = await mkdtemp(path.join(tmpdir(), `cf-composition-${channel}-`));
        const launch = async () => { const c = await chromium.launchPersistentContext(profile, { channel, headless: true, serviceWorkers: 'block', ignoreDefaultArgs: ['--disable-back-forward-cache'] });
            const entries = new WeakMap(); c.on('request', r => { const entry = { url: r.url(), failure: null, response: false }; requests.push(entry); entries.set(r, entry); });
            c.on('requestfailed', r => { if (entries.has(r)) entries.get(r).failure = r.failure()?.errorText; });
            c.on('response', r => { if (entries.has(r.request())) entries.get(r.request()).response = true; }); return c; };
        context = await launch(); let page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(origin);
        assert.deepEqual(await page.evaluate(() => indexedDB.databases()), []); passed++;
        await page.goto(url); await phase(page, 'signed-out'); await login(page, a, 'missing'); assert.equal(await page.locator('#finance').textContent(), ''); passed++;
        const secretA = await create(page); await add(page, 'SYNTHETIC INITIAL'); await synced(page); assert.equal(q(await snapshot(page), a).outbox.length, 0); passed++;
        console.log(`${channel}: real Auth + lifecycle + custody + automatic ACK passed.`);
        sdk = await loadRealEmulatorFactory(); const remote = sdk.criarFirebaseSync({ projectId: 'demo-vault-integration', apiKey: 'demo-only', appId: 'synthetic-composition-peer' }); await sdk.login(a);
        if (cp05Only) {
            const peer = await context.newPage(); peer.on('pageerror', e => errors.push(e.message));
            await peer.goto(url); await phase(peer, 'signed-out'); await login(peer, a); await unlock(peer); await synced(peer);
            for (let iteration = 0; iteration < 3; iteration++) {
                await wait(page, () => !compositionQA.diagnostics().syncRunning);
                await page.evaluate(() => compositionQA.holdSnapshot());
                const syncing = clickAndWait(page, 'sync'); await wait(page, () => compositionQA.snapshotEntered());
                try {
                    await add(peer, `SYNTHETIC CP05 PEER ${iteration}`); await synced(peer);
                    assert.equal(q(await snapshot(peer), a).outbox.length, 0, 'peer ACK precedes delivery of the retained snapshot');
                } finally { await page.evaluate(() => compositionQA.releaseSnapshot()); }
                await syncing; await synced(page); await synced(peer);
                const evidence = await page.evaluate(() => compositionQA.evidence());
                assert.equal(evidence.equivalent, true); assert.equal(evidence.localCount, iteration + 2);
                assert.equal(evidence.remoteCount, iteration + 2); assert.equal(evidence.outbox, 0);
                for (const p of [page, peer]) {
                    assert.equal(await p.locator('#error').textContent(), '');
                    assert.equal(await p.evaluate(() => compositionQA.diagnostics().syncPermanent), false);
                }
                passed++;
                console.log(`${channel}: CP-05 retained snapshot / peer actual ACK / fresh retry ${iteration + 1} passed.`);
            }
            await peer.evaluate(() => compositionQA.close()); await peer.close();
            await page.evaluate(() => compositionQA.close()); await context.close(); context = null;
            await sdk.close(); sdk = null;
            console.log(`${channel}: CP-05 synthetic profile retained ${profile}`);
            continue;
        }
        await context.setOffline(true); await page.evaluate(() => compositionQA.holdWrite());
        const writing = add(page, 'SYNTHETIC DRAINED'); await wait(page, () => compositionQA.writeEntered());
        const leaving = clickAndWait(page, 'logout'); await phase(page, 'closing'); assert.equal(await page.locator('#finance').textContent(), ''); assert.equal(await page.locator('#add-income').isDisabled(), true);
        console.log(`${channel}: closing gate reached, releasing local write.`);
        await page.evaluate(() => compositionQA.releaseWrite()); await writing; await leaving; await phase(page, 'signed-out');
        await context.setOffline(false); await login(page, a); await context.setOffline(true); await unlock(page); assert.equal(q(await snapshot(page), a).outbox.length, 1); passed++;
        await context.setOffline(false); await synced(page); console.log(`${channel}: logout drained local commit before Auth signout.`);
        await page.evaluate(() => compositionQA.holdAck()); await add(page, 'SYNTHETIC DELAYED ACK'); await wait(page, () => compositionQA.ackApplied());
        const delayed = q(await snapshot(page), a).outbox; assert.equal(delayed.length, 1); assert.notEqual(await page.locator('#sync-state').textContent(), 'synced');
        await clickAndWait(page, 'logout'); await phase(page, 'signed-out'); await login(page, b, 'missing'); const secretB = await create(page);
        assert.equal(await page.locator('#finance').textContent(), ''); assert.equal(await page.evaluate(uid => compositionQA.foreignRead(uid), a), 'permission-denied');
        await login(page, a); await context.setOffline(true); await unlock(page); assert.deepEqual(q(await snapshot(page), a).outbox, delayed);
        await page.evaluate(() => compositionQA.releaseAck()); assert.deepEqual(q(await snapshot(page), a).outbox, delayed); passed++;
        await context.setOffline(false); await synced(page); assert.equal((await remote.generationSnapshot(a)).records.filter(r => r.record?.nome === 'SYNTHETIC DELAYED ACK').length, 1); passed++;
        console.log(`${channel}: delayed actual SDK ACK, A-B-A and cross-owner rule passed.`);
        await clickAndWait(page, 'logout'); await context.setOffline(true); await page.click('#login'); await phase(page, 'error'); assert.equal(await page.locator('#finance').textContent(), '');
        await clickAndWait(page, 'offline-open'); await unlock(page); assert.equal(await page.evaluate(() => compositionQA.lifecycle().ownership), 'unconfirmed');
        await add(page, 'SYNTHETIC OFFLINE RESTART'); const beforeRestart = (await snapshot(page)).documents; passed++;
        await context.close(); context = await launch(); page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(url); await phase(page, 'signed-out');
        await context.setOffline(true); await clickAndWait(page, 'offline-open'); await page.fill('#password', 'synthetic-wrong-password'); await page.click('#unlock'); await phase(page, 'locked'); assert.equal(await page.locator('#finance').textContent(), '');
        await unlock(page); assert.deepEqual((await snapshot(page)).documents, beforeRestart); passed++;
        await context.setOffline(false); await page.locator('a').click(); await page.waitForURL(`${origin}/away`); await page.goBack({ waitUntil: 'commit' });
        await wait(page, () => compositionQA.persisted()); await page.evaluate(() => compositionQA.resumed()); await phase(page, 'locked'); assert.equal(await page.locator('#finance').textContent(), '');
        await unlock(page); assert.deepEqual((await snapshot(page)).documents, beforeRestart); passed++;
        await login(page, a); assert.equal(await page.locator('#finance').textContent(), ''); await unlock(page); await synced(page); assert.equal(q(await snapshot(page), a).outbox.length, 0); passed++;
        console.log(`${channel}: Auth unavailable, explicit offline restart, real BFCache and reauthentication passed.`);
        const peer = await context.newPage(); peer.on('pageerror', e => errors.push(e.message)); await peer.goto(url); await phase(peer, 'signed-out'); await login(peer, a); await unlock(peer); await synced(peer);
        await Promise.all([add(page, 'SYNTHETIC TAB ONE'), add(peer, 'SYNTHETIC TAB TWO')]); await synced(page); await synced(peer);
        const records = (await remote.generationSnapshot(a)).records; assert.ok(records.some(r => r.record?.nome === 'SYNTHETIC TAB ONE')); assert.ok(records.some(r => r.record?.nome === 'SYNTHETIC TAB TWO')); passed++;
        const cdp = await context.newCDPSession(peer); await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await clickAndWait(page, 'logout'); await cdp.send('Page.setWebLifecycleState', { state: 'active' });
        await phase(peer, ['recovery-required', 'error']); assert.equal(await peer.locator('#finance').textContent(), ''); assert.equal(await peer.locator('#add-income').isDisabled(), true); passed++;
        await login(peer, b); await unlock(peer); await synced(peer); assert.equal(await peer.locator('#finance').textContent(), ''); passed++;
        await login(page, a); await unlock(page); await synced(page); await context.setOffline(true); const beforeQuota = (await snapshot(page)).documents;
        await page.evaluate(() => compositionQA.quota()); await page.fill('#record-name', 'SYNTHETIC REJECTED'); await page.fill('#record-value', '123.45'); await page.click('#add-income'); await phase(page, 'error'); assert.equal(await page.locator('#finance').textContent(), '');
        await unlock(page); assert.deepEqual((await snapshot(page)).documents, beforeQuota); passed++;
        await add(page, 'SYNTHETIC RECOVERY LATEST'); const latest = (await snapshot(page)).documents; await clickAndWait(page, 'lock'); await page.fill('#recovery-secret', secretA); await clickAndWait(page, 'recover'); await phase(page, ['unlocked', 'pending']);
        assert.deepEqual((await snapshot(page)).documents, latest); passed++;
        console.log(`${channel}: concurrent tabs, frozen durable revocation, quota and latest recovery passed.`);
        const raw = await page.evaluate(() => compositionQA.inspect()), encoded = JSON.stringify(raw.banks);
        for (const marker of [password, secretA, secretB, 'SYNTHETIC INITIAL', 'SYNTHETIC DRAINED', 'SYNTHETIC DELAYED ACK', 'SYNTHETIC RECOVERY LATEST', '123.45', ...Object.values(latest[`estado:${a}`].dados.meses).flatMap(m => [...m.receitas, ...m.despesas]).map(r => r.id)]) assert.ok(!encoded.includes(marker));
        assert.equal(raw.local, 0); assert.equal(raw.session, 0); assert.equal(raw.caches, 0); passed++;
        await peer.evaluate(() => compositionQA.close()); await peer.close(); await page.evaluate(() => compositionQA.close()); await context.close(); context = null; await sdk.close(); sdk = null;
        console.log(`${channel}: synthetic profile retained ${profile}`);
    }
    assert.deepEqual(errors, []);
    const unexpected = requests.filter(r => ![origin, 'http://127.0.0.1:8080', 'http://127.0.0.1:9099'].includes(new URL(r.url).origin));
    const diagnostics = unexpected.map(r => ({ origin: new URL(r.url).origin, path: new URL(r.url).pathname, failure: r.failure, response: r.response }));
    console.log(JSON.stringify({ blockedDiagnosticProbes: diagnostics }));
    // WebChannel's documented-in-source cleardot connectivity image is attempted
    // after offline errors. CSP must block it; no external response is accepted.
    assert.ok(diagnostics.every(r => r.origin === 'https://www.google.com' && r.path === '/images/cleardot.gif' && ['csp', 'net::ERR_BLOCKED_BY_CSP'].includes(r.failure) && r.response === false));
    console.log(cp05Only
        ? `CP-05 composition QA: ${passed} passed, 0 failed, 0 skipped; 3 deterministic interleavings per engine + synthetic setup; real Auth/Firestore Emulator; 0 external connections.`
        : `Composition QA: ${passed} passed, 0 failed, 0 skipped; real BFCache + Auth/Firestore Emulator both engines; 0 external connections (CSP-blocked diagnostic attempts counted above).`);
} catch (error) {
    for (const p of context?.pages() || []) { try { const diagnostic = await p.evaluate(async () => globalThis.compositionQA ? { state: compositionQA.diagnostics(), evidence: await compositionQA.evidence().catch(e => ({ error: e.code })), trace: compositionQA.trace() } : null); if (diagnostic) console.error(JSON.stringify(diagnostic)); } catch {} }
    throw error;
} finally { await sdk?.close(); await context?.close(); await new Promise(r => server.close(r)); }
