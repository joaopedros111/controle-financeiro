import { test, expect } from '@playwright/test';

test('Panorama stacks at 414px and exposes six months by touch with privacy', async ({ context, page }) => {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient'));
    await page.setViewportSize({ width: 414, height: 896 });
    await page.goto('/local-only.html');
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
    const months = page.locator('#grafico-mensal button');
    await expect(months).toHaveCount(6);
    await months.first().click();
    await expect(page.locator('#detalhe-grafico-mensal')).not.toBeEmpty();
    await expect(months.first()).toHaveAttribute('aria-pressed', 'true');
    const layout = await page.evaluate(() => {
        const monthly = document.querySelector('.grafico-meses').getBoundingClientRect();
        const categories = document.querySelector('.grafico-categorias').getBoundingClientRect();
        return { stacked: categories.top >= monthly.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(layout).toEqual({ stacked: true, overflow: false });
    await page.locator('#alternar-visibilidade-resumo').click();
    await months.first().click();
    await expect(page.locator('#detalhe-grafico-mensal')).toContainText('••••');
    await expect(page.locator('#taxa-economia')).toHaveText('••••');
    await expect(page.locator('#variacao-despesas')).toHaveText('••••');
});
