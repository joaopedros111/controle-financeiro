import { storage } from "./storage.js";
import { CATEGORIAS_PADRAO, CATEGORIA_FIXA, normalizarEstado as normalizarEstadoCore, validarBackup, migrarDadosLegados, calcularExpressao, somarCentavos, gerarCsv, calcularOrcamentosPorCategoria, ordenarOrcamentosComGastos, renomearCategoriaOrcamentos, removerCategoriaOrcamentos } from "./finance-core.js";
import { apresentarValorFinanceiro, normalizarPreferenciasMenu, resolverTelaInicial } from "./preferences.js";
import { instalarAtualizacao, lerVersaoInstalada, lerVersaoPublicada, verificarComConfirmacao } from "./update-manager.js";
import { aplicarIdioma, formatarMoeda as formatarMoedaLocalizada, LOCALES } from "./localization.js";



/* =========================================================

   Controle Financeiro

   Dados salvos no navegador (localStorage).

   ========================================================= */



const CHAVE_ESTADO = "controleFinanceiro:v3";
const CHAVE_ESTADO_V2 = "controleFinanceiro:v2";
const CHAVE_ESTADO_STORAGE_ANTIGO = "controle-financeiro-dados";

const PREFIXO_LEGADO = "controleFinanceiro-"; // versão antiga: um item por mês



const $ = (id) => document.getElementById(id);



const ui = {

    mes: $("mes"),

    ano: $("ano"),

    mesAnterior: $("mes-anterior"),

    mesProximo: $("mes-proximo"),

    hoje: $("hoje"),

    tema: $("alternar-tema"),
    abrirAjustes: $("abrir-ajustes"),
    dialogoAjustes: $("dialogo-ajustes"),
    fecharAjustes: $("fechar-ajustes"),
    posicaoBotaoMenu: $("posicao-botao-menu"),
    transparenciaBotaoMenu: $("transparencia-botao-menu"),
    valorTransparenciaBotao: $("valor-transparencia-botao"),
    tamanhoBotaoMenu: $("tamanho-botao-menu"),
    valorTamanhoBotaoMenu: $("valor-tamanho-botao-menu"),
    idiomaInterface: $("idioma-interface"),
    moedaInterface: $("moeda-interface"),
    densidadeInterface: $("densidade-interface"),
    mostrarGraficos: $("mostrar-graficos"),
    mostrarPlanejamento: $("mostrar-planejamento"),
    mostrarDespesas: $("mostrar-despesas-mes"),
    mostrarEntradas: $("mostrar-entradas"),
    telaInicial: $("tela-inicial"),
    referenciaMes: $("referencia-mes"),
    ocultarAoIniciar: $("ocultar-ao-iniciar"),
    alternarValores: $("alternar-valores"),
    escopoCsv: $("escopo-csv"),
    diagnosticoDados: $("diagnostico-dados"),
    ultimaOperacaoDados: $("ultima-operacao-dados"),
    diagnosticoApp: $("diagnostico-app"),
    versaoInstalada: $("versao-instalada"),
    versaoPublicada: $("versao-publicada"),
    dataVerificacaoAtualizacao: $("data-verificacao-atualizacao"),
    resultadoVerificacaoAtualizacao: $("resultado-verificacao-atualizacao"),
    statusAtualizacao: $("status-atualizacao"),
    gerenciarOrcamentos: $("gerenciar-orcamentos"),
    dialogoOrcamentos: $("dialogo-orcamentos"),
    fecharOrcamentos: $("fechar-orcamentos"),
    opcoesOrcamentos: $("opcoes-orcamento"),
    abrirCategoriasOrcamento: $("abrir-categorias-orcamento"),
    abrirLimitesOrcamento: $("abrir-limites-orcamento"),
    painelCategoriasOrcamento: $("painel-categorias-orcamento"),
    painelLimitesOrcamento: $("painel-limites-orcamento"),
    listaOrcamentos: $("lista-orcamentos"),
    abrirCalculadora: $("abrir-calculadora"),
    dialogoCalculadora: $("dialogo-calculadora"),
    fecharCalculadora: $("fechar-calculadora"),
    visorCalculadora: $("visor-calculadora"),
    atualizarApp: $("atualizar-app"),



    saldoRotulo: $("saldo-rotulo"),

    saldoValor: $("saldo-valor"),
    alternarVisibilidadeResumo: $("alternar-visibilidade-resumo"),

    barra: $("barra"),

    barraPago: $("barra-pago"),

    barraPendente: $("barra-pendente"),

    textoComprometido: $("texto-comprometido"),

    totalReceitas: $("total-receitas"),

    totalDespesas: $("total-despesas"),

    valorPago: $("valor-pago"),

    valorPendente: $("valor-pendente"),



    listaReceitas: $("lista-receitas"),

    vazioReceitas: $("vazio-receitas"),

    adicionarReceita: $("adicionar-receita"),

    totalReceitasLista: $("total-receitas-lista"),

    dialogoReceita: $("dialogo-receita"),

    formReceita: $("form-receita"),

    tituloDialogoReceita: $("titulo-dialogo-receita"),

    receitaNome: $("receita-nome"),

    receitaValor: $("receita-valor"),

    fecharReceita: $("fechar-receita"),

    cancelarReceita: $("cancelar-receita"),



    listaDespesas: $("lista-despesas"),

    vazioDespesas: $("vazio-despesas"),

    adicionarDespesa: $("adicionar-despesa"),

    dialogoDespesa: $("dialogo-despesa"),

    formDespesa: $("form-despesa"),

    tituloDialogoDespesa: $("titulo-dialogo-despesa"),

    despesaNome: $("despesa-nome"),

    despesaCategoria: $("despesa-categoria"),

    despesaValor: $("despesa-valor"),

    despesaPago: $("despesa-pago"),

    fecharDespesa: $("fechar-despesa"),

    cancelarDespesa: $("cancelar-despesa"),

    campoTipo: $("campo-tipo"),

    despesaTipo: $("despesa-tipo"),

    dicaTipo: $("dica-tipo"),

    campoParcelas: $("campo-parcelas"),

    despesaParcelas: $("despesa-parcelas"),

    campoPropagar: $("campo-propagar"),

    despesaPropagar: $("despesa-propagar"),

    textoPropagar: $("texto-propagar"),

    dialogoSerie: $("dialogo-serie"),

    textoSerie: $("texto-serie"),

    serieCancelar: $("serie-cancelar"),

    serieSoEste: $("serie-so-este"),

    serieProximos: $("serie-proximos"),

    totalRotulo: $("total-rotulo"),

    totalValor: $("total-valor"),
    listaPlanejamentoOrcamentos: $("lista-planejamento-orcamentos"),
    vazioPlanejamentoOrcamentos: $("vazio-planejamento-orcamentos"),




    copiarMesAnterior: $("copiar-mes-anterior"),

    exportarCsv: $("exportar-csv"),

    exportarBackup: $("exportar-backup"),

    importarBackup: $("importar-backup"),

    arquivoBackup: $("arquivo-backup"),

    limparMes: $("limpar-mes"),



    listaCategorias: $("lista-categorias"),

    novaCategoria: $("nova-categoria"),

    adicionarCategoria: $("adicionar-categoria"),

    aviso: $("aviso")

};

/* Preencher seletor de anos */
for (let ano = 2000; ano <= 2100; ano++) {
    const option = document.createElement("option");
    option.value = ano;
    option.textContent = ano;
    ui.ano.appendChild(option);
}

/* ---------- Utilidades ---------- */



function uid() {

    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

}



function numero(valor) {

    const n = Number(valor);

    return Number.isFinite(n) ? n : 0;

}



let valoresOcultos = false;
let idiomaAtual = "pt-BR";
function formatarMoeda(valor) {
    return apresentarValorFinanceiro(valor, valoresOcultos, (valorVisivel) =>
        formatarMoedaLocalizada(valorVisivel, preferenciasMenu.moeda, idiomaAtual)
    );
}

function formatarPercentual(valor) {
    return new Intl.NumberFormat(LOCALES[idiomaAtual] || "pt-BR", {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    }).format(valor / 100);
}

function nomeMes(mes) {
    return new Intl.DateTimeFormat(LOCALES[idiomaAtual] || "pt-BR", { month: "long" })
        .format(new Date(2020, mes - 1, 1));
}



function criarEl(tag, props = {}, filhos = []) {

    const e = document.createElement(tag);



    Object.entries(props).forEach(([chave, valor]) => {

        if (chave === "class") {

            e.className = valor;

        } else if (chave === "dataset") {

            Object.assign(e.dataset, valor);

        } else if (chave === "text") {

            e.textContent = valor;

        } else if (chave in e) {

            e[chave] = valor;

        } else {

            e.setAttribute(chave, valor);

        }

    });



    filhos.forEach((f) => e.append(f));



    return e;

}



let temporizadorAviso = null;



function avisar(mensagem, acao) {



    ui.aviso.replaceChildren(criarEl("span", { text: mensagem }));

    ui.aviso.classList.toggle("com-acao", Boolean(acao));



    if (acao) {

        ui.aviso.append(criarEl("button", {

            type: "button",

            class: "aviso-acao",

            text: acao.rotulo,

            onclick: () => {

                ui.aviso.classList.remove("visivel");

                acao.executar();

            }

        }));

    }



    ui.aviso.classList.add("visivel");



    clearTimeout(temporizadorAviso);

    temporizadorAviso = setTimeout(() => {

        ui.aviso.classList.remove("visivel");

    }, acao ? 7000 : 3000);

}



/* ---------- Estado e persistência ---------- */



function chaveMes(ano, mes) {

    return ano + "-" + String(mes).padStart(2, "0");

}



function normalizarEstado(bruto) {
    return normalizarEstadoCore(bruto, uid);
}

let migracaoLegadaPendente = false;
let migracaoEstadoV2Pendente = false;
let dadosStorageAntigoPendentes = false;
let avisoArmazenamentoTemporarioExibido = false;

// O formato legado não guardava o ano; mantém a associação ao ano atual.
function migrarLegado() {
    const registrosPorMes = {};
    for (let mes = 1; mes <= 12; mes += 1) {
        const texto = storage.ler(PREFIXO_LEGADO + mes);
        if (!texto) continue;
        try { registrosPorMes[mes] = JSON.parse(texto); } catch (_) { /* ignora mês legado corrompido */ }
    }
    const legado = migrarDadosLegados(registrosPorMes, new Date().getFullYear());
    if (legado) migracaoLegadaPendente = true;
    return legado;
}

function carregarEstado() {



    try {

        const salvo = storage.lerJson(CHAVE_ESTADO);



        if (salvo) {

            return normalizarEstado(salvo);

        }

        const estadoV2 = storage.lerJson(CHAVE_ESTADO_V2);
        if (estadoV2 && typeof estadoV2 === "object" && estadoV2.meses) {
            migracaoEstadoV2Pendente = true;
            return normalizarEstado(estadoV2);
        }

        const storageAntigo = storage.lerJson(CHAVE_ESTADO_STORAGE_ANTIGO);
        if (storageAntigo && typeof storageAntigo === "object" && storageAntigo.meses) {
            dadosStorageAntigoPendentes = true;
            return normalizarEstado(storageAntigo);
        }



        const legado = migrarLegado();



        if (legado) {

            return normalizarEstado(legado);

        }

    } catch (erro) {

        console.error("Erro ao carregar os dados:", erro);

    }



    return normalizarEstado(null);

}



let estado = carregarEstado();



// Cópia do estado sem os meses vazios (navegar pelos meses os cria em memória).

function estadoParaSalvar() {



    const meses = {};



    Object.entries(estado.meses).forEach(([chave, mes]) => {

        if (mes.receitas.length || mes.despesas.length) {

            meses[chave] = mes;

        }

    });



    return { ...estado, meses };

}



function salvar() {

    try {
        if (!storage.escreverJson(CHAVE_ESTADO, estadoParaSalvar())) avisarArmazenamentoTemporario();
        atualizarDiagnostico();
    } catch (erro) {
        avisar("Não foi possível salvar os dados neste dispositivo.");
    }

}

function avisarArmazenamentoTemporario() {
    if (avisoArmazenamentoTemporarioExibido) return;
    avisoArmazenamentoTemporarioExibido = true;
    avisar("O armazenamento persistente está indisponível. Os dados podem se perder ao fechar o app.");
}



/* ---------- Período ---------- */



const agora = new Date();



let periodo = {

    ano: agora.getFullYear(),

    mes: agora.getMonth() + 1

};



function obterMes() {

    const chave = chaveMes(periodo.ano, periodo.mes);



    if (!estado.meses[chave]) {

        estado.meses[chave] = { receitas: [], despesas: [] };

    }



    return estado.meses[chave];

}



function mudarPeriodo(ano, mes) {



    while (mes < 1) {

        mes += 12;

        ano -= 1;

    }



    while (mes > 12) {

        mes -= 12;

        ano += 1;

    }



    if (ano < 2000 || ano > 2100) return;



    periodo = { ano, mes };

    if (preferenciasMenu.referenciaMes === "ultimo") {
        preferenciasMenu.ultimoPeriodo = chaveMes(ano, mes);
        salvarPreferenciasMenu();
    }



    renderTudo();

}



/* ---------- Renderização ---------- */



function renderPeriodo() {

    ui.mes.value = String(periodo.mes);

    ui.ano.value = String(periodo.ano);

}



function renderTema() {



    const tema = estado.tema || "claro";
    const nomesTema = { claro: "Claro", escuro: "Escuro", rosa: "Rosa", pangolim: "Pangolim", floresta: "Selva" };
    const ordemTemas = ["claro", "escuro", "rosa", "pangolim", "floresta"];
    const proximoTema = ordemTemas[(ordemTemas.indexOf(tema) + 1) % ordemTemas.length];



    document.documentElement.dataset.tema = tema;
    const coresBarraNavegador = {
        claro: "#f4f6fb", escuro: "#0c1020", rosa: "#fff7fb",
        pangolim: "#fbf3df", floresta: "#edf5ed"
    };
    const corDaBarraDoNavegador = coresBarraNavegador[tema] || coresBarraNavegador.claro;
    document.querySelector('meta[name="theme-color"]').content = corDaBarraDoNavegador;

    ui.tema.replaceChildren(
        criarEl("span", { text: ({ escuro: "🌙", rosa: "🌸", pangolim: "🐾", floresta: "🌲" })[tema] || "☀️" }),
        criarEl("span", { text: nomesTema[tema] })
    );
    ui.tema.setAttribute("aria-label", "Tema atual: " + nomesTema[tema] + ". Mudar para " + nomesTema[proximoTema] + ".");

}



function criarLinhaReceita(receita) {



    const linha = criarEl("div", {

        class: "receita",

        dataset: { id: receita.id }

    });



    const nome = receita.nome.trim() || "Sem nome";



    linha.append(

        criarEl("span", { class: "nome-receita", text: nome }),

        criarEl("span", {

            class: "valor-receita",

            text: formatarMoeda(numero(receita.valor))

        }),

        criarEl("button", {

            type: "button",

            class: "editar-receita",

            title: "Editar entrada",

            "aria-label": "Editar entrada " + nome,

            text: "✎"

        }),

        criarEl("button", {

            type: "button",

            class: "remover-receita",

            title: "Remover entrada",

            "aria-label": "Remover entrada " + nome,

            text: "×"

        })

    );



    return linha;

}



function renderReceitas() {



    const receitas = obterMes().receitas;



    ui.listaReceitas.replaceChildren(...receitas.map(criarLinhaReceita));

    ui.vazioReceitas.hidden = receitas.length > 0;

}



function marcaDaDespesa(despesa) {



    if (despesa.parcela) {

        return [criarEl("span", {

            class: "marca",

            title: "Parcela " + despesa.parcela.atual + " de " + despesa.parcela.total,

            text: despesa.parcela.atual + "/" + despesa.parcela.total

        })];

    }



    if (despesa.fixa) {

        return [criarEl("span", {

            class: "marca",

            title: "Despesa fixa: se repete todo mês",

            text: "Fixa"

        })];

    }



    return [];

}



function criarLinhaDespesa(despesa) {



    const linha = criarEl("div", {

        class: "despesa" + (despesa.pago ? " paga" : ""),

        dataset: { id: despesa.id }

    });



    linha.append(

        criarEl("input", {

            type: "checkbox",

            class: "pago-despesa",

            checked: despesa.pago,

            title: despesa.pago ? "Marcar como a pagar" : "Marcar como paga",

            "aria-label": "Despesa paga"

        }),

        criarEl("div", { class: "despesa-nome" }, [

            criarEl("span", {

                class: "nome-despesa",

                text: despesa.nome.trim() || "Sem nome"

            }),

            ...marcaDaDespesa(despesa)

        ]),

        criarEl("span", {

            class: despesa.pago ? "situacao situacao-paga" : "situacao situacao-pendente",

            title: despesa.pago ? "Despesa paga" : "Despesa a pagar",

            text: despesa.pago ? "Pago" : "A pagar"

        }),

        criarEl("span", {

            class: "valor-despesa",

            text: formatarMoeda(numero(despesa.valor))

        }),

        criarEl("button", {

            type: "button",

            class: "editar-despesa",

            title: "Editar despesa",

            "aria-label": "Editar despesa " + (despesa.nome.trim() || "sem nome"),

            text: "✎"

        }),

        criarEl("button", {

            type: "button",

            class: "remover-despesa",

            title: "Remover despesa",

            "aria-label": "Remover despesa " + (despesa.nome.trim() || "sem nome"),

            text: "×"

        })

    );



    return linha;

}



function renderDespesas() {



    const despesas = obterMes().despesas;



    ui.listaDespesas.replaceChildren(...despesas.map(criarLinhaDespesa));

    ui.vazioDespesas.hidden = despesas.length > 0;

    ui.vazioDespesas.textContent =
    "Nenhuma despesa neste mês. Toque em “+ Despesa” para começar.";
}



function corDaCategoria(nome) {

    const indice = Math.max(0, estado.categorias.indexOf(nome));

    return "hsl(" + ((indice * 47 + 160) % 360) + ", 55%, 48%)";

}



function somar(lista) {
    return somarCentavos(lista.map((item) => numero(item.valor))) / 100;

}

function renderOrcamentoPorCategoria() {
    const chave = chaveMes(periodo.ano, periodo.mes);
    const mes = estado.meses[chave] || { despesas: [] };
    const itens = ordenarOrcamentosComGastos(calcularOrcamentosPorCategoria(
        estado.categorias,
        mes.despesas,
        estado.orcamentos
    ));
    ui.listaPlanejamentoOrcamentos.replaceChildren(...itens.map((item) => {
        const linha = criarEl("li", {
            class: "orcamento-item" + (item.limiteCentavos !== null && item.gastoCentavos > item.limiteCentavos ? " acima-do-orcamento" : "")
        });
        const topo = criarEl("div", { class: "orcamento-item-topo" }, [
            criarEl("strong", { text: item.categoria })
        ]);
        const gasto = item.gastoCentavos / 100;
        const detalhes = item.limiteCentavos === null
            ? `Gasto: ${formatarMoeda(gasto)} · Sem orçamento definido`
            : `Gasto: ${formatarMoeda(gasto)} · Limite: ${formatarMoeda(item.limiteCentavos / 100)}`;
        linha.append(topo, criarEl("p", { class: "orcamento-detalhes", text: detalhes }));

        if (item.limiteCentavos !== null) {
            const percentualIndeterminado = item.percentualConsumido === null;
            const percentual = percentualIndeterminado ? 100 : item.percentualConsumido;
            const barra = criarEl("div", {
                class: "orcamento-progresso",
                role: "progressbar",
                "aria-label": `Orçamento de ${item.categoria}`,
                "aria-valuemin": "0",
                "aria-valuemax": "100",
                "aria-valuenow": String(Math.min(100, Math.max(0, percentual))),
                "aria-valuetext": percentualIndeterminado ? "Gasto acima de limite zero" : `${formatarPercentual(percentual)} consumido`
            });
            barra.append(criarEl("span", { class: "orcamento-progresso-preenchido" }));
            barra.firstElementChild.style.width = Math.min(100, Math.max(0, percentual)) + "%";
            linha.append(barra);
            linha.append(item.restanteCentavos < 0
                ? criarEl("p", {
                    class: "orcamento-restante orcamento-excesso",
                    text: percentualIndeterminado
                        ? `Excesso: ${formatarMoeda(Math.abs(item.restanteCentavos) / 100)} · limite zero`
                        : `Excesso: ${formatarMoeda(Math.abs(item.restanteCentavos) / 100)} · ${formatarPercentual(percentual)} do limite`
                })
                : criarEl("p", { class: "orcamento-restante", text: `Restante: ${formatarMoeda(item.restanteCentavos / 100)} · ${formatarPercentual(percentual)} consumido` }));
        }
        return linha;
    }));
    ui.vazioPlanejamentoOrcamentos.hidden = itens.length > 0;
}

function renderListaOrcamentos() {
    const categorias = [...new Set([
        ...estado.categorias,
        ...Object.keys(estado.orcamentos.padrao)
    ])].sort((a, b) => a.localeCompare(b, "pt-BR"));
    ui.listaOrcamentos.replaceChildren(...categorias.map((categoria) => {
        const padraoConfigurado = Object.prototype.hasOwnProperty.call(estado.orcamentos.padrao, categoria);
        const limitePadrao = padraoConfigurado ? String(estado.orcamentos.padrao[categoria]) : "";
        const linha = criarEl("fieldset", { class: "orcamento-edicao", dataset: { categoria } }, [
            criarEl("legend", { text: categoria }),
            criarEl("label", { class: "orcamento-campo" }, [
                criarEl("span", { text: "Limite mensal padrão" }),
                criarEl("input", {
                    type: valoresOcultos ? "password" : "number", min: "0", step: "0.01", inputMode: "decimal",
                    value: limitePadrao, placeholder: "Sem limite",
                    dataset: { orcamentoCampo: "padrao" },
                    "aria-label": `Limite mensal padrão para ${categoria}`
                })
            ]),
            criarEl("div", { class: "orcamento-acoes" }, [
                criarEl("button", {
                    type: "button", class: "btn btn-secundario",
                    dataset: { orcamentoAcao: "salvar-padrao" }, text: "Salvar limite"
                }),
                criarEl("button", {
                    type: "button", class: "btn btn-secundario",
                    dataset: { orcamentoAcao: "remover-padrao" }, text: "Remover limite",
                    disabled: !padraoConfigurado
                })
            ])
        ]);
        return linha;
    }));
    aplicarPrivacidade();
}

function atualizarOrcamentos() {
    renderListaOrcamentos();
    renderOrcamentoPorCategoria();
    salvar();
}

function lerLimiteOrcamento(campo) {
    const texto = campo?.value.trim() || "";
    const valor = Number(texto);
    const centavos = Math.round(valor * 100);
    if (!texto || !Number.isFinite(valor) || valor < 0 || !Number.isSafeInteger(centavos)) {
        avisar("Informe um limite válido igual ou maior que zero.");
        campo?.focus();
        return null;
    }
    return centavos / 100;
}

function definirLimiteOrcamento(mapa, categoria, limite) {
    Object.defineProperty(mapa, categoria, {
        value: limite, enumerable: true, configurable: true, writable: true
    });
}


// Recalcula tudo o que depende de valores e salva. Não recria as linhas

// de despesas/receitas, então o cursor do usuário nunca é perdido.

function atualizarResumo(persistir = true) {



    const mes = obterMes();



    const receitaCentavos = somarCentavos(mes.receitas.map((r) => numero(r.valor)));
    const despesaCentavos = somarCentavos(mes.despesas.map((d) => numero(d.valor)));
    const pagoCentavos = somarCentavos(mes.despesas.filter((d) => d.pago).map((d) => numero(d.valor)));
    const receita = receitaCentavos / 100;
    const despesa = despesaCentavos / 100;
    const pago = pagoCentavos / 100;
    const pendente = (despesaCentavos - pagoCentavos) / 100;
    const saldo = (receitaCentavos - despesaCentavos) / 100;



    // Cabeçalho

    ui.saldoValor.textContent = formatarMoeda(saldo);

    ui.saldoValor.classList.toggle("negativo", saldo < 0);

    ui.saldoRotulo.textContent = "Saldo do mês";



    ui.totalReceitas.textContent = formatarMoeda(receita);

    ui.totalDespesas.textContent = formatarMoeda(despesa);

    ui.valorPago.textContent = formatarMoeda(pago);

    ui.valorPendente.textContent = formatarMoeda(pendente);



    // Barra de comprometimento

    const pctDespesa = receita > 0 ? (despesa / receita) * 100 : 0;

    const pctPago = receita > 0 ? Math.min((pago / receita) * 100, 100) : 0;

    const pctPendente = receita > 0

        ? Math.max(0, Math.min((pendente / receita) * 100, 100 - pctPago))

        : 0;



    ui.barraPago.style.width = pctPago + "%";

    ui.barraPendente.style.width = pctPendente + "%";



    ui.barra.classList.toggle("atencao", pctDespesa >= 80 && pctDespesa < 100);

    ui.barra.classList.toggle("estourou", despesa > receita && despesa > 0);

    ui.textoComprometido.classList.toggle("alerta", despesa > receita && receita > 0);



    if (receita <= 0) {

        ui.textoComprometido.textContent = despesa > 0

            ? "Adicione suas entradas para ver quanto da renda está comprometido."

            : "Adicione entradas e despesas para acompanhar o mês.";

    } else if (despesa > receita) {

        ui.textoComprometido.textContent =

            "Você gastou " + formatarPercentual(pctDespesa) + " da renda: as despesas passaram das entradas.";

    } else {

        ui.textoComprometido.textContent =

            formatarPercentual(pctDespesa) + " da renda comprometida";

    }



    // Linhas de total

    ui.totalReceitasLista.textContent = formatarMoeda(receita);

    ui.totalRotulo.textContent = "Total a pagar";

    ui.totalValor.textContent = formatarMoeda(pendente);

    renderGraficoMensal();

    renderGraficoCategorias();
    renderOrcamentoPorCategoria();

    atualizarDiagnostico();



    if (persistir) salvar();

}



function renderGraficoMensal() {
    const destino = $("grafico-mensal");
    if (!destino) return;

    const pontos = [];
    let ano = periodo.ano;
    let mes = periodo.mes;
    for (let i = 0; i < 3; i += 1) {
        const chave = chaveMes(ano, mes);
        const dados = estado.meses[chave] || { receitas: [], despesas: [] };
        pontos.unshift({
            nome: new Intl.DateTimeFormat(LOCALES[idiomaAtual] || "pt-BR", { month: "short" })
                .format(new Date(2020, mes - 1, 1)).replace(".", "").toLocaleLowerCase(idiomaAtual),
            chave,
            receitas: somar(dados.receitas),
            despesas: somar(dados.despesas)
        });
        mes -= 1;
        if (mes === 0) { mes = 12; ano -= 1; }
    }

    const escala = Math.max(0, ...pontos.flatMap((p) => [p.receitas, p.despesas]));
    $("periodo-grafico").textContent = "3 meses";
    destino.replaceChildren(...pontos.map((p) => {
        const grupo = criarEl("div", { class: "grafico-grupo" });
        const barras = criarEl("div", { class: "grafico-barras" });
        [["entrada", p.receitas, "Entradas"], ["despesa", p.despesas, "Despesas"]].forEach(([tipo, valor, rotulo]) => {
            const barra = criarEl("span", {
                class: "grafico-barra grafico-barra-" + tipo,
                title: rotulo + " em " + p.nome + "/" + p.chave.slice(0, 4) + ": " + formatarMoeda(valor),
                "aria-hidden": "true"
            });
            barra.style.height = escala > 0 ? Math.max(valor > 0 ? 4 : 0, (valor / escala) * 100) + "%" : "0%";
            barras.append(barra);
        });
        grupo.append(barras, criarEl("span", { class: "grafico-mes", text: p.nome }));
        return grupo;
    }));
    destino.setAttribute("aria-label", "Entradas e despesas nos últimos três meses: " + pontos.map((p) =>
        new Intl.DateTimeFormat(LOCALES[idiomaAtual] || "pt-BR", { month: "long", year: "numeric" })
            .format(new Date(Number(p.chave.slice(0, 4)), Number(p.chave.slice(5, 7)) - 1, 1))
        + ", entradas " + formatarMoeda(p.receitas) + ", despesas " + formatarMoeda(p.despesas)
    ).join("; "));
}

function renderGraficoCategorias() {
    const rosquinha = $("grafico-rosca");
    const legenda = $("legenda-grafico-categorias");
    if (!rosquinha || !legenda) return;

    const totaisCentavos = {};
    obterMes().despesas.forEach((despesa) => {
        const valor = Math.round(numero(despesa.valor) * 100);
        if (valor > 0) totaisCentavos[despesa.categoria] = (totaisCentavos[despesa.categoria] || 0) + valor;
    });
    const itens = Object.entries(totaisCentavos).map(([nome, centavos]) => [nome, centavos / 100]).sort((a, b) => b[1] - a[1]);
    const total = itens.reduce((soma, [, valor]) => soma + Math.round(valor * 100), 0) / 100;
    const rotuloMes = new Intl.DateTimeFormat(LOCALES[idiomaAtual] || "pt-BR", {
        month: "long",
        year: "numeric"
    }).format(new Date(periodo.ano, periodo.mes - 1, 1));
    $("periodo-grafico-categorias").textContent = rotuloMes;
    $("total-grafico-categorias").textContent = formatarMoeda(total);
    $("vazio-grafico-categorias").hidden = itens.length > 0;

    if (total > 0) {
        let angulo = 0;
        const segmentos = itens.map(([nome, valor], indice) => {
            const inicio = angulo;
            angulo += indice === itens.length - 1 ? 360 - angulo : (valor / total) * 360;
            return corDaCategoria(nome) + " " + inicio + "deg " + angulo + "deg";
        });
        rosquinha.style.background = "conic-gradient(" + segmentos.join(", ") + ")";
    } else {
        rosquinha.style.background = "conic-gradient(var(--borda) 0deg 360deg)";
    }

    legenda.replaceChildren(...itens.map(([nome, valor]) => {
        const percentual = (valor / total) * 100;
        const cor = criarEl("span", { class: "grafico-categoria-cor", "aria-hidden": "true" });
        cor.style.background = corDaCategoria(nome);
        return criarEl("li", { class: "grafico-categoria-item" }, [
            criarEl("span", { class: "grafico-categoria-nome" }, [cor, criarEl("span", { text: nome })]),
            criarEl("strong", { class: "grafico-categoria-valor", text: formatarMoeda(valor) }),
            criarEl("small", { class: "grafico-categoria-percentual", text: formatarPercentual(percentual) })
        ]);
    }));

    rosquinha.setAttribute("aria-label", itens.length
        ? "Despesas por categoria em " + rotuloMes + ". Total " + formatarMoeda(total) + ". " + itens.map(([nome, valor]) =>
            nome + ": " + formatarMoeda(valor) + ", " + formatarPercentual((valor / total) * 100)
        ).join("; ")
        : "Nenhuma despesa com valor registrado em " + rotuloMes + ".");
}

function renderTudo(persistir = true) {

    renderTema();
    aplicarPrivacidade();
    aplicarPreferenciasVisuais();

    renderPeriodo();

    renderReceitas();

    renderDespesas();

    atualizarResumo(persistir);

}



/* ---------- Remover com desfazer ---------- */



let ultimaRemocao = null; // o que foi removido por último, para o botão "Desfazer"



// selecao: lista de { chave, item } (chave = "AAAA-MM") de uma mesma lista

// ("receitas" ou "despesas").

function removerSelecao(lista, selecao, mensagem) {



    ultimaRemocao = selecao.map(({ chave, item }) => ({

        chave,

        lista,

        item,

        indice: estado.meses[chave][lista].indexOf(item)

    }));



    selecao.forEach(({ chave }) => {

        const mes = estado.meses[chave];

        const apagar = new Set(selecao.filter((s) => s.chave === chave).map((s) => s.item));

        mes[lista] = mes[lista].filter((x) => !apagar.has(x));

    });



    renderReceitas();

    renderDespesas();

    atualizarResumo();



    avisar(mensagem, { rotulo: "Desfazer", executar: desfazerRemocao });

}



function desfazerRemocao() {



    if (!ultimaRemocao) return;



    // do menor índice para o maior, para cada item voltar à posição original

    [...ultimaRemocao]

        .sort((a, b) => a.indice - b.indice)

        .forEach(({ chave, lista, item, indice }) => {



            if (!estado.meses[chave]) {

                estado.meses[chave] = { receitas: [], despesas: [] };

            }



            const destino = estado.meses[chave][lista];

            destino.splice(Math.min(indice, destino.length), 0, item);

        });



    ultimaRemocao = null;



    renderReceitas();

    renderDespesas();

    atualizarResumo();



    avisar("Exclusão desfeita.");

}



/* ---------- Receitas ---------- */



let receitaEmEdicao = null; // id da receita aberta no diálogo (null = nova)



function abrirDialogoReceita(id) {



    const receita = id

        ? obterMes().receitas.find((r) => r.id === id)

        : null;



    if (id && !receita) return;



    receitaEmEdicao = receita ? receita.id : null;



    ui.tituloDialogoReceita.textContent = receita ? "Editar entrada" : "Adicionar entrada";



    ui.receitaNome.value = receita ? receita.nome : "";

    ui.receitaValor.value = receita && receita.valor ? String(receita.valor) : "";



    ui.dialogoReceita.showModal();

    ui.receitaNome.focus();

}



function salvarReceita() {



    const nome = ui.receitaNome.value.trim();



    if (!nome) {

        avisar("Digite o nome da entrada.");

        ui.receitaNome.focus();

        return;

    }



    const valorDigitado = ui.receitaValor.value.trim();
    const valor = Math.round(Number(valorDigitado) * 100) / 100;

    if (!valorDigitado || !Number.isFinite(valor) || valor <= 0) {
        avisar("Informe um valor maior que zero para a entrada.");
        ui.receitaValor.focus();
        return;
    }

    const dados = { nome, valor };

    if (receitaEmEdicao) {



        const receita = obterMes().receitas.find((r) => r.id === receitaEmEdicao);



        if (receita) Object.assign(receita, dados);



        avisar("Entrada atualizada.");



    } else {



        obterMes().receitas.push({ id: uid(), ...dados });



        avisar("Entrada adicionada.");

    }



    ui.dialogoReceita.close();



    renderReceitas();

    atualizarResumo();

}



ui.adicionarReceita.addEventListener("click", () => abrirDialogoReceita(null));

document.querySelectorAll(".bloco-retrair").forEach((botao) => {
    botao.addEventListener("click", () => {
        const expandido = botao.getAttribute("aria-expanded") === "true";
        const conteudo = document.getElementById(botao.getAttribute("aria-controls"));
        if (!conteudo) return;
        botao.setAttribute("aria-expanded", String(!expandido));
        const titulo = botao.closest(".bloco-topo, .orcamento-resumo-topo")
            .querySelector("h2, h3").textContent.trim().toLowerCase();
        botao.setAttribute("aria-label", (expandido ? "Expandir " : "Recolher ") + titulo);
        conteudo.hidden = expandido;
        if (botao.dataset.registraTela) registrarUltimaTela(botao.dataset.registraTela);
    });
});



ui.formReceita.addEventListener("submit", (evento) => {

    evento.preventDefault();

    salvarReceita();

});



ui.fecharReceita.addEventListener("click", () => ui.dialogoReceita.close());

ui.cancelarReceita.addEventListener("click", () => ui.dialogoReceita.close());



ui.dialogoReceita.addEventListener("click", (evento) => {

    // clique no fundo escurecido fecha o diálogo

    if (evento.target === ui.dialogoReceita) ui.dialogoReceita.close();

});



ui.listaReceitas.addEventListener("click", (evento) => {



    const editar = evento.target.closest(".editar-receita");



    if (editar) {

        abrirDialogoReceita(editar.closest(".receita").dataset.id);

        return;

    }



    const remover = evento.target.closest(".remover-receita");



    if (!remover) return;



    const id = remover.closest(".receita").dataset.id;

    const receita = obterMes().receitas.find((r) => r.id === id);



    if (!receita) return;



    removerSelecao(

        "receitas",

        [{ chave: chaveMes(periodo.ano, periodo.mes), item: receita }],

        "Entrada removida."

    );

});



/* ---------- Despesas ---------- */



const MAX_PARCELAS = 60;

const MESES_DA_FIXA = 12; // meses lançados de uma vez ao criar uma despesa fixa



let despesaEmEdicao = null; // id da despesa aberta no diálogo (null = nova)

let despesaParaRemover = null; // despesa fixa/parcelada aguardando a escolha do usuário



// Devolve a chave "AAAA-MM" do período atual deslocado em n meses

// (ou null se sair do intervalo de anos aceito).

function chaveDepois(n) {



    const indice = periodo.ano * 12 + (periodo.mes - 1) + n;

    const ano = Math.floor(indice / 12);

    const mes = (indice % 12) + 1;



    return ano > 2100 ? null : chaveMes(ano, mes);

}



function chaveAtual() {

    return chaveMes(periodo.ano, periodo.mes);

}



// Todas as despesas de uma série (fixa ou parcelada), em ordem de mês.

function itensDaSerie(serie) {



    const itens = [];



    Object.entries(estado.meses).forEach(([chave, mes]) => {

        mes.despesas.forEach((item) => {

            if (item.serie === serie) itens.push({ chave, item });

        });

    });



    return itens.sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));

}



function proximosDaSerie(despesa) {

    return itensDaSerie(despesa.serie).filter(({ chave }) => chave > chaveAtual());

}



function mesDaChave(chave) {

    if (!estado.meses[chave]) {

        estado.meses[chave] = { receitas: [], despesas: [] };

    }

    return estado.meses[chave];

}



function atualizarCamposDoTipo(novo) {



    const tipo = ui.despesaTipo.value;



    ui.campoParcelas.hidden = !(novo && tipo === "parcelada");



    ui.dicaTipo.textContent = tipo === "fixa"

        ? "Entra neste mês e nos " + (MESES_DA_FIXA - 1) + " seguintes."

        : "";

}



function abrirDialogoDespesa(id) {



    const despesa = id

        ? obterMes().despesas.find((d) => d.id === id)

        : null;



    if (id && !despesa) return;



    despesaEmEdicao = despesa ? despesa.id : null;



    const categorias = despesa && !estado.categorias.includes(despesa.categoria)

        ? [...estado.categorias, despesa.categoria]

        : estado.categorias;



    ui.despesaCategoria.replaceChildren(

        ...categorias.map((c) => criarEl("option", { value: c, text: c }))

    );



    ui.tituloDialogoDespesa.textContent = despesa ? "Editar despesa" : "Adicionar despesa";



    ui.despesaNome.value = despesa ? despesa.nome : "";

    ui.despesaCategoria.value = despesa ? despesa.categoria : CATEGORIA_FIXA;

    ui.despesaValor.value = despesa && despesa.valor ? String(despesa.valor) : "";

    ui.despesaPago.checked = despesa ? despesa.pago : false;



    // Repetição só pode ser escolhida ao criar a despesa

    ui.campoTipo.hidden = Boolean(despesa);

    ui.despesaTipo.value = "unica";

    ui.despesaParcelas.value = "2";

    atualizarCamposDoTipo(!despesa);



    // Ao editar fixa/parcelada, permite levar a mudança para os próximos meses

    const futuros = despesa && despesa.serie ? proximosDaSerie(despesa).length : 0;



    ui.campoPropagar.hidden = futuros === 0;

    ui.despesaPropagar.checked = false;

    ui.textoPropagar.textContent = futuros === 1

        ? "Aplicar nome, categoria e valor também à próxima"

        : "Aplicar nome, categoria e valor também às " + futuros + " próximas";



    ui.dialogoDespesa.showModal();

    ui.despesaNome.focus();

}



function criarSerieDeDespesas(base, tipo, totalParcelas) {



    const serie = uid();

    const quantidade = tipo === "fixa" ? MESES_DA_FIXA : totalParcelas;

    let criadas = 0;



    for (let i = 0; i < quantidade; i++) {



        const chave = chaveDepois(i);



        if (!chave) break;



        mesDaChave(chave).despesas.push({

            id: uid(),

            ...base,

            pago: i === 0 ? base.pago : false,

            fixa: tipo === "fixa",

            serie,

            parcela: tipo === "parcelada" ? { atual: i + 1, total: totalParcelas } : null

        });



        criadas++;

    }



    return criadas;

}



function salvarDespesa() {



    const nome = ui.despesaNome.value.trim();



    if (!nome) {

        avisar("Digite o nome da despesa.");

        ui.despesaNome.focus();

        return;

    }



    const valorDigitado = ui.despesaValor.value.trim();
    const valor = Math.round(Number(valorDigitado) * 100) / 100;

    if (!valorDigitado || !Number.isFinite(valor) || valor <= 0) {
        avisar("Informe um valor maior que zero para a despesa.");
        ui.despesaValor.focus();
        return;
    }

    const dados = {
        nome,
        categoria: ui.despesaCategoria.value || CATEGORIA_FIXA,
        valor,
        pago: ui.despesaPago.checked
    };

    if (despesaEmEdicao) {



        const despesa = obterMes().despesas.find((d) => d.id === despesaEmEdicao);

        let mensagem = "Despesa atualizada.";



        if (despesa) {



            Object.assign(despesa, dados);



            if (!ui.campoPropagar.hidden && ui.despesaPropagar.checked) {



                const proximos = proximosDaSerie(despesa);



                proximos.forEach(({ item }) => {

                    item.nome = dados.nome;

                    item.categoria = dados.categoria;

                    item.valor = dados.valor;

                });



                mensagem = "Despesa atualizada, inclusive nas " + proximos.length + " seguintes.";

            }

        }



        avisar(mensagem);



    } else {



        const tipo = ui.despesaTipo.value;



        if (tipo === "unica") {



            obterMes().despesas.push({

                id: uid(),

                ...dados,

                fixa: false,

                serie: null,

                parcela: null

            });



            avisar("Despesa adicionada.");



        } else {



            let parcelas = 0;



            if (tipo === "parcelada") {



                parcelas = Math.round(numero(ui.despesaParcelas.value));



                if (parcelas < 2 || parcelas > MAX_PARCELAS) {

                    avisar("Informe de 2 a " + MAX_PARCELAS + " parcelas.");

                    ui.despesaParcelas.focus();

                    return;

                }

            }



            const criadas = criarSerieDeDespesas(dados, tipo, parcelas);



            avisar(tipo === "fixa"

                ? "Despesa fixa lançada em " + criadas + " meses."

                : "Parcelas lançadas: " + criadas + " de " + parcelas + ".");

        }

    }



    ui.dialogoDespesa.close();



    renderDespesas();

    atualizarResumo();

}



function nomeParaMensagem(despesa) {

    return despesa.nome.trim() || "Sem nome";

}



function pedirEscolhaDaSerie(despesa, futuros) {



    despesaParaRemover = despesa;



    const nome = "“" + nomeParaMensagem(despesa) + "”";

    const plural = futuros === 1 ? "" : "s";



    if (despesa.parcela) {

        ui.textoSerie.textContent = nome + " é a parcela " + despesa.parcela.atual + "/"

            + despesa.parcela.total + ". Há mais " + futuros + " parcela" + plural

            + " nos meses seguintes.";

    } else {

        ui.textoSerie.textContent = nome + " é uma despesa fixa e também está lançada em "

            + futuros + (futuros === 1 ? " mês seguinte." : " meses seguintes.");

    }



    ui.dialogoSerie.showModal();

}



ui.adicionarDespesa.addEventListener("click", () => abrirDialogoDespesa(null));



ui.despesaTipo.addEventListener("change", () => atualizarCamposDoTipo(true));



ui.formDespesa.addEventListener("submit", (evento) => {

    evento.preventDefault();

    salvarDespesa();

});



ui.fecharDespesa.addEventListener("click", () => ui.dialogoDespesa.close());

ui.cancelarDespesa.addEventListener("click", () => ui.dialogoDespesa.close());



ui.dialogoDespesa.addEventListener("click", (evento) => {

    // clique no fundo escurecido fecha o diálogo

    if (evento.target === ui.dialogoDespesa) ui.dialogoDespesa.close();

});



ui.listaDespesas.addEventListener("change", (evento) => {



    const alvo = evento.target;



    if (!alvo.classList.contains("pago-despesa")) return;



    const linha = alvo.closest(".despesa");

    const despesa = obterMes().despesas.find((d) => d.id === linha.dataset.id);



    if (!despesa) return;



    despesa.pago = alvo.checked;



    renderDespesas();

    atualizarResumo();



    // mantém o foco no mesmo item depois de redesenhar a lista

    const novaLinha = ui.listaDespesas.querySelector('.despesa[data-id="' + despesa.id + '"] .pago-despesa');

    if (novaLinha) novaLinha.focus();

});



ui.listaDespesas.addEventListener("click", (evento) => {



    const editar = evento.target.closest(".editar-despesa");



    if (editar) {

        abrirDialogoDespesa(editar.closest(".despesa").dataset.id);

        return;

    }



    const remover = evento.target.closest(".remover-despesa");



    if (!remover) return;



    const id = remover.closest(".despesa").dataset.id;

    const despesa = obterMes().despesas.find((d) => d.id === id);



    if (!despesa) return;



    const futuros = despesa.serie ? proximosDaSerie(despesa).length : 0;



    if (futuros > 0) {

        pedirEscolhaDaSerie(despesa, futuros);

        return;

    }



    removerSelecao("despesas", [{ chave: chaveAtual(), item: despesa }], "Despesa removida.");

});



ui.serieCancelar.addEventListener("click", () => ui.dialogoSerie.close());



ui.dialogoSerie.addEventListener("click", (evento) => {

    if (evento.target === ui.dialogoSerie) ui.dialogoSerie.close();

});



ui.serieSoEste.addEventListener("click", () => {



    const despesa = despesaParaRemover;



    ui.dialogoSerie.close();



    if (despesa) {

        removerSelecao("despesas", [{ chave: chaveAtual(), item: despesa }], "Despesa removida.");

    }

});



ui.serieProximos.addEventListener("click", () => {



    const despesa = despesaParaRemover;



    ui.dialogoSerie.close();



    if (!despesa) return;



    const selecao = itensDaSerie(despesa.serie).filter(({ chave }) => chave >= chaveAtual());



    removerSelecao(

        "despesas",

        selecao,

        selecao.length + " despesas removidas."

    );

});



/* ---------- Categorias ---------- */



function renderListaCategorias() {



    ui.listaCategorias.replaceChildren(...estado.categorias.map((nome) => {



        const item = criarEl("li", {}, [

            criarEl("span", { class: "nome", text: nome })

        ]);



        if (nome === CATEGORIA_FIXA) {

            item.append(criarEl("span", { class: "nota", text: "padrão" }));

            return item;

        }



        item.append(

            criarEl("button", {

                type: "button",

                class: "btn btn-secundario",

                dataset: { acao: "renomear", nome },

                text: "Renomear"

            }),

            criarEl("button", {

                type: "button",

                class: "btn btn-perigo",

                dataset: { acao: "remover", nome },

                text: "Remover"

            })

        );



        return item;

    }));

}



function aposMudarCategorias() {
    renderDespesas();
    atualizarResumo();
    if (!ui.painelCategoriasOrcamento.hidden) renderListaCategorias();
    if (!ui.painelLimitesOrcamento.hidden) renderListaOrcamentos();
}



function adicionarCategoria() {



    const nome = ui.novaCategoria.value.trim();



    if (!nome) {

        avisar("Digite o nome da categoria.");

        return;

    }



    const existe = estado.categorias

        .some((c) => c.toLowerCase() === nome.toLowerCase());



    if (existe) {

        avisar("Essa categoria já existe.");

        return;

    }



    estado.categorias.push(nome);

    ui.novaCategoria.value = "";



    aposMudarCategorias();

    avisar("Categoria adicionada.");

}



function renomearCategoria(antigo) {



    const entrada = prompt("Novo nome para a categoria “" + antigo + "”:", antigo);



    if (entrada === null) return;



    const novo = entrada.trim();



    if (!novo || novo === antigo) return;



    const existe = estado.categorias

        .some((c) => c !== antigo && c.toLowerCase() === novo.toLowerCase());



    if (existe) {

        avisar("Já existe uma categoria com esse nome.");

        return;

    }



    estado.categorias = estado.categorias.map((c) => (c === antigo ? novo : c));
    estado.orcamentos = renomearCategoriaOrcamentos(estado.orcamentos, antigo, novo);



    Object.values(estado.meses).forEach((mes) => {

        mes.despesas.forEach((d) => {

            if (d.categoria === antigo) d.categoria = novo;

        });

    });



    aposMudarCategorias();

    avisar("Categoria renomeada.");

}



function removerCategoria(nome) {



    const emUso = Object.values(estado.meses)

        .reduce((soma, mes) => soma + mes.despesas.filter((d) => d.categoria === nome).length, 0);



    const aviso = emUso

        ? "Remover “" + nome + "”? As " + emUso + " despesa(s) dessa categoria passarão para “" + CATEGORIA_FIXA + "”."

        : "Remover a categoria “" + nome + "”?";



    if (!confirm(aviso)) return;



    estado.categorias = estado.categorias.filter((c) => c !== nome);
    estado.orcamentos = removerCategoriaOrcamentos(estado.orcamentos, nome);



    Object.values(estado.meses).forEach((mes) => {

        mes.despesas.forEach((d) => {

            if (d.categoria === nome) d.categoria = CATEGORIA_FIXA;

        });

    });



    aposMudarCategorias();

    avisar("Categoria removida.");

}



function mostrarPainelOrcamentos(painel) {
    ui.opcoesOrcamentos.hidden = painel !== "opcoes";
    ui.painelCategoriasOrcamento.hidden = painel !== "categorias";
    ui.painelLimitesOrcamento.hidden = painel !== "limites";
}

ui.gerenciarOrcamentos.addEventListener("click", () => {
    mostrarPainelOrcamentos("opcoes");
    ui.dialogoOrcamentos.showModal();
    ui.abrirCategoriasOrcamento.focus();
});
ui.abrirCategoriasOrcamento.addEventListener("click", () => {
    renderListaCategorias();
    mostrarPainelOrcamentos("categorias");
    ui.novaCategoria.focus();
});
ui.abrirLimitesOrcamento.addEventListener("click", () => {
    renderListaOrcamentos();
    mostrarPainelOrcamentos("limites");
    ui.listaOrcamentos.querySelector("[data-orcamento-campo]")?.focus();
});
ui.fecharOrcamentos.addEventListener("click", () => ui.dialogoOrcamentos.close());
ui.dialogoOrcamentos.addEventListener("click", (evento) => {
    if (evento.target === ui.dialogoOrcamentos) ui.dialogoOrcamentos.close();
    if (evento.target.closest("[data-orcamento-voltar]")) {
        mostrarPainelOrcamentos("opcoes");
        ui.abrirCategoriasOrcamento.focus();
    }
});
ui.listaOrcamentos.addEventListener("click", (evento) => {
    const botao = evento.target.closest("[data-orcamento-acao]");
    if (!botao) return;
    const linha = botao.closest(".orcamento-edicao");
    const categoria = linha.dataset.categoria;
    const acao = botao.dataset.orcamentoAcao;

    if (acao === "salvar-padrao") {
        const limite = lerLimiteOrcamento(linha.querySelector('[data-orcamento-campo="padrao"]'));
        if (limite === null) return;
        definirLimiteOrcamento(estado.orcamentos.padrao, categoria, limite);
        atualizarOrcamentos();
        avisar("Limite mensal salvo.");
        return;
    }

    if (acao === "remover-padrao") {
        delete estado.orcamentos.padrao[categoria];
        atualizarOrcamentos();
        avisar("Limite mensal removido.");
    }
});



ui.adicionarCategoria.addEventListener("click", adicionarCategoria);



ui.novaCategoria.addEventListener("keydown", (evento) => {

    if (evento.key === "Enter") {

        evento.preventDefault();

        adicionarCategoria();

    }

});



ui.listaCategorias.addEventListener("click", (evento) => {



    const botao = evento.target.closest("button[data-acao]");

    if (!botao) return;



    const { acao, nome } = botao.dataset;



    if (acao === "renomear") renomearCategoria(nome);

    if (acao === "remover") removerCategoria(nome);

});



/* ---------- Navegação entre meses ---------- */

/* Gesto horizontal: esquerda avança um mês; direita volta um mês. */
const areaDeConteudo = document.querySelector("main.container");
let toqueInicial = null;

areaDeConteudo.addEventListener("touchstart", (evento) => {
    if (document.querySelector("dialog[open]")) { toqueInicial = null; return; }
    if (evento.touches.length !== 1) { toqueInicial = null; return; }
    if (evento.target.closest("button, select, input, textarea, a, [contenteditable=\"true\"]")) {
        toqueInicial = null;
        return;
    }
    toqueInicial = { x: evento.touches[0].clientX, y: evento.touches[0].clientY };
}, { passive: true });

areaDeConteudo.addEventListener("touchend", (evento) => {
    if (!toqueInicial || evento.changedTouches.length !== 1) return;
    if (document.querySelector("dialog[open]")) { toqueInicial = null; return; }
    const dx = evento.changedTouches[0].clientX - toqueInicial.x;
    const dy = evento.changedTouches[0].clientY - toqueInicial.y;
    toqueInicial = null;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    mudarPeriodo(periodo.ano, periodo.mes + (dx < 0 ? 1 : -1));
}, { passive: true });



ui.mes.addEventListener("change", () => {

    mudarPeriodo(periodo.ano, Number(ui.mes.value));

});



ui.ano.addEventListener("change", () => {



    const ano = Math.round(numero(ui.ano.value));



    if (ano < 2000 || ano > 2100) {

        ui.ano.value = String(periodo.ano);

        avisar("Informe um ano entre 2000 e 2100.");

        return;

    }



    mudarPeriodo(ano, periodo.mes);

});



ui.mesAnterior.addEventListener("click", () => {

    mudarPeriodo(periodo.ano, periodo.mes - 1);

});



ui.mesProximo.addEventListener("click", () => {

    mudarPeriodo(periodo.ano, periodo.mes + 1);

});



ui.hoje.addEventListener("click", () => {

    const hoje = new Date();

    mudarPeriodo(hoje.getFullYear(), hoje.getMonth() + 1);

});



/* ---------- Ferramentas ---------- */



function copiarDoMesAnterior() {



    let ano = periodo.ano;

    let mes = periodo.mes - 1;



    if (mes < 1) {

        mes = 12;

        ano -= 1;

    }



    const origem = estado.meses[chaveMes(ano, mes)];



    if (!origem || (!origem.receitas.length && !origem.despesas.length)) {

        avisar("O mês anterior (" + nomeMes(mes) + ") não tem dados para copiar.");

        return;

    }



    const destino = obterMes();



    if ((destino.receitas.length || destino.despesas.length)

        && !confirm("Este mês já tem lançamentos. Adicionar os de " + nomeMes(mes) + " junto com eles?")) {

        return;

    }



    origem.receitas.forEach((r) => destino.receitas.push({ ...r, id: uid() }));

    origem.despesas.forEach((d) => {



        // parcelas já foram lançadas nos meses certos; fixas só entram se ainda não existirem aqui

        if (d.parcela) return;

        if (d.serie && destino.despesas.some((x) => x.serie === d.serie)) return;



        destino.despesas.push({ ...d, id: uid(), pago: false });

    });



    renderReceitas();

    renderDespesas();

    atualizarResumo();

    avisar("Lançamentos copiados de " + nomeMes(mes) + ".");

}



function limparMes() {



    const mes = obterMes();



    if (!mes.receitas.length && !mes.despesas.length) {

        avisar("Este mês já está vazio.");

        return;

    }



    if (!confirm("Apagar todas as entradas e despesas de " + nomeMes(periodo.mes) + " de " + periodo.ano + "? Essa ação não pode ser desfeita.")) {

        return;

    }



    mes.receitas = [];

    mes.despesas = [];



    renderReceitas();

    renderDespesas();

    atualizarResumo();

    avisar("Mês limpo.");

}



function baixarArquivo(conteudo, nome, tipo) {



    const blob = new Blob([conteudo], { type: tipo });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");



    link.href = url;

    link.download = nome;

    document.body.append(link);

    link.click();

    link.remove();



    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;

}



function exportarCsv() {
    const escopo = ui.escopoCsv.value;
    if (escopo === "mes") obterMes();
    const csv = gerarCsv(estado, { ano: periodo.ano, mes: periodo.mes, escopo });
    if (!csv) {
        avisar("Não há lançamentos neste período para exportar.");
        return;
    }
    baixarArquivo(csv,
        "controle-financeiro-" + (escopo === "todos" ? "completo" : chaveMes(periodo.ano, periodo.mes)) + ".csv",
        "text/csv;charset=utf-8");
    avisar("Arquivo CSV gerado.");
}



function exportarBackup() {



    const agoraLocal = new Date();
    const hoje = [agoraLocal.getFullYear(), String(agoraLocal.getMonth() + 1).padStart(2, "0"), String(agoraLocal.getDate()).padStart(2, "0")].join("-");



    baixarArquivo(

        JSON.stringify(estadoParaSalvar(), null, 2),

        "controle-financeiro-backup-" + hoje + ".json",

        "application/json"

    );

    registrarOperacaoDados("Backup JSON gerado em " + new Date().toLocaleString("pt-BR") + ".");
    avisar("Backup salvo.");

}



function importarBackup(arquivo) {



    if (!arquivo) return;



    const leitor = new FileReader();



    leitor.onload = () => {



        let novo;



        try {

            const bruto = JSON.parse(String(leitor.result));



            if (!validarBackup(bruto)) throw new Error("estrutura do backup inválida");

            novo = normalizarEstado(bruto);

        } catch (erro) {

            avisar("Arquivo inválido. Escolha um backup gerado por este aplicativo.");

            return;

        }



        if (!confirm("Restaurar o backup? Todos os dados atuais serão substituídos.")) {

            return;

        }



        novo.tema = novo.tema || estado.tema;

        estado = novo;

        ultimaRemocao = null;



        renderTudo();

        registrarOperacaoDados("Backup restaurado em " + new Date().toLocaleString("pt-BR") + ".");
        avisar("Backup restaurado.");

    };



    leitor.onerror = () => avisar("Não foi possível ler o arquivo.");



    leitor.readAsText(arquivo);

}



ui.copiarMesAnterior.addEventListener("click", copiarDoMesAnterior);

ui.limparMes.addEventListener("click", limparMes);

ui.exportarCsv.addEventListener("click", exportarCsv);

ui.exportarBackup.addEventListener("click", exportarBackup);



ui.importarBackup.addEventListener("click", () => ui.arquivoBackup.click());



ui.arquivoBackup.addEventListener("change", () => {

    importarBackup(ui.arquivoBackup.files[0]);

    ui.arquivoBackup.value = "";

});



/* ---------- Tema ---------- */

const CHAVE_PREFERENCIAS_MENU = "controleFinanceiro:preferencias-menu";
let preferenciasMenu = normalizarPreferenciasMenu(null);
let rastreamentoTelaAtivo = false;
let versaoInstalada = "Consultando…";
let estadoServiceWorker = "Estado do Service Worker ainda não consultado.";
let verificacaoAtualizacaoAtiva = false;
try {
    preferenciasMenu = normalizarPreferenciasMenu(storage.lerJson(CHAVE_PREFERENCIAS_MENU));
} catch (_) { /* usa os padrões */ }
if (preferenciasMenu.referenciaMes === "ultimo" && preferenciasMenu.ultimoPeriodo) {
    const [anoSalvo, mesSalvo] = preferenciasMenu.ultimoPeriodo.split("-").map(Number);
    periodo = { ano: anoSalvo, mes: mesSalvo };
}
valoresOcultos = preferenciasMenu.ocultarAoIniciar;
function salvarPreferenciasMenu() {
    if (!storage.escreverJson(CHAVE_PREFERENCIAS_MENU, preferenciasMenu)) avisarArmazenamentoTemporario();
    atualizarDiagnostico();
}
function registrarOperacaoDados(texto) {
    preferenciasMenu.ultimaOperacao = texto;
    salvarPreferenciasMenu();
    atualizarDiagnostico();
}
function atualizarDiagnostico() {
    if (!ui.diagnosticoDados) return;
    const despesas = Object.values(estado.meses).reduce((n, mes) => n + mes.despesas.length, 0);
    const receitas = Object.values(estado.meses).reduce((n, mes) => n + mes.receitas.length, 0);
    const categorias = estado.categorias.length;
    const armazenamento = storage.persistente
        ? "Armazenamento persistente disponível."
        : "Armazenamento em memória: os dados podem se perder ao recarregar ou fechar o app.";
    ui.diagnosticoDados.textContent = `${receitas + despesas} lançamentos (${receitas} receitas, ${despesas} despesas) · ${categorias} categorias · ${armazenamento}`;
    ui.ultimaOperacaoDados.textContent = preferenciasMenu.ultimaOperacao;
    ui.versaoInstalada.textContent = versaoInstalada;
    ui.versaoPublicada.textContent = preferenciasMenu.versaoPublicada;
    ui.dataVerificacaoAtualizacao.textContent = preferenciasMenu.ultimaVerificacao;
    ui.resultadoVerificacaoAtualizacao.textContent = preferenciasMenu.resultadoVerificacao;
    ui.diagnosticoApp.textContent = `${estadoServiceWorker} Armazenamento: ${storage.persistente ? "persistente disponível." : "somente memória; os dados podem se perder ao recarregar ou fechar o app."}`;
}

async function atualizarEstadoServiceWorker() {
    if (!("serviceWorker" in navigator)) {
        estadoServiceWorker = "Service Worker não é suportado neste navegador.";
        atualizarDiagnostico();
        return null;
    }
    try {
        const escopo = new URL("./", import.meta.url).href;
        const registro = await navigator.serviceWorker.getRegistration(escopo);
        if (!registro) estadoServiceWorker = "Service Worker ainda não registrado.";
        else if (registro.waiting) estadoServiceWorker = "Nova instalação do Service Worker aguardando confirmação.";
        else if (registro.installing) estadoServiceWorker = `Service Worker instalando (${registro.installing.state}).`;
        else if (registro.active) estadoServiceWorker = `Service Worker ativo (${registro.active.state}); ${navigator.serviceWorker.controller ? "controlando esta página." : "a página ainda não está sob controle."}`;
        else estadoServiceWorker = "Registro do Service Worker sem worker ativo.";
        atualizarDiagnostico();
        return registro;
    } catch (erro) {
        estadoServiceWorker = `Não foi possível consultar o Service Worker: ${erro.message || "erro desconhecido"}.`;
        atualizarDiagnostico();
        throw erro;
    }
}

async function carregarVersaoInstalada() {
    try {
        const metadados = await lerVersaoInstalada();
        versaoInstalada = metadados.version;
        atualizarDiagnostico();
    } catch (erro) {
        versaoInstalada = "Indisponível";
        ui.statusAtualizacao.textContent = `Não foi possível carregar os metadados da versão instalada: ${erro.message || "erro desconhecido"}.`;
        atualizarDiagnostico();
    }
}

function registrarResultadoVerificacao(resultado, versaoPublicada = preferenciasMenu.versaoPublicada) {
    preferenciasMenu.ultimaVerificacao = new Date().toLocaleString("pt-BR");
    preferenciasMenu.resultadoVerificacao = resultado;
    preferenciasMenu.versaoPublicada = versaoPublicada;
    salvarPreferenciasMenu();
}
function aplicarPrivacidade() {
    document.body.classList.toggle("valores-ocultos", valoresOcultos);
    document.querySelector(".resumo").classList.toggle("valores-ocultos", valoresOcultos);
    [
        ui.receitaValor,
        ui.despesaValor,
        ...ui.dialogoOrcamentos.querySelectorAll(".orcamento-campo input")
    ].forEach((campo) => {
        const valorAtual = campo.value;
        campo.type = valoresOcultos ? "password" : "number";
        campo.inputMode = "decimal";
        campo.value = valorAtual;
    });
    ui.alternarVisibilidadeResumo.setAttribute("aria-pressed", String(valoresOcultos));
    const rotulo = valoresOcultos ? "Mostrar valores" : "Ocultar valores";
    ui.alternarVisibilidadeResumo.setAttribute("aria-label", rotulo + " do resumo");
    ui.alternarVisibilidadeResumo.title = rotulo + " do resumo";
    ui.alternarValores.textContent = rotulo + " financeiros";
    ui.alternarValores.setAttribute("aria-pressed", String(valoresOcultos));
}
function aplicarPreferenciasVisuais() {
    document.body.dataset.densidade = preferenciasMenu.densidade;
    document.body.classList.toggle("graficos-ocultos", !preferenciasMenu.mostrarGraficos);
}
function aplicarVisibilidadeSecoes() {
    $("secao-planejamento").hidden = !preferenciasMenu.mostrarPlanejamento;
    $("secao-despesas").hidden = !preferenciasMenu.mostrarDespesas;
    $("secao-entradas").hidden = !preferenciasMenu.mostrarEntradas;
}
function abrirSecaoInicial() {
    const telaSolicitada = resolverTelaInicial(preferenciasMenu);
    const lancamentosVisiveis = preferenciasMenu.mostrarDespesas || preferenciasMenu.mostrarEntradas;
    const tela = telaSolicitada === "lancamentos" && !lancamentosVisiveis ? "resumo" : telaSolicitada;
    const alvos = {
        resumo: document.querySelector(".resumo"),
        lancamentos: document.querySelector(preferenciasMenu.mostrarDespesas ? "#titulo-despesas" : "#titulo-receitas")?.closest(".bloco"),
        graficos: document.querySelector(".grafico-bloco")
    };
    if (tela === "lancamentos") {
        const tiposVisiveis = [
            ...(preferenciasMenu.mostrarDespesas ? ["despesas"] : []),
            ...(preferenciasMenu.mostrarEntradas ? ["receitas"] : [])
        ];
        tiposVisiveis.forEach((tipo) => {
            const botao = document.querySelector(`[aria-controls="conteudo-${tipo}"]`);
            if (botao?.getAttribute("aria-expanded") !== "true") botao?.click();
        });
    }
    requestAnimationFrame(() => alvos[tela]?.scrollIntoView({ block: "start" }));
    return tela;
}
function registrarUltimaTela(tela) {
    if (!rastreamentoTelaAtivo || !["resumo", "lancamentos", "graficos"].includes(tela)
        || preferenciasMenu.ultimaTelaUtilizada === tela) return;
    preferenciasMenu.ultimaTelaUtilizada = tela;
    salvarPreferenciasMenu();
}
function detectarTelaVisivel() {
    const secoes = [
        [document.querySelector(".resumo"), "resumo"],
        [document.querySelector(".grafico-bloco"), "graficos"],
        [document.querySelector("#titulo-despesas")?.closest(".bloco"), "lancamentos"],
        [document.querySelector("#titulo-receitas")?.closest(".bloco"), "lancamentos"]
    ];
    const referencia = window.innerHeight * 0.2;
    const visivel = secoes
        .filter(([secao]) => secao && secao.getClientRects().length)
        .map(([secao, tela]) => [Math.abs(secao.getBoundingClientRect().top - referencia), tela])
        .sort(([distanciaA], [distanciaB]) => distanciaA - distanciaB)[0];
    if (visivel) registrarUltimaTela(visivel[1]);
}
function aplicarPreferenciasMenu() {
    idiomaAtual = preferenciasMenu.idioma;
    ui.idiomaInterface.value = preferenciasMenu.idioma;
    ui.moedaInterface.value = preferenciasMenu.moeda;
    aplicarIdioma(preferenciasMenu.idioma);
    document.body.dataset.posicaoMenu = preferenciasMenu.posicao;
    document.documentElement.style.setProperty("--menu-transparencia", (100 - preferenciasMenu.transparencia) + "%");
    document.documentElement.style.setProperty("--menu-tamanho", preferenciasMenu.tamanhoBotao + "px");
    ui.posicaoBotaoMenu.value = preferenciasMenu.posicao;
    ui.transparenciaBotaoMenu.value = String(preferenciasMenu.transparencia);
    ui.valorTransparenciaBotao.value = preferenciasMenu.transparencia + "%";
    ui.tamanhoBotaoMenu.value = String(preferenciasMenu.tamanhoBotao);
    ui.valorTamanhoBotaoMenu.value = preferenciasMenu.tamanhoBotao + " px";
    ui.densidadeInterface.value = preferenciasMenu.densidade;
    ui.mostrarGraficos.checked = preferenciasMenu.mostrarGraficos;
    ui.mostrarPlanejamento.checked = preferenciasMenu.mostrarPlanejamento;
    ui.mostrarDespesas.checked = preferenciasMenu.mostrarDespesas;
    ui.mostrarEntradas.checked = preferenciasMenu.mostrarEntradas;
    ui.telaInicial.value = preferenciasMenu.telaInicial;
    ui.referenciaMes.value = preferenciasMenu.referenciaMes;
    ui.ocultarAoIniciar.checked = preferenciasMenu.ocultarAoIniciar;
    ui.escopoCsv.value = preferenciasMenu.escopoCsv;
    aplicarVisibilidadeSecoes();
    if (preferenciasMenu.posicao === "arrastavel" && Number.isFinite(preferenciasMenu.x) && Number.isFinite(preferenciasMenu.y)) {
        ui.abrirAjustes.style.left = preferenciasMenu.x + "px";
        ui.abrirAjustes.style.top = preferenciasMenu.y + "px";
        ui.abrirAjustes.style.right = "auto";
        ui.abrirAjustes.style.bottom = "auto";
    } else {
        ui.abrirAjustes.style.left = "";
        ui.abrirAjustes.style.top = "";
        ui.abrirAjustes.style.right = "";
        ui.abrirAjustes.style.bottom = "";
    }
}
aplicarPreferenciasMenu();
ui.posicaoBotaoMenu.addEventListener("change", () => {
    preferenciasMenu.posicao = ui.posicaoBotaoMenu.value;
    preferenciasMenu.x = null;
    preferenciasMenu.y = null;
    aplicarPreferenciasMenu();
    salvarPreferenciasMenu();
});
ui.transparenciaBotaoMenu.addEventListener("input", () => {
    preferenciasMenu.transparencia = Number(ui.transparenciaBotaoMenu.value);
    aplicarPreferenciasMenu();
    salvarPreferenciasMenu();
});
ui.tamanhoBotaoMenu.addEventListener("input", () => {
    preferenciasMenu.tamanhoBotao = Number(ui.tamanhoBotaoMenu.value);
    document.documentElement.style.setProperty("--menu-tamanho", preferenciasMenu.tamanhoBotao + "px");
    if (preferenciasMenu.posicao === "arrastavel" && Number.isFinite(preferenciasMenu.x) && Number.isFinite(preferenciasMenu.y)) {
        const margem = 8;
        preferenciasMenu.x = Math.min(Math.max(margem, window.innerWidth - ui.abrirAjustes.offsetWidth - margem), preferenciasMenu.x);
        preferenciasMenu.y = Math.min(Math.max(margem, window.innerHeight - ui.abrirAjustes.offsetHeight - margem), preferenciasMenu.y);
    }
    aplicarPreferenciasMenu();
    salvarPreferenciasMenu();
});
ui.densidadeInterface.addEventListener("change", () => { preferenciasMenu.densidade = ui.densidadeInterface.value; aplicarPreferenciasVisuais(); salvarPreferenciasMenu(); });
ui.mostrarGraficos.addEventListener("change", () => { preferenciasMenu.mostrarGraficos = ui.mostrarGraficos.checked; aplicarPreferenciasVisuais(); salvarPreferenciasMenu(); });
ui.mostrarPlanejamento.addEventListener("change", () => {
    preferenciasMenu.mostrarPlanejamento = ui.mostrarPlanejamento.checked;
    aplicarVisibilidadeSecoes();
    salvarPreferenciasMenu();
});
ui.mostrarDespesas.addEventListener("change", () => {
    preferenciasMenu.mostrarDespesas = ui.mostrarDespesas.checked;
    aplicarVisibilidadeSecoes();
    salvarPreferenciasMenu();
});
ui.mostrarEntradas.addEventListener("change", () => {
    preferenciasMenu.mostrarEntradas = ui.mostrarEntradas.checked;
    aplicarVisibilidadeSecoes();
    salvarPreferenciasMenu();
});
ui.telaInicial.addEventListener("change", () => {
    preferenciasMenu.telaInicial = ui.telaInicial.value;
    salvarPreferenciasMenu();
});
ui.referenciaMes.addEventListener("change", () => {
    preferenciasMenu.referenciaMes = ui.referenciaMes.value;
    if (preferenciasMenu.referenciaMes === "ultimo") preferenciasMenu.ultimoPeriodo = chaveMes(periodo.ano, periodo.mes);
    salvarPreferenciasMenu();
});
ui.ocultarAoIniciar.addEventListener("change", () => { preferenciasMenu.ocultarAoIniciar = ui.ocultarAoIniciar.checked; salvarPreferenciasMenu(); });
ui.escopoCsv.addEventListener("change", () => { preferenciasMenu.escopoCsv = ui.escopoCsv.value; salvarPreferenciasMenu(); });
ui.idiomaInterface.addEventListener("change", () => {
    preferenciasMenu.idioma = ui.idiomaInterface.value;
    idiomaAtual = preferenciasMenu.idioma;
    aplicarIdioma(idiomaAtual);
    aplicarPreferenciasMenu();
    renderTudo();
    salvarPreferenciasMenu();
});
ui.moedaInterface.addEventListener("change", () => {
    preferenciasMenu.moeda = ui.moedaInterface.value;
    renderTudo();
    salvarPreferenciasMenu();
});
let arrastoMenuEmCurso = false;
let menuFoiArrastado = false;
ui.abrirAjustes.addEventListener("pointerdown", (evento) => {
    if (preferenciasMenu.posicao !== "arrastavel" || (evento.button !== undefined && evento.button !== 0)) return;
    const botao = ui.abrirAjustes;
    const caixa = botao.getBoundingClientRect();
    arrastoMenuEmCurso = true;
    menuFoiArrastado = false;
    botao.setPointerCapture(evento.pointerId);
    botao.dataset.arrastoX = String(evento.clientX);
    botao.dataset.arrastoY = String(evento.clientY);
    botao.dataset.posicaoX = String(caixa.left);
    botao.dataset.posicaoY = String(caixa.top);
});
ui.abrirAjustes.addEventListener("pointermove", (evento) => {
    if (!arrastoMenuEmCurso) return;
    const botao = ui.abrirAjustes;
    const dx = evento.clientX - Number(botao.dataset.arrastoX);
    const dy = evento.clientY - Number(botao.dataset.arrastoY);
    if (Math.abs(dx) + Math.abs(dy) > 4) menuFoiArrastado = true;
    if (!menuFoiArrastado) return;
    evento.preventDefault();
    const margem = 8;
    const maxX = Math.max(margem, window.innerWidth - botao.offsetWidth - margem);
    const maxY = Math.max(margem, window.innerHeight - botao.offsetHeight - margem);
    const x = Math.min(maxX, Math.max(margem, Number(botao.dataset.posicaoX) + dx));
    const y = Math.min(maxY, Math.max(margem, Number(botao.dataset.posicaoY) + dy));
    botao.style.left = x + "px";
    botao.style.top = y + "px";
    botao.style.right = "auto";
    botao.style.bottom = "auto";
    preferenciasMenu.x = x;
    preferenciasMenu.y = y;
});
window.addEventListener("resize", () => {
    if (preferenciasMenu.posicao !== "arrastavel" || !Number.isFinite(preferenciasMenu.x) || !Number.isFinite(preferenciasMenu.y)) return;
    const margem = 8;
    preferenciasMenu.x = Math.min(Math.max(margem, window.innerWidth - ui.abrirAjustes.offsetWidth - margem), preferenciasMenu.x);
    preferenciasMenu.y = Math.min(Math.max(margem, window.innerHeight - ui.abrirAjustes.offsetHeight - margem), preferenciasMenu.y);
    aplicarPreferenciasMenu();
    salvarPreferenciasMenu();
});
const encerrarArrastoMenu = () => {
    arrastoMenuEmCurso = false;
    if (menuFoiArrastado) salvarPreferenciasMenu();
};
ui.abrirAjustes.addEventListener("pointerup", encerrarArrastoMenu);
ui.abrirAjustes.addEventListener("pointercancel", encerrarArrastoMenu);
ui.abrirAjustes.addEventListener("click", (evento) => {
    if (menuFoiArrastado) {
        evento.preventDefault();
        menuFoiArrastado = false;
        return;
    }
    ui.dialogoAjustes.showModal();
});
ui.fecharAjustes.addEventListener("click", () => ui.dialogoAjustes.close());
ui.abrirCalculadora.addEventListener("click", () => ui.dialogoCalculadora.showModal());
ui.fecharCalculadora.addEventListener("click", () => ui.dialogoCalculadora.close());
document.querySelectorAll("[data-calculadora]").forEach((tecla) => {
    tecla.addEventListener("click", () => {
        ui.visorCalculadora.value += tecla.dataset.calculadora;
        ui.visorCalculadora.focus();
    });
});
$("limpar-calculadora").addEventListener("click", () => { ui.visorCalculadora.value = ""; });
$("apagar-calculadora").addEventListener("click", () => {
    ui.visorCalculadora.value = ui.visorCalculadora.value.slice(0, -1);
    ui.visorCalculadora.focus();
});
$("calcular-resultado").addEventListener("click", () => {
    try {
        const resultado = calcularExpressao(ui.visorCalculadora.value);
        ui.visorCalculadora.value = String(Number(resultado.toFixed(10))).replace(".", ",");
    } catch (_) {
        ui.visorCalculadora.setCustomValidity("Expressão inválida");
        ui.visorCalculadora.reportValidity();
        ui.visorCalculadora.setCustomValidity("");
    }
});
ui.visorCalculadora.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    $("calcular-resultado").click();
});
ui.alternarVisibilidadeResumo.addEventListener("click", () => {
    valoresOcultos = !valoresOcultos;
    renderTudo(false);
});
ui.alternarValores.addEventListener("click", () => { valoresOcultos = !valoresOcultos; renderTudo(false); });
ui.atualizarApp.addEventListener("click", async () => {
    if (verificacaoAtualizacaoAtiva) return;
    verificacaoAtualizacaoAtiva = true;
    const botao = ui.atualizarApp;
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Verificando…";
    ui.statusAtualizacao.textContent = "Consultando a versão publicada e o estado do Service Worker…";

    try {
        if (!navigator.onLine) throw new Error("Você está offline; não foi possível verificar a versão publicada.");

        const [instalada, publicada] = await Promise.all([
            lerVersaoInstalada(),
            lerVersaoPublicada()
        ]);
        versaoInstalada = instalada.version;
        const resultado = await verificarComConfirmacao({
            instalada: instalada.version,
            publicada: publicada.version,
            confirmar: (versaoAtual, versaoNova) => {
                registrarResultadoVerificacao(`Atualização disponível: ${versaoAtual} → ${versaoNova}.`, publicada.version);
                return window.confirm(
                    `Uma nova versão do Controle Financeiro está disponível.\n\nVersão instalada: ${versaoAtual}\nVersão disponível: ${versaoNova}\n\nDeseja atualizar agora?`
                );
            },
            atualizar: async () => {
                if (!("serviceWorker" in navigator)) throw new Error("Este navegador não oferece atualização por Service Worker.");
                const escopo = new URL("./", import.meta.url).href;
                const registro = await navigator.serviceWorker.getRegistration(escopo);
                if (!registro) throw new Error("O Service Worker deste aplicativo ainda não foi registrado.");
                await instalarAtualizacao(registro, navigator.serviceWorker);
                estadoServiceWorker = "Nova versão instalada e controlando esta página.";
                registrarResultadoVerificacao(`Atualizado para a versão ${publicada.version}.`, publicada.version);
                ui.statusAtualizacao.textContent = `Versão ${publicada.version} instalada. Reabrindo o aplicativo…`;
                window.location.reload();
            }
        });

        if (resultado === "cancelado") {
            registrarResultadoVerificacao(`Atualização ${publicada.version} disponível; atualização adiada pelo usuário.`, publicada.version);
            ui.statusAtualizacao.textContent = `Versão ${publicada.version} disponível. Você pode verificar novamente quando quiser.`;
            return;
        }

        if (resultado === "atualizado") {
            const registro = await atualizarEstadoServiceWorker();
            if (registro) await registro.update();
            await atualizarEstadoServiceWorker();
            registrarResultadoVerificacao(`Aplicativo atualizado na versão ${instalada.version}.`, publicada.version);
            ui.statusAtualizacao.textContent = `O aplicativo já está atualizado na versão ${instalada.version}.`;
        }
    } catch (erro) {
        registrarResultadoVerificacao(`Falha na verificação: ${erro.message || "erro desconhecido"}.`);
        ui.statusAtualizacao.textContent = `Não foi possível concluir a verificação. ${erro.message || "Tente novamente quando houver conexão."}`;
    } finally {
        verificacaoAtualizacaoAtiva = false;
        botao.disabled = false;
        botao.textContent = textoOriginal;
    }
});
ui.dialogoAjustes.addEventListener("click", (evento) => {
    if (evento.target === ui.dialogoAjustes) ui.dialogoAjustes.close();
});



ui.tema.addEventListener("click", () => {



    const atual = document.documentElement.dataset.tema;



    const ordemTemas = ["claro", "escuro", "rosa", "pangolim", "floresta"];
    estado.tema = ordemTemas[(ordemTemas.indexOf(atual) + 1) % ordemTemas.length];



    renderTema();

    salvar();

});



/* ---------- Início ---------- */



renderTudo();
aplicarPreferenciasMenu();
aplicarPrivacidade();
atualizarDiagnostico();
const telaInicialAplicada = abrirSecaoInicial();
document.documentElement.classList.remove("app-inicializando");
let quadroRastreamentoTela = null;
requestAnimationFrame(() => {
    rastreamentoTelaAtivo = true;
    registrarUltimaTela(telaInicialAplicada);
});
carregarVersaoInstalada();
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        estadoServiceWorker = "Service Worker ativo e controlando esta página.";
        atualizarDiagnostico();
    });
    navigator.serviceWorker.ready
        .then(atualizarEstadoServiceWorker)
        .catch((erro) => {
            estadoServiceWorker = `Não foi possível consultar o Service Worker: ${erro.message || "erro desconhecido"}.`;
            atualizarDiagnostico();
        });
}
window.addEventListener("scroll", () => {
    if (quadroRastreamentoTela !== null) return;
    quadroRastreamentoTela = requestAnimationFrame(() => {
        quadroRastreamentoTela = null;
        detectarTelaVisivel();
    });
}, { passive: true });

const avisosInicializacao = [];
if (migracaoLegadaPendente) {
    avisosInicializacao.push("Dados antigos migrados para " + new Date().getFullYear() + "; confira os meses.");
}
if (migracaoEstadoV2Pendente) avisosInicializacao.push("Dados da versão anterior atualizados; os backups antigos continuam compatíveis.");
if (dadosStorageAntigoPendentes) avisosInicializacao.push("Dados salvos em uma versão anterior do armazenamento foram migrados.");
if (!storage.persistente || avisoArmazenamentoTemporarioExibido) {
    avisoArmazenamentoTemporarioExibido = true;
    avisosInicializacao.push("O armazenamento persistente está indisponível; os dados podem se perder ao fechar o app.");
}
if (avisosInicializacao.length) avisar(avisosInicializacao.join(" "));
