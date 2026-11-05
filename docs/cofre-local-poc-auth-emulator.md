# PoC Auth SDK -> Emulators -> Lifecycle

Consolidacao de 2026-11-04. As conclusoes abaixo atualizam o estado da PoC; as fases anteriores estao arquivadas ao final.

## Estado e decisao documental

C01-C10 estao concluidos localmente; esta consolidacao e o candidato C11, sem commit. Indice principal reconciliado e limpo; quatro untracked preservados: checkpoint Git, plano Auth real, relatorio PoC e firebase.auth-firestore.poc.json. O checkpoint e a configuracao combinada permanecem EXCLUIDOS de C11. Somente os dois documentos definidos no checkpoint entram no indice alternativo.

**C11 PRONTO para revisao e autorizacao de commit documental**, limitado as evidencias acima. Isso nao autoriza publicacao, merge, deploy, Auth de producao, migracao, desbloqueio ou cofre no aplicativo principal. Defaults e carregamento financeiro legado pre-Auth permanecem preservados. O app publicado nao importa nem ativa o Lifecycle/cofre experimental.

## Arquitetura e isolamento

Harnesses independentes do aplicativo publicado. Nucleo experimental/auth-emulator-poc-session.js; ponte experimental/firebase-sync-lifecycle-poc.js; fabrica Firebase real reutilizada por injecao. Auth Emulator 127.0.0.1:9099, Firestore Emulator 127.0.0.1:8080, projeto demo-controle-financeiro, usuarios synthetic-*. Nenhum endpoint ou credencial de producao. A configuracao versionada firebase.auth-emulator.poc.json e exclusivamente local; firebase.auth-firestore.poc.json permanece local e fora deste candidato. Nenhum servico e iniciado automaticamente.

Node usa persistencia Auth em memoria. Browser usa browserLocalPersistence em perfis novos dedicados. Restauracao/reload/reinicio e retorno BFCache nao confirmam autoridade automaticamente: requerem nova prova remota. Suspensao e logout invalidam eventos antigos. Revogacao local exclusiva da PoC persiste quando signOut falha e propaga entre abas; seu ciclo de vida e limpeza controlada permanecem documentados no registro historico. Nenhuma chave de producao foi reutilizada.

Uma inscricao Auth por instancia alimenta Lifecycle e consumidor legado, preservando entrega/cancelamento/erros do legado sem aguardar o Lifecycle. Erros/atrasos e duplicatas foram exercitados pelos oito testes de falha; nao restauram autoridade encerrada. Zero aberturas de adaptador de cofre na ponte de identidade; nenhuma autorizacao financeira nasce de confirmed. Testes de cofre de outras suites usam apenas fixtures sinteticas e armazenamento proprio.

## Comparacao financeira e durabilidade

Executores: scripts/run-firebase-sync-lifecycle-poc.mjs (opt-in FIREBASE_SYNC_LIFECYCLE_POC=1; FIREBASE_SYNC_FINANCIAL_ONLY=1 para comparacao financeira) e scripts/run-app-injection-browser.mjs (AUTH_EMULATOR_POC_ONLY=1, FIREBASE_SYNC_IDB_ONLY=1 para restart).

A comparacao usa estado, revisoes, IDs, filas e ACKs sinteticos. ACK somente apos resposta do SDK. Oito checkpoints cobrem equivalencia com/sem composicao; ensaios IndexedDB dedicados cobrem reload, dois reinicios reais do processo, fila pendente, ACK duravel, retry sem ACK extra e logout sem perda dos documentos. Edge e Chrome passaram nos seis grupos (controle, composicao, equivalencia por navegador).

Abas/BFCache: 16 cenarios aprovados, com duas restauracoes BFCache efetivas por navegador registradas no log, inclusive logout enquanto a pagina estava ausente. Teste sem BFCache efetivo nao deve ser contado como aprovacao BFCache. Browser bloqueia Service Workers e destinos fora do loopback autorizado; perfis sinteticos sao preservados pelos executores. Nenhum IndexedDB financeiro real foi lido, migrado ou limpo. Operacoes financeiras desta comparacao sao exclusivamente sinteticas; nao confundir com ausencia de qualquer operacao financeira experimental.

## Limites e gate futuro

Cenarios experimentais aprovados nao equivalem a OAuth, tenant, contas reais ou integracao irrestrita ao aplicativo. O gate futuro exige autorizacao de escopo, politica de autoridade financeira, selecao do backend antes da leitura, drenagem/session fencing e rollback sem sobrescrever dados. Defaults publicados, autenticacao, regras de producao e Service Worker continuam inalterados por esta etapa documental.

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

# PoC Auth SDK → Auth Emulator → Lifecycle

> O bloqueio inicial abaixo foi preservado como histórico. A seção de retomada
> ao final registra a implementação e a rodada funcional com o ambiente fornecido.

Data: 2026-11-04. Branch confirmada: `security/cofre-local-etapa1`.
HEAD: `1e0f4a57d555e09b66a6bd58dd15cd119d053341`.

## Decisão: execução bloqueada antes da implementação

O pré-requisito de disponibilidade do Emulator não foi atendido. A solicitação
determina interromper se o Emulator não estiver disponível ou a configuração
não for segura. Portanto, não foi criado harness nem instanciado Firebase Auth
SDK, e nenhum cenário funcional da PoC foi executado.

## Verificação efetivamente realizada

- Conferidos branch, HEAD e estado do Git; staged e unstaged preexistentes
  preservados, sem operações de staging ou commit.
- Consultada a consolidação de contratos do plano e os trechos necessários do
  controlador experimental: proprietário restrito a projeto `demo-*` e UID
  `synthetic-*`; confirmação de identidade não é desbloqueio financeiro.
- Tentada conexão TCP somente a **`127.0.0.1:9099`**, endpoint local de referência
  para Auth Emulator, com limite de 1500 ms.
- Resultado do diagnóstico: `{"host":"127.0.0.1","port":9099,"reachable":false}`.
  Isso comprova indisponibilidade desse endpoint nesta execução, não a ausência
  de uma instalação ou de Emulators em outras configurações.
- A consulta condicional ao hub local não foi executada, pois o endpoint Auth
  já estava inacessível. Nenhuma porta alternativa foi pesquisada ou escolhida.

Nenhum serviço foi iniciado automaticamente. Nenhuma requisição foi enviada a
endpoint de produção, nem houve fallback para Firebase real.

## Arquivos e resultados

Único arquivo criado: `docs/cofre-local-poc-auth-emulator.md`.
Nenhum módulo, teste, configuração ou relatório anterior foi modificado.

| Cenário solicitado | Resultado |
| --- | --- |
| Login A e troca A→B | Não executados — bloqueio de ambiente |
| Logout e falha de autenticação | Não executados — bloqueio de ambiente |
| Logout durante login pendente | Não executado — bloqueio de ambiente |
| Callback atrasado e evento duplicado | Não executados — bloqueio de ambiente |
| Suspensão/retomada sem desbloqueio | Não executadas — bloqueio de ambiente |
| Falha de revalidação remota | Não executada — bloqueio de ambiente |
| Ausência de autorização financeira pela PoC | Não homologada — implementação ausente |

**Rodadas de testes direcionados: zero.** Não há aprovações ou falhas funcionais
a contabilizar; todos os cenários ficaram não executados. O diagnóstico TCP é
uma verificação de pré-requisito, não um teste funcional aprovado da PoC.
Não foram executados suíte global, builds, Playwright ou novos testes sintéticos
como substituição da prova com SDK/Emulator.

## Configuração necessária e pendências para retomada

Antes de retomar, disponibilizar o Auth Emulator local e fornecer o `projectId`
demo explicitamente autorizado e o endpoint loopback correspondente. Não foi
inferido nem selecionado projeto de produção ou configuração alternativa.
A mera disponibilidade TCP ainda exigirá comprovação do serviço e configuração
corretos antes de instanciar o SDK.

A implementação futura deverá importar somente Auth SDK e módulos experimentais
necessários, sem `app.js`, Firestore ou persistência financeira; conectar o
Emulator antes de qualquer operação Auth; aceitar somente o projeto configurado,
tenant ausente e usuários sintéticos compatíveis com o controlador. Deve manter
uma inscrição `onAuthStateChanged`, adaptador proibido e nenhuma chamada a unlock.

Permanecem a implementar e comprovar: revalidação remota antes de confirmed,
fences de inscrição/intenção, deduplicação, logout local imediato mesmo se
signOut falhar, e preservação de unconfirmed offline/na retomada. Nenhuma dessas
garantias foi declarada comprovada por um simples evento local ou resultado TCP.

## Critérios para futura integração ao bootstrap

A PoC precisa primeiro executar, em uma rodada direcionada autorizada, todos os
cenários acima com o SDK real no Emulator e evidência de zero abertura de
adaptador e zero acesso financeiro. A aprovação sintética anterior não substitui
essa prova. Só depois caberá uma proposta separada para integração ao bootstrap,
preservando defaults e a distinção entre identidade e autorização financeira.

**Estado final: BLOQUEADA, não homologada.** Nenhum dado, fila, cache, perfil ou
IndexedDB existente foi limpo, lido ou alterado pela PoC; ela não foi iniciada.
Não houve migração, criptografia/cofre habilitado, commit, push, merge ou deploy.
Execução encerrada no pré-requisito, conforme solicitado.

## Retomada — ambiente disponível e PoC executada

Projeto autorizado: **`demo-controle-financeiro`**. Endpoint exclusivo:
**`http://127.0.0.1:9099`**. A configuração existente
`firebase.auth-emulator.poc.json` foi lida e preservada, incluindo seu BOM UTF-8;
host e porta são validados pelo harness antes de inicializar o SDK. O Emulator
já estava iniciado manualmente; esta execução não iniciou nem encerrou serviços.

O GET local `/emulator/v1/projects/demo-controle-financeiro/config` respondeu
**HTTP 200**, tanto na verificação prévia quanto no próprio harness antes dos
testes. Não houve escolha automática de outro projeto/endpoint ou fallback.

### Arquivos e arquitetura mínima

| Arquivo | Alteração desta execução |
| --- | --- |
| `scripts/run-auth-emulator-poc.mjs` | Novo: harness Node independente, ponte e dez cenários direcionados no mesmo arquivo |
| `docs/cofre-local-poc-auth-emulator.md` | Este registro da retomada e dos resultados |

Nenhum código de produção, controlador, teste anterior ou configuração foi
alterado. O script não importa `app.js`, storage, persistência, Firestore ou
serviço de sincronização. Reutiliza `createVaultLifecycle` sem mudar seu validador
demo/sintético e sem invocar APIs financeiras. Suas dependências financeiras
puras são avaliadas pelo import do controlador, mas não recebem operações.

O harness cria apenas Firebase App e Auth com **`inMemoryPersistence`**, conecta
explicitamente o Auth Emulator antes das operações e mantém **uma inscrição
`onAuthStateChanged`**. Não chama authStateReady para criar uma inscrição extra;
o próprio primeiro evento determina a prontidão. A/B são UIDs `synthetic-*`
com UUID exclusivo da execução, autenticados por custom tokens de teste aceitos
somente pelo Emulator. Não há chave privada, conta de serviço ou credencial de
produção. Os dois usuários sintéticos criados permanecem no Emulator; nenhum
usuário preexistente à execução foi apagado ou modificado pelo harness.

Antes do import do SDK Auth, o harness instala uma barreira no fetch capturado
pelo SDK Node: só permite a origem loopback exata, proíbe credenciais na URL,
recusa redirecionamentos e limita cada requisição a cinco segundos. A configuração
do SDK e a identidade são conferidas: projeto exato, UID A/B desta execução e
tenant ausente. Tokens/respostas com credenciais não são impressos ou gravados.

### Confirmação, contexto e encerramento

Evento local do SDK produz apenas `locked/unconfirmed`. A promoção para
`confirmed` depende de **`reload(user)` e `getIdTokenResult(user, true)`** com
sucesso real no Emulator, além de aud/sub e tenant compatíveis. A mesma instância
de usuário SDK, intenção e geração devem continuar atuais após cada await.
Mesmo confirmado, o controlador permanece `locked`, com `data:null`.

Uma fila serializa as operações de login/signOut, enquanto geração, UID desejado,
usuário SDK atual e modo local cercam callbacks e conclusões. Duplicata da mesma
entrega não repete transição ou requisição. A sequência local descreve o contexto
de recepção; não é apresentada como sequência de origem garantida pelo SDK.

Logout invalida imediatamente o contexto e inicia `close('logout')`, sem esperar
a Promise de login ou o signOut. A conclusão local pode chegar a signed-out
enquanto o login SDK continua retido. Se ele concluir depois, seu evento é
recusado; o signOut serializado reconcilia o SDK. Falha de signOut deixa o estado
local fechado e impede novo login até retry explícito, sem restaurar proprietário.
Suspensão/retomada invalidam o contexto e mantêm `locked/unconfirmed`, sem prova
remota ou desbloqueio automático.

### Rodada direcionada e evidências

```powershell
node scripts/run-auth-emulator-poc.mjs
```

A primeira invocação abortou **antes do preflight interno, SDK e cenários**:
JSON.parse rejeitou o BOM da configuração. Foi corrigida somente a leitura do
harness para aceitar o marcador inicial, preservando o arquivo de configuração.
Não houve repetição de cenário funcional: depois disso executou-se **uma única
rodada de dez cenários**, com saída **0**.

| Cenário funcional | Resultado |
| --- | --- |
| Login A; evento local retido em unconfirmed até prova remota | Aprovado |
| Evento duplicado sem novas transições/consultas | Aprovado |
| Troca A→B e callback antigo de A | Aprovado |
| Falha de revalidação offline, sem promoção; recuperação explícita | Aprovado |
| Suspensão/retomada sem confirmar ou desbloquear | Aprovado |
| Logout e rejeição de callback antigo | Aprovado |
| Rejeição real de custom token inválido pelo Emulator | Aprovado |
| Logout durante login real SDK retido no transporte | Aprovado |
| Falha na fronteira de signOut, sem restaurar identidade local | Aprovado |
| Uma inscrição, zero adaptadores e nenhuma autorização financeira | Aprovado |

Resumo emitido: **10 aprovados, 0 falhas, 0 não executados; 1 inscrição Auth;
0 aberturas de adaptador; 5 provas remotas concluídas; 19 requisições SDK ao
Emulator; 0 tentativas de requisição fora da origem permitida**. Todos os estados
registrados tiveram `data:null`, zero operações financeiras em andamento e
nenhuma fase `unlocking`, `ready` ou `operating`.

Logs externos ao projeto: `%TEMP%/cf-auth-emulator-poc-run.log` (abortagem inicial
do parser) e `%TEMP%/cf-auth-emulator-poc-functional.log` (rodada funcional).
Não foram executados suíte global, Playwright, builds ou testes não relacionados.

### Falhas injetadas e limites da evidência

- Sucessos de login, lookup/reload e renovação forçada são do SDK real contra
  o Auth Emulator. A rejeição de custom token inválido também veio do Emulator.
- A indisponibilidade de rede foi injetada na fronteira fetch: a tentativa de
  revalidação pelo SDK falhou e o dono permaneceu unconfirmed. Não se desligou
  o serviço manual, nem se simulou sucesso remoto.
- O login pendente foi retido antes do envio HTTP, depois liberado para concluir
  de verdade. Seu evento tardio chegou com o contexto já fechado e não o restaurou.
- SignOut do SDK em memória é local e não exige RPC de logout. A falha de signOut
  foi uma rejeição injetada imediatamente antes da chamada; não é alegada como
  falha interna real do SDK ou do servidor. O cenário manteve usuário no SDK e
  controlador signed-out/bloqueado, recusou novo login e só reconciliou após retry.
- Duplicatas/callbacks atrasados adicionais foram reentregas controladas de
  pacotes capturados da única inscrição, não criação de outro observador.

Não se comprovaram OAuth Google, comportamento browser, persistência de Auth
após reinício, BFCache real, múltiplas abas, tenant, revogação remota, expiração
de token, repetição de login do mesmo UID ou logout em outro dispositivo.
A repetição de prova da identidade atual foi exercitada pela API explícita de
revalidação, não por uma nova tentativa de signIn do mesmo UID.
Auth Emulator usa tokens de teste;
essas provas não autorizam usar tais tokens ou este harness com produção.

O controlador nunca recebeu unlock, adaptador ou chave. Nenhum banco, fila,
conflito, ACK, recuperação, cache ou dado financeiro real foi lido ou modificado.
O cleanup apenas cancela a inscrição e descarta a instância Auth/App em memória;
não limpa usuários do Emulator, IndexedDB, cache ou perfis existentes.

### Decisão e critérios para futura integração

**PoC de identidade isolada APROVADA nos dez cenários direcionados**, com as
injeções e limitações acima. O bloqueio inicial de ambiente foi superado, sem
fallback para Firebase real. Não se autoriza integrar Auth ao aplicativo principal.

Antes de uma integração ao bootstrap: testar SDK real no navegador e recuperação
de sessão, comprovar observer único junto à inicialização financeira atual,
definir frescor/revalidação e tratamento de erro compatíveis com o SDK, e provar
equivalência com o fluxo legado. A autoridade financeira, seleção de backend,
desbloqueio e drenagem continuam separados e não foram implementados nesta PoC.
Qualquer nova rodada/etapa depende de autorização própria. Nenhuma migração,
criptografia/cofre, commit, push, merge ou deploy foi realizado.

Conferência final: manifesto staged idêntico por SHA-256; entre os 221 arquivos
preexistentes, somente este relatório foi modificado. Único arquivo acrescentado:
o harness. A configuração isolada e todos os outros arquivos staged/unstaged
permaneceram idênticos; nenhum arquivo preexistente foi removido.

## Homologação no navegador com persistência — 2026-11-04

Esta seção amplia a evidência Node anterior; as limitações históricas sobre
ausência de testes browser e persistência são substituídas pelos resultados abaixo.
O pré-requisito local respondeu HTTP 200 em
`http://127.0.0.1:9099/emulator/v1/projects/demo-controle-financeiro/config`
antes de qualquer alteração. Não houve fallback para Firebase real.

### Arquitetura e arquivos

- Novo `experimental/auth-emulator-poc-session.js`: núcleo compartilhado de sessão,
  geração, deduplicação, prova remota e revogação, reutilizando o Lifecycle existente.
- Adaptado `scripts/run-auth-emulator-poc.mjs`: consome o núcleo e preserva seus dez cenários.
- Nova `tests/fixtures/auth-emulator-browser.mjs`: fixture sem `app.js`, com SDK real,
  `browserLocalPersistence` e armazenamento exclusivo de revogação da PoC.
- Adaptado `scripts/run-app-injection-browser.mjs`: reutiliza esbuild, servidor
  loopback e Playwright, selecionando exclusivamente a PoC com
  `AUTH_EMULATOR_POC_ONLY=1`; o caminho padrão permanece separado e preservado.
- Atualizado somente este relatório entre os documentos.

Há uma inscrição `onAuthStateChanged`. A identidade restaurada fica `unconfirmed`,
sem prova automática de autoridade pelo núcleo; apenas `reload` e renovação forçada
do token bem-sucedidos permitem `confirmed`, ainda com Lifecycle bloqueado.
São validados projeto, usuário sintético e ausência de tenant. Geração e identidade
do usuário SDK rejeitam callbacks antigos; duplicatas reutilizam o trabalho vigente.
O adaptador permanece inacessível e nenhum caminho chama `unlock()`.

### Revogação persistente e isolamento

A chave exclusiva é
`__cf_auth_emulator_poc_revocation_v1__:demo-controle-financeiro:<run UUID>`.
O marcador versionado é escrito e conferido antes de `signOut()`. Se este falhar,
o Lifecycle continua sem proprietário, mesmo após reload e reinício com usuário
ainda persistido pelo SDK; revalidação e novo login são recusados até retry de logout.
Um login explícito com prova remota válida pode posteriormente registrar `revoked:false`.
Ausência do marcador ou valor false nunca confirmam a identidade por si mesmos.
Falhas de leitura, escrita ou formato não inicializam silenciosamente uma sessão.

Descarte da página/sessão cancela o observador sem logout e sem remover o marcador,
permitindo testar restauração legítima. A limpeza controlada remove exclusivamente
essa chave quando o SDK não tem usuário e o controlador está encerrado sem signOut
pendente. A tentativa de remoção com usuário ainda ativo foi recusada no teste.
Não se limpam perfis, bancos ou caches. Os perfis novos e sintéticos foram mantidos:
`%TEMP%/cf-auth-emulator-msedge-LArSRf` e `%TEMP%/cf-auth-emulator-chrome-mNWVLJ`.
Eles contêm credenciais de teste do SDK; nenhum token é impresso nas evidências.

O navegador bloqueia Service Workers e destinos externos. Somente a origem loopback
da fixture e `http://127.0.0.1:9099` são permitidas; o modo exclusivo não carrega o
HTML nem o bootstrap do aplicativo. A inspeção final encontrou somente metadados
Firebase e a chave própria, sem adaptadores abertos ou estados financeiros expostos.

### Validação direcionada

| Execução | Resultado |
| --- | --- |
| `node scripts/run-auth-emulator-poc.mjs` | 10 aprovados, 0 falhas, 0 não executados; saída 0 |
| `AUTH_EMULATOR_POC_ONLY=1 node scripts/run-app-injection-browser.mjs` | 18 aprovados, 0 falhas, 0 ignorados; saída 0 |
| Sintaxe Node dos quatro arquivos JavaScript acima | Aprovada |
| `git diff --check` | Aprovado |

Cada navegador executou nove cenários: login A retido antes da prova; troca A–B
com duplicata e callback antigo; reload com restauração não confirmada; reinício
com o mesmo perfil; falha de rede restrita ao Emulator e recuperação explícita;
logout e reload; signOut rejeitado com revogação durável após reload e reinício;
suspensão/retomada sem confirmação automática; e limpeza controlada após logout.
Foram conferidos um observador, zero aberturas de adaptador, ausência de operações
financeiras, erros de página e solicitações externas. Não houve falha de inicialização
dos navegadores. O Node registrou cinco provas remotas, 19 requisições ao Emulator
e zero tentativas externas. Logs: `%TEMP%/cf-auth-emulator-shared-node.log` e
`%TEMP%/cf-auth-emulator-browser.log`.

Suíte global, Playwright completo, regressões gerais e `npm run check` não foram
executados nesta etapa, conforme o escopo aprovado.

### Limitações e decisão

A falha de signOut é injetada imediatamente antes da chamada SDK, não uma falha
interna comprovada do Firebase. A indisponibilidade é aplicada pelo roteamento do
navegador somente ao Emulator. Duplicatas e callbacks antigos são reentregas
controladas da única inscrição. A persistência foi comprovada em perfis dedicados,
incluindo reinício real do processo; não se homologaram BFCache, múltiplas abas,
queda de energia, OAuth, tenant, produção ou revogação em outro dispositivo.
O marcador local não substitui uma autoridade financeira durável nem protege contra
adulteração manual de armazenamento ou execução de script malicioso.

**PoC isolada Edge/Chrome com persistência APROVADA**, juntamente com os dez
cenários Node preservados. Não foi encontrada necessidade de modificar o aplicativo
principal. A integração ao bootstrap real permanece não autorizada e exige uma
fase própria: observador único compartilhado, equivalência do fluxo legado,
política de frescor e separação comprovada entre identidade e autoridade financeira.
Não foram habilitados cofre, criptografia, migração ou operações financeiras.

## Múltiplas abas e BFCache — 2026-11-04

Pré-requisito novamente confirmado: HTTP 200 no endpoint local de configuração
de `demo-controle-financeiro`, antes das alterações. Branch
`security/cofre-local-etapa1`, HEAD `1e0f4a5`; nenhum serviço iniciado automaticamente.

### Alterações exclusivamente experimentais

- `experimental/auth-emulator-poc-session.js`: reconciliação da identidade propagada
  pelo SDK como `unconfirmed`; revogação durável com época aleatória por logout,
  validada durante as provas remotas; invalidação de trabalho anterior e proteção
  de geração durante a reconciliação. Preservado o contador de callbacks rejeitados.
- `tests/fixtures/auth-emulator-browser.mjs`: observa somente sua chave de revogação
  via `storage`, reutilizando a inscrição Auth existente. Em `pagehide.persisted`
  suspende; no `pageshow.persisted` reconcilia o marcador durável e o usuário SDK,
  sem prova remota automática. Saída sem BFCache continua descartando a instância.
- `scripts/run-app-injection-browser.mjs`: modo direcionado adicional
  `AUTH_EMULATOR_TABS_ONLY=1`, condicionado a `AUTH_EMULATOR_POC_ONLY=1`;
  página local de afastamento e cache permitido somente nas páginas desta PoC.
  Remove o argumento padrão do Playwright que desabilita BFCache nesse modo.
- Este relatório. Nenhum módulo de produção foi alterado nesta etapa.

As abas usam o mesmo contexto, origem, nome de app e identificador sintético da
rodada. Não há segunda inscrição Auth: propagação de identidade usa o SDK;
revogação local usa marcador compartilhado. Um callback que iniciou a prova antes
de outra aba revogar não passa pela verificação da época anterior. Receber outro
usuário não concede autoridade: exige revalidação explícita na aba receptora.
No BFCache a sessão suspensa também consulta o marcador no retorno, sem depender
de entrega de eventos enquanto a página estava congelada.

### Resultados efetivos

| Grupo | Edge | Chrome | Total |
| --- | --- | --- | --- |
| Novos cenários múltiplas abas e BFCache | 8 aprovados | 8 aprovados | 16 aprovados |
| Regressões browser diretamente afetadas | 9 aprovados | 9 aprovados | 18 aprovados |
| Retornos BFCache reais, incluídos nos novos cenários | 2 | 2 | 4 |

Os oito cenários por navegador cobrem: propagação de login com confirmação
explícita na receptora; logout entre abas; revogação apesar de signOut rejeitado;
troca A–B com callback A atrasado; fechamento/reabertura sem autoridade antiga;
BFCache com retorno não confirmado e prova remota posterior; logout em outra aba
durante ausência e retorno BFCache sem proprietário; e isolamento final.
Foi exigido `pageshow.persisted === true` e registrado `pagehide.persisted === true`
nos quatro retornos. Nenhum caso foi contado como BFCache por mero reload.
Zero falhas finais, ignorados ou não executados nesses grupos; inicialização
Edge/Chrome aprovada. Uma inscrição por instância, zero adaptadores, dados
financeiros nulos, zero operações em andamento, erros de página ou destinos externos.

Regressão Node do núcleo compartilhado: **10 aprovados, 0 falhas, 0 não executados**,
cinco provas remotas e 19 requisições ao Emulator, saída 0. Sintaxe dos três
arquivos JavaScript alterados e `git diff --check` aprovados.
Não foram executados suíte global, Playwright completo, builds ou novas auditorias.

### Intercorrências e evidências

A primeira execução browser passou cinco cenários Edge e expirou ao esperar
`load` em `goBack`, embora a navegação já tivesse ocorrido. Corrigido o executor
para aguardar o commit e os estados observáveis da fixture; a repetição direcionada
comprovou BFCache nos dois navegadores. Não foi enfraquecida a asserção `persisted`.
A primeira regressão Node passou sete cenários e falhou no contador de callbacks
rejeitados (dois cenários ficaram não executados nessa tentativa). A nova rota de
reconciliação não incrementava esse contador. Corrigida a instrumentação, mantendo
a asserção original; a repetição passou os dez. Não se identificou restauração
de proprietário revogado nem perda financeira — esta PoC não executa finanças.

Logs em `%TEMP%`: `cf-auth-tabs.log` (tentativa inicial browser),
`cf-auth-tabs-final.log` (16 aprovados), `cf-auth-tabs-node.log` (falha do contador),
`cf-auth-tabs-node-final.log` (10 aprovados), `cf-auth-tabs-regression.log`
(18 regressões browser aprovadas). Perfis novos preservados, incluindo
`cf-auth-tabs-msedge-IUSw1a` e `cf-auth-tabs-chrome-Tii9Ig`.
O manifesto staged mantém SHA-256
`35cb57b65ff5a9cef49e001563009aa70328c9f1198a700a8f267cf8c9700aea`.
Nenhuma limpeza de perfis ou caches, commit, push, merge ou deploy.

### Decisão e riscos restantes

**Isolamento entre abas e restauração BFCache homologados nesta PoC Edge/Chrome.**
O mecanismo continua exclusivo de identidade experimental, sem autorização
financeira, desbloqueio ou adaptação do bootstrap publicado. A falha de signOut
permanece injetada na fronteira SDK. Não se certificam adulteração do marcador,
storage indisponível, descarte por falta de memória, outras versões de navegador
ou revogação entre dispositivos. Eventos `storage` não são uma garantia de entrega
instantânea para abas suspensas: a proteção combina época durável antes da prova
e reconciliação ao retornar; não substitui uma futura cerca transacional financeira.
A integração com Auth de produção permanece fora do escopo e não autorizada.

## Homologação global consolidada — 2026-11-04

Branch `security/cofre-local-etapa1`, HEAD `1e0f4a5`, preservados. Executada uma
única rodada global após a PoC de persistência, múltiplas abas e BFCache:

| Comando | Resultado | Saída |
| --- | --- | --- |
| `npm.cmd test` | 859 testes: **853 aprovados, 0 falhas, 6 ignorados**, 0 cancelados, 0 todo | 0 |
| `npm.cmd run check` | Aprovado | 0 |
| `git diff --check` | Aprovado | 0 |

Os seis ignorados são os testes opt-in de protocolo de época no Emulator,
integração sintética Auth/Firestore com persistência cifrada, composição de fábrica
Firebase/sincronizador/cofre e três cenários dependentes de Firestore Emulator
(transações/configurações, barreira de restauração e regras por UID/tombstones).
Não são contabilizados como aprovados nem foram executados separadamente.
Logs da rodada: `%TEMP%/cf-auth-global-test.log` e
`%TEMP%/cf-auth-global-check.log`. Duração reportada pelo teste: 82.212 segundos.

Não houve repetição separada de Edge/Chrome: somente os cenários já integrantes
de `npm test` foram executados. As evidências específicas da PoC permanecem as
registradas acima: 16 novos cenários, 18 regressões browser e 10 Node aprovados,
incluindo quatro restaurações BFCache reais. Esses totais não foram somados ao
total global, pois representam execuções distintas. O cofre do aplicativo continua
desativado; esta rodada não habilitou adaptadores ou operações financeiras da PoC.
Os testes globais que exercitam contratos financeiros usam seus próprios dados
sintéticos e não constituem ativação financeira experimental do aplicativo.

Antes da edição deste relatório, a comparação SHA-256 dos **224 arquivos** e do
manifesto staged mostrou igualdade integral com o início da rodada: nenhum arquivo
criado, removido ou alterado pelos comandos. Alterações preexistentes do aplicativo
principal foram preservadas, sem novas modificações. Somente este relatório foi
atualizado para registrar o resultado; staged permanece intacto.

**Homologação global APROVADA, sem regressões detectadas**, com os seis testes
ignorados explicitados. Permanecem as limitações da PoC e a necessidade de fase
autorizada própria antes de qualquer integração ao bootstrap/Auth de produção.
Nenhum commit, push, merge, deploy ou limpeza foi realizado.

## Composição experimental Firebase Sync → Lifecycle — 2026-11-04

**Validação parcial; homologação financeira BLOQUEADA por ambiente.** Auth
Emulator respondeu HTTP 200 para `demo-controle-financeiro`; o endpoint Firestore
`http://127.0.0.1:8080/v1/projects/demo-controle-financeiro/databases/(default)/documents`
recusou conexão. Nenhum serviço foi iniciado e não se tentou produção. Não foi
substituída a comparação financeira por mocks ou pela equivalência de eventos Auth.

### Implementação mínima isolada

Criados somente `experimental/firebase-sync-lifecycle-poc.js` e
`scripts/run-firebase-sync-lifecycle-poc.mjs`, além desta atualização documental.
O comando opt-in é `FIREBASE_SYNC_LIFECYCLE_POC=1 node scripts/run-firebase-sync-lifecycle-poc.mjs`
(PowerShell: definir a variável de ambiente antes do comando). Sem opt-in o
executor recusa execução. Nenhum aplicativo publicado importa a composição.

O executor usa `criarFirebaseSync` real com suas fábricas oficiais, Auth SDK em
memória conectado a 127.0.0.1:9099 e Firestore SDK em memória explicitamente
conectado a 127.0.0.1:8080, sem consultas financeiras nesta validação parcial.
Somente projeto demo e usuários synthetic são aceitos pelo núcleo reutilizado.
Transporte Auth aceita exclusivamente a origem do Emulator. Não há import de app.js.

A composição decora `client.onUser`: registra **uma** inscrição real por instância,
chama primeiro o consumidor legado com o mesmo argumento e retorno, e agenda a
entrega ao núcleo em microtask por `finally`, sem aguardar o Lifecycle. Exceções
síncronas do consumidor não são capturadas nem substituídas pela ponte. Atrasos
do Lifecycle não atrasam a entrega legada. `ready()` e `login()` permanecem os
métodos originais; logout revoga localmente antes de delegar ao cliente real.
Cancelamento é idempotente e invalida o núcleo antes de cancelar a inscrição.
A composição é de uso único: uma nova inscrição exige outra instância.

O núcleo recebe a mesma entrega através de sua dependência de observação, sem
registrar outro observador SDK. Identidades novas chegam não confirmadas;
`revalidate()` exige reload e token remoto atuais. Revogação, geração e época
continuam protegendo trabalho antigo. O ponto `revocations` pode receber o
armazenamento dedicado da fixture browser; este executor Node usa somente memória,
portanto não constitui nova prova de persistência, múltiplas abas ou BFCache.
O adaptador permanece proibido; não há unlock, criptografia ou operação financeira.

### Testes efetivamente executados

Rodada final direcionada: **7 cenários aprovados, 0 falhas**, saída 0:
fábrica real/inscrição única; login A–B com confirmação remota explícita;
duplicata entregue ao legado sem repetir prova; falha de revalidação mantendo
unconfirmed; signOut rejeitado com revogação e callback antigo recusado; retry de
logout reconciliando o SDK; cancelamento único e ausência de adaptadores/dados financeiros.
A sequência legada foi assertada como `[null, A, B, B, null]`, incluindo duplicata.
Isso valida entregas Auth, **não** equivalência financeira com/sem composição.
Log: `%TEMP%/cf-sync-lifecycle-poc-final.log`.

Na primeira tentativa, três cenários passaram antes de falhar a simulação offline:
trocar globalThis.fetch após import não afetava o transporte capturado pelo SDK.
Ajustada somente a injeção no executor, antes da importação; a asserção original
foi preservada. Log inicial: `%TEMP%/cf-sync-lifecycle-poc.log`.
Sintaxe dos dois arquivos novos e `git diff --check` aprovados.
Não foram executados suíte global, navegador ou serviços externos.

### Pendências e gate

Não executados: comparação financeira real com e sem composição, sincronizador
ativo com estado/fila/ACKs, logout durante sincronização e ensaios específicos de
atraso/erro do Lifecycle e exceção do consumidor legado. A ordem síncrona está
preservada estruturalmente, mas esses ensaios de falha ainda não foram homologados.
As sete provas Node não substituem esses critérios nem os seis testes globais
anteriormente ignorados. Não houve necessidade identificada de alterar módulos
funcionais; nenhum deles foi modificado nesta etapa.

Próximo requisito: disponibilizar explicitamente Firestore Emulator isolado e
autorizar a continuação dos testes afetados. Exigir equivalência de estado, fila,
conflitos, tombstones e ACKs sob o sincronizador real, com e sem a composição.
**Não está aprovada a composição completa nem qualquer integração de produção.**

## Conclusão da comparação financeira sintética — 2026-11-04

Esta rodada supera o bloqueio de disponibilidade do Firestore descrito acima,
sem apagar as evidências anteriores. Branch `security/cofre-local-etapa1`, HEAD
`1e0f4a5`. Alterados somente o executor experimental existente
`scripts/run-firebase-sync-lifecycle-poc.mjs` e este relatório. Nenhum arquivo novo.

### Conectividade integrada e isolamento

Antes dos testes: Auth local respondeu HTTP 200; Firestore local respondeu HTTP
404/NOT_FOUND para documento sintético ausente, confirmando atendimento REST.
A primeira leitura SDK falhou com `UNAVAILABLE/ECONNRESET`. Repetida com
`NO_PROXY` e `no_grpc_proxy` incluindo loopback, passou: token de usuário sintético
obtido do Auth foi aceito na leitura do documento ausente no Firestore. A consulta
REST autenticada também retornou NOT_FOUND e a consulta SDK retornou `exists:false`.
Não houve evidência de incompatibilidade entre os processos separados nem
necessidade comprovada de inicialização conjunta. Ambos permaneceram manuais.

O executor passa a excluir loopback do proxy somente no processo de teste, antes
das importações SDK. Confere Auth host 127.0.0.1 e Firestore host 127.0.0.1:8080,
SSL desabilitado, usando projeto demo fixo e UIDs synthetic exclusivos da rodada.
Firestore é conectado ao Emulator antes do uso; não há fallback para backend
real. O fetch de Auth continua recusando outras origens; o transporte gRPC real
do Firestore usa o host local explicitamente configurado. Nenhuma configuração,
regra ou endpoint de produção foi lido ou alterado.

### Comparação executada

Modo opt-in adicional: definir `FIREBASE_SYNC_LIFECYCLE_POC=1` e
`FIREBASE_SYNC_FINANCIAL_ONLY=1`, então executar
`node scripts/run-firebase-sync-lifecycle-poc.mjs`.
Reutiliza `criarFirebaseSync`, `AutomaticFinanceSync` e `ServicoFinanceiroAtomico`
reais. O modelo transacional local do executor é dedicado e volátil, sem IndexedDB,
criptografia ou adaptador de cofre. Cada execução usa duas contas sintéticas novas,
evitando limpar ou reutilizar documentos financeiros de outras rodadas.

Foram executados um controle sem Lifecycle e outro com a composição. Cada um
executa login A, operação financeira sintética offline, envio, falhas, troca A–B
e logout. O sincronizador permanece com agendamento offline e os ciclos são
disparados explicitamente, permitindo reter ACKs de forma determinística.
Os oito checkpoints de cada execução foram comparados integralmente:

1. Operação durável na fila antes do envio.
2. ACK real retido após commit remoto: operação ainda na fila local.
3. ACK liberado: remoção somente da operação confirmada.
4. Rede Firestore desabilitada pelo SDK: erro sem perda da operação pendente.
5. ACK perdido após commit real: mesmo ID permanece pendente e marcado como tentado.
6. Retomada: replay idempotente com confirmação, dois lançamentos remotos únicos.
7. Snapshot remoto de A retido e liberado após troca para B: rejeição
   `persistence/cancelled`, estado B intacto e callback Lifecycle antigo recusado.
8. Logout: sessão encerrada, preservados os documentos locais das duas contas.

Comparados estados completos, revisões locais, filas completas (inclusive conflitos,
referências de recuperação e metadados), IDs de operações e respostas ACK recebidas.
Somente `lastConfirmed` não nulo é comparado por presença/data ISO válida, pois
as execuções têm relógios diferentes. Nenhuma revisão, ID ou conteúdo financeiro
foi normalizado para obter equivalência. Filas e ACKs resultaram idênticos, sem
confirmações extras. Transições Auth foram `[null,A,B,null]` em ambas, com exatamente
uma inscrição e um cancelamento por execução. Na composição: zero adaptadores,
nenhuma fase unlocking/ready/operating, nenhum dado financeiro entregue ao Lifecycle.

### Resultados e intercorrências

- Comparação financeira: **3 grupos aprovados, 0 falhas, 0 não executados**,
  saída 0: controle, composição e equivalência dos oito checkpoints (16 capturas).
- Regressões Auth diretamente afetadas: **7 aprovadas, 0 falhas**, saída 0.
- Sintaxe do executor e `git diff --check`: aprovados.
- Sem suíte global, Playwright ou repetição dos testes browser anteriores.

Logs finais em `%TEMP%/cf-sync-financial-comparison-proof.log` e
`%TEMP%/cf-sync-financial-auth-regression.log`. O resumo da regressão ainda imprimiu
uma mensagem histórica de indisponibilidade do Firestore, porque o ramo Auth
mantinha texto fixo da fase anterior. Esse texto foi corrigido para identificar
a comparação financeira como modo separado; não era resultado de conectividade
nem falha dos sete testes. A comparação financeira final efetiva passou com o SDK.

Tentativas iniciais: o modelo local estava sem o método `alterar` e expirou na
preparação; completado o contrato necessário. Depois, a consulta antiga terminou
com a rejeição esperada `persistence/cancelled`, ainda não aguardada como rejeição
pelo teste; acrescentada a asserção específica, mantendo a verificação de B intacto.
Logs dessas tentativas: `cf-sync-financial-comparison.log` e
`cf-sync-financial-comparison-final.log`. Nenhuma correção funcional do aplicativo
foi necessária e nenhuma asserção de integridade foi removida.

Comparação SHA-256 antes da atualização documental: manifesto staged idêntico,
somente o executor modificado entre todos os arquivos preexistentes; nenhum
arquivo criado ou removido. Este relatório é a única outra alteração desta rodada.
Nenhum banco, fila, cache ou perfil preexistente foi limpo; dados remotos novos
de teste permanecem no Emulator. Nenhum commit, push, merge ou deploy.

### Decisão e limites remanescentes

**Homologação financeira sintética pendente APROVADA** nos limites descritos:
equivalência comprovada com/sem Lifecycle, ACKs reais e isolamento de destinos.
Não há bloqueio conhecido que obrigue inicialização conjunta dos Emulators neste
ambiente após a correção de proxy do executor.
Esta rodada usa persistência local em memória, não comprova durabilidade IndexedDB
nem repete BFCache/múltiplas abas. A falha de rede é controlada por disableNetwork;
atraso/perda de ACK são injetados após resposta real do SDK. Permanecem fora desta
rodada os ensaios específicos de atraso/erro do Lifecycle e exceção do consumidor
legado, além de OAuth e identidades reais. Portanto esta aprovação financeira não
equivale à homologação irrestrita da composição ou autorização de integração ao
aplicativo principal/produção. Nenhuma próxima fase foi iniciada.

</details>
