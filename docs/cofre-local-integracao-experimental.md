# Integração experimental isolada do cofre local

## Escopo e checkpoint

Branch: `security/cofre-local-etapa1`. Base inicial: `c8340caf83545eaf105c596ee6e91bdc308661ad`.
Checkpoint local autorizado: **`2f22aa400bb11395925b5ccb94573c0375cb7a5b`**,
`chore(security): checkpoint etapas do cofre e correcoes da auditoria`.

Antes do commit foram revisados os 22 arquivos modificados/novos, as Etapas 1–4,
os relatórios e os harnesses independentes. A inspeção de conteúdo e de nomes e a
busca por padrões de credenciais não encontraram segredos reais, dados financeiros
reais ou artefatos temporários a versionar. Senhas/nomes fixos de fixtures são
explicitamente sintéticos; segredos de recuperação são gerados somente em memória.
Testes prévios: 694 descobertos, 690 aprovados, quatro dependentes do Emulator
ignorados; harness independente 30/30; check e diff check aprovados. O diretório
ficou limpo depois do checkpoint. Não foram criados commits posteriores.

O código desta integração permanece local, fora do aplicativo. Não foram alterados
`app.js`, interface, Service Worker, autenticação publicada, sincronização publicada,
regras de produção ou IndexedDB financeiro. Nenhum banco/cache/fila existente foi
limpo. Não houve migração real, push, merge ou deploy.

## Arquitetura exercitada

```text
Fixtures financeiras sintéticas / intenções de edição
  → ServicoFinanceiroAtomico REAL, sem modificações
  → adaptador experimental ler / alterar / alterarDocumentos
  → controlador real de sessões, catálogo e recuperação
  → codec financeiro real e backend cifrado real
  → Web Crypto + reservas duráveis + IndexedDB dedicado (Edge/Chrome)

Fila cifrada → serviço atômico real → transporte simulado idempotente
                                  ↘ adaptador SDK → Auth/Firestore Emulator
```

`experimental/finance-vault-persistence.js` aceita apenas projetos `demo-*`, UIDs
`synthetic-*` e identificadores de cofre `synthetic-*`. Cada autorização entrega
uma instância de sessão descartável. Bloqueio, fechamento, novo desbloqueio,
restauração ou troca de senha revogam a anterior por identidade, inclusive A–B–A
e novo login do mesmo UID. Não existe fallback para dados vazios em erro.

O adaptador copia argumentos e resultados antes dos awaits; callbacks devem ser
síncronas e sem efeitos externos. Reaplica a intenção original em até três tentativas
de revisão desatualizada. Não repete automaticamente erros de quota, falha de commit
ou cancelamento de época. Rejeita acesso a chaves de outro proprietário e mantém
estado/fila/recuperações no mesmo commit autenticado. A fachada diagnóstica expõe
leitura e tokens de teste, mas não permite contornar o ciclo de desbloqueio da conta.

Web Locks serializam escritores cooperantes da mesma conta/cofre/origem antes de
ler a base e cifrar. O CAS e os fences duráveis continuam obrigatórios dentro do
commit; Web Locks não os substituem. Sem Web Locks, concorrência pode ser rejeitada
com dados anteriores preservados; nova tentativa explícita é testada. Não há retry
indiscriminado de `cancelled`.

O transporte simulado mantém em RAM registros por proprietário e recibos por ID
de operação, rejeita payload divergente para o mesmo ID, aplica CAS remoto e permite
perder o ACK depois de aplicar a operação. A fila durável pertence ao cofre, não ao
transporte. O serviço financeiro real marca tentativas e confirma/remaneja conflitos.
A identidade da sessão é revalidada após a resposta remota e antes de confirmação
local, impedindo que ACK antigo confirme uma sessão nova.

## Isolamento de armazenamento e segredos

Os navegadores usam exclusivamente bancos
`controleFinanceiro:cofre-isolado:v1:synthetic-*`, em perfis temporários novos.
Node usa o modelo transacional serializado existente, não uma alegação de IDB real.
Os testes de navegador inspecionam os seis object stores e a lista de bancos; também
verificam localStorage/sessionStorage vazios e ausência de Cache Storage do site.
São procurados marcadores, valores financeiros, IDs de lançamento, senha, segredo
de recuperação e campos financeiros legados fora do ciphertext. Todos devem estar
ausentes. UID, IDs de documentos, tamanho, versões, revisões, geração e envelopes
continuam metadados visíveis conforme o modelo de ameaças.

BroadcastChannel transmite somente `version`, `type`, `logicalScope` e `epoch`.
Não transmite segredo, DEK, conteúdo cifrado ou documento financeiro. O teste sem
mensagens prova que o fence durável ainda rejeita a aba antiga. O reinício completo
do processo elimina o desbloqueio em memória: o cofre é encontrado bloqueado e
reaberto offline somente com senha reapresentada, preservando IDs e `attempted`.
Não são usados perfis pessoais e os perfis sintéticos são retidos, sem limpeza.

## Matriz de cenários

| Cenário | Evidência automatizada |
| --- | --- |
| Criar/desbloquear; senha incorreta | Sessão nova lê dados; erro não inicializa vazio nem substitui snapshot |
| Receitas e despesas | Serviço atômico real; valores exatos e IDs/geração da fila preservados |
| Editar/excluir offline | Coalescência do serviço real, tombstone durável e campos opcionais preservados |
| Fila durável | Fechar conexão e reabrir mantém operações e estado |
| Encerrar/reabrir navegador | Perfil persistente sintético, novo processo, offline; IDs e tentativas preservados |
| Bloquear/desbloquear | Instâncias anteriores revogadas; geração/época novamente verificadas |
| A–B–A | Mesmo banco sintético, estados/filas separados; também mesma instância Auth no Emulator |
| Múltiplas abas | CAS em instâncias separadas, abas reais com Web Locks e revogação por época |
| Conflitos | Edição local rejeitada e arquivada; conflito remoto persiste para revisão |
| Falha/repetição de ACK | Recibo remoto idempotente; fila pendente após erro; uma escrita remota |
| Restauração interrompida | Destino sem commit parcial; origem preservada; retry completo/idempotente |
| Recuperação independente | Segredo abre os dados sem senha; restauração cria DEK nova |
| Troca de senha | Reempacotamento mantém fila; senha anterior recusada pelo catálogo atual |
| Quota/abort/leitura | Injeções em IDB real/modelo; snapshots anteriores e operações mantidos |
| ACK atrasado | Lock/relogin do mesmo UID: resposta antiga recusada; operação reenviada com mesmo ID |
| Dados legíveis | Inspeção dos stores, outros mecanismos locais e ausência de segredos |
| Callback/DTO malformado | Callback async rejeitado; referência retida não altera o resultado confirmado |
| Sem Web Locks | Confirmação concorrente ou rejeição segura; retry explícito conserva ambas as intenções |

## Firebase Emulator: escopo comprovado

`scripts/run-vault-integration-emulator.mjs` cria configuração e logs em diretório
temporário, copia as regras reais sem modificá-las e inicia somente Auth e Firestore,
em `127.0.0.1:9099` e `127.0.0.1:8080`. Usa `demo-vault-integration`, configuração
CLI isolada, sem tokens/credenciais do desenvolvedor. Se portas estiverem ocupadas,
recusa iniciar sem encerrar instâncias existentes. Não há fallback para produção.
O nome do runner evita inicializar serviços implicitamente na descoberta de `npm test`.

`experimental/finance-vault-emulator-transport.js` exige flags explícitas e hosts
exatos de loopback antes de inicializar SDK. Auth usa `inMemoryPersistence` e
Firestore usa `memoryLocalCache`. Tokens de teste JSON são aceitos exclusivamente
pelo Auth Emulator; não representam login Google/OAuth homologado. Não são salvos.

O SDK real e as regras reais foram exercitados com A/B, dois dispositivos de A,
leitura/escrita/exclusão direta cruzada recusadas, recibos imutáveis, conflito,
logout/novo login e troca A–B–A na mesma instância Auth. O destino do segundo
dispositivo usa DEK independente e recebe dados remotos por `applyRemoteRecord`
real. Operações só locais continuam disponíveis na fila cifrada.

**Limite da evidência:** a integração SDK/Emulator foi executada em Node com o
modelo transacional de armazenamento. IDB real, Web Crypto, abas e reinício foram
exercitados separadamente nos navegadores. Não se declara homologado um fluxo
completo de navegador + OAuth Google + Firestore publicado, nem o controlador
`AutomaticFinanceSync` inteiro, listeners, configurações remotas e resolução de
todos os tipos de conflito. Esses pontos continuam para etapas isoladas futuras.

## Ajustes encontrados no próprio experimento

A primeira execução de navegador teve duas rejeições por concorrência entre
instâncias: o fence durável cancelou uma escrita cuja base havia mudado. Não houve
perda/commit parcial. O novo adaptador passou a coordenar escritores cooperantes
via Web Locks, mantendo as validações. Foi adicionado também teste explícito sem
Web Locks, que exige preservação e retry manual, sem mascarar cancelamentos.

A matriz Emulator acumulava um terceiro registro legítimo do segundo dispositivo;
uma expectativa inicial de quantidade dois foi corrigida para verificar os três
IDs exatos esperados, incluindo ausência do ID exclusivo de B. Nenhum controle de
segurança ou teste independente foi removido ou ignorado para obter aprovação.

## Execução reproduzível

```powershell
node --test tests/finance-vault-integration.test.js
node scripts/test-vault-integration-browser.mjs
node scripts/run-vault-integration-emulator.mjs
node scripts/audit-vault-independent.mjs
npm.cmd test
npm.cmd run check
git diff --check
```

### Arquivos criados após o checkpoint

- `experimental/finance-vault-persistence.js`: ciclo de autorização, adaptador cifrado
  e conexão com o serviço financeiro atômico real.
- `experimental/finance-vault-emulator-transport.js`: Auth/Firestore SDK em memória,
  restritos aos emuladores e projeto sintético.
- `scripts/test-vault-integration-browser.mjs`: site independente, IDB real, abas,
  inspeção de armazenamento e reinício completo offline.
- `scripts/run-vault-integration-emulator.mjs`: serviços locais e configuração CLI
  temporária, sem credenciais de produção.
- `tests/finance-vault-integration.test.js`: matriz Node de 20 cenários.
- `tests/finance-vault-emulator.test.js`: seis subcenários reais de SDK/regras/Auth.
- `tests/fixtures/vault-integration-scenarios.mjs`: dados e cenários compartilhados
  entre Node, Edge e Chrome.
- `tests/fixtures/vault-integration-browser.mjs`: entrada do bundle de teste em memória.
- `tests/fixtures/vault-simulated-transport.mjs`: CAS remoto e ACK idempotente simulados.
- `docs/cofre-local-integracao-experimental.md`: este relatório.

Nenhum arquivo rastreado pelo checkpoint foi modificado nesta integração.

Os resultados finais estão registrados ao fim deste relatório. O teste do
Emulator é deliberadamente ignorado na suíte sem ambiente explícito, e executado
separadamente pelo runner com os serviços locais ativos. Isso não o homologa por
inferência nem encobre falhas: o runner precisa terminar com código 0.

## Riscos e critérios da próxima etapa

- Segredos em memória desbloqueada, XSS/extensões/malware e rollback integral sem
  âncora externa permanecem fora da proteção. Reempacotar não revoga envelopes
  antigos; custódia externa não pode ser provada por uma declaração.
- Falhas de quota, abort e ACK são injetadas; não são teste de queda física de energia,
  evicção real, corrupção de hardware ou garantia de persistência do navegador.
- Snapshots recifram todo o grafo. Limites de 8 MiB/1000 documentos e orçamento de
  IVs continuam; ainda faltam benchmark móvel e rotação operacional da DEK.
- O adaptador é experimental: callbacks precisam ser puras; sem coordenação podem
  exigir retry explícito. Não existe UI nem implementação de ciclo BFCache/pageshow.
- O transporte SDK exercita registros/recibos do protocolo legado permitido pelas
  regras, não uma implementação completa de gerações remotas, reset de conta ou
  restauração sincronizada entre dispositivos. Uma requisição já enviada pode ter
  sido aplicada remotamente antes do bloqueio; a resposta tardia não pode confirmar
  a fila/UI de uma nova sessão. Esses dois fatos não são equivalentes.
- `memoryLocalCache` evita cache persistente do SDK; não comprova eliminação de
  objetos já lidos da memória após logout. Os testes cruzados usam leitura de
  servidor, não homologam sigilo contra `getDocFromCache`, debugger ou referências
  JS retidas. Uma futura integração deverá isolar/encerrar clientes SDK por sessão
  e revalidar a entrega à UI; nem isso garante zeragem física da memória pelo GC.
- O armazenamento legível do app atual continua como antes. Este ensaio não resolve
  seus resíduos locais, não muda a política de logout e não autoriza apagá-los.

Próxima etapa proposta: **migração experimental somente de fixtures sintéticas**,
preservando uma origem imutável e usando destino cifrado novo. Exigir equivalência
do grafo inteiro, IDs, revisões, gerações, filas/tentativas, conflitos, tombstones e
recuperações; validar desbloqueio e exportação/restauração antes de ativar destino.
Interromper/reiniciar em cada fronteira; uma migração incompleta nunca deve parecer
conta vazia nem apagar a origem. Rollback mantém o leitor compatível e os dois lados,
compara revisões e não volta a uma cópia obsoleta após novas operações. Não limpar
fontes, caches ou envelopes automaticamente. Dados reais exigem autorização própria.

## Resultados finais — 2026-10-29

| Verificação | Resultado |
| --- | --- |
| Matriz de integração Node | 20 aprovados, zero falhas/ignorados |
| Etapas 1–4 + contratos reais + integração Node | 161 aprovados, zero falhas/ignorados |
| Nova integração Edge/Chrome | 50 aprovados, zero falhas/ignorados; IDB real, abas e reinício offline |
| Navegadores das Etapas 1–4 | Criptografia 100, backend 64 e Etapa 4 72 aprovados; zero falhas/ignorados |
| Harness independente Node/Edge/Chrome | 30 aprovados, código 0; zero violações/erros/ignorados; seis controles positivos preservados |
| Auth/Firestore Emulator da integração | 7 aprovados (grupo + seis subcenários), zero falhas/ignorados, código 0 |
| `npm.cmd run test:rules` | 26 aprovados, zero falhas/ignorados, código 0; regras reais em Emulator separado |
| `npm.cmd test` | 716 descobertos, 711 aprovados, zero falhas/cancelados, cinco ignorados, código 0 |
| Reexecução sequencial completa | Mesmos 716/711/0/5, sem intervenção, código 0 |
| `npm.cmd run check` + sintaxe dos nove arquivos JS novos | Aprovados, código 0 |
| `git diff --check` | Aprovado |

Os cinco ignorados na suíte geral são quatro grupos existentes condicionados
ao Emulator e o novo grupo de integração Emulator. Três grupos existentes foram
exercitados por `test:rules` e o novo grupo pelo runner da integração, sem ignorados.
O grupo existente `epoch emulator: protocol and server-enforced invariants`, do
protocolo alternativo de épocas, não foi executado com Emulator nesta etapa; não
se declara homologado esse protocolo ou sua integração com o cofre. Totais se sobrepõem: os 161
fazem parte da suíte principal, e os scripts de navegador também são descobertos
por `node --test`. Não somar essas linhas como testes exclusivos.

Na execução paralela inicial o Edge permaneceu ativo ao encerrar o perfil sintético
do teste existente de reinício do backend. Após confirmar PID, pai e caminho do
perfil temporário, foi encerrada somente aquela árvore de navegador; nenhum perfil
ou banco foi apagado e nenhum navegador pessoal foi encerrado. O harness prosseguiu
e a suíte terminou com código 0, mas houve intervenção operacional. Para não tratar
isso como homologação autônoma, repetiu-se integralmente:

```powershell
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
```

A repetição terminou sem intervenção, em aproximadamente oito minutos, com todas
as asserções e os mesmos totais. O limite de 180 segundos é por arquivo, reduzindo
a espera anteriormente ilimitada; não foi aumentado para esconder falhas. Nenhum
teste atingiu esse limite. A estabilidade do encerramento paralelo do navegador
continua uma limitação do ambiente de automação a acompanhar.

O Git confirma somente o checkpoint `2f22aa4` após a base informada. Todos os dez
arquivos desta integração permanecem novos e sem commit. `git diff HEAD` e
`git diff --cached` não apontam alterações dos arquivos rastreados; nenhuma
implementação principal, dependência ou configuração publicada foi modificada.

## Decisão

**Apto para iniciar uma futura migração experimental exclusivamente de dados
sintéticos**, em destino dedicado, seguindo os critérios de origem imutável,
equivalência integral, recuperação verificada e rollback descritos acima.

Não está homologada uma migração real, integração com o fluxo principal ou produção.
Antes disso permanecem necessários ciclo completo navegador/Auth/OAuth/Firestore,
gerações remotas e listeners, UX de desbloqueio/custódia, política de instâncias SDK
por sessão, BFCache/abas suspensas, benchmark móvel e plano de resíduos/recuperação.
Nenhuma migração foi implementada ou executada nesta etapa.
