// Read-only, pinned reference. No checkout, credentials, network or production data.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

export const publishedCommit = 'e0f6e2c54e92655432b0304ee35729f1d5a08769';
const root = fileURLToPath(new URL('../../', import.meta.url));
export function publishedSourcePlugin() {
    return { name: 'pinned-published-source', setup(builder) {
        builder.onLoad({ filter: /\.js$/ }, args => {
            const relative = path.relative(root, args.path).replaceAll('\\', '/');
            if (path.isAbsolute(relative) || relative.startsWith('../') || relative.startsWith('node_modules/')) return;
            const result = spawnSync('git', ['show', `${publishedCommit}:${relative}`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
            if (result.status !== 0) throw new Error(`Pinned source unavailable: ${relative}`);
            return { contents: result.stdout, loader: 'js', resolveDir: path.dirname(args.path) };
        });
    } };
}
export async function loadPublishedClient() {
    const folder = await mkdtemp(path.join(tmpdir(), 'cf-published-contract-'));
    const outfile = path.join(folder, 'client.mjs');
    const externalSDK = { name: 'same-sdk-realm', setup(builder) {
        builder.onResolve({ filter: /^firebase\// }, args => ({ path: import.meta.resolve(args.path), external: true }));
    } };
    const result = await build({ absWorkingDir: root, stdin: { contents: "export {criarFirebaseSync} from './firebase-sync-entry.js'; export {makeOperation,recordEntityKey} from './sync-core.js';", resolveDir: root },
        bundle: true, platform: 'node', format: 'esm', write: false, plugins: [externalSDK, publishedSourcePlugin()] });
    await writeFile(outfile, result.outputFiles[0].contents);
    return import(pathToFileURL(outfile).href);
}
