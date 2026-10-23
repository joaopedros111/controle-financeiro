import test from "node:test";
import {readFile} from "node:fs/promises";
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

test("controles de sincronização têm rótulos traduzidos em todos os idiomas disponíveis", () => {
    for (const locale of IDIOMAS.filter((language) => language !== "pt-BR")) {
        assert.notEqual(textoTraduzido("Sincronização entre dispositivos", locale), "Sincronização entre dispositivos");
        assert.notEqual(textoTraduzido("Entrar com Google", locale), "Entrar com Google");
        assert.notEqual(textoTraduzido("Conflitos de sincronização", locale), "Conflitos de sincronização");
    }
    assert.equal(textoTraduzido("Sincronizado", "pt-BR"), "Sincronizado");
});

test("traduções localizam frases da interface e preservam o português como padrão", () => {
    assert.equal(textoTraduzido("Idioma e moeda", "en"), "Language and currency");
    assert.equal(textoTraduzido("Janeiro", "es"), "Enero");
    assert.equal(textoTraduzido("Ocultar valores financeiros", "ja"), "金額を非表示");
    assert.equal(textoTraduzido("Idioma e moeda", "pt-BR"), "Idioma e moeda");
    assert.equal(textoTraduzido("Máxima compactação", "en"), "Maximum compactness");
    assert.equal(textoTraduzido("Muito confortável", "ja"), "とてもゆったり");
    assert.equal(textoTraduzido("Exibir gráficos na tela inicial", "en"), "Show charts on the home screen");
    assert.equal(textoTraduzido("Exibir resumo do mês na tela de início", "ja"), "ホーム画面に月次概要を表示");
    assert.equal(textoTraduzido("Selecionar data no calendário", "en"), "Select a date from the calendar");
    assert.equal(textoTraduzido("Toque em Adicionar para começar", "en"), "Tap Add to get started");
    assert.equal(textoTraduzido("Rótulo personalizado", "fr"), "Rótulo personalizado");
    assert.equal(textoTraduzido("Exibir Entradas na tela inicial", "en"), "Show Income on the home screen");
    assert.equal(textoTraduzido("Gerenciar categorias", "en"), "Manage categories");
    assert.equal(textoTraduzido("Categorias e orçamentos", "es"), "Categorías y presupuestos");
    assert.equal(textoTraduzido("Limite: R$ 600,00", "en"), "Limit: R$ 600,00");
    assert.equal(textoTraduzido("Baixar cópia preservada", "en"), "Download preserved copy");
    assert.equal(textoTraduzido("Total da categoria: R$ 950,00", "en"), "Category total: R$ 950,00");
    assert.equal(
        textoTraduzido("Dados financeiros existentes não puderam ser validados. A gravação automática foi bloqueada; restaure um backup válido em Opções.", "en"),
        "Existing financial data could not be validated. Automatic saving is blocked; restore a valid backup in Options."
    );
    assert.equal(textoTraduzido("Selva", "pt-BR"), "Selva");
    assert.equal(textoTraduzido("Aparência e visualização", "en"), "Appearance and display");
});

test("status dinâmico do Service Worker e do armazenamento acompanha o idioma da interface", () => {
    // The UI renders these independently so dynamic values are never translated as substrings.
    const diagnostico = idioma => textoTraduzido("Service Worker ativo (activated); controlando esta página.", idioma)
        + " " + textoTraduzido("Armazenamento: persistente disponível.", idioma);
    assert.equal(
        diagnostico("en"),
        "Service Worker active (activated); controlling this page. Storage: persistent storage available."
    );
    assert.equal(
        diagnostico("ja"),
        "Service Worker有効（activated）。このページを制御中。 ストレージ: 永続ストレージを利用できます。"
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
    assert.equal(depois.densidade, 25);
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

test("recurring income controls are localized in supported interface languages", () => {
    assert.equal(textoTraduzido("Repetir mensalmente por 12 meses", "en"), "Repeat monthly for 12 months");
    assert.equal(textoTraduzido("Cancelar próximas ocorrências", "fr"), "Annuler les prochaines occurrences");
});

test('catalog has complete unambiguous translations and matching parameters for all six languages',async()=>{
 const source=await readFile(new URL('../localization.js',import.meta.url),'utf8');
 const start=source.indexOf('const FRASES =')+14,end=source.indexOf('\n];',start)+2;
 const rows=Function('return '+source.slice(start,end))(),keys=new Set();
 for(const row of rows){
  assert.equal(row.length,IDIOMAS.length,row[0]);assert.equal(keys.has(row[0]),false,'Duplicate source: '+row[0]);keys.add(row[0]);
  const parameters=[...row[0].matchAll(/[{][0-9]+[}]/g)].map(m=>m[0]).sort();
  for(const [index,language] of IDIOMAS.entries()){
   assert.equal(typeof row[index],'string');assert.ok(row[index].trim(),row[0]+' '+language);
   assert.deepEqual([...row[index].matchAll(/[{][0-9]+[}]/g)].map(m=>m[0]).sort(),parameters,row[0]+' '+language);
   assert.equal(textoTraduzido(row[0],language),row[index],row[0]+' '+language);
  }
 }
});
test('complete templates preserve names, amounts and replacement characters without partial substitutions',()=>{
 for(const language of IDIOMAS){
  const name='Despesas Janeiro Salvar Moto Serasa $&';
  assert.ok(textoTraduzido('Editar entrada '+name,language).includes(name));
  assert.equal(textoTraduzido('Minha categoria Despesas Janeiro',language),'Minha categoria Despesas Janeiro');
  assert.equal(textoTraduzido('X',language),'X');
  assert.equal(textoTraduzido('Transferência para Salvar Janeiro',language),'Transferência para Salvar Janeiro');
 }
});
