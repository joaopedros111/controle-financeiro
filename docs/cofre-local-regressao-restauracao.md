# Regressão de restauração — investigação e validação

Base: `security/cofre-local-etapa1`, HEAD `1e0f4a5`. Os 36 arquivos locais
preexistentes foram inventariados por SHA-256 antes das alterações. Sem commit,
staging, push, merge, deploy, migração real ou limpeza de bancos/caches.

## Falha e diagnóstico confirmado antes da correção

Falha histórica em `%TEMP%/cf-lifecycle-emulator-regression.log`: Chrome,
`scripts/run-vault-integrated-browser.mjs:119`, cenário de restauração offline
interrompida antes da publicação. `page.click('#restore-fixture')` era seguido
imediatamente por polling de `integratedQA.snapshot()` para encontrar restoreJob.
O click aguardava o evento de interface, não a Promise da operação assíncrona.

```text
VaultControllerError: Sessão do cofre invalidada. [code: cancelled]
  guard → Object.read → Object.snapshot
  snapshot (run-vault-integrated-browser.mjs:37)
  until (run-vault-integrated-browser.mjs:119)
```

Reprodução isolada com leitura retida por gate, sem injetar erro ou mudar dados:
capturar loadCatalog de um snapshot antigo; executar a restauração real; aguardar
seu commit; liberar a leitura antiga. No Edge com SDK/Auth/Firestore Emulator e
IndexedDB reais, o erro cancelled foi reproduzido no guard, com época durável
1→2, revisão 5→6 e geração nova. A fila/estado antigos ficaram integralmente no
arquivo de recuperação; a nova sessão continuou legível, com restoreJob presente,
e a publicação posterior terminou em recovery-history com o arquivo preservado.
O mesmo probe passou no Node (modelo transacional e remoto simulado).

**Causa-raiz: ordenação do harness.** importBackup renova a sessão do sincronizador
e o commit de geração renova a época do cofre. Uma leitura capturada antes dessa
troca deve ser cancelada; o harness a iniciava durante a operação e tratava esse
cancelamento legítimo como falha de restauração. Não há evidência de causa no
Emulator. O novo lifecycle e LC-01 não são importados pelo grafo desse harness;
os módulos funcionais analisados mantêm seus hashes anteriores.

A correção ficou restrita à automação: aguardar a Promise do handler real do botão
antes de ler o estado restaurado; manter a rejeição de cancelled em snapshots,
sem retry global desse erro, enfraquecimento de fences ou descarte de asserções.

## Reprodução isolada e sequência de eventos

`createRestoreProbe` compõe o **mesmo** createIntegratedSession/real-adapter,
serviço atômico, controlador, codec e Web Crypto. Somente a entrega de uma leitura
ou do resultado CAS é retida no driver; não se fabrica cancelled nem se modifica
a transação, a época, a geração ou o conteúdo financeiro. O cenário começa com
uma operação offline real e prepara alteração sintética para restauração.

São exercitadas duas interleavings determinísticas, nas quais o polling antigo
não podia presumir uma leitura estável:

| Fronteira | Eventos observados | Resultado e preservação |
| --- | --- | --- |
| Leitura antiga capturada | loadCatalog lê época 1/revisão 5; restore confirma; leitura antiga é liberada | Leitura rejeitada por local/guard; restore já terminou; nova leitura encontra época 2/revisão 6, geração nova e arquivo integral |
| Commit durável antes da entrega | CAS confirma estado/fila/catálogo/controle; entrega do CAS é retida; snapshot lê controle novo enquanto o controlador ainda possui sessão anterior | guard rejeita a sondagem e invalida a autorização anterior; a entrega do restore também pode ser cancelled; reabertura independente conserva integralmente o commit e permite concluir publicação |

O segundo caso reproduz diretamente o caminho de `guard` do log histórico:

```text
restore-start
restore-commit-durable-before-delivery
old-poll-interrupted-delivery { readError: cancelled, restoreError: cancelled }
independent-reopen-valid { archivedQueueExact: true, restoreJobPresent: true }
published-and-archive-retained
```

Os erros são esperados **somente no controle negativo que força o agendamento
antigo**; o teste exige que sejam rejeitados. Não há aceitação de cancelamento
no runner completo corrigido. A matriz Node tem duas provas de persistência e
publicação; o runner isolado exerce as duas fronteiras e a conclusão de publicação
em cada motor (oito verificações). A operação local de reprodução ocorre com
contexto browser offline, depois do login no Auth Emulator; portanto o
cancelamento também é demonstrado sem chamada de restauração ao Emulator.

Comparações integrais verificam a fila anterior no arquivo (incluindo IDs e
metadados), o estado anterior, o restoreJob, o estado ativo, a geração e a retenção
do arquivo após publicação. O estado esperado usa prepareGenerationRestore real:
a restauração normaliza o backup por contrato; não se compara com um DTO bruto
parcial nem se remove conteúdo para fazer asserções passarem.

No navegador: SDK Firebase real com runtime oficial, Auth em memória, Firestore
memoryLocalCache, Auth/Firestore Emulator em 127.0.0.1:9099/:8080, IndexedDB e
criptografia reais. Node usa modelo transacional e remoto de I/O simulado; não
é apresentado como prova de IDB ou servidor reais.

## Classificação e comparação com a última aprovação

A falha é uma **interação do harness de observação com uma transição funcional
legítima de sessão/geração**, não corrupção ou falha de atomicidade do backend.
O guard deve falhar fechado: não pode entregar resultado da época antiga como
se pertencesse à nova. Os contratos anteriores já admitem commit durável seguido
de entrega cancelada; isso não autoriza desfazer o commit ou recriar estado vazio.

O erro de automação foi usar um snapshot capaz de observar/revogar autorização
obsoleta como mecanismo de espera da própria transição. Aguardar o handler antes
de iniciar essa observação elimina a competição, mantendo os controles de sessão.
Não foi necessário propor ou implementar mudança funcional. Tornar snapshots
concorrentes transparentes seria outro contrato, sujeito a revisão específica;
não se removeu guard, CAS, fence ou invalidação para obter aprovação.

A última execução aprovada antes da regressão era
`%TEMP%/cf-integrated-final-integrated.log`, com 30 grupos. A cópia inicial do
runner nesta tarefa tinha SHA-256
`82c9d0f3c997d22b04d47f9d27e9a3dca2112a4a67c656c4ee340be81e8e6d48`,
o mesmo inventariado nas fases anteriores. Não foi identificada alteração recente
de código nesse caminho que introduzisse o erro: a ordenação dependia do timing.
Uma execução verde anterior não cobria todas as interleavings.

LC-01 pertence a `experimental/finance-vault-lifecycle.js`; o bundle antigo usa
`finance-vault-integrated-session.js`, sem importar o novo lifecycle. Os hashes
desses módulos e dos módulos funcionais permaneceram idênticos. A reprodução
também passa sem inicializar LC-01. Não se atribui a falha a Firebase, à carga
do ambiente ou a uma mudança do novo controlador.

## Correção mínima e testes contra mascaramento

`scripts/run-vault-integrated-browser.mjs` agora usa clickAndWait apenas no botão
restore-fixture. O helper instala temporariamente um wrapper no handler existente,
executa o **clique real pelo Playwright**, captura sua Promise, aguarda conclusão,
verifica os campos de erro da interface experimental e restaura o handler original.
Não reimplementa a restauração ou o DOM e não altera o módulo da interface.

O timeout de conclusão é 45 segundos, como o limite de fase já usado pelo runner.
Não houve aumento de timeout. O helper falha se o handler não fornece Promise,
se a ação está desabilitada, se a Promise rejeita (inclusive cancelled), se a UI
registra erro ou se a conclusão não chega. Cinco testes específicos conferem
essa espera, propagação e cleanup. Não há retry/whitelist de cancelled.

Continuam obrigatórias todas as asserções anteriores: restoreJob persistido,
fila arquivada exata, reinício completo do browser antes de publicar, mesma
geração remota, outbox ativa vazia, arquivo retido, aviso de recuperação presente,
nenhum segredo/finança legível nos stores e nenhuma requisição a produção.
O helper antigo de snapshot continua repetindo somente stale-revision.

O wrapper Emulator ganhou apenas `--restore-only`, com validação estrita de
argumentos. Sem argumentos executa o harness antigo completo, como antes.
Não muda projeto, endpoints, regras copiadas ou remoção de credenciais do processo
filho. Portas ocupadas continuam causando recusa sem encerrar outros serviços.

### Arquivos desta tarefa

Alterados, preservando seus demais cenários e defaults:

- `scripts/run-vault-integrated-browser.mjs`: espera da ação de restore;
- `scripts/run-vault-integrated-emulator.mjs`: seleção explícita do teste isolado.

Criados:

- `tests/fixtures/vault-ui-action.mjs` e `tests/vault-ui-action.test.js`;
- `tests/fixtures/vault-restore-probe.mjs` e `tests/finance-vault-restore-regression.test.js`;
- `tests/fixtures/vault-restore-browser.mjs` e `scripts/run-vault-restore-browser.mjs`;
- `docs/cofre-local-regressao-restauracao.md`.

Nenhum arquivo de experimental/, app.js, Auth/Firestore funcional, IndexedDB
financeiro, UI publicada ou Service Worker foi alterado. Os relatórios anteriores
foram mantidos como histórico; este documento resolve a pendência que registravam.

## Validação e evidências

```powershell
node --test tests/finance-vault-restore-regression.test.js tests/vault-ui-action.test.js
node scripts/run-vault-integrated-emulator.mjs --restore-only
node scripts/run-vault-integrated-emulator.mjs
node --test tests/finance-vault-lifecycle.test.js
node scripts/run-vault-lifecycle-browser.mjs
node scripts/audit-vault-lifecycle.mjs
node scripts/audit-vault-independent.mjs
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

| Execução | Aprovados | Falhas | Ignorados |
| --- | ---: | ---: | ---: |
| Restauração isolada Node + helper de clique | 7 | 0 | 0 |
| Restauração isolada Edge/Chrome + Auth/Firestore Emulator | 8 | 0 | 0 |
| Harness antigo completo Edge/Chrome + Emulator | 30 | 0 | 0 |
| Novo lifecycle Node, incluindo LC-01 | 18 | 0 | 0 |
| Novo lifecycle Edge/Chrome, BFCache real/abas/restart offline | 46 | 0 | 0 |
| Auditoria específica do lifecycle | 4 | 0 | 0 |
| Auditoria independente das fundações Node/Edge/Chrome | 30 | 0 | 0 |
| Suíte geral, 838 descobertos | 832 | 0 | 6 |
| npm check, sintaxe adicional e diff check | Aprovados, saída 0 | 0 | — |

Os totais se sobrepõem. Os dois erros forçados no controle negativo não são skips
nem falhas escondidas: o teste exige a rejeição e compara o estado recuperado.
O runner completo precisa sair com 0; ele não aceita esses erros como sucesso.

A suíte geral terminou com saída 0 em 586,5 segundos, sem cancelamentos ou
intervenção. Incluiu os dois casos de restauração, os cinco casos do helper e as
regressões anteriores. O ajuste final do driver para não relogar enquanto offline
foi validado novamente pelos sete testes específicos e pelas oito verificações
SDK/Emulator; não houve segunda execução geral após esse ajuste exclusivo da fixture.

**Ignorados:** seis grupos condicionados a ambiente/configuração de Emulator na
suíte Node: protocolo alternativo de épocas; integração Auth/Firestore com cofre;
fábrica Firebase/AutomaticFinanceSync/cofre; transações/settings nas regras;
barreira de gerações/restauração; regras de UID/tombstones. Os runners separados
desses seis grupos não foram executados nesta tarefa. A matriz integrada real
30/30 e os probes 8/8 foram executados separadamente, sem skips; não se convertem
os seis grupos ignorados em aprovações por inferência.

**Não executados:** OAuth Google real, produção, UI/bootstrap publicado com cofre,
dispositivos móveis físicos, falha física de energia/evicção, rotação de DEK e
migração/retirada de fontes reais. Nenhum teste solicitado da matriz isolada foi
omitido. A auditoria independente é o harness existente das fundações, complementado
pela auditoria do lifecycle; não constitui revisão externa independente desta correção.

Logs fora do Git: `%TEMP%/cf-restore-node-delivery.log`,
`cf-restore-isolated-final.log`, `cf-restore-complete-emulator.log`,
`cf-restore-lifecycle-node.log`, `cf-restore-lifecycle-browser.log`,
`cf-restore-lifecycle-audit.log`, `cf-restore-independent-audit.log`,
`cf-restore-full-suite.log` e `cf-restore-check.log`.
Os JSONs do probe registram fase, épocas/revisões, resultado de comparação e stack,
sem payload financeiro, senha ou segredo. Perfis e bancos sintéticos são retidos.
Perfis do harness completo: `%TEMP%/cf-integrated-msedge-4Bs1P5` e
`%TEMP%/cf-integrated-chrome-U36vwG`. Perfis dos dois probes finais por motor:
`cf-restore-msedge-7fuI0r`, `cf-restore-msedge-6ycpI2`,
`cf-restore-chrome-3uGgnM` e `cf-restore-chrome-Sm9Wqm`, todos em `%TEMP%`.

Preservação final: dos 36 arquivos inicialmente locais, 34 continuam com SHA-256
idêntico; somente os dois runners listados receberam a correção autorizada.
Os sete diffs rastreados de etapas anteriores mantêm seu conteúdo, sem novo
staging. Branch e HEAD preservados; nenhum módulo funcional alterado.

### Ensaios exploratórios reprovados, preservados

- `cf-restore-reproduce-node.log`: a primeira fixture comparava o resultado
  normalizado do restore com um DTO bruto. Corrigiu-se o esperado usando a função
  de preparação real, conservando comparação integral de estado/fila/arquivo.
- `cf-restore-isolated-boundaries.log`: o novo segundo probe tentou novo login
  com o contexto offline, recebendo auth/network-request-failed. O driver passou
  a reutilizar a sessão Auth real ainda existente em memória para a reabertura
  local, mantendo senha obrigatória. Não se simulou sucesso de Auth nem se
  atribuiu esse erro ao Emulator. A repetição final passou as oito verificações.

Esses ajustes são exclusivos das fixtures novas e seus logs permanecem disponíveis.
O primeiro probe já havia reproduzido o cancelamento em ambos os motores antes
de alterar o runner antigo. Os erros reais de cancelled não foram fabricados por
hooks de falha; os gates só controlam quando resultados reais são entregues.

## Riscos residuais e próxima fase

Não há hipótese aberta necessária para explicar esta regressão: as duas janelas
de ordenação e a correção da espera foram demonstradas. Não se afirma qual janela
exata ocorreu no processo histórico, que não tinha instrumentação; ambas produzem
o sintoma e são cobertas. Leituras durante mudança de geração continuam podendo
ser canceladas por projeto. Futuras integrações não devem usar esses snapshots
como barreira de prontidão ou ignorar cancelamentos indiscriminadamente.

Permanecem os limites anteriores: callbacks/eventos de UI publicados ainda não
coordenados com o novo lifecycle, Auth SDK multiaba, cache persistente legado,
objetos já entregues ao heap, rollback integral sem âncora externa, evicção/queda
física de energia, rotação/capacidade de DEK, performance móvel e custódia externa.
As falhas e atrasos dos probes são injetados em fronteiras reais, sem desligamento
físico de disco. Nenhum dado real foi lido/migrado nem fonte legada retirada.

A validação final está aprovada: **a regressão de restauração deixa de bloquear a
próxima fase experimental isolada de composição do lifecycle com SDK e interface
experimental**. Ela deverá manter owner/época explícitos, aguardar transições e
reusar a restauração/recuperação reais. Esta tarefa não faz essa conexão.

Isso não homologa o bootstrap/DOM publicado com cofre, não autoriza habilitação
no aplicativo, migração de dados reais ou produção. A adaptação estrutural do
bootstrap continua condicionada a preservar defaults e provar equivalência.
