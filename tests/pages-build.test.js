import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepararArtefatoPages } from "../scripts/prepare-pages.mjs";

const root = new URL("../", import.meta.url);

test("Pages build emits synchronized per-run version and cache without changing source", async () => {
    const diretorioTemporario = await mkdtemp(path.join(os.tmpdir(), "controle-financeiro-pages-"));
    const saida = path.join(diretorioTemporario, "site");
    const versaoFonteAntes = await readFile(new URL("../version.json", import.meta.url), "utf8");
    const serviceWorkerFonteAntes = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const versaoBase = JSON.parse(versaoFonteAntes).version.match(/^(\d+\.\d+\.)(\d+)$/);
    const cacheBase = /const PREFIXO_CACHE = "([^"]+)";\s*const CACHE = PREFIXO_CACHE \+ "v(\d+)";/.exec(serviceWorkerFonteAntes);
    assert.ok(versaoBase, "versão base semver inválida");
    assert.ok(cacheBase, "cache base inválido");
    const versaoEsperada = `${versaoBase[1]}${Number(versaoBase[2]) + 1}`;
    const cacheEsperado = `${cacheBase[1]}v${Number(cacheBase[2]) + 1}`;

    try {
        const release = await prepararArtefatoPages({
            diretorioFonte: fileURLToPath(root),
            diretorioSaida: saida,
            numeroExecucao: "1"
        });
        const metadadosGerados = JSON.parse(await readFile(path.join(saida, "version.json"), "utf8"));
        const serviceWorkerGerado = await readFile(path.join(saida, "sw.js"), "utf8");
        const htmlGerado = await readFile(path.join(saida, "index.html"), "utf8");
        const appGerado = await readFile(path.join(saida, "app.js"), "utf8");
        const manifestGerado = JSON.parse(await readFile(path.join(saida, "manifest.json"), "utf8"));
        const firebaseBundle = await readFile(path.join(saida, "firebase-sync.bundle.js"));

        assert.equal(release.version, versaoEsperada);
        assert.equal(release.cache, cacheEsperado);
        assert.equal(metadadosGerados.version, release.version);
        assert.match(serviceWorkerGerado, new RegExp(`const VERSAO_SERVICE_WORKER = "${release.version}";`));
        assert.ok(serviceWorkerGerado.includes(`const CACHE = PREFIXO_CACHE + "${cacheEsperado.slice(cacheBase[1].length)}";`));
        assert.match(htmlGerado, new RegExp(`name="app-version" content="${release.version}"`));
        assert.equal((htmlGerado.match(/name="app-version"/g) || []).length, 1);
        assert.ok(firebaseBundle.length > 100_000, "Firebase SDK is bundled into the Pages artifact");
        for (const recurso of ["style.css", "controls.css", "app.js", "manifest.json", "icons/icon-192.png"]) {
            assert.ok(htmlGerado.includes(`${recurso}?_release=${release.version}`), `${recurso} sem URL versionada`);
        }
        assert.match(appGerado, new RegExp(`from "./finance-core.js\\?_release=${release.version}"`));
        const syncGerado = await readFile(path.join(saida, "sync-core.js"), "utf8");
        assert.match(syncGerado, new RegExp(`from "./finance-core.js\\?_release=${release.version}"`), "imports transitivos precisam estar no precache versionado para recarga offline");
        assert.equal(manifestGerado.start_url, `./index.html?_release=${release.version}`);
        assert.ok(manifestGerado.icons.every((icone) => icone.src.includes(`?_release=${release.version}`)));
        assert.match(serviceWorkerGerado, /new Request\(url, \{ cache: "reload" \}\)/);
        for (const arquivo of ["index.html", "app.js", "manifest.json", "icons/icon-192.png"]) {
            assert.ok((await readFile(path.join(saida, arquivo))).length > 0, `${arquivo} ausente do artefato`);
        }
        assert.equal(await readFile(new URL("../version.json", import.meta.url), "utf8"), versaoFonteAntes);
        assert.equal(await readFile(new URL("../sw.js", import.meta.url), "utf8"), serviceWorkerFonteAntes);
    } finally {
        await rm(diretorioTemporario, { recursive: true, force: true });
    }
});

test("Pages build aborts when source version and Service Worker identity disagree", async () => {
    const diretorioTemporario = await mkdtemp(path.join(os.tmpdir(), "controle-financeiro-pages-invalid-"));
    const fonte = path.join(diretorioTemporario, "source");
    const saida = path.join(diretorioTemporario, "site");

    try {
        const metadados = JSON.parse(await readFile(new URL("../version.json", import.meta.url), "utf8"));
        metadados.version = "9.9.9";
        await mkdir(fonte, { recursive: true });
        await writeFile(path.join(fonte, "version.json"), JSON.stringify(metadados));
        await writeFile(path.join(fonte, "sw.js"), await readFile(new URL("../sw.js", import.meta.url), "utf8"));

        await assert.rejects(
            prepararArtefatoPages({ diretorioFonte: fonte, diretorioSaida: saida, numeroExecucao: 1 }),
            /version\.json e a identidade do Service Worker estão inconsistentes/
        );
    } finally {
        await rm(diretorioTemporario, { recursive: true, force: true });
    }
});
