import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { somarCentavos, agruparDespesasPorCategoria } from '../finance-core.js';
import { IDIOMAS, LOCALES, textoTraduzido } from '../localization.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
class Element {
    constructor(tag, props = {}, children = []) {
        this.tag = tag; Object.assign(this, props); this.children = children; this.style = {}; this.attrs = {}; this.events = {};
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, fn) { this.events[key] = fn; }
    querySelectorAll() { return this.children; }
}
function setup(language = 'pt-BR') {
    const nodes = new Map();
    const context = vm.createContext({
        Intl, Date, LOCALES, idiomaAtual: language, valoresOcultos: false,
        periodo: { ano: 2026, mes: 1 }, estado: { meses: {} }, numero: Number,
        chaveMes: (year, month) => `${year}-${String(month).padStart(2, '0')}`,
        somarCentavos, agruparDespesasPorCategoria,
        somar: items => somarCentavos(items.map(item => item.valor)) / 100,
        obterMes: () => context.estado.meses['2026-01'] || { despesas: [] },
        corDaCategoria: () => '#123456',
        formatarMoeda: value => context.valoresOcultos ? '••••' : String(value),
        formatarPercentual: value => `${value}%`,
        textoTraduzido: text => textoTraduzido(text, language),
        $: id => { if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id); },
        criarEl: (...args) => new Element(...args)
    });
    vm.runInContext(source.slice(source.indexOf('function renderIndicadoresPanorama('), source.indexOf('function renderTudo(')), context);
    return context;
}

test('Panorama rates handle savings, deficits, zero bases and year rollover without mutating state', () => {
    const c = setup();
    for (const [income, expense, previous, savings, change] of [
        [10000, 6000, 30, '+40%', '+100%'], [10000, 15000, 300, '-50%', '-50%'],
        [10000, 0, 30, '+100%', '-100%'], [0, 0, 0, 'Não calculável: sem entradas', '0%'],
        [0, 1000, 0, 'Não calculável: sem entradas', 'Não calculável: mês anterior sem despesas']
    ]) {
        c.estado.meses['2025-12'] = { despesas: [{ valor: previous }] };
        const before = JSON.stringify(c.estado);
        c.renderIndicadoresPanorama(income, expense);
        assert.equal(c.$('taxa-economia').textContent, savings);
        assert.equal(c.$('variacao-despesas').textContent, change);
        assert.match(c.$('variacao-periodo').textContent, /2025/);
        assert.equal(JSON.stringify(c.estado), before);
    }
    c.valoresOcultos = true;
    c.renderIndicadoresPanorama(10000, 5000);
    assert.equal(c.$('taxa-economia').textContent, '••••');
    assert.equal(c.$('variacao-despesas').textContent, '••••');
});

test('six months include empty months and expose selected values by click and keyboard button semantics', () => {
    const c = setup();
    c.estado.meses['2025-08'] = { receitas: [{ valor: 20 }], despesas: [{ valor: 10 }] };
    c.renderGraficoMensal();
    const groups = c.$('grafico-mensal').children;
    assert.equal(groups.length, 6);
    assert.match(c.$('periodo-grafico').textContent, /2025.*2026/);
    assert.equal(groups[0].tag, 'button');
    groups[0].events.click();
    assert.match(c.$('detalhe-grafico-mensal').textContent, /Entradas 20; Despesas 10/);
    groups[5].events.click();
    assert.equal(groups[0].attrs['aria-pressed'], 'false');
    assert.match(c.$('detalhe-grafico-mensal').textContent, /Entradas 0; Despesas 0/);
    c.valoresOcultos = true;
    c.renderGraficoMensal();
    c.$('grafico-mensal').children[0].events.click();
    assert.match(c.$('detalhe-grafico-mensal').textContent, /••••/);
    assert.doesNotMatch(c.$('detalhe-grafico-mensal').textContent, /Entradas 20|Despesas 10/);
});

test('category bars use descending totals and show amount and percentage; empty state works', () => {
    const c = setup();
    c.estado.meses['2026-01'] = { despesas: [
        { categoria: 'A', valor: 10 }, { categoria: 'B', valor: 30 }
    ] };
    c.renderGraficoCategorias();
    const rows = c.$('legenda-grafico-categorias').children;
    assert.equal(rows[0].children[0].children[1].text, 'B');
    assert.equal(rows[0].children[1].text, '30');
    assert.equal(rows[0].children[2].text, '75%');
    assert.equal(rows[0].children[3].children[0].style.width, '75%');
    c.estado.meses = {};
    c.renderGraficoCategorias();
    assert.equal(c.$('vazio-grafico-categorias').hidden, false);
    assert.equal(c.$('legenda-grafico-categorias').children.length, 0);
});

test('new Panorama text is translated in all six languages', () => {
    const phrases = ['Saldo do mês', 'Pendente no mês', 'Taxa de economia', 'Variação das despesas',
        'Comparação com', 'Não calculável: sem entradas', 'Não calculável: mês anterior sem despesas',
        'Entradas e despesas nos últimos seis meses:'];
    for (const language of IDIOMAS.filter(value => value !== 'pt-BR')) {
        for (const phrase of phrases) assert.notEqual(textoTraduzido(phrase, language), phrase);
    }
});

test('commitment bar preserves paid and pending proportions when expenses exceed income', () => {
    const start = source.indexOf('    // Barra de comprometimento');
    const end = source.indexOf('    // Linhas de total', start);
    for (const [income, expense, paid, expectedPaid, expectedPending] of [
        [100, 50, 20, '20%', '30%'], [100, 200, 50, '25%', '75%'],
        [0, 100, 40, '40%', '60%'], [0, 0, 0, '0%', '0%']
    ]) {
        const element = () => ({ style: {}, classList: { toggle() {} }, setAttribute() {} });
        const ui = { barra: element(), barraPago: element(), barraPendente: element(), textoComprometido: element() };
        vm.runInNewContext(source.slice(start, end), {
            receita: income, despesa: expense, pago: paid, pendente: expense - paid, ui,
            formatarPercentual: String, formatarMoeda: String, textoTraduzido: String
        });
        assert.equal(ui.barraPago.style.width, expectedPaid);
        assert.equal(ui.barraPendente.style.width, expectedPending);
    }
});
