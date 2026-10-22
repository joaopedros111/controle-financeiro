# Homologação local e contrato de sincronização

## Ambiente e isolamento

A configuração de `firebase-config.js` é a configuração existente do aplicativo e **não identifica um ambiente de homologação**. Não a use para executar testes. Não há projeto remoto de homologação comprovado nesta revisão. As regras publicadas permanecem fechadas, conforme o estado informado pelo responsável pelo projeto; esta revisão não consulta nem modifica o Console.

`npm run test:rules` e `npm run test:e2e` iniciam apenas emuladores locais do projeto sintético `demo-controle-financeiro`. O runner cria uma pasta nova no diretório temporário do sistema, copia as regras locais e grava configuração, site, logs e resultados nessa pasta. Não reutiliza nem apaga diretórios preexistentes. A porta ocupada provoca interrupção, sem encerrar processos alheios. O bypass de proxy vale apenas para o processo de teste e endereços loopback. O CLI encerra os emuladores ao terminar; interrupções do runner encerram somente sua árvore de processos.

Os testes de navegador substituem a configuração Firebase **na cópia temporária**, conectam Auth/Firestore aos emuladores e usam senha sintética no lugar do redirecionamento Google. O restante da fábrica, persistência Auth, listeners, transações e logout são os módulos reais. Os contextos do navegador bloqueiam requisições para hosts externos. Credenciais, configuração de produção e arquivos publicados não são alterados. A seção HTML estava comentada no início da missão e foi reativada pelo responsável pelo projeto durante a execução; essa mudança externa foi preservada. O runner suporta as duas formas e também cria uma variante sem a seção para testar inicialização local.

## Arquitetura

- `index.html`, CSS e `app.js`: interface, edição, privacidade visual, backup e coordenação de sincronização.
- `finance-core.js`: validação/normalização financeira, centavos inteiros, somas, orçamentos e backups v2/v3.
- `storage.js`: persistência em localStorage, fallback em memória e proteção de conteúdo financeiro inválido.
- `sync-core.js`: identidade lógica, operações determinísticas, fila, equivalência, validação e reconciliação de conflitos.
- `firebase-sync-entry.js`: Auth Google e Firestore modular, cache IndexedDB, listeners, transações e gerações imutáveis de configurações. Esbuild gera o bundle local.
- `sw.js` e `update-manager.js`: recursos estáticos offline e atualização após confirmação. O Service Worker não é o armazenamento financeiro.
- `scripts/prepare-pages.mjs`: prepara artefato de publicação e identidade de versão. Esta homologação não publica esse artefato.

Dados financeiros usam `controleFinanceiro:v3` sem conta ou `controleFinanceiro:v3:uid:<UID>` com conta. Metadados/fila usam `controleFinanceiro:sync:<UID>`. Preferências visuais têm suas chaves próprias. Backups contêm o estado financeiro; não incluem fila, tokens ou autenticação. Privacidade de valores é visual, sem criptografia dos dados locais/backups.

## Fluxo de edição e confirmação

1. A interface valida e persiste o estado financeiro. Se a persistência falhar, informa fallback temporário e não inicia envio dessa gravação.
2. O evento local inclui exclusões explícitas calculadas contra o estado anteriormente salvo. Ausência em uma listagem não é, por si só, intenção de excluir.
3. A fila é persistida antes da rede e mesmo offline. Falha ao ler ou gravar a fila pausa a sincronização sem substituir metadados inválidos por uma fila vazia.
4. Cada tentativa obtém a coleção completa do servidor. Não usa `orderBy` que pudesse omitir documentos sem mês. Snapshots do cache ou com gravações locais pendentes não confirmam nem reconciliam operações.
5. A transação lê operação e registro. Revisão incompatível grava conflito e recibo; revisão compatível grava registro/tombstone e recibo atomicamente. Repetição consulta o recibo, inclusive quando a operação original gerou conflito.
6. A remoção local exige ACK. Falha nessa remoção permite repetição idempotente. Operações seguintes não são enviadas depois da troca/encerramento de sessão.
7. Configurações são gravadas em documentos de categoria da geração e só depois no manifesto com comparação de revisão. Uma geração parcial nunca substitui o manifesto. Gerações órfãs não são apagadas automaticamente.
8. A confirmação visual depende de leitura do servidor, envio concluído, configurações e ausência de pendências/conflitos. Um ACK individual não confirma toda a sincronização.

Na recarga, uma conta já inicializada importa registros remotos desconhecidos, respeitando pendências. Sem evidência suficiente para distinguir alteração local de remota, versões divergentes são preservadas como conflito. Documentos com chaves antigas permanecem legíveis com envio pausado; duplicatas lógicas bloqueiam a aplicação do snapshot em vez de selecionar uma versão pela ordem de leitura.

## Conflitos e sessões

A sessão possui uma geração local. Respostas atrasadas não podem atualizar variáveis da conta atual. O estado visual, última confirmação e indicadores de conflito são limpos nas transições. Desfazer, referências de edição, exclusões pendentes, campos e diálogos financeiros da conta anterior são invalidados para impedir ações sobre outra conta. Os dados persistidos de outra conta não são removidos. Valores numéricos nos detalhes de conflitos respeitam a ocultação visual, e o app registra somente o código dos erros de sincronização.

Meses, IDs, nomes, valores e registros aninhados são validados antes de aplicar a escolha. A combinação inteira também é validada para impedir violação do agregado mensal. A aplicação persiste a resolução antes de renderizá-la. Falhas mantêm o conflito disponível para recuperação. “Manter as duas” preserva a versão remota no ID original e gera uma nova cópia local; somente a nova cópia recebe um ID novo. Exclusão e escolha de manter ambas não são equivalentes.

## Comandos

Requisitos: Node >=20, dependências do lock e Java >=21. O ambiente Windows desta revisão usa os canais Edge e Chrome já instalados. Nenhum browser é baixado pelo runner. Em outro sistema, Playwright precisa de Chromium previamente disponível.

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run test:rules
npm.cmd run test:e2e
npm.cmd audit --omit=dev
npm.cmd audit
git diff --check
```

O teste de regras também executa a integração da fábrica de produção. A suíte comum ignora os dois testes que exigem Firestore Emulator; isso não os torna aprovados. `test:e2e` usa Auth 9099, Firestore 8080, Hub 4400 e websocket 9150. O servidor HTTP do site recebe uma porta loopback livre. O caminho dos artefatos é impresso ao início/fim. Não execute Playwright diretamente com a configuração Firebase real.

Playwright cobre criação offline/recarga/reconexão, duas sessões concorrentes e resolução, troca de UID/logout e recuperação de falha de gravação da fila. Testes de VM também executam as funções reais de `app.js` com fronteiras de navegador/SDK substituídas. Os testes com mocks não substituem os resultados do Emulator nem do navegador.

O build versiona também imports transitivos dos módulos: sem isso `sync-core.js` poderia pedir `finance-core.js` sem `_release`, fora do precache, e impedir a inicialização após recarga offline. O teste de build verifica esse contrato e o cenário A verifica a aplicação em execução.

## Contratos preservados e decisões pendentes

### IDs e chaves

O núcleo aceita IDs legados maiores que as regras (128 unidades de string). Eles não são truncados ou migrados: o envio é bloqueado. Espaços Unicode e pares substitutos exigem testes de fronteira; IDs só de espaços não são aplicados remotamente para evitar regenerar identidade durante normalização.

As regras validam envelope, UID e conteúdo, mas não derivam a chave hexadecimal UTF-8 do documento. Uma chave arbitrária continua possível para um cliente autenticado daquele UID. O cliente detecta isso e preserva leitura sem renomear documentos. Opções: manter exceções locais com aviso, formato de chave compacto com leitura compatível, ou migração explícita com backup e revisão. Nenhuma migração foi autorizada ou executada.

### Dinheiro

O núcleo usa a representação decimal do Number para arredondar ao centavo mais próximo, com empate para cima. Exemplos: `0.01 -> 0.01`, `0.29 -> 0.29`, `0.001 -> 0`. Não foi alterado o formato de backups ou valores persistidos. A leitura do app usa essa normalização; as regras aceitam uma tolerância perto de centavos exatos. Orçamentos remotos também exigem uma decisão de precisão explícita.

Foi observada uma fronteira: `2^44 + 0.00390625` é representado por Number como aproximadamente `17592186044416.004`, e o núcleo o arredonda para `2^44`; as regras comparam o valor bruto e o rejeitam. Rejeitar esse caso no núcleo mudaria a aceitação de dados existentes. Deve-se decidir entre preservar a aceitação com normalização explícita ou introduzir validação/versionamento com recuperação de backups; não endurecer silenciosamente o carregamento legado.

A coleção de categorias representa os nomes e limites, sem índice de ordem. Comparações de sincronização usam ordem canônica; isso não promete reproduzir a ordem de inserção entre dispositivos. A ordem financeira local não é reescrita só para comparar configurações.

### Agregado mensal

O núcleo valida receitas e despesas mensais separadamente contra `2^44`. As regras validam documentos individuais e não somam a coleção. O teste integrado demonstra a lacuna.

| Opção | Consistência/concorrência | Custo e compatibilidade |
|---|---|---|
| Pré-validação no cliente | Boa orientação local; não garante concorrência nem clientes adulterados | Menor custo, formato atual |
| Total mensal em transação | Pode serializar o limite junto ao registro e validar `getAfter` | Mais leituras/gravações, contenção e novo contrato obrigatório em todos os escritores |
| Backend autoritativo | Controle central; deve validar dentro da operação, não apenas após um gatilho eventual | Infraestrutura, latência, custos e desenho da fila offline |
| Documento agregado por mês | Transação sobre o conjunto mensal | Reestruturação, tamanho máximo do documento e migração/compatibilidade |

Nenhuma arquitetura foi escolhida ou implementada nesta missão.

### Segurança e limites de evidência

O proprietário autenticado pode escrever seus próprios documentos de operações/conflitos nas regras atuais. Os recibos não são uma prova independente de que outro documento foi atualizado por um backend autoritativo. O isolamento por UID continua obrigatório, mas autenticidade financeira autoritativa requer outro contrato/arquitetura.

A auditoria de dependências encontrou 7 alertas na cadeia de desenvolvimento (Firebase CLI) e zero em `npm audit --omit=dev`. Não foi aplicado o downgrade principal sugerido pelo audit. Avaliar a alcançabilidade e uma versão corrigida do CLI separadamente; não usar `npm audit fix --force`.

## Homologação externa e liberação

Antes de conectar um ambiente remoto, aprovar explicitamente um projeto separado, conferir sua identidade, contas de teste, domínios autorizados, regras e limites de custo. Usar apenas dados sintéticos. Publicação de regras, habilitação de provedores e deploy são etapas separadas que exigem autorização.

Ainda são necessários: login Google real/redirect em domínio autorizado; Safari/iOS e Firefox/Android; encerramento abrupto e concorrência entre abas do mesmo perfil; revisão dos contratos de IDs, precisão e agregado; tratamento operacional dos alertas da cadeia de desenvolvimento. Os emuladores não comprovam comportamento integral da infraestrutura remota ou do provedor Google.

Critérios de liberação: matriz de navegadores executada, cenários offline/recarga/conflito/UID recuperáveis, regras revisadas sem concessões gerais, contratos pendentes decididos, política de backup/recuperação validada, ausência de bloqueios relevantes e aprovação explícita da publicação. Passar testes automatizados não autoriza produção.

## Evidências desta rodada — 21/10/2026

| Validação final | Resultado observado |
|---|---|
| `npm.cmd test` | 193 testes: 191 aprovados, nenhuma falha, 2 ignorados por exigir Emulator |
| `npm.cmd run test:rules` | 11 aprovados, nenhuma falha ou teste ignorado; regras e fábrica real com Firestore Emulator |
| `npm.cmd run test:e2e` | 10 aprovados, nenhuma falha: cinco cenários em cada navegador |
| `npm.cmd run check` | Código 0 |
| Sintaxe do runner, configuração Playwright e suíte E2E | Código 0 |

Navegadores instalados utilizados: Edge 155.0.4283.62 e Chrome 155.0.8059.84. Ambiente: Firebase CLI 15.34.0, Firestore Emulator 1.22.0, Firebase SDK 13.0.0 e rules-unit-testing 6.0.0. Foi adicionada somente a dependência de desenvolvimento Playwright 1.64.1 e seus pacotes transitivos; não houve download de navegadores.

Os resultados finais não apagam as falhas intermediárias: a execução em navegador revelou o import transitivo fora do precache, conflito artificial de configurações equivalentes e retomada incompleta da confirmação após snapshot de servidor. Foram corrigidos com regressões automatizadas e nova execução completa. A variante sem interface Firebase também foi ajustada no fixture temporário após o HTML original ter sido reativado em paralelo. O cenário de isolamento verifica adicionalmente a invalidação de Desfazer na troca de conta.

Artefatos preservados no diretório temporário do sistema: `controle-financeiro-homolog-gRBwQi` (integração) e `controle-financeiro-homolog-4ENmiT` (última execução dos navegadores). As pastas incluem os logs da execução; Playwright preserva traces de falhas nas execuções que falharam. Os emuladores das execuções finais foram encerrados, sem listeners nas portas verificadas 8080, 9099, 4400, 4500 e 9150.

A comparação SHA-256 inicial/final confirmou preservação integral nesta rodada de `finance-core.js`, `firestore.rules`, `firestore-debug.log`, `firebase-config.js` e `tests/sync-core.test.js`, inclusive suas alterações anteriores. O responsável confirmou que as mudanças concorrentes dos quatro PNGs e de `index.html` pertencem à sua atividade; foram preservadas. Nenhum arquivo inicial foi removido. O `git diff --check` geral ainda aponta espaços finais no log preexistente e no HTML alterado em paralelo; não foram limpos. Os arquivos de código/documentação modificados por esta rodada não apresentaram esses erros na verificação direcionada.

## Proposta implementada em cópia — IndexedDB (não ativada)

O módulo `indexeddb-persistence.js` disponibiliza abertura de banco versionado, alteração atômica por chave, leitura, importação conservadora de legado e operações de fila (`enfileirar`/`confirmar`). O `localStorage` não é apagado e a importação não substitui um documento já presente no IndexedDB. Conteúdo legado inválido bloqueia a importação.

**Status: infraestrutura experimental, não integrada ao aplicativo.** Ainda faltam a conversão do fluxo de `salvar()` para operações explícitas por registro, exclusões explícitas, armazenamento transacional do estado e da fila no mesmo domínio, validação de concorrência em duas abas reais, falhas de quota/abort, estratégia de rollback e compatibilidade do PWA. Não ativar a migração em produção nem tratar o módulo como solução completa dos cinco testes vermelhos.

## Integração IndexedDB — etapa de controle de revisão (experimental)

Adicionado `transactional-state.js`: importação conservadora do estado legado, gravação com revisão esperada (compare-and-swap), rejeição explícita de edição obsoleta e preservação da fonte local. A transação real é executada no IndexedDB pelo módulo `indexeddb-persistence.js`; testes unitários do contrato utilizam um adaptador serializado em memória, **não** simulam falhas reais do navegador.

**Não ativado no `app.js`**: o fluxo atual ainda utiliza `salvar()` síncrono e a fila `localStorage`. Ativar a camada parcialmente seria perigoso, pois deixaria duas fontes de verdade e permitiria sincronização de dados não confirmados. Antes de ativar, converter todos os pontos de mutação para persistência assíncrona, implementar fila transacional, definir reconciliação/recuperação e executar E2E multiaba real. Não migrar dados reais nem habilitar Firebase remoto.

## Integração transacional experimental (21/10/2026)

A camada `financial-atomic-service.js` coordena gravações de estado e fila na mesma transação IndexedDB por meio de `PersistenciaFinanceira.alterarDocumentos`. Um conflito de revisão interrompe a transação antes de gravar; uma fila inválida também bloqueia ambas as gravações. ACKs só retiram a operação identificada e não avançam a confirmação se ela já não constar na fila.

**Não ativado na interface:** o `app.js` ainda usa `salvar()` síncrona e `writeSyncMeta()` em `localStorage`. A migração de handlers exige refatoração assíncrona de criação, edição, exclusão, importação, troca de UID e reconciliação, com recuperação de conflitos e testes reais entre abas. Não se deve usar as duas fontes como autoridades simultâneas. Os testes desta etapa empregam armazenamento simulado; não demonstram atomicidade de IndexedDB em navegador, integração ao Firestore ou aprovação dos cinco testes de integridade legados.

**Antes da ativação:** definir versionamento e confirmação de migração por UID, fornecer adaptador de transação real nos testes de navegador, validar interrupção de processo/recarga offline, garantir operação local sem Firebase e bloquear sincronização remota durante a transição. Não remover nem sobrescrever dados legados.

## Etapa seguinte — integração local experimental por intenções (sem liberação)

**Escopo:** foram acrescentados `financial-intents.js` e `ServicoFinanceiroAtomico.aplicarEdicao` / `inicializar`. Cada alteração é derivada da diferença entre o estado visto pela aba e o estado que ela pretende salvar; a diferença é aplicada dentro da mesma transação IndexedDB sobre o estado mais recente, junto com possíveis operações da fila. Alterações em registros distintos são combinadas, inclusive quando outra aba criou registros desconhecidos; edições concorrentes do mesmo registro ou configuração geram `ConflitoEdicao` e abortam a transação inteira. A importação inicial cria estado e fila em uma só transação, sem apagar a fonte legada; migração parcial inconsistente exige revisão.

**Ligação no aplicativo:** `app.js` contém um modo opt-in **apenas em localhost**, ativado com `?indexeddb_homologacao=1`. Nesse modo a interface local utiliza `aplicarEdicao`, não grava snapshots no `localStorage`, hidrata o estado pelo IndexedDB antes de registrar handlers, bloqueia gravações após conflito e não inicia o cliente Firebase. As alterações só devem ser consideradas persistidas após resolução da Promise de gravação. O teste com VM chama o `salvar()` real e confirma a combinação de duas inclusões e o bloqueio de edição conflitante.

**Isolamento de ensaio:** execute `npm run qa:indexeddb` ou `node scripts/serve-idb-qa.mjs` para servir uma **cópia temporária** em `127.0.0.1`, com `firebase-config.js` sintético e sem permissões de acesso ao projeto Firebase real. Abra duas abas com a URL exibida e use exclusivamente dados sintéticos. O servidor de teste só copia arquivos e não altera o repositório. Cada porta corresponde a uma origem independente no navegador. Não utilize a URL experimental sobre dados reais do seu navegador habitual.

**Limitações explícitas:** no modo comum, `salvar()` continua usando `localStorage`, e a fila Firebase segue usando metadados legados. O experimento local ainda não liga `criarOperacoes` a `stageFirebaseState` / `flushSyncQueue`, nem cobre restauração de backups e troca de UID com persistência transacional. A cópia original do `localStorage` não acompanha as edições do modo experimental; sair da URL de homologação no mesmo perfil pode mostrar um snapshot antigo. Portanto, nunca misture abas do modo experimental com abas normais para a mesma origem e **não use o modo para dados financeiros reais**. A reconciliação definitiva, a exportação de recuperação, falhas de quota, testes reais multiaba e a homologação do Firefox/Safari permanecem pendentes.

**Validações da etapa:** 86 testes direcionados do núcleo/persistência e 2 testes adicionais chamando `salvar()` no VM passaram. A suíte geral ainda possui os cinco testes deliberadamente vermelhos do caminho legado; não foram apagados nem ajustados para ocultar o risco. O ZIP de auditoria excluiu `firebase-config.js` e `node_modules`; isso impede nesta cópia a execução dos testes de integração Firebase e do build Pages completo sem preparar uma configuração sintética e instalar as dependências. A tentativa de teste Chromium navegando para a origem local ou arquivo foi bloqueada por política do ambiente (`ERR_BLOCKED_BY_ADMINISTRATOR`), logo **não foi obtida evidência real de IndexedDB no navegador nesta etapa**. Nenhum Firebase remoto foi acessado, nenhuma regra alterada, nenhum deploy efetuado.
