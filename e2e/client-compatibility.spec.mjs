import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
if (process.env.LOCAL_TEST_COMPATIBILITY !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Isolated compatibility mode required');
async function rules(file) {
    const env = await initializeTestEnvironment({ projectId: 'demo-controle-financeiro', firestore: { host: '127.0.0.1', port: 8080,
        rules: await readFile(new URL(`../${file}`, import.meta.url), 'utf8') } });
    await env.cleanup();
}
test.beforeEach(() => rules('firestore.rules'));
test.afterEach(() => rules('firestore.rules'));
async function stored(page, key) {
    return page.evaluate(key => new Promise((resolve, reject) => {
        const request = indexedDB.open('controleFinanceiro:integridade:v1', 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { const db = request.result, tx = db.transaction('documents', 'readonly'), r = tx.objectStore('documents').get(key);
            let result; r.onsuccess = () => result = r.result; tx.oncomplete = () => { db.close(); resolve(result); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
    }), key);
}
test('offline published transport upgrades in the same browser storage and flushes original IDs once', async ({ page, context, request }) => {
    const email = `synthetic-upgrade-${crypto.randomUUID()}@local.test`;
    const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only', { data: { email, password: 'synthetic-password-only', returnSecureToken: true } });
    expect(response.ok()).toBeTruthy(); const uid = (await response.json()).localId;
    let legacy = true;
    await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'));
    await context.route('**/firebase-sync.bundle.js*', async route => {
        if (legacy) { const original = await route.fetch({ url: new URL('/firebase-sync.published.bundle.js', process.env.LOCAL_TEST_BASE_URL).href }); await route.fulfill({ response: original }); }
        else await route.continue();
    });
    await page.addInitScript(email => window.__testEmail = email, email);
    await page.goto('/'); await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
    await page.locator('#abrir-ajustes').click(); await expect(page.locator('#entrar-google')).toBeEnabled(); await page.locator('#entrar-google').click();
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado'); await page.locator('#fechar-ajustes').click();
    await context.setOffline(true);
    await page.locator('#adicionar-receita').click(); await page.locator('#receita-nome').fill('Synthetic upgrade'); await page.locator('#receita-valor').fill('19');
    await page.locator('#receita-repetir').uncheck(); await page.locator('#form-receita button[type="submit"]').click();
    await expect.poll(async () => (await stored(page, `fila:${uid}`)).outbox.length).toBe(1);
    const pending = (await stored(page, `fila:${uid}`)).outbox;
    await rules('firestore.integrity.rules');
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => window.__compatDenied === true)).toBe(true);
    expect((await stored(page, `fila:${uid}`)).outbox).toEqual(pending);
    const deniedCalls = await page.evaluate(() => window.__compatCommitCalls);
    // A bounded observation of the permanent error, not a delay used as readiness.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__compatCommitCalls)).toBe(deniedCalls);
    // Browser is closed to network while its durable old-client intent remains.
    // Reconnect fetches the new asset. No storage migration/clear is performed.
    legacy = false; await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    expect((await stored(page, `fila:${uid}`)).outbox).toEqual([]);
    const base = `http://127.0.0.1:8080/v1/projects/demo-controle-financeiro/databases/(default)/documents/users/${uid}`;
    const options = { headers: { Authorization: 'Bearer owner' } };
    const receipts = await (await request.get(`${base}/operations`, options)).json();
    expect(receipts.documents.map(item => item.name.split('/').at(-1))).toEqual(pending.map(item => item.id));
    expect(receipts.documents[0].fields.local.mapValue.fields.entityKey.stringValue).toBe(pending[0].entityKey);
    expect((await (await request.get(`${base}/records`, options)).json()).documents).toHaveLength(1);
    await page.reload(); await expect(page.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
    expect((await (await request.get(`${base}/operations`, options)).json()).documents).toHaveLength(1);
});
