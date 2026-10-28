import { test, expect } from '@playwright/test';

test('Panorama keeps savings in the summary and readable category bars on mobile and desktop', async ({ context, page }) => {
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
    await expect(page.locator('.resumo .indicadores dt')).toHaveCount(5);
    await expect(page.locator('#variacao-despesas, #variacao-periodo, .categoria-total')).toHaveCount(0);
    await expect(page.locator('.grafico-bloco #taxa-economia, #total-grafico-categorias, .panorama-indicadores')).toHaveCount(0);
    await expect(page.locator('.resumo #taxa-economia')).toHaveCount(1);
    await expect(page.locator('#titulo-grafico')).toHaveText('Gastos por categoria');
    await expect(page.locator('.categoria-trilho').first()).toHaveCSS('height', '14px');
    for (const width of [320, 375, 390, 414, 1280]) {
        await page.setViewportSize({ width, height: 896 });
        for (const language of ['pt-BR', 'en', 'es', 'fr', 'de', 'ja']) {
            await page.locator('#abrir-ajustes').click();
            await page.locator('#idioma-interface').selectOption(language);
            await page.keyboard.press('Escape');
            const layout = await page.evaluate(() => {
                const cards = [...document.querySelectorAll('.resumo .indicadores > div')];
                const padding = selector => { const s = getComputedStyle(document.querySelector(selector)); return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' '); };
                const categories = document.querySelector('.grafico-categorias').getBoundingClientRect();
                const container = document.querySelector('.panorama-graficos').getBoundingClientRect();
                return {
                    samePadding: padding('.resumo') === padding('.grafico-bloco'),
                    fullWidth: Math.abs(categories.width - container.width) < 1,
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    clipped: [...cards, ...document.querySelectorAll('.grafico-categoria-item')].some(card => [card, ...card.querySelectorAll('dt, dd, small, .grafico-categoria-nome, .grafico-categoria-valor, .grafico-categoria-percentual')]
                        .some(el => el.scrollWidth > el.clientWidth + 1))
                };
            });
            expect(layout, width + 'px / ' + language).toEqual({
                samePadding: true, fullWidth: true, overflow: false, clipped: false
            });
        }
    }
    await page.locator('#alternar-visibilidade-resumo').click();
    await expect(page.locator('#taxa-economia')).toHaveText('••••');
    await expect(page.locator('#barra')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#barra')).toHaveCSS('display', 'flex');
});
