import { test, expect, chromium } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { recordEntityKey } from '../sync-core.js';
const project = 'demo-controle-financeiro-google-only';
const authURL = 'http://127.0.0.1:9199';
if (process.env.LOCAL_TEST_GOOGLE_ACCOUNT !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9199') throw new Error('Dedicated synthetic Emulators required');
const errors = new WeakMap(), monitoredPages = new Set();
async function setup(context, page) {
    const seen = []; errors.set(page, seen); monitoredPages.add(page); page.on('pageerror', error => seen.push(error.message));
    await context.route('**/*', route => {
        const host = new URL(route.request().url()).hostname;
        return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort('blockedbyclient');
    });
    page.on('dialog', dialog => dialog.dismiss());
}
async function account(request, name = 'A') {
    const email = `synthetic-${name.toLowerCase()}-${crypto.randomUUID()}@local.test`;
    const response = await request.post(`${authURL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only`, {
        data: { email, password: 'synthetic-password-only', returnSecureToken: true }
    });
    expect(response.ok()).toBe(true); const data = await response.json(); return { email, uid: data.localId };
}
async function openOptions(page) { if (!await page.locator('#dialogo-ajustes').isVisible()) await page.locator('#abrir-ajustes').click(); }
async function closeOptions(page) { if (await page.locator('#dialogo-ajustes').isVisible()) await page.locator('#fechar-ajustes').click(); }
async function signIn(page, user, { keepSeparate = false } = {}) {
    await page.bringToFront(); await page.evaluate(email => { window.__testEmail = email; }, user.email);
    await openOptions(page); await expect(page.locator('#entrar-google')).toBeEnabled(); await page.locator('#entrar-google').click();
    await expect(page.locator('#conta-sincronizacao')).toContainText(user.email);
    if (keepSeparate) { await openRecovery(page); await page.locator('#manter-fontes-separadas').click(); }
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado'); await closeOptions(page);
}
async function stored(page, key) {
    return page.evaluate(async key => {
        // Native read-only inspection works offline without fetching a second module URL.
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('controleFinanceiro:integridade:v1', 2);
            request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected existing financial database')); };
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        try { return await new Promise((resolve, reject) => {
            const tx = db.transaction('documents', 'readonly'); const request = tx.objectStore('documents').get(key); let value;
            request.onsuccess = () => { value = request.result ?? null; }; tx.oncomplete = () => resolve(value); tx.onabort = () => reject(tx.error);
        }); } finally { db.close(); }
    }, key);
}
async function addIncome(page, name = 'SYNTHETIC INCOME', amount = '125') {
    await closeOptions(page); await page.locator('#adicionar-receita').click();
    await page.locator('#receita-nome').fill(name); await page.locator('#receita-valor').fill(amount);
    await page.locator('#receita-repetir').uncheck(); await page.locator('#form-receita button[type="submit"]').click();
    await expect(page.locator('#dialogo-receita')).not.toBeVisible();
}
async function synced(page) { await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado'); }
async function chooseDelete(page) {
    await openOptions(page); page.removeAllListeners('dialog'); page.on('dialog', d => d.accept());
    await page.locator('#sair-google').click(); await expect(page.locator('#dialogo-sair-local')).toBeVisible();
    await page.locator('#sair-delete-confirmed').click();
}
async function openRecovery(page) {
    if (!await page.locator('#aviso-migracao-local').isVisible()) {
        await openOptions(page); await expect(page.locator('#recuperar-fontes-antigas')).toBeVisible(); await page.locator('#recuperar-fontes-antigas').click(); await closeOptions(page);
    }
    await expect(page.locator('#aviso-migracao-local')).toBeVisible();
}
async function logout(page) {
    await chooseDelete(page);
    await expect(page.locator('#entrar-google')).toBeVisible();
    await expect(page.locator('#sair-google')).toBeEnabled();
}
async function zero(page) {
    await expect(page.locator('.receita')).toHaveCount(0); await expect(page.locator('.despesa')).toHaveCount(0);
    await expect(page.locator('#adicionar-receita')).toBeDisabled();
    await expect(page.locator('#abrir-limites-orcamento')).toBeDisabled();
    expect(await page.locator('#lista-orcamentos').textContent()).toBe('');
}
async function start(context, page) {
    await setup(context, page); await page.goto('/');
    // Static HTML already enables the button before its handlers exist. Await real bootstrap.
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
    await expect.poll(() => page.evaluate(() => window.__authSubscriptions)).toBe(1);
    await expect(page.locator('#entrar-google')).toBeEnabled();
}

test.afterEach(async () => { try { for (const page of monitoredPages) expect(errors.get(page) || []).toEqual([]); } finally { monitoredPages.clear(); } });

test('Google account: login, real edits/settings, confirmed logout, zero reload and remote recovery', async ({ context, page, request }) => {
    const user = await account(request); await start(context, page); await zero(page); await signIn(page, user);
    await addIncome(page); await synced(page);
    await page.locator('#adicionar-despesa').click(); await page.locator('#despesa-nome').fill('SYNTHETIC EXPENSE');
    await page.locator('#despesa-valor').fill('20'); await page.locator('#form-despesa button[type="submit"]').click();
    await expect(page.locator('#dialogo-despesa')).not.toBeVisible(); await synced(page);
    await openOptions(page); await page.locator('#abrir-limites-orcamento').click();
    const budget = page.locator('[data-orcamento-campo="padrao"]').first(); await budget.fill('99');
    await page.locator('[data-orcamento-acao="salvar-padrao"]').first().click();
    await page.keyboard.press('Escape'); await closeOptions(page); await synced(page);
    if (!await page.locator('#conteudo-receitas').isVisible()) await page.locator('[aria-controls="conteudo-receitas"]').click();
    await page.locator('.editar-receita').first().click(); await page.locator('#receita-valor').fill('150');
    await page.locator('#form-receita button[type="submit"]').click(); await synced(page);
    const before = await stored(page, `estado:${user.uid}`); expect(Object.keys(before.dados.orcamentos.padrao).length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__authSubscriptions)).toBe(1);
    await logout(page); await zero(page);
    await expect.poll(() => stored(page, `estado:${user.uid}`)).toBeNull();
    expect(await stored(page, `fila:${user.uid}`)).toBeNull();
    await page.reload(); await expect(page.locator('#entrar-google')).toBeEnabled(); await zero(page);
    await signIn(page, user);
    const recovered = await stored(page, `estado:${user.uid}`); expect(recovered.dados).toEqual(before.dados);
});

test('offline logout preserves pending operations and A-B-A isolates owners then recovers pending ACKs', async ({ context, page, request }) => {
    const a = await account(request), b = await account(request, 'B'); await start(context, page); await signIn(page, a);
    await context.setOffline(true); await addIncome(page, 'SYNTHETIC PENDING');
    await expect.poll(async () => (await stored(page, `fila:${a.uid}`))?.outbox.length).toBe(1);
    const pending = await stored(page, `fila:${a.uid}`); await keepLocal(page); await unlockLocal(page);
    expect((await stored(page, `fila:${a.uid}`)).outbox).toEqual(pending.outbox);
    await context.setOffline(false); await page.reload(); await expect(page.locator('#entrar-google')).toBeEnabled(); await unlockLocal(page);
    await signIn(page, b); const bState = await stored(page, `estado:${b.uid}`); expect(JSON.stringify(bState)).not.toContain('SYNTHETIC PENDING');
    expect((await stored(page, `fila:${a.uid}`)).outbox).toEqual(pending.outbox);
    await logout(page); await signIn(page, a);
    expect(JSON.stringify(await stored(page, `estado:${a.uid}`))).toContain('SYNTHETIC PENDING');
    expect((await stored(page, `fila:${a.uid}`)).outbox).toHaveLength(0);
});

test('failed signOut persists local revocation across reload and rejects delayed callbacks', async ({ context, page, request }) => {
    const a = await account(request); await start(context, page); await signIn(page, a); await addIncome(page); await synced(page);
    const before = await stored(page, `estado:${a.uid}`);
    await page.evaluate(() => { window.__testSignOutFailure = true; window.__oldDelivery = window.__lastAuthDelivery; });
    await chooseDelete(page);
    await expect(page.locator('#estado-sincronizacao')).toContainText('Copias locais preservadas'); await zero(page);
    await page.evaluate(() => window.__oldDelivery()); await zero(page);
    expect((await stored(page, `estado:${a.uid}`)).dados).toEqual(before.dados);
    await page.reload(); await expect(page.locator('#entrar-google')).toBeEnabled(); await zero(page);
    await signIn(page, a); expect((await stored(page, `estado:${a.uid}`)).dados).toEqual(before.dados);
});

test('shared tabs propagate logout and failed signOut revocation without restoring authority', async ({ context, page, request }) => {
    const a = await account(request); await start(context, page); await signIn(page, a); await addIncome(page); await synced(page);
    const other = await context.newPage(); await setup(context, other); await other.goto('/'); await other.bringToFront();
    await expect(other.locator('#conta-sincronizacao')).toContainText(a.email); await synced(other);
    const control = await stored(other, 'account-access:v1');
    await page.bringToFront(); await page.evaluate(() => { window.__testSignOutFailure = true; });
    await chooseDelete(page);
    await expect(page.locator('#estado-sincronizacao')).toContainText('Copias locais preservadas');
    await other.bringToFront(); await zero(other);
    const outcome = await other.evaluate(async ({ uid, epoch }) => {
        const { abrirPersistenciaFinanceira } = await import('/indexeddb-persistence.js'); const db = await abrirPersistenciaFinanceira();
        db.requerConta = true; db.acessoConta = { uid, epoch };
        try { await db.alterar(`estado:${uid}`, state => { state.revisao++; return state; }); return 'unexpected'; }
        catch (error) { return error.code; } finally { db.fechar(); }
    }, { uid: a.uid, epoch: control.epoch });
    expect(outcome).toBe('account/access-revoked');
    await other.reload(); await expect(other.locator('#entrar-google')).toBeEnabled(); await zero(other);
    expect(await other.evaluate(() => window.__authSubscriptions)).toBe(1); expect(errors.get(other)).toEqual([]); await other.close();
});

test('legacy anonymous localStorage and v1 IndexedDB survive unchanged and never populate any account', async ({ context, page, request }) => {
    await setup(context, page); await page.goto('/firebase-config.js');
    const legacy = { versao: 3, categorias: ['SYNTHETIC LEGACY'], orcamentos: { padrao: { 'SYNTHETIC LEGACY': 70 }, meses: {} }, meses: { '2026-11': { receitas: [{ id: 'synthetic-old', nome: 'SYNTHETIC LEGACY PRIVATE', valor: 333 }], despesas: [] } } };
    await page.evaluate(async data => {
        localStorage.setItem('controleFinanceiro:v3', JSON.stringify(data));
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('controleFinanceiro:integridade:v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('documents'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put({ revisao: 3, dados: data }, 'estado:@local'); tx.objectStore('documents').put({ outbox: [], conflicts: [] }, 'fila:@local'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    }, legacy);
    await page.goto('/'); await expect(page.locator('#entrar-google')).toBeEnabled(); await zero(page);
    const a = await account(request); await signIn(page, a, { keepSeparate: true });
    expect(JSON.stringify(await stored(page, `estado:${a.uid}`))).not.toContain('SYNTHETIC LEGACY');
    await logout(page); await zero(page);
    expect((await stored(page, 'estado:@local')).dados).toEqual(legacy);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('controleFinanceiro:v3')))).toEqual(legacy);
});

test('IndexedDB open failure fails closed and never exposes legacy finance', async ({ context, page }) => {
    await setup(context, page);
    await page.addInitScript(() => { localStorage.setItem('controleFinanceiro:v3', JSON.stringify({ meses: { '2026-11': { receitas: [{ id: 'synthetic-quota', nome: 'SYNTHETIC HIDDEN', valor: 99 }], despesas: [] } } })); indexedDB.open = () => { throw new DOMException('Synthetic quota', 'QuotaExceededError'); }; });
    await page.goto('/'); await expect(page.locator('#adicionar-receita')).toBeDisabled();
    expect(await page.locator('body').textContent()).not.toContain('SYNTHETIC HIDDEN');
    expect(await page.evaluate(() => localStorage.getItem('controleFinanceiro:v3'))).toContain('SYNTHETIC HIDDEN');
});

test('actual browser process restart after confirmed logout never restores financial authority', async ({ browserName, request }, info) => {
    expect(browserName).toBe('chromium'); const a = await account(request), profile = await mkdtemp(path.join(tmpdir(), 'cf-google-account-profile-'));
    const options = { baseURL: process.env.LOCAL_TEST_BASE_URL, serviceWorkers: 'block', headless: true, ...(info.project.use.channel ? { channel: info.project.use.channel } : {}) };
    let persistent = await chromium.launchPersistentContext(profile, options);
    try {
        let p = persistent.pages()[0] || await persistent.newPage(); await start(persistent, p);
        await signIn(p, a); await addIncome(p); await synced(p); await logout(p); await zero(p);
        await persistent.close(); persistent = await chromium.launchPersistentContext(profile, options);
        p = persistent.pages()[0] || await persistent.newPage(); await start(persistent, p); await zero(p); expect(await stored(p, `estado:${a.uid}`)).toBeNull();
        await signIn(p, a); expect(JSON.stringify(await stored(p, `estado:${a.uid}`))).toContain('SYNTHETIC INCOME'); expect(errors.get(p)).toEqual([]);
    } finally { await persistent.close(); console.log('Synthetic profile retained:', profile); }
});

async function seedAnonymous(context, page) {
    await setup(context, page); await page.goto('/firebase-config.js');
    const state = { versao: 3, categorias: ['SYNTHETIC ANON'], orcamentos: { padrao: { 'SYNTHETIC ANON': 41 }, meses: {} },
        meses: { '2026-11': { receitas: [{ id: 'synthetic-anon-original', nome: 'ANON PRIVATE ORIGINAL', valor: 41 }], despesas: [] } } };
    const deleted = { month: '2026-11', type: 'receitas', id: 'synthetic-deleted', deleted: true };
    const queue = { outbox: [{ id: 'synthetic-preserve-tombstone', entityKey: recordEntityKey(deleted), value: deleted, state: 'pending', baseRevision: 'synthetic-original-revision' }], conflicts: [{ kind: 'synthetic-original-conflict' }], recoveryKeys: ['synthetic-original-recovery'] };
    await page.evaluate(async ({ state, queue }) => {
        localStorage.setItem('controleFinanceiro:v3', JSON.stringify(state));
        localStorage.setItem('controleFinanceiro:sync:@local', JSON.stringify(queue));
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('controleFinanceiro:integridade:v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('documents'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put({ revisao: 11, dados: state }, 'estado:@local'); tx.objectStore('documents').put(queue, 'fila:@local'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    }, { state, queue });
    await page.goto('/'); await expect(page.locator('#entrar-google')).toBeEnabled(); await zero(page);
    return { state, queue };
}
async function loginToReview(page, user) {
    await page.evaluate(email => { window.__testEmail = email; }, user.email); await openOptions(page);
    await page.locator('#entrar-google').click(); await expect(page.locator('#conta-sincronizacao')).toContainText(user.email); await closeOptions(page);
    await openRecovery(page); await expect(page.locator('#adicionar-receita')).toBeDisabled();
}
async function remoteRecordCount(request, uid) {
    const response = await request.get(`http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/users/${uid}/records`, { headers: { Authorization: 'Bearer owner' } });
    expect([200, 404]).toContain(response.status()); return response.status() === 404 ? 0 : ((await response.json()).documents || []).length;
}
test('migration review is read-only, preserves original queue/tombstones and requires explicit separation', async ({ context, page, request }) => {
    const original = await seedAnonymous(context, page), a = await account(request);
    await loginToReview(page, a); expect(await remoteRecordCount(request, a.uid)).toBe(0);
    expect(await page.locator('body').textContent()).not.toContain('ANON PRIVATE ORIGINAL');
    await page.locator('#revisar-fontes-locais').click();
    await expect(page.locator('#aviso-migracao-local')).toHaveAttribute('data-review', 'blocked');
    await expect(page.locator('#aviso-migracao-local')).toContainText('Importação bloqueada');
    expect(await remoteRecordCount(request, a.uid)).toBe(0);
    expect((await stored(page, 'estado:@local')).dados).toEqual(original.state); expect(await stored(page, 'fila:@local')).toEqual(original.queue);
    await page.locator('#manter-fontes-separadas').click(); await synced(page);
    await addIncome(page, 'SYNTHETIC OWNED AFTER REVIEW'); await synced(page);
    expect(await remoteRecordCount(request, a.uid)).toBe(1); expect(await stored(page, 'fila:@local')).toEqual(original.queue);
    expect(JSON.stringify(await stored(page, `estado:${a.uid}`))).not.toContain('ANON PRIVATE ORIGINAL');
    await page.reload(); await openRecovery(page);
    expect(await stored(page, 'fila:@local')).toEqual(original.queue);
});
test('cached migration snapshot is rejected with originals intact and no publication', async ({ context, page, request }) => {
    const original = await seedAnonymous(context, page), a = await account(request); await loginToReview(page, a);
    await page.evaluate(() => { window.__migrationCachedForTest = true; }); await page.locator('#revisar-fontes-locais').click();
    await expect(page.locator('#aviso-migracao-local')).toHaveAttribute('data-review', 'error');
    await expect(page.locator('#aviso-migracao-local')).toContainText('Snapshot remoto sem confirmação');
    expect(await remoteRecordCount(request, a.uid)).toBe(0); expect(await stored(page, 'fila:@local')).toEqual(original.queue);
});
test('logout invalidates a delayed migration review and leaves no anonymous data visible', async ({ context, page, request }) => {
    const original = await seedAnonymous(context, page), a = await account(request); await loginToReview(page, a);
    await page.evaluate(() => { window.__holdMigrationSnapshot = true; }); await page.locator('#revisar-fontes-locais').click();
    await expect.poll(() => page.evaluate(() => typeof window.__releaseMigrationSnapshot)).toBe('function');
    await logout(page); await zero(page); await page.evaluate(() => window.__releaseMigrationSnapshot());
    await expect(page.locator('#aviso-migracao-local')).toBeHidden();
    expect(await page.locator('body').textContent()).not.toContain('ANON PRIVATE ORIGINAL');
    expect((await stored(page, 'estado:@local')).dados).toEqual(original.state); expect(await stored(page, 'fila:@local')).toEqual(original.queue);
    expect(await remoteRecordCount(request, a.uid)).toBe(0);
});

async function seedCleanAnonymous(context, page) {
    await setup(context, page); await page.goto('/firebase-config.js');
    await page.evaluate(async () => {
        const { normalizarEstado } = await import('/finance-core.js');
        const data = normalizarEstado({ meses: { '2026-11': { receitas: [{ id: 'synthetic-safe-import', nome: 'SYNTHETIC SAFE IMPORT', valor: 31 }], despesas: [] } } });
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('controleFinanceiro:integridade:v1', 2); r.onupgradeneeded = () => r.result.createObjectStore('documents'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put({ revisao: 9, dados: data }, 'estado:@local'); tx.objectStore('documents').put({ outbox: [], conflicts: [] }, 'fila:@local'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    });
    await page.goto('/'); await expect.poll(() => page.evaluate(() => window.__authSubscriptions)).toBe(1);
}
async function migrationJournalKey(page, uid) {
    return page.evaluate(async uid => { const { abrirPersistenciaFinanceira } = await import('/indexeddb-persistence.js'); const db=await abrirPersistenciaFinanceira(); try { return await new Promise((resolve,reject)=>{const tx=db.db.transaction('documents','readonly');const r=tx.objectStore('documents').getAllKeys();r.onsuccess=()=>resolve(r.result.find(k=>k.startsWith('restore-recovery:'+uid+':migration-')));r.onerror=()=>reject(r.error);}); } finally {db.fechar();} },uid);
}
test('native migration consent applies state and queue once, confirms exact ACK and preserves anonymous source', async ({ context, page, request }) => {
    await seedCleanAnonymous(context, page);
    const a = await account(request); await loginToReview(page, a);
    const original = await stored(page, 'estado:@local'), originalQueue = await stored(page, 'fila:@local');
    await expect(page.locator('#importar-fontes-locais')).toBeHidden();
    await page.locator('#revisar-fontes-locais').click();
    await expect(page.locator('#aviso-migracao-local')).toHaveAttribute('data-review', 'ready');
    expect(await remoteRecordCount(request, a.uid)).toBe(0);
    // Dismissal is not consent and must produce no journal or operations.
    await page.locator('#importar-fontes-locais').click(); expect(await remoteRecordCount(request, a.uid)).toBe(0);
    page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept());
    await page.locator('#importar-fontes-locais').click();
    await synced(page);
    expect(await remoteRecordCount(request, a.uid)).toBe(1);
    const journalKey = await page.evaluate(async uid => {
        const { abrirPersistenciaFinanceira } = await import('/indexeddb-persistence.js'); const db = await abrirPersistenciaFinanceira();
        try { return await new Promise((resolve, reject) => { const tx = db.db.transaction('documents','readonly'); const r=tx.objectStore('documents').getAllKeys(); r.onsuccess=()=>resolve(r.result.find(k=>k.startsWith('restore-recovery:'+uid+':migration-'))); r.onerror=()=>reject(r.error); }); } finally { db.fechar(); }
    }, a.uid);
    await expect.poll(async () => (await stored(page, journalKey))?.state).toBe('confirmed');
    expect((await stored(page, 'estado:@local'))).toEqual(original); expect(await stored(page, 'fila:@local')).toEqual(originalQueue);
    expect((await stored(page, 'fila:'+a.uid)).recoveryKeys).toEqual([]);
    expect(await page.evaluate(() => window.__authSubscriptions)).toBe(1);
});

for (const interruption of ['prepared', 'applied']) test(`durable migration resumes after ${interruption} interruption without replay or source mutation`, async ({ context, page, request }) => {
    await seedCleanAnonymous(context,page); const a=await account(request); await loginToReview(page,a);
    const original=await stored(page,'estado:@local'), originalQueue=await stored(page,'fila:@local');
    await page.locator('#revisar-fontes-locais').click(); await expect(page.locator('#aviso-migracao-local')).toHaveAttribute('data-review','ready');
    page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());
    await page.evaluate(kind=>{if(kind==='prepared')window.__holdMigrationSnapshot=true;else window.__holdMigrationCommit=true;},interruption);
    await page.locator('#importar-fontes-locais').click();
    await expect.poll(()=>page.evaluate(kind=>typeof window[kind==='prepared'?'__releaseMigrationSnapshot':'__releaseMigrationCommit'],interruption)).toBe('function');
    const key=await migrationJournalKey(page,a.uid); expect((await stored(page,key)).state).toBe(interruption);
    expect(await remoteRecordCount(request,a.uid)).toBe(0);
    await page.reload(); await openRecovery(page);
    await page.locator('#revisar-fontes-locais').click(); await expect(page.locator('#aviso-migracao-local')).toHaveAttribute('data-review',interruption==='prepared'?'ready':'resume');
    await page.locator('#importar-fontes-locais').click(); await synced(page);
    await expect.poll(async()=>(await stored(page,key)).state).toBe('confirmed');
    expect(await remoteRecordCount(request,a.uid)).toBe(1);expect((await stored(page,`fila:${a.uid}`)).outbox).toEqual([]);
    expect((await stored(page,`estado:${a.uid}`)).dados.meses['2026-11'].receitas).toHaveLength(1);
    expect(await stored(page,'estado:@local')).toEqual(original);expect(await stored(page,'fila:@local')).toEqual(originalQueue);
});

test('native migration storage failure rolls back state and queue and retains prepared recovery',async({context,page,request})=>{
    await seedCleanAnonymous(context,page);const a=await account(request);await loginToReview(page,a);
    await page.locator('#revisar-fontes-locais').click();await expect(page.locator('#aviso-migracao-local')).toHaveAttribute('data-review','ready');
    const before=await stored(page,`estado:${a.uid}`),queue=await stored(page,`fila:${a.uid}`),source=await stored(page,'estado:@local');
    await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(typeof key==='string'&&key.includes(':migration-')&&value?.state==='applied')throw new DOMException('Synthetic migration quota failure','QuotaExceededError');return put.call(this,value,key);};});
    page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());await page.locator('#importar-fontes-locais').click();
    await expect(page.locator('#aviso-migracao-local')).toContainText('Synthetic migration quota failure');
    expect(await stored(page,`estado:${a.uid}`)).toEqual(before);expect(await stored(page,`fila:${a.uid}`)).toEqual(queue);
    expect(await stored(page,'estado:@local')).toEqual(source);const key=await migrationJournalKey(page,a.uid);expect((await stored(page,key)).state).toBe('prepared');expect(await remoteRecordCount(request,a.uid)).toBe(0);
});

test('two real tabs import the same reviewed source once with durable account fencing',async({context,page,request})=>{
    await seedCleanAnonymous(context,page);const a=await account(request);await loginToReview(page,a);
    const other=await context.newPage();await start(context,other);await openRecovery(other);
    for(const p of [page,other]){await p.bringToFront();await p.locator('#revisar-fontes-locais').click();await expect(p.locator('#aviso-migracao-local')).toHaveAttribute('data-review','ready');p.removeAllListeners('dialog');p.on('dialog',dialog=>dialog.accept());}
    const source=await stored(page,'estado:@local');
    await Promise.all([page.locator('#importar-fontes-locais').click(),other.locator('#importar-fontes-locais').click()]);
    await synced(page);await synced(other);const key=await migrationJournalKey(page,a.uid);
    await expect.poll(async()=>(await stored(page,key)).state).toBe('confirmed');
    expect(await remoteRecordCount(request,a.uid)).toBe(1);expect((await stored(page,`estado:${a.uid}`)).dados.meses['2026-11'].receitas).toHaveLength(1);
    expect((await stored(page,`fila:${a.uid}`)).outbox).toEqual([]);expect(await stored(page,'estado:@local')).toEqual(source);
    expect(await other.evaluate(()=>window.__authSubscriptions)).toBe(1);await other.close();
});

test('logout after durable consent fences a late import callback and preserves prepared journal',async({context,page,request})=>{
    await seedCleanAnonymous(context,page);const a=await account(request);await loginToReview(page,a);
    await page.locator('#revisar-fontes-locais').click();await expect(page.locator('#aviso-migracao-local')).toHaveAttribute('data-review','ready');
    const source=await stored(page,'estado:@local');page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());
    await page.evaluate(()=>{window.__holdMigrationSnapshot=true;});await page.locator('#importar-fontes-locais').click();
    await expect.poll(()=>page.evaluate(()=>typeof window.__releaseMigrationSnapshot)).toBe('function');const key=await migrationJournalKey(page,a.uid);
    await keepLocal(page);await page.evaluate(()=>window.__releaseMigrationSnapshot());
    await expect(page.locator('#aviso-migracao-local')).toBeHidden();expect((await stored(page,key)).state).toBe('prepared');
    expect((await stored(page,`fila:${a.uid}`)).outbox).toEqual([]);expect(await stored(page,'estado:@local')).toEqual(source);expect(await remoteRecordCount(request,a.uid)).toBe(0);
});

test('public shell and offline diagnostics remain available when network stays apparently online and Firebase bundle never responds',async({context,page})=>{
    await setup(context,page);let release,arrived;const pending=new Promise(r=>{release=r;}),requested=new Promise(r=>{arrived=r;});
    await context.route('**/firebase-sync.bundle.js?*',async route=>{arrived();await pending;await route.abort('internetdisconnected').catch(()=>{});});
    try {
        await page.goto('/',{waitUntil:'domcontentloaded'});await requested;expect(await page.evaluate(()=>navigator.onLine)).toBe(true);
        if(process.env.STABILITY_BASELINE){await expect(page.locator('html')).toHaveClass(/app-inicializando/);await expect(page.locator('main.container')).toBeHidden();console.log('CONFIRMED bootstrap blocked by pending Firebase module:',process.env.STABILITY_BASELINE);return;}
        await expect(page.locator('main.container')).toBeVisible();await zero(page);
        await page.locator('#abrir-ajustes').click();await expect(page.locator('#dialogo-ajustes')).toBeVisible();
        await expect(page.locator('#diagnostico-app')).toContainText('Build da interface:');
        expect(await page.locator('body').textContent()).not.toContain('SYNTHETIC SAFE IMPORT');
        expect(await stored(page,'estado:@local')).toBeNull();
    } finally {release();}
});

test('cached PWA after logout reopens with online blackhole and explicit offline without old financial data',async({browser,request})=>{
    const context=await browser.newContext({baseURL:process.env.LOCAL_TEST_BASE_URL,serviceWorkers:'allow',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    let page=await context.newPage();const blocked=[];let requestsHeld=[];
    try{
        await start(context,page);const a=await account(request);await signIn(page,a);await addIncome(page,'SYNTHETIC PHONE PRIVATE');await synced(page);await logout(page);await zero(page);await closeOptions(page);
        await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
        // The same real SW cache is retained across a page close/reopen, not fabricated assets.
        const cacheState=await page.evaluate(async()=>({names:await caches.keys(),controller:navigator.serviceWorker.controller.scriptURL}));expect(cacheState.names.length).toBeGreaterThan(0);
        console.log('PWA_CACHE_PROOF',JSON.stringify(cacheState));await page.close();
        await context.addCookies([{name:'cf-synthetic-blackhole',value:'1',url:process.env.LOCAL_TEST_BASE_URL}]);
        await context.route(url=>url.origin!==new URL(process.env.LOCAL_TEST_BASE_URL).origin,async route=>{
            const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname)){blocked.push(url.origin);return route.abort('blockedbyclient');}
            // An apparent connection that never responds; navigator.onLine must remain true.
            await new Promise(resolve=>requestsHeld.push(()=>{void route.abort('internetdisconnected').catch(()=>{});resolve();}));
        });
        page=await context.newPage();const seen=[];errors.set(page,seen);monitoredPages.add(page);page.on('pageerror',e=>seen.push(e.message));page.on('dialog',d=>d.dismiss());
        await page.goto('/',{waitUntil:'domcontentloaded'});expect(await page.evaluate(()=>navigator.onLine)).toBe(true);await expect(page.locator('main.container')).toBeVisible();await zero(page);
        const probe='/synthetic-blackhole-probe?nonce='+crypto.randomUUID();
        await page.evaluate(probe=>{window.__networkProbeSettled=false;void fetch(probe).finally(()=>{window.__networkProbeSettled=true;}).catch(()=>{});},probe);
        await expect.poll(async()=>await (await request.get(process.env.LOCAL_TEST_BASE_URL+'/synthetic-network-evidence')).json()).toContain(probe);
        expect(await page.evaluate(()=>window.__networkProbeSettled)).toBe(false);
        await openOptions(page);await expect(page.locator('#diagnostico-app')).toContainText('Build da interface:');await expect(page.locator('#diagnostico-app')).toContainText('Rede aparente: online');
        expect(await page.locator('body').textContent()).not.toContain('SYNTHETIC PHONE PRIVATE');expect(await stored(page,`estado:${a.uid}`)).toBeNull();
        // Explicit offline still serves the public shell from the same SW cache.
        for(const release of requestsHeld.splice(0))release();await context.unroute('**/*');await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
        expect(await page.evaluate(()=>navigator.onLine)).toBe(false);await expect(page.locator('main.container')).toBeVisible();await zero(page);await openOptions(page);await expect(page.locator('#diagnostico-app')).toContainText('Build da interface:');expect(await page.locator('body').textContent()).not.toContain('SYNTHETIC PHONE PRIVATE');
        expect(blocked).toEqual([]);expect(seen).toEqual([]);
    }finally{for(const release of requestsHeld.splice(0))release();await context.close();}
});

test('public shell stays locked and usable while the single SDK Auth observer and ready promise are delayed',async({context,page})=>{
    await context.addInitScript(()=>{window.__holdAuthBootstrap=true;});await setup(context,page);await page.goto('/');
    await expect.poll(()=>page.evaluate(()=>window.__authSubscriptions)).toBe(1);await expect(page.locator('main.container')).toBeVisible();await zero(page);
    expect(await page.evaluate(()=>navigator.onLine)).toBe(true);await page.locator('#abrir-ajustes').click();await expect(page.locator('#diagnostico-app')).toContainText('Build da interface:');
    await page.evaluate(()=>window.__releaseAuthBootstrap());await expect(page.locator('#estado-sincronizacao')).toContainText('Entre com Google');await zero(page);expect(await page.evaluate(()=>window.__authSubscriptions)).toBe(1);
});

test('real SDK Safari proactive resolver cannot hide the shell while its helper network is pending',async({browser})=>{
    // Exercises the REAL SDK Safari/mobile user-agent branch in Chromium; not an iOS engine certification.
    const context=await browser.newContext({baseURL:process.env.LOCAL_TEST_BASE_URL,serviceWorkers:'block',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage();let entered,release;const requested=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
    try{
        await setup(context,page);await context.route(/^https:\/\/apis\.google\.com\/js\/api\.js/,async route=>{entered();await pending;await route.abort('internetdisconnected').catch(()=>{});});
        await page.goto('/',{waitUntil:'domcontentloaded'});await requested;expect(await page.evaluate(()=>navigator.onLine)).toBe(true);
        expect(await page.evaluate(()=>window.__authSubscriptions)).toBe(1);
        expect(await page.evaluate(()=>(window.__syncDiagnostics||[]).filter(e=>e.operation==='auth').length)).toBe(0);
        if(process.env.STABILITY_BASELINE){await expect(page.locator('main.container')).toBeHidden();console.log('CONFIRMED real SDK mobile/Safari initialization waits for blocked helper:',process.env.STABILITY_BASELINE);}
        else{await expect(page.locator('main.container')).toBeVisible();await zero(page);await openOptions(page);await expect(page.locator('#diagnostico-app')).toContainText('Build da interface:');await closeOptions(page);}
        await context.setOffline(true);release();
        await expect(page.locator('main.container')).toBeVisible();await expect(page.locator('#estado-sincronizacao')).toContainText(process.env.STABILITY_BASELINE==='published'?'Somente neste dispositivo.':'Entre com Google');
        expect(await page.evaluate(()=>navigator.onLine)).toBe(false);if(!process.env.STABILITY_BASELINE)await zero(page);
        expect(await page.evaluate(()=>window.__authSubscriptions)).toBe(1);
    }finally{release();await context.close();}
});


test('native cleanup preserves a different confirmed UID in the same synthetic database', async ({ context, page }) => {
    await start(context, page);
    const result = await page.evaluate(async () => {
        const { PersistenciaFinanceira } = await import('/indexeddb-persistence.js');
        const { normalizarEstado } = await import('/finance-core.js');
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('synthetic-cleanup-' + crypto.randomUUID(), 1);
            request.onupgradeneeded = () => request.result.createObjectStore('documents');
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        try {
            const a = 'synthetic-cleanup-A', b = 'synthetic-cleanup-B';
            const state = { revisao: 4, dados: normalizarEstado({ meses: {}, categorias: ['Synthetic'] }) };
            const queue = { outbox: [], conflicts: [], lastConfirmed: '2026-11-06T12:00:00Z', confirmedRevision: 4, confirmedGeneration: 'legacy' };
            await new Promise((resolve, reject) => {
                const tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents');
                store.put({ version: 1, epoch: 8, uid: null, closing: false, revoked: [a, b] }, 'account-access:v1');
                for (const uid of [a, b]) { store.put(state, 'estado:' + uid); store.put(queue, 'fila:' + uid); }
                tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
            });
            const persistence = new PersistenciaFinanceira(db);
            const removed = await persistence.removerContasConfirmadas(8, a);
            return { removed: removed.map(x => x.uid), a: await persistence.ler('estado:' + a),
                b: await persistence.ler('estado:' + b), queueB: await persistence.ler('fila:' + b), state, queue };
        } finally { db.close(); }
    });
    expect(result.removed).toEqual(['synthetic-cleanup-A']); expect(result.a).toBeNull();
    expect(result.b).toEqual(result.state); expect(result.queueB).toEqual(result.queue);
});


async function keepLocal(page) {
    await openOptions(page); await page.locator('#sair-google').click(); await page.locator('#sair-keep').click();
    await expect(page.locator('#conta-sincronizacao')).toContainText('Modo local');
    await expect(page.locator('#adicionar-receita')).toBeEnabled();
    await expect(page.locator('#pin-local, #dialogo-pin-local, #desbloquear-dados-locais, #bloquear-dados-locais')).toHaveCount(0);
}
async function unlockLocal(page) {
    // Readiness assertion only: access is automatic, with no unlock action.
    await expect(page.locator('#conta-sincronizacao')).toContainText('Modo local'); await expect(page.locator('#adicionar-receita')).toBeEnabled(); await closeOptions(page);
}

test('automatic local access: cancelled logout leaves data and authorization unchanged', async ({ context, page, request }) => {
    const a = await account(request); await start(context, page); await signIn(page, a); await addIncome(page); await synced(page);
    const before = await stored(page, 'estado:' + a.uid), control = await stored(page, 'account-access:v1');
    await openOptions(page); await page.locator('#sair-google').click(); await page.locator('#sair-cancel').click();
    expect(await stored(page, 'account-access:v1')).toEqual(control);
    const after = await stored(page, 'estado:' + a.uid); expect(after.dados).toEqual(before.dados); expect(after.revisao).toBeGreaterThanOrEqual(before.revisao);
    await expect(page.locator('#conta-sincronizacao')).toContainText(a.email); await closeOptions(page); await expect(page.locator('#adicionar-receita')).toBeEnabled();
});

test('automatic local access: A-B-A retains independent local edits without remote authority', async ({ context, page, request }) => {
    const a = await account(request), b = await account(request, 'B'); await start(context, page); await signIn(page, a); await addIncome(page, 'SYNTHETIC A ORIGINAL'); await synced(page);
    await keepLocal(page); await unlockLocal(page); await addIncome(page, 'SYNTHETIC LOCAL ONLY');
    await expect.poll(async () => (await stored(page, 'fila:' + a.uid))?.outbox.length).toBe(1);
    expect(await remoteRecordCount(request, a.uid)).toBe(1);
    const pending = await stored(page, 'fila:' + a.uid); await signIn(page, b); expect(JSON.stringify(await stored(page, 'estado:' + b.uid))).not.toContain('SYNTHETIC A');
    expect((await stored(page, 'fila:' + a.uid)).outbox).toEqual(pending.outbox);
    const peer = await context.newPage(); await start(context, peer); await page.bringToFront(); await expect(page.locator('#adicionar-receita')).toBeEnabled();
    expect(JSON.stringify(await stored(page, 'estado:' + b.uid))).not.toContain('SYNTHETIC LOCAL ONLY'); await peer.close();
    await logout(page); await signIn(page, a);
    await expect.poll(async () => (await stored(page, 'fila:' + a.uid)).outbox.length).toBe(0); expect(await remoteRecordCount(request, a.uid)).toBe(2);
    expect(JSON.stringify(await stored(page, 'estado:' + a.uid))).toContain('SYNTHETIC LOCAL ONLY');
});

test('automatic local access: Firebase bundle blackhole cannot delay authorized local hydration', async ({ context, page, request }) => {
    const a = await account(request); await start(context, page); await signIn(page, a); await addIncome(page, 'SYNTHETIC BLACKHOLE LOCAL'); await synced(page); await keepLocal(page);
    const held = []; await context.route('**/firebase-sync.bundle.js*', route => new Promise(resolve => held.push(() => { void route.abort().catch(() => {}); resolve(); })));
    try {
        await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('main.container')).toBeVisible(); expect(await page.evaluate(() => navigator.onLine)).toBe(true);
        await unlockLocal(page); expect(await page.locator('body').textContent()).toContain('SYNTHETIC BLACKHOLE LOCAL');
        await addIncome(page, 'SYNTHETIC WITHOUT FIREBASE'); await expect.poll(async () => (await stored(page, 'fila:' + a.uid)).outbox.length).toBe(1);
        expect(await remoteRecordCount(request, a.uid)).toBe(1); expect(held.length).toBe(0);
    } finally { for (const release of held) release(); }
});

test('automatic local access: durable mobile PWA survives two offline process restarts and syncs once after fresh Google login', async ({ request }, info) => {
    const a = await account(request), profile = await mkdtemp(path.join(tmpdir(), 'cf-local-offline-'));
    const options = { baseURL: process.env.LOCAL_TEST_BASE_URL, serviceWorkers: 'allow', headless: true, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, ...(info.project.use.channel ? { channel: info.project.use.channel } : {}) };
    let context = await chromium.launchPersistentContext(profile, options);
    try {
        let page = context.pages()[0] || await context.newPage(); await start(context, page); await signIn(page, a); await addIncome(page, 'SYNTHETIC MOBILE ORIGINAL'); await synced(page); await keepLocal(page);
        await page.evaluate(() => navigator.serviceWorker.ready); await closeOptions(page); await page.reload(); await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
        await context.close(); context = await chromium.launchPersistentContext(profile, options); await context.setOffline(true);
        page = context.pages()[0] || await context.newPage(); await setup(context, page); await page.goto('/', { waitUntil: 'domcontentloaded' });
        await unlockLocal(page); expect(await page.evaluate(() => window.__authSubscriptions || 0)).toBe(0); expect(await page.evaluate(() => navigator.onLine)).toBe(false); expect(await page.locator('body').textContent()).toContain('SYNTHETIC MOBILE ORIGINAL');
        await addIncome(page, 'SYNTHETIC MOBILE OFFLINE'); await expect.poll(async () => (await stored(page, 'fila:' + a.uid)).outbox.length).toBe(1);
        const pending = await stored(page, 'fila:' + a.uid), state = await stored(page, 'estado:' + a.uid);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await context.close(); context = await chromium.launchPersistentContext(profile, options); await context.setOffline(true);
        page = context.pages()[0] || await context.newPage(); await setup(context, page); await page.goto('/', { waitUntil: 'domcontentloaded' }); await unlockLocal(page); expect(await page.evaluate(() => window.__authSubscriptions || 0)).toBe(0);
        expect((await stored(page, 'estado:' + a.uid)).dados).toEqual(state.dados); expect((await stored(page, 'fila:' + a.uid)).outbox).toEqual(pending.outbox);
        await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await context.setOffline(false); await signIn(page, a); await expect.poll(async () => (await stored(page, 'fila:' + a.uid)).outbox.length).toBe(0);
        expect(await remoteRecordCount(request, a.uid)).toBe(2);
    } finally { await context.close(); console.log('Synthetic local profile retained:', profile); }
});

test('automatic local access: UID-owned source migrates automatically, preserves original and never duplicates after reload', async ({ context, page, request }) => {
    const a = await account(request); await setup(context, page); await page.goto('/firebase-config.js');
    const original = await page.evaluate(uid => {
        const state = { versao: 3, categorias: ['SYNTHETIC OWNED'], orcamentos: { padrao: { 'SYNTHETIC OWNED': 73 }, meses: {} }, meses: { '2026-11': { receitas: [{ id: 'synthetic-owned-source', nome: 'SYNTHETIC UID ORIGINAL', valor: 23, recebido: false }], despesas: [] } } };
        const raw = JSON.stringify(state); localStorage.setItem('controleFinanceiro:v3:uid:' + uid, raw); localStorage.setItem('controleFinanceiro:sync:' + uid, JSON.stringify({ outbox: [], conflicts: [], firstLinkSource: 'account' })); return raw;
    }, a.uid);
    await page.goto('/'); await expect(page.locator('#entrar-google')).toBeEnabled(); await signIn(page, a);
    expect(JSON.stringify(await stored(page, 'estado:' + a.uid))).toContain('SYNTHETIC UID ORIGINAL'); expect(await remoteRecordCount(request, a.uid)).toBe(1);
    expect(await page.evaluate(uid => localStorage.getItem('controleFinanceiro:v3:uid:' + uid), a.uid)).toBe(original);
    const copied = await stored(page, 'estado:' + a.uid); await page.reload(); await synced(page);
    expect((await stored(page, 'estado:' + a.uid)).migrationDigest).toBe(copied.migrationDigest); expect(await remoteRecordCount(request, a.uid)).toBe(1);
});

test('automatic local access: rejecting pending-data loss cancels logout without touching financial graph', async ({ context, page, request }) => {
    const a = await account(request); await start(context, page); await signIn(page, a);
    await context.setOffline(true); await addIncome(page, 'SYNTHETIC DO NOT DISCARD');
    await expect.poll(async () => (await stored(page, 'fila:' + a.uid)).outbox.length).toBe(1);
    const state = await stored(page, 'estado:' + a.uid), queue = await stored(page, 'fila:' + a.uid), control = await stored(page, 'account-access:v1');
    await openOptions(page); await page.locator('#sair-google').click(); await page.locator('#sair-delete-confirmed').click();
    await expect(page.locator('#sair-google')).toBeEnabled();
    expect(await stored(page, 'estado:' + a.uid)).toEqual(state); expect(await stored(page, 'fila:' + a.uid)).toEqual(queue);
    expect(await stored(page, 'account-access:v1')).toEqual(control); await expect(page.locator('#conta-sincronizacao')).toContainText(a.email);
    await context.setOffline(false); await synced(page);
});
test('automatic local access: confirmed loss deletes only chosen UID and keeps remote documents', async ({ context, page, request }) => {
    const a = await account(request), b = await account(request, 'B'); await start(context, page); await signIn(page, a); await addIncome(page, 'SYNTHETIC REMOTE KEPT'); await synced(page);
    await keepLocal(page); await signIn(page, b); await addIncome(page, 'SYNTHETIC OTHER OWNER'); await synced(page); await keepLocal(page); await signIn(page, a);
    const bState = await stored(page, 'estado:' + b.uid), bQueue = await stored(page, 'fila:' + b.uid);
    await context.setOffline(true); await addIncome(page, 'SYNTHETIC EXPLICIT LOSS');
    await expect.poll(async () => (await stored(page, 'fila:' + a.uid)).outbox.length).toBe(1);
    await chooseDelete(page); await zero(page); await expect.poll(() => stored(page, 'estado:' + a.uid)).toBeNull();
    expect(await stored(page, 'fila:' + a.uid)).toBeNull(); expect(await stored(page, 'estado:' + b.uid)).toEqual(bState); expect(await stored(page, 'fila:' + b.uid)).toEqual(bQueue);
    expect(await remoteRecordCount(request, a.uid)).toBe(1);
    await context.setOffline(false); await page.reload(); await expect(page.locator('#entrar-google')).toBeEnabled(); await zero(page);
    await signIn(page, a); expect(await remoteRecordCount(request, a.uid)).toBe(1);
    expect(JSON.stringify(await stored(page, 'estado:' + a.uid))).not.toContain('SYNTHETIC EXPLICIT LOSS');
});
test('automatic local access: Google cache reopens offline without signing out first', async ({ context, page, request }) => {
    const a = await account(request); await start(context, page); await signIn(page, a); await addIncome(page, 'SYNTHETIC AUTOMATIC CACHE'); await synced(page);
    // Cached application modules remain reachable, while the SDK never resolves.
    await context.route('**/firebase-sync.bundle.js*', route => route.abort('internetdisconnected'));
    await page.reload({ waitUntil: 'domcontentloaded' }); await unlockLocal(page);
    expect(await page.locator('body').textContent()).toContain('SYNTHETIC AUTOMATIC CACHE');
    await addIncome(page, 'SYNTHETIC CACHED EDIT'); await expect.poll(async () => (await stored(page, 'fila:' + a.uid)).outbox.length).toBe(1);
    expect(await remoteRecordCount(request, a.uid)).toBe(1);
});

test('automatic local access: native cleanup removes obsolete credentials and fences changed recovery snapshots', async ({ context, page }) => {
    await start(context, page);
    const result = await page.evaluate(async () => {
        const { abrirPersistenciaFinanceira } = await import('/indexeddb-persistence.js');
        const { normalizarEstado } = await import('/finance-core.js');
        const db = await abrirPersistenciaFinanceira(), a = 'synthetic-pending-A', b = 'synthetic-pending-B';
        const state = { revisao: 1, dados: normalizarEstado(null) }, queue = { outbox: [{ id: 'tombstone', value: { deleted: true } }], conflicts: [{ id: 'conflict' }] };
        const put = async (key, value) => db.alterar(key, () => value);
        try {
            await put('account-access:v1', { version: 1, epoch: 20, uid: null, closing: false, revoked: [a, b] });
            for (const uid of [a, b]) {
                await put('estado:' + uid, state); await put('fila:' + uid, queue);
                await put('account-offline:v1:' + uid, { salt: 'obsolete', ciphertext: 'obsolete' });
                await put('restore-recovery:' + uid + ':history', { id: uid });
            }
            await db.removerCredenciaisLocaisObsoletas();
            const credentialsGone = await db.ler('account-offline:v1:' + a) === null && await db.ler('account-offline:v1:' + b) === null;
            const intactAfterMigration = JSON.stringify(await db.ler('estado:' + a)) === JSON.stringify(state) && JSON.stringify(await db.ler('fila:' + a)) === JSON.stringify(queue);
            const before = await db.lerRecuperacoesParaSaida(a);
            await put('account-recovery:' + a + ':late-edit', { pending: true });
            let rejected = false;
            try { await db.removerContasConfirmadas(20, a, { discardPending: true, expectedState: state, expectedQueue: queue, expectedRecoveries: before }); } catch { rejected = true; }
            const preservedOnRace = !!await db.ler('estado:' + a) && !!await db.ler('account-recovery:' + a + ':late-edit');
            const removed = await db.removerContasConfirmadas(20, a, { discardPending: true, expectedState: state, expectedQueue: queue, expectedRecoveries: await db.lerRecuperacoesParaSaida(a) });
            return { credentialsGone, intactAfterMigration, rejected, preservedOnRace, removed: removed.map(x => x.uid),
                a: await db.ler('estado:' + a), queueA: await db.ler('fila:' + a), archiveA: await db.ler('restore-recovery:' + a + ':history'), lateA: await db.ler('account-recovery:' + a + ':late-edit'),
                b: await db.ler('estado:' + b), queueB: await db.ler('fila:' + b), archiveB: await db.ler('restore-recovery:' + b + ':history'), state, queue };
        } finally { db.fechar(); }
    });
    expect(result.credentialsGone && result.intactAfterMigration && result.rejected && result.preservedOnRace).toBe(true);
    expect(result.removed).toEqual(['synthetic-pending-A']); expect([result.a, result.queueA, result.archiveA, result.lateA]).toEqual([null, null, null, null]);
    expect(result.b).toEqual(result.state); expect(result.queueB).toEqual(result.queue); expect(result.archiveB).toEqual({ id: 'synthetic-pending-B' });
});
