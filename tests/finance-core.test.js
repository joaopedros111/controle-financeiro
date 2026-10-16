import test from "node:test";
import assert from "node:assert/strict";
import { calcularExpressao, escaparCelulaCsv, migrarDadosLegados, normalizarEstado, somarCentavos, validarBackup } from "../finance-core.js";

test("backup válido é aceito e meses fora do calendário são recusados", () => {
    const backup = { categorias: ["Moradia"], meses: { "2026-10": { receitas: [{ id: "r1", nome: "Salário", valor: 1200 }], despesas: [] } } };
    assert.equal(validarBackup(backup), true);
    assert.equal(validarBackup({ ...backup, meses: { "2026-13": { receitas: [], despesas: [] } } }), false);
    assert.equal(validarBackup({ ...backup, meses: { "2101-01": { receitas: [], despesas: [] } } }), false);
});

test("backup recusa valores e identificadores inválidos", () => {
    const item = { id: "duplicado", nome: "Conta", valor: 12.5 };
    assert.equal(validarBackup({ meses: { "2026-01": { receitas: [item], despesas: [{ ...item }] } } }), false);
    assert.equal(validarBackup({ meses: { "2026-01": { receitas: [{ nome: "Conta", valor: Infinity }], despesas: [] } } }), false);
    assert.equal(validarBackup({ meses: { "2026-01": { receitas: [], despesas: [{ nome: "Conta", valor: 3, parcela: { atual: 3, total: 2 } }] } } }), false);
});

test("normalização descarta meses e registros inválidos e garante IDs distintos", () => {
    const estado = normalizarEstado({ meses: {
        "2026-13": { receitas: [{ nome: "Inválida", valor: 1 }] },
        "2026-01": { receitas: [
            { id: "mesmo", nome: "A", valor: 0.105 },
            { id: "mesmo", nome: "B", valor: 1 },
            { nome: "Inválida", valor: "não é número" }
        ] }
    } }, (() => { let n = 0; return () => `novo-${++n}`; })());
    assert.deepEqual(Object.keys(estado.meses), ["2026-01"]);
    assert.equal(estado.meses["2026-01"].receitas.length, 2);
    assert.equal(estado.meses["2026-01"].receitas[0].valor, 0.11);
    assert.notEqual(estado.meses["2026-01"].receitas[0].id, estado.meses["2026-01"].receitas[1].id);
});

test("migração legado associa cada mês ao ano informado e preserva categorias e lançamentos", () => {
    const migrado = migrarDadosLegados({
        1: { renda: 2500, categorias: ["Casa"], despesas: [{ nome: "Aluguel", valor: 1200 }] },
        12: { renda: 0, categorias: ["Casa", "Lazer"], despesas: [] }
    }, 2026);
    assert.deepEqual(Object.keys(migrado.meses), ["2026-01", "2026-12"]);
    assert.deepEqual(migrado.categorias, ["Casa", "Lazer"]);
    assert.equal(migrado.meses["2026-01"].receitas[0].valor, 2500);
    assert.equal(migrado.meses["2026-01"].despesas[0].nome, "Aluguel");
    assert.equal(migrarDadosLegados({}, 2026), null);
});

test("somas monetárias são acumuladas em centavos inteiros", () => {
    assert.equal(somarCentavos([0.1, 0.2, 1.99]), 229);
});

test("CSV protege fórmulas e escapa aspas", () => {
    assert.equal(escaparCelulaCsv("  =1+1"), '"\'  =1+1"');
    assert.equal(escaparCelulaCsv('Conta "A"'), '"Conta ""A"""');
});

test("calculadora respeita precedência, parênteses e decimal brasileiro", () => {
    assert.equal(calcularExpressao("(1,5 + 2,5) * 3"), 12);
    assert.equal(calcularExpressao("-4 + 10 / 2"), 1);
});

test("calculadora rejeita código, sintaxe incompleta e divisão por zero", () => {
    for (const expressao of ["1+alert(1)", "2+", "1/0", "(2+3"]) {
        assert.throws(() => calcularExpressao(expressao));
    }
});
