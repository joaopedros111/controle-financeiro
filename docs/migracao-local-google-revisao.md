# Migração local para conta Google — descoberta e revisão protegidas

## Escopo e decisão

Trabalho exclusivamente no worktree `feat/google-account-only-data`, baseado em `fdfafe82e65983871b0001060dbdac5da8360f8a`. Não houve commit, push, deploy, alteração de regras ou acesso a dados financeiros reais nesta etapa.

**Importação não homologada e explicitamente bloqueada.** Foi implementada a parte segura: descoberta somente de leitura, análise, revisão do servidor e barreira antes da sincronização. Nenhuma origem é atribuída à conta Google por inferência. Não foi reativado `onFirebaseUser()`/coordenador manual antigo.

## Contratos implementados

- Só há descoberta após identidade corrente e autorização durável do UID; logout, alteração de época ou troca de conta cancelam leituras/respostas atrasadas.
- IndexedDB: `estado:@local` e `fila:@local` são lidos juntos por `lerDocumentos()`, em uma transação **readonly**. Não são incluídos em `alterarDocumentos()` protegido por outro UID; `assertAccountAccess()` permanece intacto.
- localStorage: `controleFinanceiro:v3`, `controleFinanceiro:v2`, `controle-financeiro-dados`, `controleFinanceiro-1` a `controleFinanceiro-12`, filas anônimas `controleFinanceiro:sync`, `:sync:@local`, `:sync:local` e backups `:sync-backup:@local`/`:sync-backup:local`.
- Fonte ausente, JSON inválido, esquema inválido, armazenamento inacessível, par estado/fila incompleto e metadados não verificados são estados distintos. Ausência de fila não é prova de fila vazia.
- A prioridade histórica IndexedDB/v3/v2/armazenamento anterior/mensais aparece na análise; fontes inferiores não são ignoradas. Divergências continuam explicitamente bloqueadas.
- `normalizarEstado()` e `migrarDadosLegados()` são usados apenas em prévias separadas. Os brutos e documentos originais não são regravados. Conversões, IDs de prévia, campos desconhecidos e ano inferido são sinalizados.
- Filas, exclusões, conflitos, revisões, gerações e referências de recuperação não são combinados com a fila Google. Outbox malformada não vira fila vazia.
- `analisarFontesDescobertas()` relata fontes, quantidades por origem, conflitos de IDs, duplicidades e diferenças de configuração. Não faz deduplicação nem aplica orçamento/categoria de uma origem sobre outra.
- `localMigrationSnapshot()` usa leituras do servidor, verifica marcador, lançamentos, configurações/manifestos/partes e conflitos com `snapshotConfirmed()`. Offline, cache, pending writes, protocolo incompatível e dados remotos inválidos bloqueiam a revisão.
- Fontes são lidas antes e depois do snapshot; fingerprint diferente, revisão/fila Google alterada ou sessão obsoleta invalidam o resultado. Fingerprint e prévia em memória **não são apresentados como backup durável**.

## Integração ao aplicativo

`AutomaticFinanceSync.useAccount()` executa a verificação de presença antes de liberar `request(0)`. Se a verificação falhar ou houver fontes não resolvidas, a sessão fica com `localMigration.pending` e não publica. `request`, `run`, `cycle`, flush de logout e restauração respeitam a barreira.

A interface oferece:

1. **Revisar dados antigos:** leitura/análise sem gravação, snapshot remoto confirmado, quantidades e lista de fontes/status. Importação continua bloqueada.
2. **Não importar; continuar só com minha conta Google:** decisão explícita que libera somente a sincronização normal da conta corrente, sem consumir, vincular ou modificar fontes anônimas. Consentimento de outra sessão/geração é rejeitado.

Contas sem fontes antigas mantêm o fluxo existente. Contas preexistentes não são substituídas por uma origem anônima. A decisão de manter separado não é um registro de migração concluída; novo login/reload examina novamente as fontes ainda existentes. Contagens e detalhes da revisão são ocultados no encerramento.

O módulo de revisão é carregado sob demanda. Sua cópia foi acrescentada ao artefato Pages, **sem nova alteração do Service Worker nesta etapa**; revisão remota offline não é oferecida. Hash do `sw.js` no início e após esta etapa: `acb608596ac957708c7f7b60e6f4fd5375493cf8817b22d7663b951b40c0e0cb`. As mudanças de SW já existentes antes desta solicitação foram preservadas.

## Por que a importação permanece bloqueada

1. `alterarDocumentos()` grava todas as chaves fornecidas e seu guard isola UID. Falta contrato homologado que revalide a revisão da origem anônima e grave somente estado/fila/recuperação do UID, sem contornar o guard.
2. localStorage e IndexedDB não compartilham transação. Falta diário durável de materialização, identificação da origem, consentimento e retomada após interrupção; um objeto em memória não resolve isso.
3. Falta mapeamento aprovado de IDs/revisões/gerações, tombstones, operações tentadas, ACKs e conflitos anônimos. Copiar outbox ou usar `combinarRegistros()` como importador poderia ressuscitar exclusões ou duplicar operações.
4. Campos divergentes, fontes inválidas, ano mensal inferido e configurações da conta Google exigem resolução explícita. Não há política segura para escolher valores silenciosamente.

`importarFontesAnonimas()` sempre lança `migration/import-blocked`, inclusive com consentimento e em repetições. Não há escrita parcial nem marcador fictício de conclusão. A origem anônima permanece intacta; uma futura limpeza exige confirmação remota e decisão explícita separada.

## Testes e evidências

Logs, traces e perfis sintéticos são preservados em `.validation/migration/`, dentro deste worktree. Não devem integrar um futuro commit.

- Referência: **27/27** (17 testes preexistentes de migração + 10 de política).
- Descoberta/análise após ampliação: **43/43**.
- Integração real do sincronizador/serviço atômico com a barreira: **7/7**. A fixture inicialmente modelava dado Google sem outbox e sem cópia remota; foi corrigida para representar operação rastreada, sem enfraquecer `sync/untracked-data`.
- Conjunto direcionado completo mais recente: **76/76** (inclui política e transporte de gerações; não somar às contagens acima).
- Novos E2E de migração: **6/6** em Edge/Chrome. Preservação de estado/fila/tombstone, ausência de publicação antes da decisão, revisão cacheada rejeitada, logout durante snapshot atrasado e fontes intactas após reload.
- Primeira suíte geral: **923 aprovados, 2 falhos, 6 ignorados**, total 931. Falhas: porta efêmera 4045 rejeitada pelo navegador e revisão de catálogo concorrente no harness do cofre. Ambos passaram isoladamente sem alterações no cofre (2/2 arquivos; 100 casos internos de criptografia e 50 de integração). Isso não comprova correção das intermitências.
- Regressão inicial de navegador encontrou defeito do próprio teste: tentava importar outro URL de módulo depois de ficar offline. Corrigido para inspeção IndexedDB nativa estritamente readonly, sem criação silenciosa de banco.
- Reinício real isolado: **Chrome aprovado, Edge com timeout**. O trace Edge mostra espera por visibilidade do botão de login em perfil persistente. Não foi comprovado se a causa está no ambiente Edge, fixture ou aplicação; permanece bloqueador. Não foi removido nem convertido em aprovação.
- Sintaxe (`npm run check` e `node --check` dos novos módulos): aprovada na rodada registrada.
- Suíte geral final: **926 aprovados, 0 falhas, 6 ignorados**, total 932; saída 0. Log: `global-final.log`. As falhas da primeira rodada permanecem registradas como intermitências, não como causas corrigidas.
- Firestore isolado: **26/26**, saída 0. Porta 8180; Hub 4600, logging 4700 e websocket 9250. Os erros PERMISSION_DENIED no log são rejeições esperadas dos testes de regras.
- Regressões finais de navegador sem repetir o reinício já diagnosticado: **18/18**. Consolidado dos 20 cenários únicos: **19 aprovados e 1 falho** (reinício Edge). Os 6 E2E novos estão incluídos nos 18; não somar rodadas repetidas.
- Build Pages: aprovado, módulo de revisão presente em `.validation/migration/pages-final/`; nenhum deploy. O artefato gerado não substituiu arquivos fonte.
- `npm run check`, checagens de sintaxe dos novos arquivos e `git diff --check`: aprovados.
- Manifesto de resultados, códigos de saída e SHA-256 dos logs: `.validation/migration/resultados.json`.
- Seis testes condicionais da suíte global continuam **ignorados**, sem conversão em aprovação. Os testes de regras foram executados separadamente; integração condicional do cofre/epoch não foi repetida com Emulators nesta etapa.
- Auditoria de dependências não foi repetida: manifests e lockfile não foram alterados nesta etapa. OAuth real, testes manuais em dispositivo de usuário e publicação não foram executados.
- A consulta de versão do Firebase CLI mostrou uma leitura pública de metadados `firebase-public.firebaseio.com/cli.json`; isso não é um acesso ao Firestore de usuários. Os testes financeiros usaram somente os Emulators locais.

## Arquivos desta etapa

- `account-local-migration.js`: descoberta, análise e revisão; importação bloqueada.
- `account-data-policy.js`: presença autenticada de fontes e constantes de chaves.
- `indexeddb-persistence.js`: snapshot readonly de múltiplos documentos.
- `automatic-finance-sync.js`: barreira e consentimento de separação com validação de sessão/geração.
- `finance-generation-transport.js`: snapshot confirmado de revisão e validação de metadados de componentes.
- `app.js`: revisão explícita, lista de fontes e bloqueio de edição/publicação enquanto pendente.
- `scripts/prepare-pages.mjs`: inclui o módulo de revisão no artefato, sem ativá-lo no bootstrap.
- `scripts/run-local-tests.mjs`: falhas/atrasos de snapshot somente na fixture isolada.
- `tests/account-local-migration.test.js`, `tests/account-migration-integration.test.js`, `tests/finance-generation-restore.test.js`, `e2e/google-account-policy.spec.mjs`: cobertura e correções das fixtures afetadas.
- Este relatório. Alterações, backups `.bak`/`.bak2` e outros arquivos preexistentes do worktree foram preservados.

## Riscos e critérios para próxima etapa

**Não pronto para produção como migração completa.** Para avançar: homologar o diário durável e a operação atômica específica de importação; resolver tombstones/conflitos/filas sem descartar histórico; comprovar idempotência e retomada reais; resolver o reinício Edge; manter a suíte geral verde e diagnosticar as intermitências registradas; realizar os smoke tests/OAuth Google real ainda não executados.

Falhas simultâneas de IndexedDB e `signOut()`, assim como troca de UID durante a drenagem completa do logout, não foram homologadas como combinações nesta etapa. Não considerar a saída ou uma revogação durável confirmadas se ambos os mecanismos falharem. Esses cenários precisam de testes determinísticos e tratamento antes de produção.

Os testes usam identidades sintéticas no Auth Emulator; não aprovam OAuth Google real. Dados pendentes e legados preservados continuam fisicamente no armazenamento do navegador; ocultação da interface não é criptografia, e o Cofre Local segue desativado. Fontes de outros UIDs ou bancos fora do contrato não são lidas, atribuídas ou limpas por esta revisão.

## Continuação — diário transacional e recuperação (2026-11-05)

Esta seção sucede a decisão histórica de importação totalmente bloqueada descrita acima. Não transforma os resultados anteriores em evidência da implementação nova. Trabalho apenas no mesmo worktree/branch; HEAD continua `fdfafe82e65983871b0001060dbdac5da8360f8a`, sem commit, staging, push ou deploy. O projeto original não foi editado.

### Reinício Edge: causa comprovada e correção

Os traces e `.validation/migration-next/edge-events.log` mostram o teste tentando abrir Ajustes quando `html` ainda tinha `app-inicializando`, `__authSubscriptions` era indefinido e o status ainda era o HTML inicial “Somente neste dispositivo”. O botão habilitado no HTML não comprovava que seus handlers existiam. O diálogo permanecia fechado; o teste esgotava 60 segundos tentando clicar em um login invisível. O estado posterior já inicializado não explica o clique perdido anterior.

A correção está em `start()` do E2E: esperar a saída de `app-inicializando` e a inscrição Auth efetiva única antes de interagir. Não houve aumento de timeout, clique forçado nem alteração do bootstrap para esconder o defeito do teste. `.validation/migration-next/native-first.log` registra o reinício de processos reais aprovado no Edge e Chrome, preservando os perfis sintéticos. Isso corrige a corrida demonstrada no harness; não é uma conclusão geral sobre falhas de inicialização do aplicativo.

### Contrato implementado e limite deliberado

A importação consentida está implementada para **um par IndexedDB anônimo válido, normalizado, com IDs estáveis e fila estritamente vazia/conhecida**, sem fontes localStorage presentes, conversões, metadados desconhecidos, recuperações ou exclusões pendentes. Exige destino Google sem lançamentos locais/remotos, sem revisões históricas rastreadas e sem configurações locais não confirmadas. Configurações remotas existentes só são aceitas se equivalentes às da origem; dados/configurações incompatíveis não são sobrescritos. Orçamentos mensais requerem protocolo de geração compatível.

As demais combinações continuam bloqueadas: filas offline anônimas, tombstones, conflitos, fontes divergentes/ilegíveis, IDs a criar, fontes de múltiplos backends, destino com dados ou configurações divergentes. Não se descartam fontes inferiores para tornar uma origem artificialmente elegível. Não há deduplicação automática nem atribuição de propriedade por inferência. O antigo `importarFontesAnonimas()` sem o novo protocolo permanece bloqueado.

### Diário e atomicidade

- `prepararImportacaoAnonima()` produz prévia vinculada em memória ao plano privado, após leitura do servidor, revalidação das fontes e do par Google. A interface mostra registros e configurações; ainda não grava nem publica.
- `registrarConsentimentoMigracao()` exige a revisão original, consentimento e declaração explícita de propriedade. Persiste diário `restore-recovery:<uid>:migration-<SHA256(uid,fingerprint,generation)>`, com origem integral, revisão/fila originais, estado/fila anteriores do destino, snapshot remoto, geração, IDs de operações e consentimento datado.
- Estado **prepared** é recuperável sem qualquer alteração financeira. A chave determinística permite reencontrar o mesmo plano após reinício, mantendo a origem intacta.
- `PersistenciaFinanceira.alterarComLeituras()` distingue write-set e read-set na mesma transação nativa. `estado:@local`/`fila:@local` são exclusivamente lidos; nunca entram no write-set de outro UID. `assertAccountAccess()` não foi relaxado: época, UID e encerramento são validados na transação antes das escritas.
- `retomarImportacaoAnonima()` exige sessão atual síncrona na callback transacional, autorização durável, revalidação remota confirmada e geração correspondente. Para prepared, compara integralmente origem, destino e remoto revisados. Estado Google, fila e recibo **applied** são gravados juntos, ou nenhum deles. Quota/abortos deixam prepared e os pares anteriores preservados.
- Cada intenção é aditiva, com ID determinístico e `baseRevision: null`. As transações reais do sincronizador rejeitam criação concorrente ou tombstone; não há restauração em massa nem substituição remota.
- Applied/confirmed são recibos idempotentes: não reaplicam o estado antigo, inclusive após edições posteriores. Abas aceitam o recibo do **mesmo plano imutável** já aplicado; diferenças de origem, operações, consentimento ou destino do plano continuam rejeitadas.
- A fila guarda uma referência ao diário applied, impedindo limpeza sem prova. `consultarImportacaoPendente()` permite revisão/retomada explícita após reload sem copiar a origem novamente. A barreira só é liberada por “manter separado” ou recibo durável de importação da sessão/geração atual.
- `reconciliarImportacaoAnonima()` só marca **confirmed** após snapshot de servidor válido, revisões remotas exatamente iguais aos IDs das operações importadas, valores e configurações equivalentes, fila sem pendências/conflitos e confirmação durável da revisão/geração atuais. A interface chama essa conferência após o sincronizador sinalizar confirmação; falhas mantêm a recuperação e aviso. Remove-se somente a referência pendente deste diário, nunca o diário nem a origem.
- Um diário inválido, geração alterada, ACK perdido, conflito remoto ou UID revogado não é interpretado como sucesso/estado vazio. O usuário deve revisar; a importação não apaga tombstones, conflitos ou referências alheias.

### Falhas encontradas durante esta continuação

1. Corrida do harness no início do Edge: corrigida com condição observável de bootstrap, descrita acima.
2. O primeiro teste de quota mostrou que `tx.onerror` descartava o erro síncrono original da transformação, exibindo apenas “Falha na transação”. Foi preservado `erroTransformacao` também nesse evento. A asserção de quota não foi enfraquecida; o teste confirmou rollback financeiro e diário prepared preservado.
3. A primeira rodada de duas abas deixou a perdedora bloqueada por “Outra aba alterou o diário”: não houve reaplicação/perda, mas a retomada não aceitava a evolução legítima prepared→applied da outra aba. A comparação passou a separar plano imutável de recibo/estado de execução. Testes determinísticos agora exigem sucesso nas duas chamadas e uma única operação. Edge/Chrome confirmaram a correção, incluindo logout após consentimento com callback atrasado.
4. As falhas iniciais de contrato dos testes Node eram fixtures incompletas (`_docId` remoto e método `alterar()` ausentes); foram corrigidas nas fixtures, sem enfraquecer a validação de snapshots.

### Arquivos desta continuação

`account-local-migration.js` (plano, consentimento, diário, retomada e reconciliação); `indexeddb-persistence.js` (read-set separado e preservação do erro original); `automatic-finance-sync.js` (liberação por recibo durável da sessão); `app.js` (prévia, confirmação explícita, retomada e conferência do ACK); `scripts/run-local-tests.mjs` (interrupção de commit somente na fixture sintética); `e2e/google-account-policy.spec.mjs` (bootstrap, reinício e testes nativos de migração); novo `tests/account-migration-journal.test.js`; este relatório e evidências em `.validation/migration-next/`.

As alterações anteriores, inclusive arquivos `.bak`/`.bak2`, foram preservadas. `sw.js` não mudou nesta continuação (SHA256 `acb608596ac957708c7f7b60e6f4fd5375493cf8817b22d7663b951b40c0e0cb`). Não foi ativado o Cofre Local.

### Limitações que impedem aprovação irrestrita de produção

- O subconjunto elegível não resolve a migração de fontes localStorage/mensais, filas antigas, exclusões, configurações incompatíveis ou contas já povoadas. Permanecem bloqueadas até contrato e testes específicos; não existe consentimento que dispense essas provas.
- Diário e origem são locais em texto claro, tal como a persistência financeira atual. Durabilidade não é backup externo, criptografia ou proteção contra adulteração do dispositivo. Excluir os dados do navegador pode perder a recuperação local antes do ACK.
- Diários prepared cuja origem mudou, múltiplos diários pendentes ou confirmação remota divergente exigem recuperação manual/revisão; não há reparação automática nem ferramenta de resolução completa nesta entrega. O recibo e os brutos são preservados.
- Após confirmação, a fonte anônima permanece. Um novo carregamento pode pedir revisão/separação novamente; não existe limpeza automática nem uma decisão de produto sobre retenção/expurgo dos diários.
- Os testes de sessão usam e-mail/senha sintéticos no Auth Emulator; não comprovam OAuth Google real, smoke test humano, BFCache de migração ou instalação/atualização via Service Worker em produção.
- As combinações históricas de falha simultânea IndexedDB+signOut e troca de UID durante a drenagem completa do logout continuam fora da homologação desta migração. Não foram declaradas corrigidas por estes testes.
- A intermitência histórica dos harnesses gerais (porta Chromium inválida e corrida de catálogo) permanece registrada; uma rodada verde não demonstra sua causa solucionada.

**Decisão:** o protocolo restrito pode ser homologado apenas nos cenários efetivamente aprovados abaixo. A migração geral e a publicação continuam **BLOQUEADAS** pelas limitações acima; esta entrega não autoriza excluir dados reais ou publicar.

### Resultados comprovados desta continuação

Todos os logs abaixo estão em `.validation/migration-next/`. Contagens de execuções repetidas e subconjuntos **não são somadas** à suíte geral.

| Execução | Aprovados | Falhas | Ignorados/não executados | Evidência |
|---|---:|---:|---:|---|
| Unidade/integração direcionadas, estado final | 101 | 0 | 0 | `targeted-current.log` — inclui os 19 testes do diário, revisão, barreira, política de conta, CP-05 e gerações |
| E2E Google completo (Edge 16 + Chrome 16) | 32 | 0 | 0 | `browser-consolidated.log`, exit 0; reinício de processos reais e 12 cenários novos de migração nos dois navegadores |
| Firestore isolado (regras + cliente real) | 26 | 0 | 0 | `firestore-final.log`, exit 0 |
| `npm.cmd test` | **944** | **1** | **6 ignorados** | `global-final.log`, exit **1**, 951 testes registrados |
| Harness antigo do cofre, investigação isolada sem correção | 50 verificações internas | 0 | 0 | `historical-integration-isolated.log`, exit 0; não substitui o resultado global |
| `npm.cmd run check` | aprovado | 0 | — | `check-final.log`, exit 0 |
| Sintaxe adicional + `git diff --check` | aprovado | 0 | — | `static-final.log` e metadados finais |

A execução global falhou em `scripts/test-vault-integration-browser.mjs:61`, nas edições simultâneas de duas abas, com `VaultControllerError: Revisão do catálogo alterada` (`integration.js` gerado, `Object.read` → `editIntegration`). O runner e os módulos de catálogo/cofre não foram modificados nesta continuação. A mesma classe de falha já está registrada na evidência histórica desta branch. A execução isolada posterior passou 50/50 sem alterações. Isso é evidência de intermitência do cenário/contrato de concorrência, **não comprovação de causa ambiental nem correção**. Não foi aumentado timeout nem repetida a suíte para substituir a falha por uma rodada verde. A pendência continua aberta e impede chamar a árvore de globalmente verde.

Após a rodada global, a revisão estática acrescentou somente uma restrição adicional: revisão local Google negativa também bloqueia o plano. Os 101 testes direcionados foram reexecutados sobre esse estado final, incluindo a asserção negativa; a suíte geral não foi repetida após essa restrição. Os cenários E2E usam revisões válidas. Este limite temporal das evidências não deve ser omitido na homologação consolidada futura.

Os seis ignorados da suíte geral foram: `epoch emulator: protocol and server-enforced invariants`; `synthetic Auth/Firestore Emulator integration with isolated encrypted persistence`; `real Firebase factory + AutomaticFinanceSync + encrypted vault, isolated SDK/Emulator`; `cliente de produção executa transações e configurações nas regras do Emulator`; `generation barrier atomically publishes complete restores, fences legacy/offline clients and retains recovery namespaces`; `Firestore rules restrict records by UID and require tombstones`. Os três últimos foram exercitados separadamente pelo runner Firestore isolado. Os três primeiros não foram executados nesta continuação e não são aprovados por associação aos testes de migração.

Os Emulators desta execução são de projeto demo, Firestore `8180`, Auth `9199`, Hub `4600`, logging `4700`, WebSocket `9250`, com armazenamento, configurações e perfis sintéticos próprios. Os runners sondam portas antes de iniciar e não encerram instâncias preexistentes. Não houve conexão financeira de produção nem uso de dados reais. Configurações originais, dependências e Service Worker foram preservados.

Evidências das falhas de diagnóstico, inclusive as rodadas interrompidas e os testes não executados nessas rodadas, permanecem nos logs `edge-diagnosis.log`, `edge-events.log`, `journal-first.log`, `journal-contract.log`, `native-recovery.log`, `browser-final.log` e respectivos diretórios `tmp/controle-financeiro-homolog-*`. Somente as execuções consolidadas da tabela representam os resultados atuais de cada conjunto.

**Conclusão final:** reinício Edge corrigido no harness e protocolo de importação restrita/consentida com diário homologado nos 32 E2E e 101 testes direcionados. Migrações não demonstradas continuam bloqueadas. **NÃO PRONTO PARA PRODUÇÃO**: há uma falha global aberta, cenários de sessão ainda não homologados e as limitações funcionais/de retenção e OAuth/cache descritas acima. Próximo passo: investigar determinísticamente a corrida de catálogo do harness antigo, homologar as combinações de falha de sessão pendentes e definir o contrato das origens hoje bloqueadas, antes de qualquer publicação ou uso com dados reais.

## Estabilidade do catálogo e inicialização offline — continuação de 2026-11-05

Esta seção sucede os resultados anteriores. Foram preservados o HEAD e a branch `feat/google-account-only-data`, as alterações locais anteriores e os artefatos de `.validation/migration-next/`. As evidências novas estão em `.validation/stability/`. O projeto original e a publicação não foram modificados.

### Causa-raiz da falha global

A falha em `scripts/test-vault-integration-browser.mjs:61` não era um timeout nem foi atribuída ao Emulator. O cenário executa `addIncome()`/`editIntegration()` em duas abas, com catálogos próprios para o mesmo cofre sintético. `editIntegration()` começa por `session.db.ler()` para obter a base da edição.

Em `experimental/finance-vault-persistence.js`, somente `alterarDocumentos()` participava do Web Lock compartilhado. `ler()` executava `vault.read()` fora dele. O controlador lê o controle/catalogo antes, decripta o snapshot e verifica o controle novamente. Uma escrita cooperante podia confirmar entre essas leituras, produzindo corretamente `stale-revision`. A exceção chegava ao helper antes de a edição alcançar o merge/CAS, portanto o retry da escrita não a tratava. A execução isolada podia passar por diferença de escalonamento; carga concorrente da suíte tornava o intervalo mais provável. Não foi encontrada dependência de dados de outro teste para reproduzir a sequência.

`tests/vault-catalog-read-concurrency.test.js` introduz barreiras determinísticas: captura o primeiro catálogo, confirma uma escrita e só então libera a leitura. O controlador bruto continua rejeitando essa leitura inconsistente. O teste cooperante demonstra a ausência do lock antes da correção (`catalog-before.log`) e a ordenação correta depois dela; também testa revogação enquanto um leitor aguarda o lock.

A correção mínima foi fazer `db.ler()` usar **o mesmo Web Lock existente** que a escrita, repetindo a validação da sessão dentro do lock. O nome/escopo da coordenação de escrita foi preservado. Não há lock recursivo: as mutações continuam usando `vault.read()` diretamente dentro de sua seção crítica. Não se relaxaram as verificações de catálogo, geração, época, contexto, IV, CAS ou sessão. Escritores não cooperantes/ambientes sem Web Locks continuam sujeitos à rejeição segura; não se promete sucesso nessas condições. O adaptador é experimental/sintético e permanece desconectado do aplicativo publicado.

### Problema offline: evidência publicada e reprodução

O usuário identificou o ambiente real como **iPhone XR, PWA standalone, Safari/iOS**, sem informar ainda a versão instalada. Foram obtidos apenas arquivos públicos, por GET sem autenticação, da publicação `https://joaopedros111.github.io/controle-financeiro/`. O `version.json` consultado informa **1.1.103**. HTML, app, CSS, SW e bundle Firebase foram preservados com hashes em `public-inspection.json`; o SW publicado informa a mesma versão (cache v114). Não foi inicializado SDK de produção nem acessado dado de usuário para essa inspeção.

No bundle publicado e no SDK real instalado foi confirmado o fluxo: Auth inicializa proativamente o resolver de popup/redirect para Safari/iOS/mobile (`_shouldInitProactively`); sua inicialização aguarda `_initialize()` → `_openIframe()` → carregamento do helper GAPI. `authStateReady()` e a entrega inicial do observador aguardam a inicialização de Auth. O factory do aplicativo preserva esse contrato; o bootstrap, por sua vez, aguardava `AutomaticFinanceSync.start()` para liberar a interface.

Enquanto isso, `html.app-inicializando .container` mantém o conteúdo invisível, mas o botão Menu fica fora desse conteúdo. Uma conexão aparentemente online que não conclui o helper pode manter a tela nesse estado. Ao ocorrer falha de rede explícita, como no modo avião, o SDK pode finalizar a tentativa, entregar o estado de sessão e liberar o bootstrap. Não se deve usar `navigator.onLine` como confirmação de acesso à internet ou identidade.

Foram feitas duas reproduções complementares:

1. **Módulo Firebase sem resposta**, com `navigator.onLine === true`: o bootstrap publicado e o worktree anterior permanecem ocultos. Logs `published-offline-reproduction.log` e `worktree-offline-reproduction.log`.
2. **SDK Auth real no ramo Safari/mobile**, selecionado por user-agent em Chromium: reteve-se o carregamento do helper antes de qualquer conexão externa. Com uma única inscrição Auth, nenhum callback inicial era entregue; a interface antiga permanecia oculta. Ao simular offline e abortar a requisição retida, a interface apareceu. O comportamento foi confirmado tanto no bootstrap publicado quanto na cópia anterior do worktree: `published-sdk-safari-confirmed.log` e `worktree-sdk-safari-confirmed.log`. O status textual antigo da publicação é diferente do novo fluxo Google-only; a primeira execução dessa comparação chegou à reprodução, mas falhou por esperar o texto novo no bootstrap antigo. Essa expectativa foi corrigida para distinguir as duas versões, sem alterar a asserção de ocultação/liberação.

Os replays do bootstrap publicado usam seu `app.js` capturado, ajustando somente os parâmetros `_release` ao site isolado. Configuração e factory SDK de teste apontam exclusivamente aos Emulators. São evidência do fluxo publicado em ambiente sintético, não execução autenticada da aplicação de produção nem reprodução física no iPhone.

### Correção de inicialização e diagnóstico

`app.js` agora libera a interface pública ao concluir suas fases técnicas/locais, sem aguardar importação do bundle Firebase, Auth, redirect ou sincronização. A transição de conta também não oculta o shell público. Ela continua ocultando/resetando a **visão** financeira e bloqueando edições; nenhum estado persistido é zerado por essa liberação visual.

A entrega da identidade não ativa `contaFinanceiraVisivel`. Somente `onState`, após verificar autorização durável/UID corrente e hidratar os dados do proprietário correto, habilita a interface financeira. O indicador de acesso ao armazenamento mantém o contrato anterior do coordenador; não foi confundido com a permissão visual. Um teste inicial encontrou essa distinção: manter o armazenamento bloqueado até a callback visual assíncrona podia interromper a sincronização legítima; o ajuste preservou a validação de armazenamento já concluída e manteve apenas a edição/visão bloqueadas até a hidratação. `public-shell-bootstrap.test.js` cobre essa fronteira.

Não foram alterados SDK/Auth de produção, persistência, controlador de sincronização, Service Worker ou regras. Não foram acrescentados timeouts de autorização, bypass por offline, identidade presumida ou limpeza de dados. As verificações e promessas de Auth continuam intactas; apenas a navegação pública deixa de depender delas.

O diagnóstico passou a mostrar **build do HTML, build do JS, conectividade aparente e modo standalone** a partir de informações locais, sem depender de rede. A informação “Versão instalada” existente continua usando a validação de versão do SW/metadados; o novo campo não se apresenta como comprovação da versão do SW. A publicação já possui “Menu → Sobre e diagnóstico”, “Versão instalada”, “Versão publicada” e diagnóstico do SW/armazenamento. Com SW controlador ativo, a versão pode ser lida por mensagem local ao worker. Em uma conexão sem resposta e sem controlador, o fallback de metadados pode ficar pendente; o novo build local permanece consultável apesar disso.

Para identificar o build do iPhone, basta anotar “Versão instalada” em Menu → Sobre e diagnóstico, usando o modo avião como contorno de leitura se necessário. **Não é necessário remover/reinstalar o PWA nem limpar dados** para coletar essa informação.

### Rede, cache e limites do ensaio

Além dos faults controlados, o E2E usa um SW real e cache real em contexto sintético, viewport móvel, login/edição/sincronização/logout e fechamento/reabertura de página. A rede fica aparentemente online enquanto servidor loopback e transporte do Emulator não respondem. O endpoint sintético de evidência prova que uma requisição do próprio SW chegou ao servidor e ficou sem resposta; a Promise do fetch continua pendente enquanto a interface permanece utilizável. Também são retidas verificações de versão/atualização do SW. Depois, o mesmo cache é exercitado com offline explícito. Em ambos os modos, nenhuma informação financeira da conta encerrada aparece.

O servidor só aplica esse comportamento à configuração/cookie exclusiva dos perfis sintéticos; ela não existe na aplicação publicada. O primeiro ensaio desse probe usava routing amplo demais e retinha a requisição antes de ela alcançar o servidor, invalidando a evidência esperada. A interceptação foi corrigida no harness: o servidor simula o buraco negro da mesma origem, enquanto destinos externos são bloqueados e o transporte do Emulator é retido separadamente. `pwa-blackhole-proof.log` contém as provas positivas dos dois navegadores. Não houve modificação de SW para fazer o teste passar.

**Limite obrigatório:** user-agent Safari em Chromium exercita a seleção de ramo do SDK; não transforma Chromium em WebKit. O binário WebKit não está disponível neste ambiente e não foi instalado. O PWA instalado no iPhone XR, sua versão/cache efetivos, suspensão pelo iOS e OAuth Google real **não foram homologados fisicamente**. A causa arquitetural e a sequência relatada foram reproduzidas, e a correção foi verificada nos ambientes disponíveis; a resolução no aparelho real exige validação posterior autorizada. Um primeiro carregamento completamente offline sem os arquivos essenciais em cache também não é coberto como instalação funcional.

### Preservação da migração e escopo de arquivos

Hashes confirmam que `account-local-migration.js`, `indexeddb-persistence.js` e `automatic-finance-sync.js` continuam idênticos ao estado final da etapa anterior. Diário, consentimento, transação, ACK, referências de recuperação e bloqueios para fontes incompatíveis não foram alterados. O SHA256 de `sw.js` continua `acb608596ac957708c7f7b60e6f4fd5375493cf8817b22d7663b951b40c0e0cb`.

Arquivos alterados nesta continuação: `app.js`; `experimental/finance-vault-persistence.js`; `scripts/run-local-tests.mjs`; `e2e/google-account-policy.spec.mjs`; novos `tests/public-shell-bootstrap.test.js` e `tests/vault-catalog-read-concurrency.test.js`; este relatório e artefatos em `.validation/stability/`. As outras alterações preexistentes não foram descartadas nem atribuídas a esta correção.

### Resultados finais de estabilidade

| Conjunto | Aprovados | Falhas | Ignorados | Evidência em `.validation/stability/` |
|---|---:|---:|---:|---|
| Unidade/integração direcionadas | 198 | 0 | 0 | `targeted-consolidated.log` |
| E2E completo Edge/Chrome | 40 (20 por navegador) | 0 | 0 | `browser-final.log`, `browser-command.json` |
| Suíte global — rodada 1 | 951 | 0 | 6 | `global-1.log`, exit 0 |
| Suíte global — rodada 2 | 950 | 1 | 6 | `global-2.log`, exit 1 |
| Firestore isolado | 26 | 0 | 0 | `firestore-final.log`, exit 0 |
| Pages isolado após a falha global | 2 | 0 | 0 | `pages-isolated.log`, exit 0 |
| Sintaxe e `git diff --check` | aprovado | 0 | — | `check-final.log`, `static-final.log` |

As rodadas globais executaram o mesmo código, sem correções entre elas. Os seis ignorados continuam sendo ignorados, não aprovados. Contagens de execuções/subconjuntos não são somadas. O harness que falhava por catálogo (`scripts/test-vault-integration-browser.mjs`) aprovou suas 50 verificações internas nas duas rodadas globais, com duas abas, fencing e reinício offline; os testes determinísticos também passaram. A correção dessa corrida foi demonstrada e não foi obtida por aumento de timeout ou remoção de asserções.

**Nova ocorrência do Pages histórico:** a segunda rodada falhou em `tests/pages-build.test.js:11`, no teste “Pages build emits synchronized per-run version and cache without changing source”, ao executar `scripts/prepare-pages.mjs:93`. O erro foi `UNKNOWN`, errno `-4094`, syscall `open`, durante `writeFile()` de:

`.validation/stability/tmp/controle-financeiro-pages-lRbG66/site/app.js`

Não houve erro de catálogo nessa rodada. O caminho absoluto tem 165 caracteres; havia aproximadamente 23,8 GB livres no volume C:. O mesmo build passou na primeira rodada global e os dois testes Pages passaram isoladamente depois. O destino da falha já tinha sido removido pelo `finally` existente do próprio teste, impossibilitando examinar seu estado/lock posterior. Logs, stack e contexto foram preservados.

O ponto de falha está confirmado como abertura de um arquivo temporário para a reescrita do bundle de interface após cópia/leitura. **A causa de sistema operacional permanece desconhecida**: não há evidência suficiente para atribuí-la a antivírus, permissão, espaço, caminho longo, processo concorrente ou conteúdo financeiro. Não foram desativadas proteções nem alterados o script Pages, o teste, permissões, caminhos de produção ou políticas de retry. A aprovação isolada não encerra essa intermitência. Uma investigação posterior deve preservar o diretório quando houver falha e capturar as condições da abertura antes do cleanup; até isso ser resolvido, não se declara estabilidade global repetida do build Windows.

### Decisão e pendências

- **Corrida de catálogo:** corrigida para leitores/escritores cooperantes do adaptador experimental; regressão determinística e as duas execuções globais do harness aprovadas. Rejeição segura de leituras inconsistentes/épocas revogadas preservada.
- **Offline:** a classe de bloqueio do bootstrap foi reproduzida no bootstrap publicado e no anterior, inclusive com SDK real no ramo Safari/mobile. A interface pública foi desacoplada dessas esperas e passou em Edge/Chrome com cache/SW real, rede sem resposta mantendo `onLine=true`, offline explícito e callback Auth atrasado. Não se liberou acesso financeiro por timeout ou condição de rede.
- **iPhone XR físico:** ainda pendente. Não há confirmação de versão instalada nem homologação WebKit/Safari standalone real. A reprodução do ramo SDK em Chromium não substitui esse gate. O comportamento no aparelho real não deve ser declarado corrigido em produção antes de um ensaio autorizado.
- **Migração:** diário, consentimento e todos os bloqueios anteriores preservados. Permanecem pendentes as fontes/filas/configurações não abrangidas pelo subconjunto seguro, as combinações históricas de falhas de sessão e OAuth Google real descritas nas seções anteriores.
- **Publicação:** **BLOQUEADA / NÃO PRONTO PARA PRODUÇÃO**. Há uma intermitência de Pages ainda aberta e validações reais de iOS/sessão ainda não executadas. Não foi feito commit, push, merge ou deploy; a correção existe apenas no worktree.

Para a próxima validação no aparelho: registrar primeiro a versão instalada pelo diagnóstico existente (sem limpar o PWA), depois exercitar uma build de homologação autorizada com conta/dados sintéticos em Wi-Fi sem internet e modo avião, fechar/reabrir o PWA standalone e comprovar ausência de dados após logout. Em paralelo, investigar a abertura `UNKNOWN` do Pages com preservação do destino e evidência do Windows. Nenhum desses passos foi iniciado automaticamente sobre ambientes reais.
