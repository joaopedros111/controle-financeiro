import test from "node:test";
import assert from "node:assert/strict";
import { apresentarValorFinanceiro, normalizarPreferenciasMenu, resolverTelaInicial } from "../preferences.js";
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

    test("tamanho do botão usa default e limites seguros", () => {
        assert.equal(normalizarPreferenciasMenu({}).tamanhoBotao, 58);
        assert.equal(normalizarPreferenciasMenu({ tamanhoBotao: 20 }).tamanhoBotao, 44);
        assert.equal(normalizarPreferenciasMenu({ tamanhoBotao: 100 }).tamanhoBotao, 76);
        assert.equal(normalizarPreferenciasMenu({ tamanhoBotao: "invalido" }).tamanhoBotao, 58);
        assert.equal(normalizarPreferenciasMenu({ tamanhoBotao: 63.7 }).tamanhoBotao, 64);
    });
    assert.equal(preferencia.posicao, "arrastavel");
    assert.equal(preferencia.transparencia, 34);
    assert.equal(preferencia.x, 50);
    assert.equal(preferencia.densidade, "compacta");
    assert.equal(preferencia.telaInicial, "lancamentos");
    assert.equal(preferencia.ultimoPeriodo, "2026-09");
    assert.equal(preferencia.escopoCsv, "todos");
});

test("tela inicial ausente ou inválida usa o resumo do mês", () => {
    assert.equal(normalizarPreferenciasMenu(null).telaInicial, "resumo");
    assert.equal(normalizarPreferenciasMenu({ telaInicial: "invalida" }).telaInicial, "resumo");
    assert.equal(normalizarPreferenciasMenu({ telaInicial: "graficos" }).telaInicial, "graficos");
});

test("tela inicial e última seção válida persistem e são restauradas", () => {
    const dados = new Map();
    const local = {
        getItem: (chave) => dados.get(chave) ?? null,
        setItem: (chave, valor) => dados.set(chave, String(valor)),
        removeItem: (chave) => dados.delete(chave)
    };
    const chave = "controleFinanceiro:preferencias-menu";
    const preferencias = normalizarPreferenciasMenu({
        telaInicial: "ultimo",
        ultimaTelaUtilizada: "graficos"
    });
    assert.equal(criarArmazenamento(local).escreverJson(chave, preferencias), true);

    const restauradas = normalizarPreferenciasMenu(criarArmazenamento(local).lerJson(chave));
    assert.equal(restauradas.telaInicial, "ultimo");
    assert.equal(resolverTelaInicial(restauradas), "graficos");
});

test("modo última tela só restaura seções permitidas e usa resumo como fallback", () => {
    assert.equal(resolverTelaInicial(normalizarPreferenciasMenu({
        telaInicial: "ultimo",
        ultimaTelaUtilizada: "lancamentos"
    })), "lancamentos");
    assert.equal(resolverTelaInicial(normalizarPreferenciasMenu({
        telaInicial: "ultimo",
        ultimaTelaUtilizada: "configuracoes"
    })), "resumo");
    assert.equal(normalizarPreferenciasMenu({
        telaInicial: "ultimo",
        ultimaTelaUtilizada: "configuracoes"
    }).ultimaTelaUtilizada, null);
});

test("preferências antigas de receitas e despesas continuam abrindo lançamentos", () => {
    assert.equal(normalizarPreferenciasMenu({ telaInicial: "receitas" }).telaInicial, "lancamentos");
    assert.equal(normalizarPreferenciasMenu({ telaInicial: "despesas" }).telaInicial, "lancamentos");
});

test("preferências existentes permanecem intactas ao normalizar a tela inicial", () => {
    const preferencias = normalizarPreferenciasMenu({
        telaInicial: "ultimo",
        ocultarAoIniciar: true,
        densidade: "compacta",
        mostrarGraficos: false,
        referenciaMes: "ultimo",
        ultimoPeriodo: "2026-09",
        escopoCsv: "todos"
    });

    test("resultado de atualização persiste sem substituir outras preferências do menu", async () => {
        const dados = new Map();
        const local = {
            getItem: (chave) => dados.get(chave) ?? null,
            setItem: (chave, valor) => dados.set(chave, String(valor)),
            removeItem: (chave) => dados.delete(chave)
        };
        const chave = "controleFinanceiro:preferencias-menu";
        const antes = normalizarPreferenciasMenu({
            tema: "floresta", densidade: "compacta", mostrarGraficos: false,
            ocultarAoIniciar: true, telaInicial: "graficos",
            ultimaVerificacao: "16/10/2026 16:00:00",
            resultadoVerificacao: "Atualização disponível: 1.0.0 → 1.1.0.",
            versaoPublicada: "1.1.0"
        });
        assert.equal(criarArmazenamento(local).escreverJson(chave, antes), true);

        const depois = normalizarPreferenciasMenu(criarArmazenamento(local).lerJson(chave));
        assert.equal(depois.densidade, "compacta");
        assert.equal(depois.mostrarGraficos, false);
        assert.equal(depois.ocultarAoIniciar, true);
        assert.equal(depois.telaInicial, "graficos");
        assert.equal(depois.ultimaVerificacao, "16/10/2026 16:00:00");
        assert.equal(depois.resultadoVerificacao, "Atualização disponível: 1.0.0 → 1.1.0.");
        assert.equal(depois.versaoPublicada, "1.1.0");
    });
    assert.equal(preferencias.ocultarAoIniciar, true);
    assert.equal(preferencias.densidade, "compacta");
    assert.equal(preferencias.mostrarGraficos, false);
    assert.equal(preferencias.referenciaMes, "ultimo");
    assert.equal(preferencias.ultimoPeriodo, "2026-09");
    assert.equal(preferencias.escopoCsv, "todos");
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

test("ocultação financeira também mascara gasto, limite e restante do orçamento", () => {
    const formatar = (valor) => `R$ ${valor.toFixed(2)}`;
    for (const valor of [420, 600, 180]) {
        assert.equal(apresentarValorFinanceiro(valor, true, formatar), "••••");
    }
});

test("preferências antigas ou incompletas mantêm valores visíveis por padrão", () => {
    const antigas = normalizarPreferenciasMenu({ densidade: "confortavel" });
    assert.equal(antigas.ocultarAoIniciar, false);
    assert.equal(antigas.densidade, "confortavel");
    assert.equal(antigas.transparencia, 45);
});
