import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { validarBackup, validarTotaisMonetarios } from '../finance-core.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const save = app.slice(app.indexOf('function salvar()'), app.indexOf('// O modo experimental'));
assert.match(save, /idbServico\.aplicarEdicao/, 'Testar a função real de gravação');
const clone = (x) => structuredClone(x);
const state = (...rs) => ({ versao: 3, tema: null, categorias: ['Outros'], orcamentos: { padrao: {}, meses: {} }, meses: { '2026-10': { receitas: rs, despesas: [] } } });
const item = (id, valor = 10) => ({ id, nome: `Synthetic ${id}`, valor });
const ids = (s) => s.meses['2026-10'].receitas.map((r) => r.id).sort();
function database() {
    const docs = new Map(); let previous = Promise.resolve();
    const db = {
        docs,
        alterarDocumentos(keys, cb) {
            const run = previous.then(() => {
                const input = new Map(keys.map((k) => [k, clone(docs.get(k) ?? null)]));
                const result = cb(input);
                for (const key of keys) docs.set(key, clone(result.get(key)));
                return result;
            });
            previous = run.catch(() => {});
            return run;
        }
    };
    return db;
}
function tab(service, initial, messages) {
    let writes = 0;
    const context = vm.createContext({
        estado: clone(initial), idbBase: clone(initial), idbPendente: Promise.resolve(),
        idbServico: service, idbBloqueado: false, IDB_HOMOLOGACAO: true,
        recuperacaoFinanceira: { protegido: false },
        chaveEstadoAtual: 'controleFinanceiro:v3', CHAVE_ESTADO: 'controleFinanceiro:v3',
        validarTotaisMonetarios, structuredClone, JSON, console,
        storage: { lerJsonResultado() { throw new Error('Não usar localStorage'); }, escreverJson() { writes += 1; throw new Error('Não usar localStorage'); } },
        avisar: (text) => messages.push(text), atualizarDiagnostico() {},
        normalizarEstado: clone, renderTudo() {}
    });
    context.estadoParaSalvar = () => clone(context.estado);
    vm.runInContext(save, context);
    return { context, save(next) { context.estado = clone(next); context.salvar(); return context.idbPendente; }, writes: () => writes };
}

test('app.js em duas abas usa serviço transacional e preserva inclusões independentes', async () => {
    const db = database(), service = new ServicoFinanceiroAtomico(db, validarBackup, q => Array.isArray(q?.outbox) && Array.isArray(q?.conflicts));
    const baseline = state(), messages = [];
    await service.inicializar('local', baseline, { outbox: [], conflicts: [], lastConfirmed: null });
    const a = tab(service, baseline, messages), b = tab(service, baseline, messages);
    await Promise.all([a.save(state(item('a'))), b.save(state(item('b')))]);
    assert.deepEqual(ids(db.docs.get('estado:local').dados), ['a', 'b']);
    assert.equal(a.writes() + b.writes(), 0);
    assert.equal(messages.filter((text) => text.includes('confirmadas no armazenamento')).length, 2);
});

test('app.js bloqueia edição obsoleta sem alterar dados anteriores', async () => {
    const db = database(), service = new ServicoFinanceiroAtomico(db, validarBackup, q => Array.isArray(q?.outbox) && Array.isArray(q?.conflicts));
    const baseline = state(item('same')), messages = [];
    await service.inicializar('local', baseline, { outbox: [], conflicts: [], lastConfirmed: null });
    const a = tab(service, baseline, messages), b = tab(service, baseline, messages);
    await a.save(state(item('same', 20)));
    await b.save(state(item('same', 30)));
    assert.equal(db.docs.get('estado:local').dados.meses['2026-10'].receitas[0].valor, 20);
    assert.equal(b.context.idbBloqueado, true);
    assert.equal(b.writes(), 0);
    assert.match(messages.at(-1), /Outra aba alterou/);
});

test('confirmation of asynchronous persistence preserves the undo notification', async()=>{
    const db=database(), service=new ServicoFinanceiroAtomico(db,validarBackup,q=>Array.isArray(q?.outbox)&&Array.isArray(q?.conflicts));
    const baseline=state(item('same')),messages=[];await service.inicializar('local',baseline,{outbox:[],conflicts:[],lastConfirmed:null});
    const a=tab(service,baseline,messages);a.context.document={querySelector:()=>({textContent:'Desfazer'})};
    await a.save(state());assert.equal(db.docs.get('estado:local').dados.meses['2026-10'].receitas.length,0);
    assert.equal(messages.some(text=>text.includes('confirmadas no armazenamento')),false);
});

test('month navigation persists its preference without financial writes, notifications, operations or conflicts',async()=>{
 const db=database(),service=new ServicoFinanceiroAtomico(db,validarBackup,q=>Array.isArray(q?.outbox)&&Array.isArray(q?.conflicts));
 const baseline=state(item('preserved')),messages=[];
 await service.inicializar('local',baseline,{outbox:[{id:'pending'}],conflicts:[{kind:'preserved'}],lastConfirmed:null});
 const before=JSON.stringify([...db.docs]),h=tab(service,baseline,messages),c=h.context;let preferences=0,financialWrites=0;
 const apply=service.aplicarEdicao.bind(service);service.aplicarEdicao=(...args)=>{financialWrites++;return apply(...args);};
 Object.assign(c,{periodo:{ano:2026,mes:10},preferenciasMenu:{referenciaMes:'ultimo'},
  chaveMes:(ano,mes)=>ano+'-'+String(mes).padStart(2,'0'),salvarPreferenciasMenu:()=>preferences++,
  renderTema(){},aplicarPrivacidade(){},aplicarPreferenciasVisuais(){},renderPeriodo(){},renderReceitas(){},renderDespesas(){},
  atualizarResumo(persistir){if(persistir)c.salvar();}});
 vm.runInContext(app.slice(app.indexOf('function renderTudo('),app.indexOf('let ultimaRemocao =')),c);
 vm.runInContext(app.slice(app.indexOf('function mudarPeriodo('),app.indexOf('function renderPeriodo(')),c);
 c.mudarPeriodo(2026,13);assert.equal(c.preferenciasMenu.ultimoPeriodo,'2027-01');
 c.mudarPeriodo(2026,0);assert.equal(c.preferenciasMenu.ultimoPeriodo,'2025-12');
 await c.idbPendente;
 assert.equal(preferences,2);assert.equal(financialWrites,0);assert.equal(JSON.stringify([...db.docs]),before);assert.deepEqual(messages,[]);
});

test('initial rendering after reload is silent and preserves financial state, pending operations and conflicts',async()=>{
 const db=database(),service=new ServicoFinanceiroAtomico(db,validarBackup,q=>Array.isArray(q?.outbox)&&Array.isArray(q?.conflicts));
 const baseline=state(item('preserved')),messages=[];
 await service.inicializar('local',baseline,{outbox:[{id:'pending'}],conflicts:[{kind:'preserved'}],lastConfirmed:'previous'});
 const before=JSON.stringify([...db.docs]),h=tab(service,baseline,messages),c=h.context;let writes=0,renders=0;
 const apply=service.aplicarEdicao.bind(service);service.aplicarEdicao=(...args)=>{writes++;return apply(...args);};
 Object.assign(c,{renderTema(){renders++;},aplicarPrivacidade(){},aplicarPreferenciasVisuais(){},aplicarPreferenciasMenu(){},
  renderPeriodo(){},renderReceitas(){},renderDespesas(){},atualizarResumo(persistir){if(persistir)c.salvar();}});
 vm.runInContext(app.slice(app.indexOf('function renderTudo('),app.indexOf('let ultimaRemocao =')),c);
 const end=app.indexOf('const telaInicialAplicada =');
 vm.runInContext(app.slice(app.lastIndexOf('renderTudo(',end),end),c);
 await c.idbPendente;
 assert.equal(renders,1);assert.equal(writes,0);assert.equal(JSON.stringify([...db.docs]),before);assert.deepEqual(messages,[]);
});
