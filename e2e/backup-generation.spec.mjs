import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function prepare(context, page, email) {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'));
    await page.addInitScript(email => { window.__testEmail = email; }, email);
    await page.goto(new URL('/', process.env.LOCAL_TEST_BASE_URL).href);
    await page.locator('#abrir-ajustes').click();
    await page.locator('#entrar-google').click();
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await page.locator('#fechar-ajustes').click();
}
async function expand(page) {
    const toggle = page.locator('[aria-controls="conteudo-receitas"]');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function add(page, name, amount) {
    await page.locator('#adicionar-receita').click();
    await page.locator('#receita-nome').fill(name); await page.locator('#receita-valor').fill(String(amount));
    await page.locator('#form-receita button[type="submit"]').click(); await expand(page);
    return page.locator('.receita').filter({ hasText: name });
}
async function stored(page, key) {
    return page.evaluate(async key => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('controleFinanceiro:integridade:v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { return await new Promise((resolve, reject) => {
            const tx = db.transaction('documents', 'readonly'), r = tx.objectStore('documents').get(key);
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        }); } finally { db.close(); }
    }, key);
}

test('offline full restore activates atomically, survives reload and fences an old device queue', async ({ browser, context, page, request }) => {
    test.setTimeout(120000);
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    const email = `restore-${Date.now()}@local.test`;
    const signup = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only', {
        data: { email, password: 'synthetic-password-only', returnSecureToken: true }
    });
    expect(signup.ok()).toBeTruthy(); const uid = (await signup.json()).localId;
    await prepare(context, page, email);
    const before = await add(page, 'Before restore', 900), sameId = await before.getAttribute('data-id');
    const removed = await add(page, 'Recover deleted', 50), removedId = await removed.getAttribute('data-id');
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await removed.locator('.remover-receita').click();
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    const otherContext = await browser.newContext({ baseURL: process.env.LOCAL_TEST_BASE_URL });
    try {
        const other = await otherContext.newPage(); await prepare(otherContext, other, email); await expand(other);
        await expect(other.locator('.receita')).toHaveCount(1);
        await otherContext.setOffline(true);
        await add(other, 'Offline old operation', 777);
        await expect.poll(async () => (await stored(other, `fila:${uid}`))?.outbox?.length).toBeGreaterThan(0);
        const oldQueueId = (await stored(other, `fila:${uid}`)).outbox[0].id;
        const backup = { versao: 3, categorias: ['Casa'], tema: 'claro', orcamentos: { padrao: { Casa: 200 }, meses: { '2026-10': { Casa: 150 } } }, meses: {
            '2026-10': { receitas: [
                { id: sameId, nome: 'Restored income', valor: 100, recebido: true },
                { id: removedId, nome: 'Recovered income', valor: 25, recebido: false }
            ], despesas: [{ id: 'restored-bill', nome: 'Restored bill', valor: 20, categoria: 'Casa', pago: true }] }
        } };
        await context.setOffline(true);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#abrir-ajustes').click();
        await page.locator('#arquivo-backup').setInputFiles({ name: 'synthetic-full-restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
        await expect.poll(async () => Boolean((await stored(page, `fila:${uid}`))?.restoreJob)).toBe(true);
        await page.locator('#fechar-ajustes').click(); await expand(page);
        await expect(page.locator('.receita').filter({ hasText: 'Restored income' }).locator('.recebido-receita')).toBeChecked();
        const queue = await stored(page, `fila:${uid}`), recovery = await stored(page, queue.recoveryKeys.at(-1));
        expect(Object.values(recovery.state.meses).flatMap(month => month.receitas).find(item => item.id === sameId).valor).toBe(900);
        await page.reload(); await expand(page);
        await expect(page.locator('.receita')).toHaveCount(2);
        await context.setOffline(false);
        await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado', { timeout: 45000 });
        const generation = (await stored(page, `fila:${uid}`)).generation;
        expect(generation).not.toBe('legacy'); expect((await stored(page, `fila:${uid}`)).restoreJob).toBeNull();
        const control = await request.get(`http://127.0.0.1:8080/v1/projects/demo-controle-financeiro/databases/(default)/documents/users/${uid}/control/restore`, { headers: { Authorization: 'Bearer owner' } });
        expect((await control.json()).fields.activeGeneration.stringValue).toBe(generation);
        await otherContext.setOffline(false);
        await expect(other.locator('#estado-sincronizacao')).toContainText('somente no histórico', { timeout: 45000 });
        await expect(other.locator('#aviso-recuperacao-financeira')).toBeVisible();
        await expect(other.locator('#aviso-recuperacao-financeira')).toContainText('arquivadas sem aplicação');
        await expect(other.locator('.receita')).toHaveCount(2);
        await expect(other.locator('.receita').filter({ hasText: 'Offline old operation' })).toHaveCount(0);
        const adopted = await stored(other, `fila:${uid}`);
        expect(adopted.generation).toBe(generation); expect(adopted.outbox).toHaveLength(0);
        expect((await stored(other, adopted.recoveryKeys.at(-1))).queue.outbox.some(op => op.id === oldQueueId)).toBe(true);
        await other.reload(); await expand(other);
        await expect(other.locator('#aviso-recuperacao-financeira')).toBeVisible();
        await expect(other.locator('#aviso-recuperacao-financeira')).toHaveCount(1);
        const downloadPromise = other.waitForEvent('download');
        await other.locator('#baixar-recuperacao-financeira').click();
        const history = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
        expect(history.restorations.some(item => item.queue?.outbox?.some(op => op.id === oldQueueId))).toBe(true);
        await expect(other.locator('#aviso-recuperacao-financeira')).toBeHidden();
        await page.reload(); await expand(page);
        await expect(page.locator('.receita')).toHaveCount(2);
        expect((await stored(page, `estado:${uid}`)).dados.orcamentos).toEqual(backup.orcamentos);
        const restoredRow = page.locator(`.receita[data-id="${sameId}"]`);
        await restoredRow.locator('.editar-receita').click(); await page.locator('#receita-valor').fill('110');
        await page.locator('#form-receita button[type="submit"]').click();
        await expect(other.locator(`.receita[data-id="${sameId}"] .valor-receita`)).toContainText('110');
        const fresh = await add(other, 'After restore', 15);
        await expect(page.locator('.receita').filter({ hasText: 'After restore' })).toHaveCount(1);
        await fresh.locator('.remover-receita').click();
        await expect(page.locator('.receita').filter({ hasText: 'After restore' })).toHaveCount(0);
        await expect(page.locator(`.receita[data-id="${sameId}"] .recebido-receita`)).toBeChecked();
    } finally { await otherContext.close(); }
});

test('updated client shows a durable incompatibility warning, blocks edits and resumes only after compatible reads', async ({ context, page, request }) => {
    test.setTimeout(90000);
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    const email = `compatibility-${Date.now()}@local.test`;
    const signup = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only', {
        data: { email, password: 'synthetic-password-only', returnSecureToken: true }
    });
    expect(signup.ok()).toBeTruthy(); const uid = (await signup.json()).localId;
    await prepare(context, page, email);
    await context.setOffline(true);
    await add(page, 'Preserved pending income', 77);
    await expect.poll(async () => (await stored(page, `fila:${uid}`))?.outbox?.length).toBe(1);
    const pending = (await stored(page, `fila:${uid}`)).outbox;
    await page.addInitScript(() => { window.__requiredProtocolForTest = true; });
    await page.reload(); await context.setOffline(false); await expand(page);
    await expect(page.locator('#aviso-compatibilidade-financeira')).toBeVisible();
    await expect(page.locator('#estado-sincronizacao')).toContainText('Atualização obrigatória');
    await expect(page.locator('#adicionar-receita')).toBeDisabled();
    await expect(page.locator('.recebido-receita')).toBeDisabled();
    expect((await stored(page, `fila:${uid}`)).outbox).toEqual(pending);
    // Simulate a stale tab submitting an edit already in flight: DOM controls
    // cannot bypass the durable compatibility gate or create financial operations.
    await page.locator('.editar-receita').evaluate(button => { button.disabled = false; });
    await page.locator('.editar-receita').click();
    await page.locator('#form-receita input, #form-receita button').evaluateAll(elements => elements.forEach(element => { element.disabled = false; }));
    await page.locator('#receita-valor').fill('88');
    await page.locator('#form-receita button[type="submit"]').click();
    await expect(page.locator('#aviso-recuperacao-financeira')).toContainText('não foi aplicada');
    const recoveryKey = (await stored(page, `fila:${uid}`)).recoveryKeys.at(-1);
    await page.reload(); await expand(page);
    const rejected = await stored(page, recoveryKey);
    expect(Object.values(rejected.proposta.meses).flatMap(month => month.receitas)[0].valor).toBe(88);
    expect(Object.values(rejected.base.meses).flatMap(month => month.receitas)[0].valor).toBe(77);
    expect((await stored(page, `fila:${uid}`)).outbox).toEqual(pending);
    await expect(page.locator('#aviso-recuperacao-financeira')).toContainText('não foi aplicada');
    await page.locator('#atualizar-compatibilidade-financeira').click();
    await expect(page.locator('#status-atualizacao')).toContainText('Atualização obrigatória');
    await expect(page.locator('#adicionar-receita')).toBeDisabled();
    // Same local store, now supplied with a compatible transport after updating.
    await page.evaluate(() => { window.__requiredProtocolForTest = false; window.dispatchEvent(new Event('online')); });
    await expect(page.locator('#aviso-compatibilidade-financeira')).toBeHidden();
    await expect(page.locator('#adicionar-receita')).toBeEnabled();
    await expect(page.locator('#estado-sincronizacao')).toContainText('somente no histórico');
    await expect(page.locator('#aviso-recuperacao-financeira')).toBeVisible();
    await expect(page.locator('.receita')).toHaveCount(0);
    expect((await stored(page, `fila:${uid}`)).outbox).toHaveLength(0);
    await page.locator('#baixar-recuperacao-financeira').click();
    await expect(page.locator('#aviso-recuperacao-financeira')).toBeHidden();
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await add(page, 'New edit after update', 42);
    await expect(page.locator('.receita')).toHaveCount(1);
    await page.locator('.recebido-receita').check();
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await expect(page.locator('.situacao')).toHaveText('Recebido');
});
