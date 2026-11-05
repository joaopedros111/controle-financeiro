# Composição experimental de lifecycle, SDK e interface

> Atualização posterior autorizada, restrita a CP-05: ver a seção final deste
> relatório. As seções originais preservam o diagnóstico e os resultados da
> composição antes da correção; sua decisão bloqueante é histórica.

Base: branch `security/cofre-local-etapa1`, HEAD `1e0f4a5`. Inventariados por
SHA-256 os 43 arquivos locais preexistentes, preservados. Sem commit/publicação.

## Achado CP-01 durante a implementação

A primeira rodada do novo browser runner reprovou: após uma edição, a UI ainda
podia exibir o status sincronizado da operação anterior por um breve intervalo.
A leitura da fila encontrou uma operação pendente (1), contrariando o status
anterior. Os dados/filas estavam preservados; o erro era de apresentação/prontidão
na nova composição, não no sincronizador ou no SDK. A conclusão da homologação
ficou suspensa até a correção e repetição das asserções originais.

A correção passou a publicar pending antes de iniciar a intenção, considerar tarefas
locais em andamento e invalidar confirmação anterior após o commit. Nenhum módulo
preexistente foi alterado. Os resultados estão registrados na matriz abaixo.

## Coordenação adicional encontrada — CP-02

A primeira abertura da segunda aba foi cancelada porque a revisão do catálogo
podia avançar na primeira aba enquanto a segunda derivava a chave. O controlador
existente corretamente rejeita uma autorização cuja base mudou. A composição
agora mantém o Web Lock financeiro também durante KDF/leitura inicial/prova de
desbloqueio; não faz retry cego de cancelled nem afrouxa a época durável. Bloqueio
global continua podendo revogar durante o KDF, pois bumpEpoch não depende desse
Web Lock. O ensaio original foi repetido sem remover suas asserções.

## Arquitetura implementada

### Bloqueio funcional CP-05 — implementação desta parte interrompida

Uma rodada final com SDK/Emulator falhou em duas abas na mesma conta. O
diagnóstico sanitizado mostrou uma aba ready/synced e outra com lifecycle ready,
outbox aparentemente vazia e AutomaticFinanceSync permanente, status “Há dados
locais sem confirmação remota. A cópia local foi preservada.”. O erro vem do
ramo sync/untracked-data de automatic-finance-sync.js:267.

O ciclo compara um snapshot remoto obtido antes com o estado/fila locais lidos
depois. Uma outra aba pode gravar e confirmar nesse intervalo; localVersion é
da sessão em memória, não uma revisão compartilhada entre abas. waitLocal protege
apenas comandos da própria instância. A investigação aponta essa janela como
causa do falso bloqueio; uma rodada verde posterior não elimina a reprodução.

A auditoria determinística independente confirmou a intercalação, sem importar
a nova composição: A retém seu segundo snapshot, B grava e confirma outro
lançamento, A continua com o snapshot antigo. Resultado: `secure:false`,
`error:sync/untracked-data`, localCount=2, remoteCount=2, pending=0,
equivalent=true. O processo sai com código 1, como reprovação, não como teste
verde que espera um defeito. Usa armazenamento transacional Node e I/O SDK
modelado com transporte de gerações real; a reprodução SDK/Emulator no browser
é uma evidência separada. Não se demonstrou perda de dados nesse ensaio, mas
o falso erro permanente impede considerar a sincronização homologada.

**Proposta, não implementada:** revalidar uma âncora durável de estado/fila/geração
em torno da obtenção do snapshot remoto. Se outra aba avançou a revisão, repetir
o ciclo com snapshot novo, mantendo o erro de dados realmente sem rastreamento
quando a base for estável. Não remover a detecção, não confirmar sem ACK e não
limpar filas para contornar o erro. Testar a intercalação determinística e dados
realmente não rastreados antes/depois da alteração.

A correção exige revisão do módulo funcional ou contrato oficial de coordenação.
Conforme a restrição desta tarefa, **nenhuma alteração foi feita nesse módulo e
a homologação da sincronização concorrente foi interrompida**. A composição não
está integralmente homologada; esta pendência impede liberar a próxima fase com
base nesta entrega. Os demais testes e evidências são registrados separadamente.

```text
Interface experimental independente (perfil sintético + opt-in explícito)
  → createVaultComposition (nova composição, sem bootstrap publicado)
    → Auth SDK real / inMemoryPersistence / Auth Emulator
      → única autoridade de transições → createVaultLifecycle existente
    → matrícula explícita + prova independente + custódia
    → lifecycle desbloqueia fachada de createRealVaultAdapter existente
      → ServicoFinanceiroAtomico / intenções financeiras reais
      → controlador + codec + Web Crypto + CAS/época durável reais
        → IndexedDB dedicado synthetic-integrated-composition-*
    → AutomaticFinanceSync real, iniciado apenas na sessão confirmada/desbloqueada
      → fábrica Firebase com runtime oficial / Firestore memoryLocalCache
        → Firestore Emulator e regras reais copiadas sem alteração
```

Nenhum módulo preexistente foi modificado. A composição usa as APIs reais do
lifecycle, adaptador, controlador e sincronizador. Fachadas novas coordenam
construção, leituras, encerramento e entrega de callbacks; não reimplementam
outbox, reconciliação, ACK, gerações ou transações financeiras.

O lifecycle continua dono da drenagem de edições. A composição cerca imediatamente
a entrada de rede/retornos/renderer ao encerrar, mas só deixa real.lock parar o
sincronizador depois de drenar os commits locais. Parar o sincronizador antes
disso alteraria sua session e cancelaria o save ainda pertencente ao proprietário
anterior. O waitLocal oficial aguarda as Promises locais, sem incluir rede ou ACK.

Os métodos reais do remoto são cercados antes/depois do await. onUser/listeners
mantêm seus contratos síncronos de unsubscribe. A inscrição central de Auth decide
mudanças de proprietário; a inscrição do AutomaticFinanceSync recebe o evento real
inicial da conta autorizada e não pode hidratar outra conta durante encerramento.

As chamadas SDK de login/logout são serializadas. Um resultado Auth antigo ainda
pode alterar currentUser do SDK: um evento inesperado fecha a capacidade financeira,
em vez de manter outro dono desbloqueado. Login do mesmo UID exige nova sessão
e segredo, inclusive quando o SDK não emite novo evento. Desbloqueio de um dono
confirmado é recusado enquanto a intenção Auth atual não terminou.

## Fluxos e estados da interface

| Estado | Conteúdo e permissões |
| --- | --- |
| signed-out | Sem Auth/contexto financeiro; nenhuma finança no DOM |
| authenticating / closing | Entrada de operações fechada; dados/inputs financeiros removidos |
| missing | Auth confirmado, cofre inexistente; criação explícita disponível, sem saldo vazio |
| locked / unlocking | Sem dados; senha/segredo são autorizações separadas de Auth |
| creating / custody | Prova/custódia ainda incompletas; sem comandos financeiros |
| unlocked | Dados apenas do proprietário autorizado; status remoto separado |
| pending | Há comando/fila/settings/conflitos ou outras pendências; não indicar ACK global |
| recovery-required | Acesso/revalidação não concluídos; sem dados e sem reset automático |
| error | Erro recuperável explícito; nenhuma interpretação como banco vazio |
| suspended / closed | Capacidade anterior encerrada; retorno não reaproveita DEK |

Login de uma conta sem cofre não cria dados. Criar exige Auth real da conta
sintética e destino missing. O documento cifrado lifecycle-owner é gravado a partir
do UID retornado pelo SDK, inicialmente prepared. A prova exporta o grafo atual,
restaura em outro banco novo com DEK nova, compara integralmente documentos/geração,
bloqueia e reabre pela recuperação independente. Só após essa prova o segredo é
entregue; a confirmação exige reapresentação, declaração externa e senha reapresentada.
Somente então a matrícula passa a verified, vinculada a keyId, e o lifecycle abre
os comandos e a sincronização.

Essa matrícula é um artefato experimental versionado, não uma migração ou mecanismo
de descoberta para o aplicativo publicado. Não se infere dono a partir de @local,
saldo, URL ou catálogo público. O segredo não é guardado em storage. A declaração
de custódia demonstra uma escolha do operador, não prova armazenamento físico externo.

Auth indisponível produz error com finanças removidas. Reabertura offline exige
seleção explícita de conta sintética, identidade unconfirmed e senha válida do
cofre dessa conta. Não inicia remoto. Depois de reinício completo, o SDK Auth está
sem sessão; não há login nem unlock automático. Ao retornar a rede, login real e
novo unlock são necessários para sincronizar a fila já existente.

O renderer usa replaceChildren/textContent, limpa campos financeiros e cerca
retornos/finally por época da composição. Não há máscara CSS escondendo dados
de A sob uma conta B. O teste de B também faz leitura direta pelo SDK de documento
de A e exige permission-denied do servidor, além de conferir DOM vazio.

## Integridade, revogação e recuperação

Estado e fila são gravados pelo serviço atômico e backend existentes. Os testes
comparam documentos completos após erro, reabertura e recuperação, incluindo
tombstones, conflitos e recuperação com fila arquivada transitiva no Node.
Não se marca synced por envio ou por fila aparentemente vazia: a composição exige
status global confirmado do AutomaticFinanceSync e nova leitura sem pendências
ou tarefas locais. O SDK é quem aplica a transação e retorna ACK. O gate do ensaio
retém somente a entrega depois de aplicar a transação real.

Logout não espera esse gate/ACK remoto. A operação tentada continua na fila cifrada;
o resultado antigo não confirma uma sessão nova. A–B–A reabre offline com o mesmo
ID e attempted; liberar o ACK antigo não muda a fila. Reconectar obtém o recibo
idempotente e o servidor contém um único lançamento.

Leituras da fachada e desbloqueio usam o mesmo Web Lock dos escritores cooperantes,
com CAS/época durável ainda obrigatórios. O lock de revogação não depende desse
Web Lock e pode invalidar KDF/preparação antigos. Não há BroadcastChannel na ponte.
Duas páginas reais gravam IDs distintos; uma é congelada via CDP, a outra faz
logout, e a retomada rejeita a capacidade anterior e remove os registros da UI.

O observador de interface revalida enquanto há finanças visíveis. Ao detectar
revogação durável, fecha localmente a fachada já invalidada, sem gerar outro bump
que revogaria indiscriminadamente uma sessão nova em outra aba. Isso não apaga
plaintext já copiado para o heap, nem promete revogação de código não cooperante.

No pagehide, a entrada fecha e os dados são removidos sincronicamente; cleanup
assíncrono não é considerado garantido pelo evento. pageshow.persisted deve ser
true no ensaio; resume mantém estado bloqueado/unconfirmed e exige segredo novo.
Não se substitui BFCache por reload para obter aprovação.

Recuperar acesso abre o **destino atual** com o segredo, testa uma reconstrução
independente e conserva as revisões/operações mais recentes. Nunca importa pacote
antigo sobre esse destino. Os bancos de prova são novos e recusam sobrescrita.
A prova não é failover de banco perdido nem substituto de backup externo atual.

## Isolamento e rede

- O opt-in do servidor de teste é obrigatório; sem ele nenhum módulo/SDK/banco
  é inicializado. Não existe flag de ativação do cofre no aplicativo publicado.
- Projeto fixo demo-vault-integration, UIDs sintéticos permitidos, endpoints exatos
  127.0.0.1:9099/:8080 e nomes de banco validados. Não há seletor de arquivo real,
  configuração Firebase publicada ou abertura do perfil pessoal.
- Auth e Firestore usam memória. O banco auxiliar firebase-heartbeat-database é
  inventariado, não apagado. Todos os stores dos perfis são inspecionados para
  nomes/valores/IDs financeiros, senha, segredos e CryptoKey persistida. localStorage,
  sessionStorage e Cache Storage permanecem vazios.
- O wrapper cria configuração/logs novos no temporário, copia regras existentes,
  remove credenciais só do filho, recusa portas ocupadas e não limpa bancos/caches.
- CSP permite scripts locais e conexões apenas locais/Emulators. Service Worker
  é bloqueado no harness, e a versão publicada permanece sem alteração.

O WebChannel instalado tenta `https://www.google.com/images/cleardot.gif` para
diagnosticar erros de rede. A origem foi identificada no código local
`node_modules/@firebase/webchannel-wrapper/dist/webchannel-blob/esm/webchannel_blob_es2018.js:89`.
São tentativas de imagem, não acesso a Firestore de produção. A CSP default-src
none bloqueia esse recurso; Playwright registra requestfailed com motivo `csp`
(ou ERR_BLOCKED_BY_CSP), sem response. O runner exige **ambas** as evidências e
recusa qualquer outro destino/resultado. Não se abriu uma exceção de rede nem se
patchou o SDK. Os probes bloqueados são contados separadamente: não se alega
zero tentativas externas, e sim zero conexões externas bem-sucedidas.

UIDs, documentos, revisões, gerações, tamanhos, IVs e envelopes continuam metadados
visíveis. O Emulator recebe finanças sintéticas pelo protocolo existente; cofre
local não é E2EE remoto. Nenhuma produção foi acessada.

## Arquivos desta etapa

Somente arquivos novos:

- experimental/finance-vault-composition.js: nova composição/fachadas;
- tests/fixtures/vault-composition-browser.mjs: runtime SDK, renderer e hooks de QA;
- tests/fixtures/vault-composition-cases.mjs: Auth/modelo de armazenamento Node;
- tests/finance-vault-composition.test.js: nove testes Node;
- scripts/run-vault-composition-browser.mjs: matriz SDK/Emulator/IDB real;
- scripts/run-vault-composition-emulator.mjs: serviços loopback isolados;
- scripts/audit-vault-composition-concurrency.mjs: reprodução independente CP-05;
- docs/cofre-local-composicao-experimental.md: este relatório.

Não há dependência nova, bundle publicado, mudança em app.js/storage/Firebase/
sincronizador/serviço atômico/controlador existentes, interface publicada ou SW.

## Falhas, correções e ensaios reprovados

Além de CP-01 e CP-02 acima:

| Achado | Tratamento |
| --- | --- |
| Um teste assumia que run finaliza toda a sincronização mesmo quando outro ciclo já roda | Espera pelo ACK global real; fila zero e synced continuam obrigatórios |
| CP-01 poderia voltar ao status anterior durante uma intenção | Pending antes do comando, tarefas em andamento consideradas, confirmação invalidada após commit; teste com gate |
| Confirmação de uma aba podia ficar em syncing durante edição concorrente | waitLocal oficial conectado às Promises do lifecycle protege comandos da própria aba; não resolve CP-05 entre abas, que permanece bloqueante |
| Intenções SDK sobrepostas poderiam deixar currentUser diferente do último dono desejado | Chamadas Auth serializadas; eventos inesperados fecham acesso; teste determinístico com login retido |
| Polling poderia apagar erro de sincronização | Erro fica retido até novo status/reabertura; teste permission-denied preserva operação e confirma retry real |
| Guarda de rede originalmente exigia zero request events | Diagnóstico encontrou apenas cleardot bloqueado por CSP; guarda passou a verificar bloqueio e ausência de resposta para esse endpoint exato |
| Texto de failure diferente do esperado pelo runner | Playwright retornou csp; ambos os códigos explícitos de bloqueio CSP são aceitos, nenhuma falha genérica é aceita |
| Um ensaio de gate poderia reter metadado de sync sem comando local | Hook exige inFlight local antes de reter CAS; estado de gate entra nos diagnósticos |

Uma rodada também atingiu timeout durante a espera de ação antes de ter trace
suficiente para individualizar a Promise. Não se atribui causa ao Emulator. Foram
acrescentados traces sem dados, qualificação do gate e waitLocal; houve rodadas
completas sem intervenção e com as mesmas asserções de drenagem e ACK, porém
a repetição concorrente expôs CP-05, que continua bloqueante.
Os logs reprovados permanecem disponíveis, sem skips para escondê-los.

O primeiro teste Node CP-01 aguardou uma leitura que estava atrás do próprio gate
de escrita, impedindo o teste de liberar o gate. Somente essa execução Node foi
interrompida via Ctrl-C na sua sessão de ferramenta; nenhum banco/perfil foi
removido. O teste agora libera o gate antes de aguardar a leitura. A correção
foi no ensaio, não no mutex ou no lifecycle. As rodadas finais não usam intervenção.

## Testes e evidências

```powershell
node --test --test-timeout=60000 tests/finance-vault-composition.test.js
node scripts/run-vault-composition-emulator.mjs
node scripts/run-vault-integrated-emulator.mjs --restore-only
node --test tests/finance-vault-lifecycle.test.js tests/finance-vault-restore-regression.test.js tests/vault-ui-action.test.js
node scripts/run-app-injection-browser.mjs
node scripts/audit-vault-independent.mjs
node scripts/audit-vault-lifecycle.mjs
node scripts/audit-vault-composition-concurrency.mjs
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

| Matriz | Aprovados | Falhas | Ignorados |
| --- | ---: | ---: | ---: |
| Composição Node final | 9 | 0 | 0 |
| Composição Edge/Chrome + SDK/Emulator, rodada completa | 32 | 0 | 0 |
| Repetição concorrente SDK/Emulator | Não homologada | CP-05 | 0 |
| Auditoria independente CP-05 | 0 | 1 (esperada como achado, exit 1) | 0 |
| Regressão restauração SDK/Emulator, repetição isolada | 8 | 0 | 0 |
| Lifecycle/restauração/helper Node anteriores | 25 | 0 | 0 |
| App completo defaults/injeção Edge/Chrome | 12 | 0 | 0 |
| Auditoria independente das fundações | 30 | 0 | 0 |
| Auditoria do lifecycle | 4 | 0 | 0 |
| Suíte geral final, 847 testes | 840 | 1 (launch do Edge) | 6 |
| Repetição isolada do backend browser que falhou | 64 cenários (1 arquivo Node) | 0 | 0 |
| check/sintaxe/diff check | Aprovados, exit 0 | 0 | 0 |

Registros em `%TEMP%` (não versionados; perfis e bancos sintéticos retidos):

- `cf-composition-node-final-confirmed.log`: nove testes aprovados no estado final;
- `cf-composition-concurrent-evidence.log`: 32/32 em ambos os engines, incluindo
  BFCache real, reinício offline e revogação durável. Perfis `cf-composition-msedge-cw4iUt`
  e `cf-composition-chrome-eWc7Ym`; 19 probes cleardot bloqueados por CSP, sem resposta;
- `cf-composition-browser-delivery.log`: repetição reprovada com CP-05. Uma rodada
  verde não elimina esta falha intermitente;
- `cf-composition-concurrency-audit-final.log`: CP-05 determinístico independente,
  exit 1. A primeira tentativa do probe falhou por faltar injeção de metadados
  legados no ensaio Node (`localStorage` ausente); corrigida somente essa fixture
  do probe, antes de obter a reprodução descrita;
- `cf-composition-restore-final.log`: primeira tentativa interrompida por TimeoutError
  em `launchPersistentContext` do Chrome, antes dos seus cenários. Não se atribui
  essa falha ao Emulator. `cf-composition-restore-retry.log`: repetição sem mudança
  de código aprovada 8/8, inclusive reprodução controlada da antiga leitura
  interrompida e verificação da correção anterior;
- `cf-composition-suite-delivery.log`: 840/847 aprovados, 1 falha, 6 ignorados,
  0 cancelados. Falha de launch em `scripts/test-vault-backend-browser.mjs`,
  TimeoutError antes dos cenários Edge, durante período de lentidão das ferramentas.
  Não se conclui causalidade ambiental apenas pela coincidência temporal;
- `cf-composition-backend-retry.log`: mesmo arquivo, sem edição, aprovado com
  Edge/Chrome, 64 cenários, exit 0. A suíte inteira não foi reexecutada depois
  dessa repetição; o resultado agregado anterior continua registrado como falha;
- `cf-composition-full-final.log`: rodada geral anterior 840 aprovados/0 falhas/6
  ignorados (846 testes, antes do nono teste de composição e dos últimos ajustes).
  Não substitui a suíte final;
- `cf-composition-regression-node.log`, `cf-composition-defaults.log`,
  `cf-composition-audit.log`, `cf-composition-lifecycle-audit.log` e
  `cf-composition-check-final.log`: demais resultados da matriz.

Os seis ignorados da suíte geral são gates existentes para epoch Emulator,
integração Auth/Firestore sintética anterior, adaptadores reais com SDK/Emulator,
cliente de produção no Emulator, barreira de gerações e regras Firestore. Não
foram removidos nem convertidos em aprovação. Os wrappers dedicados desta etapa
cobrem composição e regressão de restauração; não se afirma que executam todos
esses seis gates. Não executados: nova implementação da correção funcional
CP-05 e sua homologação, integração publicada ou qualquer ensaio com dados reais.

Verificação final SHA-256: **43/43 arquivos locais preexistentes inalterados**.
São oito arquivos novos nesta etapa; nenhuma edição funcional preexistente,
commit, limpeza de banco/cache, migração ou publicação.

Node usa modelo transacional e I/O remoto, com módulos financeiros/criptográficos
reais; o browser é a prova com SDK, regras, IDB e cripto reais na mesma execução.
As auditorias independentes cobrem fundações e lifecycle; não representam revisão
externa integral da composição nova. Contagens se sobrepõem e não devem ser somadas.

## Limites e critérios de extração estrutural

Os estados, isolamento e recuperação exercitados não autorizam publicar o cofre.
A intenção de produto para @local, seleção autoritativa de backend, compatibilidade
de versões/SW, UX de custódia e dados reais permanece fora desta composição.
O caminho padrão do app não importa o novo módulo e conserva sua inicialização.

Fora desta homologação: Google OAuth real, clientes SDK persistentes/legados,
integração no DOM publicado, BFCache online com todos os listeners ativos
(o teste usa reabertura unconfirmed sem sync remoto), políticas de inatividade,
desastre por perda do banco, rotação operacional/benchmark móvel, energia/evicção
reais, rollback integral malicioso e zeroização física de heap. Logout global aqui
revoga o cofre no mesmo perfil, não credenciais de outros dispositivos.

A preparação inicial de cofre interrompida antes da custódia fica bloqueada como
recovery-required; esta composição não adiciona um novo protocolo de retomada da
matrícula. O protocolo de recuperação/custódia existente e as fontes são preservados,
sem reset. A integração futura deve especificar essa UX antes de qualquer ativação.

Callbacks Auth não são canceláveis pelo SDK: novas intenções fecham finanças de
imediato, mas a fila de chamadas Auth pode esperar a tentativa anterior terminar.
Isso não é espera de ACK financeiro. I/O local que nunca resolve também pode
impedir concluir drenagem; não há timeout que anuncie salvamento falso.

**Decisão: composição parcialmente validada, não integralmente homologada e não
apta a liberar a extração estrutural do bootstrap com base nesta entrega.**
CP-05 exige autorização para tratar o contrato funcional de sincronização e uma
nova homologação concorrente. As três políticas isoladas e LC-01 não foram
alteradas; sua aprovação anterior não cobre essa interação SDK/sincronizador.

Depois de resolvido o bloqueio, uma futura extração deve manter o cofre desativado
e os defaults atuais, exigindo equivalência antes/depois em startup, offline,
login/logout, backup, filas e erros. Não conectar backend cifrado ao app nessa
extração. A ligação posterior precisa de nova homologação do DOM real, SDK/abas,
seleção de modo, recuperação e versões.
Não fazer dual-write, migração automática, limpeza ou rollback para uma origem
antiga depois de novas gravações cifradas.

## Atualização autorizada — correção mínima de CP-05

### Preservação e reprodução anterior à correção

Branch `security/cofre-local-etapa1`, HEAD `1e0f4a5`, sem commits. Nesta retomada
foram inventariados por SHA-256 os **51 arquivos locais preexistentes**, incluindo
as alterações ainda não versionadas da composição. A injeção de metadados legados
já existente no sincronizador foi preservada. Nenhum banco/cache foi removido.

O script independente `scripts/audit-vault-composition-concurrency.mjs` foi
executado **antes da edição funcional**, sem importar a composição. Resultado
original em `%TEMP%/cf-cp05-original.log`: exit 1, `secure:false`,
`sync/untracked-data`, localCount=2, remoteCount=2, pending=0, equivalent=true.

### Causa-raiz e contrato existente

A função responsável é **`AutomaticFinanceSync.cycle`**, no ramo que compara
as chaves financeiras locais com as chaves de `snapshot.records`. A sequência
determinística foi:

1. A obtém seu segundo snapshot remoto; o ensaio retém a entrega depois da
   leitura real, antes de a função continuar.
2. B grava estado e outbox atomicamente no mesmo backend dedicado, envia a
   operação e recebe o ACK correspondente; a fila compartilhada fica vazia.
3. A recebe o snapshot antigo, reconcilia e lê o estado/fila locais posteriores.
4. A vê uma chave que não existia naquele snapshot e, antes da correção, lança
   `sync/untracked-data`, mesmo com o registro confirmado no servidor.

`s.localVersion` pertence a uma instância e não detecta a edição de B. O contrato
durável existente fornece `estado.revisao` (edições/reconciliações incrementam a
revisão), fila persistida (`remoteRevisions`, outbox, confirmações, conflitos,
restaurações etc.) e geração retornada pelo snapshot validado. Uma mudança de
fila pode ocorrer sem incrementar a revisão financeira; por isso só comparar
`revisao` não basta. Nenhum campo/token novo foi criado no armazenamento.

### Alteração funcional e limites

Somente **`automatic-finance-sync.js`, função `cycle`**, teve alteração funcional
nesta retomada: o lançamento imediato do erro foi substituído por uma revalidação
no próprio ramo excepcional de chaves ausentes (12 linhas adicionais líquidas).

- Faz outra consulta usando **`this.snapshot(s)`**, com as mesmas validações de
  protocolo, registros, tombstones, configurações, conflitos e sessão existentes.
- Relê a revisão financeira e a fila. Compara a geração, a revisão durável e a
  representação JSON da fila com a base que motivou a suspeita. Essa comparação
  é somente conservadora para repetir o ciclo; não autoriza ACK nem gravação.
  Reordenação de propriedades pode causar repetição adicional, nunca confirmação.
- Se a base mudou ou o snapshot novo já contém todas as chaves, retorna com
  `s.again = true`; o `run` existente agenda outro ciclo. **Não confirma usando
  o snapshot antigo, nem usa apenas a presença de chaves como prova de equivalência.**
- Se geração, revisão e fila continuam estáveis e uma chave ainda falta no
  remoto novo, lança o **mesmo `sync/untracked-data`**, com o mesmo tratamento
  permanente. Não cria operação para dados sem rastreamento nem mascara o erro.
- Falhas da consulta/leitura continuam propagadas ao tratamento existente.
  A sessão é revalidada depois de cada await novo; logout durante a consulta
  não pode continuar persistência/confirmar dados.

O caminho normal sem chaves ausentes não ganha leitura ou escrita. Não foram
alterados reconciliação, resolução de conflitos, envio/retirada de outbox,
confirmação de ACK, tombstones, restauração, armazenamento ou bootstrap. O ramo
novo não grava. A confirmação integral permanece na função atômica existente,
que verifica estado esperado e pendências antes de registrar confirmação.

### Arquivos desta correção

| Arquivo | Alteração nesta retomada |
| --- | --- |
| `automatic-finance-sync.js` | Única alteração funcional: revalidação no ramo CP-05 de `cycle` |
| `tests/automatic-sync-cp05.test.js` | Novo: seis testes determinísticos com serviços/cripto reais, I/O e IDB modelados |
| `tests/fixtures/vault-composition-browser.mjs` | Hook de QA que retém snapshot real após entrega do SDK; nenhum registro/ACK substituído |
| `scripts/run-vault-composition-browser.mjs` | Modo opt-in `VAULT_COMPOSITION_CP05_ONLY=1`: mesma composição/UI, três intercalações determinísticas em cada engine; modo completo anterior preservado |
| `docs/cofre-local-composicao-experimental.md` | Histórico preservado e atualização CP-05 |

O script independente não foi modificado. Nenhum outro módulo funcional,
interface publicada, Service Worker, regra ou configuração de produção mudou.

### Validação dirigida, na ordem solicitada

1. Reprodução original independente: reprovada com `sync/untracked-data`, acima.
2. Regressão `old snapshot`: aprovada, 1/1. Retém o segundo snapshot, B confirma,
   A reconsulta e pede novo ciclo sem erro nem confirmação; ciclo seguinte
   confirma com dados equivalentes, dois registros e fila vazia.
3. Negativo `stable legitimate`: aprovado, 1/1. Injeta explicitamente um registro
   sintético válido sem operação rastreável; o erro permanece, `run` mantém
   bloqueio permanente e não apaga as finanças, fila ou conflitos.
4. Matriz Node dirigida: **168/168** mais **13/13** do serviço atômico. Inclui os
   seis novos ensaios: corrida original, divergência legítima, revisão mudando
   durante reconsulta, fila nova sem mudança de revisão, falha remota durante
   reconsulta e logout durante reconsulta. Nos dois casos de base alterada não
   há confirmação; divergência estável seguinte ainda falha. A operação adicionada
   durante a reconsulta sobrevive exata e só sai após seu ACK posterior. Também
   foram executados os testes anteriores de política automática, isolamento
   assíncrono, adaptadores reais, composição e lifecycle (incluindo LC-01,
   ACK perdido/duplicado/atrasado, conflitos e tombstones).
5. **Mesmo script independente original, sem edição: aprovado**, exit 0,
   `secure:true`, error=null, localCount=2, remoteCount=2, pending=0, equivalent=true.
   O teste Node adicional verifica que o ciclo antigo não confirma e que o novo
   ciclo confirma; o probe independente isoladamente não prova essa segunda etapa.
6. **Composição real com Auth/Firestore Emulator: 12/12 grupos**, zero falhas e
   zero ignorados. São seis preparações (opt-in, login, matrícula/ACK, três em cada
   engine) e **seis intercalações CP-05** (três Edge, três Chrome). A retém o
   segundo snapshot do SDK, B grava e recebe ACK real, A retoma e ambas chegam
   a synced sem erro permanente, com equivalência local/remoto, contagens exatas
   e fila vazia. Sem falha de inicialização nesta rodada; nenhum probe externo
   ou conexão de produção. Não se repetiram os demais fluxos browser da composição.

Comandos e logs em `%TEMP%`:

```powershell
node scripts/audit-vault-composition-concurrency.mjs # antes da edição
node --test --test-timeout=60000 --test-name-pattern='old snapshot' tests/automatic-sync-cp05.test.js
node --test --test-timeout=60000 --test-name-pattern='stable legitimate' tests/automatic-sync-cp05.test.js
node --test --test-timeout=60000 tests/automatic-sync-cp05.test.js tests/automatic-sync-policy.test.js tests/async-session-isolation.test.js tests/finance-vault-real-adapters.test.js tests/finance-vault-composition.test.js tests/finance-vault-lifecycle.test.js
node --test --test-timeout=60000 tests/financial-atomic-service.test.js
node scripts/audit-vault-composition-concurrency.mjs # depois, mesmo script
$env:VAULT_COMPOSITION_CP05_ONLY='1'
node scripts/run-vault-composition-emulator.mjs
```

Logs: `cf-cp05-original.log`, `cf-cp05-regression.log`, `cf-cp05-negative.log`,
`cf-cp05-targeted.log`, `cf-cp05-atomic.log`, `cf-cp05-audit-fixed.log`,
`cf-cp05-composition-emulator.log`. Perfis sintéticos retidos:
`cf-composition-msedge-A5kT3b`, `cf-composition-chrome-KFn0n8`.
Logs/configuração do Emulator: `%TEMP%/cf-composition-emulator-mTDDzs`.

### Validação final e decisão desta retomada

Suíte geral executada uma única vez **após todos os testes dirigidos passarem**:

```powershell
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

| Validação desta retomada | Aprovados | Falhas | Ignorados/cancelados |
| --- | ---: | ---: | ---: |
| Suíte geral final (853 testes, exit 0) | 847 | 0 | 6 ignorados, 0 cancelados |
| `npm.cmd run check` (uma execução) | exit 0 | 0 | 0 |
| `git diff --check` | exit 0 | 0 | 0 |

Log geral `%TEMP%/cf-cp05-full-suite.log`, duração 594196 ms; check em
`%TEMP%/cf-cp05-check.log`. **Sem falhas de inicialização Edge/Chrome** nesta
retomada, tanto na rodada dedicada CP-05 como nos runners incluídos pela suíte
geral. Os seis ignorados continuam sendo os gates existentes listados na matriz
histórica: epoch Emulator, integração Auth/Firestore anterior, adaptadores reais
SDK/Emulator, cliente nas regras do Emulator, barreira de gerações e regras
Firestore. Nenhum foi convertido em aprovação, removido ou enfraquecido. O
harness dedicado de composição CP-05 executou Auth/Firestore Emulator de verdade.

Não executados adicionalmente: matriz completa de 32 fluxos da composição,
BFCache e restauração antiga em wrappers dedicados, auditoria ampla de fundações
em browser e cenários de produção. Foram mantidas suas evidências históricas;
os ensaios browser dedicados desta retomada ficaram restritos a CP-05 e às suas
precondições, conforme solicitado. Os runners browser automaticamente incluídos
por `npm.cmd test` foram preservados e executados normalmente.

Conferência SHA-256 desta retomada: **47 dos 51 arquivos preexistentes permanecem
idênticos**; somente os quatro arquivos indicados na tabela foram atualizados
intencionalmente, e há um novo arquivo de testes. Ao substituir apenas o ramo
CP-05 pelo lançamento original do erro, o sincronizador reconstruído produz
exatamente o hash de antes desta retomada: suas alterações locais anteriores
(inclusive injeção/validação de metadados) estão preservadas. Nenhum outro arquivo
funcional foi alterado.

Risco residual: a prova de estabilidade é local, sem transação distribuída com
o servidor. Mudanças contínuas de outra aba podem exigir novos ciclos; não se
força confirmação nem se mantém lock local enquanto aguarda rede. Cada suspeita
de chave ausente custa uma consulta remota validada e duas leituras locais
adicionais. O protocolo remoto e a equivalência/confirmador atômico existentes
continuam responsáveis pela confirmação final; esta correção não amplia essas
garantias. Não trata outros defeitos de sincronização nem autoriza migração,
ativação do cofre ou extração do bootstrap. Nenhuma outra fase foi iniciada.

**Decisão desta retomada: CP-05 corrigido e seu bloqueio específico encerrado
pelas evidências dirigidas e pela suíte final aprovadas.** A divergência legítima
permanece detectada; bases móveis não são confirmadas nem tratadas como perda.
Essa decisão substitui somente a pendência CP-05 da composição, não constitui
uma nova homologação integral de todos os fluxos nem inicia a extração do
bootstrap. Trabalho encerrado nesta entrega, sem commit, push, merge ou deploy.
