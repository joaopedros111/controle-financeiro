import test from "node:test";
import assert from "node:assert/strict";
import { normalizarPreferenciasMenu } from "../preferences.js";

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
