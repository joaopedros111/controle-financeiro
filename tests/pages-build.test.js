import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat, readdir, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepararArtefatoPages } from "../scripts/prepare-pages.mjs";

const root = new URL("../", import.meta.url);

test("Pages build emits synchronized per-run version and cache without changing source", async t => {
    const diretorioTemporario = await mkdtemp(path.join(os.tmpdir(), "controle-financeiro-pages-"));
    let completed = false;
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
        const appleLinks = htmlGerado.match(/<link\b[^>]*rel="apple-touch-icon"[^>]*>/g) || [];
        assert.equal(appleLinks.length, 1, "Safari must have a single dedicated icon");
        assert.ok(appleLinks[0].includes('sizes="180x180"'));
        assert.ok(appleLinks[0].includes(`href="icons/apple-touch-icon.png?_release=${release.version}"`));
        assert.deepEqual(await readFile(path.join(saida, "icons/apple-touch-icon.png")),
            await readFile(new URL("../icons/apple-touch-icon.png", import.meta.url)), "Apple icon must be published unchanged");
        assert.ok(serviceWorkerGerado.includes('"./icons/apple-touch-icon.png"'), "Apple icon must be precached");
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
        completed = true;
    } catch (error) {
        const diagnostics = { at: new Date().toISOString(), pid: process.pid, node: process.version,
            error: { code: error.code, errno: error.errno, syscall: error.syscall, path: error.path, stack: error.stack }, directory: diretorioTemporario };
        if (error.path) {
            try { diagnostics.file = await stat(error.path); } catch (e) { diagnostics.fileStatError = e.code; }
            try { diagnostics.parent = await readdir(path.dirname(error.path)); } catch (e) { diagnostics.parentError = e.code; }
            try { const handle = await open(error.path, 'r+'); await handle.close(); diagnostics.nonTruncatingReopen = 'ok'; } catch (e) { diagnostics.nonTruncatingReopen = { code: e.code, errno: e.errno }; }
        }
        try { await writeFile(path.join(diretorioTemporario, 'failure.json'), JSON.stringify(diagnostics, null, 2)); }
        catch (e) { t.diagnostic('Diagnostic write failed: ' + e.code); }
        t.diagnostic('Failed Pages artifact preserved at: ' + diretorioTemporario);
        throw error;
    } finally {
        if (completed) await rm(diretorioTemporario, { recursive: true, force: true });
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

test('Pages renders generated files from source without reopening copied destinations',async()=>{
    const {default:io}=await import('node:fs/promises');const {syncBuiltinESMExports}=await import('node:module');
    const temp=await mkdtemp(path.join(os.tmpdir(),'controle-financeiro-pages-once-')),output=path.join(temp,'site');
    const original={readFile:io.readFile,copyFile:io.copyFile,writeFile:io.writeFile};const writes=new Map();let success=false;
    const generated=p=>typeof p==='string'&&path.dirname(p)===output&&(/\.js$/.test(p)||['index.html','manifest.json','version.json'].includes(path.basename(p)));
    io.readFile=async(p,...args)=>{assert.equal(generated(p),false,'Build must not reread generated destination files');return original.readFile(p,...args);};
    io.copyFile=async(a,b,...args)=>{assert.equal(generated(b),false,'Generated files must not be copied before truncating rewrite');return original.copyFile(a,b,...args);};
    io.writeFile=async(p,...args)=>{if(generated(p)){writes.set(p,(writes.get(p)||0)+1);assert.equal(writes.get(p),1,'A generated file must have one final write');}return original.writeFile(p,...args);};syncBuiltinESMExports();
    try{await prepararArtefatoPages({diretorioFonte:fileURLToPath(root),diretorioSaida:output,numeroExecucao:3});assert.equal(writes.get(path.join(output,'app.js')),1);success=true;}
    finally{Object.assign(io,original);syncBuiltinESMExports();if(success)await rm(temp,{recursive:true,force:true});else console.error('Retained write-once diagnostic:',temp);}
});
