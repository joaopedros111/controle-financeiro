import { mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 2) throw new Error('No production or arbitrary command options');
for (const port of [8080, 9099, 4400, 4500, 9150]) await new Promise((resolve, reject) => {
    const s = createServer().once('error', () => reject(new Error(`Loopback port ${port} occupied; existing services preserved`)));
    s.listen(port, '127.0.0.1', () => s.close(resolve));
});
const work = await mkdtemp(path.join(tmpdir(), 'cf-composition-emulator-'));
await copyFile(path.join(root, 'firestore.rules'), path.join(work, 'firestore.rules'));
await writeFile(path.join(work, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules' }, emulators: { singleProjectMode: true, ui: { enabled: false }, hub: { host: '127.0.0.1', port: 4400 }, logging: { host: '127.0.0.1', port: 4500 }, firestore: { host: '127.0.0.1', port: 8080 }, auth: { host: '127.0.0.1', port: 9099 } } }));
const env = { ...process.env, CI: 'true', FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true', XDG_CONFIG_HOME: path.join(work, 'config'), LOCAL_VAULT_EMULATORS: '1', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: 'demo-vault-integration', GOOGLE_CLOUD_PROJECT: 'demo-vault-integration', GCE_METADATA_HOST: '127.0.0.1:9' };
for (const key of ['FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'DEBUG']) delete env[key];
for (const key of ['NO_PROXY', 'no_grpc_proxy']) env[key] = [env[key], '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(',');
const command = `"${process.execPath}" "${path.join(root, 'scripts', 'run-vault-composition-browser.mjs')}"`;
console.log(`Composition demo project. Logs retained: ${work}`);
const log = createWriteStream(path.join(work, 'execution.log'));
const child = spawn(process.execPath, [path.join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'), 'emulators:exec', '--only', 'firestore,auth', '--project', 'demo-vault-integration', '--config', path.join(work, 'firebase.json'), command], { cwd: work, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
for (const s of [child.stdout, child.stderr]) s.on('data', bytes => { log.write(bytes); process.stdout.write(bytes); });
try { process.exitCode = await new Promise((yes, no) => { child.once('error', no); child.once('close', code => yes(code ?? 1)); }); }
finally { log.end(); }
