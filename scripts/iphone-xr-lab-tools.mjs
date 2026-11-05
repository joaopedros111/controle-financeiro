// Tools for the GENERATED synthetic lab package. Importing this file never starts services.
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { X509Certificate, createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAB_PROJECT = 'demo-controle-financeiro-xr-lab';
export const LAB_PASSWORD = 'synthetic-xr-password-only';
export const LAB_EMAILS = ['synthetic-a@xr.local.test', 'synthetic-b@xr.local.test'];
export const LAB_PORTS = Object.freeze({ https: 9443, firestore: 8380, auth: 9399, hub: 4800, logging: 4900, websocket: 9450 });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
export function privateIPv4(host) {
    const n=host.split('.').map(Number);
    return n.length===4 && n.every((x,i)=>Number.isInteger(x)&&x>=0&&x<=255&&String(x)===host.split('.')[i])
        && (n[0]===10 || n[0]===192&&n[1]===168 || n[0]===172&&n[1]>=16&&n[1]<=31);
}
export function validateLab(config, requireConfigured = false) {
    const url = new URL(config.origin);
    if (config.version!==1 || config.projectId!==LAB_PROJECT || url.protocol!=='https:' || !privateIPv4(url.hostname)
        || url.port!==String(LAB_PORTS.https) || url.username || url.password || url.pathname!=='/' || url.search || url.hash)
        fail('Lab requires a dedicated HTTPS private IPv4 origin on port 9443 and the exact demo project.');
    if (JSON.stringify(config.ports)!==JSON.stringify(LAB_PORTS)) fail('Unexpected lab ports; original Emulators must not be reused.');
    if (requireConfigured && config.configured!==true) fail('Package is a template: rebuild with --origin https://YOUR_PRIVATE_IP:9443 before starting.');
    return url;
}
export function classifyRequest(config, raw, method = 'GET') {
    const origin=validateLab(config); if (!['GET','HEAD','POST','OPTIONS'].includes(method) || !raw.startsWith('/') || raw.startsWith('//')) return {kind:'deny'};
    const url=new URL(raw,origin);if(url.origin!==origin.origin || /%2f|%5c|%2e|\\/i.test(url.pathname) || raw.split('?')[0].split('/').includes('..'))return {kind:'deny'};
    const p=url.pathname;
    if(/^\/(identitytoolkit|securetoken)\.googleapis\.com\//.test(p)) {
        if(url.searchParams.get('key')!=='demo-only' || !/^\/(identitytoolkit\.googleapis\.com\/v1\/accounts:(signInWithPassword|lookup)|securetoken\.googleapis\.com\/v1\/token)$/.test(p))return {kind:'deny'};
        return {kind:'auth',port:config.ports.auth};
    }
    if(p.startsWith('/google.firestore.v1.Firestore/')) {
        if(url.searchParams.get('database')!==`projects/${LAB_PROJECT}/databases/(default)` || !/^\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel$/.test(p))return {kind:'deny'};
        return {kind:'firestore',port:config.ports.firestore};
    }
    if(p.startsWith('/v1/projects/')) {
        if(!p.startsWith(`/v1/projects/${LAB_PROJECT}/databases/(default)/documents`))return {kind:'deny'};
        return {kind:'firestore',port:config.ports.firestore};
    }
    if(method!=='GET'&&method!=='HEAD')return {kind:'deny'};
    return {kind:'static',relative:p==='/'?'index.html':decodeURIComponent(p.slice(1))};
}
export const LAB_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; worker-src 'self'; manifest-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";
async function loadConfig() { const c=JSON.parse(await readFile(path.join(root,'lab-config.json'),'utf8'));validateLab(c);return c; }
async function checkSite() {
    const manifest=JSON.parse(await readFile(path.join(root,'artifact-hashes.json'),'utf8'));
    for(const [name,expected]of Object.entries(manifest)){if(name.includes('..')||path.isAbsolute(name))fail('Invalid artifact path');const value=await readFile(path.join(root,'site',name));if(digest(value)!==expected)fail('Artifact changed: '+name);}
    return manifest;
}
async function freePorts(ports) {for(const port of ports)await new Promise((resolve,reject)=>{const p=createProbe();p.once('error',()=>reject(new Error(`Port ${port} is busy. No process was stopped.`)));p.listen(port,'127.0.0.1',()=>p.close(resolve));});}
export async function serveLab(config, {certFile,keyFile}) {
    const origin=validateLab(config,true),manifest=await checkSite(),site=await realpath(path.join(root,'site'));
    for(const item of [certFile,keyFile]){if(!item)fail('--cert and --key are required');const p=await realpath(item);if(p.startsWith(site+path.sep))fail('TLS files must stay outside the static site.');}
    if(path.basename(keyFile).toLowerCase().includes('rootca'))fail('Never use the CA private key as a server key.');
    const cert=await readFile(certFile),key=await readFile(keyFile),leaf=new X509Certificate(cert),privateKey=createPrivateKey(key);
    if(leaf.ca || !leaf.checkIP(origin.hostname) || Date.parse(leaf.validTo)<Date.now() || Date.parse(leaf.validFrom)>Date.now())fail('TLS leaf certificate is invalid for this private IP.');
    if(!leaf.publicKey.export({type:'spki',format:'der'}).equals(createPublicKey(privateKey).export({type:'spki',format:'der'})))fail('Certificate/key mismatch.');
    const server=createHttpsServer({cert,key},async(req,res)=>{
        const close=()=>{if(!res.headersSent)res.writeHead(403);res.end();};
        if(req.headers.host!==origin.host || req.headers.origin && req.headers.origin!==origin.origin)return close();
        const route=classifyRequest(config,req.url,req.method);if(route.kind==='deny')return close();
        let mode;try{mode=JSON.parse(await readFile(path.join(root,'.state/network-mode.json'),'utf8')).mode;if(!['normal','backend-blackhole','all-blackhole'].includes(mode))throw Error();}catch{res.writeHead(503).end('Invalid lab fault state');return;}
        if(mode==='all-blackhole'||mode==='backend-blackhole'&&route.kind!=='static'){req.socket.setTimeout(0);console.log('LAB_BLACKHOLE',route.kind);return;}
        if(route.kind!=='static'){
            const headers={...req.headers,host:`127.0.0.1:${route.port}`};delete headers.cookie;
            const upstream=httpRequest({host:'127.0.0.1',port:route.port,path:req.url,method:req.method,headers},reply=>{
                if(reply.headers.location){upstream.destroy();res.writeHead(502).end('Redirect rejected');return;}
                const h={...reply.headers,'cache-control':'no-store'};delete h['set-cookie'];res.writeHead(reply.statusCode,h);reply.pipe(res);
            });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local Emulator unavailable');});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);return;
        }
        if(!Object.hasOwn(manifest,route.relative))return close();
        try{const filename=await realpath(path.join(site,route.relative));if(!filename.startsWith(site+path.sep))return close();const data=await readFile(filename);
            const type={'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.png':'image/png'}[path.extname(filename)]||'application/octet-stream';
            res.writeHead(200,{'content-type':type,'cache-control':'no-store','content-security-policy':LAB_CSP,'x-content-type-options':'nosniff','service-worker-allowed':'/'});res.end(req.method==='HEAD'?undefined:data);
        }catch{res.writeHead(404).end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.ports.https,origin.hostname,resolve);});console.log('Synthetic lab only:',origin.origin);return server;
}
async function startEmulators(config, cli) {
    validateLab(config,true);if(!cli)fail('--cli must point to the existing firebase-tools/lib/bin/firebase.js');
    const version=JSON.parse(await readFile(path.resolve(path.dirname(cli),'../../package.json'),'utf8')).version;if(version!=='15.34.0')fail('Firebase CLI 15.34.0 is required; no automatic installation.');
    await freePorts(Object.values(config.ports).filter(p=>p!==config.ports.https));
    await mkdir(path.join(root,'.state/config'),{recursive:true});
    const env={...process.env,CI:'true',FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true',XDG_CONFIG_HOME:path.join(root,'.state/config')};
    for(const k of ['FIREBASE_TOKEN','GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CONFIG','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','FIREBASE_EMULATOR_HUB','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])delete env[k];
    const child=spawn(process.execPath,[path.resolve(cli),'emulators:start','--only','auth,firestore','--project',LAB_PROJECT,'--config',path.join(root,'firebase.json')],{cwd:path.join(root,'.state'),env,windowsHide:true,stdio:'inherit'});
    child.once('error',error=>{console.error(error.message);process.exitCode=1;});child.once('close',code=>{process.exitCode=code??1;});
}
async function seedAccounts(config) {
    validateLab(config,true);
    for(const email of LAB_EMAILS){const response=await fetch(`http://127.0.0.1:${config.ports.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:LAB_PASSWORD,returnSecureToken:true})});const value=await response.json();if(!response.ok&&value.error?.message!=='EMAIL_EXISTS')fail('Cannot create synthetic account: '+(value.error?.message||response.status));console.log('Synthetic account available:',email);}
}
export async function main(args) {
    const config=await loadConfig(),get=name=>args[args.indexOf(name)+1];
    if(args.includes('--serve'))return serveLab(config,{certFile:args.includes('--cert')?get('--cert'):null,keyFile:args.includes('--key')?get('--key'):null});
    if(args.includes('--emulators'))return startEmulators(config,args.includes('--cli')?get('--cli'):null);
    if(args.includes('--seed'))return seedAccounts(config);
    if(args.includes('--fault')){validateLab(config,true);const mode=get('--fault');if(!['normal','backend-blackhole','all-blackhole'].includes(mode))fail('Invalid fault mode');await writeFile(path.join(root,'.state/network-mode.json'),JSON.stringify({mode}));console.log('Lab fault mode:',mode);return;}
    await checkSite();console.log(JSON.stringify({status:config.configured?'CONFIGURED_NOT_EXECUTED':'TEMPLATE_CONFIGURE_PRIVATE_IP',origin:config.origin,project:LAB_PROJECT,ports:config.ports,servicesStarted:false},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
