// Servidor local isolado para ensaio manual da persistência IndexedDB.
// Não usa a configuração Firebase real, não publica nada e não toca no localStorage de outro domínio.
import { createServer } from 'node:http';
import { readFile, writeFile, copyFile, cp, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'controle-financeiro-idb-qa-'));
const assets = [
    'index.html', 'app.js', 'finance-core.js', 'financial-intents.js',
    'financial-atomic-service.js', 'transactional-state.js', 'indexeddb-persistence.js',
    'preferences.js', 'storage.js', 'sync-core.js', 'localization.js',
    'update-manager.js', 'style.css', 'controls.css', 'version.json',
    'manifest.json', 'sw.js'
];
for (const name of assets) await copyFile(path.join(source, name), path.join(temp, name));
await cp(path.join(source, 'icons'), path.join(temp, 'icons'), { recursive: true });
await writeFile(path.join(temp, 'firebase-config.js'),
    'export const firebaseConfig=Object.freeze({}); export const firebaseConfigurado=()=>false;\n');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
    try {
        const requestPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
        const target = path.resolve(temp, '.' + (requestPath === '/' ? '/index.html' : requestPath));
        if (!target.startsWith(temp + path.sep)) { res.writeHead(403).end(); return; }
        if (!(await stat(target)).isFile()) { res.writeHead(404).end(); return; }
        const data = await readFile(target);
        res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream',
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'" });
        res.end(data);
    } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
console.log(`Modo IndexedDB experimental: http://127.0.0.1:${server.address().port}/?indexeddb_homologacao=1`);
console.log('Abra duas abas no mesmo perfil, utilizando somente dados sintéticos. Pressione Ctrl+C para encerrar.');
let stopping = false;
const stop = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true }); // somente diretório temporário criado por este processo
};
process.on('SIGINT', () => { void stop().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void stop().then(() => process.exit(0)); });
