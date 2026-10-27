import { test, expect, chromium } from '@playwright/test';
const project = 'demo-controle-financeiro';
const firestore = 'http://127.0.0.1:8080', auth = 'http://127.0.0.1:9099';
let secondBrowser;
const q = uid => `fila:${uid}`, st = uid => `estado:${uid}`;
async function read(page, key) {
    return page.evaluate(async key => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('controleFinanceiro:integridade:v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { return await new Promise((resolve, reject) => { const tx = db.transaction('documents', 'readonly'), r = tx.objectStore('documents').get(key); let data;
            r.onsuccess = () => { data = r.result; }; tx.oncomplete = () => resolve(data); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
    }, key);
}
const rows = async (page, uid) => Object.values((await read(page, st(uid)))?.dados?.meses || {}).flatMap(month => [...month.receitas, ...month.despesas]);
async function prepare(context, page, email) {
    await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'));
    await page.addInitScript(email => { window.__testEmail = email; window.syncDialogs = []; }, email);
    page.on('dialog', dialog => {
        if (dialog.message().startsWith('Restaurar o backup?')) { void dialog.accept(); return; }
        void page.evaluate(text => window.syncDialogs.push(text), dialog.message()).catch(() => {}); void dialog.dismiss();
    });
    await page.goto('/');
    await page.locator('#abrir-ajustes').click();
    await expect(page.locator('#entrar-google')).toBeEnabled(); await page.locator('#entrar-google').click();
    await expect(page.locator('#conta-sincronizacao')).toContainText(email);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await page.locator('#fechar-ajustes').click();
}
async function pair({ context, page, request }, info) {
    const email = 'automatic@local.test';
    const response = await request.post(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only`, { data: { email, password: 'synthetic-password-only', returnSecureToken: true } });
    expect(response.ok()).toBeTruthy(); const user = await response.json();
    await prepare(context, page, email);
    secondBrowser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: info.project.use.channel === 'msedge' ? 'chrome' : 'msedge' } : {}) });
    const otherContext = await secondBrowser.newContext({ baseURL: process.env.LOCAL_TEST_BASE_URL }), other = await otherContext.newPage();
    await prepare(otherContext, other, email); return { user, uid: user.localId, other, otherContext };
}
async function importFile(page, backup) {
    await page.locator('#abrir-ajustes').click();
    await page.locator('#arquivo-backup').setInputFiles({ name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.locator('#fechar-ajustes').click();
}
async function edit(page, value) {
    if (!await page.locator('#conteudo-receitas').isVisible()) await page.locator('[aria-controls="conteudo-receitas"]').click();
    await page.locator('.editar-receita').first().click(); await page.locator('#receita-valor').fill(String(value));
    await page.locator('#form-receita button[type="submit"]').click();
}
async function remote(request, uid, kind) {
    const base = `${firestore}/v1/projects/${project}/databases/(default)/documents/users/${uid}`;
    const options = { headers: { Authorization: 'Bearer owner' } };
    const marker = await request.get(`${base}/control/restore`, options);
    const generation = marker.ok() ? (await marker.json()).fields.activeGeneration.stringValue : null;
    const response = await request.get(`${base}${generation ? '/financeGenerations/' + generation : ''}/${kind}`, options);
    expect(response.ok()).toBeTruthy();
    return ((await response.json()).documents || []).map(item => kind === 'records' && generation
        ? { ...item, fields: item.fields.value.mapValue.fields } : item);
}
test.beforeEach(async ({ request }) => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    expect((await request.delete(`${firestore}/emulator/v1/projects/${project}/databases/(default)/documents`)).ok()).toBeTruthy();
    expect((await request.delete(`${auth}/emulator/v1/projects/${project}/accounts`)).ok()).toBeTruthy();
});
test.afterEach(async () => { await secondBrowser?.close(); secondBrowser = null; });

const backup = { versao: 3, categorias: ['Casa'], orcamentos: { padrao: { Casa: 100 }, meses: {} }, meses: {
    '2026-10': { receitas: [{ id: 'salary', nome: 'Salary', valor: 1000, serie: 'salary-series' }], despesas: [
        { nome: 'Parcel', valor: 25, categoria: 'Casa', serie: 'parcel-series', parcela: { atual: 1, total: 2 }, pago: false, fixa: false }
    ] }
} };
test('automatic UI: backup A reaches B, B edits reach A, no decisions/buttons and no duplicate reimport', async ({ page, context, request }, info) => {
    const { uid, other } = await pair({ page, context, request }, info);
    await importFile(page, backup);
    await expect.poll(async () => (await rows(other, uid)).length).toBe(2);
    await expect.poll(async () => (await read(other, st(uid))).dados.orcamentos.padrao.Casa).toBe(100);
    expect((await rows(other, uid)).find(item => item.nome === 'Parcel').parcela).toEqual({ atual: 1, total: 2 });
    await edit(other, 1200);
    await expect.poll(async () => (await rows(page, uid)).find(item => item.id === 'salary')?.valor).toBe(1200);
    await importFile(page, backup);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await expect.poll(async () => (await rows(other, uid)).find(item => item.id === 'salary')?.valor).toBe(backup.meses['2026-10'].receitas[0].valor);
    expect((await remote(request, uid, 'records'))).toHaveLength(2);
    for (const tab of [page, other]) {
        expect(await tab.locator('#tentar-sincronizacao, #abrir-conflitos-sincronizacao, #sincronizar-backup-restaurado, #dialogo-conflitos-sincronizacao, #ativar-sincronizacao').count()).toBe(0);
        expect(await tab.evaluate(() => window.syncDialogs)).toEqual([]);
    }
    const recoveryKeys = (await read(page, q(uid))).recoveryKeys;
    expect((await read(page, recoveryKeys.at(-1))).state.meses['2026-10'].receitas.find(item => item.id === 'salary').valor).toBe(1200);
});

test('automatic UI: concurrent edit/edit chooses server and archives rejection; deletion wins delayed editing', async ({ page, context, request }, info) => {
    const { uid, other, otherContext } = await pair({ page, context, request }, info);
    await importFile(page, { versao: 3, meses: { '2026-10': { receitas: [{ id: 'salary', nome: 'Salary', valor: 10 }], despesas: [] } } });
    await expect.poll(async () => (await rows(other, uid)).length).toBe(1);
    await Promise.all([context.setOffline(true), otherContext.setOffline(true)]);
    await edit(page, 20); await edit(other, 30);
    await context.setOffline(false);
    await expect.poll(async () => (await read(page, q(uid))).outbox.length).toBe(0);
    await otherContext.setOffline(false);
    await expect.poll(async () => (await rows(other, uid))[0]?.valor).toBe(20);
    await expect.poll(async () => (await read(other, q(uid))).automaticHistory?.some(item => JSON.stringify(item.local).includes('30'))).toBe(true);
    await otherContext.setOffline(true); await edit(other, 99);
    if (!await page.locator('#conteudo-receitas').isVisible()) await page.locator('[aria-controls="conteudo-receitas"]').click();
    await page.getByRole('button', { name: 'Remover entrada Salary', exact: true }).click();
    await expect.poll(async () => (await remote(request, uid, 'records'))[0].fields.deleted.booleanValue).toBe(true);
    await otherContext.setOffline(false);
    await expect.poll(async () => (await rows(other, uid)).length).toBe(0);
    await page.reload(); await other.reload();
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await expect(other.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    expect((await read(other, q(uid))).conflicts).toEqual([]);
    expect((await remote(request, uid, 'records'))).toHaveLength(1);
    expect((await remote(request, uid, 'operations')).some(item => item.name.includes('/auto-history-'))).toBe(true);
});

test('automatic UI: backup offline persists across restart and reconnects without a sync click', async ({ page, context, request }, info) => {
    const { uid, other } = await pair({ page, context, request }, info);
    await context.setOffline(true); await importFile(page, backup);
    await expect.poll(async () => Boolean((await read(page, q(uid))).restoreJob)).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect((await read(page, q(uid))).restoreJob).toBeTruthy();
    await context.setOffline(false);
    await expect.poll(async () => (await rows(other, uid)).length).toBe(2);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    expect((await read(page, q(uid))).restoreJob).toBeNull();
});

test('automatic UI: online transient failures retry with backoff; an offline deletion defeats a newer remote edit', async ({ page, context, request }, info) => {
    const { uid, other, otherContext } = await pair({ page, context, request }, info);
    await page.evaluate(() => { window.__autoTransientFailures = 3; });
    await importFile(page, { versao: 3, meses: { '2026-10': { receitas: [{ id: 'salary', nome: 'Salary', valor: 10 }], despesas: [] } } });
    await expect.poll(async () => (await rows(other, uid)).length, { timeout: 30_000 }).toBe(1);
    const failures = await page.evaluate(() => window.__syncDiagnostics.filter(item => item.code === 'unavailable'));
    expect(failures).toHaveLength(3);
    expect(failures[1].at - failures[0].at).toBeGreaterThanOrEqual(150);
    expect(failures[2].at - failures[1].at).toBeGreaterThanOrEqual(300);
    await otherContext.setOffline(true);
    if (!await other.locator('#conteudo-receitas').isVisible()) await other.locator('[aria-controls="conteudo-receitas"]').click();
    await other.getByRole('button', { name: 'Remover entrada Salary', exact: true }).click();
    await expect.poll(async () => (await read(other, q(uid))).outbox.some(item => item.value.deleted)).toBe(true);
    await edit(page, 40);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await otherContext.setOffline(false);
    await expect.poll(async () => (await rows(page, uid)).length).toBe(0);
    await expect(other.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    expect((await read(other, q(uid))).automaticHistory.some(item => item.remote?.record?.valor === 40)).toBe(true);
    expect((await remote(request, uid, 'records'))[0].fields.deleted.booleanValue).toBe(true);
    expect((await remote(request, uid, 'records'))).toHaveLength(1);
    expect(await other.evaluate(() => window.syncDialogs)).toEqual([]);
});

test('automatic UI: existing remote conflicts settle once, including rejected deletion, without a review dialog', async ({ page, context, request }, info) => {
    const { uid, other } = await pair({ page, context, request }, info);
    await importFile(page, { versao: 3, meses: { '2026-10': { receitas: [{ id: 'salary', nome: 'Salary', valor: 10 }], despesas: [] } } });
    await expect.poll(async () => (await rows(other, uid)).length).toBe(1);
    const rejected = async deleted => page.evaluate(async ({ uid, deleted }) => {
        const { firebaseConfig } = await import('/firebase-config.js');
        const sdk = await import('/firebase-sync.bundle.js?_release=' + encodeURIComponent(document.querySelector('meta[name="app-version"]').content));
        const { makeOperation, recordEntityKey } = await import('/sync-core.js');
        const client = sdk.productionClientForTest(firebaseConfig); await client.ready();
        const value = { month: '2026-10', type: 'receitas', id: 'salary', deleted,
            ...(deleted ? {} : { record: { id: 'salary', nome: 'Salary', valor: 99 } }) };
        const generation = (await client.generationMarker(uid))?.activeGeneration;
        return client.commit(uid, { ...makeOperation(recordEntityKey(value), value, null), generation });
    }, { uid, deleted });
    expect((await rejected(false)).conflict).toBe(true);
    await expect.poll(async () => (await remote(request, uid, 'conflicts')).every(item => item.fields.resolved?.booleanValue === true)).toBe(true);
    expect((await rows(other, uid))[0].valor).toBe(10);
    expect((await rejected(true)).conflict).toBe(true);
    await expect.poll(async () => (await rows(other, uid)).length).toBe(0);
    await expect.poll(async () => (await remote(request, uid, 'conflicts')).every(item => item.fields.resolved?.booleanValue === true)).toBe(true);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    const history = (await remote(request, uid, 'operations')).filter(item => item.name.includes('/auto-history-')).length;
    expect(history).toBeGreaterThanOrEqual(2);
    await page.reload(); await other.reload();
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await expect(other.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    expect((await remote(request, uid, 'records'))).toHaveLength(1);
    expect((await remote(request, uid, 'operations')).filter(item => item.name.includes('/auto-history-'))).toHaveLength(history);
    expect(await page.evaluate(() => window.syncDialogs)).toEqual([]);
    expect(await other.evaluate(() => window.syncDialogs)).toEqual([]);
});

test('automatic UI: a permanent restore error preserves the job and blocks edits until publication resumes', async ({ page, context, request }, info) => {
    const { uid, other } = await pair({ page, context, request }, info);
    await page.evaluate(() => { window.__autoTransientFailures = 1; window.__autoFailureCode = 'permission-denied'; });
    await importFile(page, { versao: 3, meses: { '2026-10': { receitas: [{ id: 'salary', nome: 'Salary', valor: 10 }], despesas: [] } } });
    await expect(page.locator('#estado-sincronizacao')).toHaveAttribute('data-state', 'error');
    await edit(page, 20);
    await expect.poll(async () => (await rows(page, uid))[0]?.valor).toBe(10);
    await expect(page.locator('#estado-sincronizacao')).toHaveAttribute('data-state', 'error');
    expect((await remote(request, uid, 'records'))).toHaveLength(0);
    await page.evaluate(() => { delete window.__autoFailureCode; window.dispatchEvent(new Event('online')); });
    await expect.poll(async () => (await rows(other, uid))[0]?.valor).toBe(10);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    expect((await remote(request, uid, 'records'))).toHaveLength(1);
});

test('automatic UI: explicit financial undo creates a new identity and preserves the confirmed tombstone', async ({ page, context, request }, info) => {
    const { uid, other } = await pair({ page, context, request }, info);
    await importFile(page, { versao: 3, meses: { '2026-10': { receitas: [{ id: 'salary', nome: 'Salary', valor: 10 }], despesas: [] } } });
    await expect.poll(async () => (await rows(other, uid)).length).toBe(1);
    if (!await page.locator('#conteudo-receitas').isVisible()) await page.locator('[aria-controls="conteudo-receitas"]').click();
    await page.getByRole('button', { name: 'Remover entrada Salary', exact: true }).click();
    await expect.poll(async () => (await remote(request, uid, 'records'))[0].fields.deleted.booleanValue).toBe(true);
    await page.locator('.aviso-acao').click();
    await expect.poll(async () => (await rows(other, uid)).filter(item => item.id !== 'salary').length).toBe(1);
    expect((await rows(other, uid))[0]).toMatchObject({ nome: 'Salary', valor: 10 });
    expect((await rows(other, uid))[0].id).not.toBe('salary');
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    const records = await remote(request, uid, 'records');
    expect(records).toHaveLength(2);
    expect(records.find(item => item.fields.id.stringValue === 'salary').fields.deleted.booleanValue).toBe(true);
    expect(records.filter(item => !item.fields.deleted.booleanValue)).toHaveLength(1);
});

test('automatic UI: legacy pending backup resumes settings and preserves its alternative without review', async ({ page, context, request }, info) => {
    const { uid, other } = await pair({ page, context, request }, info);
    await importFile(page, { versao: 3, meses: { '2026-10': { receitas: [{ id: 'salary', nome: 'Salary', valor: 10 }], despesas: [] } } });
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await context.setOffline(true);
    await page.evaluate(async uid => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('controleFinanceiro:integridade:v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise((resolve, reject) => {
            const tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents');
            const state = store.get(`estado:${uid}`); state.onsuccess = () => {
                const value = state.result; value.dados.meses['2026-10'].receitas[0].valor = 30;
                value.dados.categorias.push('Legacy import'); value.revisao++; store.put(value, `estado:${uid}`);
            };
            const queue = store.get(`fila:${uid}`); queue.onsuccess = () => {
                const value = queue.result; value.restoredPending = true; delete value.automaticPolicyInitialized;
                value.automaticSettingsDirty = false; store.put(value, `fila:${uid}`);
            };
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        }); db.close();
    }, uid);
    await page.reload({ waitUntil: 'domcontentloaded' }); await context.setOffline(false);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await expect.poll(async () => (await read(other, st(uid))).dados.categorias.includes('Legacy import')).toBe(true);
    expect((await rows(page, uid))[0].valor).toBe(10);
    expect((await read(page, q(uid))).automaticHistory.some(item => item.local.record?.record?.valor === 30)).toBe(true);
    expect((await read(page, q(uid))).restoredPending).toBe(false);
    expect(await page.evaluate(() => window.syncDialogs)).toEqual([]);
});
