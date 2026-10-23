import {chaveLocalConta} from '../sync-core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
    const ready=deferred(),popup=deferred();let imports=0,logins=0,callback;
    const client={ready:()=>ready.promise,onUser:fn=>{callback=fn;},login:()=>{logins++;return popup.promise;}};
    const statuses=[];
    const c=vm.createContext({firebaseClient:null,syncUser:null,syncUi:{login:{disabled:false}},IDB_HOMOLOGACAO:false,
        firebaseConfigurado:()=>true,firebaseConfig:{},console,Promise,setSyncStatus:message=>statuses.push(message),
        importFirebaseSdk:async()=>{imports++;return {criarFirebaseSync:()=>client};},onFirebaseUser:user=>{c.syncUser=user;vm.runInContext('setGoogleAuthUser(syncUser)',c);}});
    let code=source.slice(source.indexOf('let firebaseInitPromise ='),source.indexOf('async function onFirebaseUser('));
    const importLine = code.split('\n').find(line => line.includes('const sdk = await import('));
    assert.ok(importLine, 'only the SDK import boundary is stubbed');
    code = code.replace(importLine, 'const sdk = await importFirebaseSdk();');
    vm.runInContext(source.slice(source.indexOf('function googleAuthMessage('),source.indexOf('let firebaseInitPromise ='))+code,c);
    return {c,ready,popup,client,statuses,imports:()=>imports,logins:()=>logins,emit:user=>callback(user)};
}
test('initialization is shared and enables login after ready without a user',async()=>{
    const h=harness();const a=h.c.loadFirebaseSync(),b=h.c.loadFirebaseSync();assert.equal(a,b);assert.equal(h.c.syncUi.login.disabled,true);
    h.c.startGoogleLogin();assert.equal(h.logins(),0);h.ready.resolve(null);await a;
    assert.equal(h.imports(),1);assert.equal(h.c.syncUi.login.disabled,false);
});
test('failed initialization allows retry on the same page without opening a delayed popup',async()=>{
    const h=harness();const a=h.c.loadFirebaseSync();h.ready.reject({code:'auth/network-request-failed'});await a;
    assert.equal(h.c.syncUi.login.disabled,false);assert.match(h.statuses.at(-1),/conexao/);
    h.client.ready=async()=>null;h.c.startGoogleLogin();await tick();assert.equal(h.imports(),2);assert.equal(h.logins(),0);
    assert.equal(h.c.syncUi.login.disabled,false);h.c.startGoogleLogin();assert.equal(h.logins(),1);
    h.popup.resolve({});await tick();
});
for(const code of ['auth/popup-closed-by-user','auth/network-request-failed','auth/popup-blocked'])test('popup recovery: '+code,async()=>{
    const h=harness();h.ready.resolve(null);await h.c.loadFirebaseSync();
    h.c.startGoogleLogin();assert.equal(h.logins(),1,'popup must open before returning from the gesture');
    h.c.startGoogleLogin();assert.equal(h.logins(),1);assert.equal(h.c.syncUi.login.disabled,true);
    h.popup.reject({code});await tick();assert.equal(h.c.syncUi.login.disabled,false);
    assert.match(h.statuses.at(-1),code.includes('closed')?/cancelado/:code.includes('network')?/conexao/:/popups/);
});
test('success and restored sessions never re-enable authenticated login',async()=>{
    const h=harness();h.ready.resolve(null);await h.c.loadFirebaseSync();h.c.startGoogleLogin();
    h.emit({uid:'alice'});h.popup.resolve({user:{uid:'alice'}});await tick();assert.equal(h.c.syncUi.login.disabled,true);
    h.c.startGoogleLogin();assert.equal(h.logins(),1);h.emit(null);assert.equal(h.c.syncUi.login.disabled,false);
    const restored=harness();restored.ready.resolve({uid:'alice'});await restored.c.loadFirebaseSync();assert.equal(restored.c.syncUi.login.disabled,true);
});
test('synchronous popup failure resets busy state',async()=>{
    const h=harness();h.ready.resolve(null);await h.c.loadFirebaseSync();h.client.login=()=>{throw {code:'auth/popup-blocked'};};
    h.c.startGoogleLogin();assert.equal(h.c.syncUi.login.disabled,false);assert.match(h.statuses.at(-1),/popups/);
});
test('real auth callback disables login before awaiting financial writes',async()=>{
    const h=harness(),pending=deferred();Object.assign(h.c,{chaveLocalConta,idbPendente:pending.promise,syncSessions:{begin:()=>1},isCurrentSyncSession:()=>false});
    vm.runInContext(source.slice(source.indexOf('async function onFirebaseUser('),source.indexOf('let syncPublishChain =')),h.c);
    const result=h.c.onFirebaseUser({uid:'alice'});assert.equal(h.c.syncUi.login.disabled,true);
    pending.resolve();await result;
});

test('late popup rejection cannot enable login after an authenticated callback',async()=>{
    const h=harness();h.ready.resolve(null);await h.c.loadFirebaseSync();h.c.startGoogleLogin();
    h.emit({uid:'alice'});h.popup.reject({code:'auth/popup-closed-by-user'});await tick();
    assert.equal(h.c.syncUi.login.disabled,true);assert.equal(h.c.syncUser.uid,'alice');
});
test('late popup success cannot restore a session superseded by logout',async()=>{
    const h=harness();h.ready.resolve(null);await h.c.loadFirebaseSync();h.c.startGoogleLogin();
    h.emit(null);h.popup.resolve({user:{uid:'old-alice'}});await tick();
    assert.equal(h.c.syncUi.login.disabled,false);assert.equal(h.c.syncUser,null);
});

test('observer registration failure does not publish a provisional user or block retry',async()=>{
    const h=harness();let ghost;
    h.client.onUser=fn=>{ghost=fn;fn({uid:'provisional'});throw {code:'auth/network-request-failed'};};
    h.ready.resolve({uid:'provisional'});await h.c.loadFirebaseSync();
    assert.equal(h.c.syncUi.login.disabled,false);assert.equal(h.c.syncUser,null);
    ghost({uid:'stale'});assert.equal(h.c.syncUser,null);
    h.client.ready=async()=>null;h.client.onUser=()=>()=>{};
    h.c.startGoogleLogin();await tick();assert.equal(h.imports(),2);assert.equal(h.logins(),0);
    h.c.startGoogleLogin();assert.equal(h.logins(),1);h.popup.resolve({});await tick();
});
test('observer is cancelled exactly once on restart and queued old callbacks are ignored',async()=>{
    const h=harness();let oldCallback,newCallback,stopped=0;
    h.client.onUser=fn=>{oldCallback=fn;return ()=>{stopped++;};};
    h.ready.resolve(null);await h.c.loadFirebaseSync();
    h.c.stopFirebaseAuthObserver();assert.equal(stopped,1);
    h.client.onUser=fn=>{newCallback=fn;return ()=>{stopped++;};};
    await h.c.loadFirebaseSync();assert.equal(stopped,1);
    oldCallback({uid:'old'});assert.equal(h.c.syncUser,null);
    newCallback({uid:'current'});assert.equal(h.c.syncUser.uid,'current');
    h.c.stopFirebaseAuthObserver();h.c.stopFirebaseAuthObserver();assert.equal(stopped,2);
});
test('logout cannot start a second popup until the first finally has completed',async()=>{
    const h=harness(),newer=deferred();h.ready.resolve(null);await h.c.loadFirebaseSync();
    h.c.startGoogleLogin();h.emit(null);h.c.startGoogleLogin();assert.equal(h.logins(),1);
    h.popup.resolve({});await tick();let newerCalls=0;
    h.client.login=()=>{newerCalls++;return newer.promise;};h.c.startGoogleLogin();h.c.startGoogleLogin();
    assert.equal(newerCalls,1);assert.equal(h.c.syncUi.login.disabled,true);
    await tick();assert.equal(h.c.syncUi.login.disabled,true);
    newer.reject({code:'auth/popup-closed-by-user'});await tick();assert.equal(h.c.syncUi.login.disabled,false);
});
test('a synchronous observer event takes precedence over ready() session data',async()=>{
    const h=harness();h.ready.resolve({uid:'old'});h.client.onUser=fn=>{fn(null);return ()=>{};};
    await h.c.loadFirebaseSync();assert.equal(h.c.syncUser,null);assert.equal(h.c.syncUi.login.disabled,false);
});
