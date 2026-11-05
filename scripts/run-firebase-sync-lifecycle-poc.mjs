
import assert from 'node:assert/strict';
import { composeFirebaseSyncLifecycle } from '../experimental/firebase-sync-lifecycle-poc.js';
if(process.env.FIREBASE_SYNC_LIFECYCLE_POC!=='1')throw new Error('Explicit PoC opt-in required');
const projectId='demo-controle-financeiro', origin='http://127.0.0.1:9099';
for (const key of ['NO_PROXY','no_grpc_proxy']) process.env[key]=[process.env[key],'127.0.0.1','localhost','::1'].filter(Boolean).join(',');
const financialOnly=process.env.FIREBASE_SYNC_FINANCIAL_ONLY==='1';
const nativeFetch=globalThis.fetch;
assert.equal((await nativeFetch(origin+'/emulator/v1/projects/'+projectId+'/config',{signal:AbortSignal.timeout(2500)})).status,200);
if(financialOnly){const response=await nativeFetch('http://127.0.0.1:8080/v1/projects/'+projectId+'/databases/(default)/documents/users/synthetic-connectivity/records/synthetic-absent',{signal:AbortSignal.timeout(4000)});assert.ok([200,403,404].includes(response.status));}
let offline=false;globalThis.fetch=(input,options={})=>{if(offline)throw new TypeError('Synthetic offline');const u=new URL(typeof input==='string'?input:input.url||input);assert.equal(u.origin,origin);return nativeFetch(input,{...options,redirect:'error',signal:AbortSignal.timeout(4000)});};
const appSDK=await import('firebase/app'),sdk=await import('firebase/auth'),fs=await import('firebase/firestore');
const {criarFirebaseSync}=await import('../firebase-sync-entry.js');
let auth,db,app,count=0,cancels=0,packet,fail=false,bridge;
const client=criarFirebaseSync({projectId,apiKey:'demo-only-auth-poc'}, {
 createApp:c=>app=appSDK.initializeApp(c,'synthetic-sync-lifecycle-'+crypto.randomUUID()),
 createAuth:a=>{auth=sdk.initializeAuth(a,{persistence:sdk.inMemoryPersistence});sdk.connectAuthEmulator(auth,origin,{disableWarnings:true});return auth;},
 createFirestore:a=>{db=fs.initializeFirestore(a,{localCache:fs.memoryLocalCache()});fs.connectFirestoreEmulator(db,'127.0.0.1',8080);return db;},
 checkAuthPersistence(){},getRedirectResult:async()=>null
});
const rawOnUser=client.onUser, rawLogout=client.logout;
const source={...client,onUser:callback=>{count++;packet=callback;const stop=rawOnUser(callback);return()=>{cancels++;stop();};},logout:()=>{if(fail)throw new Error('Synthetic signOut failure');return rawLogout();}};
const ids=['A','B'].map(x=>'synthetic-sync-'+x+'-'+crypto.randomUUID());
let passed=0;const ok=name=>{passed++;console.log(JSON.stringify({scenario:name,result:'approved'}));};
const wait=async predicate=>{for(let n=0;n<200;n++){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw new Error('State timeout');};
const events=[];
try{
 if(financialOnly){await runFinancialComparison();} else {
 bridge=composeFirebaseSyncLifecycle({client:source,auth,sdk,allowedUids:ids});
 const stop=bridge.client.onUser(u=>events.push(u?.uid||null));await bridge.session.ready;await bridge.client.ready();assert.equal(count,1);ok('real factory, single Auth subscription');
 for(const uid of ids){await sdk.signInWithCustomToken(auth,JSON.stringify({uid}));await wait(()=>bridge.session.lifecycle.state().owner?.uid===uid);assert.equal(bridge.session.lifecycle.state().ownership,'unconfirmed');assert.equal(await bridge.session.revalidate(),true);}ok('A to B, explicit remote proof only');
 const before=bridge.session.stats.proofs, old=bridge.session.lastPacket;packet(auth.currentUser);await new Promise(r=>setTimeout(r,20));assert.equal(bridge.session.stats.proofs,before);ok('duplicate preserves legacy delivery without new proof');
 offline=true;assert.equal(await bridge.session.revalidate(),false);assert.equal(bridge.session.lifecycle.state().ownership,'unconfirmed');offline=false;ok('remote proof failure stays unconfirmed');
 fail=true;await assert.rejects(bridge.client.logout(),/Synthetic signOut failure/);assert.equal(bridge.session.lifecycle.state().owner,null);assert.equal(await bridge.session.receive(old),false);ok('failed logout revokes and rejects late callback');
 fail=false;await bridge.client.logout();await wait(()=>auth.currentUser===null);assert.equal(bridge.session.lifecycle.state().owner,null);ok('logout retry reconciles SDK');
 assert.deepEqual(events,[null,...ids,ids[1],null]);stop();stop();assert.equal(cancels,1);assert.equal(count,1);assert.equal(bridge.session.stats.adapterOpens,0);assert.ok(bridge.session.states.every(s=>s.data===null));ok('idempotent cancellation, no adapters or financial state');
 console.log(JSON.stringify({suite:'Auth composition regression',passed,failed:0,notExecuted:[],financialComparison:'separate FIREBASE_SYNC_FINANCIAL_ONLY=1 mode',events}));
}
}finally{await bridge?.session.dispose();await sdk.signOut(auth);await fs.terminate(db);await appSDK.deleteApp(app);globalThis.fetch=nativeFetch;}

async function runFinancialComparison(){
 const {AutomaticFinanceSync}=await import('../automatic-finance-sync.js');
 const {ServicoFinanceiroAtomico}=await import('../financial-atomic-service.js');
 const {normalizarEstado,validarBackup}=await import('../finance-core.js');
 const {makeOperation,recordEntityKey}=await import('../sync-core.js');
 const {financeSettings}=await import('../automatic-sync-policy.js');
 assert.equal(auth.emulatorConfig.host,'127.0.0.1');assert.equal(db._settings.host,'127.0.0.1:8080');assert.equal(db._settings.ssl,false);
 const results=[];
 function memoryDatabase(){const data=new Map();let chain=Promise.resolve();return {data,ler:async k=>structuredClone(data.get(k)??null),async alterar(key,fn){return (await this.alterarDocumentos([key],docs=>{docs.set(key,fn(docs.get(key)));return docs;})).get(key);},alterarDocumentos(keys,fn){const task=chain.then(()=>{const docs=new Map(keys.map(k=>[k,structuredClone(data.get(k)??null)]));const result=fn(docs);assert.ok(!result?.then);for(const k of keys)data.set(k,structuredClone(result.get(k)));return result;});chain=task.catch(()=>{});return task;}};}
 const month='2026-11', initial=normalizarEstado({versao:3,categorias:['Casa'],meses:{[month]:{receitas:[],despesas:[]}}});
 for(const composed of [false,true]){
  const owners=['A','B'].map(x=>'synthetic-financial-'+x+'-'+crypto.randomUUID());
  const local=memoryDatabase(), service=new ServicoFinanceiroAtomico(local,validarBackup,q=>Array.isArray(q.outbox)&&Array.isArray(q.conflicts),{request:(_k,fn)=>fn()});
  for(const uid of owners)await service.inicializar(uid,initial,{generation:'legacy',initialized:true,automaticPolicyInitialized:true,outbox:[],conflicts:[],remoteRevisions:{},attempted:{},recoveryKeys:[],settingsBaseline:financeSettings(initial),automaticSettingsDirty:false});
  let registrations=0,cancellations=0,acks=[],mode='normal',commitEntered,releaseCommit;
  const realCommit=client.commit;
  const remote={...client,onUser:fn=>{registrations++;const stop=client.onUser(fn);return()=>{cancellations++;stop();};},commit:async(...args)=>{const ack=await realCommit(...args);assert.equal(ack.acknowledged,true);acks.push({id:args[1].id,ack:structuredClone(ack)});if(mode==='lost'){mode='normal';throw Object.assign(new Error('Synthetic lost ACK after remote commit'),{code:'unavailable'});}if(mode==='delay'){mode='normal';commitEntered();await new Promise(r=>{releaseCommit=r;});}return ack;}};
  const composition=composed?composeFirebaseSyncLifecycle({client:remote,auth,sdk,allowedUids:owners}):null, active=composition?.client||remote;
  const transitions=[],sync=new AutomaticFinanceSync({client:active,db:local,service,readLegacy:()=>({estado:'ausente'}),readLegacyMetadata:()=>({}),connectivity:{navigator:{onLine:false}},onTransition:u=>transitions.push(u?.uid||null),onAccount(){},onState(){},onStatus(message,failed){if(failed)console.error(JSON.stringify({financialStatus:message}));}});
  const stages=[], capture=async name=>{stages.push({name,documents:await Promise.all(owners.map(async uid=>({state:await local.ler('estado:'+uid),queue:await service.lerFila(uid)}))),acks:structuredClone(acks)});};
  const ready=async uid=>{await wait(()=>sync.session?.uid===uid);await wait(()=>sync.session?.generation==='legacy');if(composition)await wait(()=>composition.session.lifecycle.state().owner?.uid===uid);};
  const edit=async(id,value)=>{const uid=owners[0],base=(await local.ler('estado:'+uid)).dados,next=structuredClone(base);next.meses[month].receitas.push({id,nome:'SYNTHETIC FINANCIAL COMPARISON',valor:value,recebido:false});await service.aplicarEdicao(uid,base,next,(changes,q)=>changes.map(value=>makeOperation(recordEntityKey(value),value,q.remoteRevisions[recordEntityKey(value)]||null)));};
  try{
   await sync.start();if(composition)await composition.session.ready;assert.equal(registrations,1);
   await sdk.signInWithCustomToken(auth,JSON.stringify({uid:owners[0]}));await ready(owners[0]);
   await sync.cycle(sync.session); // server-validated empty account and real settings ACK
   await edit('synthetic-income-one',12.34);await capture('offline-pending');assert.equal((await service.lerFila(owners[0])).outbox.length,1);
   let entered;const held=new Promise(r=>{entered=r;});commitEntered=entered;mode='delay';const pending=sync.cycle(sync.session);await held;
   assert.equal((await service.lerFila(owners[0])).outbox.length,1);await capture('ACK-held');releaseCommit();await pending;assert.equal((await service.lerFila(owners[0])).outbox.length,0);await capture('ACK-confirmed');
   await edit('synthetic-income-two',23.45);await fs.disableNetwork(db);await assert.rejects(sync.cycle(sync.session));assert.equal((await service.lerFila(owners[0])).outbox.length,1);await capture('network-offline');await fs.enableNetwork(db);
   mode='lost';await assert.rejects(sync.cycle(sync.session),/Synthetic lost ACK/);assert.equal((await service.lerFila(owners[0])).outbox.length,1);await capture('ACK-lost');await sync.cycle(sync.session);assert.equal((await service.lerFila(owners[0])).outbox.length,0);assert.equal((await client.list(owners[0])).length,2);await capture('ACK-retried');
   const saved=composition?.session.lastPacket;
   const originalSnapshot=active.generationSnapshot;let notify,release;const started=new Promise(r=>{notify=r;});const gate=new Promise(r=>{release=r;});let once=true;
   active.generationSnapshot=async(...args)=>{const result=await originalSnapshot(...args);if(once){once=false;notify();await gate;}return result;};
   const oldCycle=sync.cycle(sync.session);await started;
   await sdk.signInWithCustomToken(auth,JSON.stringify({uid:owners[1]}));await ready(owners[1]);const before=structuredClone(await local.ler('estado:'+owners[1]));release();await assert.rejects(oldCycle,{code:'persistence/cancelled'});active.generationSnapshot=originalSnapshot;
   assert.deepEqual(await local.ler('estado:'+owners[1]),before);if(composition)assert.equal(await composition.session.receive(saved),false);await sync.cycle(sync.session);await capture('B-after-late-A-snapshot');
   await active.logout();await wait(()=>sync.session===null);await wait(()=>transitions.at(-1)===null);if(composition){await wait(()=>composition.session.lifecycle.state().owner===null);assert.equal(composition.session.stats.adapterOpens,0);assert.ok(composition.session.states.every(s=>s.data===null&&!['unlocking','ready','operating'].includes(s.phase)));assert.deepEqual(composition.errors,[]);}await capture('logout');
   assert.deepEqual(transitions,[null,...owners,null]);assert.equal(registrations,1);sync.stop();sync.unAuth=null;assert.equal(cancellations,1);
   // Only wall-clock confirmation strings differ; IDs, revisions, queues and ACKs remain exact.
   for(const stage of stages)for(const row of stage.documents){if(row.queue.lastConfirmed){assert.ok(Number.isFinite(Date.parse(row.queue.lastConfirmed)));row.queue.lastConfirmed='<validated-confirmation-time>';}}
   results.push(stages);ok((composed?'with':'without')+' Lifecycle: real sync offline/held ACK/lost ACK/switch/logout');
  }finally{releaseCommit?.();if(sync.unAuth){sync.stop();sync.unAuth=null;}await composition?.session.dispose();await sdk.signOut(auth);await fs.enableNetwork(db);}
 }
 assert.deepEqual(results[1],results[0]);ok('exact financial state, revisions, operation IDs, queue and ACK equivalence at eight checkpoints');
 console.log(JSON.stringify({suite:'financial composition comparison',passed,failed:0,checkpoints:results[0].length,authObserversPerRun:1,adaptersOpened:0,productionConnections:0,notExecuted:[]}));
}
