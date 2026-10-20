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
            caminhoPrecache === "./firebase-sync.bundle.js"
                ? existsSync(fileURLToPath(new URL("firebase-sync-entry.js", root)))
                : existsSync(fileURLToPath(new URL(caminhoPrecache, root))),
            `${caminhoPrecache} não existe no projeto`
        );
    }
    for (const recurso of precache) {
        assert.ok(
            new URL(recurso, scope).pathname.startsWith(scope.pathname),
            `${recurso} do precache escapa do escopo do app`
        );
        assert.ok(
            recurso === "./firebase-sync.bundle.js"
                ? existsSync(fileURLToPath(new URL("firebase-sync-entry.js", root)))
                : existsSync(fileURLToPath(new URL(recurso, root))),
            `${recurso} do precache não existe no projeto`
        );
    }
});

test("controles das preferências incrementais têm implementação e cache atualizados", async () => {
    const [html, app, css, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("style.css"), read("sw.js")
    ]);
    for (const id of ["densidade-interface", "valor-densidade-interface", "mostrar-graficos", "mostrar-resumo-mes", "ocultar-ao-iniciar", "escopo-csv", "diagnostico-dados"]) {
        assert.match(html, new RegExp(`id="${id}"`), `controle ${id} ausente`);
        assert.ok(app.includes(`$("${id}")`), `controle ${id} sem conexão com o app`);
    }
    assert.match(html, /for="mostrar-graficos">\s*<span>Exibir gráficos na tela inicial<\/span>/);
    assert.match(html, /id="densidade-interface" type="range" min="0" max="100" step="1"/);
    assert.match(app, /calcularEspacamentosDensidade\(preferenciasMenu\.densidade\)/);
    assert.match(app, /ui\.densidadeInterface\.addEventListener\("input"/);
    assert.match(app, /salvarPreferenciasMenu\(\)/);
    assert.match(css, /body\.graficos-ocultos \.grafico-bloco \{ display: none; \}/);
    assert.doesNotMatch(css, /body\.graficos-ocultos\s+\.indicadores/);
    const resumo = html.slice(html.indexOf('<section class="resumo"'), html.indexOf("</section>", html.indexOf('<section class="resumo"')));
    assert.match(resumo, /<dl class="indicadores">/);
    assert.match(app, /preferenciasMenu\.ocultarAoIniciar/);
    assert.match(app, /preferenciasMenu\.ultimoPeriodo/);
    assert.doesNotMatch(html, /Preferências financeiras|id="tela-inicial"|id="referencia-mes"/);
    assert.doesNotMatch(html, /id="alternar-valores"/);
    assert.match(serviceWorker, /const CACHE = PREFIXO_CACHE \+ "v\d+"/);
    assert.equal((serviceWorker.match(/"\.\/preferences\.js"/g) || []).length, 1, "preferences.js deve ser precacheado uma vez");
});

test("densidade usa slider progressivo, mapeia preferências antigas e preserva o extremo confortável", async () => {
    const [html, preferences, styles, app] = await Promise.all([
        read("index.html"), read("preferences.js"), read("style.css"), read("app.js")
    ]);
    assert.match(html, /<label class="ajuste-linha ajuste-controle densidade-controle" for="densidade-interface">/);
    assert.match(html, /<output id="valor-densidade-interface" for="densidade-interface" aria-live="polite">50%<\/output>/);
    assert.match(html, /id="densidade-interface" type="range" min="0" max="100" step="1" value="50" aria-valuetext="50%"/);
    assert.doesNotMatch(html, /id="densidade-extremos"|Máxima compactação|Muito confortável/);
    for (const [valor, esperado] of [
        ["muito-compacta", 0], ["compacta", 25], ["padrao", 50],
        ["confortavel", 75], ["muito-confortavel", 100]
]) assert.match(
    preferences,
    new RegExp(`["']?${valor}["']?:\\s*${esperado}`)
);
    assert.match(preferences, /densidade: 50/);
    assert.match(preferences, /export function calcularEspacamentosDensidade/);
    assert.match(styles, /padding: var\(--densidade-bloco-vertical, 28px\) var\(--densidade-bloco-horizontal, 24px\)/);
    assert.match(styles, /padding-top: var\(--densidade-lancamento-vertical, 20px\)/);
    assert.match(styles, /gap: var\(--densidade-opcoes-secao-gap, 16px\)/);
    assert.match(styles, /margin-top: var\(--densidade-opcoes-grupo-margem, 28px\)/);
    assert.match(styles, /padding-top: var\(--densidade-opcoes-grupo-padding, 24px\)/);
    assert.match(styles, /body \.panorama-graficos \{ gap: var\(--densidade-panorama-gap, 14px\); \}/);
    assert.match(styles, /body \.grafico-categoria-item \{[\s\S]*padding: var\(--densidade-legenda-categoria-padding, 7px\) 2px/);
    assert.match(styles, /input\[type="range"\] \{ min-height: 44px; margin: 0; cursor: pointer; \}/);
    assert.doesNotMatch(styles, /densidade-oculta|densidade.*display:\s*none|densidade.*visibility:\s*hidden/);
    assert.match(app, /ui\.densidadeInterface\.setAttribute\("aria-valuetext", `\$\{preferenciasMenu\.densidade\}%`\)/);
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
    assert.match(app, /lerVersaoControlador\(navigator\.serviceWorker\)/);
    assert.match(app, /versaoControlador\s*\?\s*\{ version: versaoControlador \}\s*:\s*await lerVersaoInstalada\(\)/);
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
    assert.match(serviceWorker, /requisicao\.cache === "no-cache"/);
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
    assert.match(manager, /export async function lerVersaoControlador/);
});

test("workflow de Pages publica main pelo artefato oficial sem gravar a versão na branch", async () => {
    const [workflow, builder] = await Promise.all([
        read(".github/workflows/pages.yml"), read("scripts/prepare-pages.mjs")
    ]);
    assert.match(workflow, /branches:\s*\n\s+- main/);
    assert.match(workflow, /uses: actions\/configure-pages@v5/);
    assert.match(workflow, /uses: actions\/upload-pages-artifact@v3/);
    assert.match(workflow, /uses: actions\/deploy-pages@v4/);
    assert.match(workflow, /node scripts\/prepare-pages\.mjs .*GITHUB_RUN_NUMBER/);
    assert.match(workflow, /Confirm this is still the latest main commit/);
    assert.match(workflow, /steps\.current\.outputs\.is_current == 'true'/);
    assert.doesNotMatch(workflow, /git push|git commit|contents:\s*write/i);
    assert.match(builder, /metadados\.version = versaoPublicada/);
    assert.match(builder, /VERSAO_SERVICE_WORKER = "\$\{versaoPublicada\}"/);
    assert.match(builder, /CACHE = PREFIXO_CACHE \+ "v\$\{numeroCache\}"/);
    assert.match(builder, /version\.json e a identidade do Service Worker estão inconsistentes/);
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

test("a atualização só é marcada como concluída após confirmar os arquivos carregados", async () => {
    const app = await read("app.js");
    const inicioCargaVersao = app.indexOf("async function carregarVersaoInstalada");
    const fimCargaVersao = app.indexOf("function registrarResultadoVerificacao", inicioCargaVersao);
    const cargaVersao = app.slice(inicioCargaVersao, fimCargaVersao);
    const inicioAtualizacao = app.indexOf("atualizar: async () => {");
    const fimRecarga = app.indexOf("window.location.reload()", inicioAtualizacao);
    const fluxoAntesDaRecarga = app.slice(inicioAtualizacao, fimRecarga);

    assert.match(cargaVersao, /validarVersaoAplicacao\(/);
    assert.match(cargaVersao, /if \(versaoAguardando === metadados\.version\)/);
    assert.match(cargaVersao, /registrarResultadoVerificacao\(.*Atualizado para a versão/);
    assert.doesNotMatch(fluxoAntesDaRecarga, /registrarResultadoVerificacao\(.*Atualizado para a versão/);
    assert.match(fluxoAntesDaRecarga, /sessionStorage\.setItem\(CHAVE_ATUALIZACAO_PENDENTE/);
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
        "saldo-valor", "total-receitas", "total-despesas", "valor-pendente",
        "total-receitas-lista", "total-valor", "total-grafico-categorias",
        "grafico-categoria-valor", "valor-receita", "valor-despesa"
    ]) {
        assert.ok(html.includes(`id="${seletor}"`) || app.includes(`class: "${seletor}"`), `${seletor} sem componente`);
    }
    assert.match(app, /title: rotulo \+ " em ".*formatarMoeda\(valor\)/);
    assert.match(app, /formatarMoeda\(p\.receitas\).*formatarMoeda\(p\.despesas\)/);
    assert.match(app, /formatarMoeda\(total\)[\s\S]*formatarMoeda\(valor\)/);
    assert.match(app, /const pago = pagoCentavos \/ 100/);
    assert.match(app, /const pendente = \(despesaCentavos - pagoCentavos\) \/ 100/);
    assert.doesNotMatch(app, /\$\("valor-pago"\)|ui\.valorPago/);
    assert.match(css, /body\.valores-ocultos \.grafico-barras/);
    assert.match(css, /body\.valores-ocultos #grafico-rosca/);
    assert.match(css, /html\.app-inicializando \.container/);
    assert.match(html, /class="app-inicializando"/);
});

test("preferências antigas de tela inicial continuam compatíveis sem controles no menu", async () => {
    const [html, app, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("sw.js")
    ]);
    assert.doesNotMatch(html, /id="tela-inicial"|id="referencia-mes"|titulo-preferencias-financeiras/);
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
    assert.match(html, /Claro, Escuro, Rosa, Pangolin ou Selva/);
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

test("orçamento foi removido da tela inicial e o gerenciamento fica em Opções", async () => {
    const [html, app, core, controls, serviceWorker] = await Promise.all([
        read("index.html"), read("app.js"), read("finance-core.js"), read("controls.css"), read("sw.js")
    ]);
    assert.doesNotMatch(html, /secao-planejamento|lista-planejamento-orcamentos|vazio-planejamento-orcamentos|ORÇAMENTO POR CATEGORIA/);
    const opcoes = html.slice(html.indexOf('<dialog id="dialogo-ajustes"'), html.indexOf("</dialog>", html.indexOf('<dialog id="dialogo-ajustes"')));
    assert.match(opcoes, /<div class="bloco-topo">[\s\S]*?<\/div>\s*<section class="ajustes-secao" aria-labelledby="titulo-categorias-orcamentos">/);
    assert.match(opcoes, /aria-labelledby="titulo-categorias-orcamentos"/);
    assert.match(opcoes, /id="abrir-categorias-orcamento"[^>]*>Gerenciar categorias/);
    assert.match(opcoes, /id="abrir-limites-orcamento"[^>]*>Configurar limites de orçamento/);
    assert.match(html, /id="dialogo-orcamentos"/);
    for (const id of [
        "dialogo-orcamentos", "lista-orcamentos", "abrir-categorias-orcamento",
        "abrir-limites-orcamento", "painel-categorias-orcamento", "painel-limites-orcamento"
    ]) {
        assert.ok(app.includes(`$("${id}")`), `${id} não conectado`);
    }
    assert.match(opcoes, /Gerenciar categorias/);
    assert.match(opcoes, /Configurar limites de orçamento/);
    assert.match(html, /id="lista-categorias"/);
    assert.match(html, /id="nova-categoria"/);
    assert.match(html, /id="adicionar-categoria"/);
    assert.match(html, /id="lista-orcamentos"/);
    assert.match(html, /Limites mensais por categoria/);
    assert.doesNotMatch(html, /Limite somente para este mês/);
    assert.doesNotMatch(app, /orcamentoAcao: "salvar-mes"|orcamentoAcao: "usar-padrao"/);
    assert.match(app, /agruparLancamentosComOrcamento\(despesas, estado\.categorias, estado\.orcamentos\)/);
    assert.match(core, /export function agruparLancamentosComOrcamento/);
    assert.match(app, /estado\.orcamentos\.padrao/);
    assert.match(core, /return \{ padrao, meses: \{\} \}/);
    assert.match(app, /campo\.type = valoresOcultos \? "password" : "number"/);
    assert.match(core, /export function calcularOrcamentosPorCategoria/);
    assert.match(app, /const CHAVE_ESTADO = "controleFinanceiro:v3"/);
    assert.match(app, /const CHAVE_ESTADO_V2 = "controleFinanceiro:v2"/);
    for (const recurso of ["./app.js", "./finance-core.js", "./controls.css"]) {
        assert.ok(serviceWorker.includes(`"${recurso}"`), `${recurso} ausente do precache`);
    }
    assert.doesNotMatch(controls, /lista-resumo-orcamentos|orcamento-progresso|orcamento-item/);
    assert.match(app, /class: "despesa-grupo" \+ \(grupo\.excedido \? " acima-do-orcamento" : ""\)/);
    assert.match(app, /ui\.abrirCategoriasOrcamento\.addEventListener\("click"[\s\S]*mostrarPainelOrcamentos\("categorias"\)[\s\S]*ui\.dialogoOrcamentos\.showModal\(\)/);
    assert.match(app, /ui\.abrirLimitesOrcamento\.addEventListener\("click"[\s\S]*mostrarPainelOrcamentos\("limites"\)[\s\S]*ui\.dialogoOrcamentos\.showModal\(\)/);
});

test("resumo, despesas e entradas permanecem sem uma seção separada de planejamento", async () => {
    const html = await read("index.html");
    const resumo = html.indexOf('<section class="resumo"');
    const despesas = html.indexOf('id="secao-despesas"');
    const entradas = html.indexOf('id="secao-entradas"');
    assert.ok(resumo < despesas && despesas < entradas);
    assert.equal((html.match(/class="bloco-seta"/g) || []).length, 2);
});

test("resumo do mês mostra quatro indicadores e o comprometimento abaixo da grade", async () => {
    const [html, app, css] = await Promise.all([
        read("index.html"), read("app.js"), read("style.css")
    ]);
    const inicio = html.indexOf('<section class="resumo"');
    const fim = html.indexOf("</section>", inicio);
    const resumo = html.slice(inicio, fim);
    const posicaoGrade = resumo.indexOf('<dl class="indicadores">');
    const fimGrade = resumo.indexOf("</dl>", posicaoGrade);
    const posicaoComprometimento = resumo.indexOf('id="texto-comprometido"');

    assert.doesNotMatch(resumo, /Saldo do mês|id="saldo-rotulo"|Já pago|<dt>A pagar<\/dt>/);
    for (const rotulo of ["Entradas", "Despesas", "Saldo total", "Falta pagar"]) {
        assert.ok(resumo.includes(`<dt>${rotulo}</dt>`), `${rotulo} ausente do resumo`);
    }
    assert.equal((resumo.match(/<dt>/g) || []).length, 4);
    assert.match(resumo, /<dt>Entradas<\/dt>[\s\S]*?<dd id="total-receitas">/);
    assert.match(resumo, /<dt>Despesas<\/dt>[\s\S]*?<dd id="total-despesas">/);
    assert.match(resumo, /<dt>Saldo total<\/dt>[\s\S]*?<dd id="saldo-valor"/);
    assert.match(resumo, /<dt>Falta pagar<\/dt>[\s\S]*?<dd id="valor-pendente">/);
    assert.ok(posicaoGrade >= 0 && fimGrade > posicaoGrade && posicaoComprometimento > fimGrade);
    assert.match(app, /const saldo = \(receitaCentavos - despesaCentavos\) \/ 100/);
    assert.match(app, /ui\.saldoValor\.textContent = formatarMoeda\(saldo\)/);
    assert.match(app, /ui\.valorPendente\.textContent = formatarMoeda\(pendente\)/);
    assert.match(app, /const pctDespesa = receita > 0 \? \(despesa \/ receita\) \* 100 : 0/);
    assert.match(css, /\.indicadores \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.barra-texto\s*\{\s*margin: 12px 0 0/);
});

test("gerenciamento de categorias e limites usa controles consistentes no menu Opções", async () => {
    const html = await read("index.html");
    const ajustes = html.slice(html.indexOf('<dialog id="dialogo-ajustes"'), html.indexOf("</dialog>", html.indexOf('<dialog id="dialogo-ajustes"')));
    for (const id of ["abrir-categorias-orcamento", "abrir-limites-orcamento"]) {
        assert.match(ajustes, new RegExp(`<button id="${id}" class="btn btn-secundario"`));
    }
});

test("visibilidade altera somente apresentação e tem controles persistentes independentes", async () => {
    const [html, app, preferences, controls, layout] = await Promise.all([
        read("index.html"), read("app.js"), read("preferences.js"), read("controls.css"), read("style.css")
    ]);
    const aparencia = html.slice(html.indexOf('aria-labelledby="titulo-aparencia"'), html.indexOf('aria-labelledby="titulo-botao-menu"'));
    assert.match(aparencia, /id="titulo-aparencia">Aparência e visualização/);
    assert.doesNotMatch(html, /titulo-privacidade|Privacidade e visualização/);
    for (const [id, chave, secao] of [
        ["mostrar-despesas-mes", "mostrarDespesas", "secao-despesas"],
        ["mostrar-entradas", "mostrarEntradas", "secao-entradas"]
    ]) {
        assert.match(aparencia, new RegExp(`id="${id}" type="checkbox" checked`));
        assert.match(app, new RegExp(`preferenciasMenu\\.${chave}`));
        assert.match(app, new RegExp(`\\$\\("${secao}"\\)\\.hidden = !preferenciasMenu\\.${chave}`));
    }
    assert.match(aparencia, /id="ocultar-ao-iniciar" type="checkbox"/);
    assert.doesNotMatch(html, /mostrar-planejamento|secao-planejamento/);
    assert.doesNotMatch(aparencia, /id="alternar-valores"/);
    assert.match(aparencia, /class="ajuste-linha ajuste-controle ajuste-alternancia" for="mostrar-graficos"[\s\S]*?id="mostrar-graficos" type="checkbox"/);
    assert.match(aparencia, /for="mostrar-resumo-mes"[\s\S]*?id="mostrar-resumo-mes" type="checkbox" checked/);
    assert.match(preferences, /mostrarResumo: true/);
    assert.match(app, /preferenciasMenu\.mostrarResumo = ui\.mostrarResumo\.checked/);
    assert.match(preferences, /mostrarPlanejamento: true, mostrarDespesas: true, mostrarEntradas: true/);
    assert.match(app, /const CHAVE_PREFERENCIAS_MENU = "controleFinanceiro:preferencias-menu"/);
    assert.match(controls, /ajuste-controle\.ajuste-alternancia/);
    assert.match(controls, /@media \(max-width: 480px\)/);
    assert.match(controls, /\.ajustes-secao \{ display: grid; gap: 10px; \}/);
    assert.match(layout, /--densidade-opcoes-secao-gap/);
    assert.match(controls, /\.ajuste-controle select \{ width: 100%; min-width: 0;/);

    const handlers = app.slice(app.indexOf('ui.mostrarDespesas.addEventListener'), app.indexOf('ui.ocultarAoIniciar.addEventListener'));
    assert.match(handlers, /aplicarVisibilidadeSecoes\(\)[\s\S]*salvarPreferenciasMenu\(\)/);
    assert.doesNotMatch(handlers, /salvar\(\)|renderTudo\(|renderDespesas\(|renderReceitas\(|atualizarResumo\(/);
    const visibilidade = app.slice(app.indexOf("function aplicarVisibilidadeSecoes"), app.indexOf("function abrirSecaoInicial"));
    assert.match(visibilidade, /document\.querySelector\("\.resumo"\)\.hidden = !preferenciasMenu\.mostrarResumo/);
    assert.match(visibilidade, /secao-despesas/);
    assert.match(visibilidade, /secao-entradas/);
    assert.doesNotMatch(visibilidade, /planejamento/i);
});

test("gerenciamento de categorias abre o painel existente a partir de Opções", async () => {
    const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
    const orcamentos = html.slice(html.indexOf('<dialog id="dialogo-orcamentos"'), html.indexOf("</dialog>", html.indexOf('<dialog id="dialogo-orcamentos"')));
    const ajustes = html.slice(html.indexOf('<dialog id="dialogo-ajustes"'), html.indexOf("</dialog>", html.indexOf('<dialog id="dialogo-ajustes"')));

    assert.match(orcamentos, /id="lista-categorias"/);
    assert.match(orcamentos, /id="nova-categoria"/);
    assert.match(orcamentos, /id="adicionar-categoria"/);
    assert.doesNotMatch(orcamentos, /id="abrir-categorias-orcamento"|id="abrir-limites-orcamento"/);
    assert.ok(!html.includes('id="dialogo-categorias"'));
    assert.ok(!html.includes('id="gerenciar-categorias"'));
    assert.match(ajustes, /Gerenciar categorias/);
    assert.match(ajustes, /Configurar limites de orçamento/);
    assert.match(app, /ui\.abrirCategoriasOrcamento\.addEventListener\("click"[\s\S]*renderListaCategorias\(\)[\s\S]*mostrarPainelOrcamentos\("categorias"\)[\s\S]*ui\.dialogoOrcamentos\.showModal\(\)/);
    assert.match(app, /ui\.abrirLimitesOrcamento\.addEventListener\("click"[\s\S]*renderListaOrcamentos\(\)[\s\S]*mostrarPainelOrcamentos\("limites"\)[\s\S]*ui\.dialogoOrcamentos\.showModal\(\)/);
});

test("seções de despesas e entradas usam botões Adicionar e ícones recolhíveis modernos", async () => {
    const html = await read("index.html");
    assert.match(html, /<h2 id="titulo-receitas">Entradas<\/h2>/);
    assert.match(html, /id="adicionar-despesa"[\s\S]*?Adicionar/);
    assert.match(html, /id="adicionar-receita"[\s\S]*?Adicionar/);
    assert.equal((html.match(/class="bloco-seta" viewBox="0 0 24 24"/g) || []).length, 2);
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

    assert.match(core, /export function agruparLancamentosComOrcamento/);
    assert.match(render, /agruparLancamentosComOrcamento\(despesas, estado\.categorias, estado\.orcamentos\)/);
    assert.match(render, /grupo\.despesas\.map\(criarLinhaDespesa\)/);
    assert.match(render, /grupo\.totalCentavos \/ 100/);
    assert.match(render, /class: "despesa-grupo-categoria", text: grupo\.categoria/);
    assert.match(render, /grupo\.limiteCentavos === null \? \[\] : \[criarEl\("small"/);
    assert.match(render, /Limite: \$\{formatarMoeda\(grupo\.limiteCentavos \/ 100\)\}/);
    assert.match(css, /\.despesa-grupo-limite\.excedido/);
    assert.match(css, /\.despesa-grupo\.acima-do-orcamento/);
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

test("calendário do resumo seleciona um período e a edição acompanha o teclado virtual", async () => {
    const [html, app, controls] = await Promise.all([
        read("index.html"), read("app.js"), read("controls.css")
    ]);
    assert.match(html, /id="abrir-calendario-resumo"[^>]*aria-label="Selecionar data no calendário"/);
    assert.match(html, /id="data-calendario-resumo"[^>]*type="date"/);
    assert.match(app, /ui\.abrirCalendarioResumo\.addEventListener\("click"[\s\S]*?\.showPicker\(\)/);
    assert.match(app, /ui\.dataCalendarioResumo\.addEventListener\("change"[\s\S]*?mudarPeriodo\(/);
    assert.match(app, /window\.visualViewport\?\.addEventListener\("resize"/);
    assert.match(app, /dialogo\.style\.setProperty\("--dialogo-viewport-bottom"/);
    assert.match(controls, /dialog#dialogo-despesa\.teclado-virtual-ativo[\s\S]*?--dialogo-viewport-bottom/);
    assert.match(controls, /dialog#dialogo-receita\.teclado-virtual-ativo/);
});

test("mensagem vazia de despesas usa o rótulo atual do botão Adicionar", async () => {
    const [app, localization] = await Promise.all([read("app.js"), read("localization.js")]);
    assert.match(app, /ui\.vazioDespesas\.hidden\s*=\s*despesas\.length\s*>\s*0;[\s\S]*?ui\.vazioDespesas\.textContent\s*=\s*"Toque em Adicionar para começar"/);
    assert.doesNotMatch(app, /\+ Despesa/);
    assert.match(localization, /\["Toque em Adicionar para começar", "Tap Add to get started"/);
});
