import { criarRecuperacaoFinanceira, storage } from "./storage.js";
import { CATEGORIAS_PADRAO, CATEGORIA_FIXA, normalizarEstado as normalizarEstadoCore, normalizarValorMonetario, validarBackup, validarTotaisMonetarios, migrarDadosLegados, calcularExpressao, somarCentavos, gerarCsv, agruparDespesasPorCategoria, agruparLancamentosComOrcamento, renomearCategoriaOrcamentos, removerCategoriaOrcamentos, criarSerieReceitas, listarReceitasDaSerie, editarReceita, excluirReceita } from "./finance-core.js";
import { apresentarValorFinanceiro, calcularEspacamentosDensidade, normalizarPreferenciasMenu, resolverTelaInicial } from "./preferences.js";
import { criarConfirmacaoAtualizacao, criarVerificadorAutomatico, instalarAtualizacao, lerVersaoControlador, lerVersaoInstalada, lerVersaoPublicada, validarVersaoAplicacao, verificarComConfirmacao } from "./update-manager.js";
import { aplicarIdioma, formatarMoeda as formatarMoedaLocalizada, LOCALES, textoTraduzido } from "./localization.js";
import { firebaseConfig, firebaseConfigurado } from "./firebase-config.js";
import { chaveLocalConta, registrosFinanceiros, combinarRegistros, migrationBackup, operationId, jsonCanonico, coalesceOutbox, flushSyncQueue, createSyncSessionGuard, validateRemoteSettings, mergeRemoteSettings, validRemoteTombstone, reconcileRemoteConflicts, validateRemoteConflicts } from "./sync-core.js";



/* =========================================================

   Controle Financeiro

   Dados salvos no navegador (localStorage).

   ========================================================= */



const CHAVE_ESTADO = "controleFinanceiro:v3";
let chaveEstadoAtual = CHAVE_ESTADO;
const CHAVE_ATUALIZACAO_PENDENTE = "controleFinanceiro:confirmar-interface-atualizada";
const VERSAO_BUNDLE = new URL(import.meta.url).searchParams.get("_release");
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
    valorDensidadeInterface: $("valor-densidade-interface"),
    mostrarGraficos: $("mostrar-graficos"),
    mostrarResumo: $("mostrar-resumo-mes"),
    mostrarDespesas: $("mostrar-despesas-mes"),
    mostrarEntradas: $("mostrar-entradas"),
    ocultarAoIniciar: $("ocultar-ao-iniciar"),
    escopoCsv: $("escopo-csv"),
    diagnosticoDados: $("diagnostico-dados"),
    ultimaOperacaoDados: $("ultima-operacao-dados"),
    diagnosticoApp: $("diagnostico-app"),
    versaoInstalada: $("versao-instalada"),
    versaoPublicada: $("versao-publicada"),
    dataVerificacaoAtualizacao: $("data-verificacao-atualizacao"),
    resultadoVerificacaoAtualizacao: $("resultado-verificacao-atualizacao"),
    statusAtualizacao: $("status-atualizacao"),
    dialogoOrcamentos: $("dialogo-orcamentos"),
    fecharOrcamentos: $("fechar-orcamentos"),
    abrirCategoriasOrcamento: $("abrir-categorias-orcamento"),
    abrirLimitesOrcamento: $("abrir-limites-orcamento"),
    painelCategoriasOrcamento: $("painel-categorias-orcamento"),
    painelLimitesOrcamento: $("painel-limites-orcamento"),
    listaOrcamentos: $("lista-orcamentos"),
    abrirCalculadora: $("abrir-calculadora"),
    abrirCalendarioResumo: $("abrir-calendario-resumo"),
    dataCalendarioResumo: $("data-calendario-resumo"),
    dialogoCalculadora: $("dialogo-calculadora"),
    fecharCalculadora: $("fechar-calculadora"),
    visorCalculadora: $("visor-calculadora"),
    atualizarApp: $("atualizar-app"),



    saldoValor: $("saldo-valor"),
    alternarVisibilidadeResumo: $("alternar-visibilidade-resumo"),

    barra: $("barra"),

    barraPago: $("barra-pago"),

    barraPendente: $("barra-pendente"),

    textoComprometido: $("texto-comprometido"),

    totalReceitas: $("total-receitas"),

    totalDespesas: $("total-despesas"),

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

    receitaRepetir: $("receita-repetir"),

    campoRepetirReceita: $("campo-repetir-receita"),

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
    tituloSerie: $("titulo-dialogo-serie"),

    textoSerie: $("texto-serie"),

    serieCancelar: $("serie-cancelar"),

    serieSoEste: $("serie-so-este"),

    serieProximos: $("serie-proximos"),

    totalRotulo: $("total-rotulo"),

    totalValor: $("total-valor"),




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

function atualizarPosicaoEdicaoComTeclado() {
    const viewport = window.visualViewport;
    if (!viewport || !window.matchMedia("(max-width: 600px)").matches) return;
    const dialogo = [ui.dialogoDespesa, ui.dialogoReceita].find((item) => item.open);
    if (!dialogo) return;
    const campoAtivo = dialogo.contains(document.activeElement)
        && document.activeElement.matches("input:not([type=checkbox]), textarea");
    const alturaTeclado = window.innerHeight - viewport.height - viewport.offsetTop;
    const tecladoVisivel = campoAtivo && alturaTeclado > 80;
    dialogo.classList.toggle("teclado-virtual-ativo", tecladoVisivel);
    if (tecladoVisivel) {
        dialogo.style.setProperty("--dialogo-viewport-bottom", `${Math.max(0, alturaTeclado)}px`);
        dialogo.style.setProperty("--dialogo-viewport-height", `${viewport.height}px`);
    } else {
        dialogo.style.removeProperty("--dialogo-viewport-bottom");
        dialogo.style.removeProperty("--dialogo-viewport-height");
    }
}

function agendarAjusteDialogoEdicao() {
    requestAnimationFrame(atualizarPosicaoEdicaoComTeclado);
}

window.visualViewport?.addEventListener("resize", agendarAjusteDialogoEdicao);
window.visualViewport?.addEventListener("scroll", agendarAjusteDialogoEdicao);
document.addEventListener("focusin", agendarAjusteDialogoEdicao);
document.addEventListener("focusout", () => setTimeout(agendarAjusteDialogoEdicao, 0));
for (const dialogo of [ui.dialogoDespesa, ui.dialogoReceita]) {
    dialogo.addEventListener("close", () => {
        dialogo.classList.remove("teclado-virtual-ativo");
        dialogo.style.removeProperty("--dialogo-viewport-bottom");
        dialogo.style.removeProperty("--dialogo-viewport-height");
    });
}

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



const recuperacaoFinanceira = criarRecuperacaoFinanceira(storage);

function registrarFonteFinanceiraProtegida(chave, bruto = null) {
    recuperacaoFinanceira.proteger(chave, bruto);
}

function lerEstadoPersistido(chave) {
    const resultado = storage.lerJsonResultado(chave, { protegerInvalido: true });
    if (resultado.estado === "invalido" || resultado.estado === "erro") {
        registrarFonteFinanceiraProtegida(chave, resultado.bruto);
        return { estado: "invalido", valor: null };
    }
    if (resultado.estado === "valido"
        && !validarBackup(resultado.valor, { permitirTextoNumerico: true })) {
        registrarFonteFinanceiraProtegida(chave, resultado.bruto);
        return { estado: "invalido", valor: null };
    }
    return resultado;
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
    const fontesLidas = [];
    for (let mes = 1; mes <= 12; mes += 1) {
        const chave = PREFIXO_LEGADO + mes;
        const resultado = storage.lerJsonResultado(chave, { protegerInvalido: true });
        if (resultado.estado === "ausente" || resultado.estado === "indisponivel") continue;
        if (resultado.estado !== "valido" || !resultado.valor
            || typeof resultado.valor !== "object" || Array.isArray(resultado.valor)) {
            registrarFonteFinanceiraProtegida(chave, resultado.bruto);
            continue;
        }
        const dados = resultado.valor;
        const categoriasValidas = dados.categorias === undefined
            || (Array.isArray(dados.categorias)
                && dados.categorias.every((categoria) => typeof categoria === "string"));
        const despesasValidas = dados.despesas === undefined
            || (Array.isArray(dados.despesas) && dados.despesas.every((despesa) =>
                despesa && typeof despesa === "object" && !Array.isArray(despesa)
                && typeof despesa.nome === "string" && despesa.nome.trim()
                && despesa.nome.length <= 80 && normalizarValorMonetario(despesa.valor) !== null));
        const renda = dados.renda === undefined ? undefined : Number(dados.renda);
        const rendaValida = dados.renda === undefined
            || normalizarValorMonetario(renda) !== null;
        if (!categoriasValidas || !despesasValidas || !rendaValida) {
            registrarFonteFinanceiraProtegida(chave, resultado.bruto);
            continue;
        }
        registrosPorMes[mes] = {
            ...dados,
            renda: renda === undefined ? undefined : normalizarValorMonetario(renda),
            despesas: (dados.despesas || []).map((despesa) => ({
                ...despesa,
                valor: normalizarValorMonetario(despesa.valor)
            }))
        };
        fontesLidas.push({ chave, bruto: resultado.bruto });
    }
    if (recuperacaoFinanceira.protegido) return null;
    const legado = migrarDadosLegados(registrosPorMes, new Date().getFullYear());
    if (legado) {
        const quantidadeLegada = Object.values(registrosPorMes)
            .reduce((total, dados) => total + (dados.despesas?.length || 0), 0);
        const quantidadeNormalizada = Object.values(normalizarEstado(legado).meses)
            .reduce((total, dados) => total + dados.despesas.length, 0);
        if (quantidadeNormalizada !== quantidadeLegada || !validarBackup(legado)) {
            fontesLidas.forEach(({ chave, bruto }) => registrarFonteFinanceiraProtegida(chave, bruto));
            return null;
        }
        migracaoLegadaPendente = true;
    }
    return legado;
}

function carregarEstado() {



    try {

        const salvo = lerEstadoPersistido(chaveEstadoAtual);
        if (salvo.estado === "invalido") return normalizarEstado(null);
        if (salvo.estado === "valido") return normalizarEstado(salvo.valor);

        const estadoV2 = lerEstadoPersistido(CHAVE_ESTADO_V2);
        if (estadoV2.estado === "invalido") return normalizarEstado(null);
        if (estadoV2.estado === "valido") {
            migracaoEstadoV2Pendente = true;
            return normalizarEstado(estadoV2.valor);
        }

        const storageAntigo = lerEstadoPersistido(CHAVE_ESTADO_STORAGE_ANTIGO);
        if (storageAntigo.estado === "invalido") return normalizarEstado(null);
        if (storageAntigo.estado === "valido") {
            dadosStorageAntigoPendentes = true;
            return normalizarEstado(storageAntigo.valor);
        }

        const legado = migrarLegado();
        if (recuperacaoFinanceira.protegido) return normalizarEstado(null);
        if (legado) return normalizarEstado(legado);

    } catch (erro) {
        console.error("Erro ao carregar os dados:", erro);
        registrarFonteFinanceiraProtegida(CHAVE_ESTADO);
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
    if (recuperacaoFinanceira.protegido) return;
    if (!validarTotaisMonetarios(estadoParaSalvar())) {
        avisar("Os totais mensais excedem o limite monetário seguro. Ajuste os lançamentos antes de salvar.");
        return;
    }

    try {
        const valor = estadoParaSalvar();
        if (!storage.escreverJson(chaveEstadoAtual, valor)) avisarArmazenamentoTemporario();
        if (chaveEstadoAtual !== CHAVE_ESTADO) window.dispatchEvent(new CustomEvent("finance-local-change", { detail: { uid: chaveEstadoAtual.split(":").at(-1), state: valor } }));
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
    const identificacao = criarEl("div", { class: "receita-identificacao" }, [
        criarEl("span", { class: "nome-receita", text: nome })
    ]);
    if (receita.serie) {
        identificacao.append(criarEl("span", {
            class: "marca marca-recorrente",
            title: "Série mensal",
            text: "Mensal"
        }));
    }



    linha.append(

        identificacao,

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
    const grupos = agruparLancamentosComOrcamento(despesas, estado.categorias, estado.orcamentos)
        .sort((a, b) => a.categoria.localeCompare(b.categoria, LOCALES[idiomaAtual] || "pt-BR"));
    ui.listaDespesas.replaceChildren(...grupos.map((grupo) => criarEl("section", {
        class: "despesa-grupo" + (grupo.excedido ? " acima-do-orcamento" : ""),
        "aria-label": grupo.excedido ? `${grupo.categoria}, orçamento excedido` : grupo.categoria
    }, [
        criarEl("div", { class: "despesa-grupo-topo" }, [
            criarEl("h3", { class: "despesa-grupo-categoria", text: grupo.categoria }),
            criarEl("div", { class: "despesa-grupo-resumo" }, [
                criarEl("strong", {
                    class: "despesa-grupo-total",
                    text: `Total da categoria: ${formatarMoeda(grupo.totalCentavos / 100)}`
                }),
                ...(grupo.limiteCentavos === null ? [] : [criarEl("small", {
                    class: "despesa-grupo-limite" + (grupo.excedido ? " excedido" : ""),
                    text: `Limite: ${formatarMoeda(grupo.limiteCentavos / 100)}`
                })])
            ])
        ]),
        criarEl("div", { class: "despesa-grupo-itens" }, grupo.despesas.map(criarLinhaDespesa))
    ])));
    ui.vazioDespesas.hidden = despesas.length > 0;
    ui.vazioDespesas.textContent =
    "Toque em Adicionar para começar";
}



function corDaCategoria(nome) {

    const indice = Math.max(0, estado.categorias.indexOf(nome));

    return "hsl(" + ((indice * 47 + 160) % 360) + ", 55%, 48%)";

}



function somar(lista) {
    return somarCentavos(lista.map((item) => numero(item.valor))) / 100;

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
    renderDespesas();
    salvar();
}

function lerLimiteOrcamento(campo) {
    const texto = campo?.value.trim() || "";
    const valor = normalizarValorMonetario(texto);
    if (!texto || valor === null) {
        avisar("Informe um limite válido igual ou maior que zero.");
        campo?.focus();
        return null;
    }
    return valor;
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



    let receitaCentavos;
    let despesaCentavos;
    let pagoCentavos;
    try {
        receitaCentavos = somarCentavos(mes.receitas.map((r) => numero(r.valor)));
        despesaCentavos = somarCentavos(mes.despesas.map((d) => numero(d.valor)));
        pagoCentavos = somarCentavos(mes.despesas.filter((d) => d.pago).map((d) => numero(d.valor)));
    } catch (erro) {
        if (!(erro instanceof RangeError)) throw erro;
        avisar("Os totais deste mês excedem o limite monetário seguro. Ajuste os lançamentos para atualizar o resumo.");
        return;
    }
    const receita = receitaCentavos / 100;
    const despesa = despesaCentavos / 100;
    const pago = pagoCentavos / 100;
    const pendente = (despesaCentavos - pagoCentavos) / 100;
    const saldo = (receitaCentavos - despesaCentavos) / 100;



    // Cabeçalho

    ui.saldoValor.textContent = formatarMoeda(saldo);

    ui.saldoValor.classList.toggle("negativo", saldo < 0);

    ui.totalReceitas.textContent = formatarMoeda(receita);

    ui.totalDespesas.textContent = formatarMoeda(despesa);

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

    const itens = agruparDespesasPorCategoria(obterMes().despesas).sort((a, b) => b[1] - a[1]);
    const total = somarCentavos(itens.map(([, valor]) => valor)) / 100;
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
            nome + ": " + formatarMoeda(valor) + (valoresOcultos ? "" : ", " + formatarPercentual((valor / total) * 100))
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



    registrarRemocao(ultimaRemocao, mensagem);

}



function registrarRemocao(remocoes, mensagem) {

    ultimaRemocao = remocoes;

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



let receitaSerieEmCriacao = null;


function abrirDialogoReceita(id) {



    const receita = id

        ? obterMes().receitas.find((r) => r.id === id)

        : null;



    if (id && !receita) return;



    receitaEmEdicao = receita ? receita.id : null;
    receitaSerieEmCriacao = receita ? null : uid();



    ui.tituloDialogoReceita.textContent = receita ? "Editar entrada" : "Adicionar entrada";



    ui.receitaNome.value = receita ? receita.nome : "";

    ui.receitaValor.value = receita && receita.valor ? String(receita.valor) : "";
    ui.campoRepetirReceita.hidden = Boolean(receita);
    ui.receitaRepetir.checked = false;



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
    const valor = normalizarValorMonetario(valorDigitado);
    if (!valorDigitado || valor === null || valor <= 0) {
        avisar("Informe um valor maior que zero para a entrada.");
        ui.receitaValor.focus();
        return;
    }

    const dados = { nome, valor };

    if (receitaEmEdicao) {



        editarReceita(estado.meses, chaveMes(periodo.ano, periodo.mes), receitaEmEdicao, dados);



        avisar("Entrada atualizada.");



    } else {



        if (ui.receitaRepetir.checked) {
            const agora = new Date();
            const anoInicial = agora.getFullYear();
            const mesInicial = agora.getMonth() + 1;
            const criadas = criarSerieReceitas(estado.meses, {
                chaveInicial: chaveMes(anoInicial, mesInicial),
                ...dados,
                serie: receitaSerieEmCriacao || uid()
            }, uid);
            mudarPeriodo(anoInicial, mesInicial);
            avisar(criadas.length ? "Entrada adicionada." : "Esta série mensal já foi criada.");
        } else {
            obterMes().receitas.push({ id: uid(), ...dados });
            avisar("Entrada adicionada.");
        }

    }



    ui.dialogoReceita.close();
    receitaSerieEmCriacao = null;



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
        const titulo = botao.closest(".bloco-topo")
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



    const futuras = receita.serie
        ? listarReceitasDaSerie(estado.meses, receita.serie).filter(({ chave }) => chave > chaveAtual()).length
        : 0;
    if (futuras) {
        pedirEscolhaDaSerieReceita(receita, futuras);
        return;
    }
    const removida = excluirReceita(estado.meses, chaveAtual(), id);
    if (removida) registrarRemocao([{ ...removida, lista: "receitas" }], "Entrada removida.");

});



/* ---------- Despesas ---------- */



const MAX_PARCELAS = 60;

const MESES_DA_FIXA = 12; // meses lançados de uma vez ao criar uma despesa fixa



let despesaEmEdicao = null; // id da despesa aberta no diálogo (null = nova)

let despesaParaRemover = null; // despesa fixa/parcelada aguardando a escolha do usuário
let receitaParaRemover = null;



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
    const valor = normalizarValorMonetario(valorDigitado);
    if (!valorDigitado || valor === null || valor <= 0) {
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
    receitaParaRemover = null;
    ui.tituloSerie.textContent = "Remover despesa";
    ui.serieSoEste.textContent = "Só este mês";
    ui.serieProximos.textContent = "Este e os próximos";



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

function pedirEscolhaDaSerieReceita(receita, futuras) {
    receitaParaRemover = receita;
    despesaParaRemover = null;
    ui.tituloSerie.textContent = "Remover entrada";
    ui.textoSerie.textContent = `\"${receita.nome}\" tem ${futuras} ocorrência${futuras === 1 ? "" : "s"} futura${futuras === 1 ? "" : "s"}. Deseja excluir também as ocorrências futuras?`;
    ui.serieSoEste.textContent = "Só esta entrada";
    ui.serieProximos.textContent = "Esta e as futuras";
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
    const receita = receitaParaRemover;



    ui.dialogoSerie.close();



    if (despesa) {

        removerSelecao("despesas", [{ chave: chaveAtual(), item: despesa }], "Despesa removida.");

    } else if (receita) {

        removerSelecao("receitas", [{ chave: chaveAtual(), item: receita }], "Entrada removida.");

    }

});



ui.serieProximos.addEventListener("click", () => {



    const despesa = despesaParaRemover;
    const receita = receitaParaRemover;



    ui.dialogoSerie.close();



    if (receita) {
        const selecao = listarReceitasDaSerie(estado.meses, receita.serie)
            .filter(({ chave }) => chave >= chaveAtual());
        removerSelecao("receitas", selecao, selecao.length + " entradas removidas.");
        return;
    }

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
    ui.painelCategoriasOrcamento.hidden = painel !== "categorias";
    ui.painelLimitesOrcamento.hidden = painel !== "limites";
}

ui.abrirCategoriasOrcamento.addEventListener("click", () => {
    renderListaCategorias();
    mostrarPainelOrcamentos("categorias");
    ui.dialogoAjustes.close();
    ui.dialogoOrcamentos.showModal();
    ui.novaCategoria.focus();
});
ui.abrirLimitesOrcamento.addEventListener("click", () => {
    renderListaOrcamentos();
    mostrarPainelOrcamentos("limites");
    ui.dialogoAjustes.close();
    ui.dialogoOrcamentos.showModal();
    ui.listaOrcamentos.querySelector("[data-orcamento-campo]")?.focus();
});
ui.fecharOrcamentos.addEventListener("click", () => ui.dialogoOrcamentos.close());
ui.dialogoOrcamentos.addEventListener("click", (evento) => {
    if (evento.target === ui.dialogoOrcamentos) ui.dialogoOrcamentos.close();
    if (evento.target.closest("[data-orcamento-voltar]")) {
        const controle = ui.painelCategoriasOrcamento.hidden
            ? ui.abrirLimitesOrcamento
            : ui.abrirCategoriasOrcamento;
        ui.dialogoOrcamentos.close();
        ui.dialogoAjustes.showModal();
        controle.focus();
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



    origem.receitas.forEach((r) => {
        // A série já administra suas ocorrências; copiar uma entrada recorrente poderia recriar uma ocorrência cancelada.
        if (r.serie) return;
        destino.receitas.push({ ...r, id: uid() });
    });

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
    const exportado = recuperacaoFinanceira.exportarBackup(() => {
        if (!validarTotaisMonetarios(estadoParaSalvar())) {
            avisar("Os totais mensais excedem o limite monetário seguro. Ajuste os lançamentos antes de exportar.");
            return false;
        }
        const agoraLocal = new Date();
        const hoje = [agoraLocal.getFullYear(), String(agoraLocal.getMonth() + 1).padStart(2, "0"), String(agoraLocal.getDate()).padStart(2, "0")].join("-");
        baixarArquivo(
            JSON.stringify(estadoParaSalvar(), null, 2),
            "controle-financeiro-backup-" + hoje + ".json",
            "application/json"
        );
        registrarOperacaoDados("Backup JSON gerado em " + new Date().toLocaleString("pt-BR") + ".");
        avisar("Backup salvo.");
        return true;
    });
    if (!exportado && recuperacaoFinanceira.protegido) {
        avisar("O backup normal está bloqueado porque os dados financeiros precisam ser recuperados. Baixe a cópia preservada ou restaure um backup válido.");
    }
    return exportado;
}

function exportarCopiaDadosProtegidos() {
    const conteudo = JSON.stringify({
        aviso: "Cópia bruta preservada para recuperação manual; nenhum dado foi alterado.",
        fontes: recuperacaoFinanceira.fontes().map(({ chave, bruto }) => ({ chave, bruto }))
    }, null, 2);
    baixarArquivo(conteudo, "controle-financeiro-dados-preservados.json", "application/json");
    avisar("Cópia bruta dos dados preservados gerada.");
}



function importarBackup(arquivo) {



    if (!arquivo) return;



    const leitor = new FileReader();



    leitor.onload = () => {



        let bruto;



        try {

            bruto = JSON.parse(String(leitor.result));

        } catch (erro) {

            avisar("Arquivo inválido. Escolha um backup gerado por este aplicativo.");

            return;

        }



        const resultado = recuperacaoFinanceira.restaurar({
            chave: chaveEstadoAtual,
            backup: bruto,
            validar: validarBackup,
            normalizar: (backup) => {
                const novo = normalizarEstado(backup);
                novo.tema = novo.tema || estado.tema;
                return novo;
            },
            confirmar: () => confirm("Restaurar o backup? Todos os dados atuais serão substituídos.")
        });
        if (resultado.estado === "invalido") {
            avisar("Arquivo inválido. Escolha um backup gerado por este aplicativo.");
            return;
        }
        if (resultado.estado === "cancelado") return;

        estado = resultado.dados;
        ultimaRemocao = null;
        renderTudo(false);

        if (syncUser && chaveEstadoAtual === chaveLocalConta(syncUser.uid)) {
            const metaSync = readSyncMeta(syncUser.uid);
            metaSync.restoredPending = true;
            writeSyncMeta(syncUser.uid, metaSync);
            syncUi.restore.hidden = false;
            setSyncStatus("Backup restaurado localmente. Revise antes de sincronizar com a nuvem.");
        }



        registrarOperacaoDados("Backup restaurado em " + new Date().toLocaleString("pt-BR") + ".");
        avisar(resultado.persistido
            ? "Backup restaurado."
            : "Backup restaurado, mas o armazenamento persistente falhou; os dados podem se perder ao fechar o app.");

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
const confirmacaoAtualizacao = criarConfirmacaoAtualizacao((versaoAtual, versaoNova) => {
    registrarResultadoVerificacao(`Atualização disponível: ${versaoAtual} → ${versaoNova}.`, versaoNova);
    return window.confirm(
        `Uma nova versão do Controle Financeiro está disponível.\n\nVersão instalada: ${versaoAtual}\nVersão disponível: ${versaoNova}\n\nDeseja atualizar agora?`
    );
});
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
    const recuperacao = recuperacaoFinanceira.protegido
        ? " Dados existentes não foram alterados; gravação automática bloqueada."
        : "";
    ui.diagnosticoDados.textContent = `${receitas + despesas} lançamentos (${receitas} receitas, ${despesas} despesas) · ${categorias} categorias · ${armazenamento}${recuperacao}`;
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
        const versaoControlador = await lerVersaoControlador(navigator.serviceWorker);
        const metadados = versaoControlador
            ? { version: versaoControlador }
            : await lerVersaoInstalada();
        const versaoDocumento = document.querySelector('meta[name="app-version"]')?.content;
        validarVersaoAplicacao({
            documento: versaoDocumento,
            bundle: VERSAO_BUNDLE,
            controlador: metadados.version
        });
        versaoInstalada = metadados.version;
        let versaoAguardando = null;
        try { versaoAguardando = sessionStorage.getItem(CHAVE_ATUALIZACAO_PENDENTE); } catch (_) {}
        if (versaoAguardando === metadados.version) {
            try { sessionStorage.removeItem(CHAVE_ATUALIZACAO_PENDENTE); } catch (_) {}
            registrarResultadoVerificacao(`Atualizado para a versão ${metadados.version}.`, metadados.version);
            ui.statusAtualizacao.textContent = `Aplicativo atualizado para a versão ${metadados.version}.`;
        }
        atualizarDiagnostico();
    } catch (erro) {
        versaoInstalada = "Indisponível";
        if (erro.message?.includes("arquivos da interface não correspondem")) {
            registrarResultadoVerificacao("Atualização não confirmada: os arquivos carregados não correspondem ao Service Worker ativo.");
        }
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
}
function aplicarPreferenciasVisuais() {
    const espacamentos = calcularEspacamentosDensidade(preferenciasMenu.densidade);
    Object.entries(espacamentos).forEach(([variavel, valor]) => {
        document.body.style.setProperty(variavel, valor);
    });
    ui.densidadeInterface.value = String(preferenciasMenu.densidade);
    ui.valorDensidadeInterface.value = `${preferenciasMenu.densidade}%`;
    ui.densidadeInterface.setAttribute("aria-valuetext", `${preferenciasMenu.densidade}%`);
    document.body.classList.toggle("graficos-ocultos", !preferenciasMenu.mostrarGraficos);
}
function aplicarVisibilidadeSecoes() {
    document.querySelector(".resumo").hidden = !preferenciasMenu.mostrarResumo;
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
    ui.mostrarResumo.checked = preferenciasMenu.mostrarResumo;
    ui.mostrarDespesas.checked = preferenciasMenu.mostrarDespesas;
    ui.mostrarEntradas.checked = preferenciasMenu.mostrarEntradas;
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
ui.densidadeInterface.addEventListener("input", () => {
    preferenciasMenu.densidade = Number(ui.densidadeInterface.value);
    aplicarPreferenciasVisuais();
    salvarPreferenciasMenu();
});
ui.mostrarGraficos.addEventListener("change", () => { preferenciasMenu.mostrarGraficos = ui.mostrarGraficos.checked; aplicarPreferenciasVisuais(); salvarPreferenciasMenu(); });
ui.mostrarResumo.addEventListener("change", () => {
    preferenciasMenu.mostrarResumo = ui.mostrarResumo.checked;
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
ui.abrirCalendarioResumo.addEventListener("click", () => {
    ui.dataCalendarioResumo.value = `${periodo.ano}-${String(periodo.mes).padStart(2, "0")}-01`;
    try {
        if (typeof ui.dataCalendarioResumo.showPicker === "function") ui.dataCalendarioResumo.showPicker();
        else ui.dataCalendarioResumo.click();
    } catch (_) {
        ui.dataCalendarioResumo.click();
    }
});
ui.dataCalendarioResumo.addEventListener("change", () => {
    const correspondencia = /^(\d{4})-(\d{2})-\d{2}$/.exec(ui.dataCalendarioResumo.value);
    if (correspondencia) mudarPeriodo(Number(correspondencia[1]), Number(correspondencia[2]));
});
ui.fecharCalculadora.addEventListener("click", () => ui.dialogoCalculadora.close());
document.querySelectorAll("[data-calculadora]").forEach((tecla) => {
    tecla.addEventListener("click", () => {
        ui.visorCalculadora.value += tecla.dataset.calculadora;
    });
});
$("limpar-calculadora").addEventListener("click", () => { ui.visorCalculadora.value = ""; });
$("apagar-calculadora").addEventListener("click", () => {
    ui.visorCalculadora.value = ui.visorCalculadora.value.slice(0, -1);
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
async function verificarAtualizacao({ automatico = false } = {}) {
    if (verificacaoAtualizacaoAtiva) return "em-andamento";
    verificacaoAtualizacaoAtiva = true;
    const botao = ui.atualizarApp;
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Verificando…";
    ui.statusAtualizacao.textContent = "Consultando a versão publicada e o estado do Service Worker…";

    try {
        if (!navigator.onLine) throw new Error("Você está offline; não foi possível verificar a versão publicada.");

        const [versaoControlador, publicada] = await Promise.all([
            lerVersaoControlador(navigator.serviceWorker),
            lerVersaoPublicada()
        ]);
        const instalada = versaoControlador
            ? { version: versaoControlador }
            : await lerVersaoInstalada();
        versaoInstalada = instalada.version;
        if (automatico && confirmacaoAtualizacao.foiAdiada(publicada.version)) {
            ui.statusAtualizacao.textContent = `A versão ${publicada.version} está disponível. A atualização foi adiada.`;
            return "adiada";
        }
        const resultado = await verificarComConfirmacao({
            instalada: instalada.version,
            publicada: publicada.version,
            confirmar: (versaoAtual, versaoNova) =>
                confirmacaoAtualizacao.confirmar(versaoAtual, versaoNova, automatico),
            atualizar: async () => {
                if (!("serviceWorker" in navigator)) throw new Error("Este navegador não oferece atualização por Service Worker.");
                const escopo = new URL("./", import.meta.url).href;
                const registro = await navigator.serviceWorker.getRegistration(escopo);
                if (!registro) throw new Error("O Service Worker deste aplicativo ainda não foi registrado.");
                const versaoAtivada = await instalarAtualizacao(
                    registro,
                    navigator.serviceWorker,
                    publicada.version
                );
                if (versaoAtivada !== publicada.version) {
                    throw new Error(`A versão ${publicada.version} não foi confirmada como controladora do aplicativo.`);
                }
                estadoServiceWorker = "Nova versão instalada e controlando esta página.";
                try { sessionStorage.setItem(CHAVE_ATUALIZACAO_PENDENTE, publicada.version); } catch (_) {}
                ui.statusAtualizacao.textContent = `Arquivos da versão ${publicada.version} assumiram o controle. Confirmando a interface após recarregar…`;
                window.location.reload();
            }
        });

        if (resultado === "cancelado") {
            registrarResultadoVerificacao(`Atualização ${publicada.version} disponível; atualização adiada pelo usuário.`, publicada.version);
            ui.statusAtualizacao.textContent = `Versão ${publicada.version} disponível. Você pode verificar novamente quando quiser.`;
            return "cancelado";
        }

        if (resultado === "atualizado") {
            const registro = await atualizarEstadoServiceWorker();
            if (registro) await registro.update();
            await atualizarEstadoServiceWorker();
            registrarResultadoVerificacao(`Aplicativo atualizado na versão ${instalada.version}.`, publicada.version);
            ui.statusAtualizacao.textContent = `O aplicativo já está atualizado na versão ${instalada.version}.`;
        }
        return resultado;
    } catch (erro) {
        if (!automatico) registrarResultadoVerificacao(`Falha na verificação: ${erro.message || "erro desconhecido"}.`);
        ui.statusAtualizacao.textContent = `Não foi possível concluir a verificação. ${erro.message || "Tente novamente quando houver conexão."}`;
        return "falha";
    } finally {
        verificacaoAtualizacaoAtiva = false;
        botao.disabled = false;
        botao.textContent = textoOriginal;
    }
}

const verificarAtualizacaoAutomaticamente = criarVerificadorAutomatico(
    () => verificarAtualizacao({ automatico: true })
);

function solicitarVerificacaoAutomatica() {
    if (!navigator.onLine) return;
    verificarAtualizacaoAutomaticamente().catch((erro) => {
        ui.statusAtualizacao.textContent = `Não foi possível verificar a atualização. ${erro.message || "Tente novamente quando houver conexão."}`;
    });
}

ui.atualizarApp.addEventListener("click", () => { void verificarAtualizacao(); });
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") solicitarVerificacaoAutomatica();
});
window.addEventListener("pageshow", (evento) => {
    if (evento.persisted) solicitarVerificacaoAutomatica();
});
window.addEventListener("online", solicitarVerificacaoAutomatica);
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
        void carregarVersaoInstalada();
    });
    navigator.serviceWorker.ready
        .then(atualizarEstadoServiceWorker)
        .catch((erro) => {
            estadoServiceWorker = `Não foi possível consultar o Service Worker: ${erro.message || "erro desconhecido"}.`;
            atualizarDiagnostico();
        });
}
if (document.readyState === "complete") solicitarVerificacaoAutomatica();
else window.addEventListener("load", solicitarVerificacaoAutomatica, { once: true });
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
if (recuperacaoFinanceira.protegido) {
    const possuiCopiaBruta = recuperacaoFinanceira.fontes().some((fonte) => typeof fonte.bruto === "string");
    avisar(
        "Dados financeiros existentes não puderam ser validados. A gravação automática foi bloqueada; restaure um backup válido em Opções.",
        {
            rotulo: possuiCopiaBruta ? "Baixar cópia preservada" : "Restaurar backup",
            executar: possuiCopiaBruta ? exportarCopiaDadosProtegidos : () => ui.arquivoBackup.click()
        }
    );
} else if (avisosInicializacao.length) {
    avisar(avisosInicializacao.join(" "));
}

/* Firebase synchronization UI is intentionally loaded lazily. */
const syncUi = { status: $("estado-sincronizacao"), account: $("conta-sincronizacao"), last: $("ultima-sincronizacao"), login: $("entrar-google"), retry: $("tentar-sincronizacao"), restore: $("sincronizar-backup-restaurado"), conflicts: $("abrir-conflitos-sincronizacao"), conflictDialog: $("dialogo-conflitos-sincronizacao"), conflictList: $("lista-conflitos-sincronizacao"), closeConflicts: $("fechar-conflitos-sincronizacao"), logout: $("sair-google"), enabledLine: $("ativar-sincronizacao-linha"), enabled: $("ativar-sincronizacao") };
let firebaseClient = null, syncUser = null, syncStopListener = null, syncSettingsStop = null, syncConflictsStop = null, syncRemoteRecords = [], syncRemoteSettings = null, settingsConflictActive = false, applyingRemoteSync = false;
const syncSessions = createSyncSessionGuard();
const isCurrentSyncSession = (session, uid) => syncSessions.isCurrent(session) && (syncUser?.uid || null) === (uid || null);
const syncMetaKey = (uid) => `controleFinanceiro:sync:${uid}`;
const readSyncMeta = (uid) => { try { return JSON.parse(localStorage.getItem(syncMetaKey(uid)) || "{}"); } catch { return {}; } };
const writeSyncMeta = (uid, meta) => localStorage.setItem(syncMetaKey(uid), JSON.stringify(meta));
function setSyncStatus(message, error = false) {
    const idioma = ui.idiomaInterface?.value || "pt-BR";
    const count = /^(?:Há |Sincronizado com )(\d+) conflito\(s\) (?:para revisar|para revisão)\.$/.exec(message);
    const conflitos = { en: (n) => `${n} sync conflict(s) need review.`, es: (n) => `Hay ${n} conflicto(s) de sincronización por revisar.`, fr: (n) => `${n} conflit(s) de synchronisation à examiner.`, de: (n) => `${n} Synchronisierungskonflikt(e) müssen geprüft werden.`, ja: (n) => `確認が必要な同期競合が ${n} 件あります。` };
    const text = count && idioma !== "pt-BR" ? conflitos[idioma](count[1]) : textoTraduzido(message, idioma);
    syncUi.status.textContent = text; syncUi.status.dataset.state = error ? "error" : ""; syncUi.retry.hidden = !error; syncUi.conflicts.hidden = !syncUser || !(readSyncMeta(syncUser.uid).conflicts || []).length;
}
function formatLastSync(date) { const idioma = ui.idiomaInterface?.value || "pt-BR"; const prefix = textoTraduzido("Última sincronização confirmada:", idioma); return `${prefix} ${new Date(date).toLocaleString(LOCALES[idioma] || LOCALES["pt-BR"])}`; }
function setFinancialStateKey(key, next) { chaveEstadoAtual = key; estado = normalizarEstado(next); const persisted = storage.escreverJson(key, estadoParaSalvar()); renderTudo(false); return persisted; }
function syncEntityKey(entry) { const value = `${entry.month}/${entry.type}/${entry.id}`; return [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function financialSettings(source = estado) { return { version: source.versao || 3, categories: source.categorias || [], theme: source.tema || "claro", budgets: source.orcamentos || { padrao: {}, meses: {} } }; }
function validarRegistrosRemotos(records) {
    const meses = {}, validos = [];
    for (const item of records) {
        if (!item || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month || "") || !["receitas", "despesas"].includes(item.type) || typeof item.id !== "string" || !item.id || typeof item.deleted !== "boolean") return null;
        if (item.deleted) { if (!validRemoteTombstone(item)) return null; validos.push(item); continue; }
        const allowed = ["month", "type", "id", "record", "deleted", "revision", "updatedAt", "_docId", "hasPendingWrites"];
        if (Object.keys(item).some((key) => !allowed.includes(key)) || typeof item.revision !== "string" || !item.revision || item.revision.length > 128
            || !item.updatedAt || !Number.isInteger(item.updatedAt.seconds) || !Number.isInteger(item.updatedAt.nanoseconds)
            || (item._docId !== undefined && typeof item._docId !== "string")
            || (item.hasPendingWrites !== undefined && typeof item.hasPendingWrites !== "boolean")
            || !item.record || typeof item.record !== "object" || Array.isArray(item.record) || item.record.id !== item.id) return null;
        const record = { ...item.record, id: item.id };
        meses[item.month] ||= { receitas: [], despesas: [] }; meses[item.month][item.type].push(record);
        validos.push({ ...item, record });
    }
    return validarBackup({ versao: 3, meses }) ? validos : null;
}
function validarConfiguracoesRemotas(settings) {
    return validateRemoteSettings(settings);
}
async function loadFirebaseSync() {
    if (!firebaseConfigurado(firebaseConfig)) { setSyncStatus("Configure o projeto Firebase neste dispositivo para habilitar o login."); return; }
    try { setSyncStatus("Conectando ao Firebase…"); const sdk = await import(new URL(`./firebase-sync.bundle.js?_release=${encodeURIComponent(VERSAO_BUNDLE || "local")}`, import.meta.url)); firebaseClient = sdk.criarFirebaseSync(firebaseConfig); await firebaseClient.ready(); firebaseClient.onUser(onFirebaseUser); }
    catch (error) { console.error(error); setSyncStatus("Firebase indisponível. Os dados locais continuam funcionando.", true); }
}
async function onFirebaseUser(user) {
    const session = syncSessions.begin(), uid = user?.uid || null;
    syncStopListener?.(); syncSettingsStop?.(); syncConflictsStop?.(); syncStopListener = null; syncSettingsStop = null; syncConflictsStop = null; syncUser = user || null; syncRemoteRecords = []; syncRemoteSettings = null;
    if (!user) { syncUi.account.textContent = ""; syncUi.login.hidden = false; syncUi.logout.hidden = true; syncUi.enabledLine.hidden = true; const local = storage.lerJsonResultado(CHAVE_ESTADO); if (chaveEstadoAtual !== CHAVE_ESTADO) setFinancialStateKey(CHAVE_ESTADO, local.estado === "valido" ? local.valor : normalizarEstado(null)); setSyncStatus("Somente neste dispositivo."); return; }
    syncUi.account.textContent = user.email || user.displayName || user.uid; syncUi.login.hidden = true; syncUi.logout.hidden = false; syncUi.enabledLine.hidden = false;
    const key = chaveLocalConta(user.uid), meta = readSyncMeta(user.uid); syncUi.enabled.checked = meta.enabled !== false;
    syncUi.restore.hidden = !meta.restoredPending;
    const saved = lerEstadoPersistido(key);
    chaveEstadoAtual = key; estado = normalizarEstado(null); renderTudo(false);
    if (saved.estado === "valido" && !setFinancialStateKey(key, saved.valor)) { setSyncStatus("Não foi possível persistir os dados locais desta conta. A sincronização foi pausada.", true); return; }
    else if (recuperacaoFinanceira.protegido) { setSyncStatus("Migração suspensa: recupere os dados locais protegidos antes de continuar.", true); return; }
    setSyncStatus("Carregando dados desta conta…");
    try {
        if (!syncUi.enabled.checked) { setSyncStatus("Sincronização desativada. Os dados permanecem locais."); return; }
        const remoteRaw = await firebaseClient.list(user.uid, { serverOnly: !meta.initialized });
        if (!isCurrentSyncSession(session, uid)) return;
        const remote = validarRegistrosRemotos(remoteRaw);
        if (!remote) throw new Error("Há lançamentos remotos inválidos; a migração foi interrompida para preservar os dados.");
        syncRemoteRecords = remote;
        const remoteSettings = await firebaseClient.getSettings(user.uid, { serverOnly: !meta.initialized });
        if (!isCurrentSyncSession(session, uid)) return;
        syncRemoteSettings = remoteSettings;
        if (!validarConfiguracoesRemotas(remoteSettings)) throw new Error("As configurações financeiras remotas são inválidas; nenhuma combinação foi aplicada.");
        const remoteConflicts = await firebaseClient.listConflicts(user.uid, { serverOnly: !meta.initialized });
        if (!isCurrentSyncSession(session, uid)) return;
        if (!validateRemoteConflicts(remoteConflicts)) throw new Error("Há conflitos remotos inválidos; os conflitos locais foram preservados.");
        const currentMeta = readSyncMeta(user.uid);
        currentMeta.conflicts = reconcileRemoteConflicts(currentMeta.conflicts, remoteConflicts);
        const remoteResolved = new Set(remoteConflicts.filter((item) => item?.resolved === true).map((item) => item.operationId));
        currentMeta.conflicts = currentMeta.conflicts.filter((item) => !remoteResolved.has(item.operationId || item.operation?.id));
        writeSyncMeta(user.uid, currentMeta);
        settingsConflictActive = (currentMeta.conflicts || []).some((conflict) => conflict.kind === "settings");
        if (!meta.initialized) {
            const anonymous = storage.lerJsonResultado(CHAVE_ESTADO);
            const localState = saved.estado === "valido" ? saved.valor : (anonymous.estado === "valido" ? anonymous.valor : normalizarEstado(null));
            const local = registrosFinanceiros(localState), validRemote = remote.filter((item) => item.month && item.type && item.id && item.record);
            const merged = combinarRegistros(local, validRemote);
            if (!confirm(`Primeiro vínculo com ${user.email || "esta conta"}.\n\nNeste dispositivo: ${local.length} lançamentos.\nNa nuvem: ${validRemote.length}.\nPossíveis duplicidades, que serão mantidas: ${merged.possiveisDuplicatas.length}.\nConflitos de mesmo ID, preservados dos dois lados: ${merged.conflitos.length}.\nConfigurações financeiras na nuvem: ${remoteSettings ? "sim" : "não"}.\n\nSerá guardado um backup local antes da combinação. Continuar?`)) { setSyncStatus("Vínculo aguardando sua confirmação.", true); return; }
            migrationBackup(localState, { get: (k) => localStorage.getItem(k), set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } } }, user.uid);
            const months = {};
            for (const item of merged.records) { months[item.month] ||= { receitas: [], despesas: [] }; months[item.month][item.type].push(item.record); }
            let next = normalizarEstado({ ...localState, meses: months });
            if (remoteSettings && jsonCanonico(financialSettings(next)) !== jsonCanonico({ version: remoteSettings.version, categories: remoteSettings.categories, theme: remoteSettings.theme, budgets: remoteSettings.budgets })) {
                const useLocal = confirm("As categorias, o tema ou os orçamentos diferem. OK mantém os deste dispositivo; Cancelar usa os da nuvem. As duas cópias serão preservadas no registro de conflito.");
                const conflictMeta = readSyncMeta(user.uid); conflictMeta.conflicts = [...(conflictMeta.conflicts || []), { kind: "settings", local: financialSettings(next), remote: remoteSettings }]; writeSyncMeta(user.uid, conflictMeta);
                if (!useLocal) next = normalizarEstado({ ...next, categorias: remoteSettings.categories, tema: remoteSettings.theme, orcamentos: remoteSettings.budgets });
            }
            if (!setFinancialStateKey(key, next)) throw new Error("Não foi possível salvar a cópia local antes da migração.");
            const latestMeta = readSyncMeta(user.uid);
            writeSyncMeta(user.uid, { ...latestMeta, enabled: true, migrationPending: true, conflicts: [...(latestMeta.conflicts || []), ...merged.conflitos] });
            await publishFirebaseState(next, remote);
            if (!isCurrentSyncSession(session, uid)) return;
            writeSyncMeta(user.uid, { ...readSyncMeta(user.uid), initialized: true, settingsBaseline: financialSettings(next) });
        }
        if (meta.initialized && !settingsConflictActive && remoteSettings && meta.settingsBaseline) {
            const baseline = meta.settingsBaseline, localNow = financialSettings(estado);
            const localChanged = jsonCanonico(localNow) !== jsonCanonico(baseline);
            const remoteNow = { version: remoteSettings.version, categories: remoteSettings.categories, theme: remoteSettings.theme, budgets: remoteSettings.budgets };
            const remoteChanged = jsonCanonico(remoteNow) !== jsonCanonico(baseline);
            if (localChanged && remoteChanged && jsonCanonico(localNow) !== jsonCanonico(remoteNow)) {
                settingsConflictActive = true;
                const current = readSyncMeta(user.uid); current.conflicts = [...(current.conflicts || []), { kind: "settings", local: localNow, remote: remoteSettings }]; writeSyncMeta(user.uid, current);
            } else if (remoteChanged && !localChanged) {
                estado = normalizarEstado({ ...estado, categorias: remoteSettings.categories, tema: remoteSettings.theme, orcamentos: remoteSettings.budgets });
                storage.escreverJson(chaveEstadoAtual, estadoParaSalvar()); renderTudo(false);
            }
        }
        if (syncUi.enabled.checked) { await publishFirebaseState(estado, syncRemoteRecords); if (!isCurrentSyncSession(session, uid)) return; }
        if (syncUi.enabled.checked && !readSyncMeta(user.uid).restoredPending) syncStopListener = firebaseClient.listen(user.uid, (records) => { if (isCurrentSyncSession(session, uid)) onRemoteRecords(records, session); }, (error) => { if (isCurrentSyncSession(session, uid)) { console.error(error); setSyncStatus("Erro ao observar alterações remotas.", true); } });
        if (syncUi.enabled.checked && !readSyncMeta(user.uid).restoredPending) syncSettingsStop = firebaseClient.listenSettings(user.uid, (value, snapshotMetadata) => { if (isCurrentSyncSession(session, uid)) onRemoteSettings(value, snapshotMetadata, session); }, (error) => { if (isCurrentSyncSession(session, uid)) { console.error(error); setSyncStatus("Erro ao observar configurações remotas.", true); } });
        if (syncUi.enabled.checked && !readSyncMeta(user.uid).restoredPending) syncConflictsStop = firebaseClient.listenConflicts(user.uid, (items) => { if (isCurrentSyncSession(session, uid)) onRemoteConflicts(items, session); }, (error) => { if (isCurrentSyncSession(session, uid)) { console.error(error); setSyncStatus("Erro ao recuperar conflitos remotos.", true); } });
        const current = readSyncMeta(user.uid); syncUi.last.textContent = current.lastConfirmed ? formatLastSync(current.lastConfirmed) : "Ainda não há sincronização confirmada.";
        setSyncStatus(!navigator.onLine ? "Offline — as alterações serão enviadas quando houver conexão." : current.outbox?.length ? "Aguardando envio." : current.conflicts?.length ? `Há ${current.conflicts.length} conflito(s) para revisar.` : current.lastConfirmed ? "Sincronizado" : "Aguardando primeira confirmação.");
    } catch (error) { if (!isCurrentSyncSession(session, uid)) return; console.error(error); setSyncStatus("Falha ao carregar a conta. Os dados locais foram mantidos.", true); }
}
async function publishFirebaseState(financialState, remote = syncRemoteRecords, skipSettings = false) {
    if (!syncUser || !syncUi.enabled.checked) return;
    const uid = syncUser.uid, session = syncSessions.current();
    if (readSyncMeta(uid).restoredPending) { setSyncStatus("Backup restaurado: confirme a combinação com a nuvem antes do envio."); return; }
    if (!navigator.onLine) { setSyncStatus("Offline — alterações pendentes."); return; }
    const remoteMap = new Map(remote.map((item) => [`${item.month}/${item.type}/${item.id}`, item]));
    const local = registrosFinanceiros(financialState), localKeys = new Set(local.map((item) => `${item.month}/${item.type}/${item.id}`));
    const meta = readSyncMeta(uid), previousOutbox = Array.isArray(meta.outbox) ? meta.outbox : [];
    const makeId = operationId;
    const candidates = [];
    for (const item of local) { const key = `${item.month}/${item.type}/${item.id}`, old = remoteMap.get(key); if (old?.deleted) { meta.conflicts = [...(meta.conflicts || []), { kind: "deleted-remotely", month: item.month, type: item.type, id: item.id, local: item.record, remote: old }]; continue; } if (old && JSON.stringify(old.record) === jsonCanonico(item.record)) continue; const entityKey = syncEntityKey(item), value = { month: item.month, type: item.type, id: item.id, record: item.record, deleted: false }; candidates.push({ id: makeId(entityKey, old?.revision || null, value), entityKey, baseRevision: old?.revision || null, value }); }
    for (const old of remote) { if (!old.deleted && !localKeys.has(`${old.month}/${old.type}/${old.id}`)) { const entityKey = syncEntityKey(old), value = { month: old.month, type: old.type, id: old.id, deleted: true }; candidates.push({ id: makeId(entityKey, old.revision || null, value), entityKey, baseRevision: old.revision || null, value }); } }
    const queued = coalesceOutbox(previousOutbox, candidates);
    meta.outbox = queued; writeSyncMeta(uid, meta);
    if (queued.length) {
        setSyncStatus("Sincronizando…");
        const localMetaStorage = {
            get: (key) => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; },
            set: (key, value) => localStorage.setItem(key, JSON.stringify(value))
        };
        await flushSyncQueue(uid, localMetaStorage, (accountUid, operation) => firebaseClient.commit(accountUid, operation));
        if (!isCurrentSyncSession(session, uid)) return;
    }
    const confirmed = readSyncMeta(uid); if (confirmed.outbox.length === 0) { confirmed.lastConfirmed = new Date().toISOString(); confirmed.migrationPending = false; writeSyncMeta(uid, confirmed); syncUi.last.textContent = formatLastSync(confirmed.lastConfirmed); }
    else setSyncStatus("Aguardando envio.");
    const settings = financialSettings(financialState), remoteValue = syncRemoteSettings && { version: syncRemoteSettings.version, categories: syncRemoteSettings.categories, theme: syncRemoteSettings.theme, budgets: syncRemoteSettings.budgets };
    let settingsConflict = false;
    if (!skipSettings && !settingsConflictActive && jsonCanonico(settings) !== jsonCanonico(remoteValue)) {
        const savedSettings = await firebaseClient.saveSettings(uid, settings, syncRemoteSettings?.revision || null);
        if (!isCurrentSyncSession(session, uid)) return;
        if (savedSettings.conflict) { const current = readSyncMeta(uid); current.conflicts = [...(current.conflicts || []), { kind: "settings", local: settings, remote: savedSettings.remote }]; writeSyncMeta(uid, current); settingsConflict = true; }
        else { syncRemoteSettings = { ...settings, revision: savedSettings.revision }; const current = readSyncMeta(uid); current.settingsBaseline = settings; writeSyncMeta(uid, current); }
    }
    if (!isCurrentSyncSession(session, uid)) return;
    const finalMeta = readSyncMeta(uid);
    if (settingsConflict) setSyncStatus("Conflito de configurações preservado para revisão.", true);
    else if (finalMeta.outbox?.length) setSyncStatus("Aguardando envio.");
    else if (finalMeta.conflicts?.length) setSyncStatus(`Há ${finalMeta.conflicts.length} conflito(s) para revisar.`);
    else setSyncStatus("Sincronizado");
}
function onRemoteSettings(remote, snapshotMetadata) {
    if (!remote || !syncUser || !syncUi.enabled.checked || snapshotMetadata?.hasPendingWrites) return;
    const mergedSettings = mergeRemoteSettings(estado, remote);
    if (!mergedSettings.valid) { setSyncStatus("As configurações remotas são inválidas. A cópia local foi preservada; corrija os dados na nuvem e tente novamente.", true); return; }
    const incoming = { version: remote.version, categories: remote.categories, theme: remote.theme, budgets: remote.budgets };
    if (settingsConflictActive || (syncRemoteSettings && syncRemoteSettings.revision !== remote.revision && jsonCanonico(financialSettings(estado)) !== JSON.stringify({ version: syncRemoteSettings.version, categories: syncRemoteSettings.categories, theme: syncRemoteSettings.theme, budgets: syncRemoteSettings.budgets }) && jsonCanonico(incoming) !== JSON.stringify({ version: syncRemoteSettings.version, categories: syncRemoteSettings.categories, theme: syncRemoteSettings.theme, budgets: syncRemoteSettings.budgets }))) {
        const meta = readSyncMeta(syncUser.uid); meta.conflicts = [...(meta.conflicts || []), { kind: "settings", local: financialSettings(estado), remote }]; writeSyncMeta(syncUser.uid, meta); setSyncStatus("Configurações alteradas em outro dispositivo; as duas versões foram preservadas.", true); return;
    }
    syncRemoteSettings = remote;
    if (jsonCanonico(financialSettings(estado)) !== jsonCanonico(incoming)) {
        applyingRemoteSync = true; estado = normalizarEstado(mergedSettings.state); storage.escreverJson(chaveEstadoAtual, estadoParaSalvar()); renderTudo(false); applyingRemoteSync = false;
    }
    const current = readSyncMeta(syncUser.uid); current.settingsBaseline = incoming; writeSyncMeta(syncUser.uid, current);
}
function onRemoteRecords(records, session = null) {
    if (!syncUser || !syncUi.enabled.checked) return;
    if (session !== null && !isCurrentSyncSession(session, syncUser.uid)) return;
    const validRecords = validarRegistrosRemotos(records);
    if (!validRecords) { setSyncStatus("Há lançamentos remotos inválidos. Os dados locais foram mantidos; nenhum envio foi feito.", true); return; }
    syncRemoteRecords = validRecords; records = validRecords;
    const next = structuredClone(estado); let changed = false;
    const metadata = readSyncMeta(syncUser.uid), pendingKeys = new Set((metadata.outbox || []).map((entry) => entry.entityKey));
    for (const item of records) { if (!item.month || !item.type || !item.id || (!item.deleted && !item.record)) continue; if (pendingKeys.has(syncEntityKey(item))) { if (!(metadata.conflicts || []).some((entry) => entry.kind === "remote-changed-while-pending" && entry.month === item.month && entry.type === item.type && entry.id === item.id && entry.remote?.revision === item.revision)) metadata.conflicts = [...(metadata.conflicts || []), { kind: "remote-changed-while-pending", month: item.month, type: item.type, id: item.id, local: next.meses?.[item.month]?.[item.type]?.find((r) => r.id === item.id), remote: item }]; continue; } next.meses ||= {}; next.meses[item.month] ||= { receitas: [], despesas: [] }; const list = next.meses[item.month][item.type], index = list.findIndex((r) => r.id === item.id); if (item.deleted) { if (index >= 0) { list.splice(index, 1); changed = true; } } else if (index < 0) { list.push(item.record); changed = true; } else if (!item.hasPendingWrites && jsonCanonico(list[index]) !== jsonCanonico(item.record)) { list[index] = item.record; changed = true; } }
    if ((metadata.conflicts || []).length) writeSyncMeta(syncUser.uid, metadata);
    if (changed) { applyingRemoteSync = true; estado = normalizarEstado(next); storage.escreverJson(chaveEstadoAtual, estadoParaSalvar()); renderTudo(false); applyingRemoteSync = false; }
}
function onRemoteConflicts(remoteConflicts, session) {
    if (!syncUser || !syncUi.enabled.checked || !isCurrentSyncSession(session, syncUser.uid)) return;
    if (!validateRemoteConflicts(remoteConflicts)) { setSyncStatus("Há conflitos remotos inválidos. A lista local foi preservada; corrija os dados na nuvem e tente novamente.", true); return; }
    const meta = readSyncMeta(syncUser.uid), before = meta.conflicts || [];
    const after = reconcileRemoteConflicts(before, remoteConflicts);
    const resolved = new Set(remoteConflicts.filter((item) => item?.resolved === true).map((item) => item.operationId));
    meta.conflicts = after.filter((item) => !resolved.has(item.operationId || item.operation?.id));
    writeSyncMeta(syncUser.uid, meta); settingsConflictActive = meta.conflicts.some((item) => item.kind === "settings");
    renderSyncConflicts();
    if (meta.conflicts.length) setSyncStatus(`Há ${meta.conflicts.length} conflito(s) para revisar.`);
}
window.addEventListener("finance-local-change", (event) => { if (!applyingRemoteSync && syncUser && event.detail.uid === syncUser.uid) { setSyncStatus(navigator.onLine ? "Aguardando envio." : "Offline — alterações pendentes."); if (navigator.onLine && syncUi.enabled.checked) void publishFirebaseState(event.detail.state).catch((error) => { console.error(error); setSyncStatus("Falha no envio. As alterações continuam salvas localmente.", true); }); } });
window.addEventListener("online", () => { if (syncUser) void publishFirebaseState(estado).catch(() => setSyncStatus("Falha no envio. Tente novamente.", true)); });
syncUi.login.addEventListener("click", () => { if (firebaseClient) void firebaseClient.login(); else void loadFirebaseSync().then(() => firebaseClient?.login()); });
syncUi.logout.addEventListener("click", () => { if (firebaseClient) void firebaseClient.logout(); });
syncUi.retry.addEventListener("click", () => { if (syncUser) void onFirebaseUser(syncUser); else void loadFirebaseSync(); });
syncUi.restore.addEventListener("click", async () => {
    if (!syncUser || !confirm("Combinar os registros do backup com os dados atuais da nuvem? Nenhum registro remoto ausente no backup será excluído.")) return;
    const session = syncSessions.current(), uid = syncUser.uid;
    try {
        const remote = await firebaseClient.list(uid);
        if (!isCurrentSyncSession(session, uid)) return;
        const merged = combinarRegistros(registrosFinanceiros(estado), remote.filter((item) => !item.deleted && item.record));
        const localSettings = financialSettings(estado), remoteSettings = syncRemoteSettings && { version: syncRemoteSettings.version, categories: syncRemoteSettings.categories, theme: syncRemoteSettings.theme, budgets: syncRemoteSettings.budgets };
        if (remoteSettings && jsonCanonico(localSettings) !== jsonCanonico(remoteSettings)) {
            const current = readSyncMeta(syncUser.uid); current.conflicts = [...(current.conflicts || []), { kind: "settings", local: localSettings, remote: syncRemoteSettings, source: "restored-backup" }]; writeSyncMeta(syncUser.uid, current); settingsConflictActive = true;
        }
        const months = {};
        for (const item of merged.records) { months[item.month] ||= { receitas: [], despesas: [] }; months[item.month][item.type].push(item.record); }
        estado = normalizarEstado({ ...estado, meses: months }); storage.escreverJson(chaveEstadoAtual, estadoParaSalvar()); renderTudo(false);
        const meta = readSyncMeta(uid); meta.restoredPending = false; meta.conflicts = [...(meta.conflicts || []), ...merged.conflitos]; writeSyncMeta(uid, meta);
        syncUi.restore.hidden = true; await publishFirebaseState(estado, remote, true); if (!isCurrentSyncSession(session, uid)) return; await onFirebaseUser(syncUser);
    } catch (error) { if (!isCurrentSyncSession(session, uid)) return; console.error(error); setSyncStatus("Não foi possível sincronizar o backup; a cópia local continua preservada.", true); }
});
syncUi.enabled.addEventListener("change", () => { if (!syncUser) return; const meta = readSyncMeta(syncUser.uid); meta.enabled = syncUi.enabled.checked; writeSyncMeta(syncUser.uid, meta); if (!meta.enabled) { syncStopListener?.(); syncSettingsStop?.(); syncConflictsStop?.(); syncStopListener = null; syncSettingsStop = null; syncConflictsStop = null; setSyncStatus("Sincronização desativada. Os dados permanecem locais."); } else void onFirebaseUser(syncUser); });
function renderSyncConflicts() {
    syncUi.conflictList.replaceChildren();
    const conflicts = syncUser ? readSyncMeta(syncUser.uid).conflicts || [] : [];
    syncUi.conflicts.hidden = conflicts.length === 0;
    conflicts.forEach((conflict, index) => {
        const row = document.createElement("section"); row.className = "ajustes-secao";
        const title = document.createElement("strong"); title.textContent = conflict.kind || "Conflito"; row.append(title);
        const details = document.createElement("pre"); details.className = "nota"; details.textContent = JSON.stringify(conflict, null, 2); row.append(details);
        const actions = document.createElement("div"); actions.className = "acoes";
        const choices = conflict.kind === "settings" ? [["local", "Manter configurações locais"], ["remote", "Usar configurações da nuvem"]] : [["local", "Manter versão local"], ["remote", "Usar versão da nuvem"], ["both", "Manter as duas versões"]];
        choices.forEach(([choice, label]) => { const button = document.createElement("button"); button.type = "button"; button.className = "btn btn-secundario"; button.textContent = label; button.addEventListener("click", () => void resolveSyncConflict(index, choice)); actions.append(button); });
        row.append(actions); syncUi.conflictList.append(row);
    });
}
async function resolveSyncConflict(index, choice) {
    if (!syncUser) return;
    const session = syncSessions.current(), conflictUserUid = syncUser.uid;
    const meta = readSyncMeta(syncUser.uid), conflict = meta.conflicts?.[index]; if (!conflict) return;
    if (conflict.kind === "settings") {
        const selected = choice === "local" ? conflict.local : conflict.remote;
        if (selected?.categories && selected?.budgets) { estado = normalizarEstado({ ...estado, categorias: selected.categories, tema: selected.theme, orcamentos: selected.budgets }); storage.escreverJson(chaveEstadoAtual, estadoParaSalvar()); renderTudo(false); syncRemoteSettings = choice === "remote" ? selected : syncRemoteSettings; if (choice === "remote") meta.settingsBaseline = financialSettings(estado); }
        } else {
        const operation = conflict.operation;
        const localItem = operation?.value || conflict.local;
        const remoteItem = conflict.remote;
        const item = localItem?.month ? localItem : conflict.month && localItem ? { ...conflict, record: localItem } : null;
        if (item?.month && item.type && item.id) {
            const month = item.month, type = item.type; estado.meses[month] ||= { receitas: [], despesas: [] }; const list = estado.meses[month][type];
            if (operation?.value?.deleted && choice !== "remote") {
                // The local deletion remains in force and will be retried against the newly reviewed revision.
            } else if (choice === "remote") {
                const at = list.findIndex((entry) => entry.id === item.id);
                if (!remoteItem || remoteItem.deleted) { if (at >= 0) list.splice(at, 1); }
                else if (at >= 0) list[at] = remoteItem.record || remoteItem; else list.push(remoteItem.record || remoteItem);
                if (conflict.preserved?.id) { const copied = list.findIndex((entry) => entry.id === conflict.preserved.id); if (copied >= 0) list.splice(copied, 1); }
            } else if (choice === "local" || choice === "both") {
                let wanted = item;
                if (choice === "both" || remoteItem?.deleted) { const sourceRecord = item.record || item; const recordId = `${item.id}-copy-${operationId(item.id, null, sourceRecord)}`; wanted = { ...item, id: recordId, record: { ...sourceRecord, id: recordId } }; }
                const record = wanted.record || wanted; const at = list.findIndex((entry) => entry.id === wanted.id);
                if (at >= 0) list[at] = record; else list.push(record);
                if (conflict.preserved?.id && choice === "local") { const copied = list.findIndex((entry) => entry.id === conflict.preserved.id); if (copied >= 0) list.splice(copied, 1); }
            }
            storage.escreverJson(chaveEstadoAtual, estadoParaSalvar()); renderTudo(false);
            if (choice !== "remote") { const currentRemote = syncRemoteRecords.find((entry) => entry.month === item.month && entry.type === item.type && entry.id === item.id); if (currentRemote) currentRemote.revision = remoteItem?.revision || currentRemote.revision; }
            meta.outbox = (meta.outbox || []).filter((entry) => entry.entityKey !== operation?.entityKey);
        }
    }
    if (conflict.source === "firestore" && conflict.operationId) {
        try {
            if (choice !== "remote") await publishFirebaseState(estado);
            if (!isCurrentSyncSession(session, conflictUserUid)) return;
            await firebaseClient.resolveConflict(conflictUserUid, conflict.operationId, choice);
            if (!isCurrentSyncSession(session, conflictUserUid)) return;
        } catch (error) { if (!isCurrentSyncSession(session, conflictUserUid)) return; console.error(error); setSyncStatus("A escolha foi salva localmente, mas não foi possível confirmar a resolução na nuvem. Tente novamente.", true); return; }
    } else if (choice !== "remote") {
        await publishFirebaseState(estado).catch((error) => { console.error(error); setSyncStatus("A escolha foi salva localmente e aguarda envio.", true); });
    }
    const latestMeta = readSyncMeta(conflictUserUid), targetOperationId = conflict.operationId || conflict.operation?.id;
    if (targetOperationId) latestMeta.conflicts = (latestMeta.conflicts || []).filter((entry) => (entry.operationId || entry.operation?.id) !== targetOperationId);
    else {
        const target = JSON.stringify(conflict), at = (latestMeta.conflicts || []).findIndex((entry) => JSON.stringify(entry) === target);
        if (at >= 0) latestMeta.conflicts.splice(at, 1);
    }
    settingsConflictActive = (latestMeta.conflicts || []).some((entry) => entry.kind === "settings"); writeSyncMeta(conflictUserUid, latestMeta); renderSyncConflicts();
}
syncUi.conflicts.addEventListener("click", () => { renderSyncConflicts(); syncUi.conflictDialog.showModal(); });
syncUi.closeConflicts.addEventListener("click", () => syncUi.conflictDialog.close());
if (firebaseConfigurado(firebaseConfig)) void loadFirebaseSync();
