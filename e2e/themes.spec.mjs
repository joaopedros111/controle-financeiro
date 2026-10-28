import { test, expect } from '@playwright/test';

const official = ['claro', 'escuro', 'rosa', 'pangolim'];
async function prepare(context, page, theme = 'claro') {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient'));
    await page.addInitScript(theme => {
        if (localStorage.getItem('controleFinanceiro:v3')) return;
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        localStorage.setItem('controleFinanceiro:tema-inicial', theme);
        localStorage.setItem('controleFinanceiro:v3', JSON.stringify({ versao: 3, tema: theme,
            categorias: ['Casa', 'Lazer', 'Outros'], orcamentos: { padrao: {}, meses: {} },
            meses: { [month]: { receitas: [{ id: 'theme-income', nome: 'Synthetic income', valor: 3000 }],
                despesas: [{ id: 'theme-home', nome: 'Synthetic home', categoria: 'Casa', valor: 900, pago: true },
                    { id: 'theme-leisure', nome: 'Synthetic leisure', categoria: 'Lazer', valor: 300, pago: false }] } }
        }));
    }, theme);
    await page.goto('/local-only.html');
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
}

async function audit(page) {
    const result = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const probe = document.createElement('span');
        document.body.append(probe);
        const color = token => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
        const surface = color('--superficie'), text = color('--texto');
        probe.remove();
        const dialog = document.querySelector('dialog[open]');
        const cards = [...document.querySelectorAll('.resumo, .bloco, .periodo, dialog[open]')];
        const chartColors = [...document.querySelectorAll('.categoria-barra')].map(el => getComputedStyle(el).backgroundColor);
        return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            dialogOverflow: !!dialog && dialog.scrollWidth > dialog.clientWidth + 1,
            outside: !!dialog && (dialog.getBoundingClientRect().left < -1 || dialog.getBoundingClientRect().right > innerWidth + 1),
            surfaces: cards.filter(el => getComputedStyle(el).backgroundColor !== surface)
                .map(el => ({ component: el.id || el.className, color: getComputedStyle(el).backgroundColor })),
            bodyText: getComputedStyle(document.body).color === text,
            themeColor: document.querySelector('meta[name="theme-color"]').content === root.getPropertyValue('--fundo').trim(),
            distinctBars: new Set(chartColors).size === chartColors.length,
            bars: chartColors.every(color => color !== 'rgba(0, 0, 0, 0)')
        };
    });
    expect(result).toEqual({ overflow: false, dialogOverflow: false, outside: false,
        surfaces: [], bodyText: true, themeColor: true, distinctBars: true, bars: true });
}

for (const theme of official) {
    test(`${theme}: cards, settings, forms, budgets and calculator share the theme across viewports`, async ({ context, page }, testInfo) => {
        test.setTimeout(90_000);
        await prepare(context, page, theme);
        await expect(page.locator('html')).toHaveAttribute('data-tema', theme);
        const focusColor = await page.locator('.grafico-sobretitulo').evaluate(el => getComputedStyle(el).color);
        for (const width of [320, 375, 768, 1280]) {
            await page.setViewportSize({ width, height: 896 });
            await audit(page);
            if ([375, 1280].includes(width)) await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}.png`), fullPage: true });
            await page.locator('#abrir-ajustes').click();
            await audit(page);
            if (width === 375) await page.locator('#dialogo-ajustes').screenshot({ path: testInfo.outputPath(`${theme}-settings.png`) });
            await page.locator('#abrir-categorias-orcamento').click();
            await audit(page);
            await page.locator('[data-orcamento-voltar]').click();
            await page.locator('#abrir-limites-orcamento').click();
            await audit(page);
            await page.locator('[data-orcamento-voltar]').click();
            await page.locator('#fechar-ajustes').click();
            for (const opener of ['#adicionar-receita', '#adicionar-despesa', '#abrir-calculadora']) {
                await page.locator(opener).click();
                await audit(page);
                if (opener === '#adicionar-receita') {
                    await page.locator('#receita-nome').focus();
                    await page.keyboard.press('Tab');
                    await page.keyboard.press('Shift+Tab');
                    await expect(page.locator('#receita-nome')).toHaveCSS('outline-style', 'solid');
                    await expect(page.locator('#receita-nome')).toHaveCSS('outline-color', focusColor);
                }
                await page.keyboard.press('Escape');
            }
        }
        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
        await expect(page.locator('html')).toHaveAttribute('data-tema', theme);
    });
}

test('four-theme selection persists across reloads and changes chart colors without changing financial output', async ({ context, page }) => {
    await prepare(context, page);
    const totals = () => page.locator('#total-receitas, #total-despesas, #saldo-valor, #valor-pendente, #taxa-economia, .grafico-categoria-valor, .grafico-categoria-percentual').allTextContents();
    const before = await totals();
    const colors = new Set();
    await page.locator('#abrir-ajustes').click();
    for (const theme of [...official, 'claro']) {
        if (theme !== 'claro' || colors.size) await page.locator('#alternar-tema').click();
        await expect(page.locator('html')).toHaveAttribute('data-tema', theme);
        colors.add(await page.locator('.categoria-barra').first().evaluate(el => getComputedStyle(el).backgroundColor));
        expect(await totals()).toEqual(before);
    }
    expect(colors.size).toBe(4);
    await page.locator('#alternar-tema').click();
    await page.locator('#alternar-tema').click();
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'rosa');
    expect(await totals()).toEqual(before);
});

test('retired Selva preference opens as Clean and stays compatible after reload', async ({ context, page }) => {
    await prepare(context, page, 'floresta');
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');
    expect(await page.evaluate(() => localStorage.getItem('controleFinanceiro:tema-inicial'))).toBe('claro');
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');
});
