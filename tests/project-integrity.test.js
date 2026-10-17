import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("referências estáticas do app apontam para IDs existentes e únicos", async () => {
    const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const idSet = new Set(ids);
    assert.equal(idSet.size, ids.length, "há IDs duplicados no HTML");
    const usados = [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(usados.filter((id) => !idSet.has(id)))], [], "há seletores de ID sem elemento no HTML");
});

test("módulos e estilos usados pela página estão incluídos no cache offline", async () => {
    const [html, serviceWorker] = await Promise.all([read("index.html"), read("sw.js")]);
    const arquivos = [
        ...[...html.matchAll(/<link[^>]+href="([^"]+\.(?:css|json))"/g)].map((match) => match[1]),
        ...[...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]),
        "finance-core.js",
        "storage.js",
        "update-manager.js",
        "localization.js",
        "version.json"
    ].map((path) => path.startsWith("./") ? path : "./" + path);
    for (const arquivo of arquivos) {
        assert.ok(serviceWorker.includes(`"${arquivo}"`), `${arquivo} não consta no precache`);
        assert.ok(existsSync(fileURLToPath(new URL(arquivo, root))), `${arquivo} não existe`);
    }
});

test("controles das preferências incrementais têm implementação e cache atualizados", async () => {
    const [html, app, css, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("style.css"), read("sw.js")
    ]);
    for (const id of ["densidade-interface", "mostrar-graficos", "tela-inicial", "referencia-mes", "ocultar-ao-iniciar", "alternar-valores", "escopo-csv", "diagnostico-dados"]) {
        assert.match(html, new RegExp(`id="${id}"`), `controle ${id} ausente`);
        assert.ok(app.includes(`$("${id}")`), `controle ${id} sem conexão com o app`);
    }
    assert.match(css, /data-densidade="compacta"/);
    assert.match(css, /graficos-ocultos/);
    assert.match(app, /preferenciasMenu\.ocultarAoIniciar/);
    assert.match(app, /preferenciasMenu\.ultimoPeriodo/);
    assert.match(serviceWorker, /const CACHE = PREFIXO_CACHE \+ "v13"/);
    assert.equal((serviceWorker.match(/"\.\/preferences\.js"/g) || []).length, 1, "preferences.js deve ser precacheado uma vez");
});

test("idioma e moeda são preferências persistentes, formatam a apresentação e entram no precache", async () => {
    const [html, app, preferences, localization, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("preferences.js"),
        read("localization.js"), read("sw.js")
    ]);
    for (const id of ["idioma-interface", "moeda-interface"]) {
        assert.match(html, new RegExp(`id="${id}"`));
        assert.ok(app.includes(`$("${id}")`));
    }
    assert.match(preferences, /idioma: "pt-BR", moeda: "BRL"/);
    assert.match(app, /formatarMoedaLocalizada\(valorVisivel, preferenciasMenu\.moeda, idiomaAtual\)/);
    assert.match(app, /preferenciasMenu\.idioma = ui\.idiomaInterface\.value/);
    assert.match(localization, /The currency changes only how amounts are displayed/);
    assert.match(serviceWorker, /"\.\/localization\.js"/);
    assert.match(html, /Os números armazenados não são convertidos/);
});

test("versão instalada e publicada usam metadados semver relativos e não cacheados para verificação", async () => {
    const [metadata, html, app, serviceWorker] = await Promise.all([
        read("version.json"), read("index.html"), read("app.js"), read("sw.js")
    ]);
    const version = JSON.parse(metadata);
    assert.equal(version.name, "Controle Financeiro");
    assert.match(version.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    for (const id of [
        "versao-instalada", "versao-publicada", "data-verificacao-atualizacao",
        "resultado-verificacao-atualizacao", "status-atualizacao"
    ]) assert.ok(html.includes(`id="${id}"`), `${id} ausente`);
    assert.match(app, /lerVersaoInstalada\(\)/);
    assert.match(app, /lerVersaoPublicada\(\)/);
    assert.match(app, /navigator\.serviceWorker\.getRegistration\(escopo\)/);
    assert.match(app, /if \(verificacaoAtualizacaoAtiva\) return/);
    assert.match(app, /botao\.disabled = true;[\s\S]*botao\.textContent = "Verificando…"/);
    assert.match(app, /window\.confirm\([\s\S]*Versão instalada:[\s\S]*Versão disponível:/);
    assert.match(app, /resultado === "cancelado"/);
    assert.match(app, /instalarAtualizacao\(registro, navigator\.serviceWorker\)/);
    assert.match(serviceWorker, /"\.\/version\.json"/);
    assert.match(serviceWorker, /"\.\/update-manager\.js"/);
    assert.match(serviceWorker, /searchParams\.has\("_verificacao"\)/);
    assert.match(serviceWorker, /fetch\(requisicao, \{ cache: "no-store" \}\)/);
});

test("controle de tamanho é conectado e botões de opções contrastam com o fundo", async () => {
    const [html, app, css] = await Promise.all([
        read("index.html"), read("app.js"), read("controls.css")
    ]);
    for (const id of ["tamanho-botao-menu", "valor-tamanho-botao-menu"]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /id="tamanho-botao-menu" type="range" min="44" max="76"/);
    assert.match(app, /preferenciasMenu\.tamanhoBotao/);
    assert.match(app, /ui\.tamanhoBotaoMenu\.addEventListener\("input"/);
    assert.match(app, /ui\.tamanhoBotaoMenu\.value = String\(preferenciasMenu\.tamanhoBotao\)/);
    assert.match(css, /width: var\(--menu-tamanho, 58px\)/);
    assert.match(css, /#dialogo-ajustes \.btn-secundario \{ background: var\(--superficie-suave\); \}/);
});

test("valores monetários usam formatação centralizada nas listas, resumos e gráficos", async () => {
    const [html, app, css] = await Promise.all([
        read("index.html"), read("app.js"), read("style.css")
    ]);
    assert.match(app, /return apresentarValorFinanceiro\(valor, valoresOcultos,/);
    assert.match(app, /valoresOcultos = preferenciasMenu\.ocultarAoIniciar/);
    assert.match(app, /renderTudo\(false\)/);
    for (const seletor of [
        "saldo-valor", "total-receitas", "total-despesas", "valor-pago", "valor-pendente",
        "total-receitas-lista", "total-valor", "total-grafico-categorias",
        "grafico-categoria-valor", "valor-receita", "valor-despesa"
    ]) {
        assert.ok(html.includes(`id="${seletor}"`) || app.includes(`class: "${seletor}"`), `${seletor} sem componente`);
    }
    assert.match(app, /title: rotulo \+ " em ".*formatarMoeda\(valor\)/);
    assert.match(app, /formatarMoeda\(p\.receitas\).*formatarMoeda\(p\.despesas\)/);
    assert.match(app, /formatarMoeda\(total\)[\s\S]*formatarMoeda\(valor\)/);
    assert.match(css, /body\.valores-ocultos \.grafico-barras/);
    assert.match(css, /body\.valores-ocultos #grafico-rosca/);
    assert.match(css, /html\.app-inicializando \.container/);
    assert.match(html, /class="app-inicializando"/);
});

test("tela inicial reutiliza as seções e o estado de navegação existentes", async () => {
    const [html, app, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("sw.js")
    ]);
    for (const [valor, rotulo] of [
        ["resumo", "Resumo do mês"],
        ["lancamentos", "Lançamentos"],
        ["graficos", "Gráficos"],
        ["ultimo", "Última tela utilizada"]
    ]) {
        assert.match(html, new RegExp(`<option value="${valor}">${rotulo}</option>`));
    }
    assert.match(app, /resolverTelaInicial\(preferenciasMenu\)/);
    assert.match(app, /telaSolicitada === "lancamentos" && !lancamentosVisiveis \? "resumo" : telaSolicitada/);
    assert.match(app, /preferenciasMenu\.mostrarDespesas \? "#titulo-despesas" : "#titulo-receitas"/);
    assert.match(app, /preferenciasMenu\.mostrarEntradas \? \["receitas"\] : \[\]/);
    assert.match(app, /aria-controls="conteudo-\$\{tipo\}"/);
    assert.match(html, /data-registra-tela="lancamentos"/);
    assert.match(app, /if \(botao\.dataset\.registraTela\) registrarUltimaTela/);
    assert.match(app, /addEventListener\("scroll"/);
    assert.match(app, /classList\.remove\("app-inicializando"\)[\s\S]*requestAnimationFrame/);
    assert.match(serviceWorker, /"\.\/preferences\.js"/);
    assert.match(serviceWorker, /"\.\/app\.js"/);
});

test("os cinco temas mantêm identificadores, cores e nomes de exibição", async () => {
    const [app, css, core, html] = await Promise.all([
        read("app.js"), read("style.css"), read("finance-core.js"), read("index.html")
    ]);
    for (const tema of ["pangolim", "floresta"]) {
        assert.match(css, new RegExp(`data-tema="${tema}"`));
        assert.match(core, new RegExp(`"${tema}"`));
    }
    assert.match(app, /claro: "Claro", escuro: "Escuro", rosa: "Rosa", pangolim: "Pangolim", floresta: "Selva"/);
    assert.match(app, /criarEl\("span", \{ text: nomesTema\[tema\] \}\)/);
    assert.match(app, /"claro", "escuro", "rosa", "pangolim", "floresta"/);
    assert.match(html, /Escuro, Claro, Rosa, Selva ou Pangolim/);
    assert.match(html, /id="alternar-tema"[\s\S]*?<span>Claro<\/span>/);
    assert.match(core, /"claro", "escuro", "rosa", "pangolim", "floresta"/);
    assert.match(app, /const tema = estado\.tema \|\| "claro"/);
    assert.doesNotMatch(app, /prefers-color-scheme/);
    assert.match(app, /estado\.tema = ordemTemas\[\(ordemTemas\.indexOf\(atual\) \+ 1\) % ordemTemas\.length\]/);
});

test("calculadora fica centralizada no topo e oferece operações adicionais", async () => {
    const [html, app, css] = await Promise.all([
        read("index.html"), read("app.js"), read("controls.css")
    ]);
    for (const id of ["limpar-calculadora", "apagar-calculadora", "calcular-resultado"]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    for (const operador of ["(", ")", "%"]) assert.match(html, new RegExp(`data-calculadora="${operador.replace(/[()]/g, "\\$&")}"`));
    assert.match(css, /\.dialogo-calculadora \{[^}]*position: fixed;[^}]*50%/);
    assert.match(css, /\.dialogo-calculadora\[open\] \{ animation: none; \}/);
    assert.match(app, /apagar-calculadora/);
    assert.match(app, /evento\.key !== "Enter"/);
});

test("planejamento contém o orçamento uma única vez e mantém opções de categoria e limite", async () => {
    const [html, app, core, controls, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("finance-core.js"), read("controls.css"), read("sw.js")
    ]);
    const resumo = html.slice(html.indexOf('<section class="resumo"'), html.indexOf('<section class="bloco grafico-bloco"'));
    const planejamento = html.slice(html.indexOf('id="secao-planejamento"'), html.indexOf("<!-- Despesas -->"));
    assert.doesNotMatch(resumo, /orçamento por categoria|lista-planejamento-orcamentos/i);
    assert.match(planejamento, /id="titulo-planejamento">Planejamento/);
    assert.match(planejamento, /ORÇAMENTO POR CATEGORIA/);
    assert.equal((html.match(/id="lista-planejamento-orcamentos"/g) || []).length, 1);
    assert.match(html, /id="dialogo-orcamentos"/);
    for (const id of [
        "gerenciar-orcamentos", "dialogo-orcamentos", "lista-orcamentos",
        "opcoes-orcamento", "abrir-categorias-orcamento", "abrir-limites-orcamento",
        "painel-categorias-orcamento", "painel-limites-orcamento"
    ]) {
        assert.ok(app.includes(`$("${id}")`), `${id} não conectado`);
    }
    assert.match(html, /Adicionar categorias/);
    assert.match(html, /Configurar limites de orçamento/);
    assert.match(html, /Limites mensais por categoria/);
    assert.doesNotMatch(html, /Limite somente para este mês/);
    assert.doesNotMatch(app, /orcamentoAcao: "salvar-mes"|orcamentoAcao: "usar-padrao"/);
    assert.match(app, /calcularOrcamentosPorCategoria/);
    assert.match(app, /ordenarOrcamentosComGastos\(calcularOrcamentosPorCategoria/);
    assert.match(app, /formatarMoeda\(gasto\)/);
    assert.match(app, /formatarMoeda\(item\.limiteCentavos \/ 100\)/);
    assert.match(app, /formatarMoeda\(item\.restanteCentavos \/ 100\)/);
    assert.match(app, /estado\.orcamentos\.padrao/);
    assert.match(core, /return \{ padrao, meses: \{\} \}/);
    assert.match(app, /campo\.type = valoresOcultos \? "password" : "number"/);
    assert.match(core, /export function calcularOrcamentosPorCategoria/);
    assert.match(core, /export function ordenarOrcamentosComGastos/);
    assert.match(app, /const CHAVE_ESTADO = "controleFinanceiro:v3"/);
    assert.match(app, /const CHAVE_ESTADO_V2 = "controleFinanceiro:v2"/);
    for (const recurso of ["./app.js", "./finance-core.js", "./controls.css"]) {
        assert.ok(serviceWorker.includes(`"${recurso}"`), `${recurso} ausente do precache`);
    }
    assert.match(controls, /orcamento-progresso/);
    assert.match(controls, /body\.valores-ocultos \.orcamento-progresso/);
    assert.match(app, /ui\.listaPlanejamentoOrcamentos\.replaceChildren/);
    assert.doesNotMatch(app.slice(app.indexOf("function renderOrcamentoPorCategoria"), app.indexOf("function renderListaOrcamentos")), /preferenciasMenu\.mostrarPlanejamento/);
});

test("planejamento fica entre resumo e despesas e pode ser recolhido independentemente", async () => {
    const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
    const resumo = html.indexOf('<section class="resumo"');
    const planejamento = html.indexOf('id="secao-planejamento"');
    const despesas = html.indexOf('id="secao-despesas"');
    const entradas = html.indexOf('id="secao-entradas"');
    assert.ok(resumo < planejamento && planejamento < despesas && despesas < entradas);
    const secao = html.slice(planejamento, despesas);
    assert.match(secao, /aria-expanded="true" aria-controls="conteudo-planejamento"/);
    assert.match(secao, /id="conteudo-planejamento"[\s\S]*lista-planejamento-orcamentos[\s\S]*vazio-planejamento-orcamentos/);
    assert.match(app, /botao\.closest\("\.bloco-topo, \.orcamento-resumo-topo"\)/);
    assert.match(app, /conteudo\.hidden = expandido/);
    assert.match(app, /if \(botao\.dataset\.registraTela\) registrarUltimaTela/);
});

test("Configurar no planejamento usa o mesmo estilo e tamanho dos botões Adicionar", async () => {
    const html = await read("index.html");
    const classes = ["gerenciar-orcamentos", "adicionar-despesa", "adicionar-receita"]
        .map((id) => html.match(new RegExp(`<button id="${id}" class="([^"]+)"`))?.[1]);
    assert.deepEqual(classes, ["btn btn-primario", "btn btn-primario", "btn btn-primario"]);
    const css = await read("controls.css");
    assert.doesNotMatch(css, /#gerenciar-orcamentos\s*\{/);
});

test("visibilidade altera somente apresentação e tem controles persistentes independentes", async () => {
    const [html, app, preferences, controls, layout] = await Promise.all([
        read("index.html"), read("app.js"), read("preferences.js"), read("controls.css"), read("style.css")
    ]);
    const aparencia = html.slice(html.indexOf('aria-labelledby="titulo-aparencia"'), html.indexOf('aria-labelledby="titulo-botao-menu"'));
    assert.match(aparencia, /id="titulo-aparencia">Aparência e visualização/);
    assert.doesNotMatch(html, /titulo-privacidade|Privacidade e visualização/);
    for (const [id, chave, secao] of [
        ["mostrar-planejamento", "mostrarPlanejamento", "secao-planejamento"],
        ["mostrar-despesas-mes", "mostrarDespesas", "secao-despesas"],
        ["mostrar-entradas", "mostrarEntradas", "secao-entradas"]
    ]) {
        assert.match(aparencia, new RegExp(`id="${id}" type="checkbox" checked`));
        assert.match(app, new RegExp(`preferenciasMenu\\.${chave}`));
        assert.match(app, new RegExp(`\\$\\("${secao}"\\)\\.hidden = !preferenciasMenu\\.${chave}`));
    }
    assert.match(aparencia, /id="ocultar-ao-iniciar" type="checkbox"/);
    assert.match(aparencia, /id="alternar-valores"/);
    assert.match(aparencia, /id="mostrar-graficos" type="checkbox"/);
    assert.match(preferences, /mostrarPlanejamento: true, mostrarDespesas: true, mostrarEntradas: true/);
    assert.match(app, /const CHAVE_PREFERENCIAS_MENU = "controleFinanceiro:preferencias-menu"/);
    assert.match(controls, /ajuste-controle\.ajuste-alternancia/);
    assert.match(controls, /@media \(max-width: 480px\)/);
    assert.match(controls, /\.ajustes-secao \{ display: grid; gap: 10px; \}/);
    assert.match(layout, /body\[data-densidade="compacta"\] #dialogo-ajustes \.ajustes-secao \{ gap: 7px; \}/);
    assert.match(layout, /body\[data-densidade="confortavel"\] #dialogo-ajustes \.ajustes-secao \{ gap: 13px; \}/);
    assert.match(controls, /\.ajuste-controle select \{ width: 100%; min-width: 0;/);

    const handlers = app.slice(app.indexOf('ui.mostrarPlanejamento.addEventListener'), app.indexOf('ui.telaInicial.addEventListener'));
    assert.match(handlers, /aplicarVisibilidadeSecoes\(\)[\s\S]*salvarPreferenciasMenu\(\)/);
    assert.doesNotMatch(handlers, /salvar\(\)|renderTudo\(|renderDespesas\(|renderReceitas\(|atualizarResumo\(/);
    const orcamento = app.slice(app.indexOf("function renderOrcamentoPorCategoria"), app.indexOf("function renderListaOrcamentos"));
    assert.match(orcamento, /mes\.despesas/);
    assert.doesNotMatch(orcamento, /mes\.receitas/);
});

test("gerenciamento de categorias fica dentro do diálogo de orçamento e sai do menu Opções", async () => {
    const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
    const orcamentos = html.slice(html.indexOf('<dialog id="dialogo-orcamentos"'), html.indexOf("</dialog>", html.indexOf('<dialog id="dialogo-orcamentos"')));
    const ajustes = html.slice(html.indexOf('<dialog id="dialogo-ajustes"'), html.indexOf("</dialog>", html.indexOf('<dialog id="dialogo-ajustes"')));

    assert.match(orcamentos, /id="lista-categorias"/);
    assert.match(orcamentos, /id="nova-categoria"/);
    assert.match(orcamentos, /id="adicionar-categoria"/);
    assert.match(orcamentos, /id="abrir-categorias-orcamento"/);
    assert.match(orcamentos, /id="abrir-limites-orcamento"/);
    assert.ok(!html.includes('id="dialogo-categorias"'));
    assert.ok(!html.includes('id="gerenciar-categorias"'));
    assert.ok(!ajustes.includes("Gerenciar categorias"));
    assert.match(app, /ui\.abrirCategoriasOrcamento\.addEventListener\("click"[\s\S]*renderListaCategorias\(\)[\s\S]*ui\.novaCategoria\.focus\(\)/);
    assert.match(app, /ui\.abrirLimitesOrcamento\.addEventListener\("click"[\s\S]*renderListaOrcamentos\(\)/);
    assert.match(app, /ui\.gerenciarOrcamentos\.addEventListener\("click"[\s\S]*mostrarPainelOrcamentos\("opcoes"\)/);
});

test("seções de despesas e entradas usam botões Adicionar e ícones recolhíveis modernos", async () => {
    const html = await read("index.html");
    assert.match(html, /<h2 id="titulo-receitas">Entradas<\/h2>/);
    assert.match(html, /id="adicionar-despesa"[\s\S]*?Adicionar/);
    assert.match(html, /id="adicionar-receita"[\s\S]*?Adicionar/);
    assert.equal((html.match(/class="bloco-seta" viewBox="0 0 24 24"/g) || []).length, 3);
    assert.match(html, /aria-controls="conteudo-receitas" aria-label="Expandir entradas"/);
    const css = await read("style.css");
    assert.match(css, /\.bloco-retrair \{[^}]*width: 38px;[^}]*height: 38px;/);
    assert.match(css, /\.bloco-seta \{[^}]*width: 21px;[^}]*height: 21px;/);
});
