# Tempo real e convergência — etapa 3

Implementação exclusiva de homologação. Usa Firebase Emulator, dados sintéticos
e um shell de testes separado. Não altera `firebase.json`, `firestore.rules`,
`app.js`, Service Worker, HTML ou bundle da aplicação de produção.

## Componentes e responsabilidades

| Arquivo | Alteração desta etapa |
| --- | --- |
| `finance-epoch-realtime.js` | Novo coordenador de sessão e tempo real |
| `finance-epoch-transport-emulator.js` | Auth vinculado, controle ativo e listeners das quatro coleções |
| `finance-epoch-cache.js` | Invalidação durável de geração, proteção de tombstones e de gravação por sessão |
| `finance-epoch-queue.js` | Geração aposentada implica erro, preservando a fila |
| `tests/finance-epoch-realtime.test.js` | Novos testes de estados, sessão, ordem e recuperação |
| `e2e/epoch-realtime.spec.mjs` | Novos testes entre processos independentes Edge/Chrome |
| `tests/fixtures/epoch-queue-browser.js` | Transporte com Auth e recuperação de sessão offline no fixture |
| `scripts/run-local-tests.mjs`, `playwright.config.mjs`, `package.json` | Modo de homologação e comandos separados |
| `docs/PROTOCOLO-EPOCH-ETAPA-3.md` | Contrato, limites, gates e evidências |

- `finance-epoch-transport-emulator.js`: listeners `onSnapshot` do controle e das
  quatro coleções do protocolo (`records`, `categories`, `budgets`, `settings`).
  Vincula explicitamente Firebase Auth à sessão. Recusa projeto real/endereço
  remoto, projeto divergente e UID incompatível antes de publicar dados locais.
- `finance-epoch-realtime.js`: sessão de tempo real, bootstrap, serialização de
  snapshots, conectividade, retomada automática, ciclo de listeners e fila.
- `finance-epoch-cache.js`: mantém `remote` separado da `projection`, aplica
  revisões monotônicas e conserva intenções pendentes. Marca gerações aposentadas
  sem apagar seus registros históricos ou comandos.
- `finance-epoch-queue.js`: continua sendo a única fila durável de envio.
  Recibos idempotentes, revisão-base, reserva entre abas e conflitos são os das
  Etapas 1/2; nenhuma leitura gera comandos financeiros.

## Uso isolado

O host abre um cache por projeto/UID/epoch e cria um transporte ligado à instância
Auth autenticada. Cria `EpochRealtimeSync(cache, transport)`, chama `start()` e
submete intenções com `enqueue(command)`. O método confirma persistência local;
o envio ocorre automaticamente quando a sessão está apta.

`start()` repetido é idempotente. `restartListeners()` troca a geração interna
dos callbacks, cancela os anteriores e confirma novamente o estado remoto.
`stop()` invalida a sessão, remove conectividade/listeners e cancela o processador
de fila. Troca de conta ou epoch exige encerrar a instância e criar outra com o
namespace novo. Nenhum método importa estado de namespaces antigos.

A integração futura deve consumir `view()`, não apresentar diretamente o banco
histórico bruto. A visão contém:

- `confirmed`: dados confirmados pelo Firestore.
- `optimistic`: projeção confirmada com intenções locais sobrepostas e indicadores
  de pendência/conflito.
- `pending`, `conflicts`, `ready` e `status`.

`view()` é uma consulta da projeção local; o recebimento Firestore → IndexedDB
é automático. O adaptador de renderização/eventos da interface ainda não existe
e não foi substituído por alterações na aplicação atual.

Uma edição rejeitada permanece na projeção otimista e no histórico de revisão,
mas não substitui o valor em `confirmed`. A convergência é exigida para os dados
confirmados; não pressupõe descartar intenções locais que precisam de decisão.

## Bootstrap e barreiras

1. Confirmar o UID atual na instância Auth ligada ao mesmo projeto.
2. Observar `users/{uid}/control/finance`; exigir snapshot do servidor, protocolo
   reconhecido, status ativo e epoch esperado.
3. Só então instalar os quatro listeners financeiros.
4. Exigir uma leitura confirmada de cada coleção, incluindo coleções vazias.
   Snapshots com `fromCache` ou `hasPendingWrites` não confirmam uma baseline.
5. Persistir o agregado no IndexedDB sem gerar operações.
6. Liberar o processamento da fila e avaliar o estado sincronizado somente após
   a gravação local e enquanto não existirem pendências, conflitos ou erros.

O bit `serverReady` persistido não é suficiente para declarar uma nova sessão
sincronizada. A sessão possui sua própria barreira de prontidão. Reinicializações
online não apresentam um cache de outro UID ou uma geração ainda não validada.

## Ordem, ACKs e ausência de eco

Cada sessão e reinício de listener têm identidades internas. Callbacks antigos
não passam pelas barreiras. Os snapshots são serializados e o callback de validade
é verificado novamente dentro da transação IndexedDB. Eventos mais novos de
metadados impedem que uma aplicação atrasada marque a sessão como pronta.

Revisões remotas menores são ignoradas. Revisão igual com conteúdo diferente é
erro. Uma revisão maior que tentasse ressuscitar um tombstone é recusada. Intenções
pendentes são sobrepostas depois da baseline confirmada, sem perder seus comandos
originais ou sua revisão-base.

O listener chama somente `applyRemoteSnapshot`. Não chama `enqueue`, não gera
IDs e não altera a identidade de uma operação existente. O processador só é
acionado quando há intenções pendentes enviáveis. Reiniciar o listener ou receber
metadados repetidos não cria um novo recibo ou lançamento.

ACK local continua condicionado à confirmação remota e à sessão/reserva válidas.
Se um reinício ou desconexão impedir o ACK, o comando é reenviado intacto e o
recibo da Etapa 1 responde como duplicado, sem novo efeito financeiro.

## Offline, recuperação e invalidação

Eventos offline suspendem envio e listeners, preservando o IndexedDB. Online
reinstala listeners e confirma controle, UID e baseline antes de retomar a fila.
Interrupções recuperáveis de listener usam tentativas com atraso crescente,
limitado a cinco segundos. O SDK também mantém sua recuperação de rede normal.

Falhas de autorização, UID incompatível ou geração inativa encerram a sessão e
retiram os dados financeiros de `view()`. Geração inativa fica marcada no cache:
intenção e histórico permanecem disponíveis para diagnóstico/revisão, mas não
voltam a ser apresentados nem são migrados para a geração nova. A nova geração
tem outro namespace e precisa de outro bootstrap.

Estados globais:

| Estado | Condição |
| --- | --- |
| sincronizando | Bootstrap, aplicação de snapshot, envio ou ACK em andamento; baseline ainda não confirmada ou fila pendente |
| sincronizado | Sessão corrente confirmada e sem operações pendentes, conflitos ou erros |
| offline | Rede indisponível; cache local e intenções permanecem, sem falsa confirmação remota |
| erro | Persistência inválida, autorização/geração inválida, listener não recuperável ou intenção concorrente a revisar |

Um dispositivo totalmente offline não pode conhecer uma troca de geração ocorrida
no servidor depois de sua última conexão. Ele pode consultar sua última baseline
validada com estado offline, sem prometer que a geração ainda está ativa. Assim
que reconecta, a validação bloqueia envio e apresentação se a geração foi retirada.
Uma aposentadoria já conhecida é durável e não reapresenta o cache ao reabrir.

## Homologação e evidências exigidas

`npm.cmd run test:epoch:realtime` cria um site sintético, aplica somente ao Emulator
as regras novas e executa Edge e Chrome. Os cenários de convergência usam processos
separados: A no navegador do projeto e B no outro navegador, sem compartilhar
IndexedDB ou Firebase Auth. As verificações consultam a visão local dos clientes;
B não chama flush, não consulta manualmente o Firestore e não recarrega para
receber alterações normais.

Casos cobertos:

- Criar A → B, editar B → A e excluir A → B, com igualdade de dados confirmados.
- Criações simultâneas distintas, sem eco de snapshots.
- Edição concorrente do mesmo registro: um valor confirmado convergente e intenção
  rejeitada integralmente preservada, distinguindo projeção e estado confirmado.
- Reinício de listener durante ACK e repetição real do commit/ACK.
- Interrupção recuperável de listener seguida de retomada automática.
- Logout/troca de UID, callbacks atrasados e ausência de vazamento financeiro.
- Mudança de epoch, fila antiga preservada, publicação antiga impedida e bootstrap
  vazio da geração nova.
- Categorias personalizadas, orçamentos, configurações, metadados de parcelas e
  vínculos entre entidades nos dois clientes.
- Editar offline, fechar o processo de B, reabrir offline com perfil persistente,
  recuperar Auth/IndexedDB e reconectar com convergência automática. O shell
  estático de QA é carregado antes do corte de rede; Auth e dados financeiros só
  são reabertos depois, offline. Não modifica ou substitui o PWA de produção.

## Limites e critérios antes de integrar a interface

O transporte continua bloqueado para produção. O controle administrativo e as
regras existentes não foram implantados remotamente. O histórico ainda não tem
compactação; séries/parcelas em grupo e integridade referencial continuam com os
limites das Etapas 1/2. Revisões de concorrência são preservadas, mas não existe
interface de resolução nesta entrega.

A importação de backup permanece fora desta etapa. Manifesto de importação,
conversor, checkpoints, confirmação de lote e os testes de replicação de backup
seguem obrigatórios em [seu contrato](IMPORTACAO-BACKUP-AUDITORIA-E-REQUISITOS.md).
Listeners concluídos não tornam um loop de enqueue um importador completo.

Para avançar, exigir revisão técnica desta etapa, todos os testes atuais aprovados,
definição do adaptador financeiro e de seus comandos, apresentação separada de
confirmado/pendente/revisão, mensagens traduzidas e ciclo Auth/PWA que sempre
encerre a sessão anterior. Definir o tratamento visual dos conflitos e da geração
retirada antes de habilitar edição na interface. Produção, reset por UID e
bloqueio remoto de clientes antigos requerem uma etapa de implantação própria.

Nenhum avanço para integração UI ou publicação está autorizado por esta entrega.

## Evidências finais — 2026-10-26

| Comando | Resultado |
| --- | --- |
| `npm.cmd test` | 361 aprovados, 0 falhas, 3 integrações ignoradas fora do Emulator |
| `npm.cmd run test:epoch` | 28 aprovados, 0 falhas/skips |
| `npm.cmd run test:epoch:realtime` | 18 aprovados, 0 falhas; Edge → Chrome e Chrome → Edge, 2,3 minutos |
| `npm.cmd run test:epoch:browser` | 26 aprovados, 0 falhas; regressão da fila, 1,3 minuto |
| `npm.cmd run test:rules` | 23 aprovados, 0 falhas/skips |
| `npm.cmd run test:e2e` | 50 aprovados, 0 falhas; aplicação legada, 2,9 minutos |
| `check`, `check:epoch`, `check:epoch:queue`, `check:epoch:realtime` | Aprovados |
| `git diff --check` | Aprovado |

Asserções principais de convergência:

- B recebe a criação de A com zero operações locais geradas em B. Depois A recebe
  a edição de B; ambos recebem o tombstone da exclusão, sem recarregar. Há três
  recibos remotos para essas três intenções e nenhum eco adicional.
- Criações simultâneas distintas terminam com duas entidades nos dois caches e
  somente duas operações aplicadas no servidor.
- Na disputa de edição, os dois `confirmed` contêm o valor vencedor. A projeção
  perdedora mantém seu valor, indicador de conflito e comando integral. Uma
  entidade independente ainda pode ser publicada pelo cliente com conflito.
- Reiniciar listener durante ACK, repetir o commit e aplicar o ACK duas vezes
  mantém um registro, um recibo e uma operação local. Há um único conjunto ativo
  de listeners após reiniciar e repetir start.
- O teste de interrupção recuperável observa exatamente uma nova inscrição e
  recebe a próxima mudança sem flush manual de B.
- Logout remove imediatamente os dados de `view()`. Callback antigo não escreve
  na conta nova. Troca de epoch esconde os dados antigos, conserva a operação
  antiga pendente e não a publica no servidor; a geração nova inicia vazia.
- Categorias, orçamentos, vínculos, parcela e configuração financeira terminam
  iguais nos dois estados confirmados.
- O perfil persistente de B conserva a intenção após fechar o navegador. Auth,
  cache e sessão financeira são reabertos offline; ao reconectar A recebe a edição
  automaticamente e o servidor tem apenas os dois recibos esperados.

Auth usa contas sintéticas do Emulator. Não foi executado OAuth Google real nem
homologação em celular físico, Firefox ou Safari. A implementação não se conecta
ao fluxo financeiro atual; esses ambientes e a renderização exigem homologação
na etapa de integração.

Logs/artefatos preservados fora do repositório:

- `%TEMP%/controle-financeiro-homolog-m9aEoh/execution.log`: tempo real e processos
  independentes; perfis persistentes sintéticos em `realtime-offline-profile-*`.
- `%TEMP%/controle-financeiro-homolog-KvOKtF/execution.log`: regressão da fila.
- `%TEMP%/controle-financeiro-homolog-QmOYZJ/execution.log`: protocolo e regras novos.
- `%TEMP%/controle-financeiro-homolog-4G0UPp/execution.log`: regras legadas.
- `%TEMP%/controle-financeiro-homolog-ONW9xS/execution.log`: navegador legado.
- `%TEMP%/controle-financeiro-unit-stage3.log`: testes locais.

Os gates técnicos de homologação desta etapa estão aprovados nesses ambientes.
A revisão do usuário continua sendo necessária antes de iniciar outra etapa.
Não houve acesso/limpeza de dados financeiros reais, alteração de regras ou
configuração de produção, commit, push ou deploy.
