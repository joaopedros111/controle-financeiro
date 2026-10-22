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
