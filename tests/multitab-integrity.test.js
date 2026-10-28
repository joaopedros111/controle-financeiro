import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { validarBackup, validarTotaisMonetarios } from '../finance-core.js';
import { recordEntityKey, operationId, validSyncIdentity } from '../sync-core.js';
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const save = app.slice(app.indexOf('function salvar()'), app.indexOf('// O modo experimental'));
const clone = structuredClone;
const item = (id, valor=10) => ({id, nome:id, valor});
const state = (...rs) => ({versao:3, meses:{'2026-10':{receitas:rs,despesas:[]}}});
const rows = s => s.meses['2026-10'].receitas;
function setup(initial=state()) {
    const docs = new Map(); let serial=Promise.resolve(); let fail=false;
    const db = {
        ler: async key => clone(docs.get(key) ?? null),
        alterarDocumentos(keys, transform) {
            const run = serial.then(() => {
                const next = transform(new Map(keys.map(k => [k,clone(docs.get(k) ?? null)])));
                if(fail) throw new Error('storage interrupted');
                for(const key of keys) docs.set(key,clone(next.get(key)));
                return next;
            }); serial=run.catch(()=>{}); return run;
        },
        alterar(key, transform) { return this.alterarDocumentos([key], m => {m.set(key,transform(m.get(key)));return m;}).then(m=>m.get(key)); }
    };
    const service = new ServicoFinanceiroAtomico(db, validarBackup, q=>Array.isArray(q?.outbox)&&Array.isArray(q?.conflicts));
    const ready=service.inicializar('alice',initial,{outbox:[],conflicts:[],lastConfirmed:null});
    function tab() {
        const events=[];
        const c=vm.createContext({estado:clone(initial),idbBase:clone(initial),idbPendente:Promise.resolve(), idbServico:service,idbBanco:db,idbBloqueado:false,
            automaticController:null,capturarSessaoPersistencia:()=>()=>true,
            recuperacaoFinanceira:{protegido:false}, chaveEstadoAtual:'controleFinanceiro:v3:uid:alice',CHAVE_ESTADO:'controleFinanceiro:v3',
            validarTotaisMonetarios, recordEntityKey,operationId,validSyncIdentity,structuredClone,console,
            normalizarEstado:clone,renderTudo(){},atualizarDiagnostico(){},avisar(){},
            CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},window:{dispatchEvent:e=>events.push(e)}});
        c.estadoParaSalvar=()=>clone(c.estado); vm.runInContext(save,c);
        return {c,events,async save(next){await ready;c.estado=clone(next);c.salvar();await c.idbPendente;}};
    }
    return {service,db,docs,ready,tab,fail:()=>{fail=true;},state:()=>docs.get('estado:alice').dados};
}
test('integridade multiaba: cria??o em aba desatualizada preserva ambas ou registra conflito',async()=>{
    const h=setup(),a=h.tab(),b=h.tab(); await Promise.all([a.save(state(item('a'))),b.save(state(item('b')))]);
    assert.deepEqual(rows(h.state()).map(x=>x.id).sort(),['a','b']); assert.equal((await h.service.lerFila('alice')).outbox.length,2);
});
test('integridade multiaba: aus?ncia no estado antigo n?o produz exclus?o impl?cita',async()=>{
    const h=setup(),a=h.tab(),b=h.tab(); await a.save(state(item('a')));await b.save(state(item('b')));
    assert.equal(b.events.length,1);assert.equal(b.events[0].detail.deletedRecords.length,0);
    assert.equal((await h.service.lerFila('alice')).outbox.filter(op=>op.value.deleted).length,0);
});
test('integridade multiaba: edi??o antiga n?o substitui silenciosamente a edi??o persistida',async()=>{
    const h=setup(state(item('same'))),a=h.tab(),b=h.tab();await a.save(state(item('same',20)));await b.save(state(item('same',30)));
    assert.equal(rows(h.state())[0].valor,20);assert.equal(b.c.idbBloqueado,true);assert.equal(rows(b.c.estado)[0].valor,30);
});
test('integridade multiaba: duas inclus?es intercaladas preservam as duas opera??es',async()=>{
    const h=setup();await h.ready;
    const a={id:'a'},b={id:'b'};await Promise.all([h.service.enfileirar('alice',a),h.service.enfileirar('alice',b)]);
    assert.deepEqual((await h.service.lerFila('alice')).outbox.map(op=>op.id).sort(),['a','b']);
});
test('integridade multiaba: ACK de A n?o remove B inclu?da entre leitura e grava??o',async()=>{
    const h=setup();await h.ready;await h.service.enfileirar('alice',{id:'a'});
    await h.service.enviarFila('alice',async()=>{await h.service.enfileirar('alice',{id:'b'});return {acknowledged:true};});
    assert.deepEqual((await h.service.lerFila('alice')).outbox.map(op=>op.id),['b']);
});
test('exclus?o expl?cita gera tombstone na mesma transa??o',async()=>{
    const h=setup(state(item('same'))),a=h.tab();await a.save(state());
    assert.equal(rows(h.state()).length,0);assert.equal((await h.service.lerFila('alice')).outbox[0].value.deleted,true);
});
test('interrup??o reverte estado e fila e bloqueia envio',async()=>{
    const h=setup(),a=h.tab();await h.ready;h.fail();await a.save(state(item('a')));
    assert.equal(rows(h.state()).length,0);assert.equal((await h.service.lerFila('alice')).outbox.length,0);assert.equal(a.c.idbBloqueado,true);
});
test('rede falha ap?s persist?ncia; rein?cio reenvia com mesmo ID',async()=>{
    const h=setup(),a=h.tab();await a.save(state(item('a')));const id=(await h.service.lerFila('alice')).outbox[0].id;
    await assert.rejects(h.service.enviarFila('alice',async()=>{throw new Error('offline');}),/offline/);
    const reboot=new ServicoFinanceiroAtomico(h.db,validarBackup,q=>Array.isArray(q.outbox));
    await reboot.inicializar('alice',state(),{outbox:[],conflicts:[]});
    await reboot.enviarFila('alice',async(_uid,op)=>{assert.equal(op.id,id);return {acknowledged:true};});
    assert.equal((await reboot.lerFila('alice')).outbox.length,0);assert.equal(rows(h.state())[0].id,'a');
});

test('unsent successive edits coalesce without inventing a remote revision', async()=>{
    const h=setup(state(item('same'))),a=h.tab();await a.save(state(item('same',20)));await a.save(state(item('same',30)));
    const q=await h.service.lerFila('alice');assert.equal(q.outbox.length,1);assert.equal(q.outbox[0].baseRevision,null);assert.equal(q.outbox[0].value.record.valor,30);
});
test('attempted operation remains immutable after a network failure and another edit',async()=>{
    const h=setup(state(item('same'))),a=h.tab();await a.save(state(item('same',20)));
    const original=(await h.service.lerFila('alice')).outbox[0];
    await assert.rejects(h.service.enviarFila('alice',async()=>{throw new Error('offline');}));
    await a.save(state(item('same',30)));const q=await h.service.lerFila('alice');
    assert.equal(q.outbox.length,2);assert.deepEqual(q.outbox[0],original);assert.equal(q.outbox[1].baseRevision,original.id);
});
