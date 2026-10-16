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
