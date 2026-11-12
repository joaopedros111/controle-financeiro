# C01 + C02 — implementação local e homologação

Atualização: 12/11/2026 (America/Sao_Paulo). A primeira rodada abaixo foi preservada.

## Segunda rodada — classificação: IMPLANTAÇÃO BLOQUEADA

A revisão continuou na mesma branch e HEAD, sem descartar os arquivos anteriores.
Não houve acesso a dados financeiros reais, inventário remoto, autenticação real,
alteração administrativa, commit, push, merge ou publicação.

As novas evidências e quantidades estão na seção de segunda rodada de
`FIRESTORE-INTEGRIDADE-RESULTADOS.md`. Os resultados de 11/11 são históricos;
não constituem aprovação automática da versão de 12/11.

### Clientes, filas e transição

`tests/fixtures/published-source.mjs` extrai o código do commit completo homologado
durante o build isolado via `git show`, sem checkout ou alteração de `main`.
Os módulos locais importados pelo cliente legado também vêm dessa referência;
o SDK instalado é o mesmo para permitir comparação controlada. A suíte
`tests/firestore-compatibility.test.js` compara versões e regras em legado e
gerações. O E2E `client-compatibility.spec.mjs` troca o bundle no mesmo perfil
sintético, mantendo IndexedDB/Auth e verificando os IDs originais da fila.

| Cliente / regra | Contrato esperado e testado |
| --- | --- |
| 1.1.109 / publicada | Gravações anteriores continuam funcionando. |
| 1.1.109 / estrita | Novo `applied` sem chave/base é recusado; a operação não é confirmada. |
| Novo / publicada | Comprovante aditivo é aceito, mantendo a ponte de atualização. |
| Novo / estrita | CAS e comprovantes pareados são exigidos. |

As verificações incluem leitura de dados criados pelo cliente anterior, ACK de
comprovantes antigos, fila antiga enviada após atualização sem troca de IDs,
edição obsoleta, exclusão e tombstone compartilhados entre versões.

O mecanismo compatível é **aditivo no cliente e estrito no servidor**: publicar
primeiro o cliente que envia o comprovante ampliado, sem permitir um fallback
permanente nas regras estritas. A troca de bundle testada preserva a fila; não
prova que todos os Service Workers/PWAs instalados receberão a atualização.
Um dispositivo pode permanecer offline indefinidamente. O cliente 1.1.109 não
consulta um requisito novo de versão antes de gravar e não pode ser atualizado
retroativamente por uma nova regra.

Portanto, compatibilidade transparente de gravação antiga e todas as garantias
novas são incompatíveis: aceitar o recibo antigo sem base reabre C01. Não foi
adicionada exceção por relógio, UID ou campo declarado pelo próprio cliente.
Sem mecanismo operacional aprovado para atualizar/bloquear versões antigas
preservando intenções offline, **a publicação não é classificada como segura**.

### Identidades e inventário

O analisador `firestore-identity-audit.js` é offline e aceita só metadados,
sem SDK, credenciais, rede ou gravação. A saída não repete identificadores nem
conteúdo financeiro. Os testes executam geradores históricos reais do Git.
Ver `FIRESTORE-INVENTARIO-LEITURA.md` para histórico e procedimento futuro com
máscaras de campos, paginação, consistência e limites, que **não foi executado**.
Não se renomeiam aliases nem se cria automaticamente um documento canônico ao
encontrá-los. Evidência remota de identidade/completude ainda exige autorização.

### Configurações e revisão adversarial

O candidato recebeu validações compatíveis com o contrato emitido pela referência:
contagem de orçamentos limitada às categorias, geração igual à revisão no V2,
nomes válidos, proibição de acrescentar categorias à geração V2 atualmente
publicada e hash de snapshot não vazio. O relatório específico
`FIRESTORE-CONFIGURACOES-RODADA2.md` distingue esses controles de CAS no cliente.

Ainda são demonstráveis, por escritor autenticado direto, troca obsoleta de
ponteiro V2/snapshot pronto e publicação V2 incompleta. As regras não contam
coleções nem interpretam o JSON das partes. A proposta de protocolo futuro deve
carregar base e comprovante verificáveis e selar manifestos antes de ativá-los;
não pode ser imposta ao cliente antigo sem rollout próprio. Essas pendências
de integridade impedem aprovação de publicação, mesmo com testes verdes.

Comprovantes `conflict` desacoplados também foram investigados: eles podem
forçar rejeição falsa, embora o serviço preserve a intenção em conflitos locais.
O endurecimento candidato separa o histórico `auto-history-*` das operações e
pareia os conflitos normais ao respectivo documento na mesma gravação atômica.
O recibo antigo não carrega a base da intenção rejeitada: o pareamento não prova
a causa semântica completa do conflito e não deve ser apresentado como tal.

### Chrome e regressão

Ver `FIRESTORE-CHROME-RODADA2.md` para etapas, amostras e diagnóstico controlado.
As falhas históricas não foram ocultadas por aumento global de timeout, retries
automáticos ou exclusão de teste. A regressão final é registrada separadamente
das tentativas de desenvolvimento nos resultados desta rodada.

### Implantação e rollback — pré-requisitos não atendidos

1. Revisar cliente/regras e registrar os artefatos exatos, separadamente.
2. Aprovar e executar em outra etapa o inventário mínimo de identidades e a
   identificação administrativa do ruleset ativo; parar se houver inconsistências.
3. Publicar cliente aditivo por GitHub Pages mantendo regras antigas. Validar a
   atualização real de cada PWA/Service Worker e a preservação das filas.
4. Resolver o contrato de configurações e o tratamento de dispositivos antigos
   antes do endurecimento; tempo decorrido não é prova de atualização.
5. Só após nova autorização publicar regras estritas. Observar negativas e
   filas por critérios aprovados. Esta sessão não autoriza nenhum desses passos.

Rollback de aplicativo e de regras é independente. Manter cliente aditivo com
regras antigas preserva compatibilidade, mas reabre a proteção servidor de C01.
Não voltar ao aplicativo antigo enquanto regras estritas estiverem ativas.
Não apagar filas, tombstones, gerações, snapshots ou histórico para reverter.
Qualquer rollback exige aprovação própria e identificação do artefato anterior.

## Registro preservado da primeira rodada — 11/11/2026

## A. Resultado e limites

**Aprovação parcial local; implantação bloqueada.** O cliente recebeu um
comprovante aditivo compatível com as regras publicadas. O candidato
`firestore.integrity.rules` protege lançamentos nos namespaces legado e de
gerações, incluindo preparação de restaurações. Não foi ativado em produção.

`firestore.rules`, `firestore.epoch.rules`, `firebase.json`, versões do aplicativo
e arquivos de Service Worker permanecem iguais à referência. O candidato não
substitui o protocolo por Epoch. A branch não contém commit novo, push, merge ou
deploy. Não houve autenticação real, consulta a dados financeiros reais nem
alteração de perfis reais. Os projetos de teste são `demo-*`, em loopback.

Não é possível garantir atualização simultânea das PWAs, ausência de aliases
antigos ou identificação administrativa da release ativa com a evidência local.
Nenhuma dessas garantias é presumida. O endurecimento de lançamentos não deve
ser confundido com revisão completa da integridade de configurações financeiras.

## B. Arquivos

| Arquivo | Finalidade |
| --- | --- |
| `firestore.integrity.rules` | Candidato estrito, separado do arquivo de deploy vigente. |
| `firebase-sync-entry.js` | Comprovante com chave/base; uma releitura transacional após negativa de CAS. |
| `finance-generation-transport.js` | Mesmo contrato e tratamento de concorrência nas gerações. |
| `tests/firestore-integrity.test.js` | Ataques em ambos os namespaces, Unicode, legado, compatibilidade e controles por mutação em memória. |
| `tests/firebase-sync-client.test.js` | Factory real nas duas regras; limite de repetição e troca de UID. |
| `tests/firestore-rules.test.js` | Restauração, concorrência e recuperação nas duas regras, com projetos separados. |
| `scripts/run-local-tests.mjs` | Modos de Emulator/E2E do candidato; inclui a suíte de integridade. |
| `package.json` | Comandos `test:integrity` e `test:integrity:e2e`, sem novas dependências. |
| Este documento | Contrato, limites, evidências, implantação e rollback. |

## Contrato investigado

| Fluxo | Atomicidade e comportamento |
| --- | --- |
| Criação e edição | `firebase-sync-entry.commit`: transação lê comprovante e lançamento; grava ambos ou comprovante/conflito. |
| Exclusão | Mesma transação, envelope `deleted:true` sem `record`; delete físico proibido. Pode criar tombstone de item ausente, compatível com filas offline. |
| Repetição | Transação lê comprovante imutável existente e retorna ACK/duplicate sem regravar. Comprovantes antigos continuam reconhecidos. |
| Fila offline | Intenções duráveis no IndexedDB; transações Firestore só são executadas quando há conectividade. Não se usa uma gravação independente como confirmação financeira. |
| Reconexão | `AutomaticFinanceSync` obtém snapshot confirmado, reconcilia, envia a fila e só confirma após leituras do servidor. |
| Dois dispositivos | Comparação de revisão no cliente e agora nas regras. Duas transações concorrentes podem produzir negativa de regra antes do retry interno do SDK; o cliente faz somente uma nova transação para registrar conflito. |
| Multiaba | `financial-atomic-service` e `indexeddb-persistence` transacionam estado/fila juntos, com revisão local e cercas de conta; transações Firestore continuam necessárias entre dispositivos. |
| Troca de conta | `account-data-policy` cerca acesso por UID/epoch local; callbacks verificam a sessão. Ambas as tentativas remotas verificam UID; gerações também releem controle dentro da transação. |
| Backup local | Validação/normalização antes de alterar estado/fila; cópia de recuperação é preservada em transação IndexedDB. |
| Restauração remota | Transação cria raiz staging; várias transações publicam partes de configurações e cada registro com avanço de contador; outra sela; uma transação final ativa o ponteiro. Não é um único batch de todos os registros. |
| Geração staging | Cada registro canônico é criado uma vez e associado atomicamente ao avanço `written/lastKey`. Não exige comprovante de edição: a autorização é a preparação da restauração. |
| Geração ativa | Envelope externo `{value}`; edição/exclusão usa o mesmo comprovante de chave/base no namespace da geração. |
| Gerações anteriores | Leitura pelo proprietário mantida para recuperação; escritas de lançamentos barradas quando deixam de ser ativas. |
| Conflitos | Transação cliente grava documento de conflito + comprovante `conflict`; resolução atualiza apenas campos de resolução. Histórico automático é outra gravação transacional imutável em `operations/auto-history-*`. |
| Configurações legadas V2 | Transações preparam categorias imutáveis, depois uma transação troca manifesto com CAS no cliente. Não há comprovante de lançamento para configurações. |
| Configurações por geração | Partes/snapshot são preparados e selados em várias transações; uma transação troca o ponteiro de configurações com CAS no cliente. |
| Clientes anteriores | A versão 1.1.109 envia comprovante `{status,createdAt}`; a versão modificada acrescenta `local:{entityKey,baseRevision}`. Ambas usam o mesmo envelope/chave/fila. |

`app.js`, `automatic-finance-sync.js`, `automatic-sync-policy.js`,
`financial-atomic-service.js`, `sync-core.js`, `indexeddb-persistence.js` e
`account-data-policy.js` foram inspecionados para confirmar esses limites;
não precisaram mudar para o comprovante aditivo. Os testes de regressão cobrem
seus fluxos. Não foram introduzidos batches na implementação do cliente: batches
na nova suíte representam gravações hostis que também precisam ser recusadas.

O arquivo fonte `version.json` na referência contém `1.1.9`; o build soma o
contador de execução ao patch. A versão publicada `1.1.109` é o contexto informado
no pedido. O build sintético com contador `1` gerou `1.1.10` apenas no temporário;
isso não é alteração da versão publicada nem identificação da release ativa.

## C. C01 — revisões, transições e comprovantes

Causa: as regras publicadas verificam formato e UID, mas não a relação entre
estado anterior, estado posterior e operação. Transações corretas do cliente
não obrigavam um outro escritor autenticado a respeitar o contrato.

O candidato exige, para um lançamento normal:

1. Envelope e valores financeiros válidos; identidade documental canônica.
2. `revision` nova, não vazia e adequada ao identificador da operação;
   `updatedAt == request.time`.
3. Comprovante `applied` ausente antes da transação e presente depois dela.
4. Comprovante com somente `status`, `createdAt` e `local`, com chave canônica e
   revisão anterior obrigatórias; `createdAt == request.time`.
5. Na criação, `baseRevision == null`. Na atualização, base igual à revisão
   efetivamente armazenada e revisão nova diferente da anterior.
6. Mês, tipo e ID imutáveis; tombstone pode permanecer excluído, nunca voltar a
   ativo no mesmo documento/geração.
7. No lado do comprovante, o lançamento posterior aponta para essa operação,
   tem timestamp da requisição e uma transição real de revisão. Um comprovante
   desacoplado não pode satisfazer essa transição.

As revisões continuam strings opacas, sem migração numérica. A progressão é CAS
sobre a revisão armazenada mais unicidade do comprovante; não se ordenam relógios
de dispositivos nem se aceita apenas uma revisão declarada pelo cliente. O
servidor não recalcula o hash usado pelo cliente para formar IDs de operações.

A checagem do comprovante evita repetir o schema inteiro do lançamento: a
mudança de revisão exige que o mesmo batch escreva o lançamento, cuja própria
regra valida schema/chave/comprovante. Isso reduz avaliações redundantes.

O retry do cliente é limitado a **uma** nova transação para `permission-denied`.
Se a negativa continuar, ela se propaga sem ACK ou remoção da outbox. A política
automática já trata erro permanente pausando a sessão. Não há retry infinito.

Limites remanescentes: regras de configurações financeiras mantêm o contrato
anterior; seus ponteiros não receberam um novo campo de base, pois isso seria
incompatível com os schemas publicados. Histórico de conflitos também não foi
convertido em um novo protocolo de recibos. Esta entrega não afirma CAS servidor
para configurações nem autenticidade completa de histórico já existente.

## D. C02 — identidade

O formato existente é preservado exatamente:

```text
hexadecimal minúsculo dos bytes UTF-8 de month + '/' + type + '/' + id
```

Nas regras: `(...).toUtf8().toHexString().lower()`. O `.lower()` é necessário:
o Emulator demonstrou saída maiúscula do conversor, enquanto o cliente sempre
produziu minúsculas. Não há novo formato de ID, percent-encoding ou normalização
Unicode. Barras, `%`, acentos, emoji, tabulações e quebras de linha no ID interno
permanecem distinguíveis em uma chave de segmento único. O limite de 128 unidades
UTF-16 do cliente é preservado contando caracteres fora do BMP como duas
unidades. IDs vazios ou só com whitespace não são aceitos.

Referências primárias consultadas: [String nas Security Rules](https://firebase.google.com/docs/reference/rules/rules.String),
[Bytes nas Security Rules](https://firebase.google.com/docs/reference/rules/rules.Bytes)
e [condições e operações atômicas do Firestore](https://firebase.google.com/docs/firestore/security/rules-conditions).

Novos aliases e duas chaves distintas para a mesma identidade não são aceitos.
Documentos canônicos existentes continuam editáveis mesmo com revisão opaca e
sem comprovante histórico. Aliases preexistentes permanecem legíveis, sem
regravação, exclusão ou migração automática.

**Bloqueio obrigatório:** regras não podem consultar toda a coleção para descobrir
um alias arbitrário já existente. Se esse alias existir, criar o documento
canônico ainda pode formar uma duplicata com ele. O sincronizador já detecta
aliases/duplicatas e preserva o estado local ao parar, mas isso não prova que
todos os dados remotos estão limpos. Inventário autorizado e estratégia de
recuperação explícita são pré-requisitos para ativação. Não se promete ausência
de duplicatas em uma base que não foi inspecionada.

## E. Compatibilidade

| Combinação | Resultado comprovado/limite |
| --- | --- |
| Cliente modificado + regras publicadas | Comprovante aditivo aceito em legado e gerações. |
| Cliente modificado + candidato | Criação, edição, exclusão, conflito, idempotência e restauração homologados no Emulator. |
| Cliente 1.1.109 + candidato | Nova gravação `applied` sem chave/base recusada atomicamente. Não é compatibilidade transparente. |
| Comprovantes anteriores | Permanecem legíveis e imutáveis; o cliente reconhece operações já aplicadas. |
| Fila antiga no cliente atualizado | ID, valor, base e geração preservados; o comprovante ampliado é formado no envio, sem reescrever a fila. |
| Dispositivo antigo desconectado | Não pode ser considerado atualizado por decurso de tempo. Após ativação estrita, sua gravação será recusada; exige atualização preservando armazenamento. |
| Tombstones | Mantidos; desfazer exclusão cria nova identidade no fluxo existente. Restauração explícita usa nova geração. |
| Backups e restaurações | Formato mantido, staging/selagem/ativação preservados, inclusive restauração vazia e retomada após interrupção. |
| Legado não canônico | Leitura mantida para recuperação; gravação bloqueada; exige revisão antes do rollout. |

## F. Evidências e execução

Comandos npm no Windows usam `npm.cmd`: o PowerShell deste ambiente bloqueia
`npm.ps1` por política de execução. Não foi alterada a política da máquina.

Resultados finais e caminhos dos logs: ver
`FIRESTORE-INTEGRIDADE-RESULTADOS.md`.

Os testes com Emulator são limitados a host loopback e projetos `demo-*`.
`clearFirestore()` afeta somente esses projetos sintéticos, nunca IndexedDB,
localStorage ou contas reais. O runner usa diretório temporário para configuração
Firebase e remove variáveis de credenciais do processo filho; não faz login.
Não houve instalação ou atualização de dependências/emuladores.

Há controles positivos e controles de causa: remover isoladamente a exigência
do comprovante, CAS, chave canônica ou bloqueio de ressurreição numa cópia **em
memória**, carregada num projeto demo separado, faz o ataque correspondente
passar. O candidato em disco nunca é flexibilizado para esses testes.

O Emulator pode relatar `evaluation error` de variantes especulativas de
create/update junto com a decisão final `false`. A suíte exige
`permission-denied`, decisão final falsa, ausência de indicação de limite de
expressões, controles positivos e controles de causa. Uma negativa genérica
isolada não é tomada como prova de integridade. Primeiras execuções expuseram
limite RE2, caixa do hexadecimal e ordem de rejeição/retry do SDK; esses problemas
foram corrigidos antes das execuções finais.

## G. Segunda revisão de segurança

- Nenhum novo acesso público, entre UIDs ou a caminhos desconhecidos.
- Delete físico continua proibido; tombstones, filas, conflitos e gerações
  anteriores não são apagados pela correção.
- Comprovante reutilizado não autoriza revisão nova; repetição idempotente ocorre
  pela leitura, sem update de comprovante.
- Record sem receipt, receipt sem record e base obsoleta não publicam alteração
  parcial. A concorrência foi exercitada com batches hostis e transações reais.
- Preparação de geração mantém autorização própria por contador e ponteiro;
  não foi forçada associação de recibo de edição em uma restauração.
- Não há migração automática de IDs nem descarte de filas antigas.
- A garantia de C01 nesta entrega cobre lançamentos. Configurações e histórico
  mantêm os limites explicitados; por isso a classificação geral é parcial.
- Dados inválidos/aliases existentes e clientes sem atualização podem ser
  bloqueados pelas regras estritas. Essa incompatibilidade é testada e constitui
  pré-requisito de implantação, não uma condição silenciosamente ignorada.
- Regras Firestore não substituem verificação de totais mensais do aplicativo
  nem restringem credenciais administrativas que ignoram Security Rules.

## H. Publicação futura — não executada

1. Revisar esta branch e identificar administrativamente ruleset/release ativa,
   mantendo cópia identificada das regras publicadas e artefato 1.1.109.
2. Obter autorização específica para inventário somente leitura de produção.
   Verificar chaves canônicas, duplicatas, schemas, revisões, tombstones,
   comprovantes e gerações. Não copiar dados reais para testes.
3. Resolver qualquer legado incompatível em plano separado, com exportação e
   recuperação verificáveis, sem excluir ou renomear documentos automaticamente.
4. Publicar **primeiro o cliente aditivo**, com versão nova, mantendo as regras
   atuais. Revalidar a produção por observação autorizada. A atualização do
   cliente isolada não corrige C01/C02 no servidor; existe uma janela residual.
5. Estabelecer tratamento de clientes antigos e usuários offline: mecanismo de
   atualização mínima/aviso e recuperação comprovados, janela de suporte e
   critério de aceite explícito. Nenhuma espera finita garante atualização de
   todos os dispositivos. Se esse critério não puder ser atendido, não ativar.
6. Reexecutar Emulator/E2E com os artefatos exatos aprovados. Só após aprovação
   específica preparar configuração que aponte ao candidato e publicar regras.
   `firebase.json` desta entrega permanece propositalmente na regra vigente.
7. Observar negativas, filas e conflitos por critérios previamente aprovados;
   interromper rollout diante de bloqueios legítimos ou discrepâncias.

Rollback futuro: manter o cliente aditivo (compatível com regras antigas) e, se
autorizado, restaurar o ruleset anterior identificado. Isso reabre C01/C02 e deve
ser registrado como tal. Não reverter dados, revisões, IDs, tombstones ou filas;
não limpar armazenamento de usuários para viabilizar rollback. Voltar ao cliente
antigo com regras estritas ativas bloquearia gravações e não é rollback válido.

## I. Git

Referência inicial: `main`,
`e0f6e2c54e92655432b0304ee35729f1d5a08769`, árvore limpa.
Branch de trabalho: `fix/firestore-integridade`. A criação da referência local
exigiu a permissão de escrita em `.git` prevista no pedido; nenhum outro acesso
Git de escrita foi necessário. O HEAD continua na referência inicial.

Estado final e diff: `FIRESTORE-INTEGRIDADE-RESULTADOS.md`.

## J. Pendências de aprovação/verificação

- Revisão humana da branch e dos limites do candidato.
- Identificação administrativa da release ativa, sem inferência a partir da
  igualdade textual das regras.
- Inventário autorizado de dados existentes e plano para eventuais aliases.
- Solução e validação operacional para clientes antigos/PWAs offline.
- Se C01 for exigido também para ponteiros/configurações financeiras, projetar
  contrato próprio de CAS servidor com rollout compatível antes de declarar
  resolução integral do achado.
- Investigar o timeout intermitente do cenário Chrome de reload sob Firestore
  retido. A suíte principal passou; a suíte específica de contas teve uma falha
  que não foi ocultada, e o controle de baseline foi inconclusivo. Detalhes e
  repetições estão no relatório de resultados.
- Toda publicação continua fora desta autorização. Nenhum critério pendente é
  classificado como aprovado por ausência de acesso a produção.
