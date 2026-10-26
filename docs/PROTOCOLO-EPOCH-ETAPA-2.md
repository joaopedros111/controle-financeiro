# Cache e fila durável por geração — etapa 2

Requisito posterior obrigatório: [auditoria e contrato de importação de backup](IMPORTACAO-BACKUP-AUDITORIA-E-REQUISITOS.md).
O importador futuro usará esta mesma fila. Manifesto, preparação atômica de lote,
conversor sem perdas e replicação completa em dois navegadores ainda dependem
das etapas descritas nesse documento; não estão implementados nesta entrega.

Implementação isolada da interface e do armazenamento legado. Não modifica
`firebase.json`, `firestore.rules` ou o bundle publicado. Não existe importação
de localStorage, filas, conflitos ou bancos anteriores.

## Armazenamento

Banco novo: `controleFinanceiro:epoch-cache:v1`, versão 1, store `namespaces`.
Chave: JSON de `[projectId, uid, epoch]`. Nenhum namespace é compartilhado entre
projetos, contas ou gerações. `openEpochCache(scope)` devolve uma instância
vinculada a esse namespace; mudar de conta ou geração exige outra instância.

Cada namespace contém:

- `operations`: histórico ordenado dos comandos completos e imutáveis, sequência,
  estado `pending`, `applied` ou `conflict`, e resultado remoto quando disponível.
- `remote`: projeção confirmada pelo servidor por coleção/ID.
- `projection`: projeção remota com as intenções ainda não aplicadas sobrepostas;
  envelopes incluem indicadores `pending` e `conflict` para o futuro adaptador UI.
- `nextSequence`, `serverReady` e uma reserva de processamento (`lease`).

`enqueue(command)` valida identidade/escopo e compara a revisão-base com a
projeção local. Comando e projeção são gravados em uma única transação readwrite.
A Promise só resolve após `transaction.oncomplete`. Transações abortadas,
quota excedida, conexão fechada ou IndexedDB indisponível rejeitam a operação;
não existe fallback que declare memória como gravação durável.

Um ID repetido com comando idêntico não gera nova operação, mesmo após aplicado.
Reutilizar o ID com conteúdo diferente falha. Edições offline sucessivas do mesmo
registro mantêm IDs de operação distintos e revisões-base encadeadas. Marcadores
de exclusão impedem edição local posterior do mesmo ID.

## Processamento e confirmação

`EpochQueueSync.activate(cache, transport)` cria uma sessão. `flush()`:

1. Adquire uma reserva no IndexedDB, compartilhada entre abas, com proprietário
   aleatório e validade de 30 segundos por padrão.
2. Busca uma leitura completa confirmada no servidor e aplica somente ao cache.
3. Envia comandos originais em ordem, sem recriar IDs ou atualizar suas bases.
4. Confirma atomicamente o resultado na fila e na projeção, desde que a sessão e
   a reserva ainda sejam válidas.
5. Libera a reserva. Outra aba pode retomar uma reserva expirada; quando a reserva
   pertence a outra aba, uma nova tentativa é agendada para depois do prazo.

Nenhum comando é apagado. Somente um resultado `applied` com a revisão esperada
marca a operação como aplicada. Se a resposta se perder depois do commit remoto,
o comando permanece pendente e é reenviado com o mesmo ID. O recibo idempotente
da Etapa 1 retorna a confirmação original, sem uma nova gravação financeira.

Resultados `conflict` preservam o comando integral e a versão remota observada.
Comandos posteriores da mesma entidade ficam pendentes e bloqueados para evitar
que uma revisão numérica coincidente sobreponha a edição de outro dispositivo.
Outras entidades continuam sendo processadas. Não há interface de resolução,
descarte ou rebase de conflitos nesta etapa.

`deactivate()` invalida a sessão, cancela tentativas agendadas e impede o próximo
envio e ACK local. Uma gravação já enviada pode terminar no servidor; nesse caso
o comando continua pendente no namespace antigo e será reconhecido por seu
recibo quando essa conta/geração voltar a ser processada. Nenhum resultado é
aplicado ao namespace da nova conta. ACKs de uma reserva vencida não substituem
o trabalho de uma nova aba.

## Offline e estados

O processador oferece `setOnline`, `flush` e `observeConnectivity`, este último
retornando uma função de remoção dos eventos. O host futuro deve ativar a sessão,
iniciar o primeiro flush e instalar o observador para retomar automaticamente
em eventos `online`. Erros de rede também passam para offline. Nenhum desses
eventos foi conectado à aplicação de produção.
Ao gravar uma intenção, o host chamará `await cache.enqueue(command)` e depois
`worker.flush()`; a primeira Promise confirma somente a persistência local.

| Estado | Condição |
| --- | --- |
| sincronizando | Leitura/envio em andamento, sem baseline confirmado ou com comandos pendentes |
| sincronizado | Baseline confirmado, sem pendências, revisões para resolver ou erros |
| offline | Conectividade indisponível e sem erro/revisão que exija atenção |
| erro | Falha de persistência/transporte, sessão inválida ou intenção concorrente preservada |

Erros de persistência ficam retidos na instância até `cache.recover()` verificar
que o banco pode ser lido. A recuperação não afirma que a tentativa anteriormente
rejeitada foi salva: o chamador deve reenviá-la explicitamente. Em seguida,
um novo flush confirma o estado do servidor e pode remover o erro do processador.

## Interface para snapshots futuros

`applyRemoteSnapshot({scope, confirmed, complete, entities}, isCurrent)` aceita
envelopes confirmados, normalizados e vinculados ao namespace certo. Nunca chama
enqueue, não gera IDs e não cria operações. Preserva intenções pendentes e não
regride revisões já confirmadas. O callback de sessão permite recusar eventos
que ficaram obsoletos enquanto a transação aguardava.

Exclusão é representada exclusivamente por tombstone. Ausência em uma consulta
não gera comandos nem exclusões locais inferidas. Limpeza e troca de geração
continuam sendo procedimentos separados; snapshots da geração antiga são recusados.

O transporte desta etapa é exclusivamente para Emulator, usa cache Firebase em
memória, leituras do servidor e as transações da Etapa 1. Ele confere o projeto
da instância e a geração ativa antes e depois da leitura. Regras continuam sendo
a barreira de autorização por UID.

## Testes e aprovação

- `npm.cmd test`: testes unitários novos e regressão existente.
- `npm.cmd run test:epoch`: modelo, fila pura e protocolo/regras no Firestore Emulator.
- `npm.cmd run test:epoch:browser`: IndexedDB real + Auth/Firestore Emulators,
  contextos independentes e perfis persistentes de Edge e Chrome.
- `npm.cmd run test:rules` e `npm.cmd run test:e2e`: regressão legada separada.
- `npm.cmd run check`, `check:epoch` e `check:epoch:queue`: verificações de sintaxe.

Critérios: fila e projeção atômicas; fila preservada após fechar/reabrir processo;
um único efeito financeiro e recibo após perda de ACK; isolamento de abas/UID/
geração/projeto; conflitos integrais preservados após recarga; nenhuma operação
gerada por snapshots; falhas de IDB sem falsa confirmação; regressão atual aprovada.

## Limites desta entrega

Não há listeners conectados, integração UI, resolução de conflitos, limpeza de
dados reais ou implantação. O transporte Emulator lê as quatro coleções no flush;
atualizações contínuas dependem dos listeners de uma etapa posterior. Sincronizado
expressa a baseline obtida e a fila confirmada, não garante que outro dispositivo
não tenha alterado dados depois dessa leitura.

O histórico e os tombstones são mantidos sem compactação; o namespace é gravado
como um documento IndexedDB. Essa escolha favorece atomicidade e revisão nesta
etapa; volumes grandes exigirão medição e eventual particionamento. Não há
garantia contra remoção manual dos dados do site, limpeza/evicção pelo navegador
ou perda física de disco. Os testes de durabilidade cobrem fechamento e reabertura
normal de um processo real do navegador, não queda de energia.

Parcelas e séries conservam seus metadados e IDs, mas operações de grupo e
integridade referencial continuam fora do escopo desta etapa.

## Evidências finais — 2026-10-26

| Verificação | Resultado |
| --- | --- |
| npm.cmd test | 355 aprovados, zero falhas, 3 integrações ignoradas fora do Emulator |
| npm.cmd run test:epoch | 22 aprovados, zero falhas/skips |
| npm.cmd run test:epoch:browser | 26 aprovados, Edge e Chrome, 1,5 minuto |
| npm.cmd run test:rules | 23 aprovados, zero falhas/skips |
| npm.cmd run test:e2e | 50 aprovados, Edge e Chrome, 3,2 minutos |
| npm.cmd run check / check:epoch / check:epoch:queue | Aprovados |
| git diff --check | Aprovado |

Evidências verificadas por asserções nos dois navegadores:

- Fechar e reiniciar um processo de navegador com perfil persistente conserva o
  comando `disk-pending`, seu estado pendente e a projeção financeira. Após
  reconectar, o servidor contém exatamente um registro e um recibo de operação.
- Perder a resposta após commit remoto mantém `lost-ack` pendente. Após recarga,
  a repetição retorna `duplicate: true`, com um registro, um recibo e revisão 1.
- Duas abas disputam a mesma fila; somente o proprietário da reserva envia.
  Uma intenção adicionada durante o envio não é removida pelo ACK anterior.
- Outra aba retoma uma reserva expirada; um ACK antigo não regride a projeção
  de revisão 2 nem seu valor mais recente.
- Trocar o UID durante um envio deixa as duas intenções antigas pendentes, não
  envia a segunda e não grava nenhum registro na conta nova.
- Mudar a geração bloqueia o envio antigo e conserva a fila original; a geração
  nova começa em namespace vazio.
- Editar um registro excluído em outro contexto preserva o comando e a versão
  excluída no resultado de conflito; intenções dependentes permanecem bloqueadas.
- Duas edições de dispositivos independentes conservam integralmente o comando
  rejeitado e seu resultado após recarga.
- Quota excedida e abort mantêm o estado anterior e retornam erro; recuperar o
  banco permite uma nova gravação explicitamente solicitada.
- Snapshots não aumentam a fila nem substituem intenções pendentes. Projeto,
  UID e geração incorretos são recusados.
- Reconexão por evento online esvazia as pendências automaticamente quando o
  observador opcional está instalado, sem duplicação.
- Fontes sintéticas do legado permanecem intactas e não são importadas.

Logs preservados fora do repositório:

- `%TEMP%/controle-financeiro-homolog-eawwW3/execution.log`: protocolo e regras novos.
- `%TEMP%/controle-financeiro-homolog-wEsg8h/execution.log`: fila no navegador;
  perfis persistentes sintéticos ficam nessa mesma pasta (`epoch-profile-*`).
- `%TEMP%/controle-financeiro-homolog-ItyKlY/execution.log`: regras legadas.
- `%TEMP%/controle-financeiro-homolog-r6XPZE/execution.log`: regressão de navegador.
- `%TEMP%/controle-financeiro-unit-stage2.log`: regressão local.

Os critérios desta etapa estão satisfeitos nos ambientes acima. Nenhuma limpeza
real, alteração de regra/configuração de produção, commit, push ou deploy foi
executado. A integração da interface e listeners permanece para revisão futura.
