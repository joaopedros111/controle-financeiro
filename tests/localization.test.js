import test from "node:test";
import assert from "node:assert/strict";
import { formatarMoeda, IDIOMAS, MOEDAS, textoTraduzido } from "../localization.js";
import { normalizarPreferenciasMenu } from "../preferences.js";
import { criarArmazenamento } from "../storage.js";

test("formatador suporta os idiomas e moedas disponíveis sem conversão de valor", () => {
    assert.deepEqual(IDIOMAS, ["pt-BR", "en", "es", "fr", "de", "ja"]);
    assert.deepEqual(MOEDAS, ["BRL", "USD", "EUR", "JPY"]);
    assert.equal(formatarMoeda(1234.56, "BRL", "pt-BR"), "R$ 1.234,56");
    assert.equal(formatarMoeda(1234.56, "USD", "en"), "$1,234.56");
    assert.equal(formatarMoeda(1234.56, "EUR", "de"), "1.234,56 €");
    assert.equal(formatarMoeda(1234.56, "JPY", "ja"), "￥1,235");
    assert.equal(formatarMoeda(1234.56, "BRL", "pt-BR"), formatarMoeda(1234.56, "BRL", "pt-BR"));
});

test("traduções localizam frases da interface e preservam o português como padrão", () => {
    assert.equal(textoTraduzido("Idioma e moeda", "en"), "Language and currency");
    assert.equal(textoTraduzido("Janeiro", "es"), "Enero");
    assert.equal(textoTraduzido("Ocultar valores financeiros", "ja"), "金額を非表示");
    assert.equal(textoTraduzido("Idioma e moeda", "pt-BR"), "Idioma e moeda");
    assert.equal(textoTraduzido("Rótulo personalizado", "fr"), "Rótulo personalizado");
    assert.equal(textoTraduzido("Expandir planejamento", "en"), "Expand planning");
    assert.equal(textoTraduzido("Exibir Entradas na tela inicial", "en"), "Show Income on the home screen");
    assert.equal(textoTraduzido("Baixar cópia preservada", "en"), "Download preserved copy");
    assert.equal(
        textoTraduzido("Dados financeiros existentes não puderam ser validados. A gravação automática foi bloqueada; restaure um backup válido em Opções.", "en"),
        "Existing financial data could not be validated. Automatic saving is blocked; restore a valid backup in Options."
    );
    assert.equal(textoTraduzido("Selva", "pt-BR"), "Selva");
    assert.equal(textoTraduzido("Aparência e visualização", "en"), "Appearance and display");
});

test("status dinâmico do Service Worker e do armazenamento acompanha o idioma da interface", () => {
    const diagnostico = "Service Worker ativo (activated); controlando esta página. Armazenamento: persistente disponível.";
    assert.equal(
        textoTraduzido(diagnostico, "en"),
        "Service Worker active (activated); controlling this page. Storage: persistent storage available."
    );
    assert.equal(
        textoTraduzido(diagnostico, "ja"),
        "Service Worker有効（activated）このページを制御中。 ストレージ: 永続ストレージを利用できます。"
    );
});

test("idioma e moeda persistem sem alterar outras preferências antigas", () => {
    const dados = new Map();
    const local = {
        getItem: (chave) => dados.get(chave) ?? null,
        setItem: (chave, valor) => dados.set(chave, String(valor)),
        removeItem: (chave) => dados.delete(chave)
    };
    const storage = criarArmazenamento(local);
    const chave = "controleFinanceiro:preferencias-menu";
    const antes = normalizarPreferenciasMenu({
        idioma: "ja",
        moeda: "JPY",
        ocultarAoIniciar: true,
        densidade: "compacta",
        tema: "pangolim"
    });
    assert.equal(storage.escreverJson(chave, antes), true);
    const depois = normalizarPreferenciasMenu(storage.lerJson(chave));
    assert.equal(depois.idioma, "ja");
    assert.equal(depois.moeda, "JPY");
    assert.equal(depois.ocultarAoIniciar, true);
    assert.equal(depois.densidade, "compacta");
    assert.equal(depois.tema, "pangolim");
});

test("preferências antigas e valores não suportados usam idioma e moeda padrão", () => {
    assert.equal(normalizarPreferenciasMenu({}).idioma, "pt-BR");
    assert.equal(normalizarPreferenciasMenu({}).moeda, "BRL");
    const antigas = normalizarPreferenciasMenu({ idioma: "xx", moeda: "XYZ", mostrarGraficos: false });
    assert.equal(antigas.idioma, "pt-BR");
    assert.equal(antigas.moeda, "BRL");
    assert.equal(antigas.mostrarGraficos, false);
});
