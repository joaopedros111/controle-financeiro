import { mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const port of [8080, 9099, 4400, 4500, 9150]) await new Promise((resolve, reject) => {
    const probe = createServer().once('error', () => reject(new Error(`Loopback port ${port} occupied; existing services preserved`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
const work = await mkdtemp(path.join(tmpdir(), 'cf-vault-real-emulator-'));
await copyFile(path.join(root, 'firestore.rules'), path.join(work, 'firestore.rules'));
await writeFile(path.join(work, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules' }, emulators: {
    singleProjectMode: true, ui: { enabled: false }, hub: { host: '127.0.0.1', port: 4400 }, logging: { host: '127.0.0.1', port: 4500 },
    firestore: { host: '127.0.0.1', port: 8080 }, auth: { host: '127.0.0.1', port: 9099 }
} }));
const env = { ...process.env, CI: 'true', FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true', XDG_CONFIG_HOME: path.join(work, 'config'),
    LOCAL_VAULT_EMULATORS: '1', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    GCLOUD_PROJECT: 'demo-vault-integration', GOOGLE_CLOUD_PROJECT: 'demo-vault-integration', GCE_METADATA_HOST: '127.0.0.1:9' };
for (const key of ['FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'DEBUG']) delete env[key];
for (const key of ['NO_PROXY', 'no_grpc_proxy']) env[key] = [env[key], '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(',');
const quote = value => `"${value.replaceAll('"', '')}"`;
const command = [process.execPath, '--test', path.join(root, 'tests', 'finance-vault-real-emulator.test.js')].map(quote).join(' ');
console.log(`Synthetic emulator project: demo-vault-integration. Temporary logs: ${work}`);
const log = createWriteStream(path.join(work, 'execution.log'));
const child = spawn(process.execPath, [path.join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'), 'emulators:exec',
    '--only', 'firestore,auth', '--project', 'demo-vault-integration', '--config', path.join(work, 'firebase.json'), command],
{ cwd: work, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
try { process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)); }); }
finally { log.end(); }
