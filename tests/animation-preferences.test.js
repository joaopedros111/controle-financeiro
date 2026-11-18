import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const ler = arquivo => readFileSync(new URL("../" + arquivo, import.meta.url), "utf8");
const tipos = ["barras", "contadores", "mes", "botoes", "lancamentos", "cartoes3d", "skeleton"];

test("sete controles independentes ao lado do Cubo 3D", () => {
    const codigo = ler("published-site/cube3d-preview.js");
    assert.doesNotThrow(() => new Script(codigo));
    for (const tipo of tipos) assert.ok(codigo.includes('["' + tipo + '",'), tipo);
    assert.match(codigo, /painel\.insertAdjacentElement\("afterend", grupoAnimacoes\)/);
    assert.match(codigo, /campo\.type = "checkbox"/);
    assert.match(codigo, /localStorage\.setItem\(CHAVE_ANIMACOES/);
    assert.match(codigo, /CustomEvent\("controle-financeiro:animacoes-atualizadas"/);
    assert.match(codigo, /window\.addEventListener\("storage"/);
});

test("lógica visual no código-fonte e no pacote preparado", () => {
    for (const arquivo of ["app.js", "published-site/app.js"]) {
        const codigo = ler(arquivo);
        assert.match(codigo, /const CHAVE_ANIMACOES_INTERFACE = "controleFinanceiro:animacoes-interface-v1"/);
        for (const tipo of tipos) assert.ok(codigo.includes('"' + tipo + '"'), tipo);
        for (const tipo of ["barras", "contadores", "mes", "lancamentos", "cartoes3d"]) {
            assert.ok(codigo.includes('efeitoPermitido("' + tipo + '")'), tipo);
        }
        assert.match(codigo, /encerrarContadoresVisuais\(\)/);
        assert.match(codigo, /prefers-reduced-motion: reduce/);
    }
});

test("desativação visual e Skeleton acessível", () => {
    for (const arquivo of ["style.css", "published-site/style.css"]) {
        const css = ler(arquivo);
        for (const tipo of ["barras", "botoes", "lancamentos", "cartoes3d", "skeleton"]) {
            assert.ok(css.includes("data-animacao-" + tipo + "-desativada"), tipo);
        }
        assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
        assert.match(css, /carregando-esqueleto/);
    }
    for (const arquivo of ["index.html", "published-site/index.html"]) {
        const html = ler(arquivo);
        assert.equal((html.match(/class="carregando-esqueleto"/g) || []).length, 1);
        assert.match(html, /class="carregando-esqueleto" aria-hidden="true"/);
        assert.match(html, /localStorage\.getItem\("controleFinanceiro:animacoes-interface-v1"\)/);
    }
    assert.match(ler("published-site/cube3d-preview.css"), /animacoes-interface-opcoes/);
});

test("botão Opções cresce sem perder a posição horizontal original", () => {
    for (const arquivo of ["style.css", "published-site/style.css"]) {
        const css = ler(arquivo);
        assert.match(css, /--menu-deslocamento-x: -50%/);
        assert.match(css, /--menu-deslocamento-x: 0%/);
        assert.match(css, /transform: translateX\(var\(--menu-deslocamento-x\)\) scale\(1\.08\)/);
        assert.match(css, /html\[data-animacao-botoes-desativada\] body \.ajustes-botao:active/);
        assert.match(css, /body \.ajustes-botao:active \{\s*transform: translateX\(var\(--menu-deslocamento-x\)\) !important;/);
        assert.match(css, /\.btn:not\(\.ajustes-botao\):not\(:disabled\):active/);
    }
});
