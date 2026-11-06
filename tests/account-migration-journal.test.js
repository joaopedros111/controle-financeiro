import { Timestamp } from 'firebase/firestore';
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { realContractClient } from './fixtures/vault-real-client.mjs';
import { makeOperation } from '../sync-core.js';
import { normalizarEstado, validarBackup } from '../finance-core.js';
import { assertAccountAccess, ACCOUNT_ACCESS_KEY } from '../account-data-policy.js';
import { prepararImportacaoAnonima, registrarConsentimentoMigracao, retomarImportacaoAnonima, reconciliarImportacaoAnonima } from '../account-local-migration.js';
import { recordEntityKey } from '../sync-core.js';
import { financeSettings } from '../automatic-sync-policy.js';
const uid='synthetic-durable-owner', clone=structuredClone;
function harness() {
    const source=normalizarEstado({meses:{'2026-11':{receitas:[{id:'synthetic-durable-row',nome:'Synthetic migration',valor:21}],despesas:[]}}});
    const docs=new Map([[ACCOUNT_ACCESS_KEY,{version:1,epoch:3,uid,closing:false,revoked:[]}],['estado:@local',{revisao:7,dados:source}],['fila:@local',{outbox:[],conflicts:[]}],[`estado:${uid}`,{revisao:0,dados:normalizarEstado({})}],[`fila:${uid}`,{outbox:[],conflicts:[],generation:'legacy'}]]);
    let active=true, serial=Promise.resolve();
    const db={alterar(key,fn){return this.alterarDocumentos([key],docs=>{docs.set(key,fn(docs.get(key)));return docs;}).then(docs=>docs.get(key));},ler:async key=>clone(docs.get(key)??null),requerConta:true,acessoConta:{uid,epoch:3},lerDocumentos:async keys=>new Map(keys.map(k=>[k,clone(docs.get(k)??null)])),
        alterarComLeituras(keys,reads,fn){ const task=serial.then(()=>{assert.ok(keys.every(k=>!k.endsWith(':@local')));assertAccountAccess(docs.get(ACCOUNT_ACCESS_KEY),this.acessoConta,keys);const result=fn(new Map(keys.map(k=>[k,clone(docs.get(k)??null)])),new Map(reads.map(k=>[k,clone(docs.get(k)??null)])));assert.equal(result.size,keys.length);for(const k of keys)docs.set(k,clone(result.get(k)));return clone(result);});serial=task.catch(()=>{});return task;},
        alterarDocumentos(keys,fn){return this.alterarComLeituras(keys,[],fn);}};
    let remote={uid,generation:'legacy',protocol:1,metadata:{fromCache:false,hasPendingWrites:false},records:[],settings:null,conflicts:[]};
    const options={db,storage:{getItem:()=>null},uid,isCurrent:()=>active,online:true,snapshotReader:async()=>clone(remote)};
    return {docs,db,options,source,setRemote:value=>{remote=value;},remote:()=>clone(remote),logout(){active=false;docs.get(ACCOUNT_ACCESS_KEY).epoch++;},sourceJSON:()=>JSON.stringify([docs.get('estado:@local'),docs.get('fila:@local')])};
}
async function prepare(h){const review=await prepararImportacaoAnonima(h.options);assert.deepEqual(review.blockers,[]);assert.equal(review.importAllowed,true);return review;}
async function consent(h,review){return registrarConsentimentoMigracao({review,consent:true,ownershipAcknowledged:true,isCurrent:h.options.isCurrent});}
const resume=(h,key)=>retomarImportacaoAnonima({...h.options,journalKey:key});
test('durable journal survives interruption before apply; source remains byte-equivalent',async()=>{const h=harness(),original=h.sourceJSON(),review=await prepare(h),key=await consent(h,review);assert.equal(h.docs.get(key).state,'prepared');assert.equal(h.docs.get(`fila:${uid}`).outbox.length,0);await resume(h,key);assert.equal(h.docs.get(key).state,'applied');assert.equal(h.docs.get(`fila:${uid}`).outbox.length,1);assert.equal(h.sourceJSON(),original);});
test('explicit review and ownership consent cannot be forged or omitted',async()=>{const h=harness(),review=await prepare(h);for(const args of [{review,consent:false,ownershipAcknowledged:true},{review,consent:true,ownershipAcknowledged:false},{review:{...review},consent:true,ownershipAcknowledged:true}])await assert.rejects(registrarConsentimentoMigracao({...args,isCurrent:()=>true}),{code:'migration/consent-required'});});
test('repeated and competing tab applications enqueue once',async()=>{const h=harness(),key=await consent(h,await prepare(h));const outcomes=await Promise.allSettled([resume(h,key),resume(h,key)]);assert.ok(outcomes.every(x=>x.status==='fulfilled'), JSON.stringify(outcomes));assert.equal(h.docs.get(`fila:${uid}`).outbox.length,1);await resume(h,key);assert.equal(h.docs.get(`estado:${uid}`).revisao,1);});
test('unknown commit outcome retry never overwrites later account edits',async()=>{const h=harness(),key=await consent(h,await prepare(h));await resume(h,key);h.docs.get(`estado:${uid}`).revisao=4;h.docs.get(`estado:${uid}`).dados.meses['2026-11'].receitas[0].nome='Later edit';await resume(h,key);assert.equal(h.docs.get(`estado:${uid}`).revisao,4);assert.equal(h.docs.get(`estado:${uid}`).dados.meses['2026-11'].receitas[0].nome,'Later edit');});
for(const target of ['source','revision','queue','generation','logout','uid','remote'])test(`interruption rejects changed ${target} without partial application`,async()=>{const h=harness(),key=await consent(h,await prepare(h));if(target==='source')h.docs.get('estado:@local').revisao++;if(target==='revision')h.docs.get(`estado:${uid}`).revisao++;if(target==='queue')h.docs.get(`fila:${uid}`).outbox.push({id:'concurrent-intent'});if(target==='generation')h.docs.get(`fila:${uid}`).generation='another-generation';if(target==='logout')h.logout();if(target==='uid')h.docs.get(ACCOUNT_ACCESS_KEY).uid='synthetic-another-owner';if(target==='remote')h.setRemote({...h.remote(),generation:'new-remote-generation'});const before=JSON.stringify([...h.docs]);await assert.rejects(resume(h,key));assert.equal(JSON.stringify([...h.docs]),before);assert.equal(h.docs.get(key).state,'prepared');});
test('ACK lost cannot confirm; exact remote revision plus durable ACK can reconcile',async()=>{const h=harness(),key=await consent(h,await prepare(h));await resume(h,key);await assert.rejects(reconciliarImportacaoAnonima({...h.options,journalKey:key}),{code:'migration/ack-required'});const op=h.docs.get(`fila:${uid}`).outbox[0];h.setRemote({...h.remote(),records:[{...op.value,_docId:op.entityKey,revision:op.id,updatedAt:{seconds:1,nanoseconds:0}}],settings:{...financeSettings(h.source),revision:'synthetic-settings',updatedAt:{seconds:1,nanoseconds:0}}});const q=h.docs.get(`fila:${uid}`);q.outbox=[];q.automaticSettingsDirty=false;q.confirmedRevision=h.docs.get(`estado:${uid}`).revisao;q.confirmedGeneration='legacy';q.lastConfirmed=new Date().toISOString();await reconciliarImportacaoAnonima({...h.options,journalKey:key});assert.equal(h.docs.get(key).state,'confirmed');assert.equal(q.outbox.length,0);assert.ok(h.docs.has('estado:@local'));assert.deepEqual(h.docs.get(`fila:${uid}`).recoveryKeys,[]);});
test('remote tombstones and preexisting rows block import rather than overwrite',async()=>{for(const deleted of [true,false]){const h=harness();h.setRemote({...h.remote(),records:[{_docId:recordEntityKey({month:'2026-11',type:'receitas',id:'synthetic-existing'}),month:'2026-11',type:'receitas',id:'synthetic-existing',deleted,...(!deleted?{record:{id:'synthetic-existing',nome:'Remote',valor:8}}:{}),revision:'existing',updatedAt:{seconds:1,nanoseconds:0}}]});const report=await prepararImportacaoAnonima(h.options);assert.equal(report.importAllowed,false);assert.ok(report.blockers.some(x=>x.code==='empty-confirmed-target-required'));}});
test('unresolved anonymous outbox and additional localStorage source remain blocked',async()=>{const h=harness();h.docs.get('fila:@local').outbox.push({id:'pending'});assert.equal((await prepararImportacaoAnonima(h.options)).importAllowed,false);const other=harness();other.options.storage={getItem:key=>key==='controleFinanceiro:v3'?JSON.stringify(other.source):null};assert.equal((await prepararImportacaoAnonima(other.options)).importAllowed,false);});
function synchronizer(h, client) {
    const service=new ServicoFinanceiroAtomico(h.db,validarBackup,()=>true,{request:(_name,fn)=>fn()});
    return new AutomaticFinanceSync({client,db:h.db,service,readLegacy:()=>({estado:'ausente'}),readLegacyMetadata:()=>({}),onAccount(){},onState(){},onStatus(){},connectivity:{navigator:{onLine:true}}});
}
for(const deleted of [false,true])test(`concurrent remote ${deleted?'tombstone':'creation'} after local import is never overwritten or resurrected`,async t=>{
    const h=harness(),owner={uid,projectId:'demo-journal-contract'},remote=realContractClient(owner);h.options.snapshotReader=uid=>remote.client.localMigrationSnapshot(uid);
    const key=await consent(h,await prepare(h));await resume(h,key);const op=h.docs.get(`fila:${uid}`).outbox[0];
    const value=deleted?{month:op.value.month,type:op.value.type,id:op.value.id,deleted:true}:{...op.value,record:{...op.value.record,nome:'Remote winner'}};
    const winner=makeOperation(op.entityKey,value,null);await remote.client.commit(uid,winner);
    const sync=synchronizer(h,remote.client);t.after(()=>sync.stop());await sync.useAccount({uid});clearTimeout(sync.session.timer);
    for(let i=0;i<3;i++)await sync.cycle(sync.session);
    const rows=await remote.client.list(uid);assert.equal(rows.length,1);assert.equal(rows[0].revision,winner.id);assert.equal(rows[0].deleted,deleted);
    assert.equal(h.docs.get(key).state,'applied');assert.ok(h.docs.get(`fila:${uid}`).automaticHistory.length);
    await assert.rejects(reconciliarImportacaoAnonima({...h.options,journalKey:key}),{code:'migration/ack-required'});
});
test('lost real-contract ACK preserves durable operations and retry uses the same ID',async t=>{
    const h=harness(),owner={uid,projectId:'demo-journal-lost-ack'},remote=realContractClient(owner);h.options.snapshotReader=uid=>remote.client.localMigrationSnapshot(uid);
    const key=await consent(h,await prepare(h));await resume(h,key);const id=h.docs.get(`fila:${uid}`).outbox[0].id;
    let sync=synchronizer(h,remote.client);await sync.useAccount({uid});clearTimeout(sync.session.timer);remote.remote.loseNextAck();await sync.cycle(sync.session).catch(()=>{});
    assert.equal(h.docs.get(`fila:${uid}`).outbox[0].id,id);assert.equal(h.docs.get(key).state,'applied');sync.stop();
    sync=synchronizer(h,remote.client);t.after(()=>sync.stop());await sync.useAccount({uid});clearTimeout(sync.session.timer);for(let i=0;i<3;i++)await sync.cycle(sync.session);
    assert.equal((await remote.client.list(uid))[0].revision,id);assert.equal(h.docs.get(`fila:${uid}`).outbox.length,0);
    await reconciliarImportacaoAnonima({...h.options,journalKey:key});assert.equal(h.docs.get(key).state,'confirmed');
});
test('unknown anonymous queue metadata and corrupt durable plan stay blocked',async()=>{
    const h=harness();h.docs.get('fila:@local').unrecognizedTombstones=['synthetic-durable-row'];const report=await prepararImportacaoAnonima(h.options);assert.equal(report.importAllowed,false);assert.ok(report.blockers.some(x=>x.code==='anonymous-queue-metadata-requires-review'));
    const clean=harness(),key=await consent(clean,await prepare(clean));clean.docs.get(key).operations[0].baseRevision='forged-revision';const before=JSON.stringify([...clean.docs]);await assert.rejects(resume(clean,key),{code:'migration/journal-invalid'});assert.equal(JSON.stringify([...clean.docs]),before);
});
test('untracked account settings or historical revisions cannot be replaced by anonymous data',async()=>{
    for(const type of ['settings','revisions','negative-revision']){const h=harness();if(type==='settings')h.docs.get(`estado:${uid}`).dados.orcamentos.padrao['Outros']=400;else if(type==='revisions')h.docs.get(`fila:${uid}`).remoteRevisions={deletedHistoricalId:'old-revision'};else h.docs.get(`estado:${uid}`).revisao=-1;const before=JSON.stringify([...h.docs]);const report=await prepararImportacaoAnonima(h.options);assert.equal(report.importAllowed,false);assert.ok(report.blockers.some(x=>x.code===(type==='negative-revision'?'empty-confirmed-target-required':'local-settings-or-revisions-unconfirmed')));assert.equal(JSON.stringify([...h.docs]),before);}
});


test('durable migration revalidates real SDK settings with read-time Timestamp changes after IndexedDB clone', async () => {
    const h = harness(), remote = h.remote();
    remote.settings = { ...financeSettings(normalizarEstado({})), revision: 'synthetic-stable-settings', updatedAt: new Timestamp(123, 456) };
    let readTime = 456; h.options.snapshotReader = async () => ({ ...remote, settings: { ...remote.settings, updatedAt: new Timestamp(123, readTime++) } });
    const review = await prepare(h), key = await consent(h, review);
    await resume(h, key); assert.equal(h.docs.get(key).state, 'applied');
    assert.equal(h.docs.get(key).remote.settings.updatedAt.seconds, 123);
    assert.ok(h.docs.get(key).remote.settings.updatedAt.nanoseconds >= 456);
});

for (const change of ['revision', 'budgets']) test('review still rejects actual remote settings change: ' + change, async () => {
    const h = harness(), remote = h.remote(); let changed = false, readTime = 100;
    const settings = { ...financeSettings(normalizarEstado({})), revision: 'synthetic-original-settings' };
    h.options.snapshotReader = async () => ({ ...remote, settings: { ...settings, ...(changed && change === 'revision' ? { revision: 'synthetic-new-settings' } : {}), ...(changed && change === 'budgets' ? { budgets: { padrao: { Outros: 75 }, meses: {} } } : {}), updatedAt: new Timestamp(123, readTime++) } });
    const review = await prepare(h), key = await consent(h, review), before = structuredClone([...h.docs]); changed = true;
    await assert.rejects(resume(h, key), { code: 'migration/remote-changed' }); assert.deepEqual([...h.docs], before);
});
