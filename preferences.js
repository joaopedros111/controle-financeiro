const PADRAO = {
    posicao: "centro", transparencia: 45, tamanhoBotao: 58, x: null, y: null,
    densidade: 50, mostrarGraficos: true, telaInicial: "resumo",
    mostrarPlanejamento: true, mostrarDespesas: true, mostrarEntradas: true,
    ultimaTelaUtilizada: null,
    referenciaMes: "atual", ultimoPeriodo: null, ocultarAoIniciar: false,
    idioma: "pt-BR", moeda: "BRL",
    escopoCsv: "mes", ultimaOperacao: "Nenhum backup ou restauração registrado nesta instalação.",
    ultimaVerificacao: "Não registrada.", resultadoVerificacao: "Não verificada.",
    versaoPublicada: "Não verificada."
};

const DENSIDADES_ANTIGAS = {
    "muito-compacta": 0,
    compacta: 25,
    padrao: 50,
    confortavel: 75,
    "muito-confortavel": 100
};

const ESCALA_ESPACAMENTOS_DENSIDADE = {
    "--densidade-container-gap": [4, 12],
    "--densidade-bloco-vertical": [8, 28],
    "--densidade-bloco-horizontal": [8, 24],
    "--densidade-cabecalho-gap": [4, 12],
    "--densidade-cabecalho-margem": [6, 14],
    "--densidade-lista-gap": [4, 12],
    "--densidade-lancamento-vertical": [4, 20],
    "--densidade-lancamento-gap": [4, 10],
    "--densidade-lancamento-gap-mobile": [4, 7],
    "--densidade-itens-despesa-horizontal": [4, 12],
    "--densidade-panorama-gap": [6, 14],
    "--densidade-panorama-gap-mobile": [4, 10],
    "--densidade-panorama-conteudo-gap": [6, 18],
    "--densidade-panorama-conteudo-gap-mobile": [4, 8],
    "--densidade-legenda-categoria-padding": [3, 7],
    "--densidade-legenda-categoria-padding-mobile": [3, 5],
    "--densidade-legenda-categoria-gap": [4, 8],
    "--densidade-legenda-categoria-gap-mobile": [2, 4],
    "--densidade-nome-categoria-gap": [3, 7],
    "--densidade-nome-categoria-gap-mobile": [3, 5],
    "--densidade-opcoes-topo-margem": [8, 20],
    "--densidade-opcoes-secao-gap": [4, 16],
    "--densidade-opcoes-grupo-margem": [12, 28],
    "--densidade-opcoes-grupo-padding": [12, 24],
    "--densidade-opcoes-linha-padding": [7, 12],
    "--densidade-opcoes-linha-gap": [6, 12],
    "--densidade-opcoes-linha-padding-mobile": [6, 10],
    "--densidade-opcoes-linha-gap-mobile": [6, 8],
    "--densidade-opcoes-controle-gap": [4, 8]
};

export function calcularEspacamentosDensidade(densidade) {
    const valor = Number.isFinite(densidade) ? Math.max(0, Math.min(100, densidade)) : PADRAO.densidade;
    return Object.fromEntries(Object.entries(ESCALA_ESPACAMENTOS_DENSIDADE).map(([variavel, [minimo, maximo]]) => [
        variavel,
        `${Number((minimo + (maximo - minimo) * valor / 100).toFixed(2))}px`
    ]));
}

export function normalizarPreferenciasMenu(salvas) {
    const preferencias = { ...PADRAO, ...(salvas && typeof salvas === "object" && !Array.isArray(salvas) ? salvas : {}) };
    if (!["centro", "direita", "esquerda", "arrastavel"].includes(preferencias.posicao)) preferencias.posicao = PADRAO.posicao;
    const transparencia = Number(preferencias.transparencia);
    preferencias.transparencia = Number.isFinite(transparencia) ? Math.max(20, Math.min(80, transparencia)) : PADRAO.transparencia;
    const tamanhoBotao = Number(preferencias.tamanhoBotao);
    preferencias.tamanhoBotao = Number.isFinite(tamanhoBotao)
        ? Math.max(44, Math.min(76, Math.round(tamanhoBotao)))
        : PADRAO.tamanhoBotao;
    if (typeof preferencias.densidade === "string") {
        preferencias.densidade = DENSIDADES_ANTIGAS[preferencias.densidade] ?? PADRAO.densidade;
    } else if (typeof preferencias.densidade === "number" && Number.isFinite(preferencias.densidade)) {
        preferencias.densidade = Math.round(Math.max(0, Math.min(100, preferencias.densidade)));
    } else preferencias.densidade = PADRAO.densidade;
    if (preferencias.telaInicial === "receitas" || preferencias.telaInicial === "despesas") {
        preferencias.telaInicial = "lancamentos";
    }
    if (!["resumo", "lancamentos", "graficos", "ultimo"].includes(preferencias.telaInicial)) preferencias.telaInicial = PADRAO.telaInicial;
    if (!["resumo", "lancamentos", "graficos"].includes(preferencias.ultimaTelaUtilizada)) {
        preferencias.ultimaTelaUtilizada = null;
    }
    if (!["atual", "ultimo"].includes(preferencias.referenciaMes)) preferencias.referenciaMes = PADRAO.referenciaMes;
    if (!["mes", "todos"].includes(preferencias.escopoCsv)) preferencias.escopoCsv = PADRAO.escopoCsv;
    if (!["pt-BR", "en", "es", "fr", "de", "ja"].includes(preferencias.idioma)) preferencias.idioma = PADRAO.idioma;
    if (!["BRL", "USD", "EUR", "JPY"].includes(preferencias.moeda)) preferencias.moeda = PADRAO.moeda;
    preferencias.mostrarGraficos = preferencias.mostrarGraficos !== false;
    preferencias.mostrarPlanejamento = preferencias.mostrarPlanejamento !== false;
    preferencias.mostrarDespesas = preferencias.mostrarDespesas !== false;
    preferencias.mostrarEntradas = preferencias.mostrarEntradas !== false;
    preferencias.ocultarAoIniciar = preferencias.ocultarAoIniciar === true;
    for (const chave of ["ultimaVerificacao", "resultadoVerificacao", "versaoPublicada"]) {
        if (typeof preferencias[chave] !== "string") preferencias[chave] = PADRAO[chave];
    }
    preferencias.x = Number.isFinite(preferencias.x) ? preferencias.x : null;
    preferencias.y = Number.isFinite(preferencias.y) ? preferencias.y : null;
    if (preferencias.referenciaMes !== "ultimo" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(preferencias.ultimoPeriodo || "")) {
        preferencias.ultimoPeriodo = null;
    } else {
        const ano = Number(preferencias.ultimoPeriodo.slice(0, 4));
        if (ano < 2000 || ano > 2100) preferencias.ultimoPeriodo = null;
    }
    return preferencias;
}

export function resolverTelaInicial(preferencias) {
    if (preferencias.telaInicial !== "ultimo") return preferencias.telaInicial;
    return preferencias.ultimaTelaUtilizada || PADRAO.telaInicial;
}

export function apresentarValorFinanceiro(valor, ocultos, formatar) {
    return ocultos ? "••••" : formatar(valor);
}
