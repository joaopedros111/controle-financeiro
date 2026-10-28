import { criarRecuperacaoFinanceira, storage } from "./storage.js";
import { abrirPersistenciaFinanceira } from "./indexeddb-persistence.js";
import { ServicoFinanceiroAtomico } from "./financial-atomic-service.js";
import { CATEGORIAS_PADRAO, CATEGORIA_FIXA, normalizarEstado as normalizarEstadoCore, normalizarValorMonetario, mesFinanceiroValido, validarBackup, validarTotaisMonetarios, migrarDadosLegados, calcularExpressao, somarCentavos, gerarCsv, agruparDespesasPorCategoria, agruparLancamentosComOrcamento, renomearCategoriaOrcamentos, removerCategoriaOrcamentos, criarSerieReceitas, listarReceitasDaSerie, editarReceita, excluirReceita } from "./finance-core.js";
import { apresentarValorFinanceiro, calcularEspacamentosDensidade, normalizarPreferenciasMenu, resolverTelaInicial } from "./preferences.js";
import { criarConfirmacaoAtualizacao, criarVerificadorAutomatico, instalarAtualizacao, lerVersaoControlador, lerVersaoInstalada, lerVersaoPublicada, validarVersaoAplicacao, verificarComConfirmacao } from "./update-manager.js";
import { aplicarIdioma, formatarMoeda as formatarMoedaLocalizada, LOCALES, textoTraduzido } from "./localization.js";
import { firebaseConfig, firebaseConfigurado } from "./firebase-config.js";
import { AutomaticFinanceSync } from "./automatic-finance-sync.js";
import { financeSettings, captureRejectedLocalEdit } from "./automatic-sync-policy.js";
import { chaveLocalConta, registrosFinanceiros, combinarRegistros, migrationBackup, operationId, jsonCanonico, recordsEquivalent, coalesceOutbox, flushSyncQueue, createSyncSessionGuard, validateRemoteSettings, mergeRemoteSettings, validRemoteTombstone, reconcileRemoteConflicts, validateRemoteConflicts, snapshotConfirmed, recordEntityKey, inspectRemoteKeys, validConflictRecord, readSyncMetadata, blockedConflictKeys, validSyncIdentity, financialStatesEquivalent, functionalSettings, settingsEquivalent, equivalentConflict, pendingConflictCount } from "./sync-core.js";



/* =========================================================

   Controle Financeiro

   Dados financeiros persistidos transacionalmente no IndexedDB.

   ========================================================= */



// Apenas para homologação em loopback. O fluxo Firebase permanece desabilitado neste modo.
const IDB_HOMOLOGACAO = ["localhost", "127.0.0.1"].includes(location.hostname)
    && new URL(location.href).searchParams.get("indexeddb_homologacao") === "1";
const CHAVE_ESTADO = "controleFinanceiro:v3";
const CHAVE_TEMA_INICIAL = "controleFinanceiro:tema-inicial";
const TEMAS_VALIDOS = ["claro", "escuro", "rosa", "pangolim", "floresta"];
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
    receitaRecebido: $("receita-recebido"),

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

function atualizarPosicaoDialogosAbertos() {
    const viewport = window.visualViewport;
    if (!viewport || !window.matchMedia("(max-width: 600px)").matches) return;
    const centro = `${Math.max(0, viewport.offsetTop) + viewport.height / 2}px`;
    document.querySelectorAll("dialog[open]").forEach((dialogo) => {
        dialogo.style.setProperty("--dialogo-viewport-center", centro);
        dialogo.style.setProperty("--dialogo-viewport-height", `${viewport.height}px`);
        if (![ui.dialogoDespesa, ui.dialogoReceita].includes(dialogo)) return;
        const campoAtivo = dialogo.contains(document.activeElement)
            && document.activeElement.matches("input:not([type=checkbox]), textarea");
        const alturaTeclado = document.documentElement.clientHeight - viewport.height - viewport.offsetTop;
        dialogo.classList.toggle("teclado-virtual-ativo", campoAtivo && alturaTeclado > 80);
    });
}

function agendarAtualizacaoPosicaoDialogos() {
    requestAnimationFrame(atualizarPosicaoDialogosAbertos);
}

let estadoRolagemFundoModal = null;
const estilosBloqueioRolagem = ["position", "top", "left", "right", "width", "overflow"];

function bloquearRolagemFundoModal() {
    if (estadoRolagemFundoModal) return;
    const corpo = document.body;
    const raiz = document.documentElement;
    estadoRolagemFundoModal = {
        x: window.scrollX,
        y: window.scrollY,
        estilos: Object.fromEntries(estilosBloqueioRolagem.map((propriedade) => [
            propriedade,
            [corpo.style.getPropertyValue(propriedade), corpo.style.getPropertyPriority(propriedade)]
        ])),
        overflowRaiz: [raiz.style.getPropertyValue("overflow"), raiz.style.getPropertyPriority("overflow")],
        gutterRaiz: [raiz.style.getPropertyValue("scrollbar-gutter"), raiz.style.getPropertyPriority("scrollbar-gutter")]
    };
    corpo.style.position = "fixed";
    corpo.style.top = `${-estadoRolagemFundoModal.y}px`;
    corpo.style.left = "0";
    corpo.style.right = "0";
    corpo.style.width = "auto";
    corpo.style.overflow = "hidden";
    raiz.style.overflow = "hidden";
    raiz.style.scrollbarGutter = "auto";
}

function restaurarRolagemFundoModal() {
    if (!estadoRolagemFundoModal || document.querySelector("dialog[open]")) return;
    const estadoSalvo = estadoRolagemFundoModal;
    estadoRolagemFundoModal = null;
    for (const [propriedade, [valor, prioridade]] of Object.entries(estadoSalvo.estilos)) {
        if (valor) document.body.style.setProperty(propriedade, valor, prioridade);
        else document.body.style.removeProperty(propriedade);
    }
    const raiz = document.documentElement;
    const [overflow, overflowPriority] = estadoSalvo.overflowRaiz;
    const [gutter, gutterPriority] = estadoSalvo.gutterRaiz;
    if (overflow) raiz.style.setProperty("overflow", overflow, overflowPriority);
    else raiz.style.removeProperty("overflow");
    if (gutter) raiz.style.setProperty("scrollbar-gutter", gutter, gutterPriority);
    else raiz.style.removeProperty("scrollbar-gutter");
    window.scrollTo(estadoSalvo.x, estadoSalvo.y);
}

function abrirDialogoModal(dialogo) {
    if (dialogo.open) return;
    bloquearRolagemFundoModal();
    try {
        dialogo.showModal();
        atualizarPosicaoDialogosAbertos();
    } catch (erro) {
        restaurarRolagemFundoModal();
        throw erro;
    }
}

window.visualViewport?.addEventListener("resize", agendarAtualizacaoPosicaoDialogos);
window.visualViewport?.addEventListener("scroll", agendarAtualizacaoPosicaoDialogos);
document.addEventListener("focusin", agendarAtualizacaoPosicaoDialogos);
document.addEventListener("focusout", () => setTimeout(agendarAtualizacaoPosicaoDialogos, 0));
for (const dialogo of document.querySelectorAll("dialog")) {
    dialogo.addEventListener("close", () => {
        dialogo.classList.remove("teclado-virtual-ativo");
        dialogo.style.removeProperty("--dialogo-viewport-center");
        dialogo.style.removeProperty("--dialogo-viewport-height");
        restaurarRolagemFundoModal();
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
let idbServico = null;
let automaticController = null;
let idbBanco = null;
let idbBloqueado = false;
let idbBase = null;
let idbGeneration = 'legacy';
let avisosFinanceiros = [];
let atualizacaoObrigatoria = false;
let idbPendente = Promise.resolve();
// The local-only application has no Firebase session. When synchronization is
// available its closure also guards same-UID session changes during persistence.
let capturarSessaoPersistencia = () => () => true;



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
    if (recuperacaoFinanceira.protegido || idbBloqueado || !idbServico) return;
    const proposta = structuredClone(estadoParaSalvar()), base = structuredClone(idbBase);
    const expectedGeneration = typeof idbGeneration === 'undefined' ? null : idbGeneration;
    if (!validarTotaisMonetarios(proposta)) { avisar("Os totais mensais excedem o limite monetário seguro."); return; }
    const key = chaveEstadoAtual, uid = key === CHAVE_ESTADO ? (IDB_HOMOLOGACAO ? "local" : "@local") : key.split(":").at(-1);
    idbBase = structuredClone(proposta);
    idbPendente = idbPendente.then(async () => {
        if (idbBloqueado) throw new Error("Persistencia bloqueada");
        const result = await idbServico.aplicarEdicao(uid, base, proposta, (changes, queue) =>
            key === CHAVE_ESTADO ? [] : changes.map(value => {
                if (!validSyncIdentity(value.id)) throw new Error("IDs locais incompat?veis");
                const entityKey = recordEntityKey(value);
                const prior = queue.outbox.filter(op => op.entityKey === entityKey).at(-1);
                const baseRevision = prior?.id || queue.remoteRevisions?.[entityKey] || null;
                return { id: operationId(entityKey, baseRevision, value), entityKey, baseRevision, value };
            }), queue => {
                if (key !== CHAVE_ESTADO && JSON.stringify([base?.categorias || [], base?.orcamentos || {}])
                    !== JSON.stringify([proposta.categorias || [], proposta.orcamentos || {}])) {
                    queue.automaticSettingsDirty = true;
                    queue.automaticSettingsValue = financeSettings(proposta);
                }
            }, () => true, expectedGeneration);
        if (key === chaveEstadoAtual && JSON.stringify(estadoParaSalvar()) === JSON.stringify(proposta)) {
            estado = normalizarEstado(result.estado.dados); idbBase = structuredClone(estadoParaSalvar()); renderTudo(false);
        }
        atualizarDiagnostico();
        if (typeof document === "undefined" || !document.querySelector?.(".aviso-acao")) avisar("Alterações confirmadas no armazenamento local IndexedDB.");
        if (key !== CHAVE_ESTADO) window.dispatchEvent(new CustomEvent("finance-local-change", { detail: { uid, state: result.estado.dados, deletedRecords: [] } }));
    }).catch(async error => {
        if (['sync/generation-changed', 'sync/restore-in-progress', 'sync/upgrade-required'].includes(error?.code)) {
            try {
                const queue = await idbServico.preservarEdicaoRejeitada(uid, base, proposta, error.code);
                const durable = await idbBanco.ler(`estado:${uid}`);
                if (key === chaveEstadoAtual) {
                    estado = normalizarEstado(durable.dados); idbBase = structuredClone(estadoParaSalvar()); idbGeneration = queue.generation || 'legacy';
                    renderAvisosFinanceiros({ recoveryNotices: queue.recoveryNotices, compatibilityBlocked: queue.compatibilityBlocked });
                    renderTudo(false);
                    avisar('A edição não foi aplicada porque ocorreu uma restauração ou incompatibilidade. A cópia está disponível em Baixar histórico.');
                }
                automaticController?.localChanged(); return;
            } catch (recoveryError) { error = recoveryError; }
        }
        if (error?.name === 'ConflitoEdicao' && typeof automaticController !== 'undefined' && automaticController?.session?.uid === uid) {
            try {
                await idbServico.alterarFila(uid, queue => captureRejectedLocalEdit(queue, base, proposta));
                const durable = await idbBanco.ler(`estado:${uid}`);
                if (key === chaveEstadoAtual) { estado = normalizarEstado(durable.dados); idbBase = structuredClone(estadoParaSalvar()); renderTudo(false); }
                avisar('Alteração concorrente preservada no histórico. Sincronizando automaticamente.');
                automaticController.localChanged(); return;
            } catch { /* Keep the original persistence failure visible below. */ }
        }
        idbBloqueado = true;
        if (typeof automaticController !== 'undefined') automaticController?.report(error);
        console.warn("Persistencia transacional interrompida.", error?.name);
        avisar("Outra aba alterou os mesmos dados ou houve falha na gravação. Nenhuma sobrescrita foi aplicada. Recarregue para revisar.");
    });
}

// O modo experimental funciona apenas com dados locais, sem Firebase.
// A inicialização precede o registro dos handlers e a liberação visual do app.
{
    try {
        if (recuperacaoFinanceira.protegido) throw new Error("Origem legada protegida");
        const legacy = lerEstadoPersistido(CHAVE_ESTADO);
        if (!["ausente", "valido"].includes(legacy.estado)) throw new Error("Origem local inválida");
        idbBanco = await abrirPersistenciaFinanceira();
        idbServico = new ServicoFinanceiroAtomico(idbBanco,
            (valor) => validarBackup(valor) && validarTotaisMonetarios(valor),
            (fila) => Boolean(fila && Array.isArray(fila.outbox) && Array.isArray(fila.conflicts)));
        const deviceUid = IDB_HOMOLOGACAO ? "local" : "@local";
        const previous = await idbBanco.ler("estado:local"), previousQueue = await idbBanco.ler("fila:local");
        if (!!previous !== !!previousQueue) throw new Error("Migracao experimental parcial");
        const result = await idbServico.inicializar(deviceUid, previous?.dados || estadoParaSalvar(),
            previousQueue || { outbox: [], conflicts: [], lastConfirmed: null, settingsPristine: legacy.estado === "ausente" && !previous && !migracaoLegadaPendente && !migracaoEstadoV2Pendente && !dadosStorageAntigoPendentes });
        estado = normalizarEstado(result.estado.dados);
        idbBase = structuredClone(estadoParaSalvar());
        window.addEventListener("pagehide", () => idbBanco?.fechar(), { once: true });
    } catch (error) {
        idbBloqueado = true;
        idbServico = null;
        console.warn("Inicialização transacional bloqueada.", error?.name || "unknown");
    }
}

async function persistirEstadoFinanceiro(key, next, localEdit = false, restored = false, firstLinkReviewed = false, editQueue = () => {}) {
    if (!idbServico || idbBloqueado || key !== chaveEstadoAtual) return false;
    const uid = key === CHAVE_ESTADO ? (IDB_HOMOLOGACAO ? "local" : "@local") : key.split(":").at(-1);
    const base = structuredClone(idbBase);
    const expectedGeneration = typeof idbGeneration === 'undefined' ? null : idbGeneration;
    const sessionCurrent = capturarSessaoPersistencia();
    const canPersist = () => sessionCurrent() && key === chaveEstadoAtual && !idbBloqueado;
    try {
        await idbPendente;
        if (!canPersist()) return false;
        if (restored && key === CHAVE_ESTADO) {
            const recoveryKey = `restore-recovery:${uid}:${globalThis.crypto.randomUUID()}`;
            const stateKey = `estado:${uid}`, queueKey = `fila:${uid}`;
            const restoredDocs = await idbBanco.alterarDocumentos([stateKey, queueKey, recoveryKey], docs => {
                if (!canPersist() || !validarBackup(next) || !validarTotaisMonetarios(next)) throw new Error('Restauração inválida.');
                const previous = docs.get(stateKey), queue = docs.get(queueKey);
                docs.set(recoveryKey, { state: structuredClone(previous.dados), queue: structuredClone(queue), reason: 'explicit-local-restore' });
                docs.set(stateKey, { ...previous, revisao: previous.revisao + 1, dados: structuredClone(next) });
                docs.set(queueKey, { outbox: [], conflicts: [], remoteRevisions: {}, recoveryKeys: [...(queue.recoveryKeys || []), recoveryKey] });
                return docs;
            });
            idbBase = structuredClone(restoredDocs.get(stateKey).dados); idbGeneration = 'legacy';
            return true;
        }
        const result = await idbServico.aplicarEdicao(uid, base, next, localEdit ? (changes, queue) => changes.map(value => {
            const entityKey = recordEntityKey(value), baseRevision = queue.remoteRevisions?.[entityKey] || null;
            return { id: operationId(entityKey, baseRevision, value), entityKey, baseRevision, value };
        }) : () => [], (queue, mergedState) => {
            editQueue(queue, mergedState);
            if (restored && key !== CHAVE_ESTADO) queue.restoredPending = true;
            if (firstLinkReviewed) {
                queue.firstLinkReviewed = true; queue.migrationPending = true;
                for (const conflict of firstLinkReviewed.conflicts || [])
                    if (!queue.conflicts.some(item => recordsEquivalent(item, conflict))) queue.conflicts.push(conflict);
            }
        }, canPersist, expectedGeneration);
        if (!canPersist()) return false;
        idbBase = structuredClone(result.estado.dados);
        return true;
    } catch (error) { if (sessionCurrent() && key === chaveEstadoAtual && error?.code !== 'persistence/cancelled') idbBloqueado = true; return false; }
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



    renderTudo(false);

}



/* ---------- Renderização ---------- */



function renderPeriodo() {

    ui.mes.value = String(periodo.mes);

    ui.ano.value = String(periodo.ano);

}



function renderTema() {



    let tema = estado.tema || "claro";
    if ((document.documentElement.classList.contains("app-inicializando")
        || document.documentElement.classList.contains("app-carregando-conta"))
        && TEMAS_VALIDOS.includes(document.documentElement.dataset.tema)) {
        tema = document.documentElement.dataset.tema;
    }
    const nomesTema = { claro: "Claro", escuro: "Escuro", rosa: "Rosa", pangolim: "Pangolim", floresta: "Selva" };
    const ordemTemas = ["claro", "escuro", "rosa", "pangolim", "floresta"];
    const proximoTema = ordemTemas[(ordemTemas.indexOf(tema) + 1) % ordemTemas.length];



    document.documentElement.dataset.tema = tema;
    try { localStorage.setItem(CHAVE_TEMA_INICIAL, tema); } catch { /* cache visual opcional */ }
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
    ui.tema.setAttribute("data-i18n-preserve-aria", "");
    ui.tema.setAttribute("aria-label", textoTraduzido("Tema atual:") + " " + textoTraduzido(nomesTema[tema])
        + ". " + textoTraduzido("Mudar para") + " " + textoTraduzido(nomesTema[proximoTema]) + ".");

}



function criarLinhaReceita(receita) {



    const linha = criarEl("div", {

        class: "receita",

        dataset: { id: receita.id }

    });



    const nome = receita.nome.trim() || textoTraduzido("Sem nome");
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

        criarEl("input", {
            type: "checkbox", class: "recebido-receita", checked: receita.recebido === true,
            title: receita.recebido ? "Marcar como a receber" : "Marcar como recebido",
            "aria-label": textoTraduzido("Entrada recebida") + ": " + nome,
            "data-i18n-preserve-aria": ""
        }),
        identificacao,
        criarEl("span", {
            class: receita.recebido ? "situacao situacao-paga" : "situacao situacao-pendente",
            text: receita.recebido ? "Recebido" : "A receber"
        }),

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
    criarEl("div", { class: "despesa-nome" }, [
        criarEl("span", {
            class: "nome-despesa",
            text: despesa.nome.trim() || textoTraduzido("Sem nome")
        }),
        ...marcaDaDespesa(despesa)
    ]),
    criarEl("input", {
        type: "checkbox",
        class: "pago-despesa",
        checked: despesa.pago,
        title: despesa.pago ? "Marcar como a pagar" : "Marcar como paga",
        "aria-label": "Despesa paga"
    }),

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

            "aria-label": "Editar despesa " + (despesa.nome.trim() || textoTraduzido("Sem nome")),

            text: "✎"

        }),

        criarEl("button", {

            type: "button",

            class: "remover-despesa",

            title: "Remover despesa",

            "aria-label": "Remover despesa " + (despesa.nome.trim() || textoTraduzido("Sem nome")),

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
        "data-i18n-preserve-aria": "",
        "aria-label": grupo.excedido ? `${grupo.categoria}, ${textoTraduzido("orçamento excedido")}` : grupo.categoria
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
        criarEl("div", { class: "despesa-grupo-itens" }, [...grupo.despesas]
            .sort((a, b) => a.nome.localeCompare(b.nome, LOCALES[idiomaAtual] || "pt-BR", { sensitivity: "base" }))
            .map(criarLinhaDespesa))
    ])));
    ui.vazioDespesas.hidden = despesas.length > 0;
    ui.vazioDespesas.textContent =
    "Toque em Adicionar para começar";
}



function corDaCategoria(nome) {

    const indice = Math.max(0, estado.categorias.indexOf(nome));

    return "hsl(" + ((indice * 47 + 160) % 360) + ", 55%, 48%)";

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
                criarEl("input", {
                    type: "number", min: "0", step: "0.01", inputMode: "decimal",
                    value: limitePadrao, placeholder: "Sem limite",
                    dataset: { orcamentoCampo: "padrao" },
                    "aria-label": `Limite mensal padrão para ${categoria}`
                })
            ]),
            criarEl("div", { class: "orcamento-acoes" }, [
                criarEl("button", {
                    type: "button", class: "btn btn-primario",
                    dataset: { orcamentoAcao: "salvar-padrao" }, text: "Salvar"
                }),
                criarEl("button", {
                    type: "button", class: "btn btn-perigo",
                    dataset: { orcamentoAcao: "remover-padrao" }, text: "Remover",
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



    renderIndicadoresPanorama(receitaCentavos, despesaCentavos);

    // Barra de comprometimento

    const pctDespesa = receita > 0 ? (despesa / receita) * 100 : 0;

    const baseBarra = Math.max(receita, despesa);
    const pctPago = baseBarra > 0 ? (pago / baseBarra) * 100 : 0;

    const pctPendente = baseBarra > 0

        ? (pendente / baseBarra) * 100

        : 0;



    ui.barraPago.style.width = pctPago + "%";

    ui.barraPendente.style.width = pctPendente + "%";

    ui.barra.setAttribute("role", "img");
    ui.barra.setAttribute("data-i18n-preserve-aria", "");
    ui.barra.setAttribute("aria-label", textoTraduzido("Pago") + ": " + formatarMoeda(pago)
        + "; " + textoTraduzido("Pendente no mês") + ": " + formatarMoeda(pendente));



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

    renderGraficoCategorias();

    atualizarDiagnostico();



    if (persistir) salvar();

}



function renderIndicadoresPanorama(receita, despesa) {
    const anterior = new Date(periodo.ano, periodo.mes - 2, 1);
    const dados = estado.meses[chaveMes(anterior.getFullYear(), anterior.getMonth() + 1)];
    const base = somarCentavos((dados?.despesas || []).map((d) => numero(d.valor)));
    const economia = receita > 0 ? (receita - despesa) / receita * 100 : null;
    const variacao = base > 0 ? (despesa - base) / base * 100 : despesa === 0 ? 0 : null;
    const apresentar = (valor, motivo) => valoresOcultos ? "••••" : valor === null
        ? textoTraduzido(motivo) : (valor > 0 ? "+" : "") + formatarPercentual(valor);
    $("taxa-economia").textContent = apresentar(economia, "Não calculável: sem entradas");
    const comparacaoPeriodo = new Intl.DateTimeFormat(LOCALES[idiomaAtual] || "pt-BR", {
        month: "long", year: "numeric"
    }).format(anterior);
    return { variacao: apresentar(variacao, "Não calculável: mês anterior sem despesas"), periodo: comparacaoPeriodo };
}

function renderGraficoCategorias() {
    const legenda = $("legenda-grafico-categorias");
    if (!legenda) return;

    const itens = agruparDespesasPorCategoria(obterMes().despesas)
        .sort((a, b) => a[0].localeCompare(b[0], LOCALES[idiomaAtual] || "pt-BR"));
    const total = somarCentavos(itens.map(([, valor]) => valor)) / 100;
    const rotuloMes = new Intl.DateTimeFormat(LOCALES[idiomaAtual] || "pt-BR", {
        month: "long",
        year: "numeric"
    }).format(new Date(periodo.ano, periodo.mes - 1, 1));
    $("periodo-grafico-categorias").textContent = rotuloMes;
    $("vazio-grafico-categorias").hidden = itens.length > 0;

    legenda.replaceChildren(...itens.map(([nome, valor]) => {
        const percentual = total > 0 ? (valor / total) * 100 : 0;
        const cor = criarEl("span", { class: "grafico-categoria-cor", "aria-hidden": "true" });
        cor.style.background = corDaCategoria(nome);
        const trilho = criarEl("span", { class: "categoria-trilho", "aria-hidden": "true" });
        const barra = criarEl("span", { class: "categoria-barra" });
        barra.style.width = percentual + "%";
        barra.style.background = corDaCategoria(nome);
        trilho.append(barra);
        return criarEl("li", { class: "grafico-categoria-item" }, [
            criarEl("span", { class: "grafico-categoria-nome" }, [cor, criarEl("span", { text: nome, title: nome })]),
            criarEl("span", { class: "grafico-categoria-medida" }, [
                trilho, criarEl("strong", { class: "grafico-categoria-valor", text: formatarMoeda(valor) })
            ]),
            criarEl("small", { class: "grafico-categoria-percentual", text: valoresOcultos ? "••••" : formatarPercentual(percentual) })
        ]);
    }));


}

function renderTudo(persistir = true) {

    renderTema();
    aplicarPrivacidade();
    aplicarPreferenciasVisuais();

    renderPeriodo();

    renderReceitas();

    renderDespesas();

    atualizarResumo(persistir);
    if (typeof renderAvisosFinanceiros === 'function') renderAvisosFinanceiros();

}

function renderAvisosFinanceiros(meta) {
    if (typeof document === 'undefined') return;
    if (meta) {
        avisosFinanceiros = (meta.recoveryNotices || []).filter(item => !item.acknowledged);
        atualizacaoObrigatoria = Boolean(meta.compatibilityBlocked);
    }
    const recovery = document.getElementById('aviso-recuperacao-financeira');
    if (recovery) {
        recovery.hidden = avisosFinanceiros.length === 0;
        const messages = [];
        if (avisosFinanceiros.some(item => item.code === 'rejected-edit')) messages.push(textoTraduzido('A edição não foi aplicada porque ocorreu uma restauração ou incompatibilidade. A cópia está disponível em Baixar histórico.'));
        if (avisosFinanceiros.some(item => item.code === 'archived-offline')) messages.push(textoTraduzido('Alterações locais anteriores à restauração ou atualização foram arquivadas sem aplicação. Estão disponíveis em Baixar histórico.'));
        const paragraph = recovery.querySelector('p'), text = messages.join(' ');
        if (paragraph.textContent !== text) paragraph.textContent = text;
    }
    const compatibility = document.getElementById('aviso-compatibilidade-financeira');
    if (compatibility) compatibility.hidden = !atualizacaoObrigatoria;
    const selectors = '.receita input,.receita button,.despesa input,.despesa button,#adicionar-receita,#adicionar-despesa,#form-receita input,#form-receita button[type="submit"],#form-despesa input,#form-despesa select,#form-despesa button[type="submit"],#lista-orcamentos input,#lista-orcamentos button,#lista-categorias button,#adicionar-categoria,#nova-categoria,#limpar-mes,#importar-backup';
    document.querySelectorAll(selectors).forEach(element => {
        if (atualizacaoObrigatoria && element.dataset.compatDisabled === undefined) {
            element.dataset.compatDisabled = String(element.disabled); element.disabled = true;
        } else if (!atualizacaoObrigatoria && element.dataset.compatDisabled !== undefined) {
            element.disabled = element.dataset.compatDisabled === 'true'; delete element.dataset.compatDisabled;
        }
    });
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

            // Explicit undo creates a new identity in a synced account; it must
            // not revive a tombstone that may already be confirmed elsewhere.
            const restaurado = automaticController?.session ? { ...item, id: uid() } : item;
            destino.splice(Math.min(indice, destino.length), 0, restaurado);

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
    ui.receitaRecebido.checked = receita?.recebido === true;
    ui.campoRepetirReceita.hidden = Boolean(receita);
    ui.receitaRepetir.checked = false;



    abrirDialogoModal(ui.dialogoReceita);

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

    const dados = { nome, valor, recebido: ui.receitaRecebido.checked };

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
        const titulo = botao.getAttribute("aria-controls") === "conteudo-receitas" ? "entradas" : "despesas";
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



ui.listaReceitas.addEventListener("change", (evento) => {
    const alvo = evento.target;
    if (!alvo.classList.contains("recebido-receita")) return;
    const linha = alvo.closest(".receita");
    const receita = obterMes().receitas.find((item) => item.id === linha?.dataset.id);
    if (!receita) return;
    receita.recebido = alvo.checked;
    renderReceitas();
    atualizarResumo();
    ui.listaReceitas.querySelector('.receita[data-id="' + receita.id + '"] .recebido-receita')?.focus();
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

    ui.despesaCategoria.value = despesa
        ? despesa.categoria
        : (estado.categorias.includes(CATEGORIA_FIXA) ? CATEGORIA_FIXA : estado.categorias[0] || "");

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



    abrirDialogoModal(ui.dialogoDespesa);

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

    return despesa.nome.trim() || textoTraduzido("Sem nome");

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



    abrirDialogoModal(ui.dialogoSerie);

}

function pedirEscolhaDaSerieReceita(receita, futuras) {
    receitaParaRemover = receita;
    despesaParaRemover = null;
    ui.tituloSerie.textContent = "Remover entrada";
    ui.textoSerie.textContent = `\"${receita.nome}\" tem ${futuras} ocorrência${futuras === 1 ? "" : "s"} futura${futuras === 1 ? "" : "s"}. Deseja excluir também as ocorrências futuras?`;
    ui.serieSoEste.textContent = "Só esta entrada";
    ui.serieProximos.textContent = "Esta e as futuras";
    abrirDialogoModal(ui.dialogoSerie);
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



    const entrada = prompt(textoTraduzido("Novo nome para a categoria “" + antigo + "”:"), antigo);



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

    if (estado.categorias.length <= 1) {
        avisar("Mantenha pelo menos uma categoria.");
        return;
    }



    const emUso = Object.values(estado.meses)

        .reduce((soma, mes) => soma + mes.despesas.filter((d) => d.categoria === nome).length, 0);



    const categoriaDestino = estado.categorias.find((categoria) => categoria !== nome) || CATEGORIA_FIXA;
    const aviso = emUso
        ? "Remover " + nome + "? As " + emUso + " despesa(s) dessa categoria passarão para " + categoriaDestino + "."
        : "Remover a categoria " + nome + "?";



    if (!confirm(textoTraduzido(aviso))) return;



    estado.categorias = estado.categorias.filter((c) => c !== nome);
    estado.orcamentos = removerCategoriaOrcamentos(estado.orcamentos, nome);



    Object.values(estado.meses).forEach((mes) => {

        mes.despesas.forEach((d) => {

            if (d.categoria === nome) d.categoria = categoriaDestino;

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
    abrirDialogoModal(ui.dialogoOrcamentos);
});
ui.abrirLimitesOrcamento.addEventListener("click", () => {
    renderListaOrcamentos();
    mostrarPainelOrcamentos("limites");
    ui.dialogoAjustes.close();
    abrirDialogoModal(ui.dialogoOrcamentos);
});
ui.dialogoOrcamentos.addEventListener("click", (evento) => {
    if (evento.target === ui.dialogoOrcamentos) {
        ui.dialogoOrcamentos.close();
        return;
    }

    if (evento.target.closest("[data-orcamento-voltar]")) {
        const controle = ui.painelCategoriasOrcamento.hidden
            ? ui.abrirLimitesOrcamento
            : ui.abrirCategoriasOrcamento;

        ui.dialogoOrcamentos.close();
        abrirDialogoModal(ui.dialogoAjustes);
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

        && !confirm(textoTraduzido("Este mês já tem lançamentos. Adicionar os de " + nomeMes(mes) + " junto com eles?"))) {

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



    if (!confirm(textoTraduzido("Apagar todas as entradas e despesas de " + nomeMes(periodo.mes) + " de " + periodo.ano + "? Essa ação não pode ser desfeita."))) {

        return;

    }



    mes.receitas = [];

    mes.despesas = [];



    renderReceitas();

    renderDespesas();

    atualizarResumo();

    avisar("Mês limpo.");

}



function excluirTudo() {
    const total = Object.values(estado.meses).reduce(
        (soma, mes) => soma + mes.receitas.length + mes.despesas.length, 0
    );
    if (!total) {
        avisar("Não há lançamentos para excluir.");
        return;
    }
    if (!confirm(textoTraduzido("Excluir todas as entradas e despesas de todos os meses? Essa ação não pode ser desfeita."))) return;
    Object.values(estado.meses).forEach((mes) => {
        mes.receitas = [];
        mes.despesas = [];
    });
    renderReceitas();
    renderDespesas();
    atualizarResumo();
    avisar("Todos os lançamentos foram excluídos.");
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



    leitor.onload = async () => {



        let bruto;



        try {

            bruto = JSON.parse(String(leitor.result));

        } catch (erro) {

            avisar("Arquivo inválido. Escolha um backup gerado por este aplicativo.");

            return;

        }



        if (automaticController?.session) {
            try {
                const imported = await automaticController.importBackup(bruto, () => confirm(textoTraduzido("Restaurar o backup? Todos os dados atuais serão substituídos.")));
                if (!imported) return;
                estado = normalizarEstado(imported); idbBase = structuredClone(estadoParaSalvar());
                ultimaRemocao = null; renderTudo(false);
                registrarOperacaoDados("Backup restaurado em " + new Date().toLocaleString("pt-BR") + ".");
                avisar("Backup salvo localmente. Sincronizando automaticamente.");
            } catch (error) { avisar(error.message || "Falha ao persistir; dados anteriores preservados."); }
            return;
        }
        const resultado = await recuperacaoFinanceira.restaurar({
            chave: chaveEstadoAtual, backup: bruto, validar: validarBackup,
            normalizar: backup => { const novo = normalizarEstado(backup); novo.tema ||= estado.tema; return novo; },
            confirmar: () => confirm(textoTraduzido("Restaurar o backup? Todos os dados atuais serão substituídos.")),
            persistir: (key, next) => persistirEstadoFinanceiro(key, next, false, true)
        });
        if (resultado.estado === "invalido") { avisar("Arquivo inválido."); return; }
        if (resultado.estado === "cancelado") return;
        if (!resultado.persistido) { avisar("Falha ao persistir; dados anteriores preservados."); return; }
        estado = resultado.dados;
        ultimaRemocao = null;
        renderTudo(false);

        window.dispatchEvent(new CustomEvent("finance-backup-restored"));



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
$("excluir-tudo").addEventListener("click", excluirTudo);

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
    return window.confirm(textoTraduzido(
        `Uma nova versão do Controle Financeiro está disponível.\n\nVersão instalada: ${versaoAtual}\nVersão disponível: ${versaoNova}\n\nDeseja atualizar agora?`
    ));
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
    ui.diagnosticoDados.replaceChildren(
        criarEl("span", { text: `${receitas + despesas} lançamentos (${receitas} receitas, ${despesas} despesas) · ${categorias} categorias · ` }),
        criarEl("span", { text: armazenamento }),
        criarEl("span", { text: recuperacao })
    );
    ui.ultimaOperacaoDados.textContent = preferenciasMenu.ultimaOperacao;
    ui.versaoInstalada.textContent = versaoInstalada;
    ui.versaoPublicada.textContent = preferenciasMenu.versaoPublicada;
    ui.dataVerificacaoAtualizacao.textContent = preferenciasMenu.ultimaVerificacao;
    ui.resultadoVerificacaoAtualizacao.textContent = preferenciasMenu.resultadoVerificacao;
    ui.diagnosticoApp.replaceChildren(
        criarEl("span", { text: estadoServiceWorker + " " }),
        criarEl("span", { text: storage.persistente ? "Armazenamento: persistente disponível." : "Armazenamento: somente memória; os dados podem se perder ao recarregar ou fechar o app." })
    );
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
        ui.despesaValor
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
    renderTudo(false);
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
    abrirDialogoModal(ui.dialogoAjustes);
});
ui.fecharAjustes.addEventListener("click", () => ui.dialogoAjustes.close());
ui.abrirCalculadora.addEventListener("click", () => abrirDialogoModal(ui.dialogoCalculadora));
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
        ui.visorCalculadora.setCustomValidity(textoTraduzido("Expressão inválida"));
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
async function verificarAtualizacao({ automatico = false, obrigatoria = false } = {}) {
    obrigatoria ||= !automatico && atualizacaoObrigatoria;
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
        if (!obrigatoria && automatico && confirmacaoAtualizacao.foiAdiada(publicada.version)) {
            ui.statusAtualizacao.textContent = `A versão ${publicada.version} está disponível. A atualização foi adiada.`;
            return "adiada";
        }
        const resultado = await verificarComConfirmacao({
            instalada: instalada.version,
            publicada: publicada.version,
            obrigatoria,
            confirmar: (versaoAtual, versaoNova) =>
                confirmacaoAtualizacao.confirmar(versaoAtual, versaoNova, automatico),
            atualizar: async () => {
                await idbPendente;
                if (idbBloqueado) throw new Error('Preserve os dados locais antes de atualizar: a persistência está bloqueada.');
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

        if (resultado === "atualizado" && obrigatoria) {
            ui.statusAtualizacao.textContent = textoTraduzido('Atualização obrigatória: esta versão não é compatível com a geração da conta. Os dados locais foram preservados.');
            return 'incompativel';
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
document.getElementById('atualizar-compatibilidade-financeira')?.addEventListener('click', () => { void verificarAtualizacao({ obrigatoria: true }); });
document.getElementById('baixar-recuperacao-financeira')?.addEventListener('click', () => document.getElementById('exportar-historico-recuperacao')?.click());
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



renderTudo(false);
aplicarPreferenciasMenu();
aplicarPrivacidade();
atualizarDiagnostico();
const telaInicialAplicada = abrirSecaoInicial();
function concluirCarregamentoConta() {
    document.documentElement.classList.remove("app-inicializando", "app-carregando-conta");
    document.body.removeAttribute("aria-busy");
    $("carregando-aplicativo")?.setAttribute("hidden", "");
    renderTema();
}
function iniciarCarregamentoConta() {
    document.documentElement.classList.add("app-carregando-conta");
    document.body.setAttribute("aria-busy", "true");
    $("carregando-aplicativo")?.removeAttribute("hidden");
}
document.body.setAttribute("aria-busy", "true");
if (IDB_HOMOLOGACAO || !firebaseConfigurado(firebaseConfig) || !$('entrar-google') || !$('sair-google')) {
    concluirCarregamentoConta();
}
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
if (IDB_HOMOLOGACAO) avisosInicializacao.push(idbBloqueado
    ? "Homologação IndexedDB bloqueada: não edite dados até recuperar o armazenamento."
    : "Modo experimental IndexedDB ativo neste navegador. Não use com dados reais ou abas da versão anterior; Firebase desativado.");
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
const syncUi = { status: $("estado-sincronizacao"), account: $("conta-sincronizacao"), last: $("ultima-sincronizacao"), login: $("entrar-google"), retry: null, restore: null, conflicts: null, conflictDialog: null, conflictList: null, closeConflicts: null, logout: $("sair-google"), enabledLine: null, enabled: null };
// Retained for historical invariant tests only. Never bind the old manual coordinator.
const LEGACY_MANUAL_SYNC_ENABLED = false;
if (LEGACY_MANUAL_SYNC_ENABLED && Object.values(syncUi).every(Boolean)) {
let firebaseClient = null, syncUser = null, syncStopListener = null, syncSettingsStop = null, syncConflictsStop = null, syncRemoteRecords = [], syncRemoteSettings = null, syncRemoteRecordsLoaded = false, settingsConflictActive = false, applyingRemoteSync = false;
const syncSessions = createSyncSessionGuard();
const isCurrentSyncSession = (session, uid) => syncSessions.isCurrent(session) && (syncUser?.uid || null) === (uid || null);
capturarSessaoPersistencia = () => {
    const session = syncSessions.current(), uid = syncUser?.uid || null;
    return () => isCurrentSyncSession(session, uid);
};
const syncMetaKey = (uid) => `controleFinanceiro:sync:${uid}`;
const META_BASE = Symbol("metadata-base");
const META_SESSION = Symbol("metadata-session");
const readSyncMeta = async (uid) => { const session = syncSessions.current(); const value = await idbServico.lerFila(uid); return { ...value, [META_BASE]: structuredClone(value), [META_SESSION]: { session, uid } }; };
const writeSyncMeta = async (uid, meta) => {
    const owner = meta[META_SESSION];
    const session = owner?.session;
    const valid = () => owner?.uid === uid && isCurrentSyncSession(session, uid);
    if (!valid()) throw Object.assign(new Error("Metadata session invalidated"), { code: "persistence/cancelled" });
    const base = meta[META_BASE];
    if (!base) throw new Error("Metadados sem base transacional");
    const saved = await idbServico.alterarFila(uid, current => {
        if (!valid()) throw Object.assign(new Error("Metadata session invalidated"), { code: "persistence/cancelled" });
        for (const key of Object.keys(meta)) {
            if (JSON.stringify(base[key]) === JSON.stringify(meta[key])) continue;
            if (key === "lastConfirmed") {
                if (!current.outbox.length && !current.conflicts.length && !current.conflictDecisions?.some(item => item.status !== 'confirmed') && (!current.lastConfirmed || meta[key] > current.lastConfirmed)) current[key] = meta[key];
            } else if (key === "remoteRevisions") {
                current[key] ||= {};
                for (const [entity,revision] of Object.entries(meta[key] || {})) {
                    if (current[key][entity] === base[key]?.[entity] || current[key][entity] === revision) current[key][entity] = revision;
                }
            } else if (["outbox", "conflicts"].includes(key)) {
                const identity = item => key === "outbox" ? item.id : JSON.stringify(item);
                const before = new Set((base[key] || []).map(identity));
                const after = new Set((meta[key] || []).map(identity));
                const decisionFor = item => current.conflictDecisions?.find(decision => equivalentConflict(decision.conflict, item));
                current[key] = (current[key] || []).filter(item => {
                    const decision = key === 'conflicts' && decisionFor(item);
                    return key === 'outbox' || decision && decision.status !== 'confirmed'
                        || !before.has(identity(item)) || after.has(identity(item));
                });
                for (const item of meta[key] || []) if (!before.has(identity(item)) && !current[key].some(x => identity(x) === identity(item))
                    && !(key === 'conflicts' && item.kind !== 'settings' && decisionFor(item)?.status === 'confirmed')) current[key].push(structuredClone(item));
            } else {
                if (JSON.stringify(current[key]) !== JSON.stringify(base[key]) && JSON.stringify(current[key]) !== JSON.stringify(meta[key])) throw new Error("Metadados alterados por outra aba");
                current[key] = structuredClone(meta[key]);
            }
        }
        return current;
    }).catch(error => {
        if (valid() && error?.code !== 'persistence/cancelled') idbBloqueado = true;
        throw error;
    });
    updateSettingsConflictActive(uid, saved, session);
    return saved;
};
function setSyncStatus(message, error = false) {
    syncUi.status.textContent = message; syncUi.status.dataset.state = error ? "error" : ""; syncUi.retry.hidden = !error;
    void renderSyncConflicts().catch(() => {});
}
function formatLastSync(date) {
    if (syncUi.last.dataset) syncUi.last.dataset.i18nDate = String(date);
    return `Última sincronização confirmada: ${new Date(date).toLocaleString(LOCALES["pt-BR"])}`;
}
function resetFinancialInteractions() {
    ultimaRemocao = null; receitaEmEdicao = null; receitaSerieEmCriacao = null;
    despesaEmEdicao = null; despesaParaRemover = null; receitaParaRemover = null;
    clearTimeout(temporizadorAviso); temporizadorAviso = null;
    ui.aviso?.replaceChildren(); ui.aviso?.classList.remove("visivel", "com-acao");
    for (const name of ["dialogoReceita", "dialogoDespesa", "dialogoSerie", "dialogoOrcamentos"]) ui[name]?.close();
    for (const name of ["receitaNome", "receitaValor", "despesaNome", "despesaValor"]) if (ui[name]) ui[name].value = "";
    syncUi.conflictDialog?.close();
}
async function setFinancialStateKey(key, next, isCurrent = capturarSessaoPersistencia(), review = true) {
    if (!isCurrent() || chaveEstadoAtual !== key) return false;
    const persisted = await persistirEstadoFinanceiro(key, normalizarEstado(next), false, false, review);
    if (!isCurrent() || chaveEstadoAtual !== key) return false;
    if (persisted) { estado = normalizarEstado(idbBase); renderTudo(false); }
    return persisted;
}
function syncEntityKey(entry) { return recordEntityKey(entry); }
function financialSettings(source = estado) { return { version: source.versao || 3, categories: [...(source.categorias || [])].sort(), theme: source.tema || "claro", budgets: source.orcamentos || { padrao: {}, meses: {} } }; }
function updateSettingsConflictActive(uid, meta, session = syncSessions.current()) {
    if (isCurrentSyncSession(session, uid)) settingsConflictActive = (meta.conflicts || []).some(item => item.kind === "settings");
}
async function registerSettingsConflict(uid, local, remote, source, session = syncSessions.current()) {
    let meta;
    try { meta = await idbServico.registrarConflitoSettings(uid, { kind: "settings", local, remote, ...(source ? { source } : {}) }, () => isCurrentSyncSession(session, uid) && !idbBloqueado); }
    catch (error) { if (isCurrentSyncSession(session, uid) && error?.code !== 'persistence/cancelled') idbBloqueado = true; throw error; }
    updateSettingsConflictActive(uid, meta, session);
    return meta;
}
async function rememberSettingsBaseline(uid, settings, session) {
    const baseline = functionalSettings(settings);
    let meta;
    try { meta = await idbServico.alterarFila(uid, queue => {
            if (!isCurrentSyncSession(session, uid) || idbBloqueado) throw Object.assign(new Error('Sessão de persistência invalidada'), { code: 'persistence/cancelled' });
            if (!queue.conflicts.some(item => item.kind === "settings")) queue.settingsBaseline = baseline;
            return queue;
        });
    } catch (error) { if (isCurrentSyncSession(session, uid) && error?.code !== 'persistence/cancelled') idbBloqueado = true; throw error; }
    updateSettingsConflictActive(uid, meta, session);
}
function validarRegistrosRemotos(records) {
    if (!Array.isArray(records) || inspectRemoteKeys(records).duplicates.length) return null;
    const meses = {}, validos = [];
    for (const item of records) {
        if (!item || !mesFinanceiroValido(item.month) || !["receitas", "despesas"].includes(item.type) || typeof item.id !== "string" || !item.id.trim() || typeof item.deleted !== "boolean") return null;
        if (item.deleted) { if (!validRemoteTombstone(item)) return null; validos.push(item); continue; }
        const allowed = ["month", "type", "id", "record", "deleted", "revision", "updatedAt", "_docId", "hasPendingWrites"];
        if (Object.keys(item).some((key) => !allowed.includes(key)) || typeof item.revision !== "string" || !item.revision || item.revision.length > 128
            || !item.updatedAt || !Number.isInteger(item.updatedAt.seconds) || !Number.isInteger(item.updatedAt.nanoseconds)
            || (item._docId !== undefined && typeof item._docId !== "string")
            || (item.hasPendingWrites !== undefined && typeof item.hasPendingWrites !== "boolean")
            || !item.record || typeof item.record !== "object" || Array.isArray(item.record) || item.record.id !== item.id
            || !validConflictRecord(item, { remote: true })) return null;
        const record = { ...item.record, id: item.id, valor: normalizarValorMonetario(item.record.valor) };
        meses[item.month] ||= { receitas: [], despesas: [] }; meses[item.month][item.type].push(record);
        validos.push({ ...item, record });
    }
    return validarBackup({ versao: 3, meses }) ? validos : null;
}
function validarConfiguracoesRemotas(settings) {
    return validateRemoteSettings(settings);
}
function googleAuthMessage(error) {
    switch (error?.code) {
        case 'auth/popup-closed-by-user': case 'auth/cancelled-popup-request': return 'Login cancelado. Seus dados continuam neste dispositivo.';
        case 'auth/popup-blocked': case 'auth/operation-not-supported-in-this-environment': return 'Permita popups e tente novamente. No iPhone/iPad ou aplicativo instalado, abra este mesmo endereco no Safari ou Chrome para entrar.';
        case 'auth/network-request-failed': return 'Sem conexao com o Google. Verifique a internet e tente novamente.';
        case 'auth/unauthorized-domain': return 'Este dominio nao esta autorizado no Firebase Authentication. Contate o responsavel pelo aplicativo.';
        case 'auth/operation-not-allowed': return 'O login Google nao esta habilitado neste projeto Firebase.';
        case 'auth/web-storage-unsupported': return 'O navegador bloqueou o armazenamento da sessao. Abra em uma janela normal do navegador.';
        default: return 'Nao foi possivel entrar com Google. Tente novamente no navegador. Codigo: ' + (error?.code || 'indisponivel');
    }
}
let firebaseInitPromise = null, firebaseReady = false, googleLoginPending = false;
let googleAuthUser = null, googleAuthRevision = 0;
let firebaseAuthStop = null, firebaseAuthGeneration = 0;
function stopFirebaseAuthObserver() {
    const stop = firebaseAuthStop;
    firebaseAuthStop = null;
    firebaseAuthGeneration += 1;
    firebaseReady = false;
    stop?.();
}
function updateGoogleLoginButton() {
    syncUi.login.disabled = !!(firebaseInitPromise || googleLoginPending || googleAuthUser || syncUser);
}
function setGoogleAuthUser(user) {
    googleAuthUser = user || null;
    googleAuthRevision += 1;
    updateGoogleLoginButton();
}
function loadFirebaseSync() {
    if (firebaseInitPromise) return firebaseInitPromise;
    if (firebaseReady) { updateGoogleLoginButton(); return Promise.resolve(); }
    if (IDB_HOMOLOGACAO) { setSyncStatus("Firebase desativado no ensaio IndexedDB."); return Promise.resolve(); }
    if (!firebaseConfigurado(firebaseConfig)) { setSyncStatus("Configure o projeto Firebase neste dispositivo para habilitar o login."); return Promise.resolve(); }
    firebaseInitPromise = (async () => {
        try {
            setSyncStatus("Conectando ao Firebase...");
            const sdk = await import(new URL(`./firebase-sync.bundle.js?_release=${encodeURIComponent(VERSAO_BUNDLE || "local")}`, import.meta.url));
            firebaseClient = sdk.criarFirebaseSync(firebaseConfig);
            const user = await firebaseClient.ready();
            stopFirebaseAuthObserver();
            const generation = firebaseAuthGeneration;
            let observing = false, received = false, observedUser;
            const deliver = user => {
                if (generation !== firebaseAuthGeneration) return;
                Promise.resolve(onFirebaseUser(user)).catch(error => {
                    if (generation === firebaseAuthGeneration) setSyncStatus(googleAuthMessage(error), true);
                });
            };
            firebaseAuthStop = firebaseClient.onUser(user => {
                if (generation !== firebaseAuthGeneration) return;
                if (!observing) { received = true; observedUser = user; return; }
                deliver(user);
            });
            // Publish ready()'s provisional user only after observer registration succeeds.
            observing = true;
            firebaseReady = true;
            if (received) deliver(observedUser);
            else setGoogleAuthUser(user);
        } catch (error) {
            stopFirebaseAuthObserver();
            firebaseClient = null;
            console.warn("Falha de autenticacao.", error?.code || "unknown");
            setSyncStatus(googleAuthMessage(error), true);
        } finally {
            firebaseInitPromise = null;
            updateGoogleLoginButton();
        }
    })();
    updateGoogleLoginButton();
    return firebaseInitPromise;
}
function startGoogleLogin() {
    if (firebaseInitPromise || googleLoginPending || googleAuthUser || syncUser) return;
    if (!firebaseReady || !firebaseClient) { void loadFirebaseSync(); return; }
    googleLoginPending = true;
    const revision = googleAuthRevision;
    updateGoogleLoginButton();
    setSyncStatus('Aguardando entrada com Google...');
    try {
        // Keep this call synchronous in the user's click; no await before popup.
        const popup = firebaseClient.login();
        Promise.resolve(popup).then(result => {
            if (revision === googleAuthRevision && result?.user) setGoogleAuthUser(result.user);
        }).catch(error => {
            if (revision === googleAuthRevision) setSyncStatus(googleAuthMessage(error), true);
        }).finally(() => {
            googleLoginPending = false;
            updateGoogleLoginButton();
        });
    } catch (error) {
        googleLoginPending = false;
        if (revision === googleAuthRevision) setSyncStatus(googleAuthMessage(error), true);
        updateGoogleLoginButton();
    }
}
async function onFirebaseUser(user) {
    setGoogleAuthUser(user);
    const previousUid = syncUser?.uid || null;
    const session = syncSessions.begin(), uid = user?.uid || null;
    const key = uid ? chaveLocalConta(uid) : CHAVE_ESTADO;
    const current = () => isCurrentSyncSession(session, uid) && chaveEstadoAtual === key;
    let draining;
    do { draining = idbPendente; await draining.catch(() => {}); } while (draining !== idbPendente);
    if (!isCurrentSyncSession(session, previousUid)) return;
    idbBloqueado = true;
    syncStopListener?.(); syncSettingsStop?.(); syncConflictsStop?.(); syncStopListener = null; syncSettingsStop = null; syncConflictsStop = null; syncUser = user || null; updateGoogleLoginButton(); syncRemoteRecords = []; syncRemoteRecordsLoaded = false; syncRemoteSettings = null;
    chaveEstadoAtual = key;
    settingsConflictActive = false; syncUi.last.textContent = ""; if (syncUi.last.dataset) delete syncUi.last.dataset.i18nDate; syncUi.conflictList?.replaceChildren();
    if (previousUid !== uid) resetFinancialInteractions();
    try {
    if (!user) {
        syncUi.account.textContent = ""; syncUi.login.hidden = false; syncUi.logout.hidden = true; syncUi.enabledLine.hidden = true;
        const local = lerEstadoPersistido(CHAVE_ESTADO);
        const durable = await idbBanco.ler(IDB_HOMOLOGACAO ? "estado:local" : "estado:@local");
        if (!current()) return;
        idbBloqueado = false; chaveEstadoAtual = CHAVE_ESTADO; estado = normalizarEstado(durable.dados); idbBase = structuredClone(estadoParaSalvar()); renderTudo(false);
        setSyncStatus("Somente neste dispositivo."); return;
    }
    chaveEstadoAtual = chaveLocalConta(user.uid); estado = normalizarEstado(null); renderTudo(false);
    syncUi.account.setAttribute?.("data-i18n-preserve", ""); syncUi.account.textContent = user.email || user.displayName || user.uid; syncUi.login.hidden = true; syncUi.logout.hidden = false; syncUi.enabledLine.hidden = false;
    const saved = lerEstadoPersistido(key);
    if (!["valido", "ausente"].includes(saved.estado)) throw new Error("Dados legados inv?lidos");
    chaveEstadoAtual = key; estado = normalizarEstado(saved.estado === "valido" ? saved.valor : null); renderTudo(false);
    if (!idbServico) throw new Error("IndexedDB indispon?vel");
    const legacyMeta = readSyncMetadata(localStorage, user.uid);
    const initialized = await idbServico.inicializar(user.uid, estadoParaSalvar(), { outbox: [], conflicts: [], lastConfirmed: null, ...legacyMeta, firstLinkSource: saved.estado === "valido" ? "account" : "anonymous" });
    if (!current()) return;
    idbBloqueado = false; estado = normalizarEstado(initialized.estado.dados); idbBase = structuredClone(estadoParaSalvar()); renderTudo(false);
    let meta = await readSyncMeta(uid);
    if (!current()) return;
    syncUi.enabled.checked = meta.enabled !== false;
    updateSettingsConflictActive(uid, meta, session);
    syncUi.restore.hidden = !meta.restoredPending;
    if (false) { setSyncStatus("Não foi possível persistir os dados locais desta conta. A sincronização foi pausada.", true); return; }
    else if (recuperacaoFinanceira.protegido) { setSyncStatus("Migração suspensa: recupere os dados locais protegidos antes de continuar.", true); return; }
    setSyncStatus("Carregando dados desta conta…");
        if (!syncUi.enabled.checked) { setSyncStatus("Sincronização desativada. Os dados permanecem locais."); return; }
        const remoteRaw = await firebaseClient.list(user.uid, { serverOnly: true });
        if (!current()) return;
        const remote = validarRegistrosRemotos(remoteRaw);
        if (!remote) throw new Error("Há lançamentos remotos inválidos; a migração foi interrompida para preservar os dados.");
        syncRemoteRecords = remote; syncRemoteRecordsLoaded = true;
        if (inspectRemoteKeys(remote).mismatches.length) {
            // list(serverOnly) has already verified server metadata. Preserve legacy reads without migrating keys.
            await onRemoteRecords(remote, { fromCache: false, hasPendingWrites: false }, session);
            if (!current()) return;
            setSyncStatus("Há documentos remotos com chaves legadas. A leitura foi preservada; o envio exige revisão.", true);
            return;
        }
        const remoteSettings = await firebaseClient.getSettings(user.uid, { serverOnly: true });
        if (!current()) return;
        if (!validarConfiguracoesRemotas(remoteSettings)) throw new Error("As configurações financeiras remotas são inválidas; nenhuma combinação foi aplicada.");
        syncRemoteSettings = remoteSettings;
        const remoteConflicts = await firebaseClient.listConflicts(user.uid, { serverOnly: true });
        if (!current()) return;
        if (!validateRemoteConflicts(remoteConflicts)) throw new Error("Há conflitos remotos inválidos; os conflitos locais foram preservados.");
        const currentMeta = await readSyncMeta(uid);
        if (!current()) return;
        currentMeta.conflicts = reconcileRemoteConflicts(currentMeta.conflicts, remoteConflicts);
        const remoteResolved = new Set(remoteConflicts.filter((item) => item?.resolved === true).map((item) => item.operationId));
        currentMeta.conflicts = currentMeta.conflicts.filter((item) => !remoteResolved.has(item.operationId || item.operation?.id));
        const savedMeta = await writeSyncMeta(user.uid, currentMeta);
        if (!current()) return;
        updateSettingsConflictActive(uid, savedMeta, session);
        if (meta.initialized && !meta.restoredPending) {
            await onRemoteRecords(remote, { fromCache: false, hasPendingWrites: false }, session, true);
            if (!current()) return;
        }
        meta = await readSyncMeta(uid);
        if (!current()) return;
        if (!meta.initialized) {
            let next = structuredClone(estado);
            if (!meta.firstLinkReviewed) {
                const anonymous = storage.lerJsonResultado(CHAVE_ESTADO);
                const anonymousState = await idbBanco.ler("estado:@local");
                if (!current()) return;
                const anonymousQueue = await idbBanco.ler("fila:@local");
                if (!current()) return;
                meta = await readSyncMeta(uid);
                if (!current()) return;
                if (meta.firstLinkReviewed || meta.initialized) {
                    setSyncStatus("Vínculo já revisado em outra aba. Tente novamente para continuar.", true); return;
                }
                const localState = meta.firstLinkSource !== "anonymous" || saved.estado === "valido" || registrosFinanceiros(estado).length
                    || !settingsEquivalent(financialSettings(estado), financialSettings(normalizarEstado(null))) ? structuredClone(estado)
                    : anonymousState?.dados || (anonymous.estado === "valido" ? anonymous.valor : normalizarEstado(null));
                const pristine = meta.firstLinkSource === "anonymous" && saved.estado === "ausente" && anonymousQueue?.settingsPristine === true
                    && !registrosFinanceiros(localState).length && !anonymousQueue.outbox?.length && !anonymousQueue.conflicts?.length
                    && !meta.outbox?.length && !meta.conflicts?.length
                    && settingsEquivalent(financialSettings(localState), financialSettings(normalizarEstado(null)));
                const local = registrosFinanceiros(localState), validRemote = remote.filter((item) => item.month && item.type && item.id && item.record);
                const merged = combinarRegistros(local, validRemote);
                if (!confirm(textoTraduzido(`Primeiro vínculo com ${user.email || textoTraduzido("esta conta")}.\n\nNeste dispositivo: ${local.length} lançamentos.\nNa nuvem: ${validRemote.length}.\nPossíveis duplicidades, que serão mantidas: ${merged.possiveisDuplicatas.length}.\nConflitos de mesmo ID, preservados dos dois lados: ${merged.conflitos.length}.\nConfigurações financeiras na nuvem: ${remoteSettings ? textoTraduzido("sim") : textoTraduzido("não")}.\n\nSerá guardado um backup local antes da combinação. Continuar?`))) { setSyncStatus("Vínculo aguardando sua confirmação.", true); return; }
                migrationBackup(localState, { get: (k) => localStorage.getItem(k), set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } } }, user.uid);
                const months = {};
                for (const item of merged.records) { months[item.month] ||= { receitas: [], despesas: [] }; months[item.month][item.type].push(item.record); }
                if (!validarBackup({ ...localState, meses: months })) throw new Error("A combinação inicial excede os limites ou contém dados inválidos. As cópias foram preservadas.");
                next = normalizarEstado({ ...localState, tema: estado.tema !== initialized.estado.dados.tema ? estado.tema : localState.tema, meses: months });
                if (pristine && remoteSettings) next = normalizarEstado({ ...next, categorias: remoteSettings.categories, orcamentos: remoteSettings.budgets });
                if (remoteSettings && !settingsEquivalent(financialSettings(next), remoteSettings)) {
                    const existingConflict = (meta.conflicts || []).some(item => item.kind === "settings"
                        && settingsEquivalent(item.local, financialSettings(next)) && settingsEquivalent(item.remote, remoteSettings));
                    const useLocal = existingConflict || confirm(textoTraduzido("As categorias ou os orçamentos diferem. OK mantém os deste dispositivo; Cancelar usa os da nuvem. As duas cópias serão preservadas no registro de conflito."));
                    await registerSettingsConflict(uid, financialSettings(next), remoteSettings, undefined, session);
                    if (!current()) return;
                    if (!useLocal) next = normalizarEstado({ ...next, categorias: remoteSettings.categories, orcamentos: remoteSettings.budgets });
                }
                if (!await setFinancialStateKey(key, next, current, { conflicts: merged.conflitos })) throw new Error("Não foi possível salvar a cópia local antes da migração.");
                if (!current()) return;
                next = structuredClone(estado);
            }
            await stageFirebaseState(uid, next, remote);
            if (!current()) return;
            await publishFirebaseState(next, remote);
            if (!current()) return;
            const initializedMeta = await readSyncMeta(uid);
            if (!current()) return;
            await writeSyncMeta(uid, { ...initializedMeta, initialized: true, ...(!(initializedMeta.conflicts || []).some(item => item.kind === "settings") ? { settingsBaseline: financialSettings(next) } : {}) });
            if (!current()) return;
        }
        if (meta.initialized && !settingsConflictActive && remoteSettings && meta.settingsBaseline) {
            const baseline = meta.settingsBaseline, localNow = financialSettings(estado);
            const localChanged = !settingsEquivalent(localNow, baseline);
            const remoteChanged = !settingsEquivalent(remoteSettings, baseline);
            if (localChanged && remoteChanged && !settingsEquivalent(localNow, remoteSettings)) {
                await registerSettingsConflict(uid, localNow, remoteSettings, undefined, session);
                if (!current()) return;
            } else if (remoteChanged && !localChanged) {
                const next = normalizarEstado({ ...estado, categorias: remoteSettings.categories, orcamentos: remoteSettings.budgets });
                const persisted = await persistirEstadoFinanceiro(key, next);
                if (!current()) return;
                if (!persisted) throw new Error("Falha ao persistir configuracoes da conta.");
                estado = normalizarEstado(idbBase); renderTudo(false);
            }
        }
        if (syncUi.enabled.checked) { await publishFirebaseState(estado, syncRemoteRecords); if (!current()) return; }
        const listenerMetarecords = await readSyncMeta(uid);
        if (!current()) return;
        if (syncUi.enabled.checked && !listenerMetarecords.restoredPending) syncStopListener = firebaseClient.listen(user.uid,
            (records, metadata) => { void onRecordsSnapshot(records, metadata, session, uid).catch((error) => {
                if (current()) { console.warn("Falha de sincronizacao.", error?.code || "unknown", error?.message); setSyncStatus("Falha na reconciliação. A fila foi preservada.", true); }
            }); },
            (error) => { if (current()) { syncRemoteRecordsLoaded = false; console.warn("Falha de sincronizacao.", error?.code || "unknown", error?.message); setSyncStatus("Erro ao observar alterações remotas.", true); } });
        const listenerMetasettings = await readSyncMeta(uid);
        if (!current()) return;
        if (syncUi.enabled.checked && !listenerMetasettings.restoredPending) syncSettingsStop = firebaseClient.listenSettings(user.uid, (value, snapshotMetadata) => {
            if (current()) void onRemoteSettings(value, snapshotMetadata, session).catch(error => {
                if (current()) { console.warn("Falha de sincronizacao.", error?.code || "unknown", error?.message); setSyncStatus("Não foi possível preservar as configurações remotas. Tente novamente.", true); }
            });
        }, (error) => { if (current()) { console.warn("Falha de sincronizacao.", error?.code || "unknown", error?.message); setSyncStatus("Erro ao observar configurações remotas.", true); } });
        const listenerMetaconflicts = await readSyncMeta(uid);
        if (!current()) return;
        if (syncUi.enabled.checked && !listenerMetaconflicts.restoredPending) syncConflictsStop = firebaseClient.listenConflicts(user.uid, (items, metadata) => { if (current()) onRemoteConflicts(items, session, metadata); }, (error) => { if (current()) { console.warn("Falha de sincronizacao.", error?.code || "unknown", error?.message); setSyncStatus("Erro ao recuperar conflitos remotos.", true); } });
        const finalMeta = await readSyncMeta(uid);
        if (!current()) return;
        syncUi.last.textContent = finalMeta.lastConfirmed ? formatLastSync(finalMeta.lastConfirmed) : "Ainda não há sincronização confirmada.";
        if (!navigator.onLine) setSyncStatus("Offline — as alterações serão enviadas quando houver conexão.");
        else if (finalMeta.outbox?.length) setSyncStatus("Aguardando envio.");
        else if (finalMeta.conflictDecisions?.some(item => item.status !== 'confirmed')) setSyncStatus("Aguardando sincronização");
        else if (pendingConflictCount(finalMeta)) setSyncStatus(`Há ${pendingConflictCount(finalMeta)} conflito(s) para revisar.`);
    } catch (error) { if (!current()) return; console.warn("Falha de sincronizacao.", error?.code || "unknown", error?.message, { requestedUid: uid, activeUid: syncUser?.uid || null, session, activeSession: syncSessions.current() }); setSyncStatus("Falha ao carregar a conta. Os dados locais foram mantidos.", true); }
}
let syncPublishChain = Promise.resolve();
let syncSettingsChain = { session: null, pending: Promise.resolve(), version: 0, count: 0, retry: false };
function settingsCoordination(session) {
    if (syncSettingsChain.session !== session) syncSettingsChain = { session, pending: Promise.resolve(), version: 0, count: 0, retry: false };
    return syncSettingsChain;
}
function scheduleSettingsRetry(coordination, session, uid) {
    if (!coordination.retry || coordination.count || coordination.scheduled || coordination !== syncSettingsChain
        || !isCurrentSyncSession(session, uid) || idbBloqueado) return;
    coordination.scheduled = true; coordination.retry = false;
    // Enqueue only after staging has finished. No publisher awaits this retry,
    // and no network read holds the snapshot chain or an IndexedDB transaction.
    void Promise.resolve().then(() => {
        coordination.scheduled = false;
        if (coordination === syncSettingsChain && isCurrentSyncSession(session, uid) && !idbBloqueado) return publishFirebaseState(estado);
    }).catch(() => { if (isCurrentSyncSession(session, uid)) setSyncStatus("Falha no envio. Os dados locais foram preservados.", true); });
}
async function publishFirebaseState(financialState, remote = syncRemoteRecords, skipSettings = false, reviewedConflict = null, deletions = []) {
    const session = syncSessions.current(), uid = syncUser?.uid;
    financialState = structuredClone(financialState);
    const prior = idbPendente.catch(() => {});
    const staged = prior.then(async () => {
        if (idbBloqueado) throw new Error("Persistencia bloqueada");
        if (isCurrentSyncSession(session, uid) && financialStatesEquivalent(financialState, estadoParaSalvar()) && syncUi.enabled.checked) {
            const meta = await readSyncMeta(uid);
            if (meta.restoredPending) return;
            const decision = !reviewedConflict && !skipSettings && meta.conflictDecisions?.find(item => item.status !== 'confirmed');
            if (decision && (decision.conflict.kind === 'settings'
                ? settingsEquivalent(financialSettings(decision.state), financialSettings(financialState))
                : financialStatesEquivalent(decision.state, financialState))) return {resumeDecision: decision};
            return stageFirebaseState(uid, financialState, remote, reviewedConflict, deletions);
        }
    });
    idbPendente = staged;
    const prepared = await staged;
    if (prepared?.resumeDecision) {
        if (isCurrentSyncSession(session, uid)) return resolveSyncConflict(prepared.resumeDecision.conflict, prepared.resumeDecision.choice);
        return;
    }
    if (prepared) financialState = structuredClone(prepared);
    const pending = syncPublishChain.catch(() => {}).then(() => {
        if (isCurrentSyncSession(session, uid)) return publishFirebaseStateNow(financialState, remote, skipSettings, reviewedConflict);
    });
    syncPublishChain = pending;
    try { return await pending; } catch (error) { if (isCurrentSyncSession(session, uid)) throw error; }
}
async function stageFirebaseState(uid, financialState, remote, reviewedConflict = null, deletions = []) {
    const key = chaveEstadoAtual, base = structuredClone(idbBase), session = syncSessions.current();
    const canStage = () => isCurrentSyncSession(session, uid) && key === chaveEstadoAtual && !idbBloqueado
        && financialStatesEquivalent(financialState, estadoParaSalvar());
    const result = await idbServico.prepararPublicacao(uid, base, financialState, remote, reviewedConflict, deletions, canStage);
    if (key === chaveEstadoAtual && syncUser?.uid === uid && financialStatesEquivalent(estado, financialState)) {
        idbBase = structuredClone(result.estado.dados);
        estado = normalizarEstado(result.estado.dados);
    }
    return result.estado.dados;
}
async function publishFirebaseStateNow(financialState, remote = syncRemoteRecords, skipSettings = false, reviewedConflict = null) {
    if (!syncUser || !syncUi.enabled.checked) return;
    const uid = syncUser.uid, session = syncSessions.current();
    const key = chaveEstadoAtual, coordination = settingsCoordination(session), version = coordination.version;
    const expectedSettings = structuredClone(reviewedConflict?.kind === "settings" ? reviewedConflict.remote : syncRemoteSettings);
    const persistence = idbPendente;
    const current = () => isCurrentSyncSession(session, uid) && key === chaveEstadoAtual;
    const canPublish = () => current() && !idbBloqueado && syncUi.enabled.checked && persistence === idbPendente
        && coordination === syncSettingsChain && coordination.version === version && !coordination.count
        && financialStatesEquivalent(financialState, estadoParaSalvar());
    const defer = () => {
        if (!current()) return;
        coordination.retry = coordination.version !== version || !!coordination.count;
        setSyncStatus(idbBloqueado ? "A persistência falhou. A sincronização foi pausada; os dados locais foram preservados." : "Aguardando envio.", idbBloqueado);
        scheduleSettingsRetry(coordination, session, uid);
    };
    if (!canPublish()) { defer(); return; }
    if ((await readSyncMeta(uid)).restoredPending) { setSyncStatus("Backup restaurado: confirme a combinação com a nuvem antes do envio."); return; }
    if (!navigator.onLine) { setSyncStatus("Offline — alterações pendentes."); return; }
    let unappliedRemote = false;
    const fresh = validarRegistrosRemotos(await firebaseClient.list(uid, { serverOnly: true }));
    if (!isCurrentSyncSession(session, uid)) return;
    if (!fresh) throw new Error("H? lan?amentos remotos inv?lidos ou duplicados; a fila foi preservada.");
    if (inspectRemoteKeys(fresh).mismatches.length) throw new Error("Chaves remotas incompat?veis");
    if (!financialStatesEquivalent(financialState, estadoParaSalvar())) { setSyncStatus("Aguardando envio."); return; }
    syncRemoteRecords = fresh; syncRemoteRecordsLoaded = true;
    unappliedRemote = fresh.some(item => !item.deleted && !registrosFinanceiros(financialState).some(local => recordEntityKey(local) === recordEntityKey(item)));
    const blocked = blockedConflictKeys((await readSyncMeta(uid)).conflicts, reviewedConflict);
    await idbServico.enviarFila(uid, (accountUid, operation) => {
        return firebaseClient.commit(accountUid, operation);
    }, () => isCurrentSyncSession(session, uid) && !idbBloqueado, op => !blocked.has(op.entityKey), fresh);
    if (!isCurrentSyncSession(session, uid)) return;
    const latestSettings = await firebaseClient.getSettings(uid, { serverOnly: true });
    if (!isCurrentSyncSession(session, uid)) return;
    if (!canPublish()) { defer(); return; }
    if (!validarConfiguracoesRemotas(latestSettings)) throw new Error("Configurações remotas inválidas; a confirmação foi suspensa.");
    const settings = financialSettings(financialState);
    const settingsMeta = await readSyncMeta(uid);
    if (!isCurrentSyncSession(session, uid)) return;
    updateSettingsConflictActive(uid, settingsMeta, session);
    const durable = await idbBanco.ler(`estado:${uid}`);
    if (!canPublish()) { defer(); return; }
    if (!durable || !financialStatesEquivalent(durable.dados, financialState)) { setSyncStatus("Aguardando envio."); return; }
    let settingsConflict = false;
    if (!skipSettings && (!settingsConflictActive || reviewedConflict?.kind === "settings") && !settingsEquivalent(settings, latestSettings)) {
        const canWriteSettings = () => canPublish() && (!settingsConflictActive || reviewedConflict?.kind === "settings");
        // No await between the final guard and SDK invocation. The SDK repeats
        // this guard after its own asynchronous reads and transaction retries.
        if (!canWriteSettings()) { defer(); return; }
        let savedSettings;
        try { savedSettings = await idbServico.coordenarSettings(uid, async () => {
            if (!canWriteSettings()) throw Object.assign(new Error('Stale settings'), {code:'sync/settings-stale'});
            const persisted = await readSyncMeta(uid);
            if (!canWriteSettings()) throw Object.assign(new Error('Stale settings'), {code:'sync/settings-stale'});
            updateSettingsConflictActive(uid, persisted, session);
            const remaining = (persisted.conflicts || []).filter(item => item.kind === 'settings' &&
                !(reviewedConflict?.kind === 'settings' && equivalentConflict(item, reviewedConflict)));
            if (remaining.length || !canWriteSettings()) throw Object.assign(new Error('Pending settings conflicts'), {code:'sync/settings-stale'});
            const durableNow = await idbBanco.ler('estado:' + uid);
            if (!canWriteSettings() || !durableNow || !financialStatesEquivalent(durableNow.dados, financialState))
                throw Object.assign(new Error('Stale durable settings'), {code:'sync/settings-stale'});
            return firebaseClient.saveSettings(uid, settings, expectedSettings?.revision || null, canWriteSettings);
        }, true); }
        catch (error) { if (error?.code === 'sync/settings-stale') { defer(); return; } throw error; }
        if (!isCurrentSyncSession(session, uid)) return;
        if (!canPublish()) { defer(); return; }
        if (savedSettings.conflict) {
            if (!validarConfiguracoesRemotas(savedSettings.remote)) throw new Error("Configurações remotas inválidas após rejeição de revisão.");
            if (!settingsEquivalent(settings, savedSettings.remote)) {
                await registerSettingsConflict(uid, settings, savedSettings.remote, undefined, session);
                if (!isCurrentSyncSession(session, uid)) return;
                syncRemoteSettings = savedSettings.remote;
                settingsConflict = true;
            } else {
                // The server already has the requested result. Keep its revision;
                // do not retry a remote write or resolve any existing conflict.
                syncRemoteSettings = savedSettings.remote;
                await rememberSettingsBaseline(uid, savedSettings.remote, session);
            }
        }
        else { syncRemoteSettings = { ...settings, revision: savedSettings.revision }; await rememberSettingsBaseline(uid, settings, session); }
    } else if (settingsEquivalent(settings, latestSettings)) {
        syncRemoteSettings = latestSettings;
    }
    if (!isCurrentSyncSession(session, uid)) return;
    const finalMeta = (await readSyncMeta(uid));
    if (!isCurrentSyncSession(session, uid)) return;
    updateSettingsConflictActive(uid, finalMeta, session);
    if (settingsConflict) setSyncStatus("Conflito de configurações preservado para revisão.", true);
    else if (finalMeta.outbox?.length) setSyncStatus("Aguardando envio.");
    else if (finalMeta.conflictDecisions?.some(item => item.status !== 'confirmed')) setSyncStatus("Aguardando sincronização");
    else if (pendingConflictCount(finalMeta)) setSyncStatus(`Há ${pendingConflictCount(finalMeta)} conflito(s) para revisar.`);
    else if (!canPublish() || skipSettings || settingsConflictActive || unappliedRemote
        || !settingsEquivalent(settings, syncRemoteSettings)) { defer(); }
    else {
        let confirmation;
        try { confirmation = await idbServico.confirmarSincronizacao(uid, financialState, new Date().toISOString(),
            () => canPublish() && settingsEquivalent(settings, syncRemoteSettings)); }
        catch (error) { if (current()) idbBloqueado = true; throw error; }
        if (!current()) return;
        updateSettingsConflictActive(uid, confirmation.fila, session);
        if (!confirmation.confirmed || !canPublish()) { defer(); return; }
        syncUi.last.textContent = formatLastSync(confirmation.fila.lastConfirmed);
        setSyncStatus("Sincronizado");
    }
    return { settingsConfirmed: !skipSettings && canPublish() && settingsEquivalent(settings, syncRemoteSettings) };
}
function onRemoteSettings(remote, snapshotMetadata, session = syncSessions.current()) {
    if (!isCurrentSyncSession(session, syncUser?.uid)) return Promise.resolve();
    // Preserve callback order across asynchronous storage, without making a new
    // account wait for a snapshot still running in the previous session.
    if (!remote || !snapshotConfirmed(snapshotMetadata)) return Promise.resolve();
    const coordination = settingsCoordination(session), uid = syncUser?.uid;
    coordination.version += 1; coordination.count += 1;
    const pending = coordination.pending.catch(() => {}).then(() => applyRemoteSettings(remote, snapshotMetadata, session)).finally(() => {
        coordination.count -= 1;
        scheduleSettingsRetry(coordination, session, uid);
    });
    coordination.pending = pending;
    return pending;
}
async function applyRemoteSettings(remote, snapshotMetadata, session) {
    const capturedUid = syncUser?.uid, capturedKey = chaveEstadoAtual;
    const currentSession = () => isCurrentSyncSession(session, capturedUid) && chaveEstadoAtual === capturedKey;
    if (!remote || !syncUser || !currentSession() || !syncUi.enabled.checked || !snapshotConfirmed(snapshotMetadata)) return;
    if (!validarConfiguracoesRemotas(remote)) { setSyncStatus("As configurações remotas são inválidas. A cópia local foi preservada; corrija os dados na nuvem e tente novamente.", true); return; }
    const meta = await readSyncMeta(capturedUid);
    if (!currentSession()) return;
    updateSettingsConflictActive(capturedUid, meta, session);
    const incoming = functionalSettings(remote), local = financialSettings(estado), previous = syncRemoteSettings;
    const equivalent = settingsEquivalent(local, remote);
    const localChanged = previous && !settingsEquivalent(local, previous);
    const remoteChanged = previous && !settingsEquivalent(remote, previous);
    if (!equivalent && (settingsConflictActive || (localChanged && remoteChanged))) {
        await registerSettingsConflict(capturedUid, local, remote, undefined, session);
        if (!currentSession()) return;
        syncRemoteSettings = remote;
        setSyncStatus("Configurações alteradas em outro dispositivo; as duas versões foram preservadas.", true); return;
    }
    // Pending conflicts are never resolved implicitly, even after convergence.
    if (settingsConflictActive || (!equivalent && localChanged)) { syncRemoteSettings = remote; return; }
    if (!equivalent) {
        const mergedSettings = mergeRemoteSettings(estado, remote);
        if (!validarBackup(mergedSettings.state)) { setSyncStatus("As configurações remotas são inválidas. A cópia local foi preservada.", true); return; }
        const normalized = normalizarEstado(mergedSettings.state);
        if (!await persistirEstadoFinanceiro(capturedKey, normalized)) { if (currentSession()) setSyncStatus("Não foi possível salvar as configurações remotas. A cópia local foi preservada.", true); return; }
        if (!currentSession()) return;
        applyingRemoteSync = true; estado = normalizarEstado(idbBase); renderTudo(false); applyingRemoteSync = false;
    }
    await rememberSettingsBaseline(capturedUid, incoming, session);
    if (currentSession() && !idbBloqueado) syncRemoteSettings = remote;
}
async function onRemoteRecords(records, snapshotMetadata, session = null, preserveDivergent = false) {
    const capturedUid = syncUser?.uid, capturedKey = chaveEstadoAtual;
    if (!syncUser || !syncUi.enabled.checked) return;
    if (session !== null && !isCurrentSyncSession(session, syncUser.uid)) return;
    if (!snapshotConfirmed(snapshotMetadata)) {
        syncRemoteRecordsLoaded = false;
        setSyncStatus("Offline — aguardando confirmação do servidor. Os dados locais continuam disponíveis.");
        return;
    }
    const validRecords = validarRegistrosRemotos(records);
    if (!validRecords) { syncRemoteRecordsLoaded = false; setSyncStatus("Há lançamentos remotos inválidos ou duplicados. Os dados locais foram mantidos; nenhum envio foi feito.", true); return; }
    syncRemoteRecords = validRecords; syncRemoteRecordsLoaded = true; records = validRecords;
    const next = structuredClone(estado); let changed = false;
    const metadata = (await readSyncMeta(capturedUid)), pendingKeys = new Set((metadata.outbox || []).map((entry) => entry.entityKey));
    if (syncUser?.uid !== capturedUid || chaveEstadoAtual !== capturedKey || (session !== null && !isCurrentSyncSession(session, capturedUid))) return;
    const blocked = blockedConflictKeys(metadata.conflicts);
    for (const item of records) {
        const entityKey = syncEntityKey(item);
        if (pendingKeys.has(entityKey)) {
            const pending = metadata.outbox.find((operation) => operation.entityKey === entityKey);
            const local = next.meses?.[item.month]?.[item.type]?.find((record) => record.id === item.id);
            const equivalent = item.deleted ? !local : local && recordsEquivalent(local, item.record);
            if (!equivalent && item.revision !== pending.baseRevision && !(metadata.conflicts || []).some((entry) =>
                entry.kind === "remote-changed-while-pending" && entry.month === item.month && entry.type === item.type
                && entry.id === item.id && entry.remote?.revision === item.revision)) {
                metadata.conflicts = [...(metadata.conflicts || []), { kind: "remote-changed-while-pending",
                    operation: pending, month: item.month, type: item.type, id: item.id, local, remote: item }];
            }
            continue;
        }
        if (blocked.has(entityKey)) continue;
        next.meses ||= {}; next.meses[item.month] ||= { receitas: [], despesas: [] };
        const list = next.meses[item.month][item.type], index = list.findIndex((record) => record.id === item.id);
        if (preserveDivergent && index >= 0 && (item.deleted || !recordsEquivalent(list[index], item.record))) {
            if (!(metadata.conflicts || []).some((conflict) => conflict.kind === "initial-divergence"
                && conflict.month === item.month && conflict.type === item.type && conflict.id === item.id)) {
                metadata.conflicts = [...(metadata.conflicts || []), { kind: "initial-divergence",
                    month: item.month, type: item.type, id: item.id, local: list[index], remote: item }];
            }
            continue;
        }
        if (item.deleted) { if (index >= 0) { list.splice(index, 1); changed = true; } }
        else if (index < 0) { list.push(item.record); changed = true; }
        else if (!recordsEquivalent(list[index], item.record)) { list[index] = item.record; changed = true; }
    }
    metadata.remoteRevisions = Object.fromEntries(records.map(item => [recordEntityKey(item), item.revision]));
    await writeSyncMeta(capturedUid, metadata);
    if (syncUser?.uid !== capturedUid || chaveEstadoAtual !== capturedKey || (session !== null && !isCurrentSyncSession(session, capturedUid))) return;
    if (changed) {
        if (!validarBackup(next)) { syncRemoteRecordsLoaded = false; setSyncStatus("A combinação remota excede os limites ou contém dados inválidos. A cópia local foi preservada.", true); return; }
        const normalized = normalizarEstado(next);
        if (!await persistirEstadoFinanceiro(capturedKey, normalized)) { syncRemoteRecordsLoaded = false; setSyncStatus("Não foi possível salvar os dados remotos localmente. A cópia anterior foi preservada.", true); return; }
        if (syncUser?.uid !== capturedUid || chaveEstadoAtual !== capturedKey || (session !== null && !isCurrentSyncSession(session, capturedUid))) return;
        applyingRemoteSync = true; estado = normalizarEstado(idbBase); renderTudo(false); applyingRemoteSync = false;
    }
    if (inspectRemoteKeys(records).mismatches.length) setSyncStatus("Há documentos remotos com chaves legadas. A leitura foi preservada; o envio exige revisão.", true);
}
async function onRemoteConflicts(remoteConflicts, session, snapshotMetadata) {
    const capturedUid = syncUser?.uid, capturedKey = chaveEstadoAtual;
    if (!syncUser || !syncUi.enabled.checked || !isCurrentSyncSession(session, syncUser.uid)) return;
    if (!snapshotConfirmed(snapshotMetadata)) return;
    if (!validateRemoteConflicts(remoteConflicts)) { setSyncStatus("Há conflitos remotos inválidos. A lista local foi preservada; corrija os dados na nuvem e tente novamente.", true); return; }
    const meta = (await readSyncMeta(capturedUid)), before = meta.conflicts || [];
    if (!isCurrentSyncSession(session, capturedUid)) return;
    const after = reconcileRemoteConflicts(before, remoteConflicts);
    const resolved = new Set(remoteConflicts.filter((item) => item?.resolved === true).map((item) => item.operationId));
    meta.conflicts = after.filter((item) => !resolved.has(item.operationId || item.operation?.id));
    const saved = await writeSyncMeta(capturedUid, meta); if (syncUser?.uid !== capturedUid || !isCurrentSyncSession(session, capturedUid)) return; updateSettingsConflictActive(capturedUid, saved, session);
    renderSyncConflicts();
    if (pendingConflictCount(saved)) setSyncStatus(`Há ${pendingConflictCount(saved)} conflito(s) para revisar.`);
    else if (saved.conflictDecisions?.some(item => item.status !== 'confirmed')) setSyncStatus("Aguardando sincronização");
}
async function onRecordsSnapshot(records, metadata, session, uid) {
    if (!isCurrentSyncSession(session, uid)) return;
    await onRemoteRecords(records, metadata, session);
    if (!isCurrentSyncSession(session, uid)) return;
    if (snapshotConfirmed(metadata) && syncRemoteRecordsLoaded && !inspectRemoteKeys(records).mismatches.length) {
        await publishFirebaseState(estado);
    }
}
window.addEventListener("finance-backup-restored", () => {
    if (!syncUser) return;
    const uid = syncUser.uid, session = syncSessions.current();
    void idbServico.alterarFila(uid, meta => { if (!isCurrentSyncSession(session, uid)) throw Object.assign(new Error("Session invalidated"), {code:"persistence/cancelled"}); meta.restoredPending = true; return meta; }).then(() => { if (isCurrentSyncSession(session, uid)) syncUi.restore.hidden = false; }).catch(() => { if (isCurrentSyncSession(session, uid)) idbBloqueado = true; });
});
window.addEventListener("finance-local-change", (event) => { if (!applyingRemoteSync && syncUser && event.detail.uid === syncUser.uid) { setSyncStatus(navigator.onLine ? "Aguardando envio." : "Offline — alterações pendentes."); if (syncUi.enabled.checked) void publishFirebaseState(event.detail.state, undefined, false, null, event.detail.deletedRecords || []).catch((error) => { console.warn("Falha de sincronizacao.", error?.code || "unknown", error?.message); setSyncStatus("Falha no envio. As alterações continuam salvas localmente.", true); }); } });
window.addEventListener("online", () => { if (syncUser) void publishFirebaseState(estado).catch(() => setSyncStatus("Falha no envio. Tente novamente.", true)); });
syncUi.login.addEventListener("click", startGoogleLogin);
syncUi.logout.addEventListener("click", () => { if (firebaseClient) void firebaseClient.logout(); });
syncUi.retry.addEventListener("click", () => { if (syncUser) void onFirebaseUser(syncUser); else void loadFirebaseSync(); });
syncUi.restore.addEventListener("click", async () => {
    if (!syncUser || !confirm(textoTraduzido("Combinar os registros do backup com os dados atuais da nuvem? Nenhum registro remoto ausente no backup será excluído."))) return;
    const session = syncSessions.current(), uid = syncUser.uid;
    try {
        const remote = validarRegistrosRemotos(await firebaseClient.list(uid, { serverOnly: true }));
        if (!isCurrentSyncSession(session, uid)) return;
        if (!remote || inspectRemoteKeys(remote).mismatches.length) throw new Error("Registros remotos inválidos, duplicados ou com chaves legadas. A restauração foi preservada.");
        const merged = combinarRegistros(registrosFinanceiros(estado), remote.filter((item) => !item.deleted && item.record));
        const localSettings = financialSettings(estado);
        if (syncRemoteSettings && !settingsEquivalent(localSettings, syncRemoteSettings)) {
            await registerSettingsConflict(uid, localSettings, syncRemoteSettings, "restored-backup", session);
            if (!isCurrentSyncSession(session, uid)) return;
        }
        const months = {};
        for (const item of merged.records) { months[item.month] ||= { receitas: [], despesas: [] }; months[item.month][item.type].push(item.record); }
        if (!validarBackup({ ...estado, meses: months })) throw new Error("A combinação do backup excede os limites ou contém dados inválidos.");
        const restored = normalizarEstado({ ...estado, meses: months });
        if (!await persistirEstadoFinanceiro(chaveEstadoAtual, restored)) throw new Error("Não foi possível persistir a combinação do backup.");
        if (!isCurrentSyncSession(session, uid)) return;
        estado = restored; renderTudo(false);
        const meta = (await readSyncMeta(uid)); meta.restoredPending = false; meta.conflicts = [...(meta.conflicts || []), ...merged.conflitos]; await writeSyncMeta(uid, meta);
        await stageFirebaseState(uid, estado, remote);
        syncUi.restore.hidden = true; await publishFirebaseState(estado, remote, true); if (!isCurrentSyncSession(session, uid)) return; await onFirebaseUser(syncUser);
    } catch (error) { if (!isCurrentSyncSession(session, uid)) return; console.warn("Falha de sincronizacao.", error?.code || "unknown", error?.message); setSyncStatus("Não foi possível sincronizar o backup; a cópia local continua preservada.", true); }
});
syncUi.enabled.addEventListener("change", async () => {
    if (!syncUser) return;
    const session = syncSessions.current(), uid = syncUser.uid, enabled = syncUi.enabled.checked;
    try {
        const meta = await readSyncMeta(uid);
        if (!isCurrentSyncSession(session, uid)) return;
        meta.enabled = enabled;
        await writeSyncMeta(uid, meta);
        if (!isCurrentSyncSession(session, uid)) return;
        if (!enabled) {
            syncStopListener?.(); syncSettingsStop?.(); syncConflictsStop?.();
            syncStopListener = null; syncSettingsStop = null; syncConflictsStop = null;
            setSyncStatus("Sincronização desativada. Os dados permanecem locais.");
        } else void onFirebaseUser(syncUser);
    } catch (error) { if (isCurrentSyncSession(session, uid)) setSyncStatus("Não foi possível salvar a preferência de sincronização.", true); }
});
async function renderSyncConflicts() {
    const rendering = (renderSyncConflicts.version || 0) + 1;
    renderSyncConflicts.version = rendering;
    const uid = syncUser?.uid, session = syncSessions.current(), key = chaveEstadoAtual;
    const meta = uid ? await readSyncMeta(uid) : {conflicts:[]};
    if (rendering !== renderSyncConflicts.version || syncUser?.uid !== uid || chaveEstadoAtual !== key || !isCurrentSyncSession(session, uid)) return;
    syncUi.conflictList.replaceChildren();
    const groups = [];
    for (const conflict of meta.conflicts || []) if (!groups.some(item => equivalentConflict(item, conflict))) groups.push(conflict);
    syncUi.conflicts.hidden = !groups.length && !meta.conflictHistory?.length;
    for (const conflict of groups) {
        const decision = meta.conflictDecisions?.find(item => equivalentConflict(item.conflict, conflict) && item.status !== 'confirmed');
        const row = document.createElement('section'); row.className = 'ajustes-secao sync-conflict';
        const title = document.createElement('strong'); title.textContent = decision?.status === 'failed' ? 'Falha — aguardando sincronização' : decision ? 'Aguardando sincronização' : 'Decisão pendente'; row.append(title);
        const sides = document.createElement('div'); sides.className = 'sync-conflict-comparison';
        for (const [label, value] of [['Dispositivo', conflict.local || conflict.operation?.value], ['Nuvem', conflict.remote]]) {
            const side = document.createElement('div'), heading = document.createElement('h4'); heading.textContent = label; side.append(heading);
            const content = document.createElement('p'); content.setAttribute('data-i18n-preserve','');
            if (conflict.kind === 'settings') {
                const other = label === 'Dispositivo' ? conflict.remote : conflict.local;
                const lines = [];
                if (!recordsEquivalent([...(value?.categories || [])].sort(), [...(other?.categories || [])].sort())) lines.push('Categorias: ' + (value?.categories || []).join(', '));
                if (!recordsEquivalent(value?.budgets, other?.budgets)) {
                    for (const [scope, entries] of Object.entries(value?.budgets || {})) {
                        const walk = (obj, comparison, path) => { for (const [name, amount] of Object.entries(obj || {})) if (amount && typeof amount === 'object') walk(amount, comparison?.[name], path ? path + ' / ' + name : name); else if (!recordsEquivalent(amount, comparison?.[name])) lines.push((path ? path + ' / ' : '') + name + ': ' + (valoresOcultos ? '••••' : String(amount))); };
                        walk(entries, other?.budgets?.[scope], scope === 'padrao' ? 'Orçamentos' : 'Orçamentos mensais');
                    }
                }
                content.textContent = lines.join('\n') || (!recordsEquivalent(value?.budgets, other?.budgets) ? 'Nenhum orçamento diferente configurado nesta versão' : 'Sem diferenças financeiras');
            } else {
                const record = value?.record || value;
                content.textContent = value?.deleted ? 'Excluído' : [record?.nome || record?.descricao, record?.categoria, record?.data, valoresOcultos ? '••••' : record?.valor].filter(item => item !== undefined).join(' · ');
            }
            side.append(content); sides.append(side);
        }
        row.append(sides);
        const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
        summary.textContent = 'Detalhes técnicos'; pre.setAttribute('data-i18n-preserve',''); pre.textContent = JSON.stringify(conflict, (_key,value) => valoresOcultos && typeof value === 'number' ? '••••' : value, 2); details.append(summary, pre); row.append(details);
        const actions = document.createElement('div'); actions.className = 'acoes';
        const choices = decision ? [[decision.choice, 'Tentar sincronizar']] : conflict.kind === 'settings' ? [['local','Manter configurações locais'],['remote','Usar configurações da nuvem']] : [['local','Manter versão local'],['remote','Usar versão da nuvem'],['both','Manter as duas versões']];
        for (const [choice,label] of choices) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-secundario'; button.textContent = label;
            button.addEventListener('click', async () => { button.disabled = true; try { await resolveSyncConflict(conflict, choice); } catch { if (isCurrentSyncSession(session, uid)) setSyncStatus('Falha no envio. As alterações continuam salvas localmente.', true); } finally { button.disabled = false; } }); actions.append(button);
        }
        row.append(actions); syncUi.conflictList.append(row);
    }
    if (meta.conflictHistory?.length) {
        const history = document.createElement('details'), summary = document.createElement('summary'), content = document.createElement('pre');
        history.className = 'sync-conflict'; summary.textContent = 'Sincronizado: ' + meta.conflictHistory.length;
        content.setAttribute('data-i18n-preserve', ''); content.textContent = JSON.stringify(meta.conflictHistory, (_key,value) => valoresOcultos && typeof value === 'number' ? '••••' : value, 2);
        history.append(summary, content); syncUi.conflictList.append(history);
    }
}
async function resolveSyncConflict(index, choice) {
    if (!syncUser) return;
    const session = syncSessions.current(), conflictUserUid = syncUser.uid, conflictKey = chaveEstadoAtual;
    const current = () => isCurrentSyncSession(session, conflictUserUid) && chaveEstadoAtual === conflictKey;
    const meta = await readSyncMeta(conflictUserUid);
    if (!current()) return;
    const conflict = typeof index === 'number' ? meta.conflicts?.[index] : meta.conflicts?.find(item => equivalentConflict(item, index)); if (!conflict) return;
    const decision = meta.conflictDecisions?.find(item => equivalentConflict(item.conflict, conflict) && item.status !== 'confirmed');
    if (!["local", "remote", "both"].includes(choice)) return;
    if (decision && choice !== decision.choice) return;
    const matchesDecision = state => conflict.kind === 'settings'
        ? settingsEquivalent(financialSettings(decision.state), financialSettings(state))
        : financialStatesEquivalent(decision.state, state);
    if (decision && !matchesDecision(estadoParaSalvar())) {
        setSyncStatus("A escolha aguarda sincronização; há alterações posteriores para revisar.", true); return;
    }
    let nextState = structuredClone(estado);
    let resolutionRemote = syncRemoteRecords, deletions = [];
    if (conflict.kind === "settings") {
        const selected = choice === "local" ? conflict.local : conflict.remote;
        if (!selected?.categories || !selected?.budgets) { setSyncStatus("Conflito inválido. Os dados locais foram preservados.", true); return; }
        nextState = { ...nextState, categorias: selected.categories, orcamentos: selected.budgets };
        } else {
        const operation = conflict.operation;
        const localItem = operation?.value || conflict.local;
        const remoteItem = conflict.remote;
        const item = localItem?.month ? { deleted: false, ...localItem } : conflict.month && localItem ? { ...conflict, record: localItem, deleted: false } : null;
        const remoteEnvelope = remoteItem && { deleted: false, ...remoteItem };
        if (!validConflictRecord(item) || remoteEnvelope && (!validConflictRecord(remoteEnvelope)
            || remoteEnvelope.month !== item.month || remoteEnvelope.type !== item.type || remoteEnvelope.id !== item.id)) {
            setSyncStatus("Conflito inválido. Os dados locais e a fila foram preservados.", true); return;
        }
        if (item?.month && item.type && item.id) {
            resolutionRemote = syncRemoteRecords.filter((entry) => syncEntityKey(entry) !== syncEntityKey(item));
            if (remoteEnvelope) resolutionRemote = [...resolutionRemote, remoteEnvelope];
            const month = item.month, type = item.type; nextState.meses[month] ||= { receitas: [], despesas: [] }; const list = nextState.meses[month][type];
            if (operation?.value?.deleted && choice !== "remote") {
                if (choice === "both") { setSyncStatus("Uma exclusão não possui segunda versão para copiar. Escolha manter a exclusão ou usar a nuvem.", true); return; }
                deletions = [item];
                // The local deletion remains in force and will be retried against the newly reviewed revision.
            } else if (choice === "remote") {
                const at = list.findIndex((entry) => entry.id === item.id);
                if (!remoteItem || remoteItem.deleted) { if (at >= 0) list.splice(at, 1); }
                else if (at >= 0) list[at] = remoteItem.record || remoteItem; else list.push(remoteItem.record || remoteItem);
                if (conflict.preserved?.id) { const copied = list.findIndex((entry) => entry.id === conflict.preserved.id); if (copied >= 0) list.splice(copied, 1); }
            } else if (choice === "local" || choice === "both") {
                let wanted = item;
                if (choice === "both" || remoteItem?.deleted) {
                    const sourceRecord = item.record || item, recordId = `copy-${operationId(syncEntityKey(item), null, sourceRecord)}`;
                    wanted = { ...item, id: recordId, record: { ...sourceRecord, id: recordId } };
                    const original = list.findIndex((entry) => entry.id === item.id);
                    if (remoteItem && !remoteItem.deleted) { if (original >= 0) list[original] = remoteItem.record; else list.push(remoteItem.record); }
                    else if (original >= 0) list.splice(original, 1);
                }
                const record = wanted.record || wanted; const at = list.findIndex((entry) => entry.id === wanted.id);
                if (at >= 0) list[at] = record; else list.push(record);
                if (conflict.preserved?.id && choice === "local") { const copied = list.findIndex((entry) => entry.id === conflict.preserved.id); if (copied >= 0) list.splice(copied, 1); }
            }
        }
    }
    if (!validarBackup(nextState)) { setSyncStatus("A resolução contém dados inválidos ou excede o limite mensal. Os dados locais foram preservados.", true); return; }
    const normalized = normalizarEstado(nextState);
    if (decision && !matchesDecision(normalized)) {
        setSyncStatus("A escolha aguarda sincronização; há alterações posteriores para revisar.", true); return;
    }
    const persisted = await idbServico.coordenarSettings(conflictUserUid, () => persistirEstadoFinanceiro(conflictKey, normalized, false, false, false, (queue, mergedState) => {
        if (!current() || !queue.conflicts.some(item => equivalentConflict(item, conflict))) throw Object.assign(new Error('Conflict changed'), {code:'persistence/cancelled'});
        queue.conflictDecisions ||= [];
        const existing = queue.conflictDecisions.find(item => equivalentConflict(item.conflict, conflict) && item.status !== 'confirmed');
        if (existing && existing.choice !== choice) throw Object.assign(new Error('Concurrent conflict decision'), {code:'persistence/cancelled'});
        if (existing) { existing.status = 'pending'; existing.state = structuredClone(mergedState || normalized); }
        if (!existing) {
            const entity = conflict.kind !== 'settings' && (conflict.operation?.entityKey || syncEntityKey(conflict.remote || conflict.operation?.value || conflict.local || conflict));
            const superseded = entity ? queue.outbox.filter(op => op.entityKey === entity) : [];
            if (superseded.some(op => queue.attempted?.[op.id] || !meta.outbox.some(old => recordsEquivalent(old, op))))
                throw Object.assign(new Error('An operation is in flight or changed; retry after synchronization'), {code:'persistence/cancelled'});
            if (entity) queue.outbox = queue.outbox.filter(op => op.entityKey !== entity);
            queue.conflictDecisions.push({ conflict: structuredClone(conflict), choice, state: structuredClone(mergedState || normalized), supersededOperations: structuredClone(superseded), status: 'pending', decidedAt: new Date().toISOString() });
        }
    }));
    if (!current()) return;
    if (!persisted) { setSyncStatus("Não foi possível salvar a resolução. A cópia local e o conflito foram preservados.", true); return; }
    if (!current()) return;
    estado = normalizarEstado(idbBase); renderTudo(false);
    setSyncStatus("Aguardando sincronização");
    if (conflict.kind === "settings" && choice === "remote") syncRemoteSettings = conflict.remote;
    // The decision is already durable. Never overwrite that transaction with a stale queue.
    if (!current()) return;
    try {
    if (!navigator.onLine) return;
    if (choice !== 'remote') {
        const result = await publishFirebaseState(estado, resolutionRemote, false, conflict, deletions);
        if (!current()) return;
        if (conflict.kind === 'settings' && result?.settingsConfirmed !== true) return;
    }
    if (!current() || !navigator.onLine || idbBloqueado) return;
    // Verify the selected value on the server, including the cloud choice. Local writes are not ACKs.
    const confirmed = conflict.kind === 'settings'
        ? settingsEquivalent(financialSettings(estado), await firebaseClient.getSettings(conflictUserUid, { serverOnly: true }))
        : await firebaseClient.list(conflictUserUid, { serverOnly: true }).then(records => {
            const key = conflict.operation?.entityKey || syncEntityKey(conflict.remote || conflict.operation?.value || conflict.local || conflict);
            const remote = records.find(item => syncEntityKey(item) === key);
            const local = registrosFinanceiros(estado).find(item => syncEntityKey(item) === key);
            return local ? remote && !remote.deleted && recordsEquivalent(local.record, remote.record) : !remote || remote.deleted;
        });
    if (!current() || !confirmed) return;
    if (conflict.source === 'firestore' && conflict.operationId) {
        if (!await firebaseClient.resolveConflict(conflictUserUid, conflict.operationId, choice)) throw new Error('Remote resolution unavailable');
        if (!current()) return;
    }
    const completed = await idbServico.confirmarDecisao(conflictUserUid, conflict, estadoParaSalvar(), () => current() && !idbBloqueado);
    if (current()) {
        const queue = completed.get('fila:' + conflictUserUid);
        updateSettingsConflictActive(conflictUserUid, queue, session);
        setSyncStatus(queue.conflictDecisions?.some(item => item.status !== 'confirmed') ? "Aguardando sincronização" : "Escolha confirmada na nuvem.");
    }
    } catch (error) {
        if (!current()) return;
        await idbServico.alterarFila(conflictUserUid, queue => {
            if (!current()) throw Object.assign(new Error('Session invalidated'), {code:'persistence/cancelled'});
            const item = queue.conflictDecisions?.find(item => equivalentConflict(item.conflict, conflict) && item.status !== 'confirmed');
            if (item) item.status = 'failed';
            return queue;
        });
        setSyncStatus('Falha no envio. As alterações continuam salvas localmente.', true);
    }
    if (current()) renderSyncConflicts();
}
syncUi.conflicts.addEventListener("click", () => { renderSyncConflicts(); abrirDialogoModal(syncUi.conflictDialog); });
syncUi.closeConflicts.addEventListener("click", () => syncUi.conflictDialog.close());
if (!IDB_HOMOLOGACAO && firebaseConfigurado(firebaseConfig)) void loadFirebaseSync();
}

// The existing Firestore wire protocol stays in use; Epoch is not activated here.
if (!IDB_HOMOLOGACAO && $("entrar-google") && $("sair-google") && firebaseConfigurado(firebaseConfig)) {
    const login = $("entrar-google"), logout = $("sair-google"), status = $("estado-sincronizacao"), account = $("conta-sincronizacao");
    let client = null, initialization = null, initTimer = null;
    const showStatus = (text, failed = false, confirmedAt = null) => {
        if (text === 'Atualização obrigatória: esta versão não é compatível com a geração da conta. Os dados locais foram preservados.') renderAvisosFinanceiros({ recoveryNotices: avisosFinanceiros, compatibilityBlocked: true });
        status.textContent = textoTraduzido(text); status.dataset.state = failed ? 'error' : text === 'Sincronizado' ? 'synced' : text.startsWith('Dados ativos sincronizados;') ? 'recovery' : text === 'Offline' ? 'offline' : 'syncing';
        if (confirmedAt) {
            $("ultima-sincronizacao").dataset.i18nDate = confirmedAt;
            $("ultima-sincronizacao").textContent = textoTraduzido('Última sincronização confirmada:') + ' ' + new Date(confirmedAt).toLocaleString(LOCALES[idiomaAtual]);
        }
    };
    const resetAccountForms = () => {
        ultimaRemocao = null; receitaEmEdicao = null; receitaSerieEmCriacao = null; despesaEmEdicao = null; despesaParaRemover = null; receitaParaRemover = null;
        clearTimeout(temporizadorAviso); temporizadorAviso = null;
        ui.aviso?.replaceChildren(); ui.aviso?.classList.remove('visivel', 'com-acao');
        for (const name of ['dialogoReceita','dialogoDespesa','dialogoSerie','dialogoOrcamentos']) ui[name]?.close();
        for (const name of ['receitaNome','receitaValor','despesaNome','despesaValor']) if (ui[name]) ui[name].value = '';
    };
    const initialize = () => {
        if (initialization) return initialization;
        login.disabled = true;
        initialization = (async () => {
            const sdk = await import(new URL(`./firebase-sync.bundle.js?_release=${encodeURIComponent(VERSAO_BUNDLE || 'local')}`, import.meta.url));
            client ||= sdk.criarFirebaseSync(firebaseConfig);
            automaticController ||= new AutomaticFinanceSync({ client, db: idbBanco, service: idbServico,
                requiredProtocol: 2,
                readLegacy: lerEstadoPersistido, waitLocal: async () => { let pending; do { pending = idbPendente; await pending; } while (pending !== idbPendente); },
                storageBlocked: () => idbBloqueado || recuperacaoFinanceira.protegido,
                onTransition: user => {
                    renderAvisosFinanceiros({ recoveryNotices: [], compatibilityBlocked: false });
                    resetAccountForms(); iniciarCarregamentoConta(); idbBloqueado = true;
                    chaveEstadoAtual = user ? chaveLocalConta(user.uid) : CHAVE_ESTADO;
                    estado = normalizarEstado(null); idbBase = structuredClone(estadoParaSalvar()); renderTudo(false);
                    login.hidden = !!user; logout.hidden = !user;
                    account.textContent = user?.email || user?.displayName || '';
                    $("ultima-sincronizacao").textContent = ''; delete $("ultima-sincronizacao").dataset.i18nDate;
                },
                onAccount: async user => {
                    idbBloqueado = false;
                    if (!user) {
                        idbGeneration = 'legacy';
                        const local = await idbBanco.ler('estado:@local');
                        if (automaticController.session) return;
                        estado = normalizarEstado(local?.dados); idbBase = structuredClone(estadoParaSalvar()); renderTudo(false);
                        showStatus('Somente neste dispositivo.');
                        concluirCarregamentoConta();
                    }
                },
                onState: (next, meta) => {
                    idbGeneration = meta?.generation || 'legacy';
                    renderAvisosFinanceiros(meta);
                    estado = normalizarEstado(next); idbBase = structuredClone(estadoParaSalvar()); renderTudo(false);
                    concluirCarregamentoConta();
                },
                onStatus: showStatus
            });
            capturarSessaoPersistencia = () => { const current = automaticController.session; return () => automaticController.session === current; };
            await automaticController.start();
            concluirCarregamentoConta();
        })().catch(error => {
            const tinhaContaEmTransicao = Boolean(automaticController?.session);
            automaticController?.stop(); automaticController = null; initialization = null;
            if (!tinhaContaEmTransicao) concluirCarregamentoConta();
            showStatus(error.message || 'Falha na sincronização.', true);
            clearTimeout(initTimer);
            // Recheck storage/session bootstrap automatically; persistent failures stay visible.
            initTimer = setTimeout(() => { void initialize(); }, 5000);
        }).finally(() => { login.disabled = false; });
        return initialization;
    };
    login.addEventListener('click', () => {
        if (!client) { void initialize(); return; }
        login.disabled = true;
        try { Promise.resolve(client.login()).catch(error => showStatus(error.message || 'Falha na sincronização.', true)).finally(() => { login.disabled = false; }); }
        catch (error) { login.disabled = false; showStatus(error.message, true); }
    });
    logout.addEventListener('click', () => { void client?.logout().catch(error => showStatus(error.message, true)); });
    window.addEventListener('finance-local-change', event => {
        if (automaticController?.session?.uid === event.detail.uid) {
            if (!automaticController.session.permanent) showStatus(navigator.onLine ? 'Sincronizando' : 'Offline');
            automaticController.localChanged();
        }
    });
    window.addEventListener('online', () => { if (!automaticController) void initialize(); });
    window.addEventListener('focus', () => { if (!automaticController) void initialize(); });
    $("exportar-historico-recuperacao")?.addEventListener('click', async () => {
        const s = automaticController?.session;
        if (!s) { avisar('Entre com Google antes de exportar o histórico.'); return; }
        try {
            const local = await idbServico.lerFila(s.uid);
            const restorations = await Promise.all((local.recoveryKeys || []).map(key => idbBanco.ler(key)));
            let remote = [], remoteUnavailable = false;
            try { if (navigator.onLine) remote = await client.listAutomaticHistory(s.uid); }
            catch { remoteUnavailable = true; }
            if (automaticController.session !== s) return;
            baixarArquivo(JSON.stringify({ type: 'financial-recovery-history', uid: s.uid,
                local: local.automaticHistory || [], restorations, remote, remoteUnavailable }, null, 2), 'controle-financeiro-recuperacao.json', 'application/json');
            const included = new Set((local.recoveryNotices || []).map(item => item.id));
            const queue = await idbServico.alterarFila(s.uid, queue => {
                if (automaticController.session !== s) throw new Error('Sessão alterada.');
                for (const notice of queue.recoveryNotices || []) if (included.has(notice.id)) notice.acknowledged = true;
                return queue;
            });
            if (automaticController.session === s) { renderAvisosFinanceiros(queue); automaticController.localChanged(); }
        } catch (error) { avisar(error.message || 'Falha ao exportar histórico.'); }
    });
    window.addEventListener('pagehide', () => { clearTimeout(initTimer); automaticController?.stop(); }, { once: true });
    void initialize();
}
