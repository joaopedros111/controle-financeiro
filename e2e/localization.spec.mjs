import {test,expect} from '@playwright/test';

async function prepare(context,page){
 await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.goto('/local-only.html');
 await expect(page.locator('html')).not.toHaveClass(/app-inicializando/);
}
const expected={
 'pt-BR':['RESUMO DO MÊS','Janeiro','Fechar ajustes','Salvar'],
 en:['MONTHLY SUMMARY','January','Close settings','Save'],
 es:['RESUMEN DEL MES','Enero','Cerrar ajustes','Guardar'],
 fr:['RÉSUMÉ DU MOIS','Janvier','Fermer les paramètres','Enregistrer'],
 de:['MONATSÜBERSICHT','Januar','Einstellungen schließen','Speichern'],
 ja:['月間サマリー','1月','設定を閉じる','保存']
};
test('six languages switch without reload, preserve user data and do not write financial state',async({context,page})=>{
 await prepare(context,page);
 await page.locator('#abrir-ajustes').click();
 const before=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('controleFinanceiro:integridade:v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readonly'),r=tx.objectStore('documents').getAll();tx.oncomplete=()=>resolve(JSON.stringify(r.result));tx.onabort=()=>reject(tx.error);});}finally{db.close();}
 });
 await page.evaluate(()=>{
  window.__localePageIdentity='unchanged';
  const host=document.createElement('div');host.id='locale-probes';
  host.innerHTML='<span class="nome-receita">Despesas Janeiro Salvar Moto Serasa $&</span><button id="locale-aria" aria-label="Editar entrada Despesas Janeiro Salvar Moto Serasa $&">Editar entrada</button><pre>Entradas Moto Serasa</pre><textarea>Despesas</textarea><span id="locale-toast">Alteracoes confirmadas no armazenamento local IndexedDB.</span><span id="locale-status">Aguardando envio.</span><span id="locale-date" data-i18n-date="2026-10-23T12:00:00Z">\u00daltima sincroniza\u00e7\u00e3o confirmada: origem</span>';
  document.body.append(host);
  const row=document.createElement('li');row.id='locale-category-probe';
  row.innerHTML='<span class="nome">Despesas</span><button>Renomear</button>';
  document.querySelector('#lista-categorias').append(row);
 });
 for(const language of ['en','es','fr','de','ja','pt-BR','ja','en','pt-BR']){
  await page.locator('#idioma-interface').selectOption(language);
  const [title,month,close,save]=expected[language];
  await expect(page.locator('#titulo-resumo')).toHaveText(title);
  await expect(page.locator('#mes option[value="1"]')).toHaveText(month);
  await expect(page.locator('#fechar-ajustes')).toHaveAttribute('aria-label',close);
  await expect(page.locator('#form-receita button[type="submit"]')).toHaveText(save);
  await expect(page.locator('#locale-probes .nome-receita')).toHaveText('Despesas Janeiro Salvar Moto Serasa $&');
  expect((await page.locator('#locale-aria').getAttribute('aria-label')).includes('Despesas Janeiro Salvar Moto Serasa $&')).toBe(true);
  await expect(page.locator('#locale-probes pre')).toHaveText('Entradas Moto Serasa');
  await expect(page.locator('#locale-probes textarea')).toHaveValue('Despesas');
  const result=await page.evaluate(async lang=>{
   const m=await import('/localization.js?_release='+encodeURIComponent(document.querySelector('meta[name="app-version"]').content));
   return {rename:m.textoTraduzido('Renomear',lang),status:m.textoTraduzido('Aguardando envio.',lang),toast:m.textoTraduzido('Alteracoes confirmadas no armazenamento local IndexedDB.',lang),date:m.textoTraduzido('\u00daltima sincroniza\u00e7\u00e3o confirmada:',lang)+' '+new Date('2026-10-23T12:00:00Z').toLocaleString(m.LOCALES[lang]),identity:window.__localePageIdentity};
  },language);
  await expect(page.locator('#locale-status')).toHaveText(result.status);
  await expect(page.locator('#locale-toast')).toHaveText(result.toast);
  await expect(page.locator('#locale-date')).toHaveText(result.date);
  await expect(page.locator('#locale-category-probe .nome')).toHaveText('Despesas');
  await expect(page.locator('#locale-category-probe button')).toHaveText(result.rename);
  expect(result.identity).toBe('unchanged');
 }
 const after=await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const req=indexedDB.open('controleFinanceiro:integridade:v1',1);req.onsuccess=()=>resolve(req.result);});
  try{return await new Promise(resolve=>{const tx=db.transaction('documents','readonly'),r=tx.objectStore('documents').getAll();tx.oncomplete=()=>resolve(JSON.stringify(r.result));});}finally{db.close();}
 });
 expect(after).toBe(before);
});

test('new dynamic nodes and attributes follow the active language',async({context,page})=>{
 await prepare(context,page);await page.locator('#abrir-ajustes').click();
 await page.locator('#idioma-interface').selectOption('ja');
 await page.evaluate(()=>{
  const button=document.createElement('button');button.id='late-translation';button.textContent='Salvar';button.title='Tentar novamente';document.body.append(button);
 });
  await expect(page.locator('#late-translation')).toHaveText('保存');await expect(page.locator('#late-translation')).toHaveAttribute('title','再試行');
 await page.locator('#idioma-interface').selectOption('en');await expect(page.locator('#late-translation')).toHaveText('Save');
 await page.evaluate(()=>{document.querySelector('#late-translation').textContent='Remover';});await expect(page.locator('#late-translation')).toHaveText('Remove');
 await page.locator('#idioma-interface').selectOption('pt-BR');await expect(page.locator('#late-translation')).toHaveText('Remover');
});
