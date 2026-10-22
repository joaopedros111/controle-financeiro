# Auditoria de integridade multiaba — 22/10/2026

> Registro histórico. A continuação com identificação individual das regressões,
> correções e validação atual está em [REGRESSOES-IDB.md](REGRESSOES-IDB.md).

## Continuação: implementação parcial

O texto de auditoria abaixo permanece como registro anterior. Nesta continuação
foram modificados `app.js`, `financial-atomic-service.js`, `indexeddb-persistence.js`,
`storage.js`, `tests/multitab-integrity.test.js` e `tests/app-sync.test.js`.

- `salvar()` passou a usar `aplicarEdicao()` no fluxo normal, criando estado e
  operações na mesma transação. A base é a versão exibida, não uma leitura posterior
  do localStorage; ausências desconhecidas não geram tombstones.
- O serviço ganhou envio assíncrono da fila e conclusão transacional por ID:
  conflito e remoção da operação são gravados juntos. Falha de ACK local mantém a
  operação para repetição idempotente.
- Metadados são lidos no IndexedDB e atualizados por diferenças contra sua base;
  inserções concorrentes não são eliminadas pela regravação de um snapshot.
- Os escritores financeiros de snapshots e resolução foram direcionados ao
  repositório transacional. A restauração aceita um persistidor assíncrono e marca
  a necessidade de revisão da conta na transação do estado restaurado.
- A migração mantém a fonte legada, inicializa pares estado/fila por UID e rejeita
  corrupção/pares parciais. A identidade anônima usa `@local`, separada de UIDs
  válidos; documentos experimentais `local` são preservados como fonte.
- Leituras IndexedDB aguardam a conclusão da transação; versionchange fecha a conexão.

Os cinco cenários originais foram mantidos em testes que executam `salvar()` de
produção com o serviço real e um banco transacional simulado. Foram acrescentados
tombstone, interrupção e retomada após falha de rede. A execução direcionada de
multiaba, serviço atômico e integração app-IDB passou: **18/18**.

**A integração completa continua com regressões.** Última execução completa:
224 testes, 210 aprovados, 11 falhas, um cancelamento por timeout e dois ignorados.
Permanecem falhas em reversão A/B/A, preparação offline, falhas de persistência,
edição durante leitura, inicialização/recarga, logout durante ACK, exclusão via
publicação direta, identidade Unicode e renderização de conflitos. Algumas usam
um harness anterior que chama publicação sem salvar a edição; ainda é necessário
adaptar esse ciclo e comprovar cada propriedade, sem retirar as asserções.

`npm run check` passou na execução anterior desta continuação; o build `build:sync`
foi gerado em arquivo temporário. O Firestore Emulator executou **11/11** testes
com sucesso após autorização de acesso à configuração local do CLI. Não houve
commit, push, deploy, modificação de credenciais ou limpeza de dados.

Riscos pendentes: reconciliação de operações já preparadas versus edições novas,
sequenciamento completo de sessão nos callbacks assíncronos, recuperação persistente
da proposta local rejeitada e testes de navegador com IndexedDB real. Não executar
esta versão com dados financeiros reais nem publicar na main como correção concluída.

Estado da tarefa: **implementação transacional de produção não concluída**.
Este documento registra constatações e validações; não certifica uma correção.
Não há evidência para publicar esta alteração como solução dos problemas de integridade.

## Alterações desta execução

- `tests/multitab-integrity.test.js`: declaração explícita de `IDB_HOMOLOGACAO: false`
  no contexto VM do caminho legado. Sem ela, `salvar()` encontrava um
  `ReferenceError` capturado pelo próprio aplicativo antes de persistir qualquer coisa.
- Este relatório.

As asserções de integridade foram mantidas. Os cinco testes continuam falhando,
agora com reprodução direta das cinco perdas descritas. Não houve alteração da
implementação, das credenciais, das regras ou dos dados financeiros nesta execução.
Os diversos arquivos já modificados/não rastreados no Git são anteriores à tarefa,
exceto os dois arquivos acima.

## Fluxo de produção encontrado

1. Os handlers financeiros alteram `estado` e chamam `salvar()` (`app.js:635`).
2. Fora de `IDB_HOMOLOGACAO`, `salvar()` consulta o snapshot atual do
   `localStorage`, calcula ausências e sobrescreve o documento financeiro inteiro.
3. Após a gravação, em uma conta, emite `finance-local-change`, contendo estado
   e exclusões inferidas. A fila ainda não faz parte da mesma gravação.
4. O listener chama `publishFirebaseState()` (`app.js:3928`).
5. `stageFirebaseState()` calcula operações e grava metadados/fila inteiros no
   `localStorage`, antes da tentativa de rede.
6. `publishFirebaseStateNow()` faz leitura do servidor, reconcilia a fila em memória,
   grava novamente os metadados inteiros e chama `flushSyncQueue()`.
7. `flushSyncQueue()` usa `createSyncQueue()` sobre um adaptador de `localStorage`.
   Cada enqueue, conflito ou ACK faz leitura, alteração em memória e gravação inteira.
8. `firebase-sync-entry.js:183` usa transação Firestore com documento de operação
   para idempotência, revisão-base e conflitos remotos.
9. Depois do ACK, a fila local é novamente sobrescrita. Configurações são enviadas
   separadamente; a confirmação visual final depende também dessa etapa.

O ramo experimental chama `ServicoFinanceiroAtomico.aplicarEdicao()`, mas apenas
para a identidade `local`, sem callback produtor de operações. A inicialização
IndexedDB também depende da flag. O Firebase é expressamente desabilitado nesse modo.
Portanto, os testes positivos do serviço e do modo experimental não validam a
integração transacional Firebase de produção.

## Causas das cinco falhas

| Falha | Causa demonstrada |
| --- | --- |
| Inclusão em aba antiga perde a inclusão anterior | `salvar()` substitui o estado inteiro pela cópia da aba; não combina intenções contra sua base original. |
| Ausência antiga produz exclusão | As exclusões são calculadas comparando a proposta com o documento mais recente do armazenamento, que pode conter inclusões desconhecidas pela aba. |
| Edição concorrente substitui outra edição | Não há comparação da base da edição com o estado persistido nem diário persistente do conflito no caminho legado. |
| Duas inclusões na fila perdem uma operação | `createSyncQueue.enqueue()` faz read-modify-write não transacional. Duas leituras podem produzir gravações que substituem uma à outra. |
| ACK remove operação nova de outra aba | O filtro remove só o ID confirmado na cópia lida, mas a posterior gravação dessa cópia inteira também apaga operações acrescentadas depois da leitura. |

IDs idempotentes e transações no servidor não tornam atômicas as gravações locais.
`syncPublishChain` serializa apenas uma instância do aplicativo; não coordena abas.

## Mapa do armazenamento legado

| Dados | Caminhos relevantes |
| --- | --- |
| Estado financeiro anônimo/por conta | `salvar()`, `setFinancialStateKey()`, `onFirebaseUser()`, aplicação de configurações e registros remotos, restauração e resolução de conflitos |
| Fila, conflitos, confirmação, flags e baseline de configurações | `readSyncMeta()`/`writeSyncMeta()` (`app.js:3776`), staging, reconciliação, envio, callbacks remotos e resolução |
| Backup do primeiro vínculo | `migrationBackup()`; cópia por UID no `localStorage` |
| Restauração de backup | `importarBackup()` e `criarRecuperacaoFinanceira().restaurar()`; API de persistência síncrona |
| Preferências da interface | `salvarPreferenciasMenu()`; não devem ser removidas pela migração financeira |

## Outros pontos encontrados

- `importarBackup()` referencia `syncUser`, `readSyncMeta`, `writeSyncMeta`,
  `syncUi` e `setSyncStatus`, declarados dentro do bloco da interface Firebase.
  O callback da restauração está fora desse escopo. A gravação do backup acontece
  antes dessa referência; a falha pode ocorrer depois da substituição local.
- A aplicação de snapshots e a resolução de conflitos ainda gravam estado e
  metadados separadamente. Apenas ativar IndexedDB em `salvar()` deixaria esses
  caminhos capazes de divergir da nova fonte de verdade.
- `ServicoFinanceiroAtomico.inicializar()` já rejeita pares parcialmente presentes
  e dados inválidos; não substitui documentos IndexedDB existentes.
- `aplicarEdicao()` rejeita edição concorrente, mas o aplicativo só avisa e bloqueia;
  a proposta rejeitada não é armazenada por ele em um diário persistente.
- As funções atuais de snapshot verificam `snapshotConfirmed()`. Os testes de
  cache e escritas pendentes passaram; isso não resolve as corridas locais.
- `PersistenciaFinanceira.ler()` resolve no sucesso da requisição, antes do evento
  de conclusão da transação. A suíte unitária do serviço usa bancos simulados;
  não demonstra comportamento real de abortos do IndexedDB no navegador.

## Integração ainda necessária

Não foi implementado um novo fluxo nesta execução. O trabalho pendente inclui:

1. Inicialização por identidade e migração conjunta de estado e metadados/fila,
   antes de liberar edições ou rede; manter as fontes legadas intactas.
2. Captura da intenção contra a versão exibida e commit único de estado + operações
   por `aplicarEdicao()`, com persistência recuperável de propostas conflitantes.
3. API assíncrona de metadados com transformações dentro da transação IndexedDB;
   substituir os read-modify-write de objetos inteiros em todos os caminhos.
4. Envio exclusivamente da fila durável; conflito + remoção da operação confirmada
   na mesma transação, sem ACK por chave de entidade ou substituição da fila inteira.
5. Aplicação remota, restauração e resolução usando o mesmo repositório, preservando
   edições em andamento e operações que outra aba adicionou.
6. Identidade e geração de sessão capturadas antes de cada operação assíncrona;
   nenhuma resposta antiga deve alterar a conta atualmente exibida.
7. Testes do aplicativo completo com IndexedDB real, duas páginas no mesmo contexto
   de navegador e Emulator. Não basta testar o serviço isolado ou somente extrair
   funções em VM.

A migração precisa distinguir ausência, leitura indisponível, corrupção e migração
parcial. Divergências entre cópias existentes devem ser preservadas e bloqueadas
para revisão, sem escolher automaticamente uma cópia e apagar a outra. Interrupção
de transação deve permitir reinício sem importar novamente sobre dados já gravados.

## Validação executada

| Comando | Resultado |
| --- | --- |
| `npm.cmd run check` | Aprovado, exit 0 |
| `npm.cmd test` (antes da correção do harness) | 221 testes, 214 aprovados, 5 falhas, 2 ignorados |
| Direcionados: transactional-state, financial-intents, financial-atomic-service, app-idb-integration, app-sync, multitab-integrity, firebase-sync-client | 63 testes, 57 aprovados, 5 falhas, 1 ignorado |
| `node --test tests/multitab-integrity.test.js` após corrigir o harness | 5 testes, 5 falhas de integridade, sem ignorados |
| `npm.cmd run build` | Script inexistente |
| `npm.cmd run build:sync -- <arquivo temporário>` | Aprovado, exit 0; bundle existente preservado |
| `npm.cmd run test:rules` | Firestore Emulator iniciado; 11 testes aprovados, zero falhas/ignorados, exit 0 |

O script do Emulator executou `tests/firestore-rules.test.js` e
`tests/firebase-sync-client.test.js`, com dados sintéticos no projeto
`demo-controle-financeiro` e arquivos temporários fora do repositório.
Os dois testes ignorados na execução comum foram cobertos nessa execução separada.
Não foi executada a homologação do aplicativo completo em duas abas.

## Roteiro de homologação pendente

Usar uma cópia local isolada e contas/dados sintéticos no Emulator.
Não limpar o armazenamento de um perfil com dados reais.

1. Abrir duas abas no mesmo perfil e conta; deixar uma com uma versão antiga.
2. Criar um registro em cada aba; recarregar ambas e conferir os dois IDs no estado
   local e remoto e a ausência de tombstones não solicitados.
3. Editar o mesmo registro com valores diferentes; conferir preservação das duas
   versões em estado/conflito persistente, inclusive após reiniciar.
4. Excluir explicitamente e concorrer a exclusão com uma edição; verificar tombstone
   e conflito, sem ressurreição silenciosa.
5. Reter um ACK e incluir outro registro na segunda aba; liberar o ACK e verificar
   que só a operação correspondente saiu da fila.
6. Interromper/abortar gravação local; verificar rollback conjunto de estado/fila
   e nenhuma tentativa de envio da edição não persistida.
7. Persistir offline, fechar/reabrir e reconectar; verificar retomada com o mesmo ID
   de operação e aplicação remota idempotente.
8. Trocar de conta/logout com leitura e ACK em voo; conferir o isolamento completo
   e a ausência de confirmação visual para a nova sessão.
9. Repetir migração, simular um par parcial e dados corrompidos; conferir que as fontes
   permanecem recuperáveis e que nenhuma é reinterpretada como armazenamento vazio.
10. Entregar snapshots de cache e com escritas pendentes; conferir que não confirmam
    sincronização nem removem operações.

**Avaliação sobre a main:** não publicar como correção concluída. Os cinco defeitos
de integridade permanecem reproduzíveis. O sucesso dos testes remotos não comprova
a integridade do caminho local nem a segurança da migração.
