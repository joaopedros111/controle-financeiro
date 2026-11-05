# Escritas sintéticas após migração — homologação experimental

Base: branch `security/cofre-local-etapa1`, HEAD `2f22aa4`. Todos os arquivos
anteriores da integração e migração foram preservados. Sem commit/publicação.

## Achado durante implementação — WS-01

O primeiro ciclo Node executou 22 cenários: 21 aprovados e um reprovado em
`settings conflict supports reviewed local resolution without discarding the financial queue`.
O novo sincronizador bloqueava qualquer envio de settings enquanto existisse
conflito, inclusive a intenção explicitamente revisada para resolvê-lo. O ACK
necessário nunca chegava e a decisão continuava pendente.

Estado, conflito, decisão e fila permaneceram armazenados. Não houve perda de dados
ou modificação da origem. A homologação/ativação desta etapa foi suspensa até a
correção do bloqueio e repetição do teste original. A correção deve admitir somente
o ID da resolução local revisada, mantendo o bloqueio de conflitos não revisados;
não remover o conflito ou marcar decisão confirmada antes do ACK.

Na retomada de 2026-11-03, a correção local já presente foi revisada: o envio
aceita somente a intenção cujo ID corresponde à resolução local pendente de um
conflito revisado. Conflitos não revisados continuam bloqueados. A decisão só é
confirmada após ACK e revisão remota correspondente. O teste original passou e
foi ampliado para verificar conflito não revisado sem reenvio, fila financeira
preservada após falha de rede, decisão pendente durante ACK atrasado e confirmação
posterior com o mesmo ID. Nenhuma asserção anterior foi removida.

## Escopo e revisão inicial

Git confirmado antes de alterações: branch `security/cofre-local-etapa1`, HEAD
`2f22aa400bb11395925b5ccb94573c0375cb7a5b`. Já estavam modificados backend,
controlador, criptografia e helper de browser; os arquivos de integração, migração
e escritas já existiam como não rastreados. Foram preservados, sem reset/stash,
staging, commit, push, merge ou deploy.

Revisados os relatórios de integração/migração, Etapas 1–4, auditoria independente
e correções. Os achados históricos permanecem documentados. Esta etapa usa somente
projetos `demo-*`, UIDs `synthetic-*`, bancos sintéticos dedicados e perfis novos.
Não modifica aplicativo, IndexedDB financeiro atual, autenticação, Firestore de
produção, sincronização principal, interface ou Service Worker. Não limpa bancos
ou caches. O remoto de escrita é um simulador, não uma conta real.

## Arquitetura e autorização de escrita

`experimental/finance-vault-writes.js` compõe o copiador sintético, o adaptador de
persistência experimental, `ServicoFinanceiroAtomico` real e o controlador real.
Não existe importação desse módulo pelo aplicativo principal.

Para abrir uma autorização de escrita é obrigatório desbloquear com senha ou
segredo válido, verificar migração e equivalência integral, declarar custódia
externa, restaurar o snapshot em outro destino vazio com DEK nova e reabri-lo com
recuperação. A origem é relida e seu manifesto/hashes são conferidos. Um restoreJob
ou bloqueio de compatibilidade impede ativação; não é removido para contornar erro.
A prova é refeita a cada abertura, inclusive após novas operações no destino.

O documento cifrado `snapshot:<uid>:synthetic-writes-v1` vincula proprietário,
manifesto migrado, keyId, geração, revisão de catálogo, branchId, sequência e modo.
Cada mutação atualiza esse documento junto com estado/fila/arquivos de recuperação.
Revisões financeiras internas e IDs de operações seguem o serviço existente;
revisão global do catálogo e sequência experimental avançam sem reatribuir IDs.
O manifesto migrado e a autoridade não são mutáveis por callbacks financeiros.

Web Locks serializam escritores cooperantes. O CAS e a época durável são conferidos
no commit e continuam obrigatórios. Sem coordenação, a rejeição segura pode exigir
nova tentativa explícita da intenção; não há retry indiscriminado de cancelamento.
As callbacks são síncronas, sem efeitos externos, com cópias de entradas/saídas.
Erros de leitura, bloqueio ou corrupção nunca inicializam conta vazia.

Inclusão/edição usam intenções financeiras, com coalescência somente quando seguro.
Exclusão cria operação tombstone. Categorias, orçamento e preferências funcionais
usam intenção de settings durável, com ID/baseRevision persistidos antes do envio.
ACK antigo não limpa um valor novo. Operações tentadas sem confirmação conservam
seus IDs para reenvio. Conflitos retêm ambas as versões; resolução arquiva estado,
fila e decisão em documento referenciado antes de alterar a intenção. Tombstone
remoto impede ressurreição automática. Nenhuma escrita normal altera a origem.

O simulador `vault-write-remote.mjs` mantém contas, registros, settings e recibos
por ID, aplica comparação de revisão, rejeita payload divergente para o mesmo ID e
permite falha antes do envio ou perda de ACK após aplicação. Node usa transporte
em memória; o teste de reinício usa servidor HTTP loopback que retém os recibos
enquanto os processos de navegador são encerrados/reabertos. Outras origens são
bloqueadas. Não se afirma que esse simulador seja o protocolo remoto de produção.

## Recuperação depois de novas escritas e rollback

Origem antiga não é rollback suficiente. `rollback()` recusa voltar à origem após
avanço da sequência. Checkpoint anterior às novas revisões é rejeitado antes de
criar snapshot no destino de recuperação.

`recover()` abre o destino atual com recuperação, preserva todos os documentos e
grava nele um fence `recovery-fenced`, com identidade do novo destino. Escritores
anteriores falham no CAS/política. Só então exporta o grafo atual para destino
novo, com DEK nova. O novo ramo registra ancestral, digest, sequência e identidade
da recuperação, entra em `pending-recovery`, comprova equivalência, restaura e
reabre uma cópia independente, e só então fica `writable`. O ramo anterior continua
conservado e sem escrita; não existe dual-write.

Interrupção mantém o fence e permite retomar somente para o destino designado.
Destino já restaurado é autenticado e comparado; um ramo já finalizado é reconhecido
sem sobrescrevê-lo, mesmo se recebeu novas escritas. Destino alheio/existente é
recusado. Operações pendentes, tentativas, gerações, conflitos, decisões, históricos
e referências são copiados integralmente, não reconstruídos de uma fila vazia.

Para não perder recuperabilidade quando o ACK do primeiro commit da restauração
se perde, a opção explícita `retainCustodiedRecoverySecret` encapsula a DEK nova
com o segredo já custodiado. Gera salt e IV novos, autentica o novo contexto e não
reutiliza a DEK antiga. O padrão da API anterior continua gerando segredo novo.
Esse mecanismo não revoga o segredo antigo nem afirma provar custódia externa.

Limite: o destino atual precisa continuar legível ou existir pacote externo atual
completo e verificado. Segredo sozinho não recupera banco eliminado. Esta API não
oferece failover automático de banco perdido ou escolha segura de pacote antigo
sem âncora externa. O fence conservador pode exigir retomar a recuperação para
recuperar disponibilidade; não existe cancelamento que reative dois ramos.

## Matriz e evidências de preservação

| Cenário solicitado | Verificação |
| --- | --- |
| Inclusão offline e sincronização | Receita/despesa e fila no mesmo snapshot; um recibo/aplicação remota |
| Edição concorrente | Versões local/remota preservadas; resolução local arquivada e confirmada por ACK |
| Exclusão concorrente | Tombstone local rebaseado; tombstone remoto impede ressurreição |
| ACK atrasado | Edição nova preservada; ACK antigo não confirma sessão desbloqueada novamente |
| ACK duplicado | Mesmo ID retorna recibo; nenhum lançamento adicional |
| Falha de rede | Tentativa e operação intactas; retry com identidade exata |
| Reinício antes da confirmação | Fechamento/reabertura; processo completo offline em Edge/Chrome |
| Conflito entre versões | Bloqueio por entidade e decisão explícita; configurações também cobertas |
| Rejeição do servidor | `permission-denied` mantém fila e intenção; sem falso sucesso |
| A–B–A | Filas e remotos separados; leases anteriores revogados |
| Bloqueio durante operação | ACK tardio rejeitado; duas abas verificam época durável sem broadcast |
| Duas abas simultâneas | Dois IDs novos presentes e duas operações; edição obsoleta rejeitada |
| Recuperação interrompida | Fence persiste; mesmo destino retomado, inclusive ACK de import perdido |
| Retomada sem duplicação/perda | Mesmo ID reenviado; recuperação preserva resolução pendente e referências |

Quota/abort comparam snapshots anteriores integralmente e depois permitem retry.
Inspeção dos seis stores procura nome/valor/ID financeiro, senha e segredo de
recuperação fora do ciphertext. O ledger comprova pares fingerprint/IV únicos e
reservas duráveis. Os testes anteriores de reserva abandonada e época no commit
permanecem na regressão. Metadados como UID, IDs de documentos, geração, revisão,
tamanhos e envelopes permanecem visíveis conforme o modelo de ameaças.
O browser verifica também nomes exclusivos dos bancos sintéticos, localStorage,
sessionStorage e Cache Storage vazios. Essas verificações usam perfis novos e
não representam limpeza ou proteção dos resíduos do aplicativo existente.

## Arquivos da fase de escritas

Arquivos já presentes na retomada e revisados/preservados:

- `experimental/finance-vault-writes.js`: autorização, escrita, settings,
  sincronização simulada, conflitos, checkpoints e recuperação com fence.
- `tests/finance-vault-writes.test.js`, `tests/finance-vault-write-custody.test.js`:
  entrada Node e contrato criptográfico de continuidade do segredo custodiado.
- `tests/fixtures/vault-write-scenarios.mjs`: matriz comum Node/Edge/Chrome;
  ampliado nesta retomada para evidências de WS-01 antes/depois do ACK.
- `tests/fixtures/vault-write-remote.mjs`, `tests/fixtures/vault-write-browser.mjs`:
  remoto isolado e entrada browser/HTTP.
- `scripts/run-vault-writes-browser.mjs`: IDB real, inspeção, duas abas e reinício.
- `finance-vault-crypto.js`, `finance-vault-backend.js`, `finance-vault-controller.js`:
  extensão explícita de wrapping/import com segredo previamente custodiado.
- `experimental/finance-vault-persistence.js`: política experimental de snapshot.
- `docs/cofre-local-escritas-experimentais.md`: este relatório consolidado.

O helper `tests/fixtures/vault-browser-store.mjs` e todos os arquivos locais de
integração/migração anteriores foram mantidos. Nenhuma dependência foi adicionada.

## Execução reproduzível

```powershell
node --test tests/finance-vault-writes.test.js tests/finance-vault-write-custody.test.js
node scripts/run-vault-writes-browser.mjs
node scripts/audit-vault-independent.mjs
node scripts/run-vault-integration-emulator.mjs
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

A suíte geral usa execução sequencial e limite de 180 segundos por arquivo,
conforme a limitação operacional de encerramento paralelo já documentada na
integração. O runner novo de escritas é executado separadamente; não inicializa
servidor automaticamente na descoberta da suíte. Totais se sobrepõem.

## Resultados de 2026-11-03

| Verificação | Aprovados | Falhas | Ignorados | Saída |
| --- | ---: | ---: | ---: | ---: |
| Escritas/reconciliação e custódia Node (repetidos após reforço de WS-01) | 27 | 0 | 0 | 0 |
| Escritas Edge/Chrome (repetidas após reforço de WS-01) | 60 | 0 | 0 | 0 |
| Harness independente Node/Edge/Chrome | 30 | 0 | 0 | 0 |
| Regressão Auth/Firestore Emulator | 7 | 0 | 0 | 0 |
| `npm.cmd test` sequencial, 773 descobertos | 768 | 0 | 5 | 0 |
| `npm.cmd run check` | Aprovado | — | — | 0 |
| Sintaxe adicional (11 arquivos experimentais/fixtures/runner) | Aprovada | — | — | 0 |
| `git diff --check` | Aprovado | — | — | 0 |

Os 60 casos dos browsers são 26 cenários compartilhados, uma inspeção do ambiente
e três verificações extras por motor: duas abas gravando, fence durável e reinício
completo com ACK perdido. Duas execuções completas passaram; a segunda contém o
reforço de WS-01. Node também foi repetido após esse reforço, com 27/27.
O harness independente mantém seis controles positivos e zero violações/erros.

A suíte geral terminou sem intervenção em 514,8 segundos, sem cancelamentos.
Inclui a matriz Node final de escritas, a migração Node e regressões de
criptografia/codec/backend/catálogo/recuperação. Os runners anteriores também
passaram: criptografia Edge/Chrome 100/100, backend 64/64, Etapa 4 72/72 e
integração 50/50. Essas contagens fazem parte da mesma execução; não somar como
testes exclusivos. O pacote legado de exatamente 4.522.367 bytes foi restaurado.

**Ignorados:** cinco grupos condicionados a Emulator/configuração própria na
suíte geral: quatro anteriores e a integração Auth/Firestore. A integração foi
executada separadamente com sete aprovações, sem skips.

**Não executados nesta retomada:** runners separados das regras/protocolo
alternativo de épocas, runner de migração browser, E2E completo do aplicativo,
OAuth real, produção, dados reais, dispositivos móveis físicos, queda de energia
e evicção real. A matriz nova de escritas usa o simulador explicitamente autorizado;
não há implementação Emulator equivalente dos seus settings/conflitos/recuperação.

Logs locais de reprodução, fora do repositório: suíte geral em
`%TEMP%/cf-writes-npm-test-20261103.log`; Emulator em
`%TEMP%/cf-vault-integration-emulator-SOVB3M/execution.log`. Perfis da repetição:
`%TEMP%/cf-vault-writes-msedge-jNhM4Z` e
`%TEMP%/cf-vault-writes-chrome-CSEWUE`, retidos sem limpeza. Nenhum segredo foi
incluído neste relatório ou nos logs do runner.

## Limitações e riscos para a próxima etapa

O Emulator exercita a integração SDK/Auth/regras anterior (regressão), não o novo
protocolo simulado de settings/decisões/ramificação. Não se declara homologado o
fluxo completo navegador + Google OAuth + SDK remoto + recuperação após migração.
A–B–A da nova matriz usa managers separados; a mesma instância Auth é coberta na
regressão Emulator. Node usa modelo transacional, browsers usam IDB real.

Permanecem XSS/extensões/malware, objetos abertos em memória, rollback integral sem
âncora externa, exclusão/evicção, custódia perdida, snapshots completos custosos,
limites de capacidade/IVs, rotação operacional, benchmark móvel e crescimento dos
destinos de prova. Quota/abort/interrupção são injetados, sem queda física de
energia. BFCache/UI, desligamento de clientes SDK por sessão, cache legado,
gerações/reset remotos e múltiplos dispositivos continuam exigindo ensaios próprios.
Não há autorização para retirar a origem ou usar dados reais.

## Decisão de homologação

**Apto para iniciar uma futura integração experimental com adaptadores reais,
somente em harness separado, dados sintéticos e serviços remotos isolados.** A fase
de escritas/reconciliação sintéticas está homologada no perfil documentado; WS-01
foi resolvido e seu teste original e evidências adicionais passaram em Node,
Edge e Chrome. Nenhum cenário executado demonstrou perda, fila inconsistente ou
recuperação impossível.

A próxima etapa deve testar o protocolo simulado contra os contratos reais,
incluindo settings/decisões, download/listeners, gerações/reset remotos, clientes
SDK por sessão e recuperação entre dispositivos; não basta trocar o transporte.
Exigir equivalência e recuperação antes de qualquer ativação desse novo harness.
Esta decisão não homologa integração no aplicativo principal, migração real,
remoção de fontes legadas, sincronização de produção ou publicação.

HEAD e branch preservados, sem staging/commit. O diff rastreado mantém somente
os quatro arquivos já modificados no início. A retomada reforçou a fixture de
WS-01, acrescentou comentário explicativo no escritor e consolidou este relatório.
Os arquivos de integração/migração e demais alterações locais foram preservados.
