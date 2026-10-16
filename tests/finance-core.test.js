import test from "node:test";
import assert from "node:assert/strict";
import { calcularExpressao, calcularOrcamentosPorCategoria, escaparCelulaCsv, gerarCsv, migrarDadosLegados, normalizarEstado, ordenarOrcamentosComGastos, removerCategoriaOrcamentos, renomearCategoriaOrcamentos, somarCentavos, validarBackup } from "../finance-core.js";

test("backup válido é aceito e meses fora do calendário são recusados", () => {
    const backup = { categorias: ["Moradia"], meses: { "2026-10": { receitas: [{ id: "r1", nome: "Salário", valor: 1200 }], despesas: [] } } };
    assert.equal(validarBackup(backup), true);
    assert.equal(validarBackup({ ...backup, meses: { "2026-13": { receitas: [], despesas: [] } } }), false);
    assert.equal(validarBackup({ ...backup, meses: { "2101-01": { receitas: [], despesas: [] } } }), false);
});

test("modelo v3 adiciona orçamentos e migra estados e backups v2 sem orçamento", () => {
    const antigo = { versao: 2, categorias: ["Casa"], meses: { "2026-10": { receitas: [], despesas: [] } } };
    assert.equal(validarBackup(antigo), true);
    const migrado = normalizarEstado(antigo);
    assert.equal(migrado.versao, 3);
    assert.deepEqual(migrado.orcamentos, { padrao: {}, meses: {} });

    const novo = normalizarEstado({
        versao: 3,
        categorias: ["Casa"],
        meses: antigo.meses,
        orcamentos: { padrao: { Casa: 500 }, meses: { "2026-10": { Casa: 420 } } }
    });
    assert.equal(validarBackup(novo), true);
    assert.deepEqual(normalizarEstado(novo).orcamentos, { padrao: { Casa: 500 }, meses: {} });
});

test("valida limites de orçamento não negativos e períodos de personalização", () => {
    const backup = { versao: 3, meses: {}, orcamentos: { padrao: { Casa: 250 }, meses: { "2026-02": { Casa: 200 } } } };
    assert.equal(validarBackup(backup), true);
    assert.equal(validarBackup({ ...backup, orcamentos: { padrao: { Casa: -1 } } }), false);
    assert.equal(validarBackup({ ...backup, orcamentos: { padrao: { Casa: Number.MAX_VALUE } } }), false);
    assert.equal(validarBackup({ ...backup, orcamentos: { padrao: {}, meses: { "2026-13": { Casa: 10 } } } }), false);
});

test("orçamento calcula gastos por categoria a partir das despesas do mês selecionado", () => {
    const categorias = ["Alimentação", "Moradia"];
    const orcamentos = { padrao: { Alimentação: 600 }, meses: {} };
    const outubro = calcularOrcamentosPorCategoria(categorias, [
        { categoria: "Alimentação", valor: 100 },
        { categoria: "Alimentação", valor: 320 },
        { categoria: "Moradia", valor: 800 }
    ], orcamentos);
    const novembro = calcularOrcamentosPorCategoria(categorias, [
        { categoria: "Alimentação", valor: 50 }
    ], orcamentos);

    assert.equal(outubro.find((item) => item.categoria === "Alimentação").gastoCentavos, 42000);
    assert.equal(outubro.find((item) => item.categoria === "Moradia").gastoCentavos, 80000);
    assert.equal(novembro.find((item) => item.categoria === "Alimentação").gastoCentavos, 5000);
});

test("resumo mostra somente categorias com despesas e ordena pelo maior gasto", () => {
    const calculados = calcularOrcamentosPorCategoria(["Sem despesas", "Zero", "Mercado", "Casa", "Lazer"], [
        { categoria: "Mercado", valor: 75 },
        { categoria: "Casa", valor: 220 },
        { categoria: "Lazer", valor: 75 },
        { categoria: "Zero", valor: 0 }
    ], { padrao: { "Sem despesas": 500, "Zero": 100 }, meses: {} });

    const resumo = ordenarOrcamentosComGastos(calculados);
    assert.deepEqual(resumo.map((item) => item.categoria), ["Casa", "Lazer", "Mercado"]);
    assert.deepEqual(resumo.map((item) => item.gastoCentavos), [22000, 7500, 7500]);
});

test("orçamento calcula saldo e percentual abaixo, no limite e acima do limite", () => {
    const calcular = (gasto) => calcularOrcamentosPorCategoria(["Casa"], [
        { categoria: "Casa", valor: gasto }
    ], { padrao: { Casa: 100 }, meses: {} })[0];
    const abaixo = calcular(75);
    const exato = calcular(100);
    const acima = calcular(125);

    assert.equal(abaixo.restanteCentavos, 2500);
    assert.equal(abaixo.percentualConsumido, 75);
    assert.equal(exato.restanteCentavos, 0);
    assert.equal(exato.percentualConsumido, 100);
    assert.equal(acima.restanteCentavos, -2500);
    assert.equal(acima.percentualConsumido, 125);
});

test("limite zero é definido e categoria sem orçamento não assume limite zero", () => {
    const resultados = calcularOrcamentosPorCategoria(["Sem limite", "Zero"], [
        { categoria: "Zero", valor: 5 }
    ], { padrao: { Zero: 0 }, meses: {} });
    const semLimite = resultados.find((item) => item.categoria === "Sem limite");
    const zero = resultados.find((item) => item.categoria === "Zero");
    assert.equal(semLimite.limiteCentavos, null);
    assert.equal(semLimite.restanteCentavos, null);
    assert.equal(semLimite.percentualConsumido, null);
    assert.equal(zero.limiteCentavos, 0);
    assert.equal(zero.percentualConsumido, null);
    assert.equal(zero.restanteCentavos, -500);
});

test("personalizações mensais antigas são removidas e o limite padrão passa a valer em todos os meses", () => {
    const orcamentos = { padrao: { Casa: 500 }, meses: { "2026-10": { Casa: 420 } } };
    const despesas = [{ categoria: "Casa", valor: 100 }];
    const normalizados = normalizarEstado({
        categorias: ["Casa"], meses: {},
        orcamentos
    }).orcamentos;
    const outubro = calcularOrcamentosPorCategoria(["Casa"], despesas, normalizados)[0];
    const novembro = calcularOrcamentosPorCategoria(["Casa"], despesas, normalizados)[0];

    assert.deepEqual(normalizados, { padrao: { Casa: 500 }, meses: {} });
    assert.equal(outubro.limiteCentavos, 50000);
    assert.equal(novembro.limiteCentavos, 50000);
});

test("orçamentos acompanham inclusão, edição, exclusão e categorias novas", () => {
    const despesas = [{ id: "d1", categoria: "Casa", valor: 20 }];
    const categorias = ["Casa"];
    const orcamentos = { padrao: { Casa: 100 }, meses: {} };
    const calcular = () => calcularOrcamentosPorCategoria(categorias, despesas, orcamentos);
    assert.equal(calcular().find((item) => item.categoria === "Casa").gastoCentavos, 2000);
    despesas[0].valor = 35;
    assert.equal(calcular().find((item) => item.categoria === "Casa").gastoCentavos, 3500);
    categorias.push("Nova");
    orcamentos.padrao.Nova = 50;
    despesas.push({ id: "d2", categoria: "Nova", valor: 10 });
    assert.equal(calcular().find((item) => item.categoria === "Nova").gastoCentavos, 1000);
    despesas.splice(0, 1);
    assert.equal(calcular().find((item) => item.categoria === "Casa").gastoCentavos, 0);

    const renomeados = renomearCategoriaOrcamentos(orcamentos, "Casa", "Habitação");
    assert.equal(renomeados.padrao.Habitação, 100);
    assert.deepEqual(renomeados.meses, {});
    assert.equal(orcamentos.padrao.Casa, 100);

    const removidos = removerCategoriaOrcamentos(renomeados, "Habitação");
    assert.equal(Object.hasOwn(removidos.padrao, "Habitação"), false);
    assert.deepEqual(removidos.meses, {});
});

test("nomes especiais de categoria continuam sendo propriedades de orçamento próprias", () => {
    const bruto = {
        categorias: ["__proto__"], meses: {},
        orcamentos: { padrao: Object.fromEntries([["__proto__", 15]]) }
    };
    const estado = normalizarEstado(bruto);
    assert.equal(Object.hasOwn(estado.orcamentos.padrao, "__proto__"), true);
    assert.equal(estado.orcamentos.padrao["__proto__"], 15);
    const renomeado = renomearCategoriaOrcamentos(estado.orcamentos, "__proto__", "Especial");
    assert.equal(renomeado.padrao.Especial, 15);
    assert.equal(Object.hasOwn(renomeado.padrao, "__proto__"), false);
});

test("persistência remove personalizações mensais antigas e restaura os limites padrão", async () => {
    const { criarArmazenamento } = await import("../storage.js");
    const dados = new Map();
    const local = {
        getItem: (chave) => dados.get(chave) ?? null,
        setItem: (chave, valor) => dados.set(chave, String(valor)),
        removeItem: (chave) => dados.delete(chave)
    };
    const estado = normalizarEstado({
        categorias: ["Casa"], meses: {},
        orcamentos: { padrao: { Casa: 500 }, meses: { "2026-10": { Casa: 450 } } }
    });
    assert.equal(criarArmazenamento(local).escreverJson("controleFinanceiro:v3", estado), true);
    const reiniciado = normalizarEstado(criarArmazenamento(local).lerJson("controleFinanceiro:v3"));
    assert.deepEqual(reiniciado.orcamentos, { padrao: { Casa: 500 }, meses: {} });
});

test("backup recusa valores e identificadores inválidos", () => {
    const item = { id: "duplicado", nome: "Conta", valor: 12.5 };
    assert.equal(validarBackup({ meses: { "2026-01": { receitas: [item], despesas: [{ ...item }] } } }), false);
    assert.equal(validarBackup({ meses: { "2026-01": { receitas: [{ nome: "Conta", valor: Infinity }], despesas: [] } } }), false);
    assert.equal(validarBackup({ meses: { "2026-01": { receitas: [], despesas: [{ nome: "Conta", valor: 3, parcela: { atual: 3, total: 2 } }] } } }), false);
});

test("temas pangolim e floresta são preservados no estado e em backups", () => {
    for (const tema of ["pangolim", "floresta"]) {
        const backup = { tema, meses: {} };
        assert.equal(validarBackup(backup), true);
        assert.equal(normalizarEstado(backup).tema, tema);
    }
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

test("CSV exporta o mês escolhido ou todos os meses com período, UTF-8 e proteção de fórmula", () => {
    const estado = { meses: {
        "2026-01": { receitas: [{ nome: "Salário; bônus", valor: 1000.5 }], despesas: [] },
        "2026-02": { receitas: [], despesas: [{ nome: '=HYPERLINK("x")\nconta', categoria: "Casa", valor: 12.34, pago: true }] }
    } };
    const fevereiro = gerarCsv(estado, { ano: 2026, mes: 2 });
    assert.ok(fevereiro.startsWith("\ufeff\"Período\";"));
    assert.ok(fevereiro.includes('"2026-02";"Despesa";"\'=HYPERLINK(""x"")\nconta"'));
    assert.ok(fevereiro.includes('"12,34"'));
    assert.ok(!fevereiro.includes("Salário"));
    const todos = gerarCsv(estado, { ano: 2026, mes: 2, escopo: "todos" });
    assert.ok(todos.includes('"2026-01";"Entrada";"Salário; bônus"'));
    assert.ok(todos.includes('"2026-02";"Despesa"'));
    assert.equal(gerarCsv({ meses: {} }, { ano: 2026, mes: 2 }), "");
});

test("calculadora respeita precedência, parênteses e decimal brasileiro", () => {
    assert.equal(calcularExpressao("(1,5 + 2,5) * 3"), 12);
    assert.equal(calcularExpressao("-4 + 10 / 2"), 1);
    assert.equal(calcularExpressao("(200 + 50) * 10%"), 25);
    assert.equal(calcularExpressao("50% + 0,25"), 0.75);
});

test("calculadora rejeita código, sintaxe incompleta e divisão por zero", () => {
    for (const expressao of ["1+alert(1)", "2+", "1/0", "(2+3"]) {
        assert.throws(() => calcularExpressao(expressao));
    }
});
