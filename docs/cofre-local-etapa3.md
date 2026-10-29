# Cofre local — Etapa 3: backend cifrado isolado

Implementação local na branch `security/cofre-local-etapa1`, mantendo as Etapas 1
e 2. Não há importação pelo aplicativo, migração, mudança de Auth/Firestore,
sincronização, UI, Service Worker ou banco financeiro atual. Os ensaios usam
exclusivamente fixtures sintéticas e perfis novos do navegador.

## Revisão dos contratos e decisões

Os envelopes v1 e o AAD da Etapa 2 permanecem compatíveis. A criptografia assíncrona
não cabe nas callbacks síncronas do IDB atual. Por isso o backend é separado e
prepara os envelopes fora da transação financeira; uma transação curta confirma
o snapshot inteiro por comparação de versão e conteúdo anterior.

Foi acrescentada uma extensão OPCIONAL a `createVaultCrypto`: `reserveIV`.
Sem ela, os consumidores/testes da Etapa 2 mantêm a proteção em memória e NÃO
ganham garantias duráveis. O backend da Etapa 3 sempre fornece esse callback.

O contrato não necessita de parâmetros AES/KDF novos. Para identificar a chave de
cifragem efetiva, usa SHA-256 dos seus 32 bytes como identificador público de
reserva, em vez de confiar em `keyId`/UID. Trata-se de identificador de chave
aleatória, não de hash simples da senha. A KEK continua sendo derivada por
PBKDF2/HKDF com os parâmetros originais. Com callback durável, deriveBits(256)
permite calcular o identificador e importar KEK não exportável; os bytes temporários
são limpos em finally. O formato/AAD e resultado criptográfico não mudam.

## Banco dedicado e formato físico

`finance-vault-store.js` abre somente `controleFinanceiro:cofre-isolado:v1`.
O único override permitido é sufixo `:synthetic-...` para QA. Nomes do banco atual
e do SDK Firebase são rejeitados. Abrir uma conexão não cria um estado financeiro
vazio. Não existe API de clear/delete/migração ou operação financeira remota.

Stores:

| Store | Chave | Valor |
| --- | --- | --- |
| snapshots | JSON de projeto, UID, vaultId, keyId | versão física, revisão, geração, manifesto cifrado e lista de envelopes cifrados |
| heads | mesmo namespace | versão, última revisão e geração confirmadas |
| nonces | par [fingerprint da chave real, IV] | versão e identificadores da reserva |
| nonceKeys | fingerprint | versão e contador de reservas, limite de 1.000.000 |

O índice `nonces.byKey` permite conferir o contador contra a quantidade efetiva
de reservas antes de uma nova reserva. Valores financeiros, filas, conflitos,
snapshots de recuperação e referências ficam dentro dos documentos cifrados.
O manifesto, também cifrado, contém IDs ordenados, referências, revisão e geração.
IVs, fingerprints, tamanhos, namespace, IDs dos envelopes, revisões e gerações são
metadados públicos; não prometemos ocultá-los.

`heads` é confirmado junto com `snapshots`. Detecta ausência parcial ou substituição
isolada do snapshot por uma revisão antiga. Não é uma âncora externa: um atacante
que substitua TODO o banco por uma cópia antiga consistente pode reproduzir heads,
snapshots e reservas. AES-GCM/CAS não resolvem rollback integral offline.

Envelopes de senha e recuperação são recebidos/retornados pelo backend como
metadados cifrados em memória, sob responsabilidade do chamador. Esta etapa não
implementa catálogo persistente/descoberta desses envelopes nem UX de recuperação.
Após reinício, os ensaios fornecem o envelope preservado no processo de teste.
Guardar só os documentos, sem envelope correspondente ou pacote externo completo,
não permite recuperar a DEK. Catálogo e pacote de recuperação são critérios da
próxima etapa ANTES de ativar o backend com dados de usuários.

## API isolada e estados

```js
const store = await openVaultStore();
const backend = createVaultBackend({ store, context });
await backend.createKey(); // explícito; só permite namespace inexistente
const envelope = await backend.protectWithPassword(password);
const recovery = await backend.protectWithRecovery(); // segredo só em memória
await backend.initialize({ generation, documents: syntheticDocuments });
const previous = await backend.read();
const token = await backend.prepare({ expectedRevision: previous.revision,
  generation, updates: syntheticUpdates });
await backend.commit(token);
backend.lock();
await backend.unlockWithPassword(envelope, password);
// alternativa: unlockWithRecovery(recovery.envelope, recovery.recoverySecret)
await backend.close();
```

`context` vincula projeto, UID, cofre e keyId. Geração e revisão entram no AAD de
TODOS os documentos e do manifesto (`documentId: @manifest`). A revisão do snapshot
é global; revisões/base-revisions existentes dentro dos payloads são preservadas.

O backend aceita somente árvores JSON sem perda: rejeita Date, tipos SDK, undefined,
NaN/Infinity, -0, BigInt, ciclos, arrays esparsos, accessors e Unicode inválido.
Esse codec serve às fixtures desta etapa. Não substitui o futuro codec financeiro
nem autoriza serializar silenciosamente objetos reais da aplicação.
Limites atuais: 1000 documentos por snapshot, 16 MiB por documento na camada
criptográfica. Performance/conjunto total ainda não foram homologados em celulares.

Estado/fila são obrigatórios e a geração da fila/restoreJob deve corresponder à do
snapshot. IDs permitidos pertencem ao UID e são `estado:`, `fila:`,
`restore-recovery:`, `conflicts:` e `snapshot:`. Todos os `recoveryKeys`, inclusive
transitivos, devem apontar para documentos presentes e do mesmo proprietário.
Atualizações fazem merge de documentos, não exclusão: omitir recuperação/histórico
não remove sua cópia. Conteúdo de fila é do chamador; os ensaios comprovam preservação
exata, sem executar reenvio de operações ou qualquer regra de negócio financeira.

Erros distintos:

- `locked`: não há chave ativa; não ler/inicializar automaticamente.
- `missing`: não há snapshot nem head; somente initialize explícito cria dados.
- `corruption`: manifestos, envelopes, referências ou heads inconsistentes.
- `read-failed`, `write-failed`, `quota-exceeded`, `unavailable`: falhas do adapter.
- `stale-revision`: revisão ou conteúdo mudaram durante preparação.
- `invalid-input`, `already-exists`, `invalid-operation`, `cancelled`: contrato/
  contexto de desbloqueio inválido, sem reset.
- Erros de senha/recuperação continuam ambíguos conforme Etapa 2.

Unlock valida o snapshot completo antes de ativar a chave. Falha conserva o backend
bloqueado e os dados anteriores. Lock troca a identidade de época e destrói o handle;
operações obsoletas não podem entregar resultado. O callback CAS revalida a época
antes de enfileirar puts e após os hooks síncronos. Um commit que já tenha terminado
pode permanecer durável quando há lock antes da entrega final: o resultado é
cancelado, sem apagar nem tentar desfazer os dados próprios já confirmados.

## Atomicidade e concorrência

1. Ler o snapshot anterior e head numa transação readonly consistente.
2. Fora dela, autenticar/descriptografar manifesto e TODOS os documentos.
3. Validar revisão esperada, copiar updates, preservar documentos anteriores,
   verificar gerações/referências e preparar as cifras.
4. Criar token opaco não reutilizável, privado da instância e da época de unlock.
5. Transação readwrite lê snapshot/head atuais, compara com o baseline completo
   (não somente o número da revisão), confirma sequência e época.
6. Um put de snapshot contém estado, fila, conflitos, recuperações e manifesto;
   o put de head ocorre na MESMA transação. Não há partes confirmadas separadamente.
7. Só responder sucesso no evento `oncomplete`. Aborts/quota preservam os puts
   anteriores; os IVs já reservados permanecem consumidos em transações separadas.

Transações readwrite com stores sobrepostas são serializadas pelo IndexedDB em
conexões/abas da mesma origem e banco. Duas preparações podem existir, mas só uma
vence o CAS; a outra recebe stale-revision, sem retry automático de intenções.
Não se mantém transação aberta durante Web Crypto nem se introduz Web Lock
reentrante nos locks de configurações do aplicativo.

Todos os readwrite exigem e verificam `durability: strict`. Navegador sem suporte
falha fechado. Isso usa a garantia de durabilidade oferecida pelo navegador; não
promete sobreviver a hardware defeituoso, exclusão do perfil ou rollback do disco.

## IVs duráveis e falhas

Para CADA cifragem (inclusive wrapping da DEK), o módulo:

1. Gera candidato aleatório de 96 bits via getRandomValues.
2. Chama reserveIV com fingerprint da chave efetiva (DEK ou KEK) e candidato.
3. O adapter confere ledger/contador e existência do par na mesma transação strict.
4. Se já existe, retorna false e o módulo tenta outro candidato (máximo oito).
5. Se novo, registra IV e incrementa contador atomicamente; retorna true SOMENTE
   depois de oncomplete. Apenas então começa AES-GCM.

Falha da reserva não inicia AES-GCM; se a transação de reserva abortou antes de
confirmar, nenhum uso desse IV ocorreu. Uma reserva CONFIRMADA nunca é liberada,
mesmo se o provider falhar antes da cifragem, a preparação falhar depois, o commit
abortar, o token for abandonado ou o processo for encerrado. Quota não pode ser
tratada como autorização para usar IV em memória. Ao atingir o limite, requer rotação;
a implementação de rotação ainda não pertence a esta etapa.

A tabela é compartilhada entre namespaces do MESMO banco: o mesmo material de
chave com outro UID/keyId ainda compartilha reservas. Não é seguro compartilhar a
DEK com outra origem, perfil, dispositivo, cópia ou banco não coordenado. O nome
de produção deve continuar único e autoritativo; sufixos sintéticos são só testes.
Migração/importação futura de DEKs usadas fora desse ledger exige inventário das
reservas antigas ou, preferencialmente, chave nova e recifragem segura. Não inicializar
ledger novo para continuar usando uma DEK antiga como se nunca tivesse cifrado.

Perda/rollback coordenado do ledger completo não é corrigível sem âncora externa.
Alteração parcial do contador é detectada pela contagem indexada; não usar o contador
como substituto para armazenar cada par. Colisões do RNG são rejeitadas pelo ledger;
a resistência a colisão do identificador SHA-256 é uma suposição criptográfica.

## Testes e interpretação

Comandos:

```text
node --test tests/finance-vault-backend.test.js tests/finance-vault-crypto.test.js tests/vault-contract.test.js
node scripts/test-vault-backend-browser.mjs
node scripts/test-vault-browser.mjs
npm.cmd test
npm.cmd run check
git diff --check
```

Node usa modelo transacional serializável injetado, não um IndexedDB real.
O mesmo conjunto de cenários roda no IndexedDB REAL do Edge e Chrome. O runner
serve apenas os módulos e fixtures numa origem loopback, bloqueia outras origens
e SW, sem abrir app/Firebase. Cada banco tem nome sintético novo. Abas reais provam
um único vencedor do CAS; reinício de página e processo completo usam o mesmo
perfil sintético para verificar estado, fila offline e reservas abandonadas.

Quota/read/write/abort são falhas INJETADAS nas fronteiras reais do adapter;
o teste de quota não preenche o disco. Hooks síncronos `testHooks` são exclusivos
da infraestrutura de QA e ficam ausentes no uso normal. Comparação integral dos
documentos/snapshot após falha detecta perda ou confirmação parcial.

Cobertura: round-trip, ausência de payload/segredos legíveis nos stores, estado/fila
atômicos, preservação de conflitos/históricos/recuperações, stale revision, duas
instâncias/abas, reinícios, falha de preparação, antes/depois de put, aborto, quota,
referência perdida, senha/recuperação incorretas, adulteração de conteúdo/AAD/owner/
geração/manifesto, replay parcial, isolamento A/B, lock, candidato de IV repetido,
reserva abortada e reserva confirmada seguida de falha antes da cifragem.

Resultados finais e limitações de execução devem acompanhar a entrega. Perfis de
QA persistentes ficam em diretórios temporários novos; não são apagados pelo runner.
Não foram executadas migração, limpeza, acesso a produção ou testes de queda física
de energia/evicção do navegador. As regras Firebase/E2E do aplicativo não são alteradas.

Validação desta entrega (2026-10-29):

| Verificação | Resultado |
| --- | --- |
| Backend + criptografia + contratos no Node | 100 aprovados, 0 falhas, 0 ignorados |
| Backend no Edge e Chrome | 64 aprovados: 30 cenários IDB + abas/CAS + reinício completo por navegador |
| Regressão criptográfica Edge/Chrome | 100 aprovados, incluindo interoperabilidade bidirecional com Node |
| npm.cmd test | 652 testes: 648 aprovados, 0 falhas, 4 ignorados dependentes do Emulator |
| npm.cmd run check | aprovado |
| node --check dos novos módulos, fixtures, testes e runner | aprovado |
| git diff --check | aprovado |

Não foram utilizados skip/fixme ou retries para esconder falhas. Nenhuma dependência
foi adicionada. Os testes existentes das Etapas 1/2 continuam presentes; só se
ampliou a cobertura do callback durável. Comparação Git confirmou os arquivos do
fluxo financeiro/Firebase/UI/SW sem alterações em relação à base.

## Rollback, riscos e Etapa 4

Rollback desta etapa é retirar o backend do experimento: nenhum consumidor do app
foi alterado. Não apagar automaticamente os bancos sintéticos. Para futura ativação,
preservar fonte legada até verificação; após novos writes cifrados, rollback precisa
de leitor compatível ou backup verificado, nunca da cópia legada desatualizada.

Antes de uso com dados reais, Etapa 4 recomendada (nova autorização): catálogo
autenticado e persistência atômica dos envelopes de senha/recuperação, pacote externo
com teste de reabertura, codec financeiro sem perda, ciclo de unlock/lock e coordenação
de épocas de bloqueio entre abas. Medir custo de snapshots/KDF em celulares e definir
rotação/limites, depois testar o ciclo completo offline/reinício e compatibilidade.
A descoberta de cofres não deve converter erro em conta vazia. Ainda não migrar nem
trocar o backend ativo. Só depois avaliar integração UI/Auth em memória e migração
opt-in com rollback e tratamento explícito dos resíduos legados.

Riscos remanescentes: memória desbloqueada/XSS/extensões/malware, senha fraca ou
perdida, metadados públicos, downloads, evicção/exclusão, cópia integral antiga,
custos de recriptografar o snapshot inteiro, criptografia legada sem ledger e
rotação ainda não implementada. Criptografia não substitui backup. A aplicação
atual permanece com a exposição local anterior enquanto este backend não for integrado.
