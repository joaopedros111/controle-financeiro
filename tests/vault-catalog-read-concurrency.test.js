import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createExperimentalAccount } from '../experimental/finance-vault-persistence.js';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { integrationDocuments, integrationOwner, integrationPassword } from './fixtures/vault-integration-scenarios.mjs';
function deferred() { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; }
function serialLocks() {
    let tail=Promise.resolve(); const requested=[];
    return { requested, request(name, fn) { requested.push(name); const run=tail.then(fn); tail=run.catch(()=>{}); return run; } };
}
async function setup(t) {
    const memory=memoryVaultFactory(), locks=serialLocks();
    let pause=null;
    const store={...memory.store, async loadCatalog(scope) { const value=await memory.store.loadCatalog(scope); if(pause) { const p=pause;pause=null;p.entered.resolve();await p.release.promise; } return value; }};
    const a=createExperimentalAccount({store,owner:integrationOwner,crypto:webcrypto,channelFactory:()=>null,locks});
    const b=createExperimentalAccount({store,owner:integrationOwner,crypto:webcrypto,channelFactory:()=>null,locks});
    const first=(await a.create({password:integrationPassword,generation:'synthetic-generation-1',documents:integrationDocuments()})).session;
    const second=await b.unlockWithPassword(integrationPassword);
    t.after(()=>{a.close();b.close();});
    return {a,first,second,locks,pause(){pause={entered:deferred(),release:deferred()};return pause;}};
}
test('catalog read fence deterministically rejects a writer between its two guards',async t=>{
    const h=await setup(t),p=h.pause();
    const read=h.a.vault.read(); const rejection=assert.rejects(read,{code:'stale-revision'});
    await p.entered.promise;
    await h.second.db.alterar(`estado:${integrationOwner.uid}`,v=>({...v,revisao:v.revisao+1}));
    p.release.resolve();await rejection;
});
test('cooperating session reader shares the writer lock instead of racing catalog guards',async t=>{
    const h=await setup(t),p=h.pause(),key=`estado:${integrationOwner.uid}`;
    const read=h.first.db.ler(key);await p.entered.promise;
    let committed=false;const write=h.second.db.alterar(key,v=>({...v,revisao:v.revisao+1})).then(()=>{committed=true;});
    // Await lock scheduling deterministically, without sleeps or relaxed read validation.
    await Promise.resolve();await Promise.resolve();assert.equal(committed,false);
    p.release.resolve();const before=await read;await write;
    assert.equal(before.revisao,0);assert.equal((await h.first.db.ler(key)).revisao,1);
    assert.equal(new Set(h.locks.requested).size,1);
    assert.ok(h.locks.requested.length>=3,'both readers and writer must use the same lock');
});
test('revocation while a reader waits for the shared lock never revives its session',async t=>{
    const h=await setup(t),entered=deferred(),release=deferred();
    const blocker=h.locks.request(h.locks.requested[0]||`cf-vault-experimental:${integrationOwner.projectId}:${integrationOwner.uid}:synthetic-integration`,async()=>{entered.resolve();await release.promise;});
    await entered.promise;const read=h.first.db.ler(`estado:${integrationOwner.uid}`);const rejected=assert.rejects(read,{code:'persistence/cancelled'});
    await h.a.lock();release.resolve();await blocker;await rejected;assert.equal(h.first.isCurrent(),false);
});
