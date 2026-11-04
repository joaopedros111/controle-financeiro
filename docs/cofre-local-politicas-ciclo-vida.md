# Políticas experimentais de ciclo de vida

## Registro de interrupção da homologação — LC-01

Durante a revisão adicional, antes da entrega, foi identificada uma corrida no
novo controlador isolado: identify enfileirado e logout imediato poderiam permitir
que a identificação antiga repusesse owner/locked depois do encerramento. Não
entregava finanças ou chave, mas contrariava a precedência da última intenção.
A conclusão da homologação foi suspensa para corrigir e testar a ordenação.
Nenhum bootstrap publicado, banco real ou arquivo local anterior foi modificado.

A correção foi implementada com contador de intenções independente da época do
cofre, cancelamento de identify/resume superados e aplicação do motivo final do
fechamento. A retomada confirmou essa implementação, acrescentou três cenários
determinísticos e repetiu a homologação. O registro original permanece acima para
não apagar a causa da interrupção.

## Base, preservação e escopo

Branch `security/cofre-local-etapa1`, HEAD
`1e0f4a57d555e09b66a6bd58dd15cd119d053341`. A análise inclui a árvore local,
não apenas o commit. Os 28 arquivos locais anteriores à auditoria e
`docs/cofre-local-auditoria-bootstrap.md` foram preservados por SHA-256.
Não há commit, staging, push, merge, deploy ou limpeza de bancos/caches.

Foram lidos a auditoria do bootstrap e os relatórios das Etapas 1–4, auditoria
independente/correções, integração, migração sintética, escritas, adaptadores,
pontos de injeção e homologação integrada. Este controlador é novo e isolado:
nenhum import pelo aplicativo, alteração do bootstrap, módulo funcional,
interface, Service Worker, Firebase de produção ou banco financeiro atual.

## Arquitetura e contratos implementados

```text
Composição sintética explícita
  → createVaultLifecycle (estados, intenções, dono, drenagem, autorização)
    → openAdapter(owner) por conexão exclusiva
      → createRealVaultAdapter existente
        → ServicoFinanceiroAtomico + finance-core/sync-core reais
        → controlador/codec/Web Crypto/CAS/época durável reais
          → banco dedicado :synthetic-* (browser) / modelo transacional (Node)

send(commit) → attempted durável → chamada remota correlacionada
            → ACK + sessão ainda atual → confirmação local do ID/geração
close → fechar entrada → drenar apenas tarefas locais → lock durável → close
```

`experimental/finance-vault-lifecycle.js` não conhece DOM, Firebase, descoberta
de bancos ou Service Worker. Recebe `openAdapter`, `onState` e o escopo obrigatório
`owner-vault-all-tabs`; não tem seleção automática ou default de ativação.
Reusa os serviços reais para intenções, tombstones, coalescência e fila.

API: `start`, `identify`, `unlock`, `read`, `edit`, `send`, `close`, `suspend`,
`resume` e `state`. `edit` exige callback síncrona e pura; callbacks de negócio
assíncronas são rejeitadas. O recibo `{durable:true,owner,revision}` só é entregue
após commit atômico. Iniciar uma chamada não é confirmação de salvamento.
`state()` e `onState` sempre têm `data:null`: conteúdo só sai por `read()`
autorizado, com revalidação depois do await. Quem recebe uma cópia tem de descartá-la
ao mudar de contexto; o controlador não apaga objetos já copiados pelo chamador.

O callback `identify` é uma fronteira de confiança da composição. `confirmed`
precisa vir de Auth válido da mesma conta; não é um campo aceito da futura UI,
URL ou localStorage. Aqui o driver fornece eventos sintéticos. Não se afirma que
o novo controlador implementa login Google, valida tokens ou encerra o SDK Auth.

## Estados e transições

| Estado | Significado e operações permitidas |
| --- | --- |
| initializing | Objeto construído; start inicia o shell lógico |
| signed-out | Sem autorização financeira; unlock/read/edit/send recusados |
| authenticating | Aplicação da identidade explícita, sem dados financeiros |
| locked | Proprietário selecionado, sem chave; somente tentativa explícita de unlock |
| unlocking | Segredo/manifesto/documentos/vínculo em validação; sem entrega financeira |
| missing | Destino inexistente; erro distinto de coleção vazia; esta API não cria cofre |
| ready | Sessão local válida; read/edit; send exige também dono confirmado |
| operating | Há comando local em andamento; novas operações podem ser capturadas enquanto autorizado |
| closing | Entrada e entregas remotas fechadas imediatamente; drenagem local e revogação em andamento |
| suspended | Capacidade anterior encerrada; retorno não restaura a chave |
| error | Falha explícita de Auth/storage/integridade/revogação; sem acesso financeiro |

```text
initializing → signed-out → identify → authenticating → locked
locked → unlock → ready ↔ operating
unlock inválido → locked (ou error/missing, conforme o erro)
qualquer transição de conta → closing → identidade nova → locked
ready/operating → close(lock) → closing → locked
ready/operating → close(logout) → closing → signed-out
pagehide → suspend → closing → suspended
pageshow.persisted → resume → locked/unconfirmed → segredo reapresentado
falha → error; nunca normalizar null para estado financeiro vazio
```

`close(lock)` usa `closing` como fase de bloqueio em andamento; `locked` só é
anunciado após concluir o lock. `closing` também cobre encerramento/logout,
diferenciados pelo motivo final. Uma falha de lock não anuncia revogação global
concluída nem permite que uma identificação nova a contorne.

## Política de propriedade offline

Há três situações distintas: `confirmed` (dono confirmado pela composição Auth),
`unconfirmed` (seleção explícita de proprietário para abertura local offline) e
`none` (sem sessão/seleção). `failed` representa erro de autenticação, com estado
error; não é convertido automaticamente em none, offline ou finanças vazias.

O perfil segue o contrato anterior: reabertura offline exige segredo do cofre;
publicação exige também Auth da mesma conta. O driver seleciona projeto demo e
UID sintético explicitamente. Após unlock, exige documento cifrado
`snapshot:<uid>:lifecycle-owner`, formato `synthetic-authenticated-owner-v1`,
com projeto/UID exatos. Catálogo público, UID, senha isoladamente ou dados de
@local não são usados para atribuir finanças a outra conta.

Esse documento é uma **atestação de matrícula da fixture**, criada explicitamente
durante preparação sintética e autenticada pelo cofre. Não é prova independente
de um login Google histórico. Sua criação por Auth real, descoberta de destino
e composição com custódia/recuperação já homologadas precisam de wiring futuro;
não são implementadas por esta API nem presumidas para dados reais.

Com dono unconfirmed e vínculo autenticado, a sessão permite leitura/escrita local
offline e preserva a outbox. `send` rejeita antes de chamar o remoto. Após restart
ou BFCache, não há desbloqueio automático. Voltar a confirmed exige nova entrada
confiável de identidade e novo unlock, sem promover silenciosamente o UID.
Sem vínculo ou com dono divergente, falha fechado; não cria par estado/fila.

## Política de encerramento, drenagem e ACK

1. Fechar imediatamente a entrada de novos comandos, invalidar a época lógica
   de entrega e emitir closing. Respostas antigas não podem atuar na sessão nova.
2. Enumerar tarefas locais capturadas em `local`; aguardar que terminem para o
   backend/proprietário capturados. Isso não permite novos comandos dessa sessão.
3. Não incluir espera de rede em local. A fila e attempted já duráveis sobrevivem
   a logout mesmo quando o servidor nunca responde ou já aplicou a operação.
4. Revogar a lease da ponte e confirmar `bumpEpoch` no armazenamento durável;
   só depois fechar conexão e anunciar locked/signed-out/suspended.
5. Abrir uma próxima sessão apenas após cleanup bem-sucedido. Falha de fence deixa
   estado error e exige retry explícito; não promete revogação das outras abas.

O limite de aceite é explícito: comando iniciado ainda sem commit pode falhar e
sua Promise rejeita. `Promise.allSettled` permite encerrar após o resultado local,
mas não converte rejeição em recibo financeiro. O chamador deve apresentar essa
rejeição e conservar rascunho não salvo; não pode dizer que foi salvo porque o
logout terminou. Queda do processo antes do commit não garante preservar texto
somente em memória. Operações já duráveis, filas, conflitos, tombstones e
referências nunca são apagados por fechamento. Não se salva no unload.

`send` usa `enviarFila` real, que marca attempted antes de enviar. Só confirma
ACK `acknowledged:true` da invocação exata. Quando o transporte ecoa operationId
ou generation, esses campos também devem corresponder. O SDK real nem sempre
ecoa os campos: não se criou requisito fictício que recuse todo ACK real.
O serviço confere ID e geração ao concluir; ACK ausente/incorreto não retira item.
Após qualquer mudança local de contexto, a resposta antiga é recusada antes
da confirmação; o fence do adaptador cobre também a transação final.

ACK perdido conserva o mesmo ID/attempted; reenvio recebe recibo idempotente.
O controlador não afirma sincronização global: settings, históricos, resoluções
e equivalência continuam responsabilidade do AutomaticFinanceSync existente.
Seu novo `send` é o caminho isolado de operações, sem reimplementar o ciclo global.

## Política de revogação entre abas

O escopo testado é explicitamente projeto + dono + cofre, em todas as abas
cooperantes do mesmo banco/origem/perfil. Não é revogação global da conta Firebase,
de outros dispositivos ou de um cofre diferente. Segue o lock durável das Etapas
anteriores; um modo de logout apenas nesta aba seria uma política distinta e
não foi adotado silenciosamente.

Cada aba tem conexão, controlador e autorização próprios. Web Locks coordenam
escritores; CAS relê revisão, geração e época na transação de commit. Uma
preparação antiga retida antes do CAS perde para a revogação durável da outra aba.
Nenhum BroadcastChannel é necessário: a ponte usada fornece channelFactory nula.
Logo, a prova cobre falha/ausência total de comunicação, não somente mensagem perdida.

O congelamento real via CDP mantém uma aba suspensa enquanto a outra faz logout;
ao voltar, a escrita antiga é rejeitada. A travessia de histórico exige
`pageshow.persisted === true` em Edge e Chrome. O wrapper de teste fecha entrada
no pagehide, e resume não reutiliza DEK ou estado financeiro. O processo inteiro
também é reiniciado com o mesmo perfil sintético e reabre offline por novo segredo.

Revogação é cooperativa. Não apaga plaintext/chaves já copiados para o heap de
outra aba; não é defesa contra XSS/extensões nem contra rollback integral do perfil.
Sem mensagens, uma aba ociosa pode continuar exibindo uma cópia que já recebeu;
o controlador impede novas leituras/commits pelas APIs depois do fence. Limpeza
visual e revalidação do DOM real seguem como requisito da futura integração.

## LC-01: causa-raiz, correção e provas determinísticas

Antes da correção, `identify` enfileirava um callback que aguardava cleanup e
instalava owner sem verificar se sua intenção ainda era a mais recente. A época
de chave protegia finanças, mas não bastava para ordenar metadados de controle.
Além disso, chamadas de fechamento compartilham uma Promise; fixar o motivo na
primeira chamada poderia fazer um logout posterior terminar como lock/change.

A correção já presente na retomada usa `intent` monotônico em identify, close,
suspend e resume. Identify/resume capturam e revalidam esse contador depois de
awaits relevantes. A época `epoch` continua independente para leases/entregas.
`closingReason` recebe o motivo final mesmo quando closing já existe. Não se
cancela o commit local capturado só para resolver a corrida de identidade.

Quatro grupos determinísticos, sem sleeps probabilísticos, verificam:

- identify pendente seguido de logout, e A–B–A com intenções sobrepostas;
- lock e suspend mais recentes que uma identificação de B;
- commit local retido por gate no CAS, identify de B enfileirado e logout posterior:
  após liberar, o commit de A fica durável, B é cancelado e a fila de A permanece;
- unlock retido na leitura de catálogo, logout e conclusão antiga: a chave não é
  instalada, a sessão continua signed-out e uma abertura nova funciona.

Os gates são liberados explicitamente. Os casos provam término sem deadlock
nessas sequências e ausência de espera por ACK remoto. Não provam que qualquer
I/O local arbitrariamente travado terminará: a drenagem pode continuar pendente
se o navegador não resolver uma operação. Timeout futuro não pode descartar fila
ou anunciar sucesso falso; sua UX não foi inventada nesta etapa.

## Ensaios, isolamento e arquivos

Node usa o modelo transacional serializado existente, não IndexedDB real.
Edge/Chrome usam IndexedDB/Web Crypto/Web Locks reais; só bancos
`controleFinanceiro:cofre-isolado:v1:synthetic-*`, perfis novos retidos e servidor
127.0.0.1. O runner bloqueia SW e usa CSP `connect-src 'none'`; verifica zero
requisições externas e local/session/Cache Storage vazios. Inspeciona todos os
stores para marcadores financeiros, senha e CryptoKey persistida, sem apagar nada.
UID, revisões, gerações, IVs e tamanhos continuam metadados visíveis.

Na matriz nova, eventos de Auth e respostas/falhas de rede são sintéticos. O
simulador existente testa ACK perdido, reenvio e recibo único. Não é alegação de
OAuth real. A regressão SDK/Emulator antiga é identificada separadamente abaixo.

Arquivos criados nesta fase, todos fora do grafo publicado:

- `experimental/finance-vault-lifecycle.js`: controlador e correção LC-01;
- `tests/fixtures/vault-lifecycle-cases.mjs`: 18 cenários compartilhados;
- `tests/finance-vault-lifecycle.test.js`: entrada Node;
- `tests/fixtures/vault-lifecycle-browser.mjs`: composição e eventos de página;
- `scripts/run-vault-lifecycle-browser.mjs`: dois browsers, abas, freeze, BFCache,
  restart offline e inspeção de armazenamento;
- `scripts/audit-vault-lifecycle.mjs`: quatro probes adversariais independentes
  da matriz comum, no modelo Node;
- `docs/cofre-local-politicas-ciclo-vida.md`: este relatório.

Na retomada após o limite de uso, o controlador já corrigido foi mantido;
modificaram-se a fixture (três provas adicionais), o harness de auditoria
(prova LC-01) e este relatório. Os demais arquivos da fase anterior permaneceram
intactos. Não há dependências novas nem artefatos temporários no repositório.

## Resultados e comandos

```powershell
node --test tests/finance-vault-lifecycle.test.js
node scripts/run-vault-lifecycle-browser.mjs
node scripts/audit-vault-lifecycle.mjs
node scripts/audit-vault-independent.mjs
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

| Verificação | Aprovados | Falhas | Ignorados |
| --- | ---: | ---: | ---: |
| Políticas Node após reforço de LC-01 | 18 | 0 | 0 |
| Políticas Edge/Chrome após reforço | 46 | 0 | 0 |
| Auditoria específica independente Node | 4 | 0 | 0 |
| Harness independente das fundações Node/Edge/Chrome | 30 | 0 | 0 |
| App padrão/injeção, regressão da execução anterior retomada | 12 | 0 | 0 |
| Suíte geral final da retomada, 831 descobertos | 825 | 0 | 6 |
| check, sintaxe adicional e diff check | Aprovados (saída 0) | 0 | — |
| Regressão adicional do harness integrado com Emulator | Incompleta | 1 execução reprovada | 0 |

Os 46 são 18 cenários comuns mais cinco grupos por motor: gravação simultânea em
abas, aba congelada/revogação, reinício completo offline, BFCache real e inspeção
integral do armazenamento. Contagens se sobrepõem às suítes e não devem ser somadas.
O harness independente das fundações não é uma auditoria externa de todo o novo
controlador; os quatro probes próprios acrescentam evidência automatizada.

A suíte final terminou com saída 0 em 542,8 segundos, sem intervenção,
cancelamentos ou timeout por arquivo. Inclui as 18 provas finais e as regressões
financeiras, de sessões, recuperação e restauração; os runners descobertos
passaram criptografia browser 100, backend 64, Etapa 4 72 e integração anterior 50.
Não é uma execução do runner integrado adicional com Emulator, que continua
separado e reprovado conforme o registro abaixo.

**Ignorados:** seis grupos condicionados ao Emulator: protocolo alternativo de
épocas; integração Auth/Firestore com persistência cifrada; fábrica real Firebase
com AutomaticFinanceSync/cofre; transações/settings do cliente nas regras;
barreira de gerações/restauração; regras de UID/tombstones. Nenhum dos 18 cenários
da nova matriz ou das 46 verificações de browser foi ignorado. A regressão
Emulator adicional reprovada não transforma esses skips em aprovações.

**Não executados:** runners separados desses seis grupos com seus ambientes
específicos nesta retomada, OAuth real e os fluxos de produto listados nas
limitações. A execução anterior retomada do app padrão/injetado (12/12) não foi
repetida sem necessidade, pois seus arquivos e módulos permanecem idênticos.

Antes do reforço final, a execução recuperada após LC-01 passou 828 descobertos,
822 aprovados, seis ignorados, zero falhas/cancelamentos (547,8 segundos), e os
browsers passaram 40/40. A nova suíte foi executada integralmente para
incluir as três provas adicionais, sem inferir cobertura dos resultados anteriores.
Essa repetição terminou com os 831/825/0/6 registrados acima.

### Falhas de ensaio e regressão adicional não aprovada

O primeiro runner novo chegou ao retorno do histórico mas esperava `load` e
atingiu timeout; BFCache não deve ser validado por evento de carregamento novo.
Corrigiu-se para commit da navegação seguido da asserção obrigatória de persisted,
sem trocar BFCache por reload, marcar skip ou aumentar timeout. As rodadas seguintes
passaram nos dois motores. LC-01 foi registrada antes da conclusão e corrigida;
os cenários existentes não foram removidos para obter aprovação.

A execução adicional `node scripts/run-vault-integrated-emulator.mjs`, iniciada
antes da interrupção, **falhou (saída 1)** no Chrome ao sondar snapshot durante
restore interrompido (`run-vault-integrated-browser.mjs:119`). O erro foi
`VaultControllerError/cancelled` no guard, depois de passar os grupos anteriores.
O runner antigo só repete stale-revision na sondagem; não trata cancelled.
Há concorrência entre sondagem e renovação da sessão/geração nesse ponto; isso é
uma hipótese para o cancelamento, não demonstração completa da causa da regressão.

Esse harness não importa o novo lifecycle. Seu código e os módulos anteriores
foram preservados. A falha não demonstrou commit obsoleto aceito ou perda de fila,
mas também não terminou a comparação daquele cenário: **não é aprovado por
inferência nem apagado por uma execução verde da suíte geral**. A investigação
dessa sondagem/restore e sua repetição integral são gates antes de compor o novo
controlador com o harness integrado/SDK. Não se alterou código anterior para
contornar a regressão ou ampliar esta entrega.

Logs fora do Git: `%TEMP%/cf-lifecycle-resumed-node.log`,
`cf-lifecycle-resumed-browser.log`, `cf-lifecycle-resumed-specific-audit-lc01.log`,
`cf-lifecycle-resumed-audit.log`, `cf-lifecycle-resumed-full.log`,
`cf-lifecycle-resumed-check.log`. Histórico preservado em `cf-lifecycle-node-lc01.log`,
`cf-lifecycle-browser-lc01.log`, `cf-lifecycle-full-final.log`,
`cf-lifecycle-emulator-regression.log` e `cf-lifecycle-browser.log`.
Nenhum log contém senha, DEK aberta ou segredo de recuperação do ensaio.
Perfis da rodada final: `%TEMP%/cf-lifecycle-msedge-4Kydaa` e
`%TEMP%/cf-lifecycle-chrome-OJOPm2`, retidos sem limpeza. Conferência final:
29/29 hashes de arquivos anteriores coincidentes; branch/HEAD inalterados;
nenhuma alteração em staging. Inspeção dos sete arquivos desta fase não encontrou
UTF-8 inválido, marcadores de conflito ou espaços finais.

## Limitações, decisões de produto e critérios para avançar

O escopo adotado deriva dos contratos anteriores: propriedade vinculada ao cofre,
segredo obrigatório offline, Auth adicional para remoto, lock durável compartilhado.
Não houve escolha silenciosa de duração de sessão, login offline automático,
aposentadoria de recuperação, bloqueio por inatividade ou logout só desta aba.
Essas políticas de produto não são implementadas. Caso se deseje outro escopo de
revogação, deve ser especificado e testado antes de alterar a composição publicada.

Permanecem: I/O local que nunca termina, queda física de energia/evicção, força e
perda de segredo, custo KDF/snapshot móvel, rotação da DEK, rollback integral sem
âncora externa, clientes antigos em cache, dados já entregues ao heap/DOM, cache
persistente legado e autenticação real. Não se testaram aqui SDK Auth multiaba,
desastre por perda do banco, UI publicada com cofre ou migração real. pagehide
não garante executar cleanup antes de congelamento; segurança na volta depende
da entrada já fechada e de resume exigir autorização nova.

**As três políticas estão homologadas no perfil isolado descrito**: propriedade
offline explícita com vínculo cifrado, drenagem de commits locais e preservação
da fila sem esperar remoto, revogação cooperativa por época durável entre abas.
LC-01 está corrigida e coberta por testes determinísticos em Node/Edge/Chrome.

**Apto somente para iniciar a adaptação incremental estrutural do bootstrap,
mantendo o caminho padrão e o cofre desativado**, conforme a alternativa B da
auditoria: extrair fases e provar equivalência sem mudar seleção de backend ou
acesso a dados. Não está homologada a conexão do novo controlador ao bootstrap,
à interface publicada ou ao SDK real. A regressão integrada com Emulator pendente
impede essa conexão e a habilitação do cofre até investigação e nova aprovação.

Antes de ligar as fases ao modo cifrado: concluir a regressão restore/SDK, definir
autoridade de seleção de backend e matrícula por Auth real, compor custódia e
recuperação existentes, garantir um único dono das transições Auth e homologar
o DOM real (inclusive BFCache), SDK multiaba e versões antigas. Sem cofre, @local,
login opcional e operações offline atuais devem permanecer idênticos. Depois de
novas escritas, rollback nunca pode voltar à origem antiga: preservar o destino
e usar leitor/recuperação compatíveis, sem limpar fila, bancos ou caches.
