# Correção da experiência de sincronização automática — 26/10/2026

## Diagnóstico antes das alterações

A aplicação publicada foi consultada somente por GET em `https://joaopedros111.github.io/controle-financeiro/`: `version.json`, meta de versão no HTML e Service Worker indicavam **1.1.76**. O código publicado carregava `firebase-sync.bundle.js`, continha `restoredPending` e os controles de tentativa/revisão, sem referência ao protocolo `finance-epoch`. A fonte local indicava 1.1.9; o processo de Pages acrescenta o número da execução à versão. Portanto, não se pode inferir o protocolo ativo pelo commit mais recente ou comparar essas versões sem considerar o build.

O protocolo **legado estava conectado à interface**. As Etapas Epoch 1–3 permaneciam isoladas. A correção mantém as coleções, IDs, transporte e persistência financeira existentes; não migra para Epoch.

| Causa no fluxo anterior | Consequência |
| --- | --- |
| A restauração usava `persistirEstadoFinanceiro(..., false, true)`, salvava o estado e marcava `restoredPending`, sem produzir operações para todos os registros importados | O envio dependia de “Revisar e sincronizar backup restaurado” |
| `blockedConflictKeys`, conflitos de configurações e decisões com status pendente bloqueavam entidades ou a conclusão | Editar novamente não removia a necessidade de revisão |
| Decisões eram criadas por confirmação, diálogo e botões de conflito | A resolução precisava de intervenção humana |
| O tratamento de falhas exibia tentativa manual e não mantinha uma rotina geral de backoff | Uma falha transitória podia deixar a fila sem nova tentativa enquanto a rede continuava online |

Os fluxos que já funcionavam foram preservados: autenticação e logout, IDs determinísticos, gravação atômica de estado/fila em IndexedDB, transações de registros/recibos no Firestore, listeners, isolamento por UID, tombstones e manifesto de configurações. Cálculos, gráficos, formulários, recorrências, parcelas e arquivos financeiros não foram reescritos.

## Comportamento implementado

O coordenador manual anterior está explicitamente desabilitado por constante e não registra handlers. Seu corpo permanece apenas para os testes históricos de invariantes. Existe um único coordenador ativo: `AutomaticFinanceSync`. Nenhum módulo Epoch passa a publicar dados.

1. A edição continua persistindo intenção, revisão-base, operação e projeção local na mesma transação IndexedDB. O evento posterior solicita envio automático.
2. A importação autenticada valida integralmente o arquivo e grava dados, operações, identidade do backup e progresso na mesma transação. É aditiva, preserva dados ausentes no arquivo e não restaura autenticação, conflitos, filas ou revisões antigas. Registros sem ID recebem identidade determinística; reimportação não duplica nem substitui uma edição posterior. Parcelas e séries são preservadas.
3. A inicialização retoma filas da própria conta, inclusive backups explicitamente pendentes do fluxo anterior. Não transfere automaticamente dados anônimos para uma conta no login.
4. O coordenador faz leitura confirmada pelo servidor, reconcilia atomicamente, envia operações com o transporte existente e faz nova leitura para confirmar. Um ACK individual não equivale a sincronização completa.
5. Falhas transitórias recebem retentativas com backoff exponencial de 200 ms até 30 s. Eventos de listeners não podem encurtar o backoff. Reconexão reinicia a tentativa. Erros de permissão, dados inválidos ou persistência ficam visíveis e não são classificados como sucesso.
6. Listeners apenas invalidam a leitura confirmada. Não convertem snapshots em intenções de gravação. A aplicação do snapshot não dispara `finance-local-change`.
7. “Sincronizado” exige equivalência com os registros/configurações lidos do servidor, fila vazia, ausência de conflitos pendentes e ACK dos históricos/resoluções. Dados locais sem operação e sem correspondente remoto produzem erro explícito, preservando a cópia local.

### Ordem e preservação das alternativas

- **Edição/edição:** prevalece a versão corrente confirmada pelo servidor quando a revisão-base já foi substituída. A ordem vem da transação com comparação de revisão, não do relógio do celular. Operações encadeadas sobre a mesma revisão e repetição após perda de ACK mantêm seus IDs originais.
- **Edição/exclusão:** prevalece a exclusão. Uma exclusão local concorrente é reenfileirada sobre a revisão remota corrente; a edição remota rejeitada fica preservada. Um tombstone remoto elimina da projeção local qualquer edição atrasada, arquivando sua intenção antes de retirar a operação da fila. O transporte também rejeita uma edição que apresente a própria revisão do tombstone.
- **Categorias, orçamentos e configurações financeiras:** a comparação usa a base confirmada e o CAS do manifesto existente. Havendo alteração concorrente, vence a configuração corrente confirmada; a alternativa local é preservada. Tema e preferências de apresentação continuam com o comportamento local existente.
- **Conflitos anteriores:** são arquivados e resolvidos automaticamente, inclusive exclusões rejeitadas presentes no Firestore. As resoluções são persistidas e confirmadas; não se pede uma nova decisão no reinício.
- **Duas abas compartilhando IndexedDB:** alterações que perdem a comparação local ficam preservadas por entidade. Uma exclusão explícita ainda produz tombstone. O estado financeiro aceito não é sobrescrito silenciosamente.

O histórico preserva valores, operações originais e suas revisões-base, alternativa remota e política aplicada. Ele é gravado junto da reconciliação em `fila:<UID>.automaticHistory`, depois publicado idempotentemente em `users/<UID>/operations/auto-history-<ID>` sob as permissões existentes. O documento remoto é imutável. IDs de resolução ficam em `automaticResolutions`.

O botão financeiro **Desfazer** continua disponível após uma remoção. Na conta sincronizada ele cria deliberadamente um novo ID, preservando o conteúdo e os vínculos de série/parcela; o tombstone anterior permanece. Assim, uma ação explícita de desfazer continua funcionando depois do ACK remoto sem permitir ressurreição por edição atrasada.

“Baixar histórico de recuperação”, na seção Dados, exporta as cópias local e remota para recuperação posterior. Não é uma ação necessária à sincronização, não decide o vencedor e não restaura automaticamente registros excluídos. A recuperação deliberada deve criar um novo lançamento com novo ID; a restauração automática do tombstone é proibida pelo novo cliente.

Na área de conta há apenas Entrar com Google e Sair da conta, conforme a autenticação, com indicador discreto e última confirmação. Foram removidos tentativa manual, opção de ativação, revisão de backup e diálogo de conflitos. Os textos principais novos têm traduções nos seis idiomas existentes.

## Arquivos da correção

| Arquivo | Finalidade |
| --- | --- |
| `automatic-finance-sync.js` (novo) | Sessões, processamento automático, backoff, reconexão, listeners, ACK e importação atômica |
| `automatic-sync-policy.js` (novo) | Política determinística, preservação de intenções e importação deduplicada |
| `app.js` | Integração ao salvamento/importação existentes e desativação do coordenador manual |
| `firebase-sync-entry.js` | Proteção de tombstones e publicação/leitura idempotente do histórico |
| `financial-atomic-service.js` | Confirmação global considera configurações, históricos e resoluções automáticas |
| `index.html` | Conta simplificada e exportação de recuperação em Dados |
| `localization.js` | Traduções dos novos textos de uso |
| `sw.js`, `scripts/prepare-pages.mjs` | Inclusão dos dois módulos novos nos recursos estáticos/PWA |
| `scripts/run-local-tests.mjs` | Injeção exclusivamente sintética de falhas transitórias no fixture do Emulator |
| `package.json` | Comando de verificação sintática dos módulos novos |
| `tests/automatic-sync-policy.test.js` (novo) | Políticas, backups, concorrência e preservação |
| `tests/financial-atomic-service.test.js`, `tests/firebase-sync-client.test.js` | ACK global, idempotência/isolamento do histórico e proteção do tombstone |
| `e2e/automatic-sync.spec.mjs` (novo), `e2e/sync.spec.mjs` | Fluxos automáticos e regressões de UI/Auth/IndexedDB |

## Ambiente de verificação e evidências

Os testes usam somente `demo-controle-financeiro` com Auth/Firestore Emulator em loopback, regras copiadas para pasta temporária e dados sintéticos. O fixture troca o login Google por autenticação sintética; a fábrica real, IndexedDB, transações, listeners e logout permanecem em uso. Requisições externas dos navegadores são bloqueadas. Limpezas nos testes atingem exclusivamente os endpoints do Emulator após verificação do host/projeto.

Os cenários novos abrem **dois processos independentes**, Edge e Chrome, com o mesmo UID e armazenamentos separados. Não clicam em tentativa, revisão ou resolução; diálogos inesperados são rejeitados. Verificam o estado durável dos dois clientes e os documentos remotos:

- Backup em A aparece em B com receita recorrente, despesa parcelada, categoria personalizada e orçamento; edição de B aparece em A; reimportar não duplica nem reverte a edição.
- Dois clientes offline editam a mesma revisão; o primeiro confirmado permanece e a alternativa concorrente é recuperável.
- Exclusão confirmada vence edição atrasada; exclusão offline também vence edição confirmada antes da reconexão.
- Backup offline mantém duas operações e job pendente após recarga do PWA, depois chega ao outro navegador e só então recebe confirmação.
- Três falhas sintéticas `unavailable` com navegador online são superadas automaticamente; intervalos entre tentativas comprovam backoff.
- Um erro permanente continua visível depois de outra edição; a fila permanece durável e é enviada após recuperação, sem duplicação.
- Desfazer uma exclusão já confirmada replica o lançamento com nova identidade e mantém o tombstone original.
- Conflitos já presentes no servidor, inclusive exclusão rejeitada, são encerrados sem diálogo e não reaparecem após reiniciar ambos os clientes.
- Regressões existentes verificam troca de UID, Auth persistente, falha/abort de IndexedDB, duas abas, ACK concorrente, funcionamento sem Firebase, categorias/orçamentos e seis idiomas.

Comandos usados: `npm test`, `npm run check`, `npm run check:automatic`, `npm run test:e2e`, `npm run test:rules` e `npm run test:epoch`. Os três testes omitidos no comando unitário padrão dependem do Emulator e são cobertos pelas execuções específicas.

Resultado unitário final: **383 testes, 380 aprovados, zero falhas e três dependentes do Emulator omitidos nessa execução**. O catálogo contém 16 testes novos da política automática; também foram acrescentadas verificações de ACK global, histórico remoto idempotente/isolado e edição sobre revisão de tombstone. Logs: `%TEMP%/controle-auto-unit-final.log`.

Resultado final de navegador: **66 aprovados, zero falhas**, em 6,5 minutos: 33 em Edge e 33 em Chrome, incluindo 16 execuções dos oito cenários novos e 50 execuções da regressão existente. Não foram usados retries do Playwright (`retries: 0`). Os oito cenários novos também usam o navegador oposto em um segundo processo independente.

Log consolidado: `%TEMP%/controle-auto-acceptance.log`. Artefatos, `execution.log` e logs dos emuladores: `%TEMP%/controle-financeiro-homolog-xsFkDn`. Os cenários novos verificam filas/documentos em IndexedDB, registros e históricos remotos e ausência dos controles/diálogos manuais. Uma espera prematura no teste novo de Desfazer foi corrigida para aguardar o ID efetivamente novo no segundo navegador; a execução final acima passou integralmente.

As verificações `npm run check` e `npm run check:automatic` também passaram. `git diff --check` não encontrou erros. A comparação com a base confirmou ausência de alterações em `firebase.json`, `firestore.rules`, `firestore.epoch.rules`, `firebase-config.js`, `finance-core.js`, `version.json` e `package-lock.json`.

Execuções específicas encerradas:

| Verificação | Resultado final | Evidência |
| --- | --- | --- |
| `npm test` | 380 aprovados; zero falhas; três testes do Emulator omitidos apenas nesse comando | `%TEMP%/controle-auto-unit-final.log` |
| `npm run check` e `npm run check:automatic` | Aprovados | Verificação sintática dos módulos existentes e novos |
| `npm run test:e2e` | 66 aprovados; zero falhas; zero retries | `%TEMP%/controle-auto-acceptance.log`; artefatos `controle-financeiro-homolog-xsFkDn` |
| `npm run test:rules` | 25 aprovados; zero falhas; zero omitidos | `%TEMP%/controle-auto-rules-final.log`; artefatos `controle-financeiro-homolog-eo1Su9` |
| `npm run test:epoch` | 28 aprovados; zero falhas; zero omitidos | `%TEMP%/controle-auto-epoch-final.log`; artefatos `controle-financeiro-homolog-IPFVxF` |
| `git diff --check` | Aprovado | Sem erros de whitespace |

Os diretórios de artefatos ficam sob `%TEMP%`. As três verificações dependentes do Emulator foram efetivamente executadas pelos comandos específicos. Mensagens `PERMISSION_DENIED` nos logs de regras/Epoch pertencem aos casos negativos esperados, que comprovam bloqueios por UID, formato, manutenção e geração; os processos terminaram com código zero.

## Limites e aprovação

- Nenhum deploy foi feito. A aplicação publicada 1.1.76 continua com o comportamento anterior até uma publicação separadamente autorizada. Testar esta correção não atualiza o celular do usuário.
- As regras locais/de produção e `firebase.json` não foram modificados. A proteção adicional de tombstones foi implementada no novo cliente. Impedir também gravações de clientes antigos ou maliciosos exige revisão/autorização específica das regras antes de uma implantação com garantias para versões mistas.
- Não foi usado celular físico nem o provedor Google real em testes. A evidência cobre navegadores desktop Edge/Chrome independentes e autenticação sintética no Emulator.
- Backups com limites específicos em `orcamentos.meses` são rejeitados explicitamente, sem importação parcial, porque o núcleo/transporte atual suporta os limites padrão por categoria e descartaria esse campo. Não há conversão silenciosa.
- Identidades remotas incompatíveis, duplicatas, permissões negadas, dados inválidos e falhas permanentes de armazenamento continuam exigindo correção técnica; retirar botões não oculta esses erros.
- O histórico permite exportação e recuperação dos valores, sem criar um novo fluxo de decisão de conflitos. Não existe restauração automática de históricos ou dados anônimos.
- A fila é durável sob as garantias normais de IndexedDB. Limpeza de armazenamento feita pelo usuário/sistema não pode ser compensada antes da confirmação remota. Nenhum dado financeiro real foi apagado ou reinicializado nesta tarefa.

Critérios para aprovar esta correção: testes unitários e de regras sem falhas, regressão Edge/Chrome sem falhas, todos os cenários automáticos acima aprovados, nenhum controle/diálogo manual de sincronização presente e nenhuma confirmação global enquanto houver trabalho remoto pendente. Publicação, mudança de regras e migração para Epoch permanecem fora desta entrega.

Esses critérios técnicos passaram na homologação local. Não houve commit, push, deploy, limpeza de dados reais ou ativação na publicação existente.
