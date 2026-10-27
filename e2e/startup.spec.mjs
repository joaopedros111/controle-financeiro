import { test, expect } from '@playwright/test';

const project = 'demo-controle-financeiro';
const firestore = 'http://127.0.0.1:8080';
const auth = 'http://127.0.0.1:9099';

async function idbState(page, uid) {
    return page.evaluate(async key => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('controleFinanceiro:integridade:v1', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('documents', 'readonly');
                const request = tx.objectStore('documents').get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } finally { db.close(); }
    }, `estado:${uid}`);
}

test.beforeEach(async ({ context, page, request }) => {
    page.on('dialog', dialog => dialog.accept());
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    await request.delete(`${firestore}/emulator/v1/projects/${project}/databases/(default)/documents`);
    await request.delete(`${auth}/emulator/v1/projects/${project}/accounts`);
    await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient'));
    await page.addInitScript(() => { window.__testEmail = 'startup@local.test'; });
});

test('restored mobile session reveals the account cache before remote synchronization', async ({ context, page, request }) => {
    const response = await request.post(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only`, {
        data: { email: 'startup@local.test', password: 'synthetic-password-only', returnSecureToken: true }
    });
    const uid = (await response.json()).localId;
    await page.goto('/');
    await page.locator('#abrir-ajustes').click();
    await page.locator('#entrar-google').click();
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await page.locator('#arquivo-backup').setInputFiles({
        name: 'startup.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ versao: 3, meses: {
            '2026-10': { receitas: [{ id: 'startup-income', nome: 'Persistida', valor: 321 }], despesas: [] }
        } }))
    });
    await page.locator('#alternar-tema').click();
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    await expect.poll(async () => (await idbState(page, uid)).dados.tema).toBe('escuro');

    await context.addInitScript(() => {
        window.__startupAudit = { loadingSeen: false, reveal: null, prePaintTheme: null };
        const sample = () => {
            const root = document.documentElement;
            const loading = root.classList.contains('app-inicializando') || root.classList.contains('app-carregando-conta');
            if (loading) window.__startupAudit.loadingSeen = true;
            if (!window.__startupAudit.prePaintTheme && root.dataset.tema) window.__startupAudit.prePaintTheme = root.dataset.tema;
            if (!loading && !window.__startupAudit.reveal && document.querySelector('#lista-receitas')) {
                window.__startupAudit.reveal = {
                    theme: root.dataset.tema,
                    incomes: document.querySelectorAll('.receita').length,
                    busy: document.body.getAttribute('aria-busy')
                };
            }
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando|app-carregando-conta/);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Offline');
    const audit = await page.evaluate(() => window.__startupAudit);
    expect(audit.loadingSeen).toBe(true);
    expect(audit.prePaintTheme).toBe('escuro');
    expect(audit.reveal).toEqual({ theme: 'escuro', incomes: 1, busy: null });
    expect((await idbState(page, uid)).dados.meses['2026-10'].receitas).toHaveLength(1);

    await context.setOffline(false);
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    expect((await idbState(page, uid)).dados.meses['2026-10'].receitas).toHaveLength(1);
});
