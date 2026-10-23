import { settingsLocks } from './helpers/settings-locks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as sync from '../sync-core.js';
import {textoTraduzido} from '../localization.js';
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
 const c=vm.createContext({...sync,structuredClone,TextEncoder,console,textoTraduzido,validarBackup,normalizarEstado,normalizarValorMonetario,mesFinanceiroValido,
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

test('logout clears the prior account localization timestamp without changing financial state or queues',async()=>{
 const h=await setup(),c=h.context;h.installUserHandler();
 c.syncUi.last.dataset={i18nDate:'2026-10-23T12:34:56.000Z'};
 const before=structuredClone([...h.docs]);
 await c.onFirebaseUser(null);
 assert.equal(c.syncUi.last.textContent,'');
 assert.equal(c.syncUi.last.dataset.i18nDate,undefined);
 assert.deepEqual([...h.docs],before);
});

test('storage failure stops an in-flight settings publisher and cannot confirm synchronization',async()=>{
 const h=await setup(),c=h.context,readEntered=deferred(),readRelease=deferred();
 const local=c.financialSettings(),remote=snapshot({...local,theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'server-new');h.server.set('alice',remote);
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
 const h=await setup(),c=h.context,readEntered=deferred(),release=deferred(),remote=snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'server-new');
 c.firebaseClient.getSettings=async()=>{readEntered.resolve();await release.promise;return remote;};
 h.server.set('alice',remote);
 const writes=[];c.firebaseClient.saveSettings=async(uid,value,base)=>{assert.equal(base,h.server.get(uid).revision);writes.push({value,base});h.server.set(uid,snapshot(value,'revert'));return {acknowledged:true,revision:'revert'};};
 const sending=c.publishFirebaseState(c.estado);await readEntered.promise;
 await c.onRemoteSettings(remote,metadata,1);assert.equal(c.estado.tema,'claro');assert.equal(c.estado.orcamentos.padrao.Moto,100);
 release.resolve();await sending;
 assert.equal(writes.length,0);assert.equal(h.server.get('alice').theme,'escuro');assert.notEqual(h.statuses.at(-1),'Sincronizado');assert.equal(h.queue().conflicts.length,0);
 await c.onRemoteSettings(h.server.get('alice'),metadata,1);
 assert.equal(c.estado.tema,'claro');assert.equal(c.estado.orcamentos.padrao.Moto,100);assert.equal(h.queue().conflicts.length,0);
});

test('logout cancels a snapshot waiting for idbPendente before it can submit a state write',async()=>{
 const h=await setup(),c=h.context,blocked=deferred();h.installUserHandler();
 const remote=snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'server-new');c.idbPendente=blocked.promise;
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
 await c.idbServico.registrarConflitoSettings('alice',{kind:'settings',local:c.financialSettings(),remote:snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'conflict')});
 c.settingsConflictActive=true;c.firebaseClient.list=async()=>{throw new Error('synthetic network failure');};
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.queue().conflicts.length,1);assert.equal(c.settingsConflictActive,true);
});

test('account switch cancels snapshot persistence waiting on idbPendente without changing either account',async()=>{
 const h=await setup(),c=h.context,blocked=deferred(),entered=deferred();h.installUserHandler();
 const before=JSON.stringify(h.docs.get('estado:alice')),bob=JSON.stringify(h.docs.get('estado:bob'));
 c.idbPendente=blocked.promise;const persist=c.persistirEstadoFinanceiro;
 c.persistirEstadoFinanceiro=(...args)=>{entered.resolve();return persist(...args);};
 const old=c.onRemoteSettings(snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'old'),metadata,1);await entered.promise;
 const change=c.onFirebaseUser({uid:'bob'});blocked.resolve();await Promise.all([old,change]);
 assert.equal(JSON.stringify(h.docs.get('estado:alice')),before);assert.equal(JSON.stringify(h.docs.get('estado:bob')),bob);
 assert.equal(c.syncUser.uid,'bob');assert.equal(c.estado.tema,'rosa');assert.equal(c.idbBloqueado,false);
});

test('a transaction queued before invalidation rechecks the session before changing state or queue',async()=>{
 const h=await setup(),c=h.context,before=JSON.stringify([...h.docs]);
 const original=h.db.alterarDocumentos.bind(h.db);
 h.db.alterarDocumentos=(keys,fn)=>original(keys,docs=>{if(keys.includes('estado:alice'))c.syncSessions.begin();return fn(docs);});
 await c.onRemoteSettings(snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'new'),metadata,1);
 assert.equal(JSON.stringify([...h.docs]),before);assert.equal(c.idbBloqueado,false);
});

test('storage blocked during a network read prevents any subsequent settings write or visual confirmation',async()=>{
 const h=await setup(),c=h.context;let writes=0;
 c.firebaseClient.getSettings=async()=>{c.idbBloqueado=true;return snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'new');};
 c.firebaseClient.saveSettings=async()=>{writes++;return {acknowledged:true,revision:'bad'};};
 await c.publishFirebaseState(c.estado);
 assert.equal(writes,0);assert.notEqual(h.statuses.at(-1),'Sincronizado');assert.equal(h.queue().lastConfirmed,null);
});

test('a durable edit from another tab prevents publication and confirmation of the old UI state',async()=>{
 const h=await setup(),c=h.context;let writes=0;
 c.firebaseClient.getSettings=async()=>{
  const base=structuredClone(c.estado);await c.idbServico.aplicarEdicao('alice',base,{...base,tema:'rosa'});
  return snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'new');
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
 const previous=snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'previous');c.syncRemoteSettings=previous;h.server.set('alice',previous);
 c.firebaseClient.saveSettings=async(_uid,_value,_base,canWrite)=>{
  entered.resolve();await release.promise;
  if(!canWrite())throw Object.assign(new Error('stale'),{code:'sync/settings-stale'});
  writes++;return {acknowledged:true,revision:'bad'};
 };
 const sending=c.publishFirebaseState(c.estado);await entered.promise;
 const receiving=c.onRemoteSettings(snapshot({...c.financialSettings(),theme:'rosa',budgets:{padrao:{Moto:200},meses:{}}},'other-device'),metadata,1);
 release.resolve();await Promise.all([sending,receiving]);
 assert.equal(writes,0);assert.equal(h.queue().conflicts.length,1);assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('snapshot-first publication confirms the current durable state without rewriting remote settings',async()=>{
 const h=await setup(),c=h.context,remote=snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'new');h.server.set('alice',remote);let writes=0;
 c.firebaseClient.saveSettings=async()=>{writes++;throw new Error('must not rewrite');};
 await c.onRemoteSettings(remote,metadata,1);await c.publishFirebaseState(c.estado);
 assert.equal(writes,0);assert.equal(h.statuses.at(-1),'Sincronizado');assert.ok(h.queue().lastConfirmed);
});

test('a conflict requested during the SDK waits for publication and then blocks subsequent sends',async()=>{
 const h=await setup(),c=h.context,entered=deferred(),release=deferred();let writes=0;
 const remote=snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'remote');h.server.set('alice',remote);c.syncRemoteSettings=remote;
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
 h.server.set('alice',snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'different'));c.syncRemoteSettings=h.server.get('alice');
 c.firebaseClient.saveSettings=async()=>{writes++;};
 await assert.rejects(c.publishFirebaseState(c.estado),e=>e.code==='sync/coordination-unavailable');
 assert.equal(writes,0);assert.notEqual(h.statuses.at(-1),'Sincronizado');
 await c.idbServico.enfileirar('alice',{id:'offline',entityKey:'offline'});assert.equal(h.queue().outbox.length,1);
});

test('another service instance cannot insert a conflict between locked authorization and SDK completion',async()=>{
 const h=await setup(),c=h.context,entered=deferred(),release=deferred();let writes=0;
 const remote=snapshot({...c.financialSettings(),theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'server');h.server.set('alice',remote);c.syncRemoteSettings=remote;
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

for (const replacement of ['bob',null,'alice']) test('reconnection paused in remote records cannot act after session replacement: '+replacement,async()=>{
 const h=await setup(),c=h.context;h.installUserHandler();
 const local=c.financialSettings();
 h.docs.get('estado:bob').dados.tema='claro';h.docs.get('fila:bob').settingsBaseline=local;
 h.server.set('bob',snapshot(local,'bob-s0'));h.server.set('alice',snapshot({...local,theme:'escuro',budgets:{padrao:{Moto:100},meses:{}}},'alice-new'));
 const entered=deferred(),release=deferred(),original=c.onRemoteRecords;let first=true;
 c.onRemoteRecords=async(...args)=>{if(first&&c.syncUser?.uid==='alice'){first=false;entered.resolve();await release.promise;}return original(...args);};
 const writes=[];c.firebaseClient.saveSettings=async(uid,value,_base,canWrite)=>{writes.push({uid,value:structuredClone(value),allowed:canWrite()});return {acknowledged:true,revision:'saved'};};
 const old=c.onFirebaseUser({uid:'alice'});await entered.promise;
 await c.onFirebaseUser(replacement?{uid:replacement}:null);
 const before=JSON.stringify([...h.docs]),state=JSON.stringify(c.estado),writeCount=writes.length;
 release.resolve();await old;
 assert.equal(JSON.stringify([...h.docs]),before);assert.equal(JSON.stringify(c.estado),state);assert.equal(writes.length,writeCount);
 assert.equal(c.syncUser?.uid||null,replacement);
});
test('late account metadata cannot replace the next session checkbox or controls',async()=>{
 const h=await setup(),c=h.context;h.installUserHandler();h.docs.get('fila:alice').enabled=false;
 const entered=deferred(),release=deferred(),read=c.idbServico.lerFila.bind(c.idbServico);let first=true;
 c.idbServico.lerFila=async uid=>{const result=await read(uid);if(uid==='alice'&&first){first=false;entered.resolve();await release.promise;}return result;};
 const old=c.onFirebaseUser({uid:'alice'});await entered.promise;await c.onFirebaseUser({uid:'bob'});
 const before=JSON.stringify(c.syncUi),queue=JSON.stringify(h.queue('bob'));
 release.resolve();await old;assert.equal(JSON.stringify(c.syncUi),before);assert.equal(JSON.stringify(h.queue('bob')),queue);
 assert.equal(c.syncUi.enabled.checked,true);
});

for (const boundary of ['listen','listenSettings','listenConflicts']) test('obsolete initialization cannot install listeners or update controls after '+boundary,async()=>{
 const h=await setup(),c=h.context;h.installUserHandler();
 const entered=deferred(),release=deferred(),read=c.idbServico.lerFila.bind(c.idbServico);let ready=false,first=true,registrations=0;
 for(const method of ['listen','listenSettings','listenConflicts'])c.firebaseClient[method]=uid=>{registrations++;if(uid==='alice'&&method===boundary)ready=true;return ()=>{};};
 c.idbServico.lerFila=async uid=>{const result=await read(uid);if(uid==='alice'&&ready&&first){first=false;entered.resolve();await release.promise;}return result;};
 const old=c.onFirebaseUser({uid:'alice'});await entered.promise;await c.onFirebaseUser({uid:'bob'});
 const before=JSON.stringify(c.syncUi),count=registrations,docs=JSON.stringify([...h.docs]);release.resolve();await old;
 assert.equal(registrations,count);assert.equal(JSON.stringify(c.syncUi),before);assert.equal(JSON.stringify([...h.docs]),docs);
});

test('first-link state helper cannot replace the next session key or controls after persistence returns',async()=>{
 const h=await setup(),c=h.context,entered=deferred(),release=deferred();let active=true;
 vm.runInContext(source.slice(source.indexOf('async function setFinancialStateKey('),source.indexOf('function syncEntityKey(')),c);
 c.persistirEstadoFinanceiro=async()=>{entered.resolve();await release.promise;return true;};
 const pending=c.setFinancialStateKey(c.chaveEstadoAtual,c.estado,()=>active);await entered.promise;
 active=false;c.chaveEstadoAtual=sync.chaveLocalConta('bob');c.estado=structuredClone(h.docs.get('estado:bob').dados);c.idbBase=structuredClone(c.estado);
 const before=JSON.stringify(c.estado);release.resolve();assert.equal(await pending,false);
 assert.equal(c.chaveEstadoAtual,sync.chaveLocalConta('bob'));assert.equal(JSON.stringify(c.estado),before);
});

// These cases use the production reconnect/persistence functions and atomic service.
function installFirstLink(h) {
 const c=h.context;h.installUserHandler();
 c.lerEstadoPersistido=()=>({estado:'ausente'});
 c.storage={lerJsonResultado:()=>({estado:'ausente'})};
 const backups=new Map();c.localStorage={getItem:k=>backups.get(k)??null,setItem:(k,v)=>backups.set(k,v)};
 h.prompts=[];c.confirm=message=>{h.prompts.push(message);return true;};
 c.firebaseClient.list=async()=>[];c.syncRemoteRecords=[];
 vm.runInContext(source.slice(source.indexOf('async function setFinancialStateKey('),source.indexOf('function syncEntityKey(')),c);
}
async function emptyAccount(h,{fresh=false,pristine=false}={}) {
 const c=h.context,device=normalizarEstado(null);device.tema='rosa';
 h.docs.get('estado:@local').dados=device;
 h.docs.get('fila:@local').settingsPristine=pristine;
 if(fresh){h.docs.delete('estado:alice');h.docs.delete('fila:alice');}
 else {h.docs.get('estado:alice').dados={...structuredClone(device),categorias:['Casa','Moto','Serasa']};h.docs.get('fila:alice').initialized=false;}
}
test('theme-only remote changes preserve the device preference, create no conflict and permit financial confirmation',async()=>{
 const h=await setup(),c=h.context,remote=snapshot({...c.financialSettings(),theme:'escuro'},'theme-only');h.server.set('alice',remote);
 let writes=0;c.firebaseClient.saveSettings=async()=>{writes++;throw Error('unnecessary remote write');};
 await c.onRemoteSettings(remote,metadata,1);await c.publishFirebaseState(c.estado);
 assert.equal(c.estado.tema,'claro');assert.equal(h.queue().conflicts.length,0);assert.equal(writes,0);assert.equal(h.statuses.at(-1),'Sincronizado');
});
test('proven fresh first link adopts remote categories and budgets while preserving device theme',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h,{fresh:true,pristine:true});installFirstLink(h);
 const remote=snapshot({...c.financialSettings(),budgets:{padrao:{Moto:75},meses:{}},theme:'escuro'},'remote');h.server.set('alice',remote);
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,1);assert.equal(h.queue().conflicts.length,0);assert.equal(h.queue().firstLinkReviewed,true);assert.equal(h.queue().initialized,true);
 assert.deepEqual(c.estado.categorias,['Casa','Moto','Serasa']);assert.equal(c.estado.orcamentos.padrao.Moto,75);assert.equal(c.estado.tema,'rosa');
});
test('personalized account settings without records survive first link even when no legacy key exists',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h);installFirstLink(h);
 h.docs.get('estado:alice').dados.orcamentos.padrao.Moto=125;
 h.server.set('alice',snapshot({...c.financialSettings(),categories:['Casa']},'different'));
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,2);assert.equal(h.queue().conflicts.length,1);assert.equal(c.estado.orcamentos.padrao.Moto,125);
 assert.deepEqual(c.estado.categorias,['Casa','Moto','Serasa']);assert.equal(sync.registrosFinanceiros(c.estado).length,0);
});
test('anonymous IndexedDB personalization without records is not mistaken for a fresh installation',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h,{fresh:true});installFirstLink(h);
 h.docs.get('estado:@local').dados.categorias.push('Moto','Serasa');
 h.docs.get('estado:@local').dados.orcamentos.padrao.Moto=90;
 h.server.set('alice',snapshot({...c.financialSettings(),categories:['Casa']},'remote'));
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,2);assert.equal(h.queue().conflicts.length,1);assert.ok(c.estado.categorias.includes('Moto'));assert.ok(c.estado.categorias.includes('Serasa'));assert.equal(c.estado.orcamentos.padrao.Moto,90);
});
test('reviewed first link resumes after network failure without repeating choices or losing pending operations',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h);installFirstLink(h);
 const remote=snapshot({...c.financialSettings(),categories:['Casa']},'remote');h.server.set('alice',remote);
 let reads=0;c.firebaseClient.getSettings=async()=>{if(++reads===2)throw Error('synthetic offline after durable review');return remote;};
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.queue().firstLinkReviewed,true);assert.equal(h.queue().initialized,false);const conflict=JSON.stringify(h.queue().conflicts),prompts=h.prompts.length;
 await c.idbServico.enfileirar('alice',{id:'offline-extra',entityKey:'offline-extra',value:{}});
 c.firebaseClient.commit=async()=>{throw Error('offline retains pending operation');};c.firebaseClient.getSettings=async()=>remote;
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,prompts);assert.equal(JSON.stringify(h.queue().conflicts),conflict);assert.equal(h.queue().outbox.some(o=>o.id==='offline-extra'),true);assert.ok(c.estado.categorias.includes('Moto'));
});
test('an equivalent preexisting conflict is preserved and is not presented as a new settings decision',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h);installFirstLink(h);
 const local=c.financialSettings(h.docs.get('estado:alice').dados),remote=snapshot({...local,categories:['Casa']},'remote');h.server.set('alice',remote);
 const conflicts=Array.from({length:8},(_,i)=>({kind:'settings',local,remote:{...remote,revision:String(i)}}));h.docs.get('fila:alice').conflicts=conflicts;
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,1);assert.equal(JSON.stringify(h.queue().conflicts),JSON.stringify(conflicts));assert.equal(c.estado.tema,'rosa');
});

test('critical edits revoke pristine evidence atomically; theme changes do not revoke it',async()=>{
 const h=await setup(),c=h.context,base=structuredClone(h.docs.get('estado:@local').dados);
 h.docs.get('fila:@local').settingsPristine=true;
 await c.idbServico.aplicarEdicao('@local',base,{...base,tema:'rosa'});
 assert.equal(h.queue('@local').settingsPristine,true);
 const changed={...base,tema:'rosa',orcamentos:{padrao:{Moto:25},meses:{}}};
 await c.idbServico.aplicarEdicao('@local',{...base,tema:'rosa'},changed);
 assert.equal(h.queue('@local').settingsPristine,false);assert.equal(h.docs.get('estado:@local').dados.orcamentos.padrao.Moto,25);
});
test('local critical edit during first-link remote reading becomes account-owned and is preserved',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h,{fresh:true,pristine:true});installFirstLink(h);
 const read=c.firebaseClient.getSettings;let once=true;
 c.firebaseClient.getSettings=async uid=>{
  if(once){once=false;const base=structuredClone(c.estado),next={...base,categorias:[...base.categorias,'Moto','Serasa'],orcamentos:{padrao:{Moto:321},meses:{}}};
   assert.equal(await c.persistirEstadoFinanceiro(c.chaveEstadoAtual,next,true),true);c.estado=structuredClone(c.idbBase);
  }
  return read(uid);
 };
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.queue().firstLinkSource,'account');assert.equal(h.queue().conflicts.length,1);assert.equal(c.estado.orcamentos.padrao.Moto,321);assert.ok(c.estado.categorias.includes('Serasa'));
});
test('first-link staging uses the committed merge, preserving a concurrent inclusion instead of staging its deletion',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h);installFirstLink(h);
 const original=c.idbServico.aplicarEdicao.bind(c.idbServico);let once=true;
 c.idbServico.aplicarEdicao=async(uid,base,next,...args)=>{
  if(uid==='alice'&&once){once=false;const concurrent=structuredClone(base);concurrent.meses['2026-10']={receitas:[{id:'concurrent',nome:'Preserved',valor:17}],despesas:[]};await original(uid,base,concurrent);}
  return original(uid,base,next,...args);
 };
 await c.onFirebaseUser({uid:'alice'});
 const records=sync.registrosFinanceiros(h.docs.get('estado:alice').dados);assert.equal(records.some(r=>r.id==='concurrent'&&r.record.valor===17),true);
 assert.equal(h.queue().outbox.some(op=>op.value?.id==='concurrent'&&op.value.deleted),false);
});

test('account replacement while the first-link transaction is pending cancels its checkpoint and preserves both accounts',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h);installFirstLink(h);
 h.server.set('alice',snapshot({...c.financialSettings(),categories:['Casa']},'remote'));
 const original=c.idbServico.aplicarEdicao.bind(c.idbServico),entered=deferred(),release=deferred();let first=true;
 c.idbServico.aplicarEdicao=async(uid,...args)=>{if(uid==='alice'&&first){first=false;entered.resolve();await release.promise;}return original(uid,...args);};
 const old=c.onFirebaseUser({uid:'alice'});await entered.promise;
 assert.equal(h.queue().firstLinkReviewed,undefined);const conflict=JSON.stringify(h.queue().conflicts);
 await c.onFirebaseUser({uid:'bob'});const bob=JSON.stringify([h.docs.get('estado:bob'),h.docs.get('fila:bob')]);
 release.resolve();await old;
 assert.equal(JSON.stringify([h.docs.get('estado:bob'),h.docs.get('fila:bob')]),bob);assert.equal(JSON.stringify(h.queue('alice').conflicts),conflict);
 assert.equal(h.queue('alice').firstLinkReviewed,undefined);assert.equal(c.syncUser.uid,'bob');
});

test('a first-link checkpoint from another tab observed during reads prevents a repeated decision',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h,{fresh:true,pristine:true});installFirstLink(h);
 const read=h.db.ler.bind(h.db);let once=true;
 h.db.ler=async key=>{const result=await read(key);if(key==='fila:@local'&&once){once=false;await c.idbServico.alterarFila('alice',q=>({...q,firstLinkReviewed:true}));}return result;};
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,0);assert.equal(h.queue().firstLinkReviewed,true);assert.equal(h.queue().conflicts.length,0);
});

test('default-looking settings without pristine evidence still require an explicit critical decision',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h,{fresh:true,pristine:false});installFirstLink(h);
 h.server.set('alice',snapshot({...c.financialSettings(),categories:['Casa']},'remote'));
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,2);assert.equal(h.queue().conflicts.length,1);
});
test('theme-only first-link difference does not display a settings decision',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h);installFirstLink(h);
 const local=c.financialSettings(h.docs.get('estado:alice').dados);h.server.set('alice',snapshot({...local,theme:'escuro'},'remote'));
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,1);assert.equal(h.queue().conflicts.length,0);assert.equal(c.estado.tema,'rosa');
});
test('choosing cloud critical settings preserves local records, device theme and the unresolved original pair',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h);installFirstLink(h);
 const state=h.docs.get('estado:alice').dados;state.meses['2026-10']={receitas:[{id:'local-keep',nome:'Kept',valor:123}],despesas:[]};
 c.confirm=message=>{h.prompts.push(message);return h.prompts.length===1;};
 const remote=snapshot({...c.financialSettings(),categories:['Casa'],theme:'escuro',budgets:{padrao:{Casa:55},meses:{}}},'remote');h.server.set('alice',remote);
 await c.onFirebaseUser({uid:'alice'});
 assert.deepEqual(c.estado.categorias,['Casa']);assert.equal(c.estado.orcamentos.padrao.Casa,55);assert.equal(c.estado.tema,'rosa');
 assert.equal(sync.registrosFinanceiros(c.estado).some(r=>r.id==='local-keep'&&r.record.valor===123),true);
 assert.equal(h.queue().conflicts.length,1);assert.ok(h.queue().conflicts[0].local.categories.includes('Moto'));assert.ok(h.queue().conflicts[0].local.categories.includes('Serasa'));
});

test('a theme selected while first-link network reading is pending remains on the device',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h,{fresh:true,pristine:true});installFirstLink(h);
 const read=c.firebaseClient.getSettings;let once=true;
 c.firebaseClient.getSettings=async uid=>{if(once){once=false;const next={...structuredClone(c.estado),tema:'floresta'};assert.equal(await c.persistirEstadoFinanceiro(c.chaveEstadoAtual,next,true),true);c.estado=structuredClone(c.idbBase);}return read(uid);};
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(c.estado.tema,'floresta');assert.equal(h.queue().conflicts.length,0);assert.equal(h.prompts.length,1);
});

test('a stale pristine flag cannot authorize replacing personalized categories or budgets',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h,{fresh:true,pristine:true});installFirstLink(h);
 const anonymous=h.docs.get('estado:@local').dados;anonymous.categorias.push('Moto','Serasa');anonymous.orcamentos.padrao.Moto=777;
 h.server.set('alice',snapshot({...c.financialSettings(),categories:['Casa']},'remote'));
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(h.prompts.length,2);assert.equal(c.estado.orcamentos.padrao.Moto,777);assert.ok(c.estado.categorias.includes('Serasa'));assert.equal(h.queue().conflicts.length,1);
});

test('a stale anonymous source marker cannot discard personalized durable account settings',async()=>{
 const h=await setup(),c=h.context;await emptyAccount(h);installFirstLink(h);
 h.docs.get('fila:alice').firstLinkSource='anonymous';h.docs.get('fila:@local').settingsPristine=true;
 h.docs.get('estado:alice').dados.orcamentos.padrao.Moto=888;
 h.server.set('alice',snapshot({...c.financialSettings(),categories:['Casa']},'remote'));
 await c.onFirebaseUser({uid:'alice'});
 assert.equal(c.estado.orcamentos.padrao.Moto,888);assert.ok(c.estado.categorias.includes('Serasa'));assert.equal(h.prompts.length,2);assert.equal(h.queue().conflicts.length,1);
});


test('offline cloud decision is durable, groups eight copies, resumes and preserves originals and unrelated operations', async()=>{
 const h=await setup(),c=h.context;installResolution(c);
 const local=c.financialSettings(),remote=snapshot({...local,categories:['Casa']},'remote-review');h.server.set('alice',remote);
 const originals=Array.from({length:8},(_,i)=>({kind:'settings',local,remote:{...remote,revision:'review-'+i}}));
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts:structuredClone(originals),outbox:[{id:'unrelated',entityKey:'unrelated'}]}));
 const bob=JSON.stringify(h.docs.get('estado:bob'));c.navigator.onLine=false;
 await c.resolveSyncConflict(0,'remote');
 assert.equal(h.queue().conflictDecisions.length,1);assert.equal(h.queue().conflictDecisions[0].status,'pending');
 assert.equal(JSON.stringify(h.queue().conflicts),JSON.stringify(originals));assert.equal(h.statuses.at(-1),'Aguardando sincroniza\u00e7\u00e3o');
 assert.deepEqual(c.estado.categorias,['Casa']);assert.equal(h.queue().outbox[0].id,'unrelated');
 // Simulate restarting application memory: only the durable journal supplies the choice.
 c.estado=structuredClone(h.docs.get('estado:alice').dados);c.idbBase=structuredClone(c.estado);c.navigator.onLine=true;
 await c.publishFirebaseState(c.estado);
 assert.equal(h.queue().conflicts.length,0);assert.equal(h.queue().conflictHistory.length,8);
 assert.equal(JSON.stringify(h.queue().conflictHistory.map(item=>item.conflict)),JSON.stringify(originals));
 assert.equal(h.queue().conflictDecisions[0].status,'confirmed');assert.equal(h.queue().outbox[0].id,'unrelated');
 assert.equal(JSON.stringify(h.docs.get('estado:bob')),bob);assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('local settings decision survives a network failure and retries against its reviewed revision', async()=>{
 const h=await setup(),c=h.context;installResolution(c);
 const local=c.financialSettings(),remote=snapshot({...local,categories:['Casa']},'review');h.server.set('alice',remote);
 const conflict={kind:'settings',local,remote};await c.idbServico.alterarFila('alice',q=>({...q,conflicts:[conflict]}));
 c.firebaseClient.saveSettings=async()=>{throw Error('synthetic network failure');};
 await c.resolveSyncConflict(0,'local');
 assert.equal(h.queue().conflictDecisions[0].status,'failed');assert.equal(JSON.stringify(h.queue().conflicts),JSON.stringify([conflict]));
 assert.equal(h.queue().conflictHistory,undefined);assert.notEqual(h.statuses.at(-1),'Sincronizado');
 const writes=[];c.firebaseClient.saveSettings=async(uid,value,revision)=>{writes.push(revision);h.server.set(uid,snapshot(value,'confirmed'));return {acknowledged:true,revision:'confirmed'};};
 await c.publishFirebaseState(c.estado);
 assert.deepEqual(writes,['review']);assert.equal(h.queue().conflicts.length,0);assert.equal(h.queue().conflictHistory.length,1);
 assert.ok(c.estado.categorias.includes('Moto'));assert.ok(c.estado.categorias.includes('Serasa'));
 await c.onRemoteSettings(h.server.get('alice'),metadata);assert.equal(h.queue().conflicts.length,0);
});

test('cloud choice remains pending if server changed again, without a false remote confirmation', async()=>{
 const h=await setup(),c=h.context;installResolution(c);const local=c.financialSettings();
 const conflict={kind:'settings',local,remote:snapshot({...local,categories:['Casa']},'review')};
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts:[conflict]}));
 h.server.set('alice',snapshot({...local,categories:['Moto']},'later'));
 await c.resolveSyncConflict(0,'remote');assert.equal(h.queue().conflicts.length,1);assert.equal(h.queue().conflictDecisions[0].status,'pending');
 assert.equal(h.queue().conflictHistory,undefined);assert.notEqual(h.statuses.at(-1),'Sincronizado');
});

test('a concurrent durable edit prevents archiving a decision whose server read just completed', async()=>{
 const h=await setup(),c=h.context;installResolution(c);const local=c.financialSettings(),remote=snapshot({...local,categories:['Casa']},'review');
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts:[{kind:'settings',local,remote}]}));
 const entered=deferred(),release=deferred();c.firebaseClient.getSettings=async()=>{entered.resolve();await release.promise;return remote;};
 const resolving=c.resolveSyncConflict(0,'remote');await entered.promise;
 const base=structuredClone(h.docs.get('estado:alice').dados),next=structuredClone(base);next.categorias.push('Serasa');
 await c.idbServico.aplicarEdicao('alice',base,next);release.resolve();await resolving;
 assert.equal(h.queue().conflicts.length,1);assert.equal(h.queue().conflictHistory,undefined);assert.ok(h.docs.get('estado:alice').dados.categorias.includes('Serasa'));
});

test('conflict UI groups equivalent copies, hides technical JSON by default and separates pending decisions from uploads',async()=>{
 const h=await setup(),c=h.context;installResolution(c);const local=c.financialSettings(),remote=snapshot({...local,categories:['Casa']},'review');
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts:[{kind:'settings',local,remote},{kind:'settings',local,remote:{...remote,revision:'duplicate'}}]}));
 const element=tag=>({tag,children:[],append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},setAttribute(){},addEventListener(){}});
 c.document={createElement:element};c.syncUi.conflictList=element('list');c.syncUi.conflicts={};c.valoresOcultos=false;
 vm.runInContext(source.slice(source.indexOf('async function renderSyncConflicts('),source.indexOf('async function resolveSyncConflict(')),c);
 await c.renderSyncConflicts();let rows=c.syncUi.conflictList.children;assert.equal(rows.length,1);assert.equal(rows[0].children[3].children.length,2);
 assert.equal(rows[0].children[2].tag,'details');assert.equal(rows[0].children[2].open,undefined);
 assert.match(rows[0].children[1].children[0].children[1].textContent,/Moto.*Serasa/);
 c.navigator.onLine=false;await c.resolveSyncConflict(0,'local');await c.renderSyncConflicts();rows=c.syncUi.conflictList.children;
 assert.match(rows[0].children[0].textContent,/Aguardando/);assert.equal(rows[0].children[3].children.length,1);
});


test('explicit cloud record decision archives superseded unattempted operations but preserves unrelated pending work',async()=>{
 const h=await setup(),c=h.context;installResolution(c);const local=entry(),remote={...entry(),revision:'new',record:{...entry().record,valor:20}};
 const operation=sync.makeOperation(sync.recordEntityKey(local),{month:local.month,type:local.type,id:local.id,record:local.record,deleted:false},'record-a');
 const conflict={kind:'concurrent-change',operation,remote};
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts:[conflict],outbox:[operation,{id:'unrelated',entityKey:'unrelated'}]}));
 c.navigator.onLine=false;await c.resolveSyncConflict(0,'remote');
 assert.equal(h.queue().outbox.length,1);assert.equal(h.queue().outbox[0].id,'unrelated');
 assert.equal(JSON.stringify(h.queue().conflictDecisions[0].supersededOperations),JSON.stringify([operation]));
 assert.equal(h.docs.get('estado:alice').dados.meses['2026-10'].receitas[0].valor,20);
 c.navigator.onLine=true;c.firebaseClient.list=async()=>[remote];await c.publishFirebaseState(c.estado);
 assert.equal(h.queue().conflicts.length,0);assert.equal(h.queue().conflictHistory.length,1);assert.equal(h.queue().outbox[0].id,'unrelated');
});

test('a decision cannot cancel an operation already in flight or change an account while awaiting its lock',async()=>{
 const h=await setup(),c=h.context;installResolution(c);const local=entry(),operation=sync.makeOperation(sync.recordEntityKey(local),{month:local.month,type:local.type,id:local.id,record:local.record,deleted:false},'record-a');
 const conflict={kind:'concurrent-change',operation,remote:{...local,revision:'remote',record:{...local.record,valor:20}}};
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts:[conflict],outbox:[operation],attempted:{[operation.id]:true}}));
 const before=JSON.stringify([...h.docs]);await c.resolveSyncConflict(0,'remote');
 assert.equal(JSON.stringify([...h.docs]),before);assert.equal(c.idbBloqueado,false);assert.equal(h.queue().conflictDecisions,undefined);
});


test('concurrent opposite decisions serialize, preserve one durable choice and never block storage',async()=>{
 const h=await setup(),c=h.context;installResolution(c);const local=c.financialSettings(),remote=snapshot({...local,categories:['Casa']},'review');
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts:[{kind:'settings',local,remote}]}));c.navigator.onLine=false;
 await Promise.all([c.resolveSyncConflict(0,'local'),c.resolveSyncConflict(0,'remote')]);
 assert.equal(h.queue().conflictDecisions.length,1);assert.equal(h.queue().conflictDecisions[0].choice,'local');
 assert.ok(h.docs.get('estado:alice').dados.categorias.includes('Moto'));assert.equal(c.idbBloqueado,false);assert.equal(h.queue().conflicts.length,1);
});


test('a pending settings choice does not discard financial edits made before reconnection',async()=>{
 const h=await setup(),c=h.context;installResolution(c);const local=c.financialSettings(),remote=snapshot({...local,categories:['Casa']},'review');
 await c.idbServico.alterarFila('alice',q=>({...q,conflicts:[{kind:'settings',local,remote}]}));c.navigator.onLine=false;
 await c.resolveSyncConflict(0,'local');
 const base=structuredClone(c.estado),next=structuredClone(base);next.meses['2026-10'].receitas.push({id:'new-pending',nome:'Preserved',valor:25});
 const record={month:'2026-10',type:'receitas',id:'new-pending',record:next.meses['2026-10'].receitas[1],deleted:false};
 const operation=sync.makeOperation(sync.recordEntityKey(record),record,null);
 await c.idbServico.aplicarEdicao('alice',base,next,()=>[operation]);c.estado=structuredClone(next);c.idbBase=structuredClone(next);
 c.navigator.onLine=true;c.firebaseClient.list=async()=>[entry(),{...record,revision:'already-remote',updatedAt:{seconds:10,nanoseconds:0},_docId:sync.recordEntityKey(record)}];
 c.firebaseClient.saveSettings=async(uid,value)=>{h.server.set(uid,snapshot(value,'done'));return {acknowledged:true,revision:'done'};};
 await c.publishFirebaseState(c.estado);
 assert.equal(h.docs.get('estado:alice').dados.meses['2026-10'].receitas.find(item=>item.id==='new-pending').valor,25);
 assert.equal(h.queue().conflictDecisions[0].status,'confirmed');assert.ok(c.estado.categorias.includes('Moto'));assert.ok(c.estado.categorias.includes('Serasa'));
});
