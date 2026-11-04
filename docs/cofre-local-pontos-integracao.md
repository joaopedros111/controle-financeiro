# Pontos oficiais de integração — cofre ainda desativado

Data: 2026-11-03. Branch `security/cofre-local-etapa1`, HEAD
`1e0f4a57d555e09b66a6bd58dd15cd119d053341`. Antes de editar, o Git mostrou os
dez arquivos locais da fase de adaptadores reais, todos preservados. Não houve
commit, staging, push, merge ou deploy nesta etapa.

## Diagnóstico e arquitetura mínima

| Local | Dependência anterior | Ponto oficial |
| --- | --- | --- |
| `app.js`, início | Singleton `storage` importado diretamente | Captura única do storage/fábricas com os mesmos defaults |
| Bootstrap local de `app.js` | `abrirPersistenciaFinanceira()` e `new ServicoFinanceiroAtomico(...)` | `openPersistence()` e `createAtomicService(db, validarEstado, validarFila)` |
| Inicialização Firebase de `app.js` | Import dinâmico direto do bundle em dois caminhos | `loadFirebase(release)`, com o mesmo import/URL no default |
| Sincronização automática de `app.js` | `new AutomaticFinanceSync(...)` | `createAutomaticSync(options)`, preservando todos os callbacks |
| Bootstrap de conta, legado e automático | Leitura de metadados via global localStorage | `readLegacyMetadata(uid)`; default continua `readSyncMetadata(globalThis.localStorage, uid)` |
| `storage.js` | Factory já injetável e singleton padrão | Mantidos; adicionados registro/captura explícitos da composição do app |
| `indexeddb-persistence.js` | Factory IndexedDB já recebida por parâmetro | Sem mudança: testes podem fornecer factory que remapeia só o nome para banco sintético |
| `financial-atomic-service.js` | Construtor já recebe db, validadores e locks | Sem mudança; não duplicar suas regras em novo serviço |
| `firebase-sync-entry.js` | App/Auth/Firestore instanciados diretamente | Segundo argumento opcional `runtime` para construção SDK e bootstrap de Auth |

As cinco fábricas e o storage são suficientes para os testes de composição.
Não foi criado container de serviços, protocolo paralelo de sincronização, classe
base, módulo adicional no grafo estático do app ou feature flag do cofre.
O registro ficou em `storage.js`, módulo já servido e cacheado, para não exigir
mudança no Service Worker ou listas de distribuição nesta etapa.

## Interfaces mínimas

**Persistência:** `ler(chave)`, `alterar(chave, callback)`,
`alterarDocumentos(chaves, callback)` e `fechar()`. As callbacks são síncronas,
Map completo, estado/fila atômicos, rejeição explícita em erro. O método fechar é
necessário ao pagehide atual; não presume que todo adaptador experimental já tenha
esse nome. O objeto é fornecido por `openPersistence()`, que pode ser assíncrona.

**Serviço atômico:** fábrica síncrona recebe a persistência e os mesmos validadores
do app. O contrato público continua sendo o de `ServicoFinanceiroAtomico`, incluindo
inicializar, aplicarEdicao, ler/alterarFila, enviarFila, confirmação e preservação
de edições rejeitadas. Não muda formato de documentos, cálculo, fila, ACK ou geração.

**Remoto e controlador:** `loadFirebase` retorna módulo com
`criarFirebaseSync(config)`. O cliente mantém ready/onUser/login/logout, registros,
settings, conflitos, histórico, listeners e protocolo de gerações existentes.
`createAutomaticSync(options)` mantém start/stop/localChanged/report/importBackup,
session/sessionContext e os callbacks de estado/status/conta. Leitores de metadados
são síncronos; erro/Promise/null não são tratados como ausência.

**SDK Firebase:** `criarFirebaseSync(config, runtime?)` aceita somente funções
`createApp(config)`, `createAuth(app, options)`, `createFirestore(app)`,
`checkAuthPersistence()` e `getRedirectResult(auth)`. São dependências de construção,
não mocks de transações. As três fábricas são síncronas; `ready()` continua aguardando
authStateReady e conclusão de redirect. Erro de fábrica injetada propaga, sem
inicializar outra instância padrão ou cair em cache persistente de produção.

**Sessão/bloqueio:** permanecem os contratos existentes de identidade de sessão,
`onTransition`, `onAccount`, `onState`, `waitLocal`, `storageBlocked` e current(s).
Uma futura composição de teste pode fornecer um controlador/adaptador por essas
fábricas. Não foi adicionado lock automático, estado visual de desbloqueio, UI de
senha, persistência de chaves, descoberta de cofre ou autorização por UID.

## Uso explícito em testes

```js
import { configurarDependenciasAplicacao, criarArmazenamento } from './storage.js';
configurarDependenciasAplicacao({
    storage: criarArmazenamento(storageSintetico),
    openPersistence: () => bancoSintetico,
    readLegacyMetadata: uid => lerMetadadosSinteticos(uid)
});
await import('./app.js');
```

O chamador registra antes da importação do app. O registro valida nomes/tipos,
copia as referências e só aceita uma configuração. A captura é congelada e impede
troca tardia de backend durante uma sessão. Omitir campos mantém os defaults;
`vaultEnabled` ou outro campo desconhecido é recusado. Não existe leitura de
override em URL/localStorage/window, nem configuração persistida para ativação.
As referências dos adaptadores continuam objetos de código confiável; freeze do
mapa não torna os objetos imutáveis nem é uma barreira contra XSS.

`index.html` não chama esse registro. Continua importando `app.js` normalmente,
sem configuração adicional. O teste altera apenas o documento servido pelo seu
servidor loopback para importar primeiro o bootstrap sintético; não altera o HTML
do projeto ou o texto de app.js. O armazenamento padrão é construído como antes,
inclusive seu probe de disponibilidade; injeção não promete impedir esse probe.

## Compatibilidade e limites de escopo

Os defaults mantêm o banco `controleFinanceiro:integridade:v1`, seu schema e os
validadores atuais. Sem injeção, os pontos chamam as mesmas funções/classes,
na mesma ordem e nos mesmos blocos try/catch. O carregamento do bundle conserva
`_release`, e login continua chamado dentro do gesto do usuário.

Auth padrão continua com browserLocalPersistence, indexedDBLocalPersistence e
browserSessionPersistence nessa ordem, e browserPopupRedirectResolver. Firestore
padrão conserva cache persistente, fallback em memória e getFirestore anteriores.
O runtime opcional não altera esses defaults; no Emulator fornece instâncias em
memória conectadas a loopback antes das operações. Regras/transações reais são
mantidas. Nenhuma regra Firestore foi modificada.

Não se alterou inicialização de dados, importação legada, restauração ou lógica
financeira. As migrações legadas que já pertencem ao app continuam iguais no
caminho padrão; nenhuma migração nova foi adicionada ou executada em dados reais.
Todos os browsers usam perfis novos e somente fixtures sintéticas. O teste padrão
usa o nome original do banco dentro desse perfil vazio; não abre o perfil pessoal
ou o banco existente do usuário. Os testes injetados usam banco com sufixo sintético.
Nenhum banco/cache/perfil é limpo ou excluído.

Os módulos do cofre continuam fora do grafo de app.js. A inspeção de bancos na
prova de app confirma ausência de banco do cofre. A regressão do cofre é executada
separadamente em seu harness; não é ativação no aplicativo.

## Parte de ciclo de vida deliberadamente não implementada

A aplicação hoje assume estado disponível para seu bootstrap local e seus
callbacks de UI. Um cofre bloqueado não pode cumprir essa suposição fornecendo
estado vazio. Ligar Auth a desbloqueio/bloqueio, ocultação de plaintext, BFCache,
troca de cliente SDK por sessão, prontidão e recuperação exigirá revisão do ciclo
de vida. Essa parte foi interrompida antes de implementação, conforme a restrição.

Proposta para homologação futura: coordenador explícito de sessão com fases de
prontidão, cancelamento por identidade/época antes de cada entrega/commit, lock
durável e callbacks de UI após desbloqueio válido. Definir se a conexão anônima
exige outro adaptador e como tratar documentos `@local`. Requer especificação e
autorização próprias; nenhuma dessas transições foi adicionada nesta etapa.

Permanece também um acesso direto ao localStorage no caminho antigo de
`migrationBackup`, além de cache de tema e sinalização visual de atualização.
Esse fluxo legado não foi reescrito ou migrado. A homologação com cofre deve
inventariá-lo antes de usar dados reais; a fábrica atual não garante encapsular
todo mecanismo de armazenamento do aplicativo.

## Arquivos alterados/criados nesta etapa

- `app.js`: composição e substituição das instanciações por fábricas equivalentes.
- `storage.js`: configurar/capturar dependências, sem alterar o storage padrão.
- `automatic-finance-sync.js`: leitor opcional de metadados e rejeição de retorno inválido.
- `firebase-sync-entry.js`: runtime SDK opcional, com defaults preservados.
- `tests/app-dependency-injection.test.js`: captura/defaults, falhas e metadados isolados.
- `tests/firebase-runtime-injection.test.js`: construção SDK/ready e falhas sem fallback.
- `tests/fixtures/app-injection-bootstrap.mjs`: composição explícita exclusivamente sintética.
- `scripts/run-app-injection-browser.mjs`: app completo padrão/injetado, perfis novos.
- `tests/fixtures/vault-real-emulator-factory.mjs`: usa agora a API oficial; substitui
  a transformação de imports por injeção explícita, preservando os cenários anteriores.
- `tests/finance-vault-real-emulator.test.js`: acrescenta ready real com runtime sintético.
- `tests/auth-button.test.js`, `tests/app-sync.test.js`, `tests/settings-safety.test.js`:
  contextos VM recebem agora o loader/leitor oficial; removida a substituição textual
  do import no teste de login, mantendo as asserções de sessão/popup/contas.
- `docs/cofre-local-pontos-integracao.md`: este relatório.

Os demais arquivos locais anteriores foram preservados. `indexeddb-persistence.js`,
`financial-atomic-service.js`, `sw.js`, regras e index.html permanecem sem alterações.
Não há novas dependências npm ou bundle publicado/regenerado no repositório.

## Validações

```powershell
node --test tests/app-dependency-injection.test.js tests/firebase-runtime-injection.test.js tests/firebase-sync-client.test.js
node scripts/run-app-injection-browser.mjs
node scripts/run-vault-real-emulator.mjs
node scripts/run-vault-real-browser.mjs
node scripts/audit-vault-independent.mjs
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

| Verificação | Resultado |
| --- | --- |
| Novos testes Node de injeção (composição + runtime) | 8 aprovados, sem falhas/ignorados |
| Novos testes + regressão da fábrica Firebase | 29 aprovados, 1 ignorado dependente do Emulator |
| Regressão Auth/app-sync e novos testes após ajuste VM | 67 aprovados, sem falhas/ignorados |
| Segurança de configurações após ajuste VM | 59 aprovados, sem falhas/ignorados |
| Aplicativo completo Edge/Chrome | 12 aprovados, sem falhas/ignorados |
| SDK/Auth/Firestore Emulator com injeção oficial, inclusive ready | 5 aprovados, sem falhas/ignorados |
| Harness independente Node/Edge/Chrome | 30 aprovados, zero violações/erros/ignorados |
| `npm.cmd test` final, 804 descobertos | 798 aprovados, 0 falhas/cancelamentos, 6 ignorados, saída 0 |
| Regressão browser do harness de adaptadores reais, repetida separadamente | 52 aprovados, sem falhas/ignorados/intervenção, saída 0 |
| `npm.cmd run check` | Aprovado, saída 0 |
| Sintaxe adicional de 13 arquivos | Aprovada, saída 0 |
| `git diff --check` | Aprovado |

A suíte geral final terminou em 521,3 segundos, sem intervenção e sem timeout.
Inclui novamente os testes de criptografia (100), backend (64), Etapa 4 (72) e
integração anterior (50) em Edge/Chrome, além das regressões Node de filas,
escritas, migração, sessões, restauração e pacote legado de 4.522.367 bytes.
Totais se sobrepõem e não devem ser somados. Timeout e execução sequencial seguem
a homologação anterior.

**Ignorados:** seis grupos condicionados ao ambiente na suíte geral: quatro
anteriores de regras/protocolo, integração SDK/Emulator anterior e adaptadores
reais SDK/Emulator. O último foi executado separadamente com cinco aprovações
(grupo + quatro subcenários), usando runtime oficial e ready real. Os demais
runners de Emulator não foram executados nesta etapa e não são homologados por
inferência. Nenhum cenário da matriz de injeção foi ignorado.

Os 12 dos browsers representam seis provas por motor: padrão sem injeção,
composição injetada, erro de abertura de banco sem fallback, erro do loader Firebase
com estado local preservado, offline/ACK/A–B–A/logout e reinício completo de processo.
Os testes de padrão/injeção comparam estado e fila inteiros após reload e verificam
os nomes dos bancos; nenhum banco do cofre aparece no app. A falha Firebase não
instancia controlador nem carrega um SDK alternativo silenciosamente.

A primeira suíte completa terminou com 804 testes, 779 aprovados, 19 falhas de
contextos VM antigos e seis ignorados, saída 1. Esses contextos foram atualizados
para a injeção oficial, sem remover testes ou mudar resultados esperados. Os
arquivos afetados passaram separadamente (67/67 e 59/59); a suíte foi repetida
integralmente para não tratar um resultado parcial como aprovação.

Na primeira regressão browser adicional do cofre, o encerramento do perfil Edge
`%TEMP%/cf-real-adapters-msedge-Imm0HT` ficou parado. Após confirmar executável,
PID/pai e perfil, encerrou-se somente sua árvore: Edge 22724, filho do runner Node
19684. Nenhum perfil/banco foi removido, e nenhum processo pessoal foi encerrado.
O runner prosseguiu e terminou 52/52, mas com intervenção; por isso foi repetido
separadamente, antes da suíte geral final. É a limitação operacional de encerramento
de navegador já observada nas etapas anteriores, não um resultado autônomo ocultado.

Os testes iniciais identificaram dois ajustes de harness/compatibilidade: o leitor
de redirect padrão deve continuar resolvido em ready, permitindo os probes
existentes da fábrica; e falha de IDB não garante botão de UI disabled no comportamento
atual. A prova foi corrigida para verificar o contrato real: nenhuma criação de
serviço ou banco de fallback. Não se alterou a UI para satisfazer uma expectativa
incorreta. Todos os testes originais permanecem presentes.

Evidências locais fora do Git: `%TEMP%/cf-injection-node.log`,
`cf-injection-regression.log`, `cf-injection-settings.log`,
`cf-injection-browser-final.log`, `cf-injection-emulator-final.log`,
`cf-injection-audit.log`, `cf-injection-real-sequential.log`,
`cf-injection-full-final.log` e `cf-injection-check.log`. A primeira execução geral
com falhas está preservada em `cf-injection-full-suite.log`.
Perfis da prova final do app: `%TEMP%/cf-app-injection-msedge-zL8Xeb` e
`%TEMP%/cf-app-injection-chrome-TqnUV2`, retidos. Os logs do Emulator informam seu
diretório temporário separado. Não foram detectados padrões de credenciais nos
22 arquivos locais novos/modificados; fixtures, senhas fixas e contas são sintéticas.

Não executados: OAuth Google real, produção, testes próprios de regras/protocolo
alternativo de épocas, UI com cofre desbloqueado/bloqueado, BFCache, dispositivos
móveis físicos, queda física de energia/evicção, benchmark/rotação de DEK ou migração
de dados reais. O Emulator valida o SDK real em Node com o modelo transacional;
o app completo dos browsers usa IndexedDB real e remoto sintético. A execução
única com app+SDK+cofre real permanece critério da próxima etapa.

Uma futura distribuição precisa gerar e servir app/storage/bundle SDK da mesma
versão. Não foi gerado bundle de produção ou alterada a versão do SW; misturar
módulos novos com cópia cacheada antiga não é um modo de atualização homologado.

## Critérios e decisão para a próxima etapa

Antes de homologar o ciclo completo: testar em uma mesma execução browser real,
UI real, SDK no Emulator e persistência cifrada; provar prontidão sem estado vazio,
A–B–A/logout/lock durante awaits, listeners e BFCache/pageshow, falhas/quota/reinício,
ACK individual/global, pacote de recuperação depois de novas escritas e custódia.
Conferir que nenhuma fila ou referência é descartada e que o SDK não cria cache
persistente no modo de cofre. A origem antiga não é rollback após novas escritas.

**Apto para avançar à homologação integrada em ambiente isolado, com dados
sintéticos e composição explícita.** Os pontos de injeção não liberam ativação
do cofre. A mudança significativa de ciclo de vida descrita acima continua como
proposta, sem implementação. Não está homologado o uso do cofre na interface,
OAuth Google real, migração real ou produção.
