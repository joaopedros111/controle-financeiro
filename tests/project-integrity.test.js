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
    assert.match(serviceWorker, /const CACHE = PREFIXO_CACHE \+ "v8"/);
    assert.equal((serviceWorker.match(/"\.\/preferences\.js"/g) || []).length, 1, "preferences.js deve ser precacheado uma vez");
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
    assert.match(app, /aria-controls="conteudo-\$\{tipo\}"/);
    assert.match(html, /data-registra-tela="lancamentos"/);
    assert.match(app, /if \(botao\.dataset\.registraTela\) registrarUltimaTela/);
    assert.match(app, /addEventListener\("scroll"/);
    assert.match(app, /classList\.remove\("app-inicializando"\)[\s\S]*requestAnimationFrame/);
    assert.match(serviceWorker, /"\.\/preferences\.js"/);
    assert.match(serviceWorker, /"\.\/app\.js"/);
});

test("temas pangolim e floresta têm cores, alternância e persistência reconhecidas", async () => {
    const [app, css, core, html] = await Promise.all([
        read("app.js"), read("style.css"), read("finance-core.js"), read("index.html")
    ]);
    for (const tema of ["pangolim", "floresta"]) {
        const nome = tema[0].toUpperCase() + tema.slice(1);
        assert.match(app, new RegExp(`${tema}: "${nome}"`));
        assert.match(css, new RegExp(`data-tema="${tema}"`));
        assert.match(core, new RegExp(`"${tema}"`));
    }
    assert.match(app, /claro: "Claro", escuro: "Escuro", rosa: "Rosa", pangolim: "Pangolim", floresta: "Floresta"/);
    assert.match(app, /"claro", "escuro", "rosa", "pangolim", "floresta"/);
    assert.match(html, /pangolim ou floresta/);
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

test("orçamento fica no resumo e separa opções para categorias e limites padrão", async () => {
    const [html, app, core, controls, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("finance-core.js"), read("controls.css"), read("sw.js")
    ]);
    const resumo = html.slice(html.indexOf('<section class="resumo"'), html.indexOf('<section class="bloco grafico-bloco"'));
    assert.match(resumo, /Orçamento por categoria/);
    assert.ok(resumo.includes('id="lista-resumo-orcamentos"'));
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
});

test("orçamento no resumo pode ser recolhido independentemente dos indicadores", async () => {
    const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
    const resumo = html.slice(html.indexOf('<section class="resumo"'), html.indexOf('<section class="bloco grafico-bloco"'));
    const orcamento = resumo.slice(resumo.indexOf('<section class="orcamento-resumo"'));
    assert.match(orcamento, /aria-expanded="true" aria-controls="conteudo-resumo-orcamentos"/);
    assert.match(orcamento, /<div id="conteudo-resumo-orcamentos">[\s\S]*lista-resumo-orcamentos[\s\S]*vazio-resumo-orcamentos/);
    assert.ok(!orcamento.includes('id="saldo-valor"'));
    assert.ok(!orcamento.includes('class="indicadores"'));
    assert.match(app, /botao\.closest\("\.bloco-topo, \.orcamento-resumo-topo"\)/);
    assert.match(app, /if \(botao\.dataset\.registraTela\) registrarUltimaTela/);
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
