# Revis?o da reconex?o por sess?o ? 2026-10-23

Classifica??o: isolamento corrigido e coberto por regress?es permanentes; aprova??o da homologa??o integrada de sincroniza??o permanece bloqueada pela nega??o intermitente de leitura descrita abaixo. N?o ? uma libera??o para produ??o.

O git status estava limpo no in?cio desta tarefa. Foram alterados app.js, tests/settings-safety.test.js, tests/auth-button.test.js, e2e/sync.spec.mjs e scripts/run-local-tests.mjs. O patch completo est? em RECONEXAO-SESSAO-2026-10-23.patch. N?o houve commit, push ou deploy.

Foram confirmadas quatro falhas nos novos testes antes da corre??o: continua??o obsoleta ap?s onRemoteRecords nas variantes troca A ? B, logout e reconex?o da pr?pria conta; e altera??o tardia do checkbox. Os testes executam fun??es extra?das de app.js com o servi?o at?mico real e fronteiras de navegador/rede sint?ticas.

Agora onFirebaseUser captura UID, gera??o da sess?o e chave de estado na origem. A fun??o current valida as tr?s identidades depois das esperas, antes de aplicar configura??es, publicar, instalar listeners ou alterar controles. A atualiza??o do checkbox ocorre somente depois dessa valida??o. A refer?ncia remota n?o ? aplicada ? interface antes de a persist?ncia retornar sucesso. O helper usado no primeiro v?nculo tamb?m verifica a identidade ap?s a persist?ncia, para n?o restaurar a chave de uma sess?o substitu?da.

A persist?ncia de configura??es usa a chave capturada; persistirEstadoFinanceiro mant?m as verifica??es de sess?o dentro da transa??o do servi?o at?mico. N?o foi introduzida pol?tica de mesclagem ou resolu??o autom?tica de conflitos. Web Locks, revis?es otimistas e a arquitetura Google existentes foram preservados.

O harness do teste de autentica??o passou a receber a fun??o real chaveLocalConta; suas verifica??es de popup e habilita??o do bot?o n?o foram reduzidas. Os novos testes tamb?m cobrem interrup??es entre leituras que antecedem os listeners e o retorno tardio do helper de persist?ncia do primeiro v?nculo.

| Valida??o final | Resultado |
|---|---|
| npm.cmd run check | Aprovado |
| node --check scripts/run-local-tests.mjs | Aprovado |
| npm.cmd test | 304 testes; 302 aprovados; 2 ignorados; zero falhas/cancelamentos |
| npm.cmd run test:rules | 18 aprovados; zero falhas/ignorados |
| Playwright Edge e Chrome, --max-failures=0 | 32 executados; 31 aprovados; uma falha; nenhum ignorado |
| Playwright final Edge | 15 aprovados; cen?rio F falhou na inicializa??o da segunda aba |
| Playwright final Chrome | 16 aprovados |
| IndexedDB real, oito cen?rios por navegador | 16/16 aprovados |
| git diff --check | Sem erros |

Os dois ignorados da su?te comum dependem do Emulator e foram executados com sucesso em test:rules. A primeira execu??o Playwright desta tarefa teve 29 aprovados, uma falha no cen?rio F do Chrome e dois n?o executados por maxFailures=1. A execu??o final usou --max-failures=0 apenas para executar todos os cen?rios; nenhuma asser??o foi desativada ou flexibilizada. Na vers?o final, o mesmo erro ocorreu no Edge e o Chrome passou. Uma execu??o bem-sucedida n?o elimina a intermit?ncia observada.

Os testes existentes de preserva??o dos oito conflitos sint?ticos, Moto, Serasa, lan?amentos, ACK individual e opera??es pendentes continuam aprovados. Os conflitos reais de produ??o n?o foram acessados. Os testes com IndexedDB real usam contextos sint?ticos isolados. N?o houve limpeza ou migra??o do IndexedDB do usu?rio.

**Investiga??o do permission-denied**

A opera??o identificada foi firebaseClient.list(uid, {serverOnly:true}), na primeira leitura de users/<uid>/records da segunda aba. O SDK usa getDocsFromServer; o transporte Listen observado na rede n?o implica que o listener expl?cito do aplicativo j? tenha sido instalado. A segunda aba ainda n?o havia iniciado listen, listenSettings ou listenConflicts.

Os diagn?sticos da fixture local registram apenas hor?rio, opera??o, UID solicitado, UID autenticado e sequ?ncia dos callbacks Auth. O erro do aplicativo registra UID solicitado/ativo e gera??o da sess?o. N?o s?o registrados tokens, credenciais ou payloads financeiros nesses diagn?sticos.

Na falha final do Edge, UID solicitado e UID ativo coincidiam; sess?o capturada e sess?o ativa eram ambas 1. A correla??o temporal entre abas foi:

| Tempo relativo | Evid?ncia |
|---|---|
| 0 ms | Primeira aba recebe callback Auth com usu?rio nulo |
| +112 ms | Segunda aba recebe callback Auth com o UID esperado |
| +186 ms | Primeira list da segunda aba falha; UID solicitado = UID autenticado |
| +787 ms | Primeira aba volta ao mesmo UID anterior |

N?o houve logout solicitado pelo teste nesse intervalo. O trace hist?rico 94JDfS tamb?m cont?m uma abertura de canal sem Authorization, intercalada com canais autenticados para o mesmo UID. A aus?ncia de cabe?alho em requisi??es de continua??o n?o foi tomada como prova de aus?ncia de autentica??o; o caso observado era uma abertura sem SID. Esses fatos estreitam a investiga??o para a restaura??o/propaga??o das credenciais entre Auth, Firestore e a coordena??o multiaba do cache, mas n?o identificam conclusivamente qual componente inicia a transi??o. N?o h? fundamento para atribuir a causa ao ambiente ou alterar regras de seguran?a.

O erro nega list em L72 e L129. A regra L72 exige request.auth n?o nulo e UID correspondente; a regra de fallback L129 nega caminhos n?o autorizados. As nega??es de create/update impressas nos testes de regras s?o intencionais e distintas desta falha de list.

**Procedimento de reprodu??o isolada**

Executar npm.cmd run test:e2e -- --project=msedge --project=chrome --max-failures=0. O runner usa somente demo-controle-financeiro nos Emulators Auth/Firestore e gera uma c?pia sint?tica do aplicativo em TEMP. O cen?rio F entra na primeira aba e abre uma segunda aba no mesmo contexto. A falha ocorre ao esperar Sincronizado na segunda aba, antes das inclus?es concorrentes.

Para investiga??o focada: npm.cmd run test:e2e -- --project=chrome --grep F: --repeat-each=5 --max-failures=0. Este ? um procedimento sugerido; n?o foi executado com cinco repeti??es nesta tarefa. Por ser intermitente, uma passagem isolada n?o encerra a investiga??o. Examinar no trace o anexo synthetic-state (syncDiagnostics), os callbacks Auth de ambas as abas e os canais Firestore, sem copiar tokens ou credenciais para relat?rios.

Logs da execu??o inicial instrumentada: C:/Users/T03469~1/AppData/Local/Temp/controle-financeiro-homolog-BZKLFi/execution.log

Logs e traces finais Playwright: C:/Users/T03469~1/AppData/Local/Temp/controle-financeiro-homolog-xWaNWd/execution.log e browser-results.

Logs finais de regras: C:/Users/T03469~1/AppData/Local/Temp/controle-financeiro-homolog-HwYMer/execution.log

**Riscos e limites**

O permission-denied continua sendo uma falha funcional de gravidade m?dia, com causa exata pendente. Nesta reprodu??o a falha ocorreu antes da publica??o da segunda aba e n?o demonstrou perda de dados. Isso n?o comprova aus?ncia de outros efeitos em todas as condi??es de rede/cache. N?o foram adicionadas tentativas autom?ticas para mascarar o erro.

Os testes novos usam VM e armazenamento sint?tico para controlar os intervalos da corrida; os testes de navegador cobrem transa??es IndexedDB nativas e os fluxos completos existentes. N?o houve valida??o com Google real, produ??o, celular ou PWA instalada. Web Locks coordena apenas abas participantes da mesma origem; n?o equivale a uma transa??o distribu?da entre IndexedDB e Firestore. Uma opera??o j? aceita pelo servidor n?o pode ser desfeita por cancelamento posterior no cliente.

Nenhuma regra, credencial, configura??o Firebase, mecanismo Google, documento de produ??o, saldo ou hist?rico real foi alterado. Os arquivos est?o dispon?veis para revis?o humana; n?o publicar nesta etapa.
