import { test, expect } from '@playwright/test';

test('Panorama keeps equal indicator columns and full-width categories on mobile and desktop', async ({ context, page }) => {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient'));
    await page.goto('/local-only.html');
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
    await expect(page.locator('#grafico-mensal, .grafico-meses, #detalhe-grafico-mensal')).toHaveCount(0);
    await expect(page.locator('.resumo .indicadores dt')).toHaveCount(4);
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
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    clipped: cards.some(card => [card, ...card.querySelectorAll('dt, dd, small')]
                        .some(el => el.scrollWidth > el.clientWidth + 1))
                };
            });
            expect(layout, width + 'px / ' + language).toEqual({
                sameRow: true, equalWidths: true, fullWidth: true, overflow: false, clipped: false
            });
        }
    }
    await page.locator('#alternar-visibilidade-resumo').click();
    await expect(page.locator('#taxa-economia')).toHaveText('••••');
    await expect(page.locator('#variacao-despesas')).toHaveText('••••');
    await expect(page.locator('#barra')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#barra')).toHaveCSS('display', 'flex');
});
