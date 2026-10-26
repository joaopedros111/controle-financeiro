# Importação de backup: causa atual, contrato e dependências

Data: 2026-10-26. Entrega documental. Não implementa importação, não modifica a
interface, a fila, os protocolos ou as regras e não acessa dados de produção.

## Causa identificada no código atual

Os dois caminhos têm comportamentos diferentes:

| Passo | Lançamento manual autenticado | Restauração JSON |
| --- | --- | --- |
| Entrada | Handler financeiro chama `salvar()` | `importarBackup()` lê o arquivo e chama `recuperacaoFinanceira.restaurar()` |
| Persistência | `aplicarEdicao()` recebe uma função que cria operações com ID e revisão-base | Chama `persistirEstadoFinanceiro(key, next, false, true)` |
| Fila | Mudanças financeiras geram operações | `localEdit=false` seleciona `() => []`, sem novas operações do backup |
| Sinalização | Dispara `finance-local-change`, que solicita publicação | Dispara `finance-backup-restored`, que marca `restoredPending=true` e mostra o botão de revisão |
| Publicação | Segue para staging/envio, se não houver bloqueios | `publishFirebaseState()` e `publishFirebaseStateNow()` interrompem enquanto `restoredPending=true` |
| Confirmação exibida | Persistência local e estado de sincronização são tratados em caminhos distintos | “Backup restaurado.” é exibido após persistir localmente; não exige ACK do Firestore |

Referências verificadas nesta auditoria:

- [app.js](../app.js), linhas 638–659: operações do lançamento manual e evento de alteração local.
- [app.js](../app.js), linhas 693–707: `localEdit` controla criação de operações; `restored` marca pendência de revisão.
- [app.js](../app.js), linhas 3145–3165: restauração passa `false, true`, renderiza localmente e informa sucesso local.
- [app.js](../app.js), linhas 4182–4195 e 4239: bloqueios de publicação por `restoredPending`.
- [app.js](../app.js), linhas 4454–4459: eventos de restauração e edição manual não são equivalentes.
- [app.js](../app.js), linhas 4464–4486: ação separada limpa a flag, chama `stageFirebaseState()` e publica.
- [index.html](../index.html), linha 263: botão “Revisar e sincronizar backup restaurado”.
- [storage.js](../storage.js), função `restaurar`: sucesso refere-se à persistência fornecida pelo chamador, não ao Firestore.
- [financial-atomic-service.js](../financial-atomic-service.js), `aplicarEdicao`: somente as operações fornecidas por `criarOperacoes` entram na outbox.

Portanto, a restauração atual não é uma importação sincronizada automática.
O estado financeiro local muda, mas nenhuma operação nova é criada nesse passo
e o envio fica condicionado a outra ação do usuário. Voltar a ficar online ou
recarregar não equivale a aprovar a revisão. Na inicialização com essa flag,
os listeners também deixam de ser instalados em determinados ramos.

O código possui uma saída posterior: “Revisar e sincronizar backup restaurado”
combina registros com a nuvem, limpa a flag, gera operações e tenta publicá-las.
Não é correto afirmar que backups são impossíveis de sincronizar no mecanismo
atual; eles têm um fluxo adicional e confirmação local ambígua. Configurações
divergentes ainda podem criar conflitos nesse caminho.

Condição importante: com `restoredPending=true`, a publicação de novas edições
manuais também fica bloqueada. O relato de lançamentos manuais sincronizando é
compatível com a execução normal sem essa flag, mas não demonstra o estado da
mesma conta/sessão após restaurar. Se a revisão já tiver sido concluída e os dados
continuarem locais, será necessário outro diagnóstico com evidências sintéticas
ou logs autorizados. Não foi inspecionado o Firebase real nem o navegador do usuário.

## Verificação realizada e lacuna de testes

Foram executados os testes existentes relacionados a backup, restauração e
recuperação, com dados sintéticos:

```text
node --test --test-name-pattern="backup|restaura|recupera|recurrence metadata" tests/finance-core.test.js tests/storage.test.js tests/app-sync.test.js
14 aprovados; 0 falhas.
```

Eles confirmam validação, persistência local, preservação de recorrência e o
caminho separado de revisão. O teste de revisão em `tests/app-sync.test.js`
verifica que a flag é removida após acionar o handler. Não há nessa seleção uma
prova de importação nova com replicação completa em outro navegador. Os testes
obrigatórios abaixo são requisitos futuros, não testes implementados ou aprovados.

## Contrato obrigatório da importação nova

Importar será uma ação explícita do usuário autenticado. Não será uma migração
automática no login, na abertura, na troca de geração ou na reconexão. O destino
sempre virá da sessão ativa: projeto Firebase, UID e epoch. Nenhum campo do arquivo
poderá escolher ou modificar esse destino.

### Validação integral antes de enfileirar

1. Ler JSON com limites definidos de tamanho, quantidade de registros, categorias,
   parcelas e profundidade; recusar arquivos inválidos, formatos desconhecidos ou
   cópias brutas de recuperação que não sejam backups financeiros suportados.
2. Aceitar os formatos financeiros conhecidos, v2, v3 e o formato sem versão
   reconhecido pelo validador atual, mediante validação estrita de sua estrutura.
3. Verificar meses, tipos, nomes, valores, centavos, limites monetários individuais
   e agregados, IDs, categorias, orçamentos e metadados de séries/parcelas.
4. Construir uma prévia completa com contagens e totais por mês/tipo, mapa de
   identidades e todas as incompatibilidades. Comparar o resultado convertido
   com a origem; nenhuma linha financeira pode desaparecer silenciosamente.
5. Bloquear o lote inteiro se a conversão perder conteúdo, produzir vínculos
   ambíguos ou exigir uma transformação ainda não suportada. Arredondamentos ou
   alterações financeiras não podem ocorrer sem uma política explícita e prévia.

`validarBackup()` e `validarTotaisMonetarios()` são referências de regras de
negócio, não um conversor completo para o protocolo novo. Em particular:

- `normalizarEstado()` gera IDs quando faltam; invocá-lo novamente sem um mapa
  durável não garante identidade entre duas importações.
- `normalizarOrcamentos()` devolve `meses: {}` e descarta personalizações mensais
  antigas. Não poderá ser usado cegamente numa importação que promete preservar
  todo o conteúdo financeiro.
- O esquema novo aceita apenas IDs limitados a caracteres seguros. IDs legados
  fora desse formato precisam de mapeamento estável; não podem ser descartados.
- O esquema atual de `budgets` só contém `categoryId` e `amountCents`. Preservar
  um orçamento mensal exige extensão do modelo e de seus consumidores. Até isso
  ser suportado, um arquivo com esses limites deve ser bloqueado integralmente,
  com explicação, nunca declarado importado com os limites removidos.

### Conversão financeira por lista de campos permitidos

| Origem | Destino/condição |
| --- | --- |
| `meses[YYYY-MM].receitas/despesas` | Entidades `records` com `month` e `type` preservados |
| `id` | Mapa estável origem → `entityId`, incluindo IDs ausentes ou incompatíveis |
| `nome`, `valor` | `nome`, `amountCents`, com conversão decimal validada |
| `categorias` e referências `categoria` | Entidades `categories` e `categoryId` consistentes |
| `orcamentos.padrao` | Entidades `budgets` vinculadas ao mesmo mapa de categorias |
| `orcamentos.meses` | Preservação explícita após extensão; bloqueio se não representável |
| `pago`, `fixa` | `paid`, `fixed` |
| `serie` | `seriesId` estável, reutilizado por todas as ocorrências correspondentes |
| `parcela.atual/total` | `installment.current/total`, sem gerar parcelas adicionais |
| `tema` e preferências de apresentação | Tratamento local separado, sem inventar configuração financeira remota |

Categorias usadas por registros ou orçamentos devem existir no mapa mesmo quando
não estiverem listadas explicitamente no arquivo. Reutilização de uma categoria
existente depende de uma regra de identidade/equivalência validada na prévia;
nomes ambíguos exigem revisão. Não unir lançamentos somente por nome e valor:
dois registros financeiros iguais podem representar duas ocorrências legítimas.

Construir os comandos explicitamente, sem espalhar objetos antigos sobre os
novos. Não restaurar `outbox`, `conflicts`, decisões, recibos, `revision`,
`baseRevision`, `remoteRevisions`, `operationId`, `restoredPending`, timestamps
de sincronização, UID ou geração do backup. O campo financeiro `versao` é usado
para interpretar o formato; não é uma revisão de sincronização.

### Identidade e repetição do mesmo backup

É necessário um manifesto durável da importação, tanto no cache quanto no
Firestore. A idempotência da Etapa 1 depende de repetir o MESMO comando; chamar
`makeCommand()` novamente com IDs aleatórios não resolve a repetição do arquivo.

Contrato proposto para revisão técnica:

- Fingerprint SHA-256 de uma representação financeira canônica: ignorar espaços
  e ordem de chaves do JSON e metadados antigos de sync; preservar multiplicidade
  e vínculos. Fixar a política para ordenação de registros e campos ausentes.
- Identidade da importação vinculada ao fingerprint dentro de projeto/UID/epoch.
  Registrar versão do conversor sem permitir que uma atualização do conversor
  crie automaticamente outra importação para um arquivo já reconhecido.
- Plano imutável que mapeie categorias, orçamentos, registros e séries para IDs
  de destino e operações estáveis. Para registros sem ID, usar uma chave de
  ocorrência canônica persistida, mantendo duas linhas iguais como duas linhas.
- O mesmo arquivo em outra aba ou outro dispositivo encontra o mesmo manifesto
  e retoma o mesmo plano, em vez de produzir novos IDs.
- Coincidência com um ID existente e conteúdo divergente exige revisão, nunca
  sobrescrita automática, nova cópia oculta ou alteração de revisão-base.
- Reimportar um lote concluído é uma consulta/no-op. Se os registros foram depois
  editados ou excluídos, não reverter edições nem ressuscitar tombstones.

Arquivos distintos ou versões editadas de um backup não serão deduplicados
apenas por semelhança de conteúdo. A política para sobreposição entre backups
diferentes exige identidade de origem e revisão explícitas; não é coberta por
uma promessa de “mesmo backup”.

### Mesma fila e retomada do lote

Os comandos financeiros devem passar por `finance-epoch.js` e pela mesma fila
de `finance-epoch-cache.js`/`finance-epoch-queue.js` usada por lançamentos manuais.
Não criar um emissor paralelo que escreva registros diretamente com `setDoc`.

Antes de enviar qualquer comando, persistir atomicamente o manifesto local,
o plano completo, os comandos e a projeção correspondente, ou usar um protocolo
de preparação em blocos que só libere o lote após validar e preparar o conjunto
inteiro. O atual `enqueue()` é atômico por intenção, não por arquivo: um loop
de chamadas individuais não constitui preparação atômica de uma importação.

O manifesto remoto proposto é
`users/{uid}/financeEpochs/{epoch}/imports/{importId}`. Esse caminho NÃO existe no
protocolo implementado e é negado pelas regras novas atuais. Ele exige extensão
revisada de protocolo, regras e testes, sem abrir caminhos legados.

O manifesto deve registrar expectativas de contagem/totais, plano/mapeamentos,
blocos e confirmações suficientes para reconhecer quais operações foram aplicadas
mesmo se o ACK local se perder. O status final não pode ser uma declaração livre
do cliente: a conclusão deve ser verificada contra recibos e integridade do lote,
com uma solução que respeite os limites de leitura/escrita e avaliação das regras.

Para arquivos maiores que uma transação, definir antes a preparação, checkpoints
e barreira de publicação. Entidades importadas precisam de vínculo verificável
com o lote, ou staging equivalente, para que listeners e projeções reconheçam
um lote incompleto. Não anunciar nem exibir silenciosamente um conjunto parcial
como uma importação completa. O mecanismo exato de finalização e visibilidade
deve ser aprovado e testado antes do importador.

Após interrupção, localizar o mesmo manifesto, reutilizar IDs/revisões-base e
consultar os recibos. Não reconstruir outro lote com novos IDs. Pendências e
intenções concorrentes continuam preservadas; um conflito impede a confirmação
total e bloqueia operações dependentes. Troca de UID ou epoch interrompe o envio,
sem transferir o lote para outro namespace.

### Progresso e confirmação

Manter os quatro estados globais da sincronização. O trabalho de importação
terá detalhes próprios: validando, preparado localmente, aguardando rede,
enviando, aguardando revisão, falhou e confirmado no Firestore.

Mostrar contagens de entidades por tipo, operações pendentes, aplicadas com
confirmação remota, rejeitadas e faltantes. Diferenciar persistência local de
publicação remota. Erros precisam identificar a etapa e permitir retomada segura,
sem declarar importação concluída enquanto houver operações, vínculos ou blocos
não confirmados. Todas as mensagens da futura interface deverão ser traduzidas.

A conclusão do servidor não prova que todos os dispositivos já receberam os
dados, especialmente se algum estiver offline. O segundo dispositivo recebe o
lote pelos listeners e aplica a mesma barreira de conclusão; não deve precisar
restaurar o arquivo novamente ou recarregar a página manualmente.

## Dependências e etapa apropriada

As Etapas 1 e 2 fornecem identidade, revisão-base, recibos idempotentes, cache,
fila e preservação local de conflitos. Ainda não fornecem:

1. Listeners novos com sessão/epoch e projeção completa entre dispositivos.
2. Manifesto local/remoto, preparação atômica de múltiplas intenções, checkpoints
   e conclusão verificável de um lote.
3. Política de visibilidade de lotes incompletos e suporte correspondente no
   protocolo, regras e consumidores dos snapshots.
4. Conversor legado sem perdas, fingerprint, mapas duráveis de identidade,
   integridade referencial e tratamento de orçamentos mensais antigos.
5. Fluxo de revisão/retomada de conflitos do lote e apresentação de progresso.

Sequência proposta, sem iniciar nenhuma dessas implementações:

| Etapa futura | Entrega e gate |
| --- | --- |
| Pré-requisitos de tempo real e lote | Listeners, manifesto/checkpoints, integridade e visibilidade; testes de regras e falhas aprovados no Emulator |
| Importador isolado | Conversor, prévia, deduplicação e mesma fila; todos os testes abaixo aprovados com dois navegadores independentes |
| Integração da interface | Conectar a ação de importar ao serviço validado, progresso traduzido e revisão de conflitos; somente após autorização específica |

A mera existência da fila não é suficiente para implementar os dez requisitos.
A importação fica adiada até os gates acima estarem concluídos e revisados.

## Testes obrigatórios da etapa de importação

Todos com Firebase Emulator e dados sintéticos. Testes listados, não implementados
nesta entrega:

| ID | Cenário | Aprovação objetiva |
| --- | --- | --- |
| IMP-01 | JSON inválido, versão desconhecida, estrutura incorreta, valores/meses/IDs/parcelas inválidos ou arquivo excessivo | Nenhuma nova operação nem gravação financeira no servidor; diagnóstico completo |
| IMP-02 | V2, V3 e formato conhecido sem versão; categorias personalizadas, limites, receitas, despesas, recorrências e parcelas | Mapeamentos completos; contagens/totais e todos os vínculos preservados; nenhum registro filtrado |
| IMP-03 | Orçamento mensal ou campo financeiro não representável | Suporte explícito preserva o conteúdo; caso não suportado, bloqueio integral antes do envio |
| IMP-04 | Backup com UID, epoch, fila, revisões, conflitos e recibos antigos embutidos | Somente campos financeiros permitidos convertidos; destino vem da sessão; zero metadados antigos restaurados |
| IMP-05 | Mesmo backup repetido no mesmo navegador, em outra aba e no segundo dispositivo | Mesmas entidades/importId; nenhum aumento de registros ou operações aplicadas; nenhum total duplicado |
| IMP-06 | JSON equivalente com outra formatação/ordem de chaves; linhas iguais legítimas; registros sem ID e IDs incompatíveis | Fingerprint estável conforme contrato; multiplicidade preservada e IDs repetíveis |
| IMP-07 | Navegador A importa; B já está online em contexto/storage independente | B recebe o lote completo por listener sem importar nem recarregar; IDs, valores, categorias, orçamentos, séries e parcelas iguais aos do servidor |
| IMP-08 | A importa offline; recarga/fechamento do processo; reconexão; B online | Plano/fila sobrevivem; retomada publica uma vez; B recebe tudo e contagens finais conferem |
| IMP-09 | Queda antes de concluir preparação local, entre blocos remotos e após commit antes de ACK | Sem preparação parcial liberada, sem falso sucesso; mesmo manifesto e mesmos comandos retomados; zero duplicações |
| IMP-10 | IndexedDB indisponível, quota e transação abortada durante preparação/ACK | Estado anterior preservado, erro visível e ausência de declaração falsa de persistência/conclusão |
| IMP-11 | Duas abas/dispositivos iniciam simultaneamente a mesma importação | Um plano remoto compatível, mesmos IDs, reservas/idempotência eficazes e nenhum duplo efeito |
| IMP-12 | Edição/exclusão concorrente ou reimportação após editar/excluir dados do lote | Intenções preservadas para revisão; sem sobrescrita silenciosa, reversão de edição ou ressurreição |
| IMP-13 | Troca de UID, projeto ou geração durante preparação/envio/ACK | Nenhum comando/resultado aplicado no destino novo; lote antigo preservado ou bloqueado |
| IMP-14 | Manifesto adulterado, conclusão prematura, bloco ausente, vínculos quebrados e cliente antigo | Regras rejeitam transições inválidas; não há confirmação total; caminhos antigos continuam fechados |
| IMP-15 | Progresso e falhas nos seis idiomas; importação incompleta | Local/remoto claramente distintos; numeradores baseados em ACKs; ações de retomada/revisão acessíveis |
| IMP-16 | Lote superior ao limite de uma transação e volumes máximos suportados | Preparação/checkpoints/visibilidade definidos, sem sucesso parcial silencioso nem estouro de regras |
| IMP-17 | Snapshots repetidos de um lote em A e B | Nenhuma nova operação nasce de leitura; filas permanecem vazias ao terminar e sem loops de publicação |

Critério de liberação: todos os testes aplicáveis aprovados, incluindo IMP-07 e
IMP-08 em navegadores com armazenamento independente. As confirmações individuais
das Etapas 1/2 não substituem esse teste de importação e replicação integral.
