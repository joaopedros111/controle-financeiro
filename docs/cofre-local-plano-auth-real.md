# Plano de integracao futura - Lifecycle e Firebase Auth

Consolidacao de 2026-11-04; o registro anterior esta arquivado ao final para preservar contexto. Esta secao e a referencia atual.

## Estado e decisao documental

C01-C10 estao concluidos localmente; esta consolidacao e o candidato C11, sem commit. Indice principal reconciliado e limpo; quatro untracked preservados: checkpoint Git, plano Auth real, relatorio PoC e firebase.auth-firestore.poc.json. O checkpoint e a configuracao combinada permanecem EXCLUIDOS de C11. Somente os dois documentos definidos no checkpoint entram no indice alternativo.

**C11 PRONTO para revisao e autorizacao de commit documental**, limitado as evidencias acima. Isso nao autoriza publicacao, merge, deploy, Auth de producao, migracao, desbloqueio ou cofre no aplicativo principal. Defaults e carregamento financeiro legado pre-Auth permanecem preservados. O app publicado nao importa nem ativa o Lifecycle/cofre experimental.

## Arquitetura e contratos atuais

A fabrica criarFirebaseSync() de firebase-sync-entry.js expoe onUser(callback); AutomaticFinanceSync.start(), em automatic-finance-sync.js, e seu consumidor legado. O bootstrap de app.js continua carregando o estado financeiro antes da autenticacao; nao foi deslocado nem condicionado ao cofre. O Lifecycle continua experimental e restrito a identidades sinteticas.

A prova do SDK/Emulators ja foi implementada e homologada nos cenarios abaixo: experimental/auth-emulator-poc-session.js, experimental/firebase-sync-lifecycle-poc.js, scripts/run-auth-emulator-poc.mjs, scripts/run-firebase-sync-lifecycle-poc.mjs, testes e fixtures do harness de navegador. Nao repetir a implementacao dessa prova a partir do plano historico.

Contratos aprovados para a PoC: confirmed exige identidade SDK valida E revalidacao remota explicita bem-sucedida; evento local/restauracao de persistencia nao bastam. Offline nao promove unconfirmed. Logout revoga localmente antes do signOut; falha remota nao restaura a identidade automaticamente, inclusive apos reload. Geracoes e sequencias rejeitam eventos antigos; duplicatas nao repetem transicoes. A identidade inclui projectId demo explicito e uid sintetico, sem tenant. Auth comprova identidade, nao autorizacao financeira.

## Proxima integracao, ainda nao autorizada

Reutilizar a entrega onUser existente, sem segunda inscricao; manter ordem, retorno, cancelamento e erros do consumidor legado. Efeitos experimentais nao podem bloquear o consumidor financeiro. Ativacao deve ser explicita, inicialmente desligada, com defaults intactos e sem migracao.

Antes de codigo publicado, decidir validade da revalidacao, politicas de usuario real/tenant, autoridade do backend, autorizacao offline financeira, drenagem conjunta (incluindo idbPendente), revogacao entre abas reais e selecao de modo ANTES da primeira leitura financeira. O carregamento legado pre-Auth impede tratar simples confirmacao Auth como autorizacao financeira ou associar estado legado a uma conta por inferencia.

Rollback futuro deve desligar apenas a coordenacao opt-in, preservar filas/ACKs/conflitos/tombstones e nao reinterpretar bloqueio ou erro como estado vazio. Nenhuma reversao de dados ou limpeza e autorizada. A integracao publicada exige escopo proprio e testes de default, A-B-A, logout concorrente, callbacks tardios, offline, restart, BFCache e isolamento. As seis suites ignoradas e a intermitencia Pages devem continuar visiveis no gate de publicacao.

## Evidencias consolidadas

Base: branch `security/cofre-local-etapa1`, HEAD `1f4abc256105197b412ff7a785226b5a2226f88f`, 230 arquivos conferidos por SHA-256 antes e depois. Resultado ATUAL: `npm.cmd test`, de 2026-11-04T20:16:23.834Z a 2026-11-04T20:17:32.478Z (UTC), duracao 68.643 s, saida 0: **867 testes, 861 aprovados, zero falhas, seis ignorados**, zero cancelados/todo. A suite foi executada uma unica vez nesta retomada.

Log completo atual: `%TEMP%/cf-global-recheck-28fc59ac41e6489aa6141f2c0eb8dd5b/npm-test.combined.log`. SHA-256: `0d304ce805b1728731f567c5b0994de5b5f67507c1e8bc8c7f825abaf423593b`. stdout e stderr separados, codigos, horarios e hashes estao em test-result.json nessa pasta; stderr vazio.

Os demais ensaios abaixo sao OBSERVADOS na rodada anterior de 2026-11-04, na MESMA arvore e com arquivos preservados, em `%TEMP%/cf-final-validation-e75ac592469b4997915c7b8650c9486d`; nao foram repetidos nesta retomada. Seus hashes completos permanecem em execution-summary.json e no catalogo desta preparacao.

| Conjunto | Aprovados/falhas/ignorados | Saida | Log |
| --- | --- | --- | --- |
| Global atual | 861/0/6 | 0 | npm-test.combined.log |
| 00-git-integrity | sem contagem de testes | 0 | 00-git-integrity.log |
| 01-check | sem contagem de testes | 0 | 01-check.log |
| 03-lifecycle-auth | 24/0/0 | 0 | 03-lifecycle-auth.log |
| 04-cp05 | 6/0/0 | 0 | 04-cp05.log |
| 05-sync-bridge | 8/0/0 | 0 | 05-sync-bridge.log |
| 06-auth-emulator | 10/0/0 | 0 | 06-auth-emulator.log |
| 07-sync-auth-emulator | 7/0/0 | 0 | 07-sync-auth-emulator.log |
| 08-financial-emulators | 3/0/0 | 0 | 08-financial-emulators.log |
| 09-auth-browser | 18/0/0 | 0 | 09-auth-browser.log |
| 10-auth-tabs-bfcache | 16/0/0 | 0 | 10-auth-tabs-bfcache.log |
| 11-idb-browser-restart | 6/0/0 | 0 | 11-idb-browser-restart.log |
| 12-diff-check | sem contagem de testes | 0 | 12-diff-check.log |

Nao somar suites direcionadas nem contagens internas dos harnesses browser ao total global: ha sobreposicao. Os oito ensaios de falha da ponte/Lifecycle e os seis grupos IndexedDB possuem logs atuais da rodada anterior; a antiga limitacao documental de memoria apenas e tolerancia nao testada foi superada por esses ensaios. A comparacao financeira possui tres grupos e oito checkpoints; o modo IndexedDB compara controle/composicao em Edge e Chrome apos reload e reinicio de processo.

Os seis testes condicionais IGNORADOS na global sao:
- epoch emulator: protocol and server-enforced invariants (1.9109ms) # SKIP
- synthetic Auth/Firestore Emulator integration with isolated encrypted persistence (1.3586ms) # SKIP
- real Firebase factory + AutomaticFinanceSync + encrypted vault, isolated SDK/Emulator (1.9705ms) # SKIP
- cliente de produção executa transações e configurações nas regras do Emulator (0.2928ms) # Requires Firestore Emulator
- generation barrier atomically publishes complete restores, fences legacy/offline clients and retains recovery namespaces (0.4917ms) # Requires Firestore Emulator
- Firestore rules restrict records by UID and require tombstones (0.1865ms) # Requires Firestore Emulator

Os opt-ins dessas suites ficaram desativados; os ensaios SDK contra Emulators foram executados separadamente na rodada anterior. Nao afirmar que estes substituem a cobertura das seis suites ignoradas. Nenhum Firebase de producao ou credencial real foi fornecido aos testes.

### Historico e intermitencia Pages

- Global historica 853/0/6: observada em cf-auth-global-test.log, preservado na auditoria cf-git-finalization-1KHSdc.
- Alegacao historica 861/0/6: continua SOMENTE RELATADA, sem log primario localizado daquela rodada. O resultado atual 861/0/6 e uma execucao NOVA; nao autentica retroativamente a alegacao antiga.
- Rodada imediatamente anterior: 860/1/6, saida 1, falha em tests/pages-build.test.js:11. UNKNOWN (-4094), syscall open ao reescrever copia temporaria app.js em scripts/prepare-pages.mjs:91. Evidencia integral preservada em 02-global.log e failure-pages-build.txt na rodada anterior.
- Diagnostico isolado posterior: duas execucoes de node --test tests/pages-build.test.js, ambas 2 aprovados/0 falhas/0 ignorados, saida 0. Logs em cf-pages-diagnosis-90da50e20e0f4883bbe624ef99ae839a.
- A global atual passou sem alteracao de codigo. Classificacao: possivel falha intermitente, causa-raiz NAO DETERMINADA. Nao houve patch nem prova de correcao de antivirus, concorrencia ou filesystem. Duas copias observadas do app.js temporario gerado e eventos de filesystem estao na pasta da global atual. O cleanup normal do teste continua ativo.

Se reaparecer, coletar operacoes nativas de arquivo com processo/status Windows e filtro nos diretorios dedicados, mediante autorizacao; nao introduzir retries para mascarar a falha. Esse risco residual permanece registrado apesar da aprovacao atual.

## Registro historico anterior a consolidacao

<details>
<summary>Arquivo anterior integral: decisoes e limitacoes pertencem as respectivas rodadas</summary>

O texto abaixo e historico. Conclusoes de bloqueio, passos ainda nao implementados e declaracoes de ausencia de commits nao descrevem o estado atual. Valem as evidencias e limites consolidados acima.

# Plano de integração futura — Lifecycle e Firebase Auth

Data: 2026-11-04. Branch `security/cofre-local-etapa1`, HEAD `1e0f4a5`.
Documento de análise da árvore local, incluindo staged e unstaged. Não implementa
integração, não altera contratos e não autoriza conexão com produção.

Base informada: 853 testes globais aprovados, zero falhas, seis ignorados e
18 cenários Edge/Chrome aprovados para a integração sintética. São evidências
anteriores, não testes executados nesta análise. Foram inspecionados apenas
trechos dos cinco arquivos abaixo; nenhum teste, build ou Playwright foi iniciado.

## Arquitetura atual e pontos de integração

| Local na árvore atual | Contrato e efeito observado |
| --- | --- |
| `storage.js:154`, `:155`, `:166` | Registro único e captura congelada de dependências. Aceita storage e as fábricas `openPersistence`, `createAtomicService`, `createAutomaticSync`, `loadFirebase`, `readLegacyMetadata`. Não aceita uma configuração arbitrária de Lifecycle |
| `app.js:619` | `carregarEstado()` lê o legado financeiro antes de Auth |
| `app.js:737`, `:760`, `:765` | Abre persistência, cria serviço, verifica par antigo, inicializa estado/fila locais e instala estado/base antes de handlers e Auth |
| `app.js:668` | `salvar()` captura proprietário/backend e encadeia trabalho em `idbPendente`. Um save já aceito pode concluir para o dono anterior; a guarda impede publicar seu resultado na nova sessão |
| `app.js:4885`, `:4888`, `:4924` | Prepara cliente e sincronizador. `initialize` compartilha Promise; falha para o controller e permite retry de cinco segundos. Online/focus podem retomar inicialização |
| `app.js:4944`, `:4950` | Login chama `client.login()` no gesto; logout chama `client.logout()`. Não chamam o Lifecycle |
| `app.js:4894`, `:4903`, `:4915` | `onTransition` limpa a apresentação anterior, muda chave e bloqueia persistência; `onAccount(null)` retorna ao estado local; `onState` instala finanças e libera UI |
| `firebase-sync-entry.js:55`, `:66`, `:79` | Fábrica cria App/Auth e também Firestore. Auth usa a hierarquia localStorage/IndexedDB/sessionStorage. `ready()` aguarda `authStateReady`, consulta redirect e devolve `currentUser`; exceção de rede do redirect tem tratamento offline específico |
| `firebase-sync-entry.js:88` | `onUser(callback)` encapsula uma inscrição `onAuthStateChanged`. Login usa popup Google e logout usa `signOut`; guardas remotas comparam UID com `auth.currentUser` |
| `automatic-finance-sync.js:33`, `:53`, `:63` | `start()` é o consumidor do observador; `stop()` cancela a inscrição. `useAccount` renova contexto, chama `onTransition`, espera saves e lê/inicializa finanças antes de `onAccount` |
| `experimental/finance-vault-lifecycle.js:6`, `:53`, `:68`, `:121` | Dono aceito somente com projeto `demo-*` e UID `synthetic-*`; identify possui intenção própria e produz locked/signed-out/error. Unlock é uma autorização distinta. Fechamento invalida época e drena suas próprias tarefas locais |

```text
fluxo financeiro atual
  legado → IndexedDB/serviço → hidratação local → render inicial
    → loadFirebase → cliente SDK → AutomaticFinanceSync.start
      → client.onUser → useAccount → callbacks de UI/sincronização

SDK: onAuthStateChanged → único observador consumido pelo sincronizador
SDK: authStateReady/redirect → prontidão, sem segundo fluxo de identidade
```

O caminho manual antigo está protegido por `LEGACY_MANUAL_SYNC_ENABLED = false`
(`app.js:3952`). Não deve ser reativado para esta integração.

### Limites que impedem uma ligação direta

1. `onTransition` é síncrono; `useAccount` não aguarda uma Promise retornada por
   ele. Chamar `identify` ali não cria uma barreira de autorização financeira.
2. Esperar em `onAccount` também é tarde para impedir leitura/criação financeira:
   `useAccount` já chamou `readLegacy`, leu o banco e executou `inicializar`.
3. `close()` do Lifecycle drena tarefas feitas por sua própria API; os saves de
   `app.js` estão em outra cadeia, `idbPendente`. Não presumir drenagem conjunta.
4. O controlador atual não aceita projetos/UIDs reais. Não remover os prefixos
   de teste nem mapear identidades reais para identidades sintéticas por conveniência.
5. `onUser` entrega User ou null, sem a sequência controlada da fonte sintética.
   A solução sintética não pode ser copiada como prova de ordem do SDK real.

## Proposta: uma fonte de identidade, inicialmente só observação

No fluxo composto do aplicativo, manter **AutomaticFinanceSync como titular da
única inscrição**. Na composição explicitamente injetada do harness, decorar o cliente
retornado por `loadFirebase`/`criarFirebaseSync`, reutilizando os pontos existentes.
O facade cobre `onUser`, login/logout e prontidão; os demais métodos mantêm seus
contratos e vínculo ao cliente original. Não é necessário novo registro de
dependências nem novo módulo de runtime para a primeira experiência.

O `onUser` decorado chama o original exatamente uma vez. A mesma entrega alimenta
a coordenação de identidade do Lifecycle e o consumidor existente, sem criar
outra assinatura SDK. Retorna um unsubscribe síncrono e idempotente, que invalida
imediatamente o contexto da inscrição antes de cancelar o observador. Retry cria
uma nova geração de inscrição; uma antiga não pode atuar na nova.

Não usar `ready().then(user => identify(user))` como segunda autoridade: em
`start`, ready é uma barreira de prontidão e a identidade vem do observador.
Não repetir `ready()` a cada evento, pois também consulta redirect/persistência.
O evento inicial válido, inclusive null, deve resolver a inicialização uma vez;
erro ou cancelamento devem ter término definido, sem esperar eternamente esse evento.

**Primeiro alcance:** SDK real ligado a Auth/Firestore Emulator, contas sintéticas
e banco/perfil dedicados; Lifecycle apenas observa identidade, sem unlock,
adaptador de cofre, migração ou autoridade sobre finanças. Os validadores demo
atuais podem permanecer nessa fase. A fábrica cria Firestore junto de Auth:
configurar ambos os serviços isolados antes de qualquer uso, sem recorrer ao
cliente/cache de produção por omissão.

Observação de identidade não suspende a persistência legada: se o sincronizador
estiver ativo, `useAccount` ainda poderá inicializar/hidratar contas, como hoje.
Nesse composto, comparar com uma execução de controle sem a ponte, usando as
mesmas fixtures. Para uma prova estrita de zero escrita financeira, usar o probe
de identidade sem sincronizador financeiro ativo e uma única inscrição do
cliente pelo harness. Nunca iniciar o sincronizador e suprimir indefinidamente
seu evento inicial, nem acrescentar essa inscrição em paralelo à dele.

Depois dessa prova, identidades reais de um ambiente autorizado exigirão revisão
específica do contrato de proprietário, projeto e eventual tenant. A origem deve
ser a instância SDK/configuração confiável, nunca URL, email, estado financeiro
local ou mera existência de uma chave. Não ampliar o validador nesta análise.

## Tratamento de eventos, erros e concorrência

### Identidade e callbacks atrasados

- Separar geração de inscrição, intenção de login/logout, contexto da sessão
  aceita e época financeira. Cada abertura tem identidade opaca nova, inclusive
  A→B→A. Revalidar o contexto após awaits e antes de entregar UI, persistência ou ACK.
- Registrar intenção de encerramento antes de chamar o SDK. Fechar a entrada
  local imediatamente; resultado de popup, ready ou finally antigo não concede
  identidade nem restaura recursos. O observador atual e a verificação do estado
  SDK atual orientam a reconciliação da identidade, não o payload de uma Promise antiga.
- Um contador incrementado na **entrega** não prova que um callback SDK antigo
  seja novo. A fábrica tem acesso a `auth.currentUser`; definir ali uma leitura
  restrita da identidade atual para conferir compatibilidade com o evento, sem
  expor tokens ou o objeto Auth bruto à aplicação.
- UID atual igual não distingue uma sessão antiga de uma nova do mesmo usuário.
  Se não houver prova de frescor suficiente, conservar locked/unconfirmed e
  exigir revalidação explícita; jamais restaurar a sessão/chave anterior.
- Duplicata na mesma inscrição/contexto, sem nova intenção relevante, não repete
  identificação ou hidratação. Comparar só UID é insuficiente. Após lock/suspend,
  uma repetição do usuário em cache não promove unconfirmed nem desbloqueia.
- Mudança SDK inesperada deve retirar a capacidade anterior e produzir estado
  de reconciliação/erro. Ignorar a divergência mantendo outro dono ativo seria inseguro.

### Comandos e falhas

Preservar popup no gesto do clique: não enfileirar sua abertura para depois de
um await ou timer. Enquanto uma tentativa SDK anterior estiver pendente, uma
nova tentativa deve ser impedida ou exigir novo gesto quando puder começar.
Logout local pode encerrar sem esperar rede; a estratégia para concluir signOut
e tratar uma tentativa de login ainda em voo precisa ser definida. Revogar uma
intenção não cancela os efeitos de uma Promise SDK sobre `currentUser`.

| Situação | Tratamento proposto |
| --- | --- |
| Popup cancelado/bloqueado ou falha da tentativa de login com sessão válida já existente | Erro da tentativa separado da identidade; não fabricar null, apagar dados ou invalidar a conta por inferência |
| Falha de inicialização ou identidade indeterminada | Erro recuperável explícito; sem estado financeiro vazio, troca silenciosa de backend ou retry que conceda acesso |
| Null atual do observador | Ausência de sessão SDK, distinta de falha de rede; encerrar contexto correspondente. O retorno legado a @local permanece comportamento padrão |
| Encerramento em andamento | Bloquear novas intenções daquele contexto, preservar/drainar saves locais aceitos e não depender de ACK remoto para concluir fechamento local |
| ACK/consulta antigos | Não modificar sessão/UI atuais; manter correlação de operação/geração e filas duráveis. Stop não desfaz requisição já aplicada pelo servidor |

O contrato `onUser` atual não expõe erro da assinatura ou renovação de token.
Definir como falhas de ready/login/logout e autorização remota chegam à ponte,
sem criar uma segunda inscrição de identidade. Não prometer detecção de revogação
remota apenas porque se observa User/null.

### Offline e múltiplas sessões

O modo legado conserva suas leituras e filas offline. No experimento, usuário
restaurado do cache comprova uma identidade observada, não uma validação remota
recente nem posse de chave. Definir o significado de confirmed antes de codificar:
o próprio Lifecycle usa essa classificação para permitir send quando desbloqueado.
Não usar `navigator.onLine` como prova, nem promover ao receber somente online.

Na ausência de comprovação suficiente, manter identidade unconfirmed/bloqueada;
sem usuário SDK, não atribuir @local a A/B. Reconexão exige revalidação no contexto
atual. Mesmo UID sem novo evento também precisa de um caminho explícito de
revalidação, não de um segundo observador.

Cada aba terá no máximo uma inscrição ativa, mas contextos distintos. Logout
local, troca propagada pelo SDK, lock do cofre e revogação em outro dispositivo
não são equivalentes. Aba suspensa/BFCache exige revalidação; callbacks e
BroadcastChannel não substituem época durável no commit. Esse fence financeiro
continua fora do primeiro experimento sem adaptador.

## Riscos do carregamento financeiro antes de Auth

O bootstrap atual já põe plaintext financeiro em memória e renderiza antes de
resolver Auth. O overlay e `idbBloqueado` não retiram dados já carregados nem
protegem todos os leitores/exportadores. Acrescentar um observador ou deixar o
Lifecycle em locked não transforma esse fluxo em cofre bloqueado.

Manter esse comportamento para usuários sem cofre é requisito de compatibilidade.
Uma futura modalidade cifrada exigirá seleção autoritativa de modo **antes de
`carregarEstado()` e de abrir/inicializar o backend financeiro**, sem fallback
para legado diante de erro/locked. Auth, desbloqueio, recuperação e autorização
financeira serão barreiras distintas. Essa mudança de ciclo de vida deve ser
autorizada separadamente, não embutida na conexão de identidade.

Também será necessário conectar a drenagem de `idbPendente` ao fechamento:
não cancelar uma gravação já aceita só porque a UI mudou de conta, nem anunciar
lock concluído enquanto ela depende de capacidade a revogar. Preservar geração,
IDs, filas, conflitos, tombstones, recuperações e CP-05, sem reimplementar essas regras.

Firestore usa cache persistente multiaba por padrão. Uma futura modalidade de
cofre precisa de política própria para cópias financeiras fora do banco cifrado;
trocar a opção de cache não apaga cópias antigas e não autoriza limpá-las. O
experimento de Auth não deve iniciar esse trabalho nem alterar defaults.

## Ativação gradual e etapas propostas

| Etapa futura | Escopo e possíveis pontos de mudança | Gate para avançar |
| --- | --- | --- |
| 0 — contrato | Aprovar origem de identidade, frescor, deduplicação e encerramento descritos abaixo | Decisões registradas; padrão continua sem Lifecycle |
| 1 — SDK no harness | Injeção existente de loadFirebase com SDK/Emulators; decorar uma inscrição no cliente; manter adaptador proibido e IDs demo | Instrumentar inscrição/cancelamento, eventos iniciais, falhas e identidade; nenhuma autoridade financeira nova |
| 2 — concorrência real do SDK | Exercitar popup/ready/signOut, retry, A–B–A, mesmo UID, offline/reinício, duas abas e BFCache | Critérios objetivos abaixo aprovados e validação consolidada; sem migração |
| 3 — contrato de identidades reais | Revisão autorizada de `validOwner`, projeto/tenant e compatibilidade das chaves; sem maquiar IDs como sintéticos | Escopo/ambiente autorizados e isolamento comprovado; não implica liberação de produção |
| 4 — eventual conexão publicada | Proposta específica para hooks opcionais em `firebase-sync-entry.js`/`AutomaticFinanceSync.start` e fases de `app.js`, apenas se a composição injetada não bastar | Revisão própria de UI, armazenamento, fechamento e distribuição; modo financeiro/cofre ainda separado |

Começar com opção confiável de composição de teste, **desabilitada por padrão**,
avaliada antes de importar app. A flag atual da fixture não é uma configuração
de produção. Não ativar por UID, URL pública, localStorage ou descoberta de dados.
Reutilizar os módulos/contratos atuais; não criar um framework de autenticação.

## Critérios objetivos de aprovação e reversão

Para autorizar a implementação inicial: aprovar explicitamente o escopo somente
de identidade no Emulator, o proprietário da inscrição, o contrato de erros e
a política para comandos pendentes. Validadores reais e autoridade financeira
podem continuar bloqueados em etapas separadas; não serão ampliados implicitamente.

Para aprovar a implementação futura, exigir evidências reproduzíveis de:

1. Uma inscrição SDK ativa por documento e zero inscrição extra do Lifecycle;
   cancelamento uma vez por inscrição e nenhuma entrega válida da geração antiga.
2. Inicialização inicial válida/null/erro com término definido; sem prontidão
   falsa, inicialização duplicada ou deadlock após callback inicial descartado.
3. A, B, logout, falha, duplicata, A–B–A e mesmo UID corretos em cada await;
   logout/suspend vencem trabalho antigo, retomada permanece unconfirmed e nenhuma
   Promise antiga promove acesso. Não presumir sequência da fonte sintética no SDK.
4. Zero chamada de unlock/abertura de adaptador na fase de identidade. Falha não
   significa vazio. No probe sem Sync financeiro, estado/fila e referências devem
   permanecer idênticos antes/depois; no composto legado com Sync, exigir
   equivalência com o controle sem Lifecycle, incluindo inicialização e ACKs
   esperados. Nenhuma operação, confirmação ou migração adicional pela ponte.
5. Offline/restart, duas abas e BFCache real em Edge/Chrome, com SDK/Emulators e
   dados sintéticos; nenhum tráfego para serviços de produção nesses ensaios.
6. Defaults equivalentes, inclusive carregamento pré-Auth, popup no gesto,
   persistência/cache e erro; ausência do opt-in mantém o fluxo anterior.
7. Após os testes dirigidos, validação consolidada autorizada, com aprovados,
   falhas, ignorados e não executados separados. Os seis ignorados atuais não
   substituem provas específicas do SDK/Emulator que sejam necessárias à etapa.

Reverter o experimento significa desabilitar sua composição no próximo bootstrap,
invalidar/cancelar a inscrição e encerrar seu contexto antes de criar outra.
Como a captura de dependências é única, não trocar fábricas em uma sessão ativa:
preferir reinício controlado, após preservar/drainar as operações locais aceitas.
Não alterar a sessão SDK ou fazer signOut somente para reverter observação.

Sem schema, backend ou formato novos, a reversão é de composição/código, não de
dados: nenhuma cópia antiga deve sobrescrever estado atual e nenhuma fila/cache
deve ser limpa. Se futuramente houver escritas cifradas, essa reversão simples
deixa de ser válida; exige leitor/recuperação compatível com o destino mais novo.

## Decisões pendentes antes de alterar código

- O que confirmed comprova: identidade SDK restaurada ou validação remota recente?
  Qual evidência permite revalidar sem novo evento do mesmo UID?
- Como representar falha da tentativa, falha do bootstrap e identidade ausente,
  mantendo uma única fonte e sem converter erros em logout?
- Como concluir signOut diante de popup pendente, timeout ou falha, permitindo
  fechamento local seguro sem disparar popup fora de um novo gesto?
- Qual política para evento de conta vindo de outra aba, retomada offline e
  BFCache? Aceitar identidade não pode equivaler a conceder chave ou acesso financeiro.
- Qual contrato aceitará projetos/UIDs reais e eventual tenant? Se não houver
  suporte a tenant, como rejeitá-lo explicitamente sem unir donos distintos?
- Quem será a autoridade financeira futura e como drenará saves do app fora da
  fila interna do Lifecycle? Qual mecanismo confiável selecionará o backend?
- Que ambiente e limites permitirão um piloto posterior com identidades reais,
  considerando que a fábrica também instancia Firestore e cache?

**Primeiro passo recomendado:** aprovar o contrato de observação única e de
erros/intenção, então autorizar somente uma prova com o SDK real no Emulator,
identidades demo e adaptador bloqueado, pelas fábricas já injetáveis. Nenhuma
dessas implementações foi iniciada por este documento.

## Consolidação dos cinco contratos — proposta para ratificação

As definições abaixo consolidam a recomendação de planejamento; não são
contratos já implementados nem autorização para iniciar código.

1. **Identidade confirmada ou não confirmada.** `confirmed` exige identidade
   compatível com a instância SDK confiável e revalidação remota bem-sucedida,
   vinculada à inscrição, intenção e sessão atuais. Cache, ready, popup isolado
   ou `navigator.onLine` não bastam. `unconfirmed` é identidade localmente conhecida,
   sem essa comprovação válida no contexto atual; não equivale a ausência de
   sessão. Erro de identidade indeterminada continua erro, nunca finanças vazias.
   Nenhuma das classificações concede chave, desbloqueio ou autorização financeira.

2. **Revalidação offline.** Reinício, suspensão/retomada e BFCache exigem nova
   comprovação antes de promover `unconfirmed`. Sem rede, não promover nem enviar
   operações remotas; preservar dono conhecido e trabalho durável, sem atribuir
   @local a uma conta. Reconexão apenas permite tentar revalidar: sucesso só vale
   se o contexto continuar atual. Perda de rede suspende envio, não significa
   logout. Acesso financeiro local offline dependerá de autorização própria;
   nada disso muda o comportamento legado nesta proposta.

3. **Logout vence login pendente.** Registrar a intenção de logout e invalidar
   capacidades/callbacks anteriores antes de chamar signOut. Concluir fechamento
   local após preservar/drenar commits aceitos, sem esperar ACK remoto. Resultado
   tardio de login não restaura sessão; duplicata não reabre contexto encerrado.
   Distinguir fechamento local de signOut ainda pendente/falho. Até reconciliar
   o SDK, impedir novos logins conflitantes; popup futuro exige novo gesto, não
   execução automática enfileirada. Não presumir cancelamento da Promise antiga.

4. **Projeto, tenant e usuário.** Principal identificado pela tupla exata
   `(projectId, tenantId|null, uid)`, obtida da configuração/instância SDK e do
   usuário correspondente. Email, URL, prefixos inventados e estado financeiro
   não definem dono. Mesmo principal em outra abertura recebe contexto novo.
   Recomenda-se tenant ausente explicitamente na primeira prova; tenant presente
   fica recusado até contrato aprovado. Isso é proposta futura: o controlador
   atual aceita somente projeto/UID demo e não deve receber tenant descartado
   silenciosamente ou ter seu validador ampliado nesta etapa.

5. **Auth separado da autoridade financeira.** A ponte decide somente identidade
   e encerramento de contexto. Acesso financeiro futuro exige, separadamente,
   backend autoritativo, proprietário compatível, desbloqueio/recuperação e lease
   atual; envio exige ainda permissão remota válida. Não transformar `confirmed`
   em permissão suficiente. A drenagem deverá abranger também `idbPendente`, não
   só tarefas internas do Lifecycle. Seleção de modo cifrado precederá qualquer
   leitura financeira; o fluxo legado pré-Auth permanece preservado até revisão
   própria. Na prova inicial: nenhum adaptador, unlock ou autoridade financeira.

6. **Gate mínimo para a prova isolada.** Exigir ratificação humana dos contratos
   e autorização específica de escopo. Usar SDK real com Auth e Firestore Emulator
   explicitamente configurados, projeto demo, usuários sintéticos sem tenant,
   perfil/banco dedicados e nenhuma rota para produção. Manter opt-in de teste,
   uma única inscrição Auth e adaptador bloqueado. Para exigir zero escrita,
   deixar Sync financeiro inativo. Aprovar previamente a matriz de evento inicial,
   erro, duplicata, callback atrasado, A–B–A, logout pendente e offline, com término
   definido, observadores sem duplicação e estado/fila preservados. A execução e
   suas evidências serão de outra etapa, não desta consolidação documental.

**Confirmações humanas ainda necessárias:** ratificar essas recomendações e
definir a operação SDK e a validade da revalidação remota; a política de espera,
erro e reconciliação de signOut pendente; o ambiente/projeto autorizado e a
restrição inicial sem tenant; e, antes de qualquer acesso financeiro, a política
offline, a fonte autoritativa de backend e o responsável pela drenagem conjunta.
Sem essas definições não se autoriza implementação ou promoção para produção.

</details>
