import { settingsLocks } from './helpers/settings-locks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as sync from '../sync-core.js';
import {ServicoFinanceiroAtomico} from '../financial-atomic-service.js';
import {validarBackup,normalizarEstado,normalizarValorMonetario,mesFinanceiroValido} from '../finance-core.js';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const metadata={fromCache:false,hasPendingWrites:false};
const entry=()=>{const item={month:'2026-10',type:'receitas',id:'r1',deleted:false,record:{id:'r1',nome:'Synthetic',valor:10},revision:'record-a',updatedAt:{seconds:10,nanoseconds:0}};return {...item,_docId:sync.recordEntityKey(item)};};
const financialState=()=>normalizarEstado({versao:3,tema:'claro',categorias:['Casa','Moto','Serasa'],meses:{'2026-10':{receitas:[entry().record],despesas:[]}}});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
const snapshot=(value,revision)=>({...value,revision,updatedAt:{seconds:10,nanoseconds:0}});
async function setup(){
 const initial=financialState(entry());initial.categorias=['Casa','Moto','Serasa'];
 const c=vm.createContext({...sync,structuredClone,TextEncoder,console,validarBackup,normalizarEstado,normalizarValorMonetario,mesFinanceiroValido,
  CHAVE_ESTADO:'controleFinanceiro:v3',IDB_HOMOLOGACAO:false,idbBase:structuredClone(initial),estado:structuredClone(initial),
  syncUser:{uid:'alice'},syncRemoteRecords:[entry()],syncRemoteRecordsLoaded:true,syncRemoteSettings:null,settingsConflictActive:false,
  idbPendente:Promise.resolve(),idbBloqueado:false,applyingRemoteSync:false,navigator:{onLine:true},window:{addEventListener(){}},
  syncUi:{enabled:{checked:true},last:{textContent:''}},setGoogleAuthUser(){},updateGoogleLoginButton(){},
  localStorage:{getItem:()=>null},renderTudo(){},renderSyncConflicts(){},formatLastSync:x=>x});
 const h={context:c,statuses:[],commits:[]},docs=new Map();let serial=Promise.resolve();
 c.estadoParaSalvar=()=>structuredClone(c.estado);c.setSyncStatus=message=>h.statuses.push(message);
 c.firebaseClient={list:async()=>[entry()],commit:async()=>({acknowledged:true}),saveSettings:async()=>({acknowledged:true,revision:'saved'})};
 vm.runInContext(source.slice(source.indexOf('function syncEntityKey('),source.indexOf('let firebaseInitPromise =')),c);
 vm.runInContext(source.slice(source.indexOf('let syncPublishChain ='),source.indexOf('window.addEventListener("finance-local-change"')),c);
 const db={
  ler:async key=>structuredClone(docs.get(key)??null),
  alterarDocumentos(keys,transform){const run=serial.then(()=>{const input=new Map(keys.map(k=>[k,structuredClone(docs.get(k)??null)]));const output=transform(input);for(const k of keys)docs.set(k,structuredClone(output.get(k)));return output;});serial=run.catch(()=>{});return run;},
  alterar(key,transform){return this.alterarDocumentos([key],m=>{m.set(key,transform(m.get(key)));return m;}).then(m=>m.get(key));}
 };
 c.idbBanco=db;c.idbServico=new ServicoFinanceiroAtomico(db,validarBackup,q=>Array.isArray(q?.conflicts)&&Array.isArray(q?.outbox),settingsLocks());
 vm.runInContext(source.slice(source.indexOf('const syncSessions ='),source.indexOf('const syncMetaKey =')),c);
 c.syncSessions=vm.runInContext('syncSessions',c);c.syncSessions.begin();
 c.isCurrentSyncSession=vm.runInContext('isCurrentSyncSession',c);
 c.chaveEstadoAtual=sync.chaveLocalConta('alice');
 c.readSyncMeta=uid=>structuredClone(docs.get('fila:'+(uid||'alice')));
 c.writeSyncMeta=(uid,value)=>{docs.set('fila:'+uid,structuredClone(value));return value;};
 vm.runInContext(source.slice(source.indexOf('const syncMetaKey ='),source.indexOf('function setSyncStatus(')),c);
 vm.runInContext(source.slice(source.indexOf('async function persistirEstadoFinanceiro('),source.indexOf('function avisarArmazenamentoTemporario(')),c);
 const bob={...structuredClone(initial),tema:'rosa'};
 for(const [uid,state] of [['alice',initial],['bob',bob],['@local',initial]])await c.idbServico.inicializar(uid,state,{initialized:true,outbox:[],conflicts:[],lastConfirmed:null,settingsBaseline:c.financialSettings(state)});
 h.docs=docs;h.db=db;h.queue=uid=>structuredClone(docs.get('fila:'+(uid||'alice')));
 h.server=new Map([['alice',snapshot(c.financialSettings(initial),'alice-s0')],['bob',snapshot(c.financialSettings(bob),'bob-s0')]]);
 c.firebaseClient.getSettings=async uid=>structuredClone(h.server.get(uid));
 c.firebaseClient.listConflicts=async()=>[];
 for(const name of ['listen','listenSettings','listenConflicts'])c.firebaseClient[name]=()=>()=>{};
 c.syncRemoteSettings=structuredClone(h.server.get('alice'));
 h.installUserHandler=()=>{
  for(const name of ['account','login','logout','enabledLine','restore'])c.syncUi[name]={};
  Object.assign(c,{syncStopListener:null,syncSettingsStop:null,syncConflictsStop:null,resetFinancialInteractions(){},
   lerEstadoPersistido:key=>({estado:'valido',valor:structuredClone(docs.get('estado:'+(key===c.CHAVE_ESTADO?'@local':key.split(':').at(-1))).dados)}),
   recuperacaoFinanceira:{protegido:false}});
  vm.runInContext(source.slice(source.indexOf('async function onFirebaseUser('),source.indexOf('let syncPublishChain =')),c);
 };
 return h;
}

test('storage failure stops an in-flight settings publisher and cannot confirm synchronization',async()=>{
 const h=await setup(),c=h.context,readEntered=deferred(),readRelease=deferred();
 const local=c.financialSettings(),remote=snapshot({...local,theme:'escuro'},'server-new');h.server.set('alice',remote);
 c.firebaseClient.getSettings=async()=>{readEntered.resolve();await readRelease.promise;return structuredClone(remote);};
 const writes=[];
 c.firebaseClient.saveSettings=async(uid,value,base)=>{writes.push({value:structuredClone(value),base});assert.equal(base,h.server.get(uid).revision);h.server.set(uid,snapshot(value,'client-revert'));return {acknowledged:true,revision:'client-revert'};};
 const sending=c.publishFirebaseState(c.estado);await readEntered.promise;
 const original=h.db.alterarDocumentos.bind(h.db);let rejectState=true;
 h.db.alterarDocumentos=(keys,fn)=>{if(rejectState&&keys.includes('estado:alice')){rejectState=false;return Promise.reject(new Error('synthetic interrupted state write'));}return original(keys,fn);};
 await c.onRemoteSettings(remote,metadata,1);
 assert.equal(c.estado.tema,'claro');assert.equal(h.docs.get('estado:alice').dados.tema,'claro');
 assert.equal(c.idbBloqueado,true);assert.equal(h.queue().conflicts.length,0);
 readRelease.resolve();await sending;
 assert.equal(writes.length,0);assert.equal(h.server.get('alice').theme,'escuro');assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('a successfully applied snapshot invalidates a publisher that captured older settings',async()=>{
 const h=await setup(),c=h.context,readEntered=deferred(),release=deferred(),remote=snapshot({...c.financialSettings(),theme:'escuro'},'server-new');
 c.firebaseClient.getSettings=async()=>{readEntered.resolve();await release.promise;return remote;};
 h.server.set('alice',remote);
 const writes=[];c.firebaseClient.saveSettings=async(uid,value,base)=>{assert.equal(base,h.server.get(uid).revision);writes.push({value,base});h.server.set(uid,snapshot(value,'revert'));return {acknowledged:true,revision:'revert'};};
 const sending=c.publishFirebaseState(c.estado);await readEntered.promise;
 await c.onRemoteSettings(remote,metadata,1);assert.equal(c.estado.tema,'escuro');
 release.resolve();await sending;
 assert.equal(writes.length,0);assert.equal(h.server.get('alice').theme,'escuro');assert.notEqual(h.statuses.at(-1),'Sincronizado');assert.equal(h.queue().conflicts.length,0);
 await c.onRemoteSettings(h.server.get('alice'),metadata,1);
 assert.equal(c.estado.tema,'escuro');assert.equal(h.queue().conflicts.length,0);
});

test('logout cancels a snapshot waiting for idbPendente before it can submit a state write',async()=>{
 const h=await setup(),c=h.context,blocked=deferred();h.installUserHandler();
 const remote=snapshot({...c.financialSettings(),theme:'escuro'},'server-new');c.idbPendente=blocked.promise;
 const original=c.idbServico.aplicarEdicao.bind(c.idbServico),calls=[];
 c.idbServico.aplicarEdicao=(uid,...args)=>{calls.push({uid,valid:c.isCurrentSyncSession(1,'alice')});return original(uid,...args);};
 const persistEntered=deferred(),persist=c.persistirEstadoFinanceiro;
 c.persistirEstadoFinanceiro=(...args)=>{persistEntered.resolve();return persist(...args);};
 const old=c.onRemoteSettings(remote,metadata,1);await persistEntered.promise;
 const logout=c.onFirebaseUser(null);assert.equal(c.syncSessions.isCurrent(1),false);
 blocked.resolve();await Promise.all([old,logout]);
 assert.equal(calls.length,0);assert.equal(h.docs.get('estado:alice').dados.tema,'claro');
 assert.equal(c.syncUser,null);assert.equal(c.estado.tema,'claro');assert.equal(c.settingsConflictActive,false);
});

test('reconnection hydrates persisted conflicts before a failing remote read',async()=>{
 const h=await setup(),c=h.context;h.installUserHandler();
 await c.idbServico.registrarConflitoSettings('alice',{kind:'settings',local:c.financialSettings(),remote:snapshot({...c.financialSettings(),theme:'escuro'},'conflict')});
 c.settingsConflictActive=true;c.firebaseClient.list=async()=>{throw new Error('synthetic network failure');};
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.queue().conflicts.length,1);assert.equal(c.settingsConflictActive,true);
});

test('account switch cancels snapshot persistence waiting on idbPendente without changing either account',async()=>{
 const h=await setup(),c=h.context,blocked=deferred(),entered=deferred();h.installUserHandler();
 const before=JSON.stringify(h.docs.get('estado:alice')),bob=JSON.stringify(h.docs.get('estado:bob'));
 c.idbPendente=blocked.promise;const persist=c.persistirEstadoFinanceiro;
 c.persistirEstadoFinanceiro=(...args)=>{entered.resolve();return persist(...args);};
 const old=c.onRemoteSettings(snapshot({...c.financialSettings(),theme:'escuro'},'old'),metadata,1);await entered.promise;
 const change=c.onFirebaseUser({uid:'bob'});blocked.resolve();await Promise.all([old,change]);
 assert.equal(JSON.stringify(h.docs.get('estado:alice')),before);assert.equal(JSON.stringify(h.docs.get('estado:bob')),bob);
 assert.equal(c.syncUser.uid,'bob');assert.equal(c.estado.tema,'rosa');assert.equal(c.idbBloqueado,false);
});

test('a transaction queued before invalidation rechecks the session before changing state or queue',async()=>{
 const h=await setup(),c=h.context,before=JSON.stringify([...h.docs]);
 const original=h.db.alterarDocumentos.bind(h.db);
 h.db.alterarDocumentos=(keys,fn)=>original(keys,docs=>{if(keys.includes('estado:alice'))c.syncSessions.begin();return fn(docs);});
 await c.onRemoteSettings(snapshot({...c.financialSettings(),theme:'escuro'},'new'),metadata,1);
 assert.equal(JSON.stringify([...h.docs]),before);assert.equal(c.idbBloqueado,false);
});

test('storage blocked during a network read prevents any subsequent settings write or visual confirmation',async()=>{
 const h=await setup(),c=h.context;let writes=0;
 c.firebaseClient.getSettings=async()=>{c.idbBloqueado=true;return snapshot({...c.financialSettings(),theme:'escuro'},'new');};
 c.firebaseClient.saveSettings=async()=>{writes++;return {acknowledged:true,revision:'bad'};};
 await c.publishFirebaseState(c.estado);
 assert.equal(writes,0);assert.notEqual(h.statuses.at(-1),'Sincronizado');assert.equal(h.queue().lastConfirmed,null);
});

test('a durable edit from another tab prevents publication and confirmation of the old UI state',async()=>{
 const h=await setup(),c=h.context;let writes=0;
 c.firebaseClient.getSettings=async()=>{
  const base=structuredClone(c.estado);await c.idbServico.aplicarEdicao('alice',base,{...base,tema:'rosa'});
  return snapshot({...c.financialSettings(),theme:'escuro'},'new');
 };
 c.firebaseClient.saveSettings=async()=>{writes++;return {acknowledged:true,revision:'bad'};};
 await c.publishFirebaseState(c.estado);
 assert.equal(writes,0);assert.equal(h.docs.get('estado:alice').dados.tema,'rosa');assert.equal(h.queue().lastConfirmed,null);
 assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('a financial operation inserted at the confirmation boundary survives and prevents Synced',async()=>{
 const h=await setup(),c=h.context,confirm=c.idbServico.confirmarSincronizacao.bind(c.idbServico);
 const {month,type,id,record}=entry();
 const operation=sync.makeOperation(sync.recordEntityKey(entry()),{month,type,id,record,deleted:false},null);
 c.idbServico.confirmarSincronizacao=async(...args)=>{await c.idbServico.enfileirar('alice',operation);return confirm(...args);};
 await c.publishFirebaseState(c.estado);
 assert.deepEqual(h.queue().outbox,[operation]);assert.equal(h.queue().lastConfirmed,null);assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('eight existing conflicts and pending financial operations remain exact through failed loading and equivalent snapshots',async()=>{
 const h=await setup(),c=h.context;h.installUserHandler();const local=c.financialSettings();
 const conflicts=Array.from({length:8},(_,i)=>({kind:'settings',local,remote:snapshot(i<2?{...local,categories:['Casa']}:local,String(i))}));
 const {month,type,id,record}=entry();
 const outbox=[sync.makeOperation(sync.recordEntityKey(entry()),{month,type,id,record,deleted:false},null)];
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts,outbox}));const before=JSON.stringify(h.queue());
 c.firebaseClient.list=async()=>{throw new Error('synthetic network failure');};
 await c.onFirebaseUser({uid:'alice'});
 for(let i=0;i<3;i++)await c.onRemoteSettings(snapshot(local,'equivalent-'+i),metadata,c.syncSessions.current());
 assert.equal(JSON.stringify(h.queue()),before);assert.equal(c.settingsConflictActive,true);
 assert.ok(c.estado.categorias.includes('Moto'));assert.ok(c.estado.categorias.includes('Serasa'));
});

test('a snapshot arriving inside the SDK cancels the old settings transaction without a deadlock',async()=>{
 const h=await setup(),c=h.context,entered=deferred(),release=deferred();let writes=0;
 const previous=snapshot({...c.financialSettings(),theme:'escuro'},'previous');c.syncRemoteSettings=previous;h.server.set('alice',previous);
 c.firebaseClient.saveSettings=async(_uid,_value,_base,canWrite)=>{
  entered.resolve();await release.promise;
  if(!canWrite())throw Object.assign(new Error('stale'),{code:'sync/settings-stale'});
  writes++;return {acknowledged:true,revision:'bad'};
 };
 const sending=c.publishFirebaseState(c.estado);await entered.promise;
 const receiving=c.onRemoteSettings(snapshot({...c.financialSettings(),theme:'rosa'},'other-device'),metadata,1);
 release.resolve();await Promise.all([sending,receiving]);
 assert.equal(writes,0);assert.equal(h.queue().conflicts.length,1);assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('snapshot-first publication confirms the current durable state without rewriting remote settings',async()=>{
 const h=await setup(),c=h.context,remote=snapshot({...c.financialSettings(),theme:'escuro'},'new');h.server.set('alice',remote);let writes=0;
 c.firebaseClient.saveSettings=async()=>{writes++;throw new Error('must not rewrite');};
 await c.onRemoteSettings(remote,metadata,1);await c.publishFirebaseState(c.estado);
 assert.equal(writes,0);assert.equal(h.statuses.at(-1),'Sincronizado');assert.ok(h.queue().lastConfirmed);
});

test('a conflict requested during the SDK waits for publication and then blocks subsequent sends',async()=>{
 const h=await setup(),c=h.context,entered=deferred(),release=deferred();let writes=0;
 const remote=snapshot({...c.financialSettings(),theme:'escuro'},'remote');h.server.set('alice',remote);c.syncRemoteSettings=remote;
 c.firebaseClient.saveSettings=async(_uid,_value,_base,canWrite)=>{
  entered.resolve();await release.promise;
  if(!canWrite())throw Object.assign(new Error('stale'),{code:'sync/settings-stale'});
  writes++;return {acknowledged:true,revision:'bad'};
 };
 const sending=c.publishFirebaseState(c.estado);await entered.promise;
 const registering=c.registerSettingsConflict('alice',c.financialSettings(),remote,undefined,1);
 await Promise.resolve();assert.equal(h.queue().conflicts.length,0);
 release.resolve();await Promise.all([sending,registering]);
 assert.equal(writes,1);assert.equal(h.queue().conflicts.length,1);
 await c.publishFirebaseState(c.estado);assert.equal(writes,1);assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('a deferred manual settings publication cannot remove any of the eight stored conflicts',async()=>{
 const h=await setup(),c=h.context,local=c.financialSettings();
 const conflicts=Array.from({length:8},(_,i)=>({kind:'settings',local,remote:snapshot({...local,theme:'escuro'},String(i))}));
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts}));c.navigator.onLine=false;
 vm.runInContext(source.slice(source.indexOf('async function resolveSyncConflict('),source.indexOf('syncUi.conflicts.addEventListener')),c);
 await c.resolveSyncConflict(0,'local');
 assert.equal(JSON.stringify(h.queue().conflicts),JSON.stringify(conflicts));assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('a local edit while staging reads metadata cannot be reverted by the old publisher',async()=>{
 const h=await setup(),c=h.context,entered=deferred(),release=deferred(),read=c.idbServico.lerFila.bind(c.idbServico);let first=true;
 c.idbServico.lerFila=async uid=>{const value=await read(uid);if(first){first=false;entered.resolve();await release.promise;}return value;};
 const sending=c.publishFirebaseState(c.estado);await entered.promise;
 const base=structuredClone(c.estado),next=structuredClone(base);next.meses['2026-10'].receitas[0].valor=20;
 const item={...entry(),record:next.meses['2026-10'].receitas[0]},operation=sync.makeOperation(sync.recordEntityKey(item),{month:item.month,type:item.type,id:item.id,record:item.record,deleted:false},'record-a');
 await c.idbServico.aplicarEdicao('alice',base,next,()=>[operation]);c.estado=next;c.idbBase=structuredClone(next);
 release.resolve();await assert.rejects(sending,error=>error.code==='persistence/cancelled');
 assert.equal(h.docs.get('estado:alice').dados.meses['2026-10'].receitas[0].valor,20);
 assert.deepEqual(h.queue().outbox,[operation]);
});


function installResolution(c) {
 vm.runInContext(source.slice(source.indexOf('async function resolveSyncConflict('),source.indexOf('syncUi.conflicts.addEventListener')),c);
}
async function seedEight(h) {
 const local=h.context.financialSettings(),remote=snapshot({...local,theme:'escuro'},'review');
 const conflicts=Array.from({length:8},(_,i)=>({kind:'settings',local,remote:{...remote,revision:String(i)}}));
 await h.context.idbServico.alterarFila('alice',q=>({...q,conflicts,outbox:[{id:'offline',entityKey:'offline'}]}));
 return conflicts;
}
test('manual resolution paused in A cannot write B or remove any of the eight original conflicts',async()=>{
 const h=await setup(),c=h.context;const conflicts=await seedEight(h);installResolution(c);
 const beforeBob=JSON.stringify([h.docs.get('estado:bob'),h.queue('bob')]);
 const entered=deferred(),release=deferred(),read=c.idbServico.lerFila.bind(c.idbServico);let first=true;
 c.idbServico.lerFila=async uid=>{const q=await read(uid);if(first){first=false;entered.resolve();await release.promise;}return q;};
 const resolving=c.resolveSyncConflict(0,'remote');await entered.promise;
 c.syncSessions.begin();c.syncUser={uid:'bob'};c.chaveEstadoAtual=sync.chaveLocalConta('bob');
 c.estado=structuredClone(h.docs.get('estado:bob').dados);c.idbBase=structuredClone(c.estado);
 release.resolve();await resolving;
 assert.equal(JSON.stringify([h.docs.get('estado:bob'),h.queue('bob')]),beforeBob);
 assert.equal(JSON.stringify(h.queue('alice').conflicts),JSON.stringify(conflicts));assert.deepEqual(h.queue('alice').outbox,[{id:'offline',entityKey:'offline'}]);
 assert.deepEqual(h.docs.get('estado:alice').dados.categorias,['Casa','Moto','Serasa']);
});
test('manual resolution waiting on local persistence is cancelled by logout without removing conflicts',async()=>{
 const h=await setup(),c=h.context;const conflicts=await seedEight(h);installResolution(c);
 const release=deferred();c.idbPendente=release.promise;
 const before=JSON.stringify([...h.docs]);const resolving=c.resolveSyncConflict(0,'remote');
 await Promise.resolve();await Promise.resolve();c.syncSessions.begin();c.syncUser=null;release.resolve();await resolving;
 assert.equal(JSON.stringify([...h.docs]),before);assert.equal(JSON.stringify(h.queue().conflicts),JSON.stringify(conflicts));
});
test('metadata read begun before reconnect retains its original session identity',async()=>{
 const h=await setup(),c=h.context;await seedEight(h);const before=JSON.stringify(h.queue());
 const entered=deferred(),release=deferred(),read=c.idbServico.lerFila.bind(c.idbServico);
 c.idbServico.lerFila=async uid=>{const q=await read(uid);entered.resolve();await release.promise;return q;};
 const reading=vm.runInContext('readSyncMeta("alice")',c);await entered.promise;c.syncSessions.begin();release.resolve();
 c.stale=await reading;c.stale.enabled=false;
 await assert.rejects(vm.runInContext('writeSyncMeta("alice", stale)',c),e=>e.code==='persistence/cancelled');
 assert.equal(JSON.stringify(h.queue()),before);
});
test('metadata write waiting for another tab lock rechecks logout inside the transaction',async()=>{
 const h=await setup(),c=h.context;await seedEight(h);const before=JSON.stringify(h.queue());
 const entered=deferred(),release=deferred();const holder=c.idbServico.coordenarSettings('alice',async()=>{entered.resolve();await release.promise;});await entered.promise;
 c.proposal=await vm.runInContext('readSyncMeta("alice")',c);c.proposal.conflicts=[];c.proposal.enabled=false;
 const writing=vm.runInContext('writeSyncMeta("alice", proposal)',c);
 const rejected=assert.rejects(writing,e=>e.code==='persistence/cancelled');c.syncSessions.begin();c.syncUser=null;
 release.resolve();await Promise.all([holder,rejected]);assert.equal(JSON.stringify(h.queue()),before);
});
test('old remote-conflict callback cannot persist after same-account reconnection',async()=>{
 const h=await setup(),c=h.context;await seedEight(h);const before=JSON.stringify(h.queue());
 const entered=deferred(),release=deferred(),read=c.idbServico.lerFila.bind(c.idbServico);
 c.idbServico.lerFila=async uid=>{const q=await read(uid);entered.resolve();await release.promise;return q;};
 const callback=c.onRemoteConflicts([],1,metadata);await entered.promise;c.syncSessions.begin();c.settingsConflictActive=true;release.resolve();await callback;
 assert.equal(JSON.stringify(h.queue()),before);assert.equal(c.settingsConflictActive,true);
});
test('missing cross-tab coordinator fails closed for remote settings but preserves local persistence',async()=>{
 const h=await setup(),c=h.context;c.idbServico.settingsLocks=null;let writes=0;
 h.server.set('alice',snapshot({...c.financialSettings(),theme:'escuro'},'different'));c.syncRemoteSettings=h.server.get('alice');
 c.firebaseClient.saveSettings=async()=>{writes++;};
 await assert.rejects(c.publishFirebaseState(c.estado),e=>e.code==='sync/coordination-unavailable');
 assert.equal(writes,0);assert.notEqual(h.statuses.at(-1),'Sincronizado');
 await c.idbServico.enfileirar('alice',{id:'offline',entityKey:'offline'});assert.equal(h.queue().outbox.length,1);
});

test('another service instance cannot insert a conflict between locked authorization and SDK completion',async()=>{
 const h=await setup(),c=h.context,entered=deferred(),release=deferred();let writes=0;
 const remote=snapshot({...c.financialSettings(),theme:'escuro'},'server');h.server.set('alice',remote);c.syncRemoteSettings=remote;
 const other=new ServicoFinanceiroAtomico(h.db,validarBackup,q=>Array.isArray(q?.outbox)&&Array.isArray(q?.conflicts),c.idbServico.settingsLocks);
 c.firebaseClient.saveSettings=async(_uid,_settings,_revision,canWrite)=>{entered.resolve();await release.promise;assert.equal(canWrite(),true);writes++;return {acknowledged:true,revision:'saved'};};
 const sending=c.publishFirebaseState(c.estado);await entered.promise;
 let registered=false;const registering=other.registrarConflitoSettings('alice',{kind:'settings',local:c.financialSettings(),remote}).then(()=>{registered=true;});
 await Promise.resolve();assert.equal(registered,false);assert.equal(h.queue().conflicts.length,0);
 release.resolve();await Promise.all([sending,registering]);
 assert.equal(writes,1);assert.equal(h.queue().conflicts.length,1);assert.notEqual(h.statuses.at(-1),'Sincronizado');
 await c.publishFirebaseState(c.estado);assert.equal(writes,1);
});
test('metadata persistence failure blocks further settings sends and retains the eight conflicts',async()=>{
 const h=await setup(),c=h.context;await seedEight(h);const before=JSON.stringify(h.queue());
 c.proposal=await vm.runInContext('readSyncMeta("alice")',c);c.proposal.enabled=false;
 const alter=h.db.alterar.bind(h.db);h.db.alterar=()=>Promise.reject(new Error('synthetic quota failure'));
 await assert.rejects(vm.runInContext('writeSyncMeta("alice", proposal)',c),/quota/);h.db.alterar=alter;
 assert.equal(c.idbBloqueado,true);assert.equal(JSON.stringify(h.queue()),before);
 await assert.rejects(c.publishFirebaseState(c.estado),/bloqueada/);assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('an old record snapshot cannot start publication in a replacement session',async()=>{
 const h=await setup(),c=h.context,entered=deferred(),release=deferred();let publishes=0;
 c.onRemoteRecords=async()=>{entered.resolve();await release.promise;};c.publishFirebaseState=async()=>{publishes++;};
 const receiving=c.onRecordsSnapshot([entry()],metadata,1,'alice');await entered.promise;
 c.syncSessions.begin();c.syncUser={uid:'bob'};release.resolve();await receiving;
 assert.equal(publishes,0);
});
