# Adaptadores reais e cofre — integração experimental isolada

## Checkpoint e escopo

Branch inicial `security/cofre-local-etapa1`, HEAD `2f22aa4`, com 29 arquivos
experimentais novos/modificados. Revisão de diff, inventário e busca de padrões
de credenciais sem ocorrências; dados/nomes/senhas fixos são fixtures sintéticas.
77 testes específicos de integração/migração/escritas/custódia aprovados e
`git diff --cached --check` aprovado. Checkpoint local autorizado:
`1e0f4a57d555e09b66a6bd58dd15cd119d053341`.
Nenhum outro commit, push, merge ou deploy autorizado nesta etapa.

## Incompatibilidades e propostas antes de modificar módulos principais

1. `AutomaticFinanceSync.useAccount()` chama `readSyncMetadata(globalThis.localStorage)`
   mesmo com `db` e `readLegacy` injetados. Na primeira execução Node, 17 cenários
   falharam porque não havia localStorage: o erro foi preservado, sem inicialização
   vazia. O harness Node fornecerá storage sintético apenas no processo de teste;
   browsers usarão perfis novos. Proposta futura: injetar leitor explícito de
   metadados legados, preservando distinção entre ausente, inválido e indisponível.
   Não alterar o módulo nesta etapa.
2. `criarFirebaseSync()` fixa Auth persistente e cache persistente antes de permitir
   conectar Emulators. Não é seguro chamá-la diretamente no experimento. Proposta
   futura: injetar runtime SDK/instâncias já configuradas, com modo explícito e sem
   fallback persistente. Harness deve interceptar somente a inicialização SDK na
   composição de teste, mantendo métodos/transações reais e endpoints loopback.
3. O adaptador experimental anterior fixa a geração anterior em `prepare()`.
   `importBackup()` real troca geração de estado/fila e arquiva a fila anterior.
   A ponte nova, somente experimental, deve selecionar a geração da fila resultante
   no mesmo commit autenticado. O controlador já suporta esse contrato; não exige
   modificar controlador ou serviço principal.
4. `cycle()` marca `automaticHistory.uploaded` depois de await sem conferir o ACK
   retornado por `saveAutomaticHistory`. O SDK atual retorna ACK após transação,
   mas o contrato de uma futura implementação poderia resolver sem confirmação.
   Proposta: exigir `acknowledged === true` na fronteira do cliente; no harness,
   aplicar guarda experimental sem editar o sincronizador principal. Testar retorno
   sem ACK mantendo histórico pendente e sem status sincronizado.

## Contratos efetivos revisados

| Módulo real | Contrato e ponto de integração |
| --- | --- |
| `indexeddb-persistence.js` | `ler`, `alterar`, `alterarDocumentos`; callbacks síncronas, Map completo, cópias structuredClone, sucesso só em oncomplete. O nome do banco é fixo: o teste injeta factory que remapeia a abertura para nome sintético, sem abrir o nome original. Importação legada nunca substitui existente; ausente, inválido e indisponível são diferentes. `confirmar` remove apenas ID conhecido; a ponte cifrada usa o serviço real, não reimplementa sua fila. |
| `financial-atomic-service.js` | Estado `{revisao,dados}` + fila `outbox/conflicts/attempted/remoteRevisions`; inclusão/edição por intenções, tombstones e coalescência respeitam operações tentadas. `enviarFila` marca tentativa durável antes da rede; `concluirOperacao` exige ACK, confere geração e remove só a operação correspondente. Arquivos `restore-recovery:*` e referências participam da transação. Rejeita edição obsoleta, restoreJob, incompatibilidade e sessão inválida. Settings exigem coordenação de publicação. |
| `automatic-finance-sync.js` | Ciclo completo de snapshot confirmado, reconciliação real, envio, nova leitura, settings, históricos, resoluções e confirmação global. `run/report` distinguem falhas transitórias/permanentes; retomada explícita não apaga fila. A política automática arquiva alternativas rejeitadas, em vez da política manual do escritor anterior. `importBackup` renova a identidade da sessão, arquiva estado/fila e cria restoreJob em geração nova; `resumeRestore` só limpa o job após publicação. Listeners exigem metadados confirmados. |
| `storage.js` | JSON válido/ausente/inválido/erro/indisponível; proteção de bytes corrompidos, fallback em memória identificado por persistido=false. `criarRecuperacaoFinanceira` só libera fontes protegidas após persistência confirmada. O harness injeta storage em memória, nunca consulta fontes reais. O singleton importado pode executar o probe próprio apenas no perfil sintético novo. |
| `finance-core.js` | `normalizarEstado` só constrói fixtures/backup explicitamente solicitado; `validarBackup` valida dados, `validarTotaisMonetarios` participa da reconciliação real. Receitas/despesas preservam IDs, flags e valores. Erro ou cofre bloqueado não é passado como null a normalização para produzir estado vazio. |

O formato de fila legítima candidata do bootstrap pode omitir geração. Isso não
autoriza persistir geração ambígua: a ponte exige fila/estado presentes e validados
e geração persistida igual à do snapshot. Nenhum caminho de leitura cria documentos.

## Arquitetura do harness

`experimental/finance-vault-real-adapter.js` expõe a interface transacional esperada
pelos serviços reais sobre o controlador/codec/backend cifrados reais. Copia entradas
e resultados, recusa callback async/Map incompleto, valida estado e proprietário,
prepara Web Crypto fora da transação e confirma tudo por CAS. Seleciona a geração
da fila resultante e atualiza catálogo/controle/manifesto no mesmo commit. Referências
antigas são preservadas; omissão no update não as exclui.

Cada autorização é uma identidade nova. Lock/close/unlock revogam a anterior.
Cada leitura/mutação captura também a sessão exata do sincronizador; revalida antes
e depois dos awaits e no predicado CAS executado dentro da transação. A serialização
local impede sobreposição de fences; Web Locks coordenam abas cooperantes. Épocas
e CAS permanecem obrigatórios. Falhas não causam retry indiscriminado: apenas
stale-revision tem até três reaplicações da callback síncrona original.

A fronteira do cliente conserva listeners síncronos e seus unsubscribes, verifica
proprietário/sessão e exige ACK verdadeiro de registros, settings e históricos.
Conflito de settings não equivale a sucesso e continua na política real. Esta guarda
é experimental; não altera `AutomaticFinanceSync` ou o SDK publicado.

Criação é explícita, com documentos sintéticos completos. Restauração de pacote
retorna o novo segredo ao chamador; o teste bloqueia e reabre por esse segredo,
comparando todos os documentos e confirmando DEK nova. Segredos só ficam no heap
do harness. A declaração e UX de custódia real continuam fora do ensaio.

### Fronteiras reais e simuladas

- Node: controlador, criptografia, serviço atômico, sincronizador, política, core e
  storage reais. IndexedDB é modelo transacional, não IDB real.
- Edge/Chrome: os mesmos cenários com IndexedDB/Web Crypto/Web Locks reais;
  `abrirPersistenciaFinanceira` também é executado sem mudança de código, com
  factory que remapeia exclusivamente o banco para `synthetic-real-contract-*`.
- Remoto da matriz: modelo de I/O do SDK/servidor explicitamente simulado;
  `withFinanceGenerations` real executa as regras de geração/restauração. Recibos
  legados usam o simulador anterior. Não se usa esse modelo para afirmar regras
  de servidor, OAuth ou segurança de produção.
- Emulator: bundle temporário importa a fábrica real `criarFirebaseSync`, todos os
  métodos/transações reais e `withFinanceGenerations`. Somente os três imports de
  inicialização SDK são substituídos na composição do teste. Wrappers inicializam
  Auth em memória e Firestore memoryLocalCache, conectam loopback imediatamente e
  recusam projeto diferente de `demo-vault-integration`. O SDK e as regras copiadas
  do repositório são reais; a aplicação e seus arquivos não são reescritos.

O runner recusa iniciar se as portas estiverem ocupadas, não encerra serviços
existentes e remove variáveis de credenciais apenas do ambiente do processo filho.
Emulators e logs ficam em diretório temporário novo, sem limpeza de bancos/caches.
Tokens JSON são aceitos exclusivamente pelo Auth Emulator. Não há Google OAuth real.
O teste Emulator usa modelo de armazenamento local; não se afirma um E2E único
browser + Auth + Firestore + IDB cifrado. O browser bloqueia rede fora de loopback.

## Cenários e critérios de aceitação

| Cenário | Evidência |
| --- | --- |
| Criar, editar, excluir | Serviço e controlador reais; valor editado exato e tombstone remoto |
| Estado/fila atômicos | Quota/abort com grafo anterior igual; commit único com catálogo e recuperações |
| ACK individual | Falta de ACK rejeitada; somente ID correspondente removido; duplicado inócuo |
| ACK atrasado | Operação nova e settings novos não são limpos pelo ACK antigo |
| ACK perdido | ID/tentativa persistem; reenvio com recibo único no simulador e SDK real |
| Reinício offline | Novo processo de Edge/Chrome encontra fila cifrada e mesma tentativa; desbloqueia offline |
| Edição/exclusão concorrentes | Política automática real preserva alternativa rejeitada em histórico durável |
| Operação rejeitada | permission-denied conserva intenção; run/report marca erro e retomada explícita confirma |
| Restauração interrompida | importBackup arquiva fila anterior; geração/fila mudam juntas; job só termina após publicar |
| A–B–A | Filas/cofres separados, leases antigos inválidos; mesma instância SDK Auth no Emulator |
| Logout durante sync | Resposta antiga não confirma sessão nova; guarda de sessão também no commit final |
| Múltiplas abas | Duas abas reais mantêm dois IDs/fila; lock numa aba revoga escrita na outra sem broadcast |
| Lock/unlock | Leases antigos recusados; senha errada preserva tudo; nova autorização reabre |
| Revisão obsoleta | Edição em base antiga rejeitada sem substituir valor confirmado |
| Falhas de storage/quota | Snapshot/documentos preservados integralmente e sem fallback vazio |
| Histórico sem ACK | Mantém uploaded pendente e impede status Sincronizado; retry com ACK funciona |
| Confidencialidade local | Inspeção dos seis stores sem nome/valor/ID financeiro, senha ou segredo legíveis |
| Recuperação após escritas | Pacote integral, DEK nova, novo segredo reapresentado e todos os documentos iguais |
| Storage legado inválido | Corrompido e leitura falha são erros distintos de ausente; fonte protegida mantida |

O teste de logout no último beforePut cancela a sessão durante a transação; o
predicado adicional impede durabilidade da escrita antiga. Comparações de grafo
detectam alterações de estado/fila/recuperações após falhas. Inspeção de storage
também exige localStorage/sessionStorage/Cache Storage vazios em perfis novos e
apenas bancos sintéticos. Metadados criptográficos continuam visíveis por projeto.

## Arquivos novos após o checkpoint

- `experimental/finance-vault-real-adapter.js`: ponte e guardas experimentais.
- `tests/finance-vault-real-adapters.test.js`: entrada Node da matriz compartilhada.
- `tests/fixtures/vault-real-scenarios.mjs`: cenários com os serviços reais.
- `tests/fixtures/vault-real-client.mjs`: modelo de I/O e wrapper de gerações real.
- `tests/fixtures/vault-real-browser.mjs`: exports do bundle independente e RPC.
- `scripts/run-vault-real-browser.mjs`: browsers, IDB dedicado, abas e reinício.
- `tests/fixtures/vault-real-emulator-factory.mjs`: injeção exclusiva de inicialização SDK.
- `tests/finance-vault-real-emulator.test.js`: fábrica/SDK/regras reais com cofre.
- `scripts/run-vault-real-emulator.mjs`: runner local restrito, derivado do anterior.
- `docs/cofre-local-adaptadores-reais.md`: contratos, achados e resultados.

Nenhum arquivo rastreado pelo checkpoint foi modificado para esta fase. Sem novas
dependências, inicialização do app, alterações de UI/SW/Auth/Firestore publicados,
migração real, exclusão de caches/bancos, staging ou commits posteriores.

## Validação reproduzível

```powershell
node --test tests/finance-vault-real-adapters.test.js
node scripts/run-vault-real-browser.mjs
node scripts/run-vault-real-emulator.mjs
node scripts/audit-vault-independent.mjs
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

O limite por arquivo e a execução sequencial seguem a limitação de encerramento
paralelo de navegadores já documentada. Não foi aumentado para esconder falhas.
Runners `run-*` não são iniciados implicitamente pelo descobridor `node --test`.

## Resultados e limitações

| Execução em 2026-11-03 | Aprovados | Falhas | Ignorados | Saída |
| --- | ---: | ---: | ---: | ---: |
| Validação específica antes do checkpoint | 77 | 0 | 0 | 0 |
| Matriz final de adaptadores Node | 22 | 0 | 0 | 0 |
| Matriz final Edge/Chrome | 52 | 0 | 0 | 0 |
| Fábrica Firebase real + SDK/Auth/Firestore Emulator | 5 | 0 | 0 | 0 |
| Harness independente Node/Edge/Chrome | 30 | 0 | 0 | 0 |
| Suíte geral sequencial, 795 descobertos | 789 | 0 | 6 | 0 |
| `npm.cmd run check` | Aprovado | — | — | 0 |
| Sintaxe adicional de 10 arquivos (inclui fixture de auditoria existente) | Aprovada | — | — | 0 |
| `git diff --check` e inspeção de espaços/conflitos nos novos arquivos | Aprovados | — | — | 0 |

A suíte completa terminou sem intervenção em 523,3 segundos, sem cancelamentos.
Ela contém 21 casos da nova matriz; a ampliação final de start/run/report para
22 casos foi validada separadamente no Node e nos dois browsers, depois da carga
desse arquivo pela suíte geral. Não se afirma uma segunda execução completa com
796 casos. Os resultados se sobrepõem e não devem ser somados como testes exclusivos.

Os 52 dos browsers são 22 cenários compartilhados e quatro provas adicionais por
motor: contrato IDB original em banco remapeado/inspeção do ambiente, escrita em
duas abas, fence de lock entre abas e reinício completo com fila/ACK perdido.
Na suíte geral passaram novamente criptografia browser 100/100, backend 64/64,
Etapa 4 72/72 e integração anterior 50/50; o pacote legado de exatamente
4.522.367 bytes foi restaurado. Nenhum timeout por arquivo foi atingido.

**Ignorados:** seis grupos condicionados ao ambiente na suíte geral: quatro
anteriores de regras/protocolo, a integração SDK/Emulator anterior e o novo grupo
SDK/Emulator. O novo grupo foi executado separadamente: grupo + quatro subcenários,
todos aprovados, sem skips. Os outros cinco não são declarados executados em Emulator
nesta retomada. Os runners próprios de regras/protocolo alternativo não foram rodados.

Evidências locais fora do Git: `%TEMP%/cf-adapter-checkpoint-tests.log`,
`cf-real-node-final.log`, `cf-real-browser-complete.log`,
`cf-real-emulator-final2.log`, `cf-real-audit.log`, `cf-real-full-suite.log` e
`cf-real-check.log`. Logs detalhados do Emulator em
`%TEMP%/cf-vault-real-emulator-mVEmju/execution.log`. O runner informa os nomes de
perfis novos retidos; na última prova Chrome usou
`%TEMP%/cf-real-adapters-chrome-FVYmVK`. Não se escrevem segredos ou DEKs abertas nos
logs/relatório; os bancos do Emulator contêm apenas dados sintéticos do ensaio.

O primeiro build Emulator falhou antes de qualquer teste por resolução de diretório fora do workspace;
`absWorkingDir` explícito corrigiu o runner. Repetições reais passaram, sem excluir
asserts ou marcar cenários com skip para esconder essa falha operacional.

Não executados: OAuth real, bootstrap/UI do aplicativo, BFCache/pageshow, dispositivos
móveis físicos, queda de energia/evicção real, benchmark KDF/snapshots, rotação
operacional de DEK, retirada de fontes legadas e produção. O harness independente
de auditoria é o das fundações Etapas 1–4; não constitui nova auditoria externa de
toda esta ponte. A matriz de falhas usa injeção e a memória não tem zeroização física
garantida. Rollback integral malicioso continua sem âncora externa.

O start/ready do SDK com Google/redirect não foi homologado; a conexão Emulator
usa login sintético e useAccount real. O start com callback Auth simulado e o fluxo
run/report são exercitados na matriz comum, sem alegar cobertura de OAuth.
Vários callbacks reais de reconciliação ajustam o objeto da sessão; o retry de CAS
não prova ausência de todo efeito lateral futuro. Callbacks novas devem continuar
síncronas e revisar efeitos antes de serem aceitas nessa ponte.

## Decisão sobre integração controlada no aplicativo

**Ainda não apto para iniciar a integração controlada no aplicativo principal.**
O harness comprova contratos reais importantes, inclusive gerações/restauração e
SDK no Emulator, mas os caminhos globais de metadados e a inicialização fixa do SDK
ainda exigem pontos de injeção nos módulos principais. A composição por bundler
é infraestrutura de teste, não solução de inicialização publicável.

Próxima proposta: revisão e autorização específicas para injetar o leitor de
metadados legados e o runtime SDK; tornar a guarda de ACK parte do contrato oficial;
coordenar Auth/desbloqueio/renderização por sessão e geração; testar o E2E único
browser+SDK+IDB cifrado, listeners, BFCache, custódia/recuperação e capacidade móvel.
Exigir novamente equivalência e recuperação depois de novas escritas, sem usar a
origem antiga como rollback. As fontes atuais e seus resíduos permanecem intactos.
