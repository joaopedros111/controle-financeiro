import { mkdtemp, mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createServer } from "node:http";
import { createServer as createProbe } from "node:net";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { prepararArtefatoPages } from "./prepare-pages.mjs";
import { publishedSourcePlugin } from '../tests/fixtures/published-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const integrity = ['integrity', 'integrity-browser'].includes(process.argv[2]);
const compatibilityBrowser = process.argv[2] === 'compatibility-browser';
const accountBrowser = process.argv[2] === 'google-account';
const isolatedRules = process.argv[2] === 'rules-isolated';
const isolated = accountBrowser || isolatedRules;
const firestorePort = isolated ? 8180 : 8080, authPort = isolated ? 9199 : 9099;
const realtimeBrowser = process.argv[2] === 'epoch-realtime';
const epochBrowser = process.argv[2] === 'epoch-browser' || realtimeBrowser;
const browser = process.argv[2] === "browser" || process.argv[2] === 'integrity-browser' || compatibilityBrowser || epochBrowser || accountBrowser;
const epoch = process.argv[2] === "epoch" || epochBrowser;
if (!["rules", "browser", "epoch", "epoch-browser", "epoch-realtime", "google-account", "rules-isolated", "integrity", "integrity-browser", 'compatibility-browser'].includes(process.argv[2])) throw new Error("Unknown local test mode.");
const project = accountBrowser ? "demo-controle-financeiro-google-only" : "demo-controle-financeiro";
for (const port of isolated ? [8180, ...(browser ? [9199] : []), 4600, 4700, 9250] : browser ? [8080, 9099, 4400, 4500, 9150] : [8080, 4400, 4500, 9150]) {
    await new Promise((resolve, reject) => {
        const probe = createProbe().once("error", () => reject(new Error(`Porta local ${port} ocupada; nenhuma instância existente foi encerrada.`)));
        probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
}
const work = await mkdtemp(path.join(tmpdir(), "controle-financeiro-homolog-"));
console.log(`Artefatos e logs isolados: ${work}`);
await copyFile(path.join(root, epoch ? "firestore.epoch.rules" : integrity ? 'firestore.integrity.rules' : "firestore.rules"), path.join(work, "firestore.rules"));
await writeFile(path.join(work, "firebase.json"), JSON.stringify({
    firestore: { rules: "firestore.rules" }, emulators: { singleProjectMode: false,
        ...(isolated ? { hub: {host:"127.0.0.1",port:4600}, logging: {host:"127.0.0.1",port:4700}, ui: {enabled:false} } : {}),
        firestore: { host: "127.0.0.1", port: firestorePort, ...(isolated ? {websocketPort:9250} : {}) }, ...(browser ? { auth: { host: "127.0.0.1", port: authPort } } : {}) }
}));
const env = { ...process.env, CI: "true", FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true" };
// Never read/write the developer's Firebase CLI credentials during local QA.
env.XDG_CONFIG_HOME = path.join(work, 'config');
delete env.FIREBASE_TOKEN;
delete env.GOOGLE_APPLICATION_CREDENTIALS;
delete env.DEBUG;
for (const name of ["NO_PROXY", "no_grpc_proxy"]) env[name] = [env[name], "127.0.0.1", "localhost", "::1"].filter(Boolean).join(",");
if (accountBrowser) env.LOCAL_TEST_GOOGLE_ACCOUNT = '1';
if (compatibilityBrowser) env.LOCAL_TEST_COMPATIBILITY = '1';
let server;
if (browser) {
    const site = path.join(work, "site");
    if (epochBrowser) {
        await mkdir(site);
        await writeFile(path.join(site, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Synthetic epoch queue QA</title>');
        await build({ entryPoints: [path.join(root, 'tests', 'fixtures', 'epoch-queue-browser.js')],
            outfile: path.join(site, 'epoch-queue-fixture.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
        env.LOCAL_TEST_EPOCH_BROWSER = '1';
        if (realtimeBrowser) env.LOCAL_TEST_EPOCH_REALTIME = '1';
    } else {
    await prepararArtefatoPages({ diretorioFonte: root, diretorioSaida: site, numeroExecucao: "1" });
    const originalHTML = await readFile(path.join(site, "index.html"), "utf8");
    // Enable the intentionally commented feature only in the synthetic test copy.
    const testHTML = originalHTML.replace(/<!--\s*(<section class="ajustes-secao" aria-labelledby="titulo-sincronizacao">[\s\S]*?<\/section>)\s*-->/, "$1");
    if (!testHTML.includes('id="entrar-google"')) throw new Error("A cópia de homologação não contém a interface de sincronização.");
    await writeFile(path.join(site, "index.html"), testHTML);
    await writeFile(path.join(site, "local-only.html"), testHTML.replace(/<section class="ajustes-secao" aria-labelledby="titulo-sincronizacao">[\s\S]*?<\/section>/, "<!-- Optional synchronization UI omitted for this local test. -->"));
    await writeFile(path.join(site, "firebase-config.js"), `export const firebaseConfig=Object.freeze({apiKey:"demo-only",authDomain:"${project}.firebaseapp.com",projectId:"${project}",appId:"1:123:web:local"}); export const firebaseConfigurado=(c=firebaseConfig)=>c.projectId==="${project}";`);
    const fixture = path.join(work, "firebase-browser-fixture.mjs");
    await writeFile(fixture, `
        import { criarFirebaseSync as production } from ${JSON.stringify(path.join(root, "firebase-sync-entry.js").replaceAll("\\", "/"))};
        import {initializeApp} from "firebase/app";
        import {getAuth,initializeAuth,browserLocalPersistence,indexedDBLocalPersistence,browserSessionPersistence,connectAuthEmulator,signInWithEmailAndPassword} from "firebase/auth";
        import {getFirestore,connectFirestoreEmulator} from "firebase/firestore";
        const requireDemo=(config)=>{if(config.projectId!=="${project}" || !["127.0.0.1","localhost"].includes(location.hostname))throw new Error('Ambiente local invalido');};
        export async function seedLegacyAuthForTest(config,kind,email){
            requireDemo(config);
            if(!['idb','session'].includes(kind))throw new Error('Invalid test backend');
            const auth=initializeAuth(initializeApp(config),{persistence:kind==='idb'?indexedDBLocalPersistence:browserSessionPersistence});
            connectAuthEmulator(auth,"http://127.0.0.1:${authPort}",{disableWarnings:true});
            await auth.authStateReady();await signInWithEmailAndPassword(auth,email,'synthetic-password-only');
        }
        export function productionClientForTest(config){requireDemo(config);return production(config,{createFirestore:()=>getFirestore()});}
        export function criarFirebaseSync(config) {
            if(config.projectId!=="${project}" || !["127.0.0.1","localhost"].includes(location.hostname)) throw new Error("Ambiente local inválido");
            // Deterministic regression gate, armed only by the dedicated synthetic test.
            if(window.__guardAuthSessionRemoval && !window.__authRemovalGuardInstalled){
                window.__authRemovalGuardInstalled=true;window.__authSessionRemovals=0;
                const original=browserLocalPersistence.prototype._remove;
                browserLocalPersistence.prototype._remove=async function(key){
                    if(key.includes('firebase:authUser:') && localStorage.getItem(key)!==null){
                        window.__authSessionRemovals++;
                        await original.call(this,key);
                        await new Promise(resolve=>window.__releaseAuthRemoval=resolve);
                        return;
                    }
                    return original.call(this,key);
                };
            }
            const client=production(config), auth=getAuth();
            const generationSnapshot=client.generationSnapshot.bind(client);
            client.generationSnapshot=async(...args)=>{
                if(window.__requiredProtocolForTest)throw Object.assign(new Error('Synthetic unsupported generation protocol'),{code:'sync/upgrade-required'});
                return generationSnapshot(...args);
            };
            connectAuthEmulator(auth,"http://127.0.0.1:${authPort}",{disableWarnings:true});
            connectFirestoreEmulator(getFirestore(),"127.0.0.1",${firestorePort});
            // Synthetic-only diagnostics: never capture credentials, tokens or financial payloads.
            let authEvent=0;
            const log=(operation,uid,phase,code)=>{
                const entries=window.__syncDiagnostics ||= [];
                entries.push({at:Date.now(),operation,requestedUid:uid||null,authUid:auth.currentUser?.uid||null,authEvent,phase,code:code||null});
                if(entries.length>200)entries.shift();
            };
            const observe=client.onUser.bind(client);
            client.onUser=(callback)=>observe(user=>{authEvent++;log('auth',user?.uid,'callback');return callback(user);});
            for(const operation of ['list','getSettings','listConflicts']){
                const original=client[operation].bind(client);
                client[operation]=async(uid,...args)=>{log(operation,uid,'start');try{
                    if(operation==='list' && window.__autoTransientFailures>0){window.__autoTransientFailures--;throw Object.assign(new Error('Synthetic synchronization failure'),{code:window.__autoFailureCode||'unavailable'});}
                    const result=await original(uid,...args);log(operation,uid,'complete');return result;
                }catch(error){log(operation,uid,'error',error?.code);throw error;}};
            }
            for(const operation of ['listen','listenSettings','listenConflicts']){
                const original=client[operation].bind(client);
                client[operation]=(uid,callback,failure,...args)=>{log(operation,uid,'start');return original(uid,callback,error=>{log(operation,uid,'error',error?.code);failure?.(error);},...args);};
            }
            const migrationCommit=client.commit.bind(client);
            client.commit=async(...args)=>{if(${compatibilityBrowser})window.__compatCommitCalls=(window.__compatCommitCalls||0)+1;if(window.__holdMigrationCommit)await new Promise(resolve=>window.__releaseMigrationCommit=resolve);try{return await migrationCommit(...args);}catch(error){if(${compatibilityBrowser} && error.code==='permission-denied')window.__compatDenied=true;throw error;}};
            const originalMigrationSnapshot=client.localMigrationSnapshot.bind(client);
            client.localMigrationSnapshot=async(...args)=>{
                const snapshot=await originalMigrationSnapshot(...args);
                if(window.__holdMigrationSnapshot)await new Promise(resolve=>window.__releaseMigrationSnapshot=resolve);
                return window.__migrationCachedForTest?{...snapshot,metadata:{fromCache:true,hasPendingWrites:false}}:snapshot;
            };
            const originalLogout=client.logout;
            client.logout=()=>{if(window.__testSignOutFailure)throw new Error('Synthetic signOut failure');return originalLogout();};
            const realOnUser=client.onUser, delayed=[];let bootReleased=!window.__holdAuthBootstrap, releaseBoot;
            const bootGate=new Promise(resolve=>releaseBoot=resolve), originalReady=client.ready.bind(client);
            if(!bootReleased){window.__releaseAuthBootstrap=()=>{bootReleased=true;releaseBoot();for(const deliver of delayed.splice(0))deliver();};client.ready=async()=>{const user=await originalReady();await bootGate;return user;};}
            client.onUser=callback=>{window.__authSubscriptions=(window.__authSubscriptions||0)+1;let live=true;const stop=realOnUser(user=>{const deliver=()=>{if(!live)return;window.__lastAuthDelivery=()=>callback(user);return callback(user);};if(!bootReleased){delayed.push(deliver);return;}return deliver();});return()=>{live=false;window.__authSubscriptions--;return stop();};};
            client.login=()=>signInWithEmailAndPassword(auth,window.__testEmail,"synthetic-password-only");
            return client;
        }
    `);
    // Resolve fixture packages from the repository, including when Windows temp
    // and the workspace are on different drives.
    await build({ stdin: { contents: await readFile(fixture, 'utf8'), resolveDir: root, sourcefile: 'firebase-browser-fixture.mjs' },
        outfile: path.join(site, "firebase-sync.bundle.js"),
        bundle: true, format: "esm", platform: "browser", target: "es2022" });
    if (compatibilityBrowser) await build({ stdin: { contents: await readFile(fixture, 'utf8'), resolveDir: root, sourcefile: 'published-browser-fixture.mjs' },
        outfile: path.join(site, 'firebase-sync.published.bundle.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', plugins: [publishedSourcePlugin()] });
    }
    if (accountBrowser && process.env.STABILITY_BASELINE) {
        const filename = { published: 'published-app.js', worktree: 'worktree-before-app.js' }[process.env.STABILITY_BASELINE];
        if (!filename) throw new Error('Unknown isolated bootstrap baseline');
        const release = JSON.parse(await readFile(path.join(site, 'version.json'), 'utf8')).version;
        const baseline = await readFile(path.join(root, '.validation', 'stability', filename), 'utf8');
        await writeFile(path.join(site, 'app.js'), baseline.replace(/\?_release=[0-9.]+/g, '?_release=' + release));
        env.STABILITY_BASELINE = process.env.STABILITY_BASELINE;
    }
    const blackholedPaths = [];
    const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
    server = createServer(async (req, res) => {
        try {
            // Synthetic blackhole includes requests initiated by the SW, which Playwright
            // routing alone cannot intercept. Closing the synthetic context aborts these sockets.
            if (accountBrowser && req.headers.cookie?.includes('cf-synthetic-blackhole=1')) { blackholedPaths.push(req.url); console.log('SYNTHETIC_SW_NETWORK_BLACKHOLE',req.url); req.socket.setTimeout(0); return; }
            const localURL = new URL(req.url, "http://127.0.0.1");
            const pathname = decodeURIComponent(localURL.pathname);
            // Visual/local persistence fixtures explicitly opt into the existing
            // loopback QA mode; the account application keeps its Google gate.
            if (!accountBrowser && pathname === '/local-only.html' && localURL.searchParams.get('indexeddb_homologacao') !== '1') {
                localURL.searchParams.set('indexeddb_homologacao', '1');
                res.writeHead(302, { Location: localURL.pathname + localURL.search }).end(); return;
            }
            if (accountBrowser && pathname === '/synthetic-network-evidence') { res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify(blackholedPaths)); return; }
            const file = path.resolve(site, `.${pathname === "/" ? "/index.html" : pathname}`);
            if (!file.startsWith(site + path.sep)) { res.writeHead(403).end(); return; }
            const body = await readFile(file);
            res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(body);
        } catch { res.writeHead(404).end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    env.LOCAL_TEST_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    env.LOCAL_TEST_EMULATORS = "1"; env.LOCAL_TEST_OUTPUT = work;
}
const quote = (value) => `"${value.replaceAll('"', '')}"`;
const command = browser
    ? [process.execPath, path.join(root, "node_modules", "@playwright", "test", "cli.js"), "test", "--config", path.join(root, "playwright.config.mjs"), ...process.argv.slice(3)].map(quote).join(" ")
    : [process.execPath, "--test", "--test-concurrency=1", ...(epoch
        ? [path.join(root, "tests", "finance-epoch.test.js"), path.join(root, "tests", "finance-epoch-cache.test.js"), path.join(root, "tests", "finance-epoch-realtime.test.js"), path.join(root, "tests", "finance-epoch-rules.test.js")]
        : ['firestore-rules.test.js', 'firebase-sync-client.test.js', 'firestore-integrity.test.js', 'firestore-compatibility.test.js', 'firestore-settings-integrity.test.js', 'firestore-conflict-integrity.test.js'].map(name => path.join(root, 'tests', name)))].map(quote).join(" ");
const log = createWriteStream(path.join(work, "execution.log"));
const child = spawn(process.execPath, [path.join(root, "node_modules", "firebase-tools", "lib", "bin", "firebase.js"),
    "emulators:exec", "--only", browser ? "firestore,auth" : "firestore", "--project", project, "--config", path.join(work, "firebase.json"), command],
{ cwd: work, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { log.write(data); process.stdout.write(data); });
const interrupt = () => {
    if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGINT");
};
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
    process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code) => resolve(code ?? 1)); });
} finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => log.end(resolve));
    console.log(`Logs preservados fora do repositório: ${work}`);
}
