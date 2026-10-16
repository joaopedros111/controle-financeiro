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
        "storage.js"
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
    assert.match(serviceWorker, /const CACHE = PREFIXO_CACHE \+ "v7"/);
    assert.equal((serviceWorker.match(/"\.\/preferences\.js"/g) || []).length, 1, "preferences.js deve ser precacheado uma vez");
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
    assert.match(app, /registrarUltimaTela\("lancamentos"\)/);
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

test("orçamento fica no resumo, usa valores formatados e controles separados por mês e padrão", async () => {
    const [html, app, core, controls, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("finance-core.js"), read("controls.css"), read("sw.js")
    ]);
    const resumo = html.slice(html.indexOf('<section class="resumo"'), html.indexOf('<section class="bloco grafico-bloco"'));
    assert.match(resumo, /Orçamento por categoria/);
    assert.ok(resumo.includes('id="lista-resumo-orcamentos"'));
    assert.match(html, /id="dialogo-orcamentos"/);
    for (const id of ["gerenciar-orcamentos", "dialogo-orcamentos", "lista-orcamentos", "periodo-orcamentos"]) {
        assert.ok(app.includes(`$("${id}")`), `${id} não conectado`);
    }
    assert.match(app, /calcularOrcamentosPorCategoria/);
    assert.match(app, /formatarMoeda\(gasto\)/);
    assert.match(app, /formatarMoeda\(item\.limiteCentavos \/ 100\)/);
    assert.match(app, /formatarMoeda\(item\.restanteCentavos \/ 100\)/);
    assert.match(app, /estado\.orcamentos\.padrao/);
    assert.match(app, /estado\.orcamentos\.meses\[chave\]/);
    assert.match(app, /campo\.type = valoresOcultos \? "password" : "number"/);
    assert.match(core, /export function calcularOrcamentosPorCategoria/);
    assert.match(app, /const CHAVE_ESTADO = "controleFinanceiro:v3"/);
    assert.match(app, /const CHAVE_ESTADO_V2 = "controleFinanceiro:v2"/);
    for (const recurso of ["./app.js", "./finance-core.js", "./controls.css"]) {
        assert.ok(serviceWorker.includes(`"${recurso}"`), `${recurso} ausente do precache`);
    }
    assert.match(controls, /orcamento-progresso/);
    assert.match(controls, /body\.valores-ocultos \.orcamento-progresso/);
});

test("seções de despesas e entradas usam botões Adicionar e ícones recolhíveis modernos", async () => {
    const html = await read("index.html");
    assert.match(html, /<h2 id="titulo-receitas">Entradas<\/h2>/);
    assert.match(html, /id="adicionar-despesa"[\s\S]*?Adicionar/);
    assert.match(html, /id="adicionar-receita"[\s\S]*?Adicionar/);
    assert.equal((html.match(/class="bloco-seta" viewBox="0 0 24 24"/g) || []).length, 2);
    assert.match(html, /aria-controls="conteudo-receitas" aria-label="Expandir entradas"/);
});
