import { test, expect } from '@playwright/test';

const viewports = [
    { width: 320, height: 568, name: '320 portrait' },
    { width: 375, height: 667, name: '375 portrait' },
    { width: 390, height: 844, name: '390 portrait' },
    { width: 414, height: 896, name: '414 portrait' },
    { width: 568, height: 320, name: 'small landscape' },
    { width: 768, height: 1024, name: 'tablet portrait' },
    { width: 1024, height: 768, name: 'tablet landscape' },
    { width: 1280, height: 800, name: 'desktop' }
];
const languages = ['pt-BR', 'en', 'es', 'fr', 'de', 'ja'];

async function prepare(context, page) {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort('blockedbyclient'));
    await page.goto('/local-only.html');
    await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
}

async function layoutProblems(page) {
    return page.evaluate(() => {
        const visible = element => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const selectors = 'button, input, select, output, .nota, .nome-receita, .nome-despesa, .despesa-grupo-categoria, .texto-dialogo, .grafico-rosca-centro strong, .grafico-categoria-nome > span:last-child';
        const outside = [...document.querySelectorAll(selectors)].filter(visible).flatMap(element => {
            const rect = element.getBoundingClientRect();
            return rect.left < -1 || rect.right > innerWidth + 1
                ? [`${element.id || element.className || element.tagName}: ${rect.left.toFixed(1)}..${rect.right.toFixed(1)}/${innerWidth}`] : [];
        });
        const clippedButtons = [...document.querySelectorAll('button')].filter(visible).flatMap(button =>
            button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1
                ? [`${button.id || button.className}: ${button.clientWidth}x${button.clientHeight}/${button.scrollWidth}x${button.scrollHeight}`] : []);
        const clippedText = [...document.querySelectorAll('.grafico-rosca-centro strong, .grafico-categoria-nome > span:last-child')]
            .filter(visible).flatMap(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
                ? [`${element.className || element.tagName}: ${element.clientWidth}x${element.clientHeight}/${element.scrollWidth}x${element.scrollHeight}`] : []);
        const dialog = document.querySelector('dialog[open]');
        const dialogRect = dialog?.getBoundingClientRect();
        return {
            pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
            dialogOverflow: dialog ? Math.max(0, dialog.scrollWidth - dialog.clientWidth) : 0,
            dialogOutside: dialogRect && (dialogRect.top < -1 || dialogRect.bottom > innerHeight + 1) ? [
                `${dialog.id}: ${dialogRect.top.toFixed(1)}..${dialogRect.bottom.toFixed(1)}/${innerHeight}`
            ] : [],
            outside,
            clippedButtons,
            clippedText
        };
    });
}

async function expectResponsive(page, context) {
    const result = await layoutProblems(page);
    expect(result, context).toEqual({ pageOverflow: 0, dialogOverflow: 0, dialogOutside: [], outside: [], clippedButtons: [], clippedText: [] });
}

test('all supported widths and languages keep the page and settings controls inside the viewport', async ({ context, page }) => {
    await prepare(context, page);
    for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await expectResponsive(page, `${viewport.name}: main page`);
        for (const language of languages) {
            await page.locator('#abrir-ajustes').click();
            await page.locator('#idioma-interface').selectOption(language);
            await expect(page.locator('#exportar-historico-recuperacao')).toHaveText({
                'pt-BR': 'Baixar histórico', en: 'Download history', es: 'Descargar historial',
                fr: 'Télécharger l’historique', de: 'Verlauf herunterladen', ja: '履歴をダウンロード'
            }[language]);
            await expectResponsive(page, `${viewport.name}/${language}: settings`);
            const target = await page.locator('#exportar-historico-recuperacao').boundingBox();
            expect(target.width, `${viewport.name}/${language}: recovery button width`).toBeLessThanOrEqual(viewport.width - 28);
            expect(target.height, `${viewport.name}/${language}: recovery button touch target`).toBeGreaterThanOrEqual(44);
            await page.locator('#fechar-ajustes').click();
        }
    }
});

test('dialogs, long financial content, long categories and messages remain usable on narrow and landscape screens', async ({ context, page }) => {
    await prepare(context, page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator('#adicionar-receita').click();
    await page.locator('#receita-nome').fill('Receita internacional com um nome propositalmente muito longo para a linha');
    await page.locator('#receita-valor').fill('999999999.99');
    await page.locator('#form-receita button[type="submit"]').click();
    await page.locator('#adicionar-despesa').click();
    await page.locator('#despesa-nome').fill('Despesa doméstica com um nome propositalmente muito longo para a linha');
    await page.locator('#despesa-valor').fill('888888888.88');
    await page.locator('#despesa-tipo').selectOption('fixa');
    await page.locator('#form-despesa button[type="submit"]').click();
    for (const target of ['conteudo-receitas', 'conteudo-despesas']) {
        const toggle = page.locator(`[aria-controls="${target}"]`);
        if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    }
    await expectResponsive(page, '320: long names and monetary values');
    const rowTargets = await page.locator('.receita button, .despesa button').evaluateAll(buttons => buttons.map(button => {
        const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height };
    }));
    expect(Math.min(...rowTargets.map(({ width, height }) => Math.min(width, height))), JSON.stringify(rowTargets))
        .toBeGreaterThanOrEqual(43.5);

    for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.locator('#abrir-ajustes').click();
        await page.locator('#idioma-interface').selectOption('de');
        await expectResponsive(page, `${viewport.name}: long German settings`);

        await page.locator('#abrir-categorias-orcamento').click();
        if (viewport.width === 320) {
            await page.locator('#nova-categoria').fill('Sehr lange Kategorie für Haushaltsausgaben');
            await page.locator('#adicionar-categoria').click();
        }
        await expectResponsive(page, `${viewport.name}: category dialog`);
        const categoryTargets = await page.locator('#lista-categorias button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
        expect(categoryTargets.every(height => height >= 44), `${viewport.name}: category touch targets`).toBe(true);
        await page.locator('[data-orcamento-voltar]').click();
        await page.locator('#abrir-limites-orcamento').click();
        await expectResponsive(page, `${viewport.name}: budgets dialog`);
        await page.locator('[data-orcamento-voltar]').click();
        await page.locator('#fechar-ajustes').click();

        await page.locator('#adicionar-receita').click();
        await expectResponsive(page, `${viewport.name}: income dialog`);
        await page.locator('#cancelar-receita').click();
        await page.locator('#adicionar-despesa').click();
        await expectResponsive(page, `${viewport.name}: expense dialog`);
        await page.locator('#cancelar-despesa').click();
        await page.locator('#abrir-calculadora').click();
        await expectResponsive(page, `${viewport.name}: calculator dialog`);
        await page.locator('#fechar-calculadora').click();
        const expensesToggle = page.locator('[aria-controls="conteudo-despesas"]');
        if (await expensesToggle.getAttribute('aria-expanded') === 'false') await expensesToggle.click();
        await page.locator('.remover-despesa').first().click();
        await expectResponsive(page, `${viewport.name}: recurring expense removal dialog`);
        await page.locator('#serie-cancelar').click();
    }

    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => {
        const toast = document.querySelector('#aviso');
        toast.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Eine sehr lange wichtige Meldung mit Finanzwert 999.999.999.999,99 €' }),
            Object.assign(document.createElement('button'), { className: 'aviso-acao', textContent: 'Wiederherstellen' }));
        toast.className = 'aviso com-acao visivel';
    });
    await expectResponsive(page, '320/German: long toast');
    await expect(page.locator('.aviso-acao')).toHaveCSS('min-height', '44px');
});
