# Extração estrutural do bootstrap

Branch `security/cofre-local-etapa1`, HEAD `1e0f4a5`. Escopo: refatoração estrutural
do caminho atual, sem ativar o cofre nem conectar o controlador experimental.
Foram consultados a auditoria do bootstrap, as políticas de ciclo de vida e o
relatório da composição, incluindo o encerramento de CP-05. Sua correção não
foi reimplementada nem alterada.

## Preservação e arquivos

Na abertura foram inventariados por SHA-256 os **52 arquivos locais preexistentes**.
Todas as alterações anteriores permanecem na árvore de trabalho; nenhum commit,
staging, push, merge, deploy ou limpeza de bancos/caches foi realizado.
Conferência após as alterações: **49/52 arquivos locais anteriores idênticos**;
somente app, runner e fixture foram intencionalmente atualizados. Os testes de
isolamento e de integração IDB, que estavam iguais ao HEAD, receberam
correções de extração descritas abaixo; o relatório é novo. Os hashes do sincronizador e dos testes/auditoria
CP-05 permaneceram iguais. A cópia anterior de app também corresponde ao hash
original, demonstrando preservação de suas injeções e demais alterações locais.

| Arquivo | Alteração desta etapa |
| --- | --- |
| `app.js` | Único módulo funcional alterado: funções locais para as fases, nos mesmos pontos de chamada |
| `tests/async-session-isolation.test.js` | Localização do callback real ajustada à nova indentação, com as mesmas asserções e verificação explícita de localização |
| `tests/app-idb-integration.test.js` | Executa a fase real extraída em vez de recortar um bloco top-level; mantém as provas de render único, zero gravações e estado/fila/conflitos intactos, verificando também uma única seleção de seção |
| `tests/fixtures/app-injection-bootstrap.mjs` | Evidências separadas de ordem/contagem e seed sintética com gate de SDK; APIs e serviços financeiros reais preservados |
| `scripts/run-app-injection-browser.mjs` | Comparação opcional antes/depois, imagens exatas, cenário pré-Auth/inicialização única e reinício completo default/injetado com estado/fila |
| `docs/cofre-local-extracao-bootstrap.md` | Novo relatório |

Não foram modificados storage, IndexedDB, serviço atômico, sincronizador,
Firebase, regras, HTML, CSS, localização, Service Worker ou módulos experimentais
do cofre. Os adaptadores padrão e os pontos oficiais de injeção continuam iguais.
Não há nova configuração de produto, import de cofre, senha ou seleção de backend.

## Fases e limites extraídos

As funções são privadas a `app.js`. Não foi criado módulo novo de runtime, evitando
uma dependência adicional de distribuição/cache. Não há novo coordenador de Auth.

| Fase | Função/caminho | Responsabilidade preservada |
| --- | --- | --- |
| Técnica | `prepararDependenciasTecnicas()` | Captura única das mesmas fábricas, storage e leitor de metadados. Não abre recursos; DOM e demais declarações continuam no mesmo lugar |
| Preparação do armazenamento | `prepararArmazenamentoInicial()` | Mesmas verificações do legado, abertura, serviço, leitura do par antigo, inicialização local, catch e listener pagehide |
| Carregamento financeiro | `carregarEstado()` e `carregarEstadoFinanceiroPersistido(result)` | Primeira leitura legada antes do banco/Auth; depois instalação do estado retornado pelo serviço e da mesma base para salvar |
| Preparação de autenticação | `prepararAutenticacao(sdk)` no bloco automático existente | Mesmo `client ||= sdk.criarFirebaseSync(firebaseConfig)` após o await do bundle, ainda depois da renderização financeira inicial |
| Sincronização | `prepararSincronizacao()` e `initialize()` | Mesma construção única, callbacks, `start`, Promise compartilhada, catch, retry de cinco segundos e retomada online/focus |
| Interface inicial/pronta | `prepararInterfaceInicial()` e `concluirCarregamentoConta()` | Mesmos render/preferências/privacidade/diagnóstico/seção inicial; liberação nos mesmos chamadores locais/Auth |

As fábricas de Auth/sync foram extraídas como funções síncronas: não se adicionou
await entre criar cliente, construir sincronizador e chamar start. O bloco do
armazenamento tornou-se função async aguardada no mesmo ponto do módulo; não
há novo paralelismo. Essa extração introduz a resolução da Promise da função,
mas não transfere handlers/render/Auth para antes da conclusão do armazenamento.
Os testes com SDK retido verificam a sequência observável e a inicialização única.

## Ordem anterior e posterior

```text
ANTES
imports/probe de storage → captura de dependências → DOM/declarações
  → carregarEstado (legado) → bloco await de IndexedDB/serviço/inicializar local
  → estado/idbBase → pagehide → handlers → render/preferências/privacidade/seção
  → liberação local OU tela aguardando conta
  → bloco automático: loadFirebase → criar cliente → criar sync → start
  → onTransition/onAccount/onState → mesmas atualizações/liberação da UI

DEPOIS
imports/probe de storage → prepararDependenciasTecnicas → DOM/declarações
  → carregarEstado (legado) → await prepararArmazenamentoInicial
     → mesmos open/serviço/inicializar → carregarEstadoFinanceiroPersistido
     → mesmo pagehide
  → mesmos handlers → prepararInterfaceInicial
  → mesma liberação local OU tela aguardando conta
  → mesmo initialize: loadFirebase → prepararAutenticacao
     → prepararSincronizacao → mesmo start
  → mesmos onTransition/onAccount/onState → concluirCarregamentoConta
```

**O estado financeiro continua sendo carregado antes de Auth.** As seis fases
são limites de responsabilidade, não uma nova ordem autenticação→finanças.
O guard loopback/configuração/controles do fluxo automático continua igual.
As rotinas manuais antigas permanecem desativadas. Não foram movidos ou alterados
salvar, restauração, fila, conflitos, tombstones, ACK, gerações ou recuperações.
Logout continua voltando ao estado local atual; não recebeu política de cofre.

## Comparação com a árvore anterior

Para comparar o aplicativo completo, foi reconstruído somente em memória o
`app.js` anterior, invertendo as extrações. A reconstrução foi aceita somente
após corresponder ao SHA-256 inventariado **antes** da implementação:

`7f173d69484d41ccea8d687942199064ddb798591e2a4ccc80d76fd64480c8b7`.

A cópia anterior está em `%TEMP%/cf-bootstrap-baseline-Xkwq2E/app.js`, fora do
projeto. Ela contém as injeções locais anteriores, e não apenas o HEAD. Nenhuma
reversão/reset foi feita no workspace. Uma primeira tentativa de reconstrução
não atingiu o hash; não foi utilizada como baseline. A versão aceita foi
conferida integralmente antes de executar os ensaios comparativos.

O servidor de QA serve antes/depois com os mesmos HTML/CSS/módulos/fixtures e
origem loopback, em contextos/perfis novos, sem bancos pessoais. O caminho default
abre o nome padrão somente nesse perfil novo; o caminho injetado redireciona
explicitamente para `controleFinanceiro:integridade:v1:synthetic-injection`.
Todo tráfego externo é recusado pelo runner; a configuração Firebase servida no
teste é demo, sem carregar o SDK de produção. Auth/I/O remoto são modelados;
app, DOM, IndexedDB, serviço atômico, regras de intenção e sincronizador são reais.
SW é bloqueado pelo contexto de teste, sem editar ou limpar nenhum SW/cache.

## Validação dirigida

```powershell
node --test --test-timeout=60000 tests/app-dependency-injection.test.js tests/auth-button.test.js tests/app-sync.test.js tests/async-session-isolation.test.js tests/settings-safety.test.js tests/storage.test.js tests/financial-atomic-service.test.js tests/automatic-sync-cp05.test.js
$env:BOOTSTRAP_BASELINE_APP='C:\Users\T03469~1\AppData\Local\Temp\cf-bootstrap-baseline-Xkwq2E\app.js'
node scripts/run-app-injection-browser.mjs
```

Node: **253 aprovados, 0 falhas, 0 ignorados** na repetição após ajustar o extrator
de callback do teste. A primeira execução teve 252 aprovações e uma falha de
SyntaxError no VM: o delimitador dependia da indentação anterior, extraindo um
trecho vazio. Corrigida somente a localização do callback real; mantidos testes
de cancelamento/estado/UI e acrescida a asserção de que o trecho existe.
Não houve falha funcional demonstrada nessa execução.

Browser antes/depois: **32 aprovados, 0 falhas, 0 ignorados**, com o código
funcional final. Cada combinação versão × engine tem oito grupos: dois fluxos
locais (default/injetado), falha de armazenamento, falha de SDK, login/offline/
ACK/A–B–A/logout, gate pré-Auth/inicialização única e dois reinícios completos
(default/injetado). Sem falha de inicialização em nenhum dos engines. Cenários:

- Inicialização default e com injeção explícita, salvar/recarregar e preservar
  estado e fila exatamente; falha de persistência sem fallback; falha de SDK.
- Login/logout pela UI, offline com outbox durável, retomada com confirmação,
  A–B–A e ausência de estado de B em A.
- Reinício completo de processo/perfil sintético e leitura offline preservada.
- SDK retido: estado local já persistido e renderizado antes de Auth, overlay
  ainda ocupado, zero cliente/observer prematuros. Online/focus durante espera
  não duplicam import/construção; reimport ESM não duplica a inicialização.
- Comparação PNG exata em Edge/Chrome, modos default/injetado, tela inicial e
  tela após persistir/recarregar. Animações/caret são estabilizados; somente o
  aviso transitório `#aviso` é ocultado na captura, igualmente antes/depois.
  Não se aplica tolerância a diferenças de pixels nem se altera CSS do aplicativo.

Logs externos ao Git: `%TEMP%/cf-bootstrap-targeted.log` (falha de extração),
`cf-bootstrap-targeted-fixed.log` (253/253), `cf-bootstrap-browser.log` (rodada
preliminar 28/28), `cf-bootstrap-browser-final.log` (32/32 após acrescentar o
reinício default e a comparação da fila após restart). Nenhuma mudança funcional
foi feita entre as duas rodadas browser. As imagens finais tiveram **8/8 pares
PNG idênticos**, e estão em `%TEMP%/cf-bootstrap-visual-MjJzQK`.
Perfis de reinício finais antes: `cf-app-injection-msedge-laZ3o6`,
`cf-app-injection-msedge-GU5jpr`, `cf-app-injection-chrome-Q3S9hH`,
`cf-app-injection-chrome-Wqb17f`; depois: `cf-app-injection-msedge-gBSMy5`,
`cf-app-injection-msedge-httYPz`, `cf-app-injection-chrome-BbY6QK`,
`cf-app-injection-chrome-lOdcGd`, todos em `%TEMP%`.
Perfis, imagens e bancos sintéticos ficam retidos, sem limpeza.

A suíte geral identificou outro recorte sensível à estrutura anterior, em
`tests/app-idb-integration.test.js`, cenário `initial rendering after reload is
silent and preserves financial state, pending operations and conflicts`. O teste
recortava desde o último `renderTudo(` até a declaração da seção; com a extração,
isso começava dentro da função nova e incluía um return/fechamento fora do seu
contexto. A falha era de compilação do recorte no VM. O aplicativo não foi alterado
por esse achado: o teste agora localiza e executa `prepararInterfaceInicial()`
real, preservando as asserções financeiras e acrescentando retorno/contagem da
seção inicial. O arquivo foi validado isoladamente: **8 aprovados, 0 falhas,
0 ignorados**, sem repetir a suíte inteira.
Log `%TEMP%/cf-bootstrap-render-regression.log`.

## Validação final, limitações e decisão

A suíte completa foi executada **uma única vez, após a aprovação dos testes
dirigidos e da rodada browser final**, sem repetir o agregado após a correção do
teste de renderização. O código funcional de app permaneceu igual durante toda
a validação geral e a correção posterior foi exclusivamente no extrator do teste.

```powershell
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
node --test --test-timeout=60000 tests/app-idb-integration.test.js # somente o arquivo afetado
npm.cmd run check
git diff --check
```

O check foi iniciado junto à suíte, ambos somente após aprovação dirigida; o
arquivo de integração foi reexecutado ao identificar a falha do seu recorte.

| Verificação | Resultado | Ignorados/cancelados |
| --- | --- | --- |
| Dirigidos Node | 253 aprovados, 0 falhas na repetição | 0/0 |
| Comparação browser final | 32 aprovados, 0 falhas; 8 pares PNG idênticos | 0/0 |
| Suíte completa única, 853 testes | **846 aprovados, 1 falha**, exit 1 | 6/0 |
| Integração IDB após corrigir o extrator | 8 aprovados, 0 falhas, exit 0 | 0/0 |
| `npm.cmd run check` | Aprovado, exit 0 | 0/0 |
| `git diff --check` | Aprovado, exit 0 | 0/0 |

A falha agregada foi exatamente `SyntaxError: Illegal return statement` em
`app-idb-integration.test.js:171`, gerado pelo recorte fora da função. O log
original permanece em `%TEMP%/cf-bootstrap-full-suite.log`, duração 564959 ms;
o check está em `cf-bootstrap-check.log`. Não se declara a suíte inteira como
verde por inferência a partir da execução isolada, nem se soma a repetição aos
853 testes. Não há falha funcional pendente demonstrada; existe a ressalva
formal de não ter havido uma nova rodada global com o extrator final.

Os seis ignorados são os gates preexistentes de epoch Emulator, integração
Auth/Firestore anterior, adaptadores reais SDK/Emulator, cliente nas regras do
Emulator, barreira de gerações e regras Firestore. Não foram removidos ou
enfraquecidos; Firebase Emulator dedicado não foi iniciado nesta etapa.
Também não se executaram novamente os wrappers de cofre/lifecycle/restore nem
a auditoria independente ampla em browser. As regressões correspondentes
incluídas por padrão em npm test foram executadas, com os resultados acima.
Não houve falha de lançamento Edge/Chrome; erros de armazenamento e SDK da matriz
dirigida foram injetados propositalmente e verificaram preservação/falha fechada.

Branch e HEAD permanecem os da abertura. O inventário confirma 49/52 arquivos
locais anteriores idênticos; as três atualizações intencionais, os dois testes
de recorte e o novo relatório são a totalidade das mudanças desta etapa.

Limites: a equivalência observada não é prova de toda intercalação possível do
event loop; permanece uma aplicação baseada em estado global e callbacks. As
fases privadas são fronteiras estruturais, não autorização financeira ou fence
de sessão. Carregar finanças antes de Auth é intencional nesta etapa e continua
incompatível com habilitar o cofre sem nova coordenação de seleção/desbloqueio.

Não se testam nesta etapa OAuth/contas reais, produção, cofre conectado ao DOM
publicado, destruição física de armazenamento, dispositivos móveis ou rollout
de versões/SW. BFCache/lifecycle cifrado e SDK Emulator integrados conservam
evidência histórica, não são declarados homologados novamente por esta extração.
Uma futura publicação deve revisar a coerência da versão/cache existente sem
introduzir dependências fora do precache; nenhum deploy foi realizado aqui.

**Confirmação global posterior da árvore final:** branch
`security/cofre-local-etapa1`, HEAD `1e0f4a5`, com a correção do extrator presente.
Nesta retomada foi executado **uma única vez `npm.cmd test`**, sem flags
adicionais: **853 testes, 847 aprovados, 0 falhas, 6 ignorados, 0 cancelados,
código de saída 0**, duração 84150,9037 ms. Os seis ignorados são os mesmos gates
condicionais de Emulator descritos acima; não foram convertidos em aprovações.
`npm.cmd run check` e `git diff --check` também terminaram com **código 0**.

Evidências: `%TEMP%/cf-bootstrap-global-confirmation-test.log` e
`%TEMP%/cf-bootstrap-global-confirmation-check.log`. Não se repetiram os runners
dedicados de navegador; somente os testes incluídos por padrão na suíte global.
O resultado histórico reprovado foi preservado acima; esta execução completa
com o extrator corrigido encerra sua ressalva de validação global.

Somente esta conclusão foi atualizada. Os outros 54 arquivos locais inventariados
na abertura desta retomada permaneceram idênticos por SHA-256. Não houve alteração
de código, configuração, dados, bootstrap, cofre, controlador, Firebase,
IndexedDB ou Service Worker, nem commit, publicação, migração ou limpeza.

**Decisão atual: árvore final globalmente verde e apta para iniciar a próxima
fase experimental isolada.** O gate de validação global da extração está
encerrado. A futura conexão efetiva continua sujeita aos contratos de seleção
autoritativa de backend, dono único das transições Auth, drenagem/revogação,
remoção de dados antigos da UI e recuperação homologadas.

**Não está homologada a conexão do controlador ao aplicativo publicado nem a
habilitação do cofre.** Os defaults e o carregamento pré-Auth continuam mantidos;
não usar esses limites como autorização implícita para ler um cofre bloqueado.
Esta entrega termina no relatório, sem conexão do controlador, migração,
ativação, commit ou início automático de qualquer outra fase.
