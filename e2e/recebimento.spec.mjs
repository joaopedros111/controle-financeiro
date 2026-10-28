import { test, expect } from '@playwright/test';

async function prepare(context, page, path = '/local-only.html') {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient'));
    await page.goto(path);
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
}
async function expand(page) {
    const toggle = page.locator('[aria-controls="conteudo-receitas"]');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function create(page, name, value, received = false, recurring = false) {
    await page.locator('#adicionar-receita').click();
    await page.locator('#receita-nome').fill(name);
    await page.locator('#receita-valor').fill(String(value));
    await page.locator('#receita-recebido').setChecked(received);
    await page.locator('#receita-repetir').setChecked(recurring);
    await page.locator('#form-receita button[type="submit"]').click();
    await expand(page);
    const row = page.locator('.receita').filter({ has: page.locator('.nome-receita', { hasText: name }) });
    await expect(row).toHaveCount(1);
    return row;
}
async function totals(page) {
    return page.locator('#total-receitas, #total-despesas, #saldo-valor, #valor-pendente, #taxa-economia, #variacao-despesas').allTextContents();
}

test('received and pending entries retain status across editing, reload, deletion and undo without changing totals', async ({ context, page }) => {
    await prepare(context, page);
    const received = await create(page, 'Synthetic received', 100, true);
    const pending = await create(page, 'Synthetic pending', 50);
    await expect(received.locator('.recebido-receita')).toBeChecked();
    await expect(received.locator('.situacao')).toHaveText('Recebido');
    await expect(pending.locator('.situacao')).toHaveText('A receber');
    await expect(page.locator('#total-receitas')).toContainText('150,00');
    await expect(page.locator('#saldo-valor')).toContainText('150,00');
    const before = await totals(page);
    await pending.locator('.recebido-receita').check();
    await expect(pending.locator('.situacao')).toHaveText('Recebido');
    expect(await totals(page)).toEqual(before);
    await pending.locator('.recebido-receita').uncheck();
    await expect(pending.locator('.situacao')).toHaveText('A receber');
    expect(await totals(page)).toEqual(before);
    await received.locator('.editar-receita').click();
    await expect(page.locator('#receita-recebido')).toBeChecked();
    await page.locator('#receita-nome').fill('Synthetic received edited');
    await page.locator('#form-receita button[type="submit"]').click();
    const edited = page.locator('.receita').filter({ hasText: 'Synthetic received edited' });
    await expect(edited.locator('.recebido-receita')).toBeChecked();
    // Wait for the existing atomic persistence confirmation before reloading.
    await expect.poll(() => page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('controleFinanceiro:integridade:v1', 1);
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('documents', 'readonly');
                const r = tx.objectStore('documents').get('estado:@local');
                r.onsuccess = () => resolve(Object.values(r.result?.dados?.meses || {}).some(month =>
                    month.receitas.some(row => row.nome === 'Synthetic received edited' && row.recebido === true)));
                r.onerror = () => reject(r.error);
            });
        } finally { db.close(); }
    })).toBe(true);
    await page.reload(); await expand(page);
    await expect(edited.locator('.recebido-receita')).toBeChecked();
    await expect(pending.locator('.recebido-receita')).not.toBeChecked();
    expect(await totals(page)).toEqual(before);
    await edited.locator('.remover-receita').click();
    await expect(edited).toHaveCount(0);
    await page.locator('#aviso .aviso-acao').click();
    await expect(edited.locator('.recebido-receita')).toBeChecked();
});

test('income boxes use the expense grid and keep salary aligned at mobile and desktop widths', async ({ context, page }) => {
    await prepare(context, page);
    await create(page, 'Synthetic income with an intentionally long name for the row', 999999999.99);
    await create(page, 'Synthetic recurring income with an intentionally long name for the row', 999999999.99, false, true);
    const salary = await create(page, 'Salário', 2000, true, true);
    await page.locator('#adicionar-despesa').click();
    await page.locator('#despesa-nome').fill('Synthetic expense');
    await page.locator('#despesa-valor').fill('10');
    await page.locator('#form-despesa button[type="submit"]').click();
    const expenses = page.locator('[aria-controls="conteudo-despesas"]');
    if (await expenses.getAttribute('aria-expanded') === 'false') await expenses.click();
    for (const width of [320, 375, 390, 414, 1280]) {
        await page.setViewportSize({ width, height: 896 });
        for (const language of ['pt-BR', 'en', 'es', 'fr', 'de', 'ja']) {
            await page.locator('#abrir-ajustes').click();
            await page.locator('#idioma-interface').selectOption(language);
            await page.keyboard.press('Escape');
            const received = ['pt-BR', 'es', 'de'].includes(language);
            await salary.locator('.recebido-receita').setChecked(received);
            const layout = await page.evaluate(() => {
                const rows = [...document.querySelectorAll('.receita')];
                const row = rows.find(row => row.querySelector('.nome-receita').textContent === 'Salário');
                const parts = [...row.children];
                const boxes = parts.map(el => el.getBoundingClientRect());
                const incomeButton = row.querySelector('button').getBoundingClientRect();
                const expenseButton = document.querySelector('.despesa button').getBoundingClientRect();
                const name = row.querySelector('.nome-receita').getBoundingClientRect();
                const badge = row.querySelector('.marca-recorrente').getBoundingClientRect();
                const status = row.querySelector('.situacao').getBoundingClientRect();
                const amount = row.querySelector('.valor-receita').getBoundingClientRect();
                const box = getComputedStyle(row);
                const expenseBox = getComputedStyle(document.querySelector('.despesa-grupo'));
                const reference = document.querySelector('.despesa');
                const selectors = ['input', '.despesa-nome', '.situacao', '.valor-despesa', '.editar-despesa', '.remover-despesa'];
                return {
                    order: parts.map(el => el.className),
                    overlap: rows.some(row => {
                        const boxes = [...row.children].map(el => el.getBoundingClientRect());
                        return boxes.some((box, index) => boxes.slice(index + 1).some(other =>
                            Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
                            && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1));
                    }),
                    sameGridPositions: rows.every(row => [...row.children].every((part, index) => {
                        const actual = getComputedStyle(part), expected = getComputedStyle(reference.querySelector(selectors[index]));
                        return actual.gridColumn === expected.gridColumn && actual.gridRow === expected.gridRow;
                    })),
                    aligned: boxes.every(part => Math.abs((part.top + part.bottom) - (boxes[0].top + boxes[0].bottom)) < 2),
                    visibleNames: rows.every(row => row.querySelector('.nome-receita').getBoundingClientRect().width > 0),
                    labelsContained: rows.every(row => {
                        const label = row.querySelector('.marca-recorrente');
                        return !label || label.getBoundingClientRect().right <= label.parentElement.getBoundingClientRect().right + 1;
                    }),
                    inlineRecurrence: name.width > 0 && (name.width + badge.width + 4 > parts[1].clientWidth
                        || badge.left >= name.right && Math.abs((name.top + name.bottom) - (badge.top + badge.bottom)) < 2),
                    salaryUnclipped: innerWidth !== 375 || document.documentElement.lang !== 'pt-BR'
                        || row.querySelector('.nome-receita').scrollWidth <= row.querySelector('.nome-receita').clientWidth + 1,
                    statusBesideAmount: Math.abs((status.top + status.bottom) - (amount.top + amount.bottom)) < 2
                        && Math.abs(amount.left - status.right - parseFloat(getComputedStyle(row).columnGap)) < 2,
                    individualBox: box.borderTopWidth === '1px' && box.borderBottomWidth === '1px'
                        && box.borderRadius === expenseBox.borderRadius && box.backgroundColor === expenseBox.backgroundColor,
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    matchingButtons: incomeButton.width === expenseButton.width && incomeButton.height === expenseButton.height
                };
            });
            expect(layout, `${width}px / ${language}`).toEqual({
                order: ['recebido-receita', 'receita-identificacao', received ? 'situacao situacao-paga' : 'situacao situacao-pendente', 'valor-receita', 'editar-receita', 'remover-receita'],
                overlap: false, sameGridPositions: true, aligned: true, visibleNames: true, labelsContained: true, inlineRecurrence: true,
                salaryUnclipped: true, statusBesideAmount: true, individualBox: true, overflow: false, matchingButtons: true
            });
            if (width === 375 && language === 'pt-BR') {
                await page.screenshot({ path: `${process.env.LOCAL_TEST_OUTPUT}/entradas-375.png`, fullPage: true });
            }
        }
    }
});

test('entry and expense action colors and interaction states match across themes and viewports', async ({ context, page }) => {
    await prepare(context, page);
    await create(page, 'Synthetic action receipt', 100, false, true);
    await page.locator('#adicionar-despesa').click();
    await page.locator('#despesa-nome').fill('Synthetic action expense');
    await page.locator('#despesa-valor').fill('10');
    await page.locator('#form-despesa button[type="submit"]').click();
    const toggle = page.locator('[aria-controls="conteudo-despesas"]');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    const buttons = page.locator('.receita > button, .despesa > button');
    let edit, remove;
    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 896 });
        for (const theme of ['claro', 'escuro', 'rosa', 'pangolim']) {
            if (await page.locator('html').getAttribute('data-tema') !== theme) {
                await page.locator('#abrir-ajustes').click();
                await page.locator('#alternar-tema').click();
                await page.keyboard.press('Escape');
            }
            await expect(page.locator('html')).toHaveAttribute('data-tema', theme);
            ({ edit, remove } = await page.evaluate(() => {
                const probe = document.createElement('span');
                document.body.append(probe);
                const color = token => { probe.style.color = 'var(' + token + ')'; return getComputedStyle(probe).color; };
                const palettes = {
                    edit: { background: color('--primaria-suave'), color: color('--primaria'), border: color('--borda') },
                    remove: { background: color('--vermelho-suave'), color: color('--vermelho'), border: color('--borda') }
                };
                probe.remove();
                return palettes;
            }));
            await page.mouse.move(0, 0);
            const styles = await buttons.evaluateAll(buttons => buttons.map(button => {
                const s = getComputedStyle(button), r = button.getBoundingClientRect();
                const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number)
                    .map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
                    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
                const a = luminance(s.backgroundColor), b = luminance(s.color);
                return { edit: button.className.startsWith('editar'), background: s.backgroundColor, color: s.color,
                    border: s.borderTopColor, radius: s.borderRadius, width: r.width, height: r.height,
                    contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
            }));
            expect(styles).toHaveLength(4);
            for (const { edit: editing, contrast, ...style } of styles) {
                expect(style, `${width}px / ${theme}`).toEqual({ ...(editing ? edit : remove), radius: '12px', width: 44, height: 44 });
                expect(contrast).toBeGreaterThanOrEqual(4.5);
            }
            if (theme === 'escuro') await page.screenshot({ path: `${process.env.LOCAL_TEST_OUTPUT}/acoes-${width}-escuro.png`, fullPage: true });
        }
        for (const button of await buttons.all()) {
            const palette = (await button.getAttribute('class')).startsWith('editar') ? edit : remove;
            await button.hover();
            await expect(button).toHaveCSS('border-top-color', palette.color);
            await page.mouse.down();
            await expect(button).toHaveCSS('box-shadow', /inset/);
            await page.mouse.move(0, 0);
            await page.mouse.up();
            await button.focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            await expect(button).toHaveCSS('outline-style', 'solid');
            await expect(button).toHaveCSS('outline-width', '2px');
            await expect(button).toHaveCSS('outline-color', palette.color);
            await button.evaluate(el => { el.disabled = true; });
            await button.hover({ force: true });
            await expect(button).toHaveCSS('opacity', '0.4');
            await expect(button).toHaveCSS('cursor', 'not-allowed');
            await expect(button).toHaveCSS('border-top-color', palette.border);
            await button.evaluate(el => { el.disabled = false; });
        }
    }
});

test('receipt status synchronizes between isolated devices and another tab using the existing service', async ({ browser, context, page, request }) => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    const email = `receipt-${Date.now()}@local.test`;
    const signup = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only', {
        data: { email, password: 'synthetic-password-only', returnSecureToken: true }
    });
    expect(signup.ok()).toBeTruthy();
    const otherContext = await browser.newContext();
    try {
        const other = await otherContext.newPage();
        for (const [ctx, target] of [[context, page], [otherContext, other]]) {
            await target.addInitScript(value => { window.__testEmail = value; }, email);
            await prepare(ctx, target, new URL('/', process.env.LOCAL_TEST_BASE_URL).href);
            await target.locator('#abrir-ajustes').click();
            await target.locator('#entrar-google').click();
            await expect(target.locator('#estado-sincronizacao')).toHaveText('Sincronizado');
            await target.locator('#fechar-ajustes').click();
        }
        const local = await create(page, 'Synthetic synchronized receipt', 200);
        await expect(other.locator('.receita')).toHaveCount(1); await expand(other);
        await local.locator('.recebido-receita').check();
        await expect(other.locator('.recebido-receita')).toBeChecked();
        await other.locator('.editar-receita').click();
        await expect(other.locator('#receita-recebido')).toBeChecked();
        await other.locator('#receita-valor').fill('210');
        await other.locator('#form-receita button[type="submit"]').click();
        await expect(local.locator('.valor-receita')).toContainText('210');
        await expect(local.locator('.recebido-receita')).toBeChecked();
        await other.locator('.recebido-receita').uncheck();
        await expect(local.locator('.recebido-receita')).not.toBeChecked();
        const tab = await context.newPage();
        await tab.goto('/'); await expand(tab);
        await expect(tab.locator('.recebido-receita')).not.toBeChecked();
        await tab.locator('.recebido-receita').check();
        await expect(local.locator('.recebido-receita')).toBeChecked();
        await expect(other.locator('.recebido-receita')).toBeChecked();
        await other.reload(); await expand(other);
        await expect(other.locator('.recebido-receita')).toBeChecked();
    } finally { await otherContext.close(); }
});
