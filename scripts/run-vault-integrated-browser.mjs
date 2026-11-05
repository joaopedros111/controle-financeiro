import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadRealEmulatorFactory } from '../tests/fixtures/vault-real-emulator-factory.mjs';
import { recordEntityKey, makeOperation } from '../sync-core.js';
import { clickAndWait } from '../tests/fixtures/vault-ui-action.mjs';
if (process.env.LOCAL_VAULT_EMULATORS !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Explicit integrated loopback emulators required');
const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['experimental/finance-vault-integrated-browser.js'], bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:8080 http://127.0.0.1:9099; style-src 'self'; base-uri 'none'; object-src 'none'");
    if (url.pathname === '/integrated.js') return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].contents);
    if (url.pathname !== '/') return res.writeHead(404).end();
    if (url.searchParams.get('experimental_vault') !== '1') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><p>Explicit experimental vault configuration required.</p>');
    const run = url.searchParams.get('run'); if (!/^synthetic-[A-Za-z0-9_-]{1,55}$/.test(run || '')) return res.writeHead(400).end();
    const config = { experimentalVault: true, projectId: 'demo-vault-integration', authEmulator: 'http://127.0.0.1:9099', firestoreEmulator: 'http://127.0.0.1:8080',
        databaseName: `controleFinanceiro:cofre-isolado:v1:synthetic-integrated-${run}`, accounts: [`synthetic-integrated-${run}-A`, `synthetic-integrated-${run}-B`] };
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><meta charset="utf-8"><title>Cofre — ensaio integrado sintético</title>
        <h1>Ensaio sintético isolado</h1><p>Estado: <output id="phase">booting</output> | Conta: <output id="owner"></output></p>
        <select id="account" aria-label="Conta sintética"></select><button id="login">Entrar</button><button id="logout">Sair</button>
        <label>Senha do cofre <input id="password" type="password" autocomplete="off"></label><button id="create">Criar cofre</button><button id="unlock">Desbloquear</button><button id="lock">Bloquear</button>
        <p>Segredo novo (guardar fora do perfil): <output id="new-secret"></output></p><label>Segredo de recuperação <input id="recovery-secret" type="password" autocomplete="off"></label>
        <label><input id="custody" type="checkbox">Custódia externa declarada</label><button id="confirm-custody">Confirmar custódia</button><button id="recover">Recuperar acesso</button>
        <p>Pendentes: <output id="pending">?</output> | Conflitos/histórico: <output id="conflicts">0</output></p><p id="error" role="alert"></p><p id="action-error" role="alert"></p>
        <label>Nome sintético <input id="record-name" autocomplete="off"></label><label>Valor <input id="record-value" type="number" step="0.01"></label>
        <button id="add-income">Receita</button><button id="add-expense">Despesa</button><button id="edit-record">Editar primeira receita</button><button id="delete-record">Excluir despesas</button><button id="sync">Sincronizar</button><button id="restore-fixture">Restaurar fixture sintética</button><ul id="finance"></ul>
        <script>globalThis.integratedConfiguration=${JSON.stringify(config)}</script><script type="module" src="/integrated.js"></script>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
let context, peer, passed = 0; const blocked = [];
const phase = async (page, expected) => { try { await page.waitForFunction(expected => [].concat(expected).includes(document.getElementById('phase').textContent), expected, { timeout: 45000 }); }
    catch { const state = await page.evaluate(() => ({ phase: document.getElementById('phase')?.textContent, error: document.getElementById('error')?.textContent, action: document.getElementById('action-error')?.textContent })); throw new Error(`Expected phase ${JSON.stringify(expected)}; diagnostic ${JSON.stringify(state)}`); } };
const snapshot = page => page.evaluate(async () => { for (let i = 0; i < 15; i++) { try { return await integratedQA.snapshot(); } catch (e) { if (e.code !== 'stale-revision') throw e; await new Promise(r => setTimeout(r, 10)); } } throw new Error('Synthetic snapshot contention'); });
const records = s => Object.values(s.documents[`estado:${s.catalog.owner.uid}`].dados.meses).flatMap(m => [...m.receitas, ...m.despesas]);
async function login(page, uid, expected) { await page.selectOption('#account', uid); await page.click('#login'); await phase(page, expected); }
async function unlock(page) { await page.fill('#password', 'synthetic-integrated-browser-password'); await page.click('#unlock'); await phase(page, ['synced', 'recovery-history']); }
async function create(page) {
    await page.fill('#password', 'synthetic-integrated-browser-password'); await page.click('#create'); await phase(page, 'custody');
    const secret = await page.locator('#new-secret').textContent(); assert.ok(secret); assert.equal(await page.locator('#add-income').isDisabled(), true);
    assert.equal(await page.locator('#finance').textContent(), ''); await page.fill('#recovery-secret', secret); await page.check('#custody'); await page.click('#confirm-custody'); await phase(page, 'synced'); return secret;
}
async function add(page, type, name, value) { await page.fill('#record-name', name); await page.fill('#record-value', String(value)); await page.click(type === 'income' ? '#add-income' : '#add-expense'); }
async function until(fn) { for (let i = 0; i < 180; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Integrated assertion timed out'); }
try {
    for (const channel of ['msedge', 'chrome']) {
        const run = `synthetic-${crypto.randomUUID()}`, uidA = `synthetic-integrated-${run}-A`, uidB = `synthetic-integrated-${run}-B`, url = `${origin}/?experimental_vault=1&run=${run}`;
        const profile = await mkdtemp(path.join(tmpdir(), `cf-integrated-${channel}-`));
        const launch = async () => {
            const c = await chromium.launchPersistentContext(profile, { channel, headless: true, serviceWorkers: 'block' });
            await c.route('**/*', route => { const target = new URL(route.request().url());
                if ([origin, 'http://127.0.0.1:8080', 'http://127.0.0.1:9099'].includes(target.origin)) return route.continue();
                blocked.push(target.origin); return route.abort('blockedbyclient');
            }); return c;
        };
        context = await launch(); let page = await context.newPage(); const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(`${channel}: UI error ${e.name}: ${e.message}`); });
        console.log(`${channel}: integrated profile started.`);
        await page.goto(origin); assert.deepEqual(await page.evaluate(() => indexedDB.databases()), []); passed++;
        await page.goto(url); await phase(page, 'signed-out'); await login(page, uidA, 'missing');
        assert.equal(await page.locator('#finance').textContent(), ''); const secretA = await create(page); passed++;
        console.log(`${channel}: creation and independent recovery/custody passed.`);
        await add(page, 'income', 'SYNTHETIC A INCOME', 123.45); await phase(page, 'synced'); await until(async () => records(await snapshot(page)).length === 1);
        await add(page, 'expense', 'SYNTHETIC A EXPENSE', 19.87); await until(async () => records(await snapshot(page)).length === 2); await phase(page, 'synced');
        const createdIds = records(await snapshot(page)).map(r => r.id);
        await page.fill('#record-value', '222.22'); await page.click('#edit-record'); await until(async () => records(await snapshot(page))[0].valor === 222.22); await phase(page, 'synced');
        await page.click('#delete-record'); await until(async () => records(await snapshot(page)).length === 1); await phase(page, 'synced'); passed++;
        console.log(`${channel}: create/edit/delete and global ACK passed.`);
        const sdk = await loadRealEmulatorFactory(); peer = sdk; const remote = sdk.criarFirebaseSync({ projectId: 'demo-vault-integration', apiKey: 'demo-only', appId: 'synthetic-integrated-peer' }); await sdk.login(uidA);
        assert.ok((await remote.generationSnapshot(uidA)).records.some(r => r.deleted)); passed++;
        await page.click('#lock'); await phase(page, 'locked'); assert.equal(await page.locator('#finance').textContent(), ''); assert.equal(await page.locator('#pending').textContent(), '?');
        await page.fill('#password', 'synthetic-wrong-password'); await page.click('#unlock'); await phase(page, 'locked'); assert.equal(await page.locator('#finance').textContent(), ''); assert.equal(await page.locator('#add-income').isDisabled(), true);
        await unlock(page); assert.equal(records(await snapshot(page))[0].valor, 222.22); passed++;
        await context.setOffline(true); await phase(page, 'offline'); await add(page, 'income', 'SYNTHETIC OFFLINE INCOME', 33.33);
        await until(async () => (await snapshot(page)).documents[`fila:${uidA}`].outbox.length === 1); const pendingId = (await snapshot(page)).documents[`fila:${uidA}`].outbox[0].id;
        assert.notEqual(await page.locator('#phase').textContent(), 'synced'); await context.setOffline(false); await phase(page, 'synced');
        assert.equal((await snapshot(page)).documents[`fila:${uidA}`].outbox.length, 0); assert.ok((await remote.generationSnapshot(uidA)).records.some(r => r.revision === pendingId)); passed++;
        await context.setOffline(true); await phase(page, 'offline'); await page.fill('#record-value', '44.44'); await page.click('#edit-record');
        await until(async () => (await snapshot(page)).documents[`fila:${uidA}`].outbox.length === 1);
        const remoteBefore = await remote.generationSnapshot(uidA), original = remoteBefore.records.find(r => !r.deleted && r.record.nome === 'SYNTHETIC A INCOME');
        const competing = makeOperation(recordEntityKey(original), { month: original.month, type: original.type, id: original.id, record: { ...original.record, valor: 55.55 }, deleted: false }, original.revision);
        await remote.commit(uidA, competing); await context.setOffline(false); await phase(page, 'synced');
        await until(async () => records(await snapshot(page)).some(r => r.valor === 55.55)); const conflicted = await snapshot(page);
        assert.ok(conflicted.documents[`fila:${uidA}`].automaticHistory.some(h => JSON.stringify(h.local).includes('44.44'))); passed++;
        console.log(`${channel}: offline retry and real server conflict preservation passed.`);
        await page.evaluate(() => integratedQA.holdAck()); await add(page, 'income', 'SYNTHETIC DELAYED ACK', 66.66);
        await until(() => page.evaluate(() => integratedQA.ackApplied())); assert.notEqual(await page.locator('#phase').textContent(), 'synced');
        const delayedOperation = (await snapshot(page)).documents[`fila:${uidA}`].outbox.find(o => o.value.record?.nome === 'SYNTHETIC DELAYED ACK');
        assert.ok(delayedOperation); await page.click('#logout'); await phase(page, 'signed-out'); assert.equal(await page.locator('#finance').textContent(), '');
        await login(page, uidB, 'missing'); const secretB = await create(page); assert.notEqual(secretA, secretB); assert.equal(records(await snapshot(page)).length, 0);
        assert.equal(await page.evaluate(({ uid, key }) => integratedQA.foreignRead(uid, key), { uid: uidA, key: recordEntityKey(original) }), 'permission-denied');
        await page.evaluate(() => integratedQA.releaseAck()); await login(page, uidA, 'locked'); await unlock(page); await phase(page, 'synced');
        assert.equal((await remote.generationSnapshot(uidA)).records.filter(r => r.record?.nome === 'SYNTHETIC DELAYED ACK').length, 1); passed++;
        console.log(`${channel}: delayed ACK, logout and A-B-A passed.`);
        await login(page, uidA, 'locked'); assert.equal(await page.locator('#finance').textContent(), ''); await unlock(page); passed++;
        await page.evaluate(() => integratedQA.holdAck()); await add(page, 'income', 'SYNTHETIC PROCESS ACK', 77.77); await until(() => page.evaluate(() => integratedQA.ackApplied()));
        const interruptedId = (await snapshot(page)).documents[`fila:${uidA}`].outbox.find(o => o.value.record?.nome === 'SYNTHETIC PROCESS ACK').id;
        await context.close(); context = null; context = await launch(); page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(url); await phase(page, 'signed-out'); await login(page, uidA, 'locked'); await context.setOffline(true);
        await page.fill('#password', 'synthetic-integrated-browser-password'); await page.click('#unlock'); await phase(page, 'offline');
        const interruptedQueue = (await snapshot(page)).documents[`fila:${uidA}`]; assert.ok(interruptedQueue.outbox.some(o => o.id === interruptedId)); assert.ok(interruptedQueue.attempted[interruptedId]);
        await context.setOffline(false); await phase(page, 'synced'); assert.equal((await remote.generationSnapshot(uidA)).records.filter(r => r.record?.nome === 'SYNTHETIC PROCESS ACK').length, 1); passed++;
        console.log(`${channel}: full process restart after lost SDK ACK passed.`);
        await context.setOffline(true); await phase(page, 'offline'); const beforeQuota = await snapshot(page); await page.evaluate(() => integratedQA.fault('quota'));
        await add(page, 'income', 'SYNTHETIC QUOTA REJECTED', 99.99); await phase(page, 'error'); assert.equal(await page.locator('#finance').textContent(), '');
        await page.fill('#password', 'synthetic-integrated-browser-password'); await page.click('#unlock'); await phase(page, 'offline');
        assert.deepEqual((await snapshot(page)).documents[`estado:${uidA}`], beforeQuota.documents[`estado:${uidA}`]); passed++;
        await page.fill('#record-name', 'SYNTHETIC READ REJECTED'); await page.fill('#record-value', '88.88');
        await page.evaluate(() => { if (document.getElementById('add-income').disabled) throw new Error('Expected an unlocked UI'); integratedQA.fault('read'); document.getElementById('add-income').click(); });
        await phase(page, 'error'); assert.equal(await page.locator('#finance').textContent(), '');
        await page.fill('#password', 'synthetic-integrated-browser-password'); await page.click('#unlock'); await phase(page, 'offline');
        assert.deepEqual((await snapshot(page)).documents[`estado:${uidA}`], beforeQuota.documents[`estado:${uidA}`]); passed++;
        console.log(`${channel}: quota preservation and independent access recovery passed.`);
        await page.click('#lock'); await phase(page, 'locked'); await page.fill('#recovery-secret', secretA); await page.click('#recover'); await phase(page, 'offline');
        assert.deepEqual((await snapshot(page)).documents[`estado:${uidA}`], beforeQuota.documents[`estado:${uidA}`]); passed++;
        await add(page, 'income', 'SYNTHETIC INTERRUPTED RESTORE', 11.11); await until(async () => (await snapshot(page)).documents[`fila:${uidA}`].outbox.length > 0);
        const oldQueue = (await snapshot(page)).documents[`fila:${uidA}`]; await clickAndWait(page, 'restore-fixture'); await until(async () => !!(await snapshot(page)).documents[`fila:${uidA}`].restoreJob);
        const staged = await snapshot(page), recoveryKey = staged.documents[`fila:${uidA}`].recoveryKeys.at(-1); assert.deepEqual(staged.documents[recoveryKey].queue.outbox, oldQueue.outbox);
        console.log(`${channel}: interrupted restore staged; closing browser process.`);
        await context.close(); context = null; context = await launch(); page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(url); await phase(page, 'signed-out');
        assert.equal(await page.locator('#finance').textContent(), ''); await login(page, uidA, 'locked'); await unlock(page); await phase(page, ['synced', 'recovery-history']);
        await until(async () => (await snapshot(page)).documents[`fila:${uidA}`].restoreJob === null); const resumed = await snapshot(page);
        assert.ok(resumed.documents[recoveryKey]); assert.equal((await remote.generationSnapshot(uidA)).generation, resumed.generation);
        assert.equal(resumed.documents[`fila:${uidA}`].outbox.length, 0); assert.ok(resumed.documents[`fila:${uidA}`].recoveryNotices.some(n => !n.acknowledged)); passed++;
        const raw = await page.evaluate(() => integratedQA.inspect()), encoded = JSON.stringify(raw.banks);
        assert.equal(raw.local, 0); assert.equal(raw.session, 0); assert.equal(raw.caches, 0);
        for (const marker of ['SYNTHETIC A INCOME', 'SYNTHETIC A EXPENSE', 'SYNTHETIC OFFLINE INCOME', '123.45', '19.87', '222.22', '33.33', '55.55', '66.66', '77.77', '87.65', 'synthetic-integrated-browser-password', secretA, secretB, ...createdIds, ...records(resumed).map(r => r.id)]) assert.ok(!encoded.includes(marker));
        assert.ok(raw.names.every(n => n.startsWith(`controleFinanceiro:cofre-isolado:v1:synthetic-integrated-${run}`) || n === 'firebase-heartbeat-database'));
        const heartbeat = raw.banks.find(b => b.databaseName === 'firebase-heartbeat-database');
        if (heartbeat) assert.ok(Object.entries(heartbeat).filter(([key]) => key !== 'databaseName').every(([, rows]) => rows.every(row => Object.keys(row).every(key => ['heartbeats', 'lastSentHeartbeatDate'].includes(key)))));
        passed++;
        assert.deepEqual(errors, []); await page.evaluate(() => integratedQA.close()); await context.close(); context = null; await sdk.close(); peer = null;
        console.log(`${channel}: integrated Auth/UI/vault/IDB/Firestore scenarios passed. Profile retained: ${profile}`);
    }
    assert.deepEqual(blocked, []); console.log(`Integrated browser QA: ${passed} passed, 0 failed, 0 skipped; 0 production requests.`);
} finally { await peer?.close(); await context?.close(); await new Promise(r => server.close(r)); }
