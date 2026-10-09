"use strict";

/* =========================================================
   Controle Financeiro
   Dados salvos no navegador (localStorage).
   ========================================================= */

const CHAVE_ESTADO = "controleFinanceiro:v2";
const PREFIXO_LEGADO = "controleFinanceiro-"; // versão antiga: um item por mês

const MESES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const CATEGORIAS_PADRAO = [
    "Moradia",
    "Alimentação",
    "Transporte",
    "Contas",
    "Assinaturas",
    "Lazer",
    "Saúde",
    "Educação",
    "Outros"
];

const CATEGORIA_FIXA = "Outros"; // não pode ser removida nem renomeada

const $ = (id) => document.getElementById(id);

const ui = {
    mes: $("mes"),
    ano: $("ano"),
    mesAnterior: $("mes-anterior"),
    mesProximo: $("mes-proximo"),
    hoje: $("hoje"),
    tema: $("alternar-tema"),

    saldoRotulo: $("saldo-rotulo"),
    saldoValor: $("saldo-valor"),
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

    busca: $("busca"),
    filtroCategoria: $("filtro-categoria"),
    filtroStatus: $("filtro-status"),
    listaDespesas: $("lista-despesas"),
    vazioDespesas: $("vazio-despesas"),
    adicionarDespesa: $("adicionar-despesa"),
    gerenciarCategorias: $("gerenciar-categorias"),
    dialogoDespesa: $("dialogo-despesa"),
    formDespesa: $("form-despesa"),
    tituloDialogoDespesa: $("titulo-dialogo-despesa"),
    despesaNome: $("despesa-nome"),
    despesaCategoria: $("despesa-categoria"),
    despesaValor: $("despesa-valor"),
    despesaPago: $("despesa-pago"),
    fecharDespesa: $("fechar-despesa"),
    cancelarDespesa: $("cancelar-despesa"),
    totalRotulo: $("total-rotulo"),
    totalValor: $("total-valor"),
    totalPercentual: $("total-percentual"),

    resumoCategorias: $("resumo-categorias"),
    vazioCategorias: $("vazio-categorias"),

    copiarMesAnterior: $("copiar-mes-anterior"),
    exportarCsv: $("exportar-csv"),
    exportarBackup: $("exportar-backup"),
    importarBackup: $("importar-backup"),
    arquivoBackup: $("arquivo-backup"),
    limparMes: $("limpar-mes"),

    dialogo: $("dialogo-categorias"),
    listaCategorias: $("lista-categorias"),
    novaCategoria: $("nova-categoria"),
    adicionarCategoria: $("adicionar-categoria"),
    fecharCategorias: $("fechar-categorias"),

    aviso: $("aviso")
};

/* ---------- Utilidades ---------- */

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function numero(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
}

function formatarMoeda(valor) {
    return valor.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function formatarPercentual(valor) {
    return valor.toLocaleString("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    }) + "%";
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

function avisar(mensagem) {
    ui.aviso.textContent = mensagem;
    ui.aviso.classList.add("visivel");

    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => {
        ui.aviso.classList.remove("visivel");
    }, 3000);
}

/* ---------- Estado e persistência ---------- */

function chaveMes(ano, mes) {
    return ano + "-" + String(mes).padStart(2, "0");
}

function objetosValidos(lista) {
    return (Array.isArray(lista) ? lista : [])
        .filter((item) => item && typeof item === "object");
}

function normalizarEstado(bruto) {
    const estado = {
        versao: 2,
        tema: null,
        categorias: [],
        meses: {}
    };

    if (bruto && typeof bruto === "object") {

        if (bruto.tema === "claro" || bruto.tema === "escuro") {
            estado.tema = bruto.tema;
        }

        (Array.isArray(bruto.categorias) ? bruto.categorias : []).forEach((c) => {
            if (typeof c !== "string") return;
            const nome = c.trim();
            if (nome && !estado.categorias.includes(nome)) {
                estado.categorias.push(nome);
            }
        });

        const meses = bruto.meses && typeof bruto.meses === "object" ? bruto.meses : {};

        Object.entries(meses).forEach(([chave, mes]) => {

            if (!/^\d{4}-\d{2}$/.test(chave) || !mes || typeof mes !== "object") {
                return;
            }

            estado.meses[chave] = {
                receitas: objetosValidos(mes.receitas).map((r) => ({
                    id: String(r.id || uid()),
                    nome: String(r.nome || ""),
                    valor: Math.max(0, numero(r.valor))
                })),
                despesas: objetosValidos(mes.despesas).map((d) => ({
                    id: String(d.id || uid()),
                    nome: String(d.nome || ""),
                    categoria: String(d.categoria || CATEGORIA_FIXA).trim() || CATEGORIA_FIXA,
                    valor: Math.max(0, numero(d.valor)),
                    pago: Boolean(d.pago)
                }))
            };
        });
    }

    if (!estado.categorias.length) {
        estado.categorias = [...CATEGORIAS_PADRAO];
    }

    if (!estado.categorias.includes(CATEGORIA_FIXA)) {
        estado.categorias.push(CATEGORIA_FIXA);
    }

    // Garante que toda categoria usada em uma despesa exista na lista
    Object.values(estado.meses).forEach((mes) => {
        mes.despesas.forEach((d) => {
            if (!estado.categorias.includes(d.categoria)) {
                estado.categorias.push(d.categoria);
            }
        });
    });

    return estado;
}

// Converte os dados da versão antiga (uma chave por mês) para o formato novo.
function migrarLegado() {

    const ano = new Date().getFullYear();
    const bruto = { categorias: [], meses: {} };
    let achou = false;

    for (let m = 1; m <= 12; m++) {

        let texto = null;

        try {
            texto = localStorage.getItem(PREFIXO_LEGADO + m);
        } catch (erro) {
            return null;
        }

        if (!texto) continue;

        try {
            const dados = JSON.parse(texto);
            const renda = numero(dados.renda);

            (Array.isArray(dados.categorias) ? dados.categorias : []).forEach((c) => {
                if (!bruto.categorias.includes(c)) bruto.categorias.push(c);
            });

            bruto.meses[chaveMes(ano, m)] = {
                receitas: renda > 0
                    ? [{ nome: "Renda mensal", valor: renda }]
                    : [],
                despesas: objetosValidos(dados.despesas)
            };

            achou = true;
        } catch (erro) {
            // item corrompido: ignora
        }
    }

    return achou ? bruto : null;
}

function carregarEstado() {

    try {
        const texto = localStorage.getItem(CHAVE_ESTADO);

        if (texto) {
            return normalizarEstado(JSON.parse(texto));
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

function salvar() {
    try {
        localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estado));
    } catch (erro) {
        avisar("Não foi possível salvar. O armazenamento do navegador pode estar bloqueado ou cheio.");
    }
}

/* ---------- Período e filtros ---------- */

const agora = new Date();

let periodo = {
    ano: agora.getFullYear(),
    mes: agora.getMonth() + 1
};

const filtros = {
    busca: "",
    categoria: "",
    status: ""
};

function obterMes() {
    const chave = chaveMes(periodo.ano, periodo.mes);

    if (!estado.meses[chave]) {
        estado.meses[chave] = { receitas: [], despesas: [] };
    }

    return estado.meses[chave];
}

function despesasFiltradas() {

    const busca = filtros.busca.trim().toLowerCase();

    return obterMes().despesas.filter((d) => {
        return (!busca || d.nome.toLowerCase().includes(busca))
            && (!filtros.categoria || d.categoria === filtros.categoria)
            && (!filtros.status || (filtros.status === "pago") === d.pago);
    });
}

function filtrosAtivos() {
    return Boolean(filtros.busca.trim() || filtros.categoria || filtros.status);
}

function limparFiltros() {
    filtros.busca = "";
    filtros.categoria = "";
    filtros.status = "";

    ui.busca.value = "";
    ui.filtroCategoria.value = "";
    ui.filtroStatus.value = "";
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

    limparFiltros();
    renderTudo();
}

/* ---------- Renderização ---------- */

function renderPeriodo() {
    ui.mes.value = String(periodo.mes);
    ui.ano.value = String(periodo.ano);
}

function renderTema() {

    const escuroNoSistema = window.matchMedia
        && window.matchMedia("(prefers-color-scheme: dark)").matches;

    const tema = estado.tema || (escuroNoSistema ? "escuro" : "claro");

    document.documentElement.dataset.tema = tema;
    ui.tema.textContent = tema === "escuro" ? "☀️" : "🌙";
}

function renderFiltroCategorias() {

    const atual = filtros.categoria;

    ui.filtroCategoria.replaceChildren(
        criarEl("option", { value: "", text: "Todas as categorias" }),
        ...estado.categorias.map((c) => criarEl("option", { value: c, text: c }))
    );

    ui.filtroCategoria.value = estado.categorias.includes(atual) ? atual : "";
    filtros.categoria = ui.filtroCategoria.value;
}

function criarLinhaReceita(receita) {

    const linha = criarEl("div", {
        class: "receita",
        dataset: { id: receita.id }
    });

    linha.append(
        criarEl("input", {
            type: "text",
            class: "nome-receita",
            placeholder: "Nome da receita (ex.: Salário)",
            value: receita.nome,
            maxLength: 80,
            "aria-label": "Nome da receita"
        }),
        criarEl("input", {
            type: "number",
            class: "valor-receita",
            placeholder: "0,00",
            min: "0",
            step: "0.01",
            value: receita.valor ? String(receita.valor) : "",
            "aria-label": "Valor da receita"
        }),
        criarEl("button", {
            type: "button",
            class: "remover-receita",
            title: "Remover receita",
            "aria-label": "Remover receita",
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

function criarLinhaDespesa(despesa) {

    const linha = criarEl("div", {
        class: "despesa" + (despesa.pago ? " paga" : ""),
        dataset: { id: despesa.id }
    });

    const situacao = criarEl("span", {
        class: despesa.pago ? "situacao situacao-paga" : "situacao situacao-pendente",
        text: despesa.pago ? "Pago" : "A pagar"
    });

    linha.append(
        criarEl("input", {
            type: "checkbox",
            class: "pago-despesa",
            checked: despesa.pago,
            title: despesa.pago ? "Marcar como a pagar" : "Marcar como paga",
            "aria-label": "Despesa paga"
        }),
        criarEl("div", { class: "despesa-info" }, [
            criarEl("span", {
                class: "nome-despesa",
                text: despesa.nome.trim() || "Sem nome"
            }),
            criarEl("span", { class: "despesa-detalhe" }, [
                despesa.categoria + " · ",
                situacao
            ])
        ]),
        criarEl("span", {
            class: "valor-despesa",
            text: formatarMoeda(numero(despesa.valor))
        }),
        criarEl("button", {
            type: "button",
            class: "editar-despesa",
            title: "Editar despesa",
            "aria-label": "Editar despesa " + despesa.nome,
            text: "✎"
        }),
        criarEl("button", {
            type: "button",
            class: "remover-despesa",
            title: "Remover despesa",
            "aria-label": "Remover despesa " + despesa.nome,
            text: "×"
        })
    );

    return linha;
}

function criarGrupoDespesas(categoria, itens) {

    const cor = criarEl("span", { class: "cat-cor" });
    cor.style.background = corDaCategoria(categoria);

    return criarEl("section", { class: "grupo-despesas" }, [
        criarEl("div", { class: "grupo-topo" }, [
            criarEl("h3", { class: "cat-nome" }, [cor, categoria]),
            criarEl("span", { class: "grupo-total", text: formatarMoeda(somar(itens)) })
        ]),
        criarEl("div", {}, itens.map(criarLinhaDespesa))
    ]);
}

function renderDespesas() {

    const todas = obterMes().despesas;
    const lista = despesasFiltradas();

    // Agrupa por categoria, na ordem em que as categorias foram cadastradas
    const grupos = new Map();

    estado.categorias.forEach((c) => grupos.set(c, []));

    lista.forEach((d) => {
        if (!grupos.has(d.categoria)) grupos.set(d.categoria, []);
        grupos.get(d.categoria).push(d);
    });

    const blocos = [];

    grupos.forEach((itens, categoria) => {
        if (itens.length) blocos.push(criarGrupoDespesas(categoria, itens));
    });

    ui.listaDespesas.replaceChildren(...blocos);

    if (lista.length) {
        ui.vazioDespesas.hidden = true;
    } else {
        ui.vazioDespesas.hidden = false;
        ui.vazioDespesas.textContent = todas.length
            ? "Nenhuma despesa corresponde aos filtros."
            : "Nenhuma despesa neste mês. Use “+ Adicionar despesa” para começar.";
    }
}

function corDaCategoria(nome) {
    const indice = Math.max(0, estado.categorias.indexOf(nome));
    return "hsl(" + ((indice * 47 + 160) % 360) + ", 55%, 48%)";
}

function renderResumoCategorias(mes, receita) {

    const grupos = {};

    mes.despesas.forEach((d) => {
        grupos[d.categoria] = (grupos[d.categoria] || 0) + numero(d.valor);
    });

    const itens = Object.entries(grupos)
        .filter(([, valor]) => valor > 0)
        .sort((a, b) => b[1] - a[1]);

    const totalDespesas = itens.reduce((soma, [, valor]) => soma + valor, 0);

    ui.vazioCategorias.hidden = itens.length > 0;

    ui.resumoCategorias.replaceChildren(...itens.map(([nome, valor]) => {

        const parteDasDespesas = totalDespesas > 0 ? (valor / totalDespesas) * 100 : 0;
        const parteDaRenda = receita > 0 ? (valor / receita) * 100 : 0;

        const detalhe = receita > 0
            ? formatarMoeda(valor) + " (" + formatarPercentual(parteDaRenda) + " da renda)"
            : formatarMoeda(valor) + " (" + formatarPercentual(parteDasDespesas) + " das despesas)";

        const barra = criarEl("div", { class: "cat-barra" });
        barra.style.width = parteDasDespesas + "%";
        barra.style.background = corDaCategoria(nome);

        const cor = criarEl("span", { class: "cat-cor" });
        cor.style.background = corDaCategoria(nome);

        return criarEl("div", { class: "cat-linha" }, [
            criarEl("div", { class: "cat-cabecalho" }, [
                criarEl("span", { class: "cat-nome" }, [cor, nome]),
                criarEl("span", { class: "cat-detalhe", text: detalhe })
            ]),
            criarEl("div", { class: "cat-trilho" }, [barra])
        ]);
    }));
}

function somar(lista) {
    return lista.reduce((soma, item) => soma + numero(item.valor), 0);
}

// Recalcula tudo o que depende de valores e salva. Não recria as linhas
// de despesas/receitas, então o cursor do usuário nunca é perdido.
function atualizarResumo() {

    const mes = obterMes();

    const receita = somar(mes.receitas);
    const despesa = somar(mes.despesas);
    const pago = somar(mes.despesas.filter((d) => d.pago));
    const pendente = despesa - pago;
    const saldo = receita - despesa;

    // Cabeçalho
    ui.saldoValor.textContent = formatarMoeda(saldo);
    ui.saldoValor.classList.toggle("negativo", saldo < 0);
    ui.saldoRotulo.textContent = saldo < 0 ? "Faltam neste mês" : "Sobra neste mês";

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

    if (receita <= 0) {
        ui.textoComprometido.textContent = despesa > 0
            ? "Adicione suas receitas para ver quanto da renda está comprometido."
            : "Adicione receitas e despesas para acompanhar o mês.";
    } else if (despesa > receita) {
        ui.textoComprometido.textContent =
            "Você gastou " + formatarPercentual(pctDespesa) + " da renda: as despesas passaram das receitas.";
    } else {
        ui.textoComprometido.textContent =
            formatarPercentual(pctDespesa) + " da renda comprometida com despesas.";
    }

    // Linha de total (respeita os filtros)
    const visiveis = despesasFiltradas();
    const totalVisivel = somar(visiveis);

    ui.totalRotulo.textContent = filtrosAtivos()
        ? "Total filtrado (" + visiveis.length + ")"
        : "Total";
    ui.totalValor.textContent = formatarMoeda(totalVisivel);
    ui.totalPercentual.textContent =
        formatarPercentual(receita > 0 ? (totalVisivel / receita) * 100 : 0);

    renderResumoCategorias(mes, receita);

    salvar();
}

function renderTudo() {
    renderTema();
    renderPeriodo();
    renderReceitas();
    renderFiltroCategorias();
    renderDespesas();
    atualizarResumo();
}

/* ---------- Receitas ---------- */

function adicionarReceita() {

    obterMes().receitas.push({ id: uid(), nome: "", valor: 0 });

    renderReceitas();
    atualizarResumo();

    const campos = ui.listaReceitas.querySelectorAll(".nome-receita");
    if (campos.length) campos[campos.length - 1].focus();
}

ui.adicionarReceita.addEventListener("click", adicionarReceita);

ui.listaReceitas.addEventListener("input", (evento) => {

    const alvo = evento.target;
    const linha = alvo.closest(".receita");
    if (!linha) return;

    const receita = obterMes().receitas.find((r) => r.id === linha.dataset.id);
    if (!receita) return;

    if (alvo.classList.contains("nome-receita")) {
        receita.nome = alvo.value;
    } else if (alvo.classList.contains("valor-receita")) {
        receita.valor = Math.max(0, numero(alvo.value));
    } else {
        return;
    }

    atualizarResumo();
});

ui.listaReceitas.addEventListener("click", (evento) => {

    const botao = evento.target.closest(".remover-receita");
    if (!botao) return;

    const id = botao.closest(".receita").dataset.id;
    const mes = obterMes();

    mes.receitas = mes.receitas.filter((r) => r.id !== id);

    renderReceitas();
    atualizarResumo();
});

/* ---------- Despesas ---------- */

let despesaEmEdicao = null; // id da despesa aberta no diálogo (null = nova)

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

    ui.dialogoDespesa.showModal();
    ui.despesaNome.focus();
}

function salvarDespesa() {

    const nome = ui.despesaNome.value.trim();

    if (!nome) {
        avisar("Digite o nome da despesa.");
        ui.despesaNome.focus();
        return;
    }

    const dados = {
        nome,
        categoria: ui.despesaCategoria.value || CATEGORIA_FIXA,
        valor: Math.max(0, numero(ui.despesaValor.value)),
        pago: ui.despesaPago.checked
    };

    if (despesaEmEdicao) {

        const despesa = obterMes().despesas.find((d) => d.id === despesaEmEdicao);

        if (despesa) Object.assign(despesa, dados);

        avisar("Despesa atualizada.");

    } else {

        if (filtrosAtivos()) limparFiltros();

        obterMes().despesas.push({ id: uid(), ...dados });

        avisar("Despesa adicionada.");
    }

    ui.dialogoDespesa.close();

    renderDespesas();
    atualizarResumo();
}

ui.adicionarDespesa.addEventListener("click", () => abrirDialogoDespesa(null));

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
    const mes = obterMes();
    const despesa = mes.despesas.find((d) => d.id === id);

    if (!despesa) return;

    if (!confirm("Remover a despesa “" + (despesa.nome.trim() || "Sem nome") + "”?")) return;

    mes.despesas = mes.despesas.filter((d) => d.id !== id);

    renderDespesas();
    atualizarResumo();
    avisar("Despesa removida.");
});

/* ---------- Filtros ---------- */

ui.busca.addEventListener("input", () => {
    filtros.busca = ui.busca.value;
    renderDespesas();
    atualizarResumo();
});

ui.filtroCategoria.addEventListener("change", () => {
    filtros.categoria = ui.filtroCategoria.value;
    renderDespesas();
    atualizarResumo();
});

ui.filtroStatus.addEventListener("change", () => {
    filtros.status = ui.filtroStatus.value;
    renderDespesas();
    atualizarResumo();
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
    renderListaCategorias();
    renderFiltroCategorias();
    renderDespesas();
    atualizarResumo();
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

    Object.values(estado.meses).forEach((mes) => {
        mes.despesas.forEach((d) => {
            if (d.categoria === antigo) d.categoria = novo;
        });
    });

    if (filtros.categoria === antigo) filtros.categoria = novo;

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

    Object.values(estado.meses).forEach((mes) => {
        mes.despesas.forEach((d) => {
            if (d.categoria === nome) d.categoria = CATEGORIA_FIXA;
        });
    });

    if (filtros.categoria === nome) filtros.categoria = "";

    aposMudarCategorias();
    avisar("Categoria removida.");
}

ui.gerenciarCategorias.addEventListener("click", () => {
    renderListaCategorias();
    ui.dialogo.showModal();
    ui.novaCategoria.focus();
});

ui.fecharCategorias.addEventListener("click", () => ui.dialogo.close());

ui.dialogo.addEventListener("click", (evento) => {
    // clique no fundo escurecido fecha o diálogo
    if (evento.target === ui.dialogo) ui.dialogo.close();
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
        avisar("O mês anterior (" + MESES[mes - 1] + ") não tem dados para copiar.");
        return;
    }

    const destino = obterMes();

    if ((destino.receitas.length || destino.despesas.length)
        && !confirm("Este mês já tem lançamentos. Adicionar os de " + MESES[mes - 1] + " junto com eles?")) {
        return;
    }

    origem.receitas.forEach((r) => destino.receitas.push({ ...r, id: uid() }));
    origem.despesas.forEach((d) => destino.despesas.push({ ...d, id: uid(), pago: false }));

    renderReceitas();
    renderDespesas();
    atualizarResumo();
    avisar("Lançamentos copiados de " + MESES[mes - 1] + ".");
}

function limparMes() {

    const mes = obterMes();

    if (!mes.receitas.length && !mes.despesas.length) {
        avisar("Este mês já está vazio.");
        return;
    }

    if (!confirm("Apagar todas as receitas e despesas de " + MESES[periodo.mes - 1] + " de " + periodo.ano + "? Essa ação não pode ser desfeita.")) {
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
}

function celulaCsv(valor) {

    let texto = String(valor);

    // evita que o Excel interprete o texto como fórmula
    if (/^[=+\-@]/.test(texto)) {
        texto = "'" + texto;
    }

    return '"' + texto.replace(/"/g, '""') + '"';
}

function numeroCsv(valor) {
    return numero(valor).toFixed(2).replace(".", ",");
}

function exportarCsv() {

    const mes = obterMes();

    if (!mes.receitas.length && !mes.despesas.length) {
        avisar("Não há lançamentos neste mês para exportar.");
        return;
    }

    const linhas = [["Tipo", "Nome", "Categoria", "Valor", "Situação"]];

    mes.receitas.forEach((r) => {
        linhas.push(["Receita", r.nome, "", numeroCsv(r.valor), ""]);
    });

    mes.despesas.forEach((d) => {
        linhas.push(["Despesa", d.nome, d.categoria, numeroCsv(d.valor), d.pago ? "Paga" : "A pagar"]);
    });

    const csv = linhas
        .map((linha) => linha.map(celulaCsv).join(";"))
        .join("\r\n");

    baixarArquivo(
        "\ufeff" + csv,
        "controle-financeiro-" + chaveMes(periodo.ano, periodo.mes) + ".csv",
        "text/csv;charset=utf-8"
    );

    avisar("Arquivo CSV gerado.");
}

function exportarBackup() {

    const hoje = new Date().toISOString().slice(0, 10);

    baixarArquivo(
        JSON.stringify(estado, null, 2),
        "controle-financeiro-backup-" + hoje + ".json",
        "application/json"
    );

    avisar("Backup salvo.");
}

function importarBackup(arquivo) {

    if (!arquivo) return;

    const leitor = new FileReader();

    leitor.onload = () => {

        let novo;

        try {
            const bruto = JSON.parse(String(leitor.result));

            if (!bruto || typeof bruto !== "object" || !bruto.meses) {
                throw new Error("formato inválido");
            }

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

        limparFiltros();
        renderTudo();
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

ui.tema.addEventListener("click", () => {

    const atual = document.documentElement.dataset.tema;

    estado.tema = atual === "escuro" ? "claro" : "escuro";

    renderTema();
    salvar();
});

/* ---------- Início ---------- */

renderTudo();
