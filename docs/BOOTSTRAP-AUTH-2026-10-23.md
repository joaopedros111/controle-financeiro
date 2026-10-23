# Bootstrap Auth ? implementa??o e valida??o, 2026-10-23

Classifica??o: apto para homologa??o isolada, sem bloqueantes conhecidos na cobertura executada. N?o ? libera??o de produ??o. Nenhum commit, push, deploy ou acesso ? produ??o foi realizado.

Escopo desta etapa: firebase-sync-entry.js, tests/firebase-sync-client.test.js, scripts/run-local-tests.mjs e e2e/sync.spec.mjs. O diff exclusivo desta etapa est? em BOOTSTRAP-AUTH-2026-10-23.patch. Ele foi calculado sobre o estado que j? continha as corre??es anteriores; app.js, os testes de isolamento e as outras altera??es locais anteriores foram preservados.

criarFirebaseSync agora chama initializeAuth com hierarquia expl?cita: browserLocalPersistence primeiro, indexedDBLocalPersistence e browserSessionPersistence para recupera??o de sess?es legadas. browserPopupRedirectResolver continua configurado, preservando as depend?ncias de popup/redirect. A escolha do backend ? feita pelo SDK no bootstrap. ready aguarda authStateReady e mant?m getRedirectResult e o tratamento offline existentes; n?o chama setPersistence.

A sem?ntica de inst?ncia ?nica fica a cargo de initializeAuth: chamadas com op??es iguais reutilizam Auth; uma inst?ncia previamente inicializada com op??es incompat?veis produz auth/already-initialized. N?o h? fallback que substitua a inst?ncia ou fa?a logout. A reutiliza??o foi exercitada tamb?m com SDK real no navegador.

Sess?es anteriores em IndexedDB Auth e sessionStorage foram criadas pelo SDK no ambiente demo, depois recuperadas pelo bootstrap real ap?s navega??o. O UID permaneceu correto e a primeira leitura de lan?amentos foi autorizada. N?o h? limpeza manual de chaves Auth nem do banco financeiro. A recupera??o segue a sem?ntica nativa do SDK: ele pode promover uma sess?o legada migr?vel entre backends Auth; uma sess?o SESSION n?o migr?vel pode manter seu escopo original. O fluxo normal com sess?o local j? existente n?o remove essa sess?o nem a move para IndexedDB Auth.

Uma verifica??o de escrita/leitura do localStorage ? feita antes do bootstrap e ap?s a restaura??o. Ela usa apenas uma chave tempor?ria ?nica, removida pelo pr?prio teste de disponibilidade; nenhuma chave de usu?rio ou financeira ? removida por essa verifica??o. Bloqueio ou quota produz auth/web-storage-unsupported, sem iniciar Auth quando detectado antes do bootstrap. A interface existente permite nova tentativa ap?s libera??o do armazenamento. A solu??o n?o promete disponibilidade permanente do armazenamento depois da verifica??o.

N?o foram alterados isolamento por UID/sess?o/chave, Web Locks, regras Firestore, credenciais, documentos de produ??o, configura??o Firebase ou hospedagem. Nenhuma pol?tica de mesclagem ou migra??o financeira foi adicionada.

| Valida??o final | Resultado |
|---|---|
| npm.cmd run check | Aprovado |
| node --check scripts/run-local-tests.mjs | Aprovado |
| npm.cmd test | 309 testes: 307 aprovados, 2 ignorados, zero falhas/cancelamentos |
| npm.cmd run test:rules | 23 aprovados, zero ignorados/falhas |
| Playwright Edge e Chrome | 42/42 aprovados; 21 por navegador; sem retries |
| IndexedDB real, oito cen?rios por navegador | 16/16 aprovados |
| git diff --check | Sem erros |

Os dois ignorados comuns requerem Emulator e passaram na execu??o correspondente. A su?te final de navegador executou todos os cen?rios com --max-failures=0, sem remover asser??es ou desativar testes. N?o ocorreu permission-denied no fluxo corrigido nessas execu??es. Os testes de regras continuam produzindo nega??es esperadas para escritas propositalmente inv?lidas; isso ? distinto do erro de leitura investigado.

Novos casos permanentes cobrem: depend?ncias e prioridade do bootstrap; espera pela restaura??o sem troca tardia; inst?ncia incompat?vel; armazenamento bloqueado e revogado; primeira aba sem callback nulo adicional; leitura inicial autorizada; recupera??o real de IndexedDB Auth e SESSION; bootstrap repetido compat?vel; bloqueio e recupera??o de Auth mantendo lan?amentos an?nimos acess?veis ap?s logout. Os testes anteriores cobrem popup Google, cancelamento e rede, redirect offline, reconex?o, logout, A ? B, ACK e concorr?ncia.

O teste I intercepta o ponto exato em que o bootstrap antigo removia a sess?o local. Se essa remo??o for tentada, o teste pausa sua continua??o por uma Promise controlada, permite observar o callback nulo na primeira aba e reprova a tentativa. N?o h? espera fixa para ocultar a corrida nem repeti??o gen?rica de requests. O gancho _remove existe apenas na fixture demo; a implementa??o de produ??o usa APIs p?blicas do Firebase e localStorage.

Controle negativo: o novo teste I foi executado no Chrome com o m?dulo antigo inserido somente em mem?ria durante o build tempor?rio. Ele falhou como esperado: removals era 1, quando a asser??o exige 0; a observa??o do callback nulo anterior ? asser??o tamb?m foi satisfeita. O c?digo do projeto n?o foi revertido para fazer esse controle. A vers?o corrigida passou no mesmo teste no Edge e Chrome.

Uma primeira execu??o positiva teve 40 aprovados e duas falhas no novo caso L. A asser??o inicial exigia incorretamente transfer?ncia autom?tica de um lan?amento an?nimo para a conta. Ela foi substitu?da pela propriedade correta: fonte an?nima id?ntica ap?s o login e lan?amento acess?vel novamente ap?s logout. Nenhum fluxo financeiro foi alterado para satisfazer essa premissa. A execu??o completa foi repetida ap?s esse ajuste e todos os 42 testes passaram.

Preserva??o: os oito conflitos sint?ticos preexistentes, Moto, Serasa, lan?amentos e opera??es pendentes continuam preservados nos testes unit?rios e de IndexedDB real. Os oito conflitos reais de produ??o n?o foram acessados. Nenhum IndexedDB pessoal foi limpo e nenhum dado real foi modificado.

Logs:
- Controle negativo esperado: C:/Users/T03469~1/AppData/Local/Temp/controle-financeiro-homolog-5SBVBU/execution.log
- Regras: C:/Users/T03469~1/AppData/Local/Temp/controle-financeiro-homolog-TcFfCV/execution.log
- Primeira valida??o de navegador, com a premissa incorreta do teste L: C:/Users/T03469~1/AppData/Local/Temp/controle-financeiro-homolog-mCvnoA/execution.log
- Valida??o final de navegador: C:/Users/T03469~1/AppData/Local/Temp/controle-financeiro-homolog-D7Cj71/execution.log

Limita??es e riscos residuais:
- O navegador usa Auth Emulator e login sint?tico por e-mail/senha na fixture. Google real, cookies de terceiros, pol?ticas corporativas, Safari/iOS e PWA instalada precisam de homologa??o manual; popup/redirect foram preservados e cobertos por contratos automatizados, mas n?o por login Google real.
- A hierarquia de recupera??o usa a sem?ntica do SDK instalado. Perfis com fontes Auth divergentes, sess?es corrompidas ou abas muito antigas abertas simultaneamente n?o foram homologados. A recupera??o de sess?es legadas v?lidas e a coexist?ncia de duas abas com a vers?o atual foram exercitadas.
- Armazenamento local bloqueado impede iniciar a autentica??o at? que seja permitido; n?o h? limpeza autom?tica nem degrada??o deliberada para sess?o apenas em mem?ria.
- Uma inst?ncia Auth criada antes por outro c?digo com depend?ncias incompat?veis ? rejeitada de forma expl?cita, preservando a inst?ncia e os dados. A aplica??o deve manter um ?nico ponto de bootstrap.
- O gancho da regress?o usa um m?todo interno do SDK somente no ambiente de teste. Ele deve ser revisto ao atualizar Firebase; nenhuma depend?ncia desse m?todo foi adicionada ao c?digo de produ??o.
- A amostra automatizada n?o prova aus?ncia de toda falha futura de autentica??o nem substitui a revis?o humana. N?o publicar nesta etapa.
