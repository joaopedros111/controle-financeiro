# Configurações financeiras e revisão de conflitos — rodada 2

Data: 12/11/2026. Somente código local, Emulator e dados sintéticos.
O arquivo publicado `firestore.rules` e `firebase.json` não foram alterados.

## Contrato histórico confirmado

A fonte do commit `e0f6e2c54e92655432b0304ee35729f1d5a08769` foi inspecionada,
incluindo `firebase-sync-entry.js` e `finance-generation-transport.js`:

- V2: `const revision = makeSettingsRevision(baseRevision, settings), generation = revision`.
  Cada categoria é criada numa transação; dados existentes iguais são lidos e
  reutilizados sem escrita. Depois de todas as categorias, uma transação publica
  manifesto com contagens, geração e revisão. Essa transação compara base apenas
  no cliente. O orçamento padrão só aceita nomes presentes em `categories`.
- Geração financeira: snapshots usam `{count,written,hash,status}`, partes
  `{index,text}` imutáveis, avanço de contador e selagem. A troca de ponteiro é
  uma transação separada com comparação de base apenas no cliente.
- O conteúdo do snapshot é JSON de configurações e um hash calculado por
  `operationId('settings-content', null, value)`. As regras não interpretam esse
  JSON nem implementam o algoritmo de `operationId`.
- Preferências estritamente locais não passam por esses documentos. O tema
  sincronizado é parte do manifesto/JSON e mantém os identificadores históricos,
  inclusive `floresta` como alias visual já suportado.

## Proteções compatíveis acrescentadas ao candidato

1. `budgetCount <= categoryCount`: todo orçamento padrão emitido pelo cliente
   homologado corresponde a uma categoria. A regra anterior aceitava manifesto
   com mais orçamentos que categorias.
2. `generation == revision` no manifesto V2: o cliente homologado sempre escreve
   os dois com o mesmo valor. Isso bloqueia associação arbitrária entre os campos,
   sem criar campo novo ou reinterpretar revisões antigas.
3. Categoria com nome não vazio/não composto apenas por whitespace e limite de
   40 unidades UTF-16 alinhado ao cliente; acentos, espaços significativos e
   Unicode permanecem aceitos.
4. Não criar novas categorias dentro da geração atualmente apontada por V2. O
   cliente prepara antes de publicar e reaproveita as categorias já existentes
   numa repetição, sem regravá-las. Nenhuma leitura ou dado é removido.
5. Hash de preparação de snapshot não vazio. Os dois clientes sempre emitem
   `operationId` não vazio; nenhuma estrutura nova é exigida.
6. Ponteiro para snapshot inexistente é negado por `exists` antes de acessar seu
   status. O teste inicial detectou `Null value error`; o candidato foi corrigido
   para negar esse caso de forma controlada, em vez de considerar a exceção prova
   suficiente de segurança.

Essas verificações reduzem estados inválidos, mas não constituem CAS de servidor.
A trava de geração V2 atual não sela para sempre gerações antigas: sem marcador
de selagem no protocolo, uma geração que deixa de ser apontada não pode ser
reconhecida como historicamente publicada apenas pelas regras.

Dados antigos inválidos continuam legíveis. Uma geração V2 publicada incompleta
poderia antes receber documentos adicionais; o candidato passa a impedir essa
reparação implícita. Um inventário autorizado e um procedimento separado de
recuperação são necessários antes de ativar as regras, sem apagar o legado.

## Bloqueios demonstrados que permanecem

Os testes nomeados `known blocker` são controles que **demonstram aceitação de
escritas problemáticas**. Um teste aprovado nesses casos significa que o limite
foi reproduzido; não significa uma proteção implementada.

- Tanto regras vigentes quanto candidatas permitem publicar uma revisão V2
  antiga após uma mais recente, quando o escritor ignora o CAS do cliente.
- O manifesto V2 pode declarar categorias/orçamentos que não existem: regras não
  contam uma coleção inteira para provar a contagem declarada.
- A chave percent-encoded de uma categoria não é vinculada ao `name` pelo
  contrato de regras atual. A leitura do cliente faz essa validação e para ao
  detectar discrepância. Isso não é garantia de servidor.
- Um snapshot `ready` antigo pode substituir um novo ponteiro ativo: timestamp
  de servidor não demonstra causalidade ou revisão base.
- JSON malformado ou semanticamente inválido e hash inventado podem ser selados
  e apontados por um escritor autenticado. O cliente rejeita antes de aplicar
  configurações locais, mas a sincronização legítima pode ficar bloqueada.
- Categorias e orçamentos contidos em JSON não recebem validação de schema ou
  integridade cruzada com lançamentos nas regras.

O cliente real `withFinanceGenerations.saveSettings` é exercitado com duas
configurações distintas e a mesma base: uma transação vence e a outra retorna
conflito. Isso confirma o comportamento correto do cliente e não elimina as
gravações diretas acima. A garantia precisa continuar descrita como CAS de cliente.

## Proposta de protocolo para fechar os bloqueios

Não implementada/ativada nesta rodada por exigir mudança coordenada de cliente,
schema e estratégia para legados:

1. Um comando de configurações deve conter identificador, namespace, baseRevision,
   revision resultante e referência ao conteúdo completo imutável.
2. Ponteiro e comprovante devem mudar no mesmo batch/transação; regras comparam
   a base ao recurso armazenado e o comprovante aos dois lados da transição.
3. Dados devem usar schema verificável pelas regras; JSON opaco de múltiplas
   partes não fornece verificação semântica. Manter JSON exigiria um serviço
   confiável que valide e sele o conteúdo; isso é outra arquitetura, não uma
   garantia obtida só por `getAfter`.
4. Categorias precisam de identidade verificável e manifesto/contador selado,
   sem exigir enumerar a coleção nas regras. Nomes Unicode e IDs antigos devem
   continuar recuperáveis em namespace de leitura.
5. A migração deve ser aditiva, com client atualizado publicado primeiro,
   manutenção de filas/configurações antigas e revisão explícita das gerações
   existentes. Durante a janela permissiva as garantias completas continuam
   indisponíveis. Bloquear clientes antigos depois exige um plano que preserve
   operações offline; uma espera finita não prova que todos atualizaram.

Até haver protocolo e rollout demonstrados, a implantação continua bloqueada.

## Conflitos — endurecimento adicional do candidato

A revisão adversarial encontrou que era possível criar comprovante
`status:'conflict'` sem o documento de conflito correspondente. Isso permitia
preocupar um ID e forçar um ACK de conflito falso. O serviço local preserva a
operação original em `fila.conflicts` ao retirar da outbox; perda silenciosa não
foi demonstrada por esse vetor, e não é alegada aqui.

O candidato agora exige para conflitos normais:

- comprovante com os dois campos históricos `status/createdAt`, criado junto
  com documento de conflito novo no mesmo namespace;
- documento com a mesma operação, valor local financeiro canônico, estado remoto
  igual ao registro realmente armazenado e timestamp de servidor;
- verificação nos dois lados da associação atômica;
- limite de identidade de 1500 alinhado ao limite documental. Isso preserva
  conflito de IDs canônicos com 128 caracteres CJK, cuja chave excede o antigo
  limite arbitrário de 512. Não amplia acesso entre contas;
- histórico automático independente apenas no prefixo `auto-history-*`, com os
  schemas efetivamente emitidos pelos clientes legado e novo. Esse prefixo não
  colide com IDs hexadecimais calculados para operações financeiras.

Histórico anterior continua legível; resolução de conflitos históricos permanece
permitida sem fabricar/reescrever comprovante ausente.

Limite: a causa efetiva de um conflito não pode ser provada, pois a revisão base
não faz parte do comprovante antigo e as regras não recalculam o hash da operação.
Um escritor autenticado ainda pode fabricar um par completo coerente de conflito;
ele não altera o lançamento. Isso é testado como bloqueio conhecido, sem alegar
autenticidade completa do histórico.

## Evidências automatizadas

- `tests/firestore-settings-integrity.test.js`: preparação/publicação V2,
  categorias, nomes Unicode, contagens, isolamento, controles positivos das
  regras anteriores, CAS real de cliente e bloqueios ainda presentes;
- `tests/firestore-conflict-integrity.test.js`: código real do commit homologado
  e cliente novo nos dois namespaces, associação atômica, metadados remotos,
  identidade longa, histórico automático, repetição e recuperação histórica.

Os resultados quantitativos finais são registrados pelo runner no relatório
`FIRESTORE-INTEGRIDADE-RESULTADOS.md`; não se presume aprovação antes da execução
no Emulator. Não foi iniciado Emulator adicional por este agente.
