const PADRAO = {
    posicao: "centro", transparencia: 45, tamanhoBotao: 58, x: null, y: null,
    densidade: "padrao", mostrarGraficos: true, telaInicial: "resumo",
    mostrarPlanejamento: true, mostrarDespesas: true, mostrarEntradas: true,
    ultimaTelaUtilizada: null,
    referenciaMes: "atual", ultimoPeriodo: null, ocultarAoIniciar: false,
    idioma: "pt-BR", moeda: "BRL",
    escopoCsv: "mes", ultimaOperacao: "Nenhum backup ou restauração registrado nesta instalação.",
    ultimaVerificacao: "Não registrada.", resultadoVerificacao: "Não verificada.",
    versaoPublicada: "Não verificada."
};

export function normalizarPreferenciasMenu(salvas) {
    const preferencias = { ...PADRAO, ...(salvas && typeof salvas === "object" && !Array.isArray(salvas) ? salvas : {}) };
    if (!["centro", "direita", "esquerda", "arrastavel"].includes(preferencias.posicao)) preferencias.posicao = PADRAO.posicao;
    const transparencia = Number(preferencias.transparencia);
    preferencias.transparencia = Number.isFinite(transparencia) ? Math.max(20, Math.min(80, transparencia)) : PADRAO.transparencia;
    const tamanhoBotao = Number(preferencias.tamanhoBotao);
    preferencias.tamanhoBotao = Number.isFinite(tamanhoBotao)
        ? Math.max(44, Math.min(76, Math.round(tamanhoBotao)))
        : PADRAO.tamanhoBotao;
    if (!["compacta", "padrao", "confortavel"].includes(preferencias.densidade)) preferencias.densidade = PADRAO.densidade;
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
