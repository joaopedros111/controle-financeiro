# Protocolo financeiro por geração — etapa 1

Requisito posterior obrigatório: [importação explícita de backups antigos](IMPORTACAO-BACKUP-AUDITORIA-E-REQUISITOS.md).
A idempotência por operação não substitui identidade de importação, manifesto de
lote ou preservação integral do formato legado. Extensões necessárias devem ser
revisadas antes de habilitar essa funcionalidade.

Implementação isolada para Emulator. Não substitui `firestore.rules`, não é
referenciada por `firebase.json`, `app.js`, Service Worker ou bundle de produção.
Nenhum reset, provisionamento remoto ou publicação faz parte desta etapa.

## Modelo v1

O controle administrativo `users/{uid}/control/finance` contém
`{protocol: 1, activeEpoch: string, status: 'active' | 'maintenance'}`.
Clientes podem ler seu controle, mas nunca criá-lo ou modificá-lo.

Dados ficam em `users/{uid}/financeEpochs/{epoch}/{collection}/{entityId}`.
Coleções: `records`, `categories`, `budgets`, `settings` e `operations`.
Os pais `users/{uid}` e `financeEpochs/{epoch}` não precisam existir como documentos.

Entidades usam o envelope:
`{payload, deleted, revision, operationId, updatedAt}`.
Revisões inteiras iniciam em 1; ausência equivale à revisão-base 0.
`updatedAt` é timestamp do servidor. IDs UUID são gerados uma única vez e
persistidos pelo chamador; reenviar exige reutilizar o comando original inteiro.
O ID da entidade não depende do mês, nome ou valor.

Payloads:

| Coleção | Campos |
| --- | --- |
| records | month, type (receitas/despesas), nome, amountCents; opcionais categoryId, paid, fixed, seriesId, installment: {current,total} |
| categories | name |
| budgets | categoryId, amountCents (limite padrão reutilizado nos meses) |
| settings/finance | currency (BRL, USD, EUR, JPY) |

Valores são inteiros em centavos até 1759218604441600; o modelo evita valores
fracionários no transporte. Aparência/idioma continuam sendo preferências da UI
atual. Categorias usam identidade independente do nome. Os IDs vinculados são
preservados, mas integridade referencial e comandos compostos ficam para etapa
posterior; a exclusão de categoria ainda não executa cascatas.

## Comandos e confirmação

`makeCommand` produz `{protocol, uid, epoch, operationId, collection, entityId,
baseRevision, action, payload}`. Ação `put` cria/edita; `delete` exige payload vazio.
O registro `operations/{operationId}` contém o comando original,
`resultRevision` e `appliedAt` do servidor. Recibos são imutáveis.

`commitEpochOperation` lê controle, recibo e entidade em uma transação. Um recibo
idêntico retorna a confirmação original mesmo que a entidade tenha sido editada
posteriormente. Reutilizar o ID com outro conteúdo falha. Ausência de recibo e
revisão divergente retorna `{status:'conflict', command, current}` sem gravar.
A intenção rejeitada é devolvida integralmente ao chamador; esta etapa NÃO
persiste uma fila nem revisões pendentes. Erros de autorização são propagados.
Se a avaliação de uma transação em disputa retornar `permission-denied`, o
adaptador faz uma única nova transação com leituras atuais, mantendo o comando
e a revisão-base originais. Uma negação real continua sendo propagada.

Exclusão produz tombstone permanente. Nenhuma escrita pode modificar um
tombstone, nem mesmo conhecendo sua revisão. Desfazer após confirmação exigirá
nova identidade. Não há remoção física nem coleta de recibos nesta etapa.

As regras obrigam entidade e recibo a serem criados juntos, verificam o conteúdo
correspondente, revisão anterior, incremento unitário, horário do servidor,
proprietário e geração ativa. Uma escrita direta sem recibo não passa. Caminhos
legados e desconhecidos são negados no ruleset novo. Isso só terá efeito na
produção em uma etapa futura de implantação explicitamente revisada.

## Execução segura

`npm run test:epoch` (PowerShell restrito: `npm.cmd run test:epoch`) inicia
somente Firestore Emulator em localhost e projeto `demo-*`, usando uma cópia
temporária de `firestore.epoch.rules`. Não modifica o ruleset atual. O adaptador
recusa instâncias sem projeto demo, endereço loopback e TLS desativado, antes
de qualquer leitura. As credenciais de CLI ficam isoladas na pasta temporária.
Java 21+, dependências npm e o binário local do Emulator são necessários.

`npm test` executa a regressão local e marca integração com Emulator como
ignorada quando ele não está presente. `npm run test:rules` verifica o protocolo
legado separadamente. As suítes de Emulator devem rodar sequencialmente pois
utilizam as mesmas portas. `npm run check` verifica a sintaxe existente;
`npm run check:epoch` verifica os arquivos novos e o runner.

## Aprovação desta etapa

- Regressão local e sintaxe sem falhas.
- Suíte nova executada no Emulator, sem skips de integração.
- Reenvio idêntico não altera revisão; ID reutilizado com conteúdo distinto falha.
- Duas edições simultâneas: exatamente uma aplicada e outra devolvida integralmente.
- Tombstones impedem ressurreição e exclusão física.
- Regras negam outro UID, anônimo, geração antiga, manutenção, alteração do
  controle, recibos adulterados, escritas incompletas e caminhos legados.
- Nenhuma conexão da implementação nova à UI ou configuração de produção.

Offline durável, listeners, revisão persistida de conflitos, validação de totais
mensais agregados, atomicidade de séries/parcelas em grupo, vínculo de categorias
e procedimento real de reset NÃO estão implementados nesta etapa. Cada parcela
é um registro independente com metadados estáveis. Nenhuma garantia de operação
de grupo é inferida desses metadados.

## Evidências de execução — 2026-10-26

| Comando | Resultado |
| --- | --- |
| npm.cmd run test:epoch | 14 aprovados, zero falhas/skips; inclui 20 disputas edição/exclusão |
| npm.cmd test | 347 aprovados, zero falhas, 3 integrações ignoradas sem Emulator |
| npm.cmd run test:rules | 23 aprovados, zero falhas/skips |
| npm.cmd run test:e2e | 50 aprovados em Edge e Chrome, 3,2 minutos |
| npm.cmd run check | Aprovado |
| npm.cmd run check:epoch | Aprovado |
| git diff --check | Aprovado |

Logs e artefatos locais preservados fora do repositório:

- Protocolo: `%TEMP%/controle-financeiro-homolog-4wIieT/execution.log`.
- Legado: `%TEMP%/controle-financeiro-homolog-6HGAaN/execution.log`.
- Navegadores: `%TEMP%/controle-financeiro-homolog-o6PmDJ/execution.log`.
- Regressão local: `%TEMP%/controle-financeiro-unit-stage1.log`.

As negações `permission-denied` dos testes negativos são esperadas. O teste
rejeita mensagens de estouro de expressões e erros concretos de valor nulo ou
propriedade indefinida; o rótulo genérico `evaluation error` do Emulator pode
acompanhar uma negação. A validação inicial encontrou excesso de expressões;
a versão final evita validar o payload duas vezes no mesmo par de gravações.

O runner agora isola a configuração/credenciais da CLI na pasta temporária e
resolve o fixture de navegador pelo diretório do projeto, permitindo que
Windows TEMP e workspace estejam em unidades diferentes. Nenhum arquivo da
interface ou ruleset de produção foi modificado. A etapa está pronta para
revisão técnica; isso não representa homologação de uso em produção, offline
durável ou dispositivos móveis físicos.
