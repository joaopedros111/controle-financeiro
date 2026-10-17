import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative, sep } from "node:path";
import { versaoValida } from "../update-manager.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function validarConsistenciaRelease(conteudoMetadados, codigoServiceWorker) {
    assert.equal(typeof conteudoMetadados, "string", "version.json está ausente");
    const metadados = JSON.parse(conteudoMetadados);
    assert.equal(metadados.name, "Controle Financeiro");
    assert.ok(versaoValida(metadados.version), "version.json contém versão inválida");

    const identidade = codigoServiceWorker.match(/const VERSAO_SERVICE_WORKER = "([^"]+)";/);
    assert.ok(identidade, "identidade de build ausente no Service Worker");
    assert.equal(identidade[1], metadados.version, "identidade do Service Worker diverge de version.json");

    const prefixoCache = codigoServiceWorker.match(/const PREFIXO_CACHE = "([^"]+)";/);
    const sufixoCache = codigoServiceWorker.match(/const CACHE = PREFIXO_CACHE \+ "(v[1-9]\d*)";/);
    assert.ok(prefixoCache?.[1], "prefixo do cache ausente");
    assert.ok(sufixoCache, "identificador do cache não segue o padrão PREFIXO_CACHE + vN");

    return {
        cache: `${prefixoCache[1]}${sufixoCache[1]}`,
        prefixoCache: prefixoCache[1]
    };
}

function lerRecursosPrecache(codigoServiceWorker) {
    const lista = codigoServiceWorker.match(/const ARQUIVOS = \[([\s\S]*?)\];/);
    assert.ok(lista, "lista ARQUIVOS do precache ausente");
    return [...lista[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("referências estáticas do app apontam para IDs existentes e únicos", async () => {
    const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const idSet = new Set(ids);
    assert.equal(idSet.size, ids.length, "há IDs duplicados no HTML");
    const usados = [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(usados.filter((id) => !idSet.has(id)))], [], "há seletores de ID sem elemento no HTML");
});

test("módulos e estilos usados pela página estão incluídos no cache offline", async () => {
    const [html, serviceWorker, manifest] = await Promise.all([
        read("index.html"), read("sw.js"), read("manifest.json")
    ]);
    const scope = new URL("https://example.test/finance/");
    const precache = new Set(lerRecursosPrecache(serviceWorker));
    const arquivosEssenciais = [
        ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1]),
        ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]),
        ...JSON.parse(manifest).icons.map((icone) => icone.src)
    ];

    const pendentes = ["app.js"];
    const visitados = new Set();
    while (pendentes.length) {
        const arquivo = pendentes.pop();
        if (visitados.has(arquivo)) continue;
        visitados.add(arquivo);
        const codigo = await read(arquivo);
        for (const [, , dependencia] of codigo.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\/[^"']+)\1/g)) {
            const caminho = fileURLToPath(new URL(dependencia, new URL(arquivo, root)));
            pendentes.push(relative(fileURLToPath(root), caminho).split(sep).join("/"));
        }
    }
    arquivosEssenciais.push(...visitados);

    for (const recurso of arquivosEssenciais) {
        const caminhoPrecache = recurso.startsWith("./") ? recurso : `./${recurso}`;
        assert.ok(precache.has(caminhoPrecache), `${caminhoPrecache} não consta no precache`);
        assert.ok(
            new URL(caminhoPrecache, scope).pathname.startsWith(scope.pathname),
            `${caminhoPrecache} escapa do escopo do app publicado em subdiretório`
        );
        assert.ok(
            existsSync(fileURLToPath(new URL(caminhoPrecache, root))),
            `${caminhoPrecache} não existe no projeto`
        );
    }
    for (const recurso of precache) {
        assert.ok(
            new URL(recurso, scope).pathname.startsWith(scope.pathname),
            `${recurso} do precache escapa do escopo do app`
        );
        assert.ok(
            existsSync(fileURLToPath(new URL(recurso, root))),
            `${recurso} do precache não existe no projeto`
        );
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
    assert.match(serviceWorker, /const CACHE = PREFIXO_CACHE \+ "v\d+"/);
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
    const release = validarConsistenciaRelease(metadata, serviceWorker);
    assert.match(release.cache.slice(release.prefixoCache.length), /^v\d+$/);
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
    assert.match(app, /await instalarAtualizacao\([\s\S]*publicada\.version\)/);
    assert.match(app, /if \(versaoAtivada !== publicada\.version\)/);
    assert.match(app, /Nova versão instalada e controlando esta página/);
    assert.ok(lerRecursosPrecache(serviceWorker).includes("./version.json"));
    assert.ok(lerRecursosPrecache(serviceWorker).includes("./update-manager.js"));
    assert.match(serviceWorker, /searchParams\.has\("_verificacao"\)/);
    assert.match(serviceWorker, /fetch\(requisicao, \{ cache: "no-store" \}\)/);
});

test("verificações do release detectam metadados ausentes, inválidos e incompatíveis", async () => {
    const serviceWorker = await read("sw.js");
    const metadadosValidos = await read("version.json");
    assert.throws(() => validarConsistenciaRelease(null, serviceWorker), /version\.json está ausente/);
    assert.throws(() => validarConsistenciaRelease("{", serviceWorker), SyntaxError);
    assert.throws(
        () => validarConsistenciaRelease('{"name":"Controle Financeiro","version":"inválida"}', serviceWorker),
        /versão inválida/
    );
    assert.throws(
        () => validarConsistenciaRelease(
            '{"name":"Controle Financeiro","version":"9.9.9"}',
            serviceWorker
        ),
        /diverge de version\.json/
    );
    assert.throws(
        () => validarConsistenciaRelease(
            metadadosValidos,
            serviceWorker.replace(/const CACHE = PREFIXO_CACHE \+ "v\d+";/, 'const CACHE = "cache-sem-versão";')
        ),
        /não segue o padrão/
    );
});

test("protocolo de identidade e ativação está presente nos dois lados", async () => {
    const [serviceWorker, manager] = await Promise.all([read("sw.js"), read("update-manager.js")]);
    for (const tipo of ["OBTER_VERSAO", "VERSAO_SERVICE_WORKER", "ATIVAR_ATUALIZACAO", "ATUALIZACAO_ACEITA"]) {
        assert.ok(serviceWorker.includes(tipo), `Service Worker não implementa ${tipo}`);
        assert.ok(manager.includes(tipo), `gerenciador não implementa ${tipo}`);
    }
});

test("a aplicação só recarrega depois de confirmar a identidade ativa e não duplica recargas", async () => {
    const app = await read("app.js");
    const inicioVerificacao = app.indexOf("async function verificarAtualizacao");
    const fimVerificacao = app.indexOf("const verificarAtualizacaoAutomaticamente", inicioVerificacao);
    const fluxoVerificacao = app.slice(inicioVerificacao, fimVerificacao);
    const confirmacaoIdentidade = app.indexOf("if (versaoAtivada !== publicada.version)");
    const recarga = app.indexOf("window.location.reload()");
    assert.doesNotMatch(fluxoVerificacao, /storage\.(?:salvar|limpar)|localStorage|indexedDB/);
    assert.ok(confirmacaoIdentidade >= 0, "a versão ativa precisa ser comparada com a versão aceita");
    assert.ok(recarga > confirmacaoIdentidade, "a recarga deve ocorrer apenas após confirmar a versão ativa");
    assert.equal((app.match(/window\.location\.reload\(\)/g) || []).length, 1);
});

test("verificação automática roda ao iniciar, retornar ao app e recuperar conexão", async () => {
    const app = await read("app.js");
    assert.match(app, /criarVerificadorAutomatico\(\s*\(\) => verificarAtualizacao\(\{ automatico: true \}\)/);
    assert.match(app, /document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(document\.visibilityState === "visible"\) solicitarVerificacaoAutomatica\(\)/);
    assert.match(app, /window\.addEventListener\("pageshow", \(evento\) => \{\s*if \(evento\.persisted\) solicitarVerificacaoAutomatica\(\)/);
    assert.match(app, /window\.addEventListener\("online", solicitarVerificacaoAutomatica\)/);
    assert.match(app, /document\.readyState === "complete"\) solicitarVerificacaoAutomatica\(\)/);
    assert.match(app, /if \(!navigator\.onLine\) return;\s*verificarAtualizacaoAutomaticamente\(\)/);
    assert.match(app, /automatico && confirmacaoAtualizacao\.foiAdiada\(publicada\.version\)/);
    assert.match(app, /confirmacaoAtualizacao\.confirmar\(versaoAtual, versaoNova, automatico\)/);
    assert.match(app, /ui\.atualizarApp\.addEventListener\("click", \(\) => \{ void verificarAtualizacao\(\); \}\)/);
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
    assert.match(app, /Excesso: \$\{formatarMoeda\(Math\.abs\(item\.restanteCentavos\) \/ 100\)\} · \$\{formatarPercentual\(percentual\)\} consumido/);
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
    assert.match(aparencia, /class="ajuste-linha ajuste-controle ajuste-alternancia" for="mostrar-graficos"[\s\S]*?id="mostrar-graficos" type="checkbox"/);
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

test("gráfico por categoria usa agregação segura também no renderizador", async () => {
    const [app, core] = await Promise.all([read("app.js"), read("finance-core.js")]);
    assert.match(app, /agruparDespesasPorCategoria\(obterMes\(\)\.despesas\)/);
    assert.match(core, /const totaisCentavos = Object\.create\(null\)/);
});

test("despesas renderizam por categoria mantendo linhas e eventos delegados", async () => {
    const [app, core, css] = await Promise.all([
        read("app.js"), read("finance-core.js"), read("style.css")
    ]);
    const render = app.slice(app.indexOf("function renderDespesas"), app.indexOf("function atualizarResumo"));
    const eventos = app.slice(app.indexOf('ui.listaDespesas.addEventListener("change"'), app.indexOf("function aposMudarCategorias"));

    assert.match(core, /export function agruparLancamentosPorCategoria/);
    assert.match(render, /agruparLancamentosPorCategoria\(despesas\)/);
    assert.match(render, /grupo\.despesas\.map\(criarLinhaDespesa\)/);
    assert.match(render, /grupo\.totalCentavos \/ 100/);
    assert.match(render, /class: "despesa-grupo-categoria", text: grupo\.categoria/);
    assert.match(await read("localization.js"), /\.despesa-grupo-categoria/);
    assert.match(eventos, /ui\.listaDespesas\.addEventListener\("change"/);
    assert.match(eventos, /ui\.listaDespesas\.addEventListener\("click"/);
    for (const seletor of [".pago-despesa", ".editar-despesa", ".remover-despesa"]) {
        assert.ok(eventos.includes(seletor), `${seletor} deixou de funcionar por delegação`);
    }
    assert.match(css, /#lista-despesas \{/);
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.despesa \{/);
});

test("estado financeiro não é salvo automaticamente após leitura inválida", async () => {
    const app = await read("app.js");
    const storage = await read("storage.js");
    assert.match(app, /lerJsonResultado\(chave, \{ protegerInvalido: true \}\)/);
    assert.match(app, /resultado\.estado === "valido"[\s\S]*?validarBackup\(resultado\.valor, \{ permitirTextoNumerico: true \}\)/);
    assert.match(app, /if \(recuperacaoFinanceira\.protegido\) return/);
    assert.match(app, /recuperacaoFinanceira\.restaurar\(\{/);
    assert.match(storage, /dadosProtegidos\.has\(chave\) && !substituirProtegido/);
});
