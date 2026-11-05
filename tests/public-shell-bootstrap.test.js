import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const phase=source.slice(source.indexOf('function concluirCarregamentoConta()'),source.indexOf('let quadroRastreamentoTela'));
function harness(required){
 const classes=new Set(['app-inicializando']);let hidden=0,themes=0;
 const loading={setAttribute(){},removeAttribute(){}},status={textContent:''};
 const context=vm.createContext({contaGoogleObrigatoria:required,IDB_HOMOLOGACAO:false,firebaseConfigurado:()=>true,firebaseConfig:{},ocultarDadosFinanceiros:()=>{hidden++;},renderTema:()=>{themes++;},$:id=>id==='estado-sincronizacao'?status:loading,document:{documentElement:{classList:{add:(...x)=>x.forEach(c=>classes.add(c)),remove:(...x)=>x.forEach(c=>classes.delete(c))}},body:{setAttribute(){},removeAttribute(){}}}});
 vm.runInContext(phase,context);return {context,classes,status,hidden:()=>hidden,themes:()=>themes};
}
test('Google-only public shell does not await Auth readiness and keeps finance hidden',()=>{const h=harness(true);assert.equal(h.classes.size,0);assert.equal(h.hidden(),1);assert.match(h.status.textContent,/Dados financeiros bloqueados/);vm.runInContext('iniciarCarregamentoConta()',h.context);assert.equal(h.classes.size,0);});
test('legacy non-Google bootstrap boundary remains unchanged',()=>{const h=harness(false);assert.equal(h.classes.has('app-inicializando'),true);assert.equal(h.hidden(),0);vm.runInContext('iniciarCarregamentoConta()',h.context);assert.equal(h.classes.has('app-carregando-conta'),true);});
test('identity delivery alone cannot enable edits before current-owner state hydration',async()=>{
    const start=source.indexOf('onAccount: async user => {',source.indexOf('// The existing Firestore wire protocol'));
    const end=source.indexOf('\n            onState:',start);const fn=source.slice(start+'onAccount: '.length,end).trim().replace(/,$/,'');
    const context=vm.createContext({capturarSessaoPersistencia:()=>()=>true,idbBloqueado:false,contaFinanceiraVisivel:true,atualizarPermissaoFinanceira(){}});
    await vm.runInContext(`(${fn})({uid:'synthetic-public-shell'})`,context);assert.equal(context.idbBloqueado,false);assert.equal(context.contaFinanceiraVisivel,false);
});
