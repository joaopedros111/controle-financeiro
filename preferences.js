const PADRAO = {
    posicao: "centro", transparencia: 45, x: null, y: null,
    densidade: "padrao", mostrarGraficos: true, telaInicial: "resumo",
    referenciaMes: "atual", ultimoPeriodo: null, ocultarAoIniciar: false,
    escopoCsv: "mes", ultimaOperacao: "Nenhum backup ou restauração registrado nesta instalação.",
    ultimaVerificacao: "Não registrada."
};

export function normalizarPreferenciasMenu(salvas) {
    const preferencias = { ...PADRAO, ...(salvas && typeof salvas === "object" && !Array.isArray(salvas) ? salvas : {}) };
    if (!["centro", "direita", "esquerda", "arrastavel"].includes(preferencias.posicao)) preferencias.posicao = PADRAO.posicao;
    const transparencia = Number(preferencias.transparencia);
    preferencias.transparencia = Number.isFinite(transparencia) ? Math.max(20, Math.min(80, transparencia)) : PADRAO.transparencia;
    if (!["compacta", "padrao", "confortavel"].includes(preferencias.densidade)) preferencias.densidade = PADRAO.densidade;
    if (!["resumo", "receitas", "despesas", "lancamentos"].includes(preferencias.telaInicial)) preferencias.telaInicial = PADRAO.telaInicial;
    if (!["atual", "ultimo"].includes(preferencias.referenciaMes)) preferencias.referenciaMes = PADRAO.referenciaMes;
    if (!["mes", "todos"].includes(preferencias.escopoCsv)) preferencias.escopoCsv = PADRAO.escopoCsv;
    preferencias.mostrarGraficos = preferencias.mostrarGraficos !== false;
    preferencias.ocultarAoIniciar = preferencias.ocultarAoIniciar === true;
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
