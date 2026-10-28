import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const themes = ['claro', 'escuro', 'rosa', 'pangolim'];
const palettes = {};
for (const [, , id = 'claro', block] of css.matchAll(/:root(\[data-tema="([^"]+)"\])? \{([^}]+)\}/g)) {
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value]));
    palettes[id] = { ...palettes[id], ...tokens };
}
function contrast(a, b) {
    const luminance = hex => hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255)
        .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

test('light and Pangolim use the requested identity colors and keep semantic colors', () => {
    const identities = {
        claro: { fundo: '#f5f6f2', superficie: '#ffffff', 'superficie-suave': '#dce9df',
            primaria: '#287c5a', texto: '#263b32' },
        pangolim: { fundo: '#f1e4ca', superficie: '#fff8eb', primaria: '#4d301d', texto: '#4d301d',
            acento: '#b87b25', 'primaria-suave': '#d4a24c', borda: '#d9bd8e', 'texto-secundario': '#765b3e' }
    };
    const semantics = {
        claro: { verde: '#087354', 'verde-suave': '#e7f3ed', ambar: '#8c5a0b', 'ambar-suave': '#fff3d8',
            vermelho: '#b73449', 'vermelho-suave': '#fceef1' },
        pangolim: { verde: '#795314', 'verde-suave': '#efe4c9', ambar: '#815318', 'ambar-suave': '#f8edc9',
            vermelho: '#ad3f31', 'vermelho-suave': '#fbeae2' }
    };
    for (const theme of ['claro', 'pangolim']) {
        for (const [token, expected] of Object.entries({ ...identities[theme], ...semantics[theme] })) {
            assert.equal(palettes[theme][token], expected, `${theme}: ${token}`);
        }
        for (const surface of ['superficie', 'superficie-suave']) {
            for (const foreground of ['verde', 'ambar', 'vermelho']) {
                assert.ok(contrast(palettes[theme][foreground], palettes[theme][surface]) >= 4.5,
                    `${theme}: ${foreground} / ${surface}`);
            }
        }
    }
});

test('all four palettes meet text and graphical contrast targets on their surfaces', () => {
    assert.deepEqual(Object.keys(palettes), themes);
    for (const [theme, p] of Object.entries(palettes)) {
        const pairs = ['fundo', 'superficie', 'superficie-suave'].flatMap(bg => [['texto', bg], ['texto-secundario', bg]]);
        pairs.push(['texto-na-primaria', 'primaria'], ['texto-na-primaria', 'primaria-hover']);
        for (const color of ['primaria', 'verde', 'vermelho', 'ambar']) pairs.push([color, color + '-suave']);
        for (const [foreground, background] of pairs) {
            assert.ok(contrast(p[foreground], p[background]) >= 4.5, `${theme}: ${foreground} / ${background}`);
        }
        const categories = Array.from({ length: 12 }, (_, i) => p['categoria-' + (i + 1)]);
        assert.equal(new Set(categories).size, 12, `${theme}: distinct category colors`);
        for (const category of categories) assert.ok(contrast(category, p.borda) >= 3, `${theme}: bar ${category}`);
        assert.ok(contrast(p['borda-controle'], p['superficie-suave']) >= 3, `${theme}: input boundary`);
    }
});

function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('theme presentation preserves legacy state, caches the visual alias and tolerates unavailable storage', () => {
    for (const [saved, visual, name] of [['claro', 'claro', 'Clean'], ['escuro', 'escuro', 'Midnight'],
        ['rosa', 'rosa', 'Peônia'], ['pangolim', 'pangolim', 'Pangolim'], ['floresta', 'claro', 'Clean'], [null, 'claro', 'Clean']]) {
        const root = { dataset: {}, classList: { contains: () => false } };
        const button = { replaceChildren(...children) { this.children = children; }, setAttribute() {} };
        const state = { tema: saved, meses: { '2026-10': { despesas: [{ valor: 42 }] } } };
        const before = JSON.stringify(state);
        const cache = new Map();
        const c = vm.createContext({ estado: state, document: { documentElement: root, querySelector: () => ({}) },
            TEMAS_OFICIAIS: themes, TEMAS_VALIDOS: [...themes, 'floresta'], CHAVE_TEMA_INICIAL: 'theme',
            getComputedStyle: () => ({ getPropertyValue: () => palettes[visual].fundo }),
            localStorage: { setItem: (key, value) => cache.set(key, value) }, ui: { tema: button },
            criarEl: (tag, props) => ({ tag, ...props }), textoTraduzido: value => value });
        vm.runInContext(extract('renderTema'), c);
        c.renderTema();
        assert.equal(root.dataset.tema, visual);
        assert.equal(button.children[1].text, name);
        assert.equal(cache.get('theme'), visual);
        assert.equal(JSON.stringify(state), before);
        c.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
        assert.doesNotThrow(() => c.renderTema());
    }
});

test('category colors respond to CSS themes without changing category identity or data', () => {
    const state = { categorias: ['Casa', 'Lazer', 'Outros'] };
    const c = vm.createContext({ estado: state });
    vm.runInContext(extract('corDaCategoria'), c);
    assert.equal(c.corDaCategoria('Casa'), 'var(--categoria-1)');
    assert.equal(c.corDaCategoria('Lazer'), 'var(--categoria-2)');
    assert.equal(c.corDaCategoria('Outros'), 'var(--categoria-3)');
    assert.deepEqual(state.categorias, ['Casa', 'Lazer', 'Outros']);
});
