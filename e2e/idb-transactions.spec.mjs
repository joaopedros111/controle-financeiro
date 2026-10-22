import {test,expect} from '@playwright/test';
async function setup(page) {
    await page.goto('/local-only.html');
    await page.evaluate(async()=>{
        const {abrirPersistenciaFinanceira}=await import('/indexeddb-persistence.js');
        const {ServicoFinanceiroAtomico}=await import('/financial-atomic-service.js');
        const {validarBackup}=await import('/finance-core.js');
        window.qaDb=await abrirPersistenciaFinanceira();
        window.qaService=new ServicoFinanceiroAtomico(qaDb,validarBackup,q=>Array.isArray(q?.outbox)&&Array.isArray(q?.conflicts));
        window.qaState={versao:3,meses:{}};
        await qaService.inicializar('qa-alice',qaState,{outbox:[],conflicts:[],lastConfirmed:null});
    });
}
test('IDB real: inclusion during synchronization survives ACK from another page',async({context,page})=>{
    await setup(page);const other=await context.newPage();await setup(other);
    await page.evaluate(async()=>{
        await qaService.enfileirar('qa-alice',{id:'a',entityKey:'a'});
        window.qaEntered=false;
        window.qaSending=qaService.enviarFila('qa-alice',async()=>{window.qaEntered=true;await new Promise(resolve=>window.qaRelease=resolve);return {acknowledged:true};});
    });
    await page.waitForFunction(()=>window.qaEntered);
    await other.evaluate(()=>qaService.enfileirar('qa-alice',{id:'b',entityKey:'b'}));
    await page.evaluate(async()=>{qaRelease();await qaSending;});
    expect(await other.evaluate(async()=>(await qaService.lerFila('qa-alice')).outbox.map(op=>op.id))).toEqual(['b']);
});
test('IDB real: abort rolls back both documents; restart recovers offline operation',async({page})=>{
    await setup(page);
    await page.evaluate(()=>qaService.enfileirar('qa-alice',{id:'offline',entityKey:'offline'}));
    expect(await page.evaluate(async()=>{
        const before=await qaDb.ler('estado:qa-alice');
        const put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(value,key){if(key==='fila:qa-alice')throw new DOMException('synthetic interruption','QuotaExceededError');return put.call(this,value,key);};
        try{await qaDb.alterarDocumentos(['estado:qa-alice','fila:qa-alice'], docs=>{
            docs.set('estado:qa-alice',{revisao:999,dados:{versao:3,meses:{}}});
            docs.set('fila:qa-alice',{outbox:[],conflicts:[]});
            return docs;
        });}catch{}finally{IDBObjectStore.prototype.put=put;}
        return JSON.stringify(before)===JSON.stringify(await qaDb.ler('estado:qa-alice'));
    })).toBe(true);
    await page.reload();await setup(page);
    expect(await page.evaluate(async()=>(await qaService.lerFila('qa-alice')).outbox.map(op=>op.id))).toEqual(['offline']);
    await page.evaluate(()=>qaService.enviarFila('qa-alice',async()=>({acknowledged:true})));
    expect(await page.evaluate(async()=>(await qaService.lerFila('qa-alice')).outbox)).toEqual([]);
});
test('IDB real: account switch during ACK stops sending and isolates queues',async({context,page})=>{
    await setup(page);const other=await context.newPage();await setup(other);
    await page.evaluate(async()=>{
        await qaService.inicializar('qa-bob',qaState,{outbox:[{id:'bob',entityKey:'bob'}],conflicts:[],lastConfirmed:null});
        await qaService.enfileirar('qa-alice',{id:'a',entityKey:'a'});await qaService.enfileirar('qa-alice',{id:'b',entityKey:'b'});
        window.qaCurrent=true;window.qaEntered=false;window.qaCalls=[];
        window.qaSending=qaService.enviarFila('qa-alice',async(uid,op)=>{qaCalls.push([uid,op.id]);qaEntered=true;await new Promise(resolve=>window.qaRelease=resolve);return {acknowledged:true};},()=>qaCurrent);
    });
    await page.waitForFunction(()=>window.qaEntered);
    await page.evaluate(async()=>{qaCurrent=false;qaRelease();await qaSending;});
    expect(await page.evaluate(()=>qaCalls)).toEqual([['qa-alice','a']]);
    expect(await other.evaluate(async()=>(await qaService.lerFila('qa-alice')).outbox.map(op=>op.id))).toEqual(['b']);
    expect(await other.evaluate(async()=>(await qaService.lerFila('qa-bob')).outbox.map(op=>op.id))).toEqual(['bob']);
});

test('IDB real: settings deduplication in two tabs preserves eight existing conflicts, pending operations and restart recovery',async({context,page})=>{
    await setup(page);const other=await context.newPage();await setup(other);
    const fixture=await page.evaluate(async()=>{
        const local={version:3,categories:['Casa','Moto','Serasa'],theme:'claro',budgets:{padrao:{},meses:{}}};
        const remote=(revision)=>({...local,revision,updatedAt:{seconds:10,nanoseconds:0}});
        const conflicts=Array.from({length:8},(_,i)=>({kind:'settings',local,
            remote:{...remote(String(i)),categories:i<2?['Casa']:local.categories}}));
        await qaService.alterarFila('qa-alice',queue=>({...queue,conflicts,outbox:[{id:'pending',entityKey:'pending'}]}));
        return {local,conflicts,beforeState:JSON.stringify(await qaDb.ler('estado:qa-alice')),
            novel:{kind:'settings',local,remote:{...remote('new'),theme:'escuro'}}};
    });
    await Promise.all([
        page.evaluate(async({novel})=>qaService.registrarConflitoSettings('qa-alice',novel),fixture),
        other.evaluate(async({novel})=>qaService.registrarConflitoSettings('qa-alice',{
            ...novel,source:'restored-backup',remote:{...novel.remote,revision:'other-tab',updatedAt:{seconds:20,nanoseconds:0}}}),fixture),
        other.evaluate(()=>qaService.enfileirar('qa-alice',{id:'new-operation',entityKey:'new-operation'}))
    ]);
    await page.evaluate(async({local})=>{
        await qaService.registrarConflitoSettings('qa-alice',{kind:'settings',local,
            remote:{...local,categories:[...local.categories].reverse(),revision:'equivalent',updatedAt:{seconds:30,nanoseconds:0}}});
    },fixture);
    let queue=await page.evaluate(()=>qaService.lerFila('qa-alice'));
    expect(queue.conflicts).toHaveLength(9);
    expect(queue.conflicts.slice(0,8)).toEqual(fixture.conflicts);
    expect(queue.outbox.map(op=>op.id).sort()).toEqual(['new-operation','pending']);
    expect(await page.evaluate(async()=>JSON.stringify(await qaDb.ler('estado:qa-alice')))).toBe(fixture.beforeState);
    await page.reload();await setup(page);
    const recovered=await page.evaluate(()=>qaService.lerFila('qa-alice'));
    expect(recovered).toEqual(queue);
});

test('IDB real: session invalidated while transaction reads are pending aborts state and queue together',async({page})=>{
    await setup(page);
    expect(await page.evaluate(async()=>{
        await qaService.enfileirar('qa-alice',{id:'offline',entityKey:'offline'});
        const before=JSON.stringify([await qaDb.ler('estado:qa-alice'),await qaService.lerFila('qa-alice')]);
        let current=true;
        const transaction=qaDb.alterarDocumentos.bind(qaDb);
        qaDb.alterarDocumentos=(keys,callback)=>transaction(keys,docs=>{
            // The transaction has opened and completed its reads. Invalidate the
            // captured session before the service can issue its first write.
            current=false;return callback(docs);
        });
        try {
            await qaService.aplicarEdicao('qa-alice',qaState,{...qaState,tema:'escuro'},()=>[{id:'must-not-exist'}],()=>{},()=>current);
            return false;
        }catch(error){
            return error.code==='persistence/cancelled' && before===JSON.stringify([await qaDb.ler('estado:qa-alice'),await qaService.lerFila('qa-alice')]);
        }
    })).toBe(true);
    await page.reload();await setup(page);
    expect(await page.evaluate(async()=>(await qaService.lerFila('qa-alice')).outbox.map(op=>op.id))).toEqual(['offline']);
});

test('IDB real: another tab changing durable settings prevents obsolete confirmation',async({context,page})=>{
    await setup(page);const other=await context.newPage();await setup(other);
    await other.evaluate(()=>qaService.aplicarEdicao('qa-alice',qaState,{...qaState,tema:'escuro'}));
    const result=await page.evaluate(()=>qaService.confirmarSincronizacao('qa-alice',qaState,new Date().toISOString(),()=>true));
    expect(result.confirmed).toBe(false);expect(result.fila.lastConfirmed).toBe(null);
    expect(await other.evaluate(async()=>(await qaDb.ler('estado:qa-alice')).dados.tema)).toBe('escuro');
});

// The same coordinator used by app.js spans the SDK wait and queue mutations.
test('IDB real: cross-tab settings publication and conflict registration have a single order',async({context,page})=>{
 await setup(page);const other=await context.newPage();await setup(other);
 await page.evaluate(()=>{
  window.qaEntered=false;window.qaPublished=false;
  window.qaSending=qaService.coordenarSettings('qa-alice',async()=>{
   const queue=await qaService.lerFila('qa-alice');
   if(queue.conflicts.some(c=>c.kind==='settings'))throw new Error('unexpected conflict');
   window.qaEntered=true;await new Promise(resolve=>window.qaRelease=resolve);
   window.qaPublished=true;
  },true);
 });
 await page.waitForFunction(()=>window.qaEntered);
 await other.evaluate(()=>{
  const local={version:3,categories:['Casa','Moto','Serasa'],theme:'claro',budgets:{padrao:{},meses:{}}};
  window.qaRegistered=false;
  window.qaRegistering=qaService.registrarConflitoSettings('qa-alice',{kind:'settings',local,
   remote:{...local,theme:'escuro',revision:'other-tab',updatedAt:{seconds:10,nanoseconds:0}}}).then(()=>window.qaRegistered=true);
 });
 expect(await other.evaluate(()=>window.qaRegistered)).toBe(false);
 expect(await page.evaluate(async()=>(await qaService.lerFila('qa-alice')).conflicts.length)).toBe(0);
 await page.evaluate(async()=>{qaRelease();await qaSending;});
 await other.evaluate(()=>window.qaRegistering);
 expect(await page.evaluate(()=>window.qaPublished)).toBe(true);
 const queue=await page.evaluate(()=>qaService.lerFila('qa-alice'));
 expect(queue.conflicts).toHaveLength(1);expect(queue.conflicts[0].local.categories).toEqual(['Casa','Moto','Serasa']);
 expect((await page.evaluate(()=>qaService.confirmarSincronizacao('qa-alice',qaState,new Date().toISOString(),()=>true))).confirmed).toBe(false);
});

test('IDB real: a metadata write queued behind another tab revalidates its session',async({context,page})=>{
 await setup(page);const other=await context.newPage();await setup(other);
 await page.evaluate(()=>{
  window.qaEntered=false;
  window.qaHolding=qaService.coordenarSettings('qa-alice',async()=>{window.qaEntered=true;await new Promise(r=>window.qaRelease=r);});
 });
 await page.waitForFunction(()=>window.qaEntered);
 await other.evaluate(()=>{
  window.qaSessionCurrent=true;
  window.qaWriting=qaService.alterarFila('qa-alice',queue=>{
   if(!window.qaSessionCurrent)throw Object.assign(new Error('invalid session'),{code:'persistence/cancelled'});
   queue.conflicts=[];queue.enabled=false;return queue;
  }).then(()=>({saved:true}),e=>({code:e.code}));
  window.qaSessionCurrent=false;
 });
 await page.evaluate(async()=>{qaRelease();await qaHolding;});
 expect(await other.evaluate(()=>qaWriting)).toEqual({code:'persistence/cancelled'});
 expect(await page.evaluate(async()=>(await qaService.lerFila('qa-alice')).enabled)).toBeUndefined();
});
