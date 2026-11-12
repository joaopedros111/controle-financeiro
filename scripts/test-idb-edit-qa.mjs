// Synthetic QA regression: a fresh browser context and ephemeral origin isolate all data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const server = spawn(process.execPath, ['scripts/serve-idb-qa.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
let phase = 'infrastructure';
async function stopServer() {
    if (server.exitCode !== null || server.signalCode !== null) return;
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('QA child server did not stop')), 10_000);
        server.once('exit', () => { clearTimeout(timeout); resolve(); });
        server.kill('SIGTERM');
    });
}
async function ready(page, url) {
    await page.goto(url);
    await page.locator('html:not(.app-inicializando)').waitFor();
}
// Native IDB reads also work offline: the audit never depends on importing a module.
async function snapshot(page) {
    return page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('controleFinanceiro:integridade:v1', 2);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('documents', 'readonly'), result = {};
                for (const key of ['estado:local', 'fila:local']) {
                    const request = tx.objectStore('documents').get(key);
                    request.onsuccess = () => { result[key] = request.result; };
                }
                tx.oncomplete = () => resolve(result);
                tx.onabort = () => reject(tx.error);
            });
        } finally { db.close(); }
    });
}
const expenses = docs => Object.values(docs['estado:local'].dados.meses).flatMap(month => month.despesas);
async function expandExpenses(page) {
    if (await page.locator('#conteudo-despesas').isHidden()) await page.locator('#secao-despesas .bloco-retrair').click();
}
async function createExpense(page, name, value) {
    await page.locator('#adicionar-despesa').click();
    await page.locator('#despesa-nome').fill(name);
    await page.locator('#despesa-valor').fill(value);
    await page.locator('#form-despesa button[type=submit]').click();
}
async function openEdit(page, id, value) {
    await expandExpenses(page);
    await page.locator(`.despesa[data-id="${id}"] .editar-despesa`).click();
    await page.locator('#despesa-valor').fill(value);
}

try {
    const url = await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('QA server startup timed out')), 30_000);
        const finish = (callback, value) => { clearTimeout(timeout); callback(value); };
        server.stdout.on('data', chunk => {
            output += chunk;
            const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?indexeddb_homologacao=1/);
            if (match) finish(resolve, match[0]);
        });
        server.once('error', error => finish(reject, error));
        server.once('exit', code => finish(reject, new Error(`QA server exited: ${code}`)));
    });
    const origin = new URL(url).origin;
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
    phase = 'assertion';
    // Allow Service Workers so a registration regression cannot be hidden by Playwright.
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const external = [], pageErrors = [];
    await context.addInitScript(() => {
        window.qaCspViolations = [];
        document.addEventListener('securitypolicyviolation', event => window.qaCspViolations.push(event.effectiveDirective));
    });
    await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        external.push(route.request().url());
        return route.abort();
    });
    context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
    const page = await context.newPage();
    const response = await page.goto(url);
    const html = await response.text(), csp = response.headers()['content-security-policy'];
    const originalHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const registrationBlock = [...originalHtml.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)]
        .find(match => match[0].includes("navigator.serviceWorker.register('sw.js')"))?.[0];
    assert.ok(registrationBlock);
    assert.equal(html.replace('<!-- Service Worker desabilitado somente nesta cópia de QA. -->', ''),
        originalHtml.replace(registrationBlock, ''), 'Only the temporary registration block may change');
    assert.doesNotMatch(html, /navigator\.serviceWorker\.register/);
    assert.match(csp, /(?:^|;)\s*worker-src 'none'(?:;|$)/);
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /script-src 'self' 'sha256-/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    await page.locator('html:not(.app-inicializando)').waitFor();
    assert.deepEqual(await page.evaluate(() => window.qaCspViolations), []);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null);
    // Verify the worker restriction in the browser, not only the response header.
    assert.equal(await page.evaluate(async () => {
        try { await navigator.serviceWorker.register('/sw.js'); return false; } catch { return true; }
    }), true);
    await expect.poll(() => page.evaluate(() => window.qaCspViolations)).toContain('worker-src');
    assert.ok((await page.evaluate(() => window.qaCspViolations)).every(directive => directive === 'worker-src'));
    assert.deepEqual(await page.evaluate(() => caches.keys()), []);
    console.log('PASS: normal startup, no QA Service Worker/cache; CSP blocks worker registration.');

    await createExpense(page, 'Synthetic regression expense', '12.34');
    await expect.poll(async () => expenses(await snapshot(page))[0]?.valor).toBe(12.34);
    await ready(page, url);
    const id = expenses(await snapshot(page))[0].id;
    const preserved = { outbox: [{ id: 'synthetic-pending', entityKey: 'other' }], conflicts: [{ kind: 'synthetic-conflict' }], lastConfirmed: null };
    await page.evaluate(async queue => {
        const { abrirPersistenciaFinanceira } = await import('/indexeddb-persistence.js');
        const db = await abrirPersistenciaFinanceira();
        try { await db.alterar('fila:local', old => ({ ...old, ...queue })); } finally { db.fechar(); }
    }, preserved);
    await openEdit(page, id, '45.67');
    await page.locator('#form-despesa button[type=submit]').click();
    await expect(page.locator('#aviso')).toContainText('Despesa atualizada.');
    await page.reload();
    await page.locator('html:not(.app-inicializando)').waitFor();
    const reloaded = await snapshot(page);
    assert.equal(expenses(reloaded).length, 1);
    assert.equal(expenses(reloaded)[0].id, id);
    assert.equal(expenses(reloaded)[0].valor, 45.67);
    assert.deepEqual(reloaded['fila:local'].outbox, preserved.outbox);
    assert.deepEqual(reloaded['fila:local'].conflicts, preserved.conflicts);
    console.log('PASS: create 12.34, edit 45.67, reload, no duplicates; pending operations/conflicts preserved.');

    const other = await context.newPage();
    await ready(other, url);
    await Promise.all([createExpense(page, 'Synthetic tab A', '1.11'), createExpense(other, 'Synthetic tab B', '2.22')]);
    await expect.poll(async () => expenses(await snapshot(page)).length).toBe(3);
    await Promise.all([ready(page, url), ready(other, url)]);
    await Promise.all([openEdit(page, id, '50.00'), openEdit(other, id, '60.00')]);
    await page.locator('#form-despesa button[type=submit]').click();
    await expect.poll(async () => expenses(await snapshot(page)).find(item => item.id === id)?.valor).toBe(50);
    await other.locator('#form-despesa button[type=submit]').click();
    await expect(other.locator('#aviso')).toContainText('Outra aba alterou');
    assert.equal(expenses(await snapshot(page)).find(item => item.id === id).valor, 50);
    await ready(other, url);
    console.log('PASS: independent two-tab additions survive; real conflicting edit is rejected.');

    await expandExpenses(page);
    await page.locator(`.despesa[data-id="${id}"] .remover-despesa`).click();
    await expect.poll(async () => expenses(await snapshot(page)).some(item => item.id === id)).toBe(false);
    await ready(page, url);
    const beforeOffline = await snapshot(page);
    assert.equal(expenses(beforeOffline).length, 2);
    assert.deepEqual(beforeOffline['fila:local'].outbox, preserved.outbox);
    assert.deepEqual(beforeOffline['fila:local'].conflicts, preserved.conflicts);
    console.log('PASS: deletion persists after reload; unrelated records and queue preserved.');

    await context.setOffline(true);
    assert.deepEqual(await snapshot(other), beforeOffline);
    await assert.rejects(page.reload({ timeout: 10_000 }), /net::ERR_|NS_ERROR_/);
    await context.setOffline(false);
    await ready(page, url);
    assert.deepEqual(await snapshot(page), beforeOffline);
    console.log('PASS: offline reload fails at network navigation; restoring connectivity recovers exact IDB documents.');

    await stopServer();
    const unavailable = await context.newPage();
    await assert.rejects(unavailable.goto(url, { timeout: 10_000 }), /net::ERR_|NS_ERROR_/);
    assert.deepEqual(await snapshot(other), beforeOffline);
    assert.deepEqual(external, [], 'No request may leave the isolated QA origin, including Firebase');
    assert.deepEqual(pageErrors, []);
    console.log('PASS: stopped server gives browser connection error; open tab still reads unchanged IndexedDB; zero external requests.');
} catch (error) {
    console.error(`${phase === 'infrastructure' ? 'INFRASTRUCTURE' : 'ASSERTION/SCENARIO'} FAILURE: ${error.message}`);
    throw error;
} finally {
    await browser?.close();
    await stopServer();
}
