// Prévia local dos sete efeitos e controles do Cubo 3D.
// Somente 127.0.0.1, Firebase real desativado, sem Service Worker e com dados fictícios.
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origem = path.join(projeto, "published-site");
const temp = await mkdtemp(path.join(tmpdir(), "controle-financeiro-animacoes-"));
let server;
let fechando = false;

async function limpar() {
    if (fechando) return;
    fechando = true;
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
}

try {
    await cp(origem, temp, { recursive: true });
    const htmlPath = path.join(temp, "index.html");
    const html = await readFile(htmlPath, "utf8");
    const registroSW = /<script>\s*if \('serviceWorker' in navigator\) \{\s*window\.addEventListener\('load', \(\) => \{\s*navigator\.serviceWorker\.register\('sw\.js'\)\.catch\(console\.error\);\s*\}\);\s*\}\s*<\/script>/g;
    if ([...html.matchAll(registroSW)].length !== 1) {
        throw new Error("Registro do Service Worker inesperado. Prévia bloqueada.");
    }
    if (!html.includes('src="cube3d-preview.js?_release=')) {
        throw new Error("O pacote não contém o controle Cubo 3D esperado.");
    }
    await writeFile(htmlPath, html.replace(registroSW,
        "<!-- Service Worker desabilitado na prévia local. -->"));
    // Mesmo que o código tente Firebase, a configuração real nunca é exposta.
    await writeFile(path.join(temp, "firebase-config.js"),
        'export const firebaseConfig = Object.freeze({});\n' +
        'export const firebaseConfigurado = () => false;\n');
    const tipos = {
        ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json",
        ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon"
    };
    server = createServer(async (req, res) => {
        try {
            const caminho = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
            const arquivo = path.resolve(temp, "." + (caminho === "/" ? "/index.html" : caminho));
            if (!arquivo.startsWith(temp + path.sep)) {
                res.writeHead(403).end();
                return;
            }
            if (!(await stat(arquivo)).isFile()) {
                res.writeHead(404).end();
                return;
            }
            const dados = await readFile(arquivo);
            res.writeHead(200, {
                "Content-Type": tipos[path.extname(arquivo)] || "application/octet-stream",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy":
                    "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; " +
                    "style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
                    "worker-src 'none'; object-src 'none'; base-uri 'none'"
            });
            res.end(dados);
        } catch {
            res.writeHead(404).end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    console.log("PRÉVIA LOCAL / SEM FIREBASE / SEM SERVICE WORKER");
    console.log("Abra em janela InPrivate do Edge:");
    console.log("http://127.0.0.1:" + server.address().port + "/?indexeddb_homologacao=1");
    console.log("Use somente lançamentos fictícios. Ctrl+C para encerrar.");
} catch (erro) {
    await limpar();
    throw erro;
}
process.on("SIGINT", () => { void limpar().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void limpar().then(() => process.exit(0)); });
