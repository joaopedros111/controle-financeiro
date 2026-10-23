import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { IDIOMAS, LOCALES, textoTraduzido } from "../localization.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test("changing interface language redraws without persisting financial state", () => {
    for (const language of IDIOMAS) {
        let handler, saves = 0;
        const renders = [];
        const context = vm.createContext({
            ui: { idiomaInterface: { value: language, addEventListener: (_event, fn) => { handler = fn; } } },
            preferenciasMenu: { idioma: "pt-BR" }, idiomaAtual: "pt-BR",
            aplicarIdioma: () => {}, aplicarPreferenciasMenu: () => {},
            renderTudo: persist => renders.push(persist), salvarPreferenciasMenu: () => { saves += 1; }
        });
        vm.runInContext(part('ui.idiomaInterface.addEventListener("change",', 'ui.moedaInterface.addEventListener("change",'), context);
        handler();
        assert.equal(context.idiomaAtual, language);
        assert.equal(context.preferenciasMenu.idioma, language);
        assert.deepEqual(renders, [false]);
        assert.equal(saves, 1);
    }
});

test("sync statuses retain their source text so subsequent language switches can translate again", () => {
    const status = { textContent: "", dataset: {} }, retry = {};
    const context = vm.createContext({ syncUi: { status, retry }, renderSyncConflicts: async () => {} });
    vm.runInContext(part("function setSyncStatus(", "function formatLastSync("), context);
    context.setSyncStatus("Sincronizado");
    assert.equal(status.textContent, "Sincronizado");
    for (const language of IDIOMAS) assert.ok(textoTraduzido(status.textContent, language));
    context.setSyncStatus("Falha no envio. Tente novamente.", true);
    assert.equal(status.dataset.state, "error");
    assert.equal(retry.hidden, false);
});

test("last sync retains the original timestamp for immediate locale changes", () => {
    const last = { dataset: {} }, context = vm.createContext({ syncUi: { last }, LOCALES });
    vm.runInContext(part("function formatLastSync(", "function resetFinancialInteractions("), context);
    const timestamp = "2026-10-23T12:34:56.000Z";
    assert.match(context.formatLastSync(timestamp), /^Última sincronização confirmada:/);
    assert.equal(last.dataset.i18nDate, timestamp);
});

test("native category prompt localizes its sentence without changing the custom name or financial state", () => {
    const name = "Entradas Despesas Moto Serasa";
    for (const language of IDIOMAS) {
        let message, initial;
        const context = vm.createContext({
            textoTraduzido: text => textoTraduzido(text, language),
            prompt: (text, value) => { message = text; initial = value; return null; }
        });
        vm.runInContext(part("function renomearCategoria(", "function removerCategoria("), context);
        context.renomearCategoria(name);
        assert.equal(initial, name);
        assert.ok(message.includes(name));
        if (language !== "pt-BR") assert.ok(!message.startsWith("Novo nome para a categoria"));
    }
});
