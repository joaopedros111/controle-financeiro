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
    abrirAjustes: $("abrir-ajustes"),
    dialogoAjustes: $("dialogo-ajustes"),
    fecharAjustes: $("fechar-ajustes"),
    posicaoBotaoMenu: $("posicao-botao-menu"),
    transparenciaBotaoMenu: $("transparencia-botao-menu"),
    valorTransparenciaBotao: $("valor-transparencia-botao"),
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



        if (bruto.tema === "claro" || bruto.tema === "escuro" || bruto.tema === "rosa") {

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

                despesas: objetosValidos(mes.despesas).map((d) => {



                    const atual = Number(d.parcela && d.parcela.atual);

                    const total = Number(d.parcela && d.parcela.total);

                    const parcelaValida = Number.isInteger(atual) && Number.isInteger(total)

                        && atual >= 1 && total >= 2 && atual <= total;



                    return {

                        id: String(d.id || uid()),

                        nome: String(d.nome || ""),

                        categoria: String(d.categoria || CATEGORIA_FIXA).trim() || CATEGORIA_FIXA,

                        valor: Math.max(0, numero(d.valor)),

                        pago: Boolean(d.pago),

                        fixa: Boolean(d.fixa),

                        serie: d.serie ? String(d.serie) : null,

                        parcela: parcelaValida ? { atual, total } : null

                    };

                })

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

        localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estadoParaSalvar()));

    } catch (erro) {

        avisar("Não foi possível salvar. O armazenamento do navegador pode estar bloqueado ou cheio.");

    }

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
    const nomesTema = { claro: "Claro", escuro: "Escuro", rosa: "Rosa" };
    const ordemTemas = ["claro", "escuro", "rosa"];
    const proximoTema = ordemTemas[(ordemTemas.indexOf(tema) + 1) % ordemTemas.length];



    document.documentElement.dataset.tema = tema;
    const corDaBarraDoNavegador = tema === "rosa" ? "#fff7fb" : tema === "escuro" ? "#0c1020" : "#f4f6fb";
    document.querySelector('meta[name="theme-color"]').content = corDaBarraDoNavegador;

    ui.tema.replaceChildren(
        criarEl("span", { text: tema === "escuro" ? "🌙" : tema === "rosa" ? "🌸" : "☀️" }),
        criarEl("span", { text: "Alterar" })
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



    salvar();

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
            nome: MESES[mes - 1].slice(0, 3).toLocaleLowerCase("pt-BR"),
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
        p.nome + " de " + p.chave.slice(0, 4) + ", entradas " + formatarMoeda(p.receitas) + ", despesas " + formatarMoeda(p.despesas)
    ).join("; "));
}

function renderGraficoCategorias() {
    const rosquinha = $("grafico-rosca");
    const legenda = $("legenda-grafico-categorias");
    if (!rosquinha || !legenda) return;

    const totais = {};
    obterMes().despesas.forEach((despesa) => {
        const valor = numero(despesa.valor);
        if (valor > 0) totais[despesa.categoria] = (totais[despesa.categoria] || 0) + valor;
    });
    const itens = Object.entries(totais).sort((a, b) => b[1] - a[1]);
    const total = itens.reduce((soma, [, valor]) => soma + valor, 0);
    const nomeMes = MESES[periodo.mes - 1] + " de " + periodo.ano;
    $("periodo-grafico-categorias").textContent = nomeMes;
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
        ? "Despesas por categoria em " + nomeMes + ". Total " + formatarMoeda(total) + ". " + itens.map(([nome, valor]) =>
            nome + ": " + formatarMoeda(valor) + ", " + formatarPercentual((valor / total) * 100)
        ).join("; ")
        : "Nenhuma despesa com valor registrado em " + nomeMes + ".");
}

function renderTudo() {

    renderTema();

    renderPeriodo();

    renderReceitas();

    renderDespesas();

    atualizarResumo();

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
    const valor = Number(valorDigitado);

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
        botao.setAttribute("aria-expanded", String(!expandido));
        const titulo = botao.closest(".bloco-topo").querySelector("h2").textContent.trim().toLowerCase();
        botao.setAttribute("aria-label", (expandido ? "Expandir " : "Recolher ") + titulo);
        conteudo.hidden = expandido;
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
    const valor = Number(valorDigitado);

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

    renderListaCategorias();

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

        avisar("O mês anterior (" + MESES[mes - 1] + ") não tem dados para copiar.");

        return;

    }



    const destino = obterMes();



    if ((destino.receitas.length || destino.despesas.length)

        && !confirm("Este mês já tem lançamentos. Adicionar os de " + MESES[mes - 1] + " junto com eles?")) {

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

    avisar("Lançamentos copiados de " + MESES[mes - 1] + ".");

}



function limparMes() {



    const mes = obterMes();



    if (!mes.receitas.length && !mes.despesas.length) {

        avisar("Este mês já está vazio.");

        return;

    }



    if (!confirm("Apagar todas as entradas e despesas de " + MESES[periodo.mes - 1] + " de " + periodo.ano + "? Essa ação não pode ser desfeita.")) {

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



    const linhas = [["Tipo", "Nome", "Categoria", "Valor", "Situação", "Observação"]];



    mes.receitas.forEach((r) => {

        linhas.push(["Entrada", r.nome, "", numeroCsv(r.valor), "", ""]);

    });



    mes.despesas.forEach((d) => {

        const observacao = d.parcela

            ? "Parcela " + d.parcela.atual + "/" + d.parcela.total

            : (d.fixa ? "Fixa" : "");



        linhas.push(["Despesa", d.nome, d.categoria, numeroCsv(d.valor), d.pago ? "Paga" : "A pagar", observacao]);

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

        JSON.stringify(estadoParaSalvar(), null, 2),

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



            if (
                !bruto ||
                typeof bruto !== "object" ||
                Array.isArray(bruto) ||
                !bruto.meses ||
                typeof bruto.meses !== "object" ||
                Array.isArray(bruto.meses)
            ) {
                throw new Error("formato inválido");
            }

            const mesesValidos = Object.entries(bruto.meses).every(([chave, mes]) =>
                /^\d{4}-(0[1-9]|1[0-2])$/.test(chave) &&
                mes &&
                typeof mes === "object" &&
                !Array.isArray(mes) &&
                (mes.receitas === undefined || Array.isArray(mes.receitas)) &&
                (mes.despesas === undefined || Array.isArray(mes.despesas))
            );

            if (!mesesValidos) {
                throw new Error("estrutura de meses inválida");
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

        ultimaRemocao = null;



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

const CHAVE_PREFERENCIAS_MENU = "controleFinanceiro:preferencias-menu";
let preferenciasMenu = { posicao: "centro", transparencia: 45, x: null, y: null };
try {
    const salvas = JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS_MENU) || "null");
    if (salvas && typeof salvas === "object") preferenciasMenu = { ...preferenciasMenu, ...salvas };
} catch (_) { /* usa os padrões */ }
function salvarPreferenciasMenu() {
    localStorage.setItem(CHAVE_PREFERENCIAS_MENU, JSON.stringify(preferenciasMenu));
}
function aplicarPreferenciasMenu() {
    document.body.dataset.posicaoMenu = preferenciasMenu.posicao;
    document.documentElement.style.setProperty("--menu-transparencia", (100 - preferenciasMenu.transparencia) + "%");
    ui.posicaoBotaoMenu.value = preferenciasMenu.posicao;
    ui.transparenciaBotaoMenu.value = String(preferenciasMenu.transparencia);
    ui.valorTransparenciaBotao.value = preferenciasMenu.transparencia + "%";
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
$("calcular-resultado").addEventListener("click", () => {
    const expressao = ui.visorCalculadora.value.replace(/,/g, ".").replace(/[^\d.+*/()\-\s]/g, "");
    if (!expressao.trim()) return;
    try {
        const resultado = Function("return (" + expressao + ")")();
        if (!Number.isFinite(resultado)) throw new Error("resultado inválido");
        ui.visorCalculadora.value = String(Number(resultado.toFixed(10))).replace(".", ",");
    } catch (_) {
        ui.visorCalculadora.setCustomValidity("Expressão inválida");
        ui.visorCalculadora.reportValidity();
        ui.visorCalculadora.setCustomValidity("");
    }
});
ui.alternarVisibilidadeResumo.addEventListener("click", () => {
    const ocultos = ui.alternarVisibilidadeResumo.getAttribute("aria-pressed") !== "true";
    document.querySelector(".resumo").classList.toggle("valores-ocultos", ocultos);
    ui.alternarVisibilidadeResumo.setAttribute("aria-pressed", String(ocultos));
    ui.alternarVisibilidadeResumo.setAttribute("aria-label", ocultos ? "Mostrar valores do resumo" : "Ocultar valores do resumo");
    ui.alternarVisibilidadeResumo.title = ocultos ? "Mostrar valores do resumo" : "Ocultar valores do resumo";
});
ui.atualizarApp.addEventListener("click", async () => {
    if (!("serviceWorker" in navigator) || !navigator.onLine) {
        avisar("Conecte-se à internet para verificar atualizações.");
        return;
    }

    const botao = ui.atualizarApp;
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Verificando…";

    try {
        const registro = await navigator.serviceWorker.getRegistration();
        if (!registro) throw new Error("O app ainda não está pronto para atualização.");

        await registro.update();
        const worker = navigator.serviceWorker.controller || registro.active;
        if (!worker) throw new Error("Não foi possível acessar o atualizador do app.");

        const resposta = await new Promise((resolve, reject) => {
            const canal = new MessageChannel();
            const temporizador = setTimeout(() => reject(new Error("A atualização demorou demais. Tente novamente.")), 30000);
            canal.port1.onmessage = (evento) => {
                clearTimeout(temporizador);
                resolve(evento.data);
            };
            worker.postMessage({ tipo: "ATUALIZAR_ARQUIVOS" }, [canal.port2]);
        });

        if (!resposta?.ok || !resposta.arquivos?.includes("./index.html") || !resposta.arquivos?.includes("./app.js")) {
            throw new Error("Não foi possível baixar a versão mais recente. Tente novamente.");
        }

        avisar("App atualizado. Reabrindo…");
        setTimeout(() => window.location.reload(), 500);
    } catch (erro) {
        avisar(erro.message || "Não foi possível verificar atualizações.");
    } finally {
        botao.disabled = false;
        botao.textContent = textoOriginal;
    }
});
ui.dialogoAjustes.addEventListener("click", (evento) => {
    if (evento.target === ui.dialogoAjustes) ui.dialogoAjustes.close();
});



ui.tema.addEventListener("click", () => {



    const atual = document.documentElement.dataset.tema;



    const ordemTemas = ["claro", "escuro", "rosa"];
    estado.tema = ordemTemas[(ordemTemas.indexOf(atual) + 1) % ordemTemas.length];



    renderTema();

    salvar();

});



/* ---------- Início ---------- */



renderTudo();
