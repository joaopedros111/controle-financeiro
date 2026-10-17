import test from "node:test";
import assert from "node:assert/strict";
import { apresentarValorFinanceiro, calcularEspacamentosDensidade, normalizarPreferenciasMenu, resolverTelaInicial } from "../preferences.js";
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
    assert.equal(preferencia.densidade, 50);
    assert.equal(preferencia.telaInicial, "resumo");
    assert.equal(preferencia.ultimoPeriodo, null);
    assert.equal(preferencia.escopoCsv, "mes");
    assert.equal(preferencia.mostrarGraficos, false);
    assert.equal(preferencia.ocultarAoIniciar, true);
});

test("densidade contínua normaliza limites e mapeia os níveis antigos", () => {
    assert.equal(normalizarPreferenciasMenu({}).densidade, 50);
    assert.equal(normalizarPreferenciasMenu({ densidade: -10 }).densidade, 0);
    assert.equal(normalizarPreferenciasMenu({ densidade: 130 }).densidade, 100);
    assert.equal(normalizarPreferenciasMenu({ densidade: 62.7 }).densidade, 63);
    assert.equal(normalizarPreferenciasMenu({ densidade: "inválida" }).densidade, 50);
    for (const [legada, posicao] of [
        ["muito-compacta", 0], ["compacta", 25], ["padrao", 50],
        ["confortavel", 75], ["muito-confortavel", 100]
    ]) {
        assert.equal(normalizarPreferenciasMenu({ densidade: legada }).densidade, posicao);
    }
});

test("escala de densidade varia progressivamente e preserva os valores do extremo confortável", () => {
    const minimo = calcularEspacamentosDensidade(0);
    const meio = calcularEspacamentosDensidade(50);
    const maximo = calcularEspacamentosDensidade(100);

    assert.equal(minimo["--densidade-bloco-vertical"], "8px");
    assert.equal(maximo["--densidade-bloco-vertical"], "28px");
    assert.equal(maximo["--densidade-bloco-horizontal"], "24px");
    assert.equal(maximo["--densidade-lancamento-vertical"], "20px");
    assert.equal(maximo["--densidade-opcoes-secao-gap"], "16px");
    assert.equal(maximo["--densidade-opcoes-grupo-margem"], "28px");
    assert.equal(maximo["--densidade-opcoes-grupo-padding"], "24px");
    assert.equal(maximo["--densidade-opcoes-linha-padding"], "12px");
    assert.equal(maximo["--densidade-opcoes-linha-padding-mobile"], "10px");
    assert.equal(maximo["--densidade-panorama-gap"], "14px");
    assert.equal(maximo["--densidade-panorama-gap-mobile"], "10px");
    assert.equal(maximo["--densidade-panorama-conteudo-gap"], "18px");
    assert.equal(maximo["--densidade-panorama-conteudo-gap-mobile"], "8px");
    assert.equal(maximo["--densidade-legenda-categoria-padding"], "7px");
    assert.equal(maximo["--densidade-legenda-categoria-padding-mobile"], "5px");
    assert.ok(Number.parseFloat(minimo["--densidade-container-gap"]) < Number.parseFloat(meio["--densidade-container-gap"]));
    assert.ok(Number.parseFloat(meio["--densidade-container-gap"]) < Number.parseFloat(maximo["--densidade-container-gap"]));
});

test("seções da tela inicial ficam visíveis por padrão em preferências existentes", () => {
    const padrao = normalizarPreferenciasMenu({});
    assert.equal(padrao.mostrarPlanejamento, true);
    assert.equal(padrao.mostrarDespesas, true);
    assert.equal(padrao.mostrarEntradas, true);
    assert.deepEqual(normalizarPreferenciasMenu({
        mostrarPlanejamento: "false",
        mostrarDespesas: null
    }), padrao);
});

test("preferências de visibilidade são independentes e persistem após recarregar", () => {
    const dados = new Map();
    const local = {
        getItem: (chave) => dados.get(chave) ?? null,
        setItem: (chave, valor) => dados.set(chave, String(valor)),
        removeItem: (chave) => dados.delete(chave)
    };
    const chave = "controleFinanceiro:preferencias-menu";
    const preferencias = normalizarPreferenciasMenu({
        mostrarPlanejamento: false,
        mostrarDespesas: true,
        mostrarEntradas: false,
        densidade: "confortavel",
        mostrarGraficos: false,
        telaInicial: "graficos"
    });
    assert.equal(criarArmazenamento(local).escreverJson(chave, preferencias), true);

    const restauradas = normalizarPreferenciasMenu(criarArmazenamento(local).lerJson(chave));
    assert.equal(restauradas.mostrarPlanejamento, false);
    assert.equal(restauradas.mostrarDespesas, true);
    assert.equal(restauradas.mostrarEntradas, false);
    assert.equal(restauradas.densidade, 75);
    assert.equal(restauradas.mostrarGraficos, false);
    assert.equal(restauradas.telaInicial, "graficos");
    assert.deepEqual(
        normalizarPreferenciasMenu({ mostrarPlanejamento: false }),
        { ...normalizarPreferenciasMenu({}), mostrarPlanejamento: false }
    );
});

test("posição personalizada do slider de densidade persiste após recarregar", () => {
    const dados = new Map();
    const local = {
        getItem: (chave) => dados.get(chave) ?? null,
        setItem: (chave, valor) => dados.set(chave, String(valor)),
        removeItem: (chave) => dados.delete(chave)
    };
    const chave = "controleFinanceiro:preferencias-menu";
    const preferencias = normalizarPreferenciasMenu({ densidade: 37 });

    assert.equal(preferencias.densidade, 37);
    assert.equal(criarArmazenamento(local).escreverJson(chave, preferencias), true);
    assert.equal(normalizarPreferenciasMenu(criarArmazenamento(local).lerJson(chave)).densidade, 37);
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
    assert.equal(preferencia.densidade, 25);
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
        assert.equal(depois.densidade, 25);
        assert.equal(depois.mostrarGraficos, false);
        assert.equal(depois.ocultarAoIniciar, true);
        assert.equal(depois.telaInicial, "graficos");
        assert.equal(depois.ultimaVerificacao, "16/10/2026 16:00:00");
        assert.equal(depois.resultadoVerificacao, "Atualização disponível: 1.0.0 → 1.1.0.");
        assert.equal(depois.versaoPublicada, "1.1.0");
    });
    assert.equal(preferencias.ocultarAoIniciar, true);
    assert.equal(preferencias.densidade, 25);
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
    assert.equal(recarregado.densidade, 25);
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
    assert.equal(antigas.densidade, 75);
    assert.equal(antigas.transparencia, 45);
});
