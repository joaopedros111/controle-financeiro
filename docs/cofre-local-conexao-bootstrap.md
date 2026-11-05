# Probe isolado de ciclo de vida no harness do bootstrap

> O relato inicial abaixo foi preservado. A seção final registra a conexão
> posterior dos eventos de Auth sintético e substitui seus próximos passos já
> executados; Auth real e autorização financeira continuam fora do escopo.

Data: 2026-11-04. Branch `security/cofre-local-etapa1`, HEAD
`1e0f4a57d555e09b66a6bd58dd15cd119d053341`.

## Escopo e preservação

Esta execução conclui o probe já existente. A importação de `createVaultLifecycle`,
o opt-in `lifecycle_probe=1`, o bloqueio de `openAdapter` e os primeiros testes
foram preservados. Não houve commit, push, merge, deploy ou limpeza de dados.
As alterações locais e staged anteriores continuam preservadas.

Somente os dois arquivos do harness foram inspecionados para a implementação;
não se repetiram auditorias gerais. O índice Git foi registrado por hash do
manifesto de entradas staged; a conferência final confirmou conteúdo idêntico.

| Arquivo | Alteração desta execução |
| --- | --- |
| `tests/fixtures/app-injection-bootstrap.mjs` | Contador de tentativas de abrir adaptador; o callback continua rejeitando qualquer abertura |
| `scripts/run-app-injection-browser.mjs` | Probe ampliado para A→B, suspensão, retomada e logout; asserções de isolamento/preservação; contagem separada dos probes e ausência de controlador sem opt-in |
| `docs/cofre-local-conexao-bootstrap.md` | Este relatório |

Não foram alterados app, storage, controlador, Firebase, IndexedDB, interface
publicada ou Service Worker. Não foi criado módulo de runtime novo.

## Arquitetura e isolamento

O servidor de QA serve o aplicativo existente e uma fixture explícita em
`/?mode=injected&lifecycle_probe=1`. Só a fixture interpreta a flag; ela não
habilita controlador ou cofre no aplicativo publicado. Sem a flag, o harness
injetado não instancia nem expõe `injectionEvidence.lifecycle`.

O controlador real é iniciado com `start()` e recebe identidades sintéticas por
chamadas diretas. Seus estados são observados em `lifecycleStates`. Não há ligação
entre esses eventos e Auth nesta etapa. `openAdapter` lança erro se chamado;
o contador precisa permanecer zero. Não se chama `unlock()`, não se apresenta
credencial e não se lê conteúdo financeiro pelo controlador.

O probe usa o IndexedDB dedicado `controleFinanceiro:integridade:v1:synthetic-injection`
em um contexto novo do navegador, com Service Workers bloqueados. Requisições
externas à origem loopback são abortadas. O estado/fila locais são apenas lidos
antes/depois das transições e comparados integralmente; o probe não os altera.
Os cenários de regressão já existentes continuam usando dados sintéticos em
contextos/perfis novos. Nenhum perfil pessoal ou banco financeiro do uso normal é aberto.

## Cenários ampliados

| Operação | Resultado exigido e aprovado em Edge/Chrome |
| --- | --- |
| Inicialização | `signed-out`, sem dono, propriedade `none` |
| Identificar A | `locked`, dono `demo-injection/synthetic-injection-A`, `confirmed` |
| Trocar para B | `locked`, dono `demo-injection/synthetic-injection-B`, `confirmed` |
| Suspender | `suspended`, mantendo dono B |
| Retomar | `locked`, mantendo B com propriedade `unconfirmed` |
| Logout | `signed-out`, sem dono, propriedade `none` |

Também foram exigidos: nenhuma fase `unlocking`, `ready` ou `operating` no
histórico; `data:null` e zero operações em andamento nos estados capturados;
zero tentativas de abrir adaptador; estado/fila local idênticos antes/depois;
nenhum erro de página; eventos de inicialização exatamente `['open', 'service']`.
As asserções existentes de inicialização foram mantidas. O fluxo injetado sem
flag agora comprova explicitamente a ausência do controlador experimental.

## Validação

Executados na ordem solicitada:

```powershell
node --check tests/fixtures/app-injection-bootstrap.mjs
node --check scripts/run-app-injection-browser.mjs
node --test tests/app-dependency-injection.test.js
node scripts/run-app-injection-browser.mjs
git diff --check
# Somente após a aprovação dos anteriores:
npm.cmd run check
```

| Verificação | Resultado | Ignorados/cancelados |
| --- | --- | --- |
| Sintaxe da fixture | Aprovada, exit 0 | 0/0 |
| Sintaxe do executor | Aprovada, exit 0 | 0/0 |
| Injeção de dependências Node | 5 aprovados, 0 falhas, exit 0 | 0/0 |
| Probe ampliado Edge/Chrome | 2 aprovados, 0 falhas | 0/0 |
| Regressões existentes do executor | 14 aprovadas, 0 falhas, exit 0 | 0/0 |
| `git diff --check` | Aprovado, exit 0 | 0/0 |
| `npm.cmd run check` | Aprovado, exit 0 | 0/0 |

A contagem original de 14 cobre os cenários existentes do executor. Os dois
probes, um por engine, são agora registrados separadamente, sem confundir novas
asserções de transição com casos independentes. Nenhuma falha de lançamento de
navegador ou erro de página ocorreu nos probes.

Logs em `%TEMP%`: `cf-bootstrap-lifecycle-probe-node.log`,
`cf-bootstrap-lifecycle-probe-browser.log`, `cf-bootstrap-lifecycle-probe-check.log`.
Perfis sintéticos retidos: `cf-app-injection-msedge-EUsOYS`,
`cf-app-injection-msedge-z3FXZw`, `cf-app-injection-chrome-ik7DyL` e
`cf-app-injection-chrome-CGK8fC`, também em `%TEMP%`.

Não executados: suíte global (reservada à validação consolidada), Emulator,
integração real de Auth, fluxo browser de cofre/desbloqueio, BFCache real, revogação entre abas ou
auditorias amplas. Suspensão/retomada aqui são chamadas explícitas à API do
controlador, não uma prova de congelamento ou retorno real do navegador.

## Limitações e próximos passos

Este é um probe de coordenação de identidade/estados, sem autoridade sobre as
finanças do aplicativo. O estado `locked` do controlador não passa a bloquear o
backend legado da UI. Não se homologaram criptografia, leases financeiras,
drenagem de gravações ou revogação durável por meio desta conexão, pois nenhum
adaptador foi aberto. As aprovações históricas dessas políticas permanecem fora
do escopo desta execução.

Uma próxima etapa poderá vincular eventos **sintéticos** de Auth ao controlador
na fixture existente, definindo uma única origem para identidade e logout e
testando callbacks atrasados, A–B–A, mesmo UID e prevalência do encerramento.
Deverá manter abertura de adaptador proibida e distinguir `confirmed`,
`unconfirmed` e `none` sem inferir dono a partir de finanças. Só depois dessa
coordenação poderá ser proposta uma homologação mais ampla, com autorização e
validação consolidada próprias.

**Decisão:** probe ampliado concluído e validado, apto a uma próxima etapa
delimitada de vinculação de eventos sintéticos de Auth. A conexão continua
isolada e não homologa Auth real, autorização financeira ou ativação do cofre.
A suíte global permanece reservada à validação consolidada. O próximo passo
descrito não foi implementado nesta entrega.

## Atualização — eventos de Auth sintético conectados ao controlador

Branch e HEAD mantidos: `security/cofre-local-etapa1`, `1e0f4a5`. As alterações
anteriores da fixture, do executor e deste relatório foram preservadas. Nenhum
commit ou alteração no índice staged foi realizado nesta execução.

### Arquitetura mínima

`createSyntheticLifecycleAuth` foi acrescentada à própria fixture, sem criar
outro módulo de runtime. A função decora o cliente Auth sintético existente
somente quando `lifecycle_probe=1` instancia o controlador. A fábrica de
dependências, o aplicativo, o controlador real e o fluxo sem flag não mudaram.

O `onUser` existente recebe uma única inscrição compartilhada: sua entrega
inicial passa pela ponte, que encaminha identidade válida ao controlador e ao
consumidor já registrado. Não há inscrição adicional do controlador. No modo
local `injected`, que antes não assinava Auth, o probe cria sua primeira inscrição
sintética, sem consumidor financeiro; no modo `sync`, reutiliza a inscrição do
AutomaticFinanceSync. Os dois modos foram verificados com exatamente um
observador. O modo `sync` sem flag continua com um observador também.

Cada intenção sintética recebe sequência e identidade próprias na origem. Uma
entrega só é aceita se ainda for a intenção atual e pertencer à inscrição ativa.
Assim, callback atrasado não redefine nem mesmo o usuário do cliente. Duplicatas
da mesma entrega não repetem callback ou transição. Um novo login do mesmo UID
é uma intenção nova, distinguida de uma duplicata antiga.

As operações existentes do controlador são reutilizadas:

- Identidade A/B válida: `identify(confirmed)` → proprietário correspondente,
  estado `locked`; nunca há unlock automático.
- Logout sintético: `close('logout')` → `signed-out`, sem proprietário.
- Falha sintética: `identify(failed)` → `error`, `lifecycle/auth-failed`, sem
  proprietário ou dados financeiros. A falha não é convertida em evento de usuário
  anônimo para o consumidor: erro não significa logout nem finanças vazias.
- Fechamento/suspensão/retomada diretos também invalidam entregas Auth pendentes
  por meio do `onState` já existente. Um callback antigo não promove a propriedade
  `unconfirmed` de volta a `confirmed` após retomada.
- Cancelar a inscrição invalida seus callbacks, remove o observador uma vez e
  encerra o contexto. Uma reinscrição nova não aceita callbacks da anterior.

LC-01 e os fences internos do controlador não foram alterados. A ponte observa
rejeição `lifecycle/stale-session` somente quando a intenção já foi superada;
erros inesperados continuam rejeitando a Promise de transição e são observáveis
por `settled()`. As provas usam chamadas e callbacks retidos explicitamente,
sem sleeps para tentar acertar a janela de corrida.

### Arquivos alterados nesta atualização

| Arquivo | Alteração |
| --- | --- |
| `tests/fixtures/app-injection-bootstrap.mjs` | Ponte pura de Auth sintético; decoração opt-in de `onUser`/`ready`; reaproveitamento da inscrição; fence nos estados de fechamento |
| `scripts/run-app-injection-browser.mjs` | Novo probe Auth por engine; mantém os probes anteriores; verifica inscrição única com/sem sincronização e integridade financeira |
| `tests/bootstrap-synthetic-auth.test.js` | Seis testes Node novos usando a mesma função da fixture e o controlador real, sem executar DOM ou abrir banco |
| `docs/cofre-local-conexao-bootstrap.md` | Histórico e evidências desta atualização |

O teste Node extrai somente a declaração pura exportada pela fixture, em vez de
executar a composição browser. Não mantém uma cópia da lógica da ponte. Não
foram modificados app, storage, IndexedDB, Firebase, sincronizador, regras,
Service Worker ou o módulo `finance-vault-lifecycle.js`.

### Cenários e resultados

Seis testes Node verificaram: A/B/logout/falha por uma inscrição; inicialização
anônima atrasada e duplicatas; login antigo após logout/novo dono e A–B–A rápido;
falha com callback antigo e recuperação por login novo; suspensão/retomada
`unconfirmed`/logout diretos; cancelamento idempotente e reinscrição segura.

A primeira rodada Node teve 10 aprovações e uma falha no novo ensaio: o setup
assíncrono deixava o callback inicial executar antes do login, embora o teste
pretendesse entregá-lo depois. O ensaio passou a reter esse callback e liberá-lo
explicitamente depois do login. A asserção original foi mantida. A repetição
passou nos 11 testes; o resultado inicial continua no log, sem mascaramento.

Em cada navegador, o probe novo verificou estados/proprietários A e B, duplicata
sem transição adicional, cinco callbacks obsoletos recusados (login, troca de
dono, logout, falha e suspensão), alternância rápida A–B–A, erro sem proprietário,
login novo após erro, retomada `unconfirmed` e logout final. Os probes manuais
anteriores de suspensão/retomada/logout continuam passando.

Estado/fila `@local` e as chaves financeiras de A/B foram comparados antes e
depois: nenhuma alteração nem criação de par financeiro de conta. Foram exigidos
zero tentativas de abrir adaptador, nenhum estado `unlocking`/`ready`/`operating`,
`data:null`, zero operações em andamento e nenhum erro de página. Os eventos
originais `['open', 'service']` continuam exatos no probe local. O documento
com `sync` e probe juntos apresentou `open/service/firebase/sync` uma única vez,
com um cliente e um observador; sua inicialização anônima preservou estado/fila.

| Validação desta atualização | Aprovados | Falhas | Ignorados/cancelados |
| --- | ---: | ---: | ---: |
| Node: seis novos + cinco de injeção anteriores | 11 | 0 | 0/0 |
| Probes manuais anteriores Edge/Chrome | 2 | 0 | 0/0 |
| Novos probes Auth Edge/Chrome | 2 | 0 | 0/0 |
| Regressões existentes do executor | 14 | 0 | 0/0 |
| Sintaxe da fixture e executor | exit 0 | 0 | 0/0 |
| `npm.cmd run check` | exit 0 | 0 | 0/0 |
| `git diff --check` | exit 0 | 0 | 0/0 |

Comandos executados:

```powershell
node --test tests/bootstrap-synthetic-auth.test.js tests/app-dependency-injection.test.js
node --check tests/fixtures/app-injection-bootstrap.mjs
node --check scripts/run-app-injection-browser.mjs
node scripts/run-app-injection-browser.mjs
# Após aprovação dirigida:
npm.cmd run check
git diff --check
```

Logs em `%TEMP%`: `cf-bootstrap-synthetic-auth-node.log` (primeiro ensaio),
`cf-bootstrap-synthetic-auth-node-final.log`, `cf-bootstrap-synthetic-auth-browser.log`
e `cf-bootstrap-synthetic-auth-check.log`. Perfis mantidos:
`cf-app-injection-msedge-QjCZo5`, `cf-app-injection-msedge-xWy84l`,
`cf-app-injection-chrome-rLtxGG` e `cf-app-injection-chrome-6U7ExH`.

Conferência final: manifesto staged idêntico por SHA-256; somente os dois arquivos
do harness têm diferenças não staged em relação ao índice. Os únicos arquivos
não rastreados são este relatório já existente e o novo teste Node. Todas as
alterações staged anteriores foram preservadas integralmente.

### Limites e decisão

A identidade `confirmed` é fornecida pelo cliente **sintético**, não por Firebase
ou validação real de credencial. Os atrasos/duplicatas são callbacks da fonte
sintética, não cancelamento de Promises do SDK. A API de falha é exclusivamente
de QA. Nenhum Firebase real ou Emulator foi utilizado nesta atualização.

O controlador continua sem recursos financeiros: `openAdapter` bloqueado,
nenhuma chamada a `unlock`, nenhuma criptografia habilitada. Ausência de acesso
financeiro refere-se ao controlador; o backend/DOM legado não virou uma UI de
cofre bloqueado. A ponte não foi transformada em autoridade financeira, nem se
validou sua atuação sobre fila, conflitos, tombstones ou ACKs. As regressões
existentes continuam usando exclusivamente dados sintéticos em perfis próprios.

Não executados: suíte global, integração de Auth real/Emulator, desbloqueio,
BFCache real, revogação entre abas ou recuperação cifrada por esta ponte.
Suspensão/retomada permanecem chamadas explícitas à API. A validação consolidada
global fica para outra etapa autorizada.

**Decisão:** a coordenação sintética passou nos testes dirigidos. Não é uma
homologação de Auth real, acesso financeiro ou ativação do cofre. A execução
termina nesta validação, sem commit, push, merge, deploy, migração ou limpeza.

## Homologação consolidada — Auth sintético → Lifecycle → Bootstrap

Data: 2026-11-04. Branch `security/cofre-local-etapa1`, HEAD
`1e0f4a57d555e09b66a6bd58dd15cd119d053341`. Nenhuma implementação foi alterada
nesta etapa. Foram registrados os hashes dos 218 arquivos da árvore rastreada
e não rastreada, além do manifesto staged. Somente este relatório foi atualizado;
as alterações staged e unstaged anteriores foram preservadas.

Conferência final por SHA-256: **217/218 arquivos idênticos**, com diferença
somente neste relatório. Inventário de arquivos e manifesto staged permaneceram
idênticos aos registrados na abertura; nenhum arquivo local foi descartado.

### Execução e cobertura

Executados uma única vez nesta homologação:

```powershell
npm.cmd test
npm.cmd run check
git diff --check
```

`npm test` executa `node --test`, incluindo os seis testes Node de Auth sintético.
Não executa `scripts/run-app-injection-browser.mjs`: esse runner não pertence
à descoberta automática, nem é chamado pelos testes globais. Por essa lacuna
de cobertura, executou-se **uma única complementação**:

```powershell
node scripts/run-app-injection-browser.mjs
```

Não foram repetidos runners dedicados já cobertos pela suíte global, nem
auditorias de segurança. Os testes browser que a própria suíte executa por
padrão foram preservados. O runner complementar verifica o aplicativo/DOM real
com Auth e I/O remotos sintéticos, sem Firebase real ou Emulator.

| Verificação | Total | Aprovados | Falhas | Ignorados | Cancelados | Saída |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `npm.cmd test` | 859 | **853** | **0** | **6** | **0** | **0** |
| Probes Auth sintético Edge/Chrome | 2 | 2 | 0 | 0 | 0 | 0 (runner) |
| Probes anteriores de ciclo de vida Edge/Chrome | 2 | 2 | 0 | 0 | 0 | 0 (runner) |
| Regressões do bootstrap no runner | 14 | 14 | 0 | 0 | 0 | 0 |
| `npm.cmd run check` | — | Aprovado | 0 | 0 | 0 | 0 |
| `git diff --check` | — | Aprovado | 0 | 0 | 0 | 0 |

A suíte global durou **76733,3732 ms**. As contagens dos probes e das regressões
browser são próprias do runner e não foram somadas aos 859 testes globais. Não
houve falha que exigisse investigação ou reexecução de teste afetado.

Os seis ignorados são gates existentes condicionados ao Emulator:

- protocolo epoch e invariantes do servidor;
- integração sintética Auth/Firestore com persistência cifrada;
- fábrica Firebase real + AutomaticFinanceSync + cofre no SDK/Emulator;
- transações/configurações do cliente nas regras do Emulator;
- barreira de gerações para restauração e preservação de recuperações;
- regras Firestore de isolamento por UID e tombstones.

Não foram removidos, enfraquecidos ou convertidos em aprovação. Não representam
falha desta ponte sintética, mas também não constituem cobertura de Auth real,
Emulator ou autorização financeira nesta homologação.

### Evidências de aprovação

| Critério | Evidência consolidada |
| --- | --- |
| Regressões existentes | 853 aprovações globais e 14 regressões do runner, zero falhas |
| Inicialização padrão | Casos default/injetado, falha de inicialização, persistência e reinício aprovados; código de produção inalterado |
| Ativação exclusivamente explícita | Sem `lifecycle_probe=1`, o harness não expõe controlador; o aplicativo publicado não interpreta a flag |
| Callbacks antigos/duplicados | Seis testes Node da ponte incluídos na suíte e probes nos dois engines: rejeição por intenção/inscrição e duplicata sem transição adicional |
| Logout/suspensão | Callbacks retidos não restauram identidade; retomada fica `locked/unconfirmed`; logout termina sem proprietário |
| Cofre inacessível | Contador de abertura de adaptador zero, sem chamadas a unlock e sem fases `unlocking`, `ready` ou `operating` nos probes |
| Integridade financeira | Estado/fila local e chaves de A/B idênticos antes/depois dos eventos, sem criação de par financeiro de conta pelo probe |
| Inicialização única | Nos fluxos com Auth sintético, um observador por documento, com inscrição existente reutilizada quando há sincronização; eventos de fábrica sem duplicação |
| Erros de página | Nenhum nos probes manuais ou Auth em Edge e Chrome; nenhum lançamento de navegador falhou |

As regressões que criam/alteram lançamentos usam dados sintéticos em perfis
próprios, como antes. A prova de integridade da ponte é a comparação explícita
antes/depois de seus eventos; não é uma alegação de que testes financeiros da
suíte nunca escrevam nas suas próprias fixtures. Nenhum banco pessoal foi
aberto ou limpo.

Logs desta etapa em `%TEMP%`:

- `cf-bootstrap-synthetic-auth-consolidated-test.log`;
- `cf-bootstrap-synthetic-auth-consolidated-check.log`;
- `cf-bootstrap-synthetic-auth-consolidated-browser.log`.

Perfis persistentes sintéticos retidos: `cf-app-injection-msedge-g2sH9w`,
`cf-app-injection-msedge-KYzjqe`, `cf-app-injection-chrome-vdCish` e
`cf-app-injection-chrome-EkWKai`. Nenhum perfil, IndexedDB, fila ou cache existente
foi limpo.

### Pendências, riscos e decisão consolidada

Não há falha funcional pendente identificada nesta rodada. Permanecem fora do
escopo os seis gates ignorados, Auth real/Emulator, desbloqueio, criptografia,
BFCache real, revogação entre abas e recuperação financeira através desta ponte.
Os resultados anteriores dessas áreas não foram apresentados como homologação
nova. Suspensão/retomada aqui continuam sendo chamadas explícitas ao controlador.

A ponte continua sendo coordenação sintética de identidade, sem autoridade
sobre o backend/DOM financeiro legado. `confirmed` não prova credencial real;
o estado bloqueado do controlador não converte a interface publicada em cofre.
Uma futura ampliação precisará de escopo e validações próprios.

**Decisão: APROVADA a homologação consolidada da integração experimental
Auth sintético → Lifecycle → Bootstrap, restrita ao harness isolado.** Não há
aprovação de Auth real, autorização financeira, criptografia ou ativação do
cofre no aplicativo publicado. A entrega termina nesta homologação, sem commit,
push, merge, deploy, migração, limpeza ou início automático de outra fase.
