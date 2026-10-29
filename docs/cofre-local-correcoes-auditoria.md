# Correções da auditoria independente — Etapas 1 a 4

Base: `security/cofre-local-etapa1`, HEAD `c8340ca`. Alterações anteriores e
harnesses preservados; nenhum componente integrado ao aplicativo e nenhum dado
real acessado ou removido. Este documento complementa o relatório histórico,
sem apagar seus achados.

## 1. Isolamento de sessões

Causa: `guard`, `verifiedRead` e `status` invalidavam o controlador global após
awaits, mesmo quando a sessão capturada já era antiga. A limpeza agora exige
identidade do objeto da sessão e de sua geração local. `status` captura a geração
antes da primeira leitura e rejeita respostas tardias. Preparações internas de
troca de credenciais exigem a sessão original, além dos fences duráveis e CAS.
Uma operação antiga pode falhar, mas não pode bloquear a sessão nova.

## 2. Custódia e recuperação

Causa: `renewRecovery()` substituía o único envelope antes de devolver o segredo.
Uma confirmação de commit perdida podia deixar o usuário sem o segredo ativo.

O catálogo versão 2 adiciona `recoveryPending` e `recoveryPrevious`, autenticados
pelo manifesto cifrado. Catálogos versão 1 continuam legíveis; somente escritas
explicitamente solicitadas usam a versão 2. Não há migração automática de bancos.

Protocolo:

1. `renewRecovery()` prepara `{id,envelope}`, preserva a recuperação ativa e
   retorna `{operationId,recoverySecret,state:'prepared'}` após persistência.
2. O chamador entrega o segredo e solicita armazenamento independente. Gerar,
   exibir ou iniciar download não autoriza ativação.
3. `confirmRecoveryCustody(id,{recoverySecret,externalCustodyConfirmed:true})`
   exige reapresentação e autentica o snapshot inteiro com o envelope pendente.
   Retorna token opaco ligado à sessão, revisão e preparação.
4. `activateRecovery(token)` consome o token e ativa atomicamente o envelope,
   preservando o anterior em `recoveryPrevious`.

Bloqueio, desbloqueio ou mudança de revisão invalidam o token. Antes da ativação,
interrupções mantêm o segredo anterior. Depois do commit, ambos funcionam mesmo
quando o reconhecimento se perde. Após reinício é possível reapresentar o segredo
pendente e confirmar novamente. `cancelRecoveryPreparation(id)` cancela somente
a preparação inativa quando o segredo foi perdido; não altera documentos ou filas.

São permitidos oito envelopes anteriores. Atingir o limite recusa novas
preparações; não existe aposentadoria automática. Rotação da DEK e aposentadoria
exigem projeto separado: reempacotar não revoga cópias externas de envelopes antigos.

**Reapresentação prova posse e funcionamento, não custódia externa durável.**
A confirmação é uma declaração do usuário. A segurança contra interrupções não
depende dessa declaração porque o caminho anterior é preservado. Perder a senha e
todos os segredos continua irrecuperável. UX e política de aposentadoria permanecem
pendentes de homologação, sem descarte automático nesta etapa.

## 3. Capacidade e restauração

Causa: atualização validava cada documento, enquanto restauração aplicava o limite
de 100 mil nós ao grafo inteiro. Históricos individualmente válidos falhavam juntos.
`finance-vault-limits.js` centraliza cópia por documento e perfil agregado:

- Até 1.000 documentos e IDs de documento de até 512 unidades UTF-16.
- Codec: 100 mil nós, profundidade 64 e 16 MiB por documento.
- Soma dos documentos codificados: 8 MiB.
- Snapshot cifrado serializado: 28 MiB; pacote externo: 32 MiB.

Criação, atualização, exportação e importação usam o mesmo orçamento agregado.
Atualizações validam o resultado completo da mescla. A margem comporta manifesto,
envelopes, autenticação e reconstrução; IDs, contexto, referências e envelopes têm
quantidades/tamanhos limitados. Falhas não confirmam transações nem truncam dados.
Snapshots antigos fora do perfil não são interpretados como vazios: precisam de
procedimento explícito de dimensionamento/recuperação antes de nova escrita/exportação.

O A06 original mantém cinco históricos de 4.000 receitas; o catálogo 2 acrescenta
metadados e seu pacote passa a 4.522.472 bytes. Um teste adicional gera o formato
legado 1 e verifica **exatamente 4.522.367 bytes**, restauração e equivalência integral.

## 4. Referências e categorias

Causa: busca recursiva interpretava qualquer `recoveryKeys` como referência,
inclusive nomes de categorias em orçamentos. Agora somente posições de esquema
são referências: raiz da fila, raiz de documentos de recuperação/conflito/snapshot
e sua fila arquivada (`queue.recoveryKeys`). O documento financeiro e corpos livres
não são percorridos para inferir referências. Proprietário e existência continuam
obrigatórios nas posições internas. Novos esquemas exigem mapeamento explícito.

## 5. Codec e Timestamp

Causa: após `adapter.decode`, propriedades validadas pelo construtor eram
sobrescritas pela segunda representação adulterada. `instanceof` não validava o
objeto final. Campos produzidos pelo adaptador agora devem coincidir integralmente
com os serializados e não são sobrescritos. Extras continuam preservados, sem
sombrear propriedades herdadas. Adaptadores podem fornecer `validate` final.

Os tags `custom:timestamp:v1` e `custom:firestore-timestamp:v1` declaram segundos
inteiros em [-62135596800,253402300799] e nanos inteiros em [0,999999999], na entrada
e no objeto final. NaN, infinitos, frações e representações contraditórias são
recusados. Novos adaptadores são código confiável e exigem contratos próprios.

## Validação e limites remanescentes

Os resultados finais são registrados abaixo após execução. Fixtures são sintéticas,
navegadores usam perfis de teste e não há inicialização de Firebase de produção.
As asserções originais do harness independente foram preservadas; seu servidor
apenas passou a disponibilizar o módulo compartilhado de limites.

A integração experimental deve permanecer isolada e com dados sintéticos. Não há
autorização para migração ou publicação. Permanecem os limites de chaves já em
memória, rollback integral sem âncora externa, disponibilidade sujeita ao navegador,
resíduos legados e XSS/dispositivo comprometido descritos nas Etapas 1–4.

### Resultados executados

- Harness independente, Node/Edge/Chrome: **30/30**, código 0, zero violações,
  zero erros inesperados e zero ignorados. São as 24 antigas violações corrigidas
  e os seis controles positivos preservados, sem remoção de asserções.
- `npm.cmd test`: **694 testes**, 690 aprovados, zero falhas, quatro ignorados
  (testes de regras dependentes do Firebase Emulator). Não houve uso de produção.
- Etapas 1–4 + fixtures reais + regressão legada: **141/141**, zero ignorados.
- Edge/Chrome: criptografia **100/100**, backend **64/64**, Etapa 4 **72/72**;
  zero falhas ou ignorados. Incluem IndexedDB real, abas, reinício, IVs duráveis,
  falhas transacionais e desbloqueio offline.
- `npm.cmd run check` e `git diff --check`: aprovados.
- O teste de versão desconhecida passou de 2 para 999 porque a versão 2 agora é
  suportada. O cenário continua exigindo corrupção e proibição de criar estado vazio.

### Arquivos desta correção

Módulos: `finance-vault-controller.js`, `finance-vault-catalog.js`,
`finance-vault-codec.js`, `finance-vault-backend.js`, `finance-vault-recovery.js` e
novo `finance-vault-limits.js`. Testes: `tests/fixtures/vault-stage4-scenarios.mjs`,
`tests/vault-real-formats-audit.test.js` e novo `tests/vault-fixes.test.js`.
Servidores de teste: `scripts/audit-vault-independent.mjs`,
`scripts/test-vault-backend-browser.mjs`, `scripts/test-vault-stage4-browser.mjs`.
Documentação: este relatório. Os demais arquivos locais anteriores foram preservados.

### Decisão

**Apto para integração experimental isolada com dados sintéticos**, dentro deste
perfil de capacidade e protocolo de recuperação. Isso não homologa uso real nem
autoriza integrar o fluxo principal. Próximos passos: revisão do protocolo e dos
adaptadores, homologação de UX de custódia, testes sintéticos de ciclo Auth/offline
em adaptador separado, benchmark móvel e somente então propor migração opt-in.
