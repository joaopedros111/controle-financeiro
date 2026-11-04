# Auditoria arquitetural do bootstrap e do ciclo de vida

Data: 2026-11-03. Branch confirmada: `security/cofre-local-etapa1`.
HEAD: `1e0f4a57d555e09b66a6bd58dd15cd119d053341`.

Esta etapa é exclusivamente documental. O código analisado é o da árvore local,
incluindo os pontos de injeção ainda não commitados, e não somente o HEAD.
Na abertura havia sete arquivos rastreados modificados e 21 arquivos novos.
Todos foram preservados. Nenhum aplicativo, browser, banco ou serviço Firebase
foi iniciado para esta análise. Não houve commit, staging, deploy ou limpeza.

## Conclusão e alcance da evidência

Recomenda-se **B como sequência de refatoração e C como coordenação mínima final**:
separar inicialização técnica, resolução de identidade, seleção de armazenamento,
desbloqueio e hidratação; um controlador pequeno deve ser o único responsável
pelas transições e pela autorização financeira. Não reimplementar regras de
operações, reconciliação, criptografia ou transações nesse controlador.

A alternativa A isoladamente tem menor diff inicial, mas deixa o carregamento
antecipado, os globais e os caminhos de leitura/escrita fora de uma fronteira única.
Não oferece a garantia necessária para um cofre bloqueado. Uma refatoração ampla
de todo o aplicativo também não é necessária: extrair fases e substituir pontos
de entrada de forma incremental é suficiente como direção arquitetural.

**Apto para iniciar uma implementação incremental de ciclo de vida, após definição
das políticas pendentes abaixo, inicialmente sem ativar o cofre. Ainda não apto
para habilitação do cofre no aplicativo principal ou migração real.** Este parecer
é análise estática, não homologação de comportamento novo.

Foram consultados os relatórios de pontos de integração e homologação integrada,
além do código dos módulos e dos testes existentes. As aprovações do relatório
integrado são evidência histórica: o harness usa UI própria e Auth Emulator;
não prova o DOM/bootstrap publicado com cofre, OAuth real, BFCache ou múltiplas
abas completas de Auth+UI. Nenhum resultado anterior é tratado como teste novo.

## Arquitetura atual e ordem efetiva

Referências de linha correspondem à árvore local desta auditoria.

| Ordem | Arquivo/função | Efeito e dependências |
| --- | --- | --- |
| 1 | `index.html:25`, `:611` | Script inicial lê somente preferência de tema em localStorage; HTML começa com `app-inicializando`; importa `app.js` como módulo. Outro script registra `sw.js` no evento load. |
| 2 | Imports `app.js:1–11` | Avaliam storage, persistência, serviço atômico, finance-core, preferências, atualização, localização, configuração Firebase, AutomaticFinanceSync e políticas/protocolo. Import estático da configuração não inicializa Auth. SDK é carregado depois por bundle dinâmico. |
| 3 | `storage.js:148`, `app.js:13–21` | Singleton de storage faz probe de localStorage na avaliação do módulo. Captura única das dependências: storage e cinco fábricas/leitores; registro posterior é proibido. |
| 4 | `app.js:493`, `carregarEstado():577`, `:614` | Cria proteção de fontes e carrega estado legado de localStorage: v3, v2, chave antiga e legado por mês. Normaliza resultado para o global `estado`, antes de Auth. Fontes inválidas/erros ativam proteção; o objeto normalizado pode ser vazio para apresentação, mas não autoriza sobrescrever a fonte protegida. |
| 5 | Bloco top-level `app.js:730–754` | Aguarda `openPersistence()`, cria serviço atômico, lê `estado:local`/`fila:local`, rejeita par parcial e inicializa `@local` (ou `local` no modo loopback). Carrega o par durável, atualiza `idbBase`, instala fechamento no pagehide. Falha define `idbBloqueado` e remove serviço. |
| 6 | `indexeddb-persistence.js:5–24` | Abre `controleFinanceiro:integridade:v1`, versão 1, store `documents`; cria schema somente no upgrade; erro/blocked rejeitam; versionchange fecha conexão. Não depende de Auth. |
| 7 | Handlers e `renderTudo`, `app.js:1448`, `:3859–3878` | Renderiza tema, preferências, período, receitas, despesas e resumo com estado já carregado. Camada visual de carregamento retém acesso durante conta; não impede que plaintext já esteja em memória/DOM. Sem Firebase configurado/controles, libera modo local. |
| 8 | Bloco ativo `app.js:4852–4961` | Carrega bundle por `loadFirebase`, cria cliente e AutomaticFinanceSync com banco/serviço já abertos. Chama initialize imediatamente; falhas têm retry de cinco segundos e online/focus podem retomar inicialização. |
| 9 | `criarFirebaseSync`, `firebase-sync-entry.js:55–91` | initializeApp; probe de persistência Auth; initializeAuth com browserLocalPersistence, indexedDBLocalPersistence e browserSessionPersistence; Google popup/redirect resolver. Firestore tenta cache persistente multiaba, depois memória/getFirestore. `ready()` aguarda authStateReady e redirect; erro de redirect de rede tem exceção específica offline. |
| 10 | `AutomaticFinanceSync.start/useAccount`, `:33–90` | Registra onUser e online/offline, aguarda ready e transição inicial. Cada evento fecha sessão anterior, renova sessionContext, chama onTransition, aguarda saves locais; conta autenticada valida legado, inicializa par do UID, chama onAccount e emite estado; agenda sincronização. |

```text
HTML/tema → módulos e captura de dependências
  → leitura financeira legada → estado global normalizado
  → abrir IndexedDB → inicializar @local → estado/base duráveis
  → handlers + renderTudo(false) → shell aguardando conta
  → import bundle → Auth + Firestore/cache → ready/onUser
     ├─ null → esperar idbPendente → carregar estado:@local → liberar UI local
     └─ UID → onTransition → esperar idbPendente → inicializar par UID
              → onAccount → emitState → liberar UI → snapshot/reconcile/envio/ACK
online/listeners/mudança local → novo ciclo do sincronizador
pagehide → fechar conexão + stop do sincronizador (handlers once)
pageshow.persisted → verificação de atualização; sem reabertura financeira dedicada
```

Há código de coordenação manual em `app.js:3937–4849`, protegido por
`LEGACY_MANUAL_SYNC_ENABLED = false`. Não faz parte do fluxo executado. Exemplos
como `migrationBackup` com localStorage direto nesse bloco não devem ser
confundidos com execução atual, nem reutilizados inadvertidamente na refatoração.
Comentários antigos de persistência “opt-in” não substituem a evidência do bloco
top-level que hoje abre o banco por padrão.

## Sessão, escrita, sincronização e recuperação existentes

`app.js:626` captura controller, sessão e sessionContext por identidade; isso
distingue inclusive conta A, B e nova sessão de A. `salvar():663` clona proposta
e base, captura UID/backend/geração e encadeia trabalho em `idbPendente`.
`waitLocal` no bootstrap automático drena essa cadeia até estabilizar.

Há uma distinção deliberada: em `salvar():675–690` uma gravação já aceita pode
persistir para seu proprietário anterior; o `isCurrent` passado a aplicarEdicao é
`() => true`. A guarda de sessão impede retorno à UI nova, mas não cancela aquele
commit antigo. Isso preserva a edição durante troca de conta no backend atual.
**Não é uma garantia de revogação criptográfica** e não deve ser copiado sem
política explícita para lock/logout. Já `persistirEstadoFinanceiro():756` verifica
sessão/chave/bloqueio e usa caminho próprio para restauração.

`ServicoFinanceiroAtomico.inicializar():26` cria estado/fila juntos somente quando
ambos ausentes; rejeita par parcial/inválido e conserva o par existente.
`aplicarEdicao():63` combina intenções contra estado durável e valida geração,
restoreJob e compatibilidade na transação. `alterarDocumentos` recebe callback
síncrona e Map completo; criptografia assíncrona não pode ser colocada dentro da
callback IDB. Adaptador cifrado deve manter prepare/commit, CAS e reservas duráveis.

`AutomaticFinanceSync` separa sessão por objeto, cancela timers/listeners no stop
e verifica current(s) em vários awaits. `cycle()` obtém snapshot confirmado,
reconcilia, envia fila, settings/histórico/resoluções e só confirma estado global
após equivalência e ausência de pendências (`:259–283`). Online retoma retries;
listeners confirmados agendam novo ciclo, não são ACK por si sós.

`enviarFila():149` marca attempted antes de enviar; `concluirOperacao():136`
exige acknowledged e verifica geração/ID antes de retirar item. Existe atalho de
equivalência com snapshot remoto confirmado para item ainda não tentado: não
equivale a receber um ACK de commit novo. O contrato futuro deve preservar e testar
essa distinção, em vez de prometer um ACK individual de rede em todo caminho.
Após `await commit`, enviarFila chama concluirOperacao sem nova checagem explícita
de isCurrent nesse ponto. Parar o controller não cancela transação remota já enviada
nem, por si só, garante impedir essa confirmação local tardia. A lease do adaptador
e o fence de commit são necessários no modo cifrado; cobertura específica obrigatória.

`onTransition` ativo (`app.js:4881`) limpa formulários/avisos, bloqueia persistência,
troca chave, normaliza estado vazio e renderiza sob carregamento. `onAccount(null)`
volta a `estado:@local`; `onState` instala dados e libera a UI. Esses callbacks não
têm estado explícito de cofre bloqueado. `normalizarEstado(null)` não pode ser o
substituto de bloqueio, chave incorreta, corrupção ou destino não localizado.

Restauração via FileReader captura sessão/chave e reconfere identidade antes de
aplicar (`app.js:3210–3292`). Conta autenticada usa importBackup; este renova sessão,
arquiva estado/fila e cria restoreJob com nova geração atomicamente. resumeRestore
publica e confirma job; reconcile preserva operações incompatíveis em recuperação.
Edições rejeitadas por geração/restauração e concorrência têm históricos próprios.
Exportar histórico (`app.js:4938`) lê recoveryKeys e só reconhece avisos incluídos.
Todos esses caminhos também precisam de autorização de desbloqueio, inclusive
downloads, callbacks FileReader e mensagens de erro após troca de sessão.

## Dependências e pontos oficiais aproveitáveis

| Fronteira | Contrato existente a preservar | Lacuna para o cofre |
| --- | --- | --- |
| Composição | configurar/capturarDependenciasAplicacao; openPersistence, createAtomicService, createAutomaticSync, loadFirebase, readLegacyMetadata | Captura congelada é de fábricas, não autorização para trocar singleton durante sessão. Factory deve criar recursos por contexto, sem override em URL/storage. |
| Persistência | ler, alterar, alterarDocumentos, fechar; par estado/fila por UID | Erros tipados locked/missing/invalid/quota/stale; lease por sessão, fence durável e leitura somente após unlock. |
| Financeiro | Serviço atômico, finance-core, financial-intents, sync-core | Reusar regras e formatos; não duplicar outbox/tombstones em controlador. |
| Auth/remoto | ready/onUser/login/logout; runtime SDK oficial; transporte de gerações | Distinguir prontidão Auth, permissão local e capacidade remota; política de cache/cliente por sessão. |
| Sincronizador | start/stop/localChanged/importBackup; waitLocal/storageBlocked; callbacks | Instanciar/iniciar somente com backend autorizado; coordenar sua inscrição Auth com a do lifecycle para evitar dois donos da transição. |
| UI | renderTudo, resetAccountForms, iniciar/concluirCarregamentoConta | Estado indisponível explícito; remover conteúdo financeiro e referências, não apenas ocultar por CSS. |
| Cofre experimental | Adaptador real e integrated-session no diretório experimental | Fonte de contratos/testes, não copiar seu coordenador integralmente para produção ou equiparar token sintético a OAuth. |

## Riscos e condições de tratamento

| Situação | Efeito de exigir Auth/unlock indiscriminadamente | Estratégia necessária |
| --- | --- | --- |
| Usuário sem cofre | Perderia modo local, uso sem Google e disponibilidade offline atuais | Backend legado permanece default, sem criação automática e sem exigir login/desbloqueio adicional. |
| Usuário com destino cifrado | Fallback legado pode exibir cópia antiga, tratar locked como saldo zero ou criar par novo | Seleção explícita e autoritativa do backend antes da leitura; locked/invalid nunca viram ausência. |
| Primeira abertura sem conexão | Auth remoto pode não concluir; UID não prova autorização de chave | Shell disponível e modo legado atual preservado; cofre sem identidade local verificável fica indisponível, sem criar/ler @local. |
| Reinício offline | Sessão Auth, chave e outbox têm ciclos distintos | Desbloqueio local condicionado à política de propriedade; permitir escrita local só se autorizado, remoto suspenso até validar Auth da mesma conta. Não exigir snapshot de rede para ler fila válida. |
| Logout durante envio | Servidor pode aplicar commit cujo ACK não chegou; stop não aborta rede | Revogar capacidades, esconder dados, manter IDs/attempted e confirmar só no contexto válido; reenvio idempotente após reabrir. |
| Edição aceita antes de lock | Revogação imediata pode cancelar save ainda só em memória | Distinguir intenção aceita de commit durável. Drenar com capacidade restrita ao dono antes do lock definitivo ou preservar recuperação durável; não anunciar logout/lock concluído se descarte for possível. Nunca reutilizar chave revogada. |
| A–B–A / mesmo UID | Comparar somente UID aceita callback da primeira sessão A | Token/época não reutilizável por abertura; cercar reads, writes, render, ACK, FileReader e finally. |
| Múltiplas abas | Memória/stop locais não revogam outra aba; versão antiga pode continuar gravando | Fence durável verificado no commit, CAS e Web Locks; mensagens são aviso, não autoridade. Definir escopo de lock local/global e política para aba antiga. |
| Corrupção, quota, IDB bloqueado | Retry/fallback pode inicializar vazio ou perder recuperação | Falhar fechado no backend selecionado, manter par e referências; nenhuma limpeza automática. |
| Falha Auth/senha | Retry de initialize pode recriar recursos ou desbloquear implicitamente | Separar erro técnico, Auth e unlock; senha errada não modifica backend nem ativa fallback; retries não concedem capacidade. |
| Conflitos/restore | Snapshot antigo pode reaplicar exclusão/edição ou esconder arquivo | Manter gerações, recoveryKeys/notices, tombstones e atomicidade; acesso à recuperação exige mesma autorização. |
| Cache Firestore | Default persiste finanças legíveis em cache fora do banco cifrado | Modo legado mantém default; modo cofre requer cliente com cache em memória e inventário de todos os stores. Cache preexistente não some por trocar a opção e não deve ser limpo automaticamente. |
| Heap/DOM/exportação | Bloquear banco não remove plaintext já entregue à UI ou SDK | Limpar DOM, formulários, referências e downloads pendentes por contexto. Não prometer zeroização física do heap. |
| pagehide/BFCache | Fecha IDB e para sync uma vez; pageshow só verifica atualização | Na retomada, invalidar autorização antiga, revalidar contexto e reabrir recursos antes da UI; não depender de await no evento de saída para salvar. |
| SW e atualização | Código antigo em cache pode usar contratos incompatíveis | Distribuição coerente de HTML/módulos/bundle/manifesto; bloquear writer incompatível, sem usar rollback de código para reabrir backend errado. |

O SW atual (`sw.js:5–38`, `:83–115`) precacheia módulos com release, serve navegação
do cache e só intercepta GET same-origin dentro do escopo. Não é o cache remoto
do Firestore. Sua ativação já contém remoção de caches de versões anteriores;
isso é comportamento existente observado, não ação executada ou recomendação de
limpeza nesta auditoria. Novos módulos futuros precisam de distribuição offline
coerente; nenhuma alteração de SW é necessária ou autorizada nesta etapa.

## Comparação das três alternativas

| Critério | A: barreira no bootstrap atual | B: bootstrap em fases | C: controlador de ciclo de vida |
| --- | --- | --- | --- |
| Complexidade inicial | Baixa visualmente, alta ao cercar cada acesso global | Média; extração ordenada e testes de equivalência | Média se restrito a recursos/transições; alta se virar framework |
| Compatibilidade | Conserva ordem, mas conserva leitura financeira precoce | Permite executar as mesmas fases no mesmo caminho legado | Pode preservar default se delegar às fases legadas |
| Risco principal | Bypass em handlers/exportação/sync e estado vazio durante lock | Coordenação espalhada entre callbacks e promises | Dois coordenadores Auth concorrentes ou rewrite excessivo |
| Testabilidade | Muitos testes isolados; difícil provar cobertura completa de barreira | Ordem/prontidão e falha por fase ficam observáveis | Máquina de estados, cancelamento, A–B–A e leases ficam verificáveis |
| Impacto no código | Diff inicial pequeno; guardas distribuídas crescem | Extrações locais primeiro | Novo módulo pequeno e wiring em app; reusa serviços existentes |
| Rollback | Fácil só antes de escrita cifrada; depois barreira removida expõe caminho antigo | Retomar fase legada para contas legadas; destino cifrado permanece protegido | Suspender modo cofre e preservar backend/recuperação; não voltar a cópia antiga |
| Adequação | Útil como proteção transitória, insuficiente sozinha | Melhor primeiro passo de menor impacto | Melhor autoridade final para o ciclo integrado |

Escolher C sem B deixaria um controlador em volta de efeitos já executados na
importação. Escolher B sem uma autoridade de transição deixaria Auth, bloqueio,
retry e UI disputando recursos. A combinação proposta limita o novo controlador
a identidade, capacidades, sequência e encerramento; os módulos financeiros
continuam sendo a única implementação das regras.

## Arquitetura recomendada e contratos mínimos propostos

Tudo nesta seção é proposta futura; nenhuma API foi criada nesta etapa.

```text
bootTechnical (shell, idioma/tema técnico, dependências; sem ler finanças cifradas)
  → resolveMode/proprietário (legado por default; destino cifrado explícito)
     ├─ legado → bootLegacyFinance → hidratar/editar → Auth/sync atuais
     └─ cofre → Auth resolvido OU autorização local offline definida
                → destino missing / locked / recovery-required / invalid
                → unlock + recuperação/custódia verificadas
                → abrir sessão financeira → hidratar UI → permitir comandos
                → iniciar sync somente com identidade remota compatível
transição → revogar novas intenções + retirar UI
          → finalizar/preservar intenções aceitas do dono → fence/lock/close
          → permitir nova sessão (sem reaproveitar sessão ou chave anterior)
```

1. **Estado discriminado de prontidão:** técnico, resolvendo identidade,
   legado-pronto, locked, missing, recovery-required, loading-finance,
   finance-ready, closing e error. Só finance-ready/legado-pronto possuem dados.
   Offline/pending/synced são atributos separados da autorização; não substituir
   locked por offline nem missing por coleção vazia.
2. **Contexto imutável por abertura:** modo, owner, epoch/lease, backend e geração
   observada. Geração financeira, sessão Auth e época de chave são conceitos
   distintos. `isCurrent(context)` é verificado em toda entrega e no commit;
   AbortSignal auxilia cancelamento, mas não substitui fence durável.
3. **Recursos por sessão:** abrir/carregar/encerrar usando o mesmo contrato
   financeiro atual; nenhum getter global que troque de DB durante uma operação.
   Fechamento idempotente distingue interrupção de rede, drenagem local e lock.
   Falha de fence impede declarar revogação global concluída e bloqueia nova sessão.
4. **Comandos financeiros:** capturam contexto e proposta no aceite; resolução
   indica commit durável ou erro/preservação explícita. Não oferecer sucesso só
   porque houve atualização otimista do DOM. Nenhuma promessa de salvar no unload.
5. **Auth e sync:** um dono da transição. Inicialmente preservar interface do
   AutomaticFinanceSync e cercar seus callbacks/adapter por lease; qualquer ajuste
   futuro em useAccount deve ser mínimo e testado. Não assinar Auth em dois locais
   capazes de hidratar ou encerrar finanças independentemente. Login popup permanece
   no gesto do usuário, sem await de bootstrap que perca essa capacidade.
6. **Seleção de modo:** mecanismo confiável e versionado de descoberta do backend
   é decisão prévia obrigatória. Configuração ausente só significa legado quando
   não há autoridade conhecida de destino cifrado; erro ao ler essa autoridade
   bloqueia, não significa ausência. Nunca autoativar por UID, URL, saldo vazio
   ou mera existência de segredo. Esta proposta não define migração.

Usuários sem cofre devem conservar @local, login opcional, offline, fontes legadas,
preferências e política Auth/cache atuais. No fluxo cofre não ler @local como
fallback nem importar automaticamente dados desse espaço. Logout do cofre deve
ficar no shell sem finanças; acesso ao modo local preexistente exige escolha
separada e clara, sem atribuir seus dados à conta que acabou de sair.

## Arquivos previstos e plano incremental

| Passo | Mudança futura delimitada | Evidência exigida antes do próximo passo |
| --- | --- | --- |
| 0 | Especificar autoria @local, seleção de modo, offline Auth, drenagem, lock entre abas e cache SDK | Decisões revisadas; nenhuma ativação/migração implícita |
| 1 | `app.js`: extrair bootstrap técnico/legado e callbacks de hidratação mantendo default e ordem; preservar fábricas de `storage.js` | Equivalência de estado/fila/UI antes e depois, sem cofre no grafo padrão e sem novas escritas |
| 2 | Novo módulo pequeno de lifecycle; composição por injeção explícita de teste; app delega transições | Estados discriminados, uma autoridade Auth, falhas e cancelamento determinísticos |
| 3 | `app.js`: leitura/render/edição/export/import e cleanup dependem do contexto autorizado; adaptar chamadas de salvar | Nenhuma exposição anterior; todas intenções aceitas contabilizadas na transição |
| 4 | Compor adaptador cifrado e cliente SDK em harness, reutilizando APIs existentes | IDB dedicado, Emulator, independência de recuperação, zero tráfego de produção |
| 5 | Se necessário, ajustes mínimos em `automatic-finance-sync.js`/`financial-atomic-service.js` para fechamento/ACK cercado; `firebase-sync-entry.js` para lifecycle explícito do cliente | Contratos antigos mantidos; testes de ACK depois de revoke e de mesmo UID, sem limpar fila |
| 6 | `index.html`/`style.css`/localização: estados indisponíveis e shell; futura revisão de empacotamento/SW/update-manager | DOM real, acessibilidade, BFCache, coerência offline e versões antigas homologados |

`storage.js` só precisaria de extensão se a composição atual não acomodar a
fábrica do lifecycle; não transformar o registro em backend global mutável.
`indexeddb-persistence.js` e `finance-core.js` não precisam mudar por princípio.
O novo caminho deve envolver o adaptador cifrado, sem alterar schema/banco legado.
Regras Firestore e protocolo financeiro não são parte dessa refatoração.
Etapas de UI/distribuição dependem de autorização futura própria; nada disso é
implementação aprovada ou executada por este relatório.

## Testes obrigatórios e aceitação

- Regressão default sem injeção e com falhas: local sem Google, Auth restaurado,
  offline, IDs/revisões/filas completos, fontes inválidas protegidas, preferências,
  import/export e geração; comparar resultados com a composição anterior.
- Ordem: nenhuma leitura financeira cifrada, criação de par, listener remoto ou
  render de registros antes de autorização; shell e login funcionam sem dados.
- Auth/unlock: ausência, erro, senha incorreta, custódia interrompida, recuperação,
  mesmo UID sem evento Auth, logout e A–B–A em cada await e callback/finally.
- Intenções/ACK: aceitar edição imediatamente antes de lock, quota durante drenagem,
  ACK atrasado/duplicado/perdido, erro permanente, reinício antes da confirmação;
  todo item termina durável, pendente ou em recuperação acessível, nunca descartado.
- Recuperação: corrupção/par parcial não cria vazio; restore interrompido, geração
  obsoleta, conflitos de edição/exclusão e tombstones; pacote atual em destino novo
  sem sobrescrever o atual, com todas as referências arquivadas e recuperáveis.
- Navegador real: DOM publicado com injeção sintética, Node/Edge/Chrome, SDK/Auth e
  Firestore Emulator, reinício completo offline/online, BFCache/pageshow,
  duas abas com troca de usuário/lock, versionchange e aba com bundle antigo.
- Armazenamento/rede: inspecionar todos os bancos/stores, cache Firebase/heartbeat,
  local/session/Cache Storage; nenhum dado financeiro/chave legível no destino
  cifrado nem cache persistente financeiro SDK novo no modo cofre. Zero acesso à
  produção e ao banco pessoal nos ensaios; não apagar stores para obter aprovação.
- Rodar testes existentes de Auth/app-sync/settings/restore/injeção, harness
  independente, suítes do cofre e Emulator, suíte npm e check; separar aprovados,
  ignorados e não executados. Auditoria independente do novo lifecycle ainda é
  necessária; testes das primitivas não substituem essa revisão.

Aceitação requer essas provas com recursos reais no mesmo navegador, sem perda
de compatibilidade default, sucesso falso ou fallback silencioso. Falha no lock
durável, recuperação impossível, fila inconsistente, leitura de A em B ou commit
com lease revogada impede ativação e exige relatório antes de continuar.

## Rollback e bloqueadores

Antes de qualquer escrita cifrada, rollback da refatoração pode restaurar a
composição legada para seus usuários, sem alteração de dados/schema. Testar ida
e volta com árvore de trabalho isolada e fixtures, sem descartar alterações locais.

Depois de escritas no destino, rollback de código **não** é rollback de dados.
Suspender novas escritas/sync de modo seguro, manter destino e recoveryKeys,
permitir somente recuperação autorizada em versão compatível; não reabrir origem
antiga como atual, não restaurar snapshot obsoleto e não limpar fila/cache.
Persistir attempted antes de envio continua necessário: logout não desfaz servidor.
Recuperação integral atual deve ser demonstrada antes de liberar novas escritas.
Qualquer fallback de distribuição precisa reconhecer a autoridade cifrada ou
recusar acesso, inclusive cliente antigo ainda controlado por SW anterior.

Impedem integração: políticas do passo 0 indefinidas; seleção ambígua do destino;
dependência de vazio para renderizar; impossibilidade de preservar intenção aceita;
ACK sem cerca de sessão; ausência de fence entre abas; plaintext persistente fora
do inventário; cliente antigo capaz de escrever no namespace errado; recuperação
não comprovada depois de novas revisões; necessidade de mudar protocolo/regras
sem revisão de escopo. Ficar offline ou errar senha é estado esperado, não motivo
para recriação, migração, exclusão de dados ou regressão automática ao legado.

## Verificação desta entrega documental

Executados: inspeção estática dos módulos citados, Git branch/HEAD/status,
inventário e hashes SHA-256 dos 28 arquivos locais preexistentes, conferência
final de preservação e `git diff --check`. Único arquivo acrescentado nesta etapa:
`docs/cofre-local-auditoria-bootstrap.md`.

Não executados nesta etapa: testes Node/browser/Emulator, suíte npm ou aplicativo.
Não há alteração funcional que exija nova homologação, e iniciar serviços ou
abrir dados não acrescentaria evidência à auditoria estática. A matriz acima é
requisito futuro, não afirmação de testes realizados agora.
