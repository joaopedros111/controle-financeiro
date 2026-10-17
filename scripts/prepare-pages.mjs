import { cp, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { versaoValida } from "../update-manager.js";

const STATIC_FILES = [
    "index.html",
    "style.css",
    "controls.css",
    "app.js",
    "finance-core.js",
    "preferences.js",
    "localization.js",
    "storage.js",
    "update-manager.js",
    "sw.js",
    "version.json",
    "manifest.json"
];

function inteiroPositivo(valor, nome) {
    if (!Number.isSafeInteger(valor) || valor < 1) {
        throw new Error(`${nome} precisa ser um inteiro positivo seguro.`);
    }
    return valor;
}

export async function prepararArtefatoPages({ diretorioFonte, diretorioSaida, numeroExecucao }) {
    const fonte = path.resolve(diretorioFonte);
    const saida = path.resolve(diretorioSaida);
    const numero = inteiroPositivo(Number(numeroExecucao), "GITHUB_RUN_NUMBER");
    if (fonte === saida) throw new Error("A saída do Pages não pode substituir os arquivos fonte.");

    const metadados = JSON.parse(await readFile(path.join(fonte, "version.json"), "utf8"));
    const versaoBase = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.)(0|[1-9]\d*)$/.exec(metadados.version || "");
    if (metadados.name !== "Controle Financeiro" || !versaoBase || !versaoValida(metadados.version)) {
        throw new Error("version.json precisa conter metadados válidos em formato MAJOR.MINOR.PATCH.");
    }

    let serviceWorker = await readFile(path.join(fonte, "sw.js"), "utf8");
    const identidade = /const VERSAO_SERVICE_WORKER = "([^"]+)";/.exec(serviceWorker);
    const cache = /const PREFIXO_CACHE = "([^"]+)";\s*const CACHE = PREFIXO_CACHE \+ "v(0|[1-9]\d*)";/.exec(serviceWorker);
    if (!identidade || identidade[1] !== metadados.version) {
        throw new Error("version.json e a identidade do Service Worker estão inconsistentes.");
    }
    if (!cache) throw new Error("O cache do Service Worker não segue o padrão de versão vN.");

    const patch = inteiroPositivo(Number(versaoBase[2]) + numero, "patch da versão publicada");
    const numeroCache = inteiroPositivo(Number(cache[2]) + numero, "versão do cache publicada");
    const versaoPublicada = `${versaoBase[1]}${patch}`;
    const nomeCache = `${cache[1]}v${numeroCache}`;

    await mkdir(saida, { recursive: true });
    await Promise.all(STATIC_FILES.map((arquivo) =>
        copyFile(path.join(fonte, arquivo), path.join(saida, arquivo))
    ));
    await cp(path.join(fonte, "icons"), path.join(saida, "icons"), { recursive: true });

    metadados.version = versaoPublicada;
    await writeFile(path.join(saida, "version.json"), `${JSON.stringify(metadados, null, 2)}\n`);
    serviceWorker = serviceWorker
        .replace(identidade[0], `const VERSAO_SERVICE_WORKER = "${versaoPublicada}";`)
        .replace(cache[0], `const PREFIXO_CACHE = "${cache[1]}";\nconst CACHE = PREFIXO_CACHE + "v${numeroCache}";`);
    await writeFile(path.join(saida, "sw.js"), serviceWorker);

    return { version: versaoPublicada, cache: nomeCache };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const [, , diretorioFonte, diretorioSaida, numeroExecucao] = process.argv;
    if (!diretorioFonte || !diretorioSaida || !numeroExecucao) {
        throw new Error("Uso: node scripts/prepare-pages.mjs <fonte> <saída> <GITHUB_RUN_NUMBER>");
    }
    const release = await prepararArtefatoPages({ diretorioFonte, diretorioSaida, numeroExecucao });
    console.log(`Pages artifact preparado: versão ${release.version}, cache ${release.cache}.`);
}
