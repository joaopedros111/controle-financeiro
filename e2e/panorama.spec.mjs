import { test, expect } from '@playwright/test';

test('Panorama keeps a compact strip and readable category bars on mobile and desktop', async ({ context, page }) => {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient'));
    await page.addInitScript(() => {
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        localStorage.setItem('controleFinanceiro:v3', JSON.stringify({ versao: 3, categorias: ['Moradia', 'Outros'],
            meses: { [month]: { receitas: [], despesas: [
                { id: 'visual-a', nome: 'Synthetic A', categoria: 'Moradia', valor: 30 },
                { id: 'visual-b', nome: 'Synthetic B', categoria: 'Outros', valor: 10 }
            ] } }, orcamentos: { padrao: {}, meses: {} } }));
    });
    await page.goto('/local-only.html');
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
    await expect(page.locator('#grafico-mensal, .grafico-meses, #detalhe-grafico-mensal')).toHaveCount(0);
    await expect(page.locator('.resumo .indicadores dt')).toHaveCount(4);
    await expect(page.locator('#variacao-despesas, #variacao-periodo, .categoria-total')).toHaveCount(0);
    await expect(page.locator('#total-grafico-categorias')).toHaveCount(1);
    await expect(page.locator('#total-grafico-categorias')).toContainText('40,00');
    await expect(page.locator('.categoria-trilho').first()).toHaveCSS('height', '14px');
    for (const width of [320, 375, 390, 414, 1280]) {
        await page.setViewportSize({ width, height: 896 });
        for (const language of ['pt-BR', 'en', 'es', 'fr', 'de', 'ja']) {
            await page.locator('#abrir-ajustes').click();
            await page.locator('#idioma-interface').selectOption(language);
            await page.keyboard.press('Escape');
            const layout = await page.evaluate(() => {
                const cards = [...document.querySelectorAll('.panorama-indicadores > div')];
                const [a, b] = cards.map(card => card.getBoundingClientRect());
                const categories = document.querySelector('.grafico-categorias').getBoundingClientRect();
                const container = document.querySelector('.panorama-graficos').getBoundingClientRect();
                return {
                    sameRow: Math.abs(a.top - b.top) < 1 && b.left >= a.right,
                    equalWidths: Math.abs(a.width - b.width) < 1,
                    fullWidth: Math.abs(categories.width - container.width) < 1,
                    noCards: cards.every(card => getComputedStyle(card).backgroundColor === 'rgba(0, 0, 0, 0)'
                        && getComputedStyle(card).borderTopWidth === '0px'),
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    clipped: [...cards, ...document.querySelectorAll('.grafico-categoria-item')].some(card => [card, ...card.querySelectorAll('dt, dd, small, .grafico-categoria-nome, .grafico-categoria-valor, .grafico-categoria-percentual')]
                        .some(el => el.scrollWidth > el.clientWidth + 1))
                };
            });
            expect(layout, width + 'px / ' + language).toEqual({
                sameRow: true, equalWidths: true, fullWidth: true, noCards: true, overflow: false, clipped: false
            });
        }
    }
    await page.locator('#alternar-visibilidade-resumo').click();
    await expect(page.locator('#taxa-economia')).toHaveText('••••');
    await expect(page.locator('#total-grafico-categorias')).toHaveText('••••');
    await expect(page.locator('#barra')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#barra')).toHaveCSS('display', 'flex');
});
