import test from "node:test";
import assert from "node:assert/strict";
import { apresentarValorFinanceiro, normalizarPreferenciasMenu } from "../preferences.js";
import { criarArmazenamento } from "../storage.js";

test("preferências antigas ou inválidas mantêm defaults sem quebrar opções existentes", () => {
    assert.deepEqual(normalizarPreferenciasMenu(null), normalizarPreferenciasMenu({}));
    const preferencia = normalizarPreferenciasMenu({
        posicao: "fora", transparencia: 999, x: "invalido", densidade: "enorme",
        telaInicial: "desconhecida", referenciaMes: "ultimo", ultimoPeriodo: "2026-13",
        escopoCsv: "invalido", mostrarGraficos: false, ocultarAoIniciar: true
    });
    assert.equal(preferencia.posicao, "centro");
    assert.equal(preferencia.transparencia, 80);
    assert.equal(preferencia.x, null);
    assert.equal(preferencia.densidade, "padrao");
    assert.equal(preferencia.telaInicial, "resumo");
    assert.equal(preferencia.ultimoPeriodo, null);
    assert.equal(preferencia.escopoCsv, "mes");
    assert.equal(preferencia.mostrarGraficos, false);
    assert.equal(preferencia.ocultarAoIniciar, true);
});

test("preferência válida de posição, transparência, tela e período é preservada", () => {
    const preferencia = normalizarPreferenciasMenu({
        posicao: "arrastavel", transparencia: 34, x: 50, y: 90,
        densidade: "compacta", telaInicial: "lancamentos", referenciaMes: "ultimo",
        ultimoPeriodo: "2026-09", escopoCsv: "todos"
    });
    assert.equal(preferencia.posicao, "arrastavel");
    assert.equal(preferencia.transparencia, 34);
    assert.equal(preferencia.x, 50);
    assert.equal(preferencia.densidade, "compacta");
    assert.equal(preferencia.telaInicial, "lancamentos");
    assert.equal(preferencia.ultimoPeriodo, "2026-09");
    assert.equal(preferencia.escopoCsv, "todos");
});

test("ocultar e revelar usa a mesma formatação sem expor o valor oculto", () => {
    const valor = 1234.56;
    const formatar = (numero) => `R$ ${numero.toFixed(2)}`;
    assert.equal(apresentarValorFinanceiro(valor, true, formatar), "••••");
    assert.equal(apresentarValorFinanceiro(valor, false, formatar), "R$ 1234.56");
    assert.equal(apresentarValorFinanceiro(valor, true, () => assert.fail("não deve formatar valor oculto")), "••••");
});

test("preferência de início oculto persiste após recarregar e preserva as demais opções", () => {
    const dados = new Map();
    const local = {
        getItem: (chave) => dados.get(chave) ?? null,
        setItem: (chave, valor) => dados.set(chave, String(valor)),
        removeItem: (chave) => dados.delete(chave)
    };
    const chave = "controleFinanceiro:preferencias-menu";
    const antes = normalizarPreferenciasMenu({
        ocultarAoIniciar: true,
        densidade: "compacta",
        mostrarGraficos: false,
        referenciaMes: "ultimo",
        ultimoPeriodo: "2026-09"
    });
    assert.equal(criarArmazenamento(local).escreverJson(chave, antes), true);

    const recarregado = normalizarPreferenciasMenu(criarArmazenamento(local).lerJson(chave));
    assert.equal(recarregado.ocultarAoIniciar, true);
    assert.equal(recarregado.densidade, "compacta");
    assert.equal(recarregado.mostrarGraficos, false);
    assert.equal(recarregado.referenciaMes, "ultimo");
    assert.equal(recarregado.ultimoPeriodo, "2026-09");
});

test("inicialização oculta só quando a preferência está ativada", () => {
    assert.equal(normalizarPreferenciasMenu({ ocultarAoIniciar: true }).ocultarAoIniciar, true);
    assert.equal(normalizarPreferenciasMenu({ ocultarAoIniciar: false }).ocultarAoIniciar, false);
    assert.equal(normalizarPreferenciasMenu({}).ocultarAoIniciar, false);
});

test("alternar a apresentação não altera dados financeiros", () => {
    const estado = {
        meses: {
            "2026-10": {
                receitas: [{ id: "r1", nome: "Salário", valor: 5000 }],
                despesas: [{ id: "d1", nome: "Aluguel", valor: 1200, pago: false }]
            }
        },
        categorias: ["Moradia"]
    };
    const antes = JSON.stringify(estado);

    assert.equal(apresentarValorFinanceiro(estado.meses["2026-10"].receitas[0].valor, true, String), "••••");
    assert.equal(apresentarValorFinanceiro(estado.meses["2026-10"].despesas[0].valor, false, String), "1200");
    assert.equal(JSON.stringify(estado), antes);
});

test("preferências antigas ou incompletas mantêm valores visíveis por padrão", () => {
    const antigas = normalizarPreferenciasMenu({ densidade: "confortavel" });
    assert.equal(antigas.ocultarAoIniciar, false);
    assert.equal(antigas.densidade, "confortavel");
    assert.equal(antigas.transparencia, 45);
});
