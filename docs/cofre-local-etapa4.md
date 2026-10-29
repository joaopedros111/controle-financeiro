# Cofre local — Etapa 4: catálogo, recuperação, codec e bloqueio

Data: 2026-10-29. Base: checkpoint local `c8340ca`, branch
`security/cofre-local-etapa1`. Componentes ainda isolados: nenhum import pelo app,
alteração no IndexedDB financeiro atual, Firebase/Auth/Firestore, sincronização,
interface ou Service Worker. Nenhuma migração de dados financeiros reais.

## Revisão das Etapas 1–3 e decisões

Mantidos AES-256-GCM, IVs de 96 bits com reserva durável, tag de 128 bits, AAD,
PBKDF2-SHA-256 (600.000 iterações na escrita) e HKDF-SHA-256 para recuperação.
Os envelopes criptográficos v1 continuam compatíveis. O backend simples v1 e seus
testes continuam funcionando; catálogo/codec são extensões opt-in do backend.

Decisões adotadas para fechar os riscos apontados na Etapa 3:

- Antes de fornecer o segredo, só é possível validar estrutura e consistência
  local do catálogo. Autenticidade é confirmada SOMENTE depois do desbloqueio.
- Importar uma DEK usada sem seu ledger não é seguro. A chave do pacote é usada
  exclusivamente para descriptografar/verificar a origem; o destino recebe DEK
  nova, novo keyId, envelopes novos e novas reservas. Nunca se continua a DEK antiga.
- Bloqueio depende de uma época durável, verificada no commit; BroadcastChannel
  é uma otimização e não fonte de autorização. Mensagem perdida não libera writes.
- Tipos SDK precisam de adaptadores explícitos; não há duck typing nem dependência
  Firebase. Dados não representáveis falham sem normalização ou descarte silencioso.
- Não substituir dados existentes em uma recuperação. Para recuperar um original
  corrompido, usar destino novo da mesma conta e indicar o cofre de origem explicitamente.

Não há decisão criptográfica crítica pendente para esses componentes isolados.
Proteção contra rollback local malicioso, revogação física de chaves remotas e
freshness externa permanecem limites explícitos, não garantias implementadas.

## Catálogo persistente e autenticação

Novos módulos: `finance-vault-catalog.js`, `finance-vault-controller.js`,
`finance-vault-recovery.js` e `finance-vault-codec.js`.

O banco dedicado mantém o nome `controleFinanceiro:cofre-isolado:v1`, mas sua
versão de schema IndexedDB passa de 1 para 2. O upgrade apenas adiciona stores
`catalogs` e `controls`, sem transformar/remover snapshots, heads ou reservas.
É exclusivo do banco experimental, nunca do banco financeiro usado pelo aplicativo.
Clientes antigos recebem versionchange/fechamento ou erro de versão, sem downgrade.

Catálogo v1:

```text
format: cf-vault-catalog
version: 1
owner: { projectId, uid }
vaultId, keyId, generation
revision: revisão lógica monotônica do catálogo
snapshotRevision: revisão física do snapshot
codec: cf-financial-codec-v1
password: envelope AES-GCM de senha v1
recovery: envelope AES-GCM de recuperação v1
originPackageId: null ou SHA-256 do pacote restaurado
```

`catalogs` usa o namespace lógico [projeto, UID, vaultId] e aponta para o contexto
físico [projeto, UID, vaultId, keyId]. O catálogo também está no snapshot físico v2
e, integralmente, DENTRO do manifesto cifrado. Uma alteração nos envelopes, versões,
owner, geração, revisões ou codec não passa na comparação autenticada com o manifesto.
O AAD dos documentos/manifesto continua vinculando proprietário/cofre/chave,
documento, versão, revisão física e geração. A revisão lógica é autenticada dentro
do manifesto. Os envelopes de chave têm seu próprio AAD/contexto/wrapRevision.

`controls` contém versão, época de bloqueio, revisão lógica, keyScope e geração;
`heads` contém revisão física e geração. O adapter confirma snapshot, head, catálogo
e controle na MESMA transação strict, com CAS do baseline inteiro e controle esperado.
Criptografia acontece fora da transação. Nenhum sucesso antes de oncomplete.

Atualizações normais incrementam as duas revisões. Troca de senha/recuperação ou
geração também incrementa a época e invalida sessões cooperativas antigas. Uma
restauração inicia outro contexto físico com revisão física 1; não reescreve IDs,
revisões-base ou gerações financeiras dentro dos dados.

Os slots são validados rigorosamente mesmo quando não utilizados no desbloqueio.
Campos desconhecidos/versões futuras são rejeitados, sem fallback vazio. Catálogo
completo não prova que a senha seja correta nem que a chave possa ser recuperada:
a abertura precisa autenticar a DEK, o manifesto e TODOS os documentos/referências.

Estados expostos por status():

| Estado | Significado |
| --- | --- |
| missing | nenhum catálogo/dado detectado nesse namespace; não cria nada |
| locked, authenticated:false | catálogo estruturalmente consistente, ainda não autenticado |
| unlocked, authenticated:true | sessão válida, leitura e manifesto autenticados |
| corrupted | catálogo, manifesto, envelope ou metadado inconsistente |
| recovery-required | dados/cabeçalhos existentes sem catálogo utilizável |

Erro de leitura é propagado (`read-failed`/`unavailable`), nunca convertido em missing.
Senha incorreta e adulteração do envelope continuam indistinguíveis (`unlock-failed`).
Mesmo em missing, criação é operação EXPLÍCITA com estado/fila válidos; erro nunca
autoriza inicialização. Snapshots legados da Etapa 3 sem catálogo não são migrados:
retornam recovery-required; conversão futura exigirá procedimento separado e autorizado.

## API do controlador isolado

```js
const controller = createVaultController({ store, owner, vaultId, codec });
const created = await controller.create({ password, generation, documents });
// created.recoverySecret só em memória: guardar externamente e testar reabertura.
await controller.lock();
await controller.unlockWithPassword(password); // descobre envelopes persistidos
// ou: await controller.unlockWithRecovery(recoverySecret)
const snapshot = await controller.read();
const token = await controller.prepare({ expectedRevision: snapshot.catalog.revision,
  generation: snapshot.generation, updates });
await controller.commit(token);
const bytes = await controller.exportRecoveryPackage();
await controller.changePassword(oldPassword, newPassword);
const renewed = await controller.renewRecovery();
controller.close();
```

O store deve ser uma conexão exclusiva por controlador/aba. close() libera a sessão
local, canal e conexão. lock() invalida localmente de imediato, depois confirma a
época durável e notifica outras abas. Se essa escrita falhar, não promete bloqueio
global; a sessão local permanece bloqueada e o erro é propagado. Não há integração Auth.

Tokens de prepare são objetos privados da instância e sessão, consumidos uma vez.
Troca A–B–A ou novo desbloqueio não reutiliza tokens antigos. A aplicação futura
deverá vincular esse ciclo à identidade da sessão Google, sem autorizações só por UID.

## Pacote externo e restauração

Wire versionado: `cf-vault-recovery`, versão 1, snapshot cifrado completo (incluindo
catálogo e envelopes) e envelope `seal` sob documentId `@recovery-package`.
O seal AES-GCM autentica um SHA-256 da representação integral do snapshot. Seu AAD
vincula contexto, revisão e geração. O pacote não contém senha, segredo de recuperação,
DEK ou payload financeiro em texto puro. IDs, owner e metadados dos envelopes continuam
públicos. Exportação concorrente com write é rejeitada em vez de entregar pacote misto.

Importação recebe bytes e um segredo externo, valida formato/versionamento, owner,
cofre de origem, ambos os envelopes, seal, manifesto, documentos, codec e fechamento
das referências ANTES de escrever. A origem é aberta por backend decrypt-only sem
ledger de escrita; nunca exporta o handle da DEK. A época do destino é capturada
ANTES da validação assíncrona: lock durante a validação cancela a importação antiga.

```js
await destination.importRecoveryPackage(bytes, { recoverySecret, newPassword });
// Para preservar um original corrompido, criar outro controlador com vaultId novo:
await freshDestination.importRecoveryPackage(bytes, {
  recoverySecret, newPassword, sourceVaultId: originalVaultId
});
```

sourceVaultId diferente precisa ser indicado explicitamente; owner/projeto sempre
devem ser os do destino. Importações de outra conta são rejeitadas mesmo com segredo
válido. Destino existente não é substituído nem mesclado automaticamente. O snapshot
anterior/corrompido permanece intacto. O segredo NOVO de recuperação só é retornado
após confirmação; nunca é persistido em claro.

Importação completa é atômica. Falha/interrupção antes do commit deixa apenas reservas
consumidas, sem catálogo/snapshot parcialmente ativos; repetir cria outra DEK nova.
O hash originPackageId identifica uma restauração confirmada. Repetir o MESMO pacote
autentica origem e destino, retorna alreadyRestored sem sobrescrever operações
offline posteriores. Se o ACK se perdeu, newPassword permite reabrir. O segredo novo
não pode ser reexibido; usar renewRecovery() para gerar outro envelope/segredo e
guardar pacote novo. Reconhecimento de download não comprova custódia externa.

Pacote velho mas criptograficamente válido pode ser restaurado em destino novo:
sem âncora externa não há prova de que seja a cópia mais recente. Rollback do catálogo
isolado é detectado pelos controles/heads; replay coordenado do banco inteiro não.
Limite atual do pacote: 32 MiB; excedente falha sem truncar nem modificar a origem.
Chunking de grandes pacotes e experiência de custódia externa não estão implementados.

## Codec financeiro sem perda

`cf-financial-codec-v1` usa árvore de tags versionadas em JSON UTF-8, em vez de
serializar objetos diretamente. Preserva números IEEE-754 sem arredondamento,
-0, NaN/Infinity, BigInt, undefined explícito versus propriedade ausente, Date,
Uint8Array, arrays esparsos, objetos normais/null-prototype e nomes como __proto__
sem alterar protótipos. Campos financeiros desconhecidos são preservados.

O codec não normaliza receitas/despesas, categorias/configurações, revisões,
gerações, IDs/operações, conflitos, decisões, snapshots, tombstones ou referências.
Não valida regras financeiras: números inválidos para o negócio podem ser representados
para recuperação, mas só poderão entrar no app após validação semântica futura.

Objetos SDK exigem adaptador explícito com tag versionada, matches/encode/decode.
Nenhum import Firebase. Os testes usam classe Timestamp sintética e preservam
seconds/nanoseconds e campos opcionais adicionais. Todas as propriedades próprias
enumeráveis de dados do objeto adaptado também são codificadas; não desaparecem
porque o adaptador conhece apenas parte dos campos. Adaptadores são código confiável
e precisam de testes contra a versão REAL do SDK antes da integração. Plain objects
{seconds,nanoseconds} continuam plain objects, sem coerção automática.

Funções, símbolos, accessors, propriedades não enumeráveis, ciclos e tipos sem
adaptador falham explicitamente; não se preserva identidade compartilhada de objetos
nem semântica de descritores. Tipos built-in com propriedades extras não suportadas
também falham. Esse contrato preserva conteúdo, não código executável ou permissões JS.
Limites: profundidade 64, 100.000 nós/itens, BigInt até 4096 dígitos e 16 MiB por payload.
O backend continua exigindo fila operacional com geração consistente: codec não
substitui uma futura conversão validada de filas legadas sem geração.

## Bloqueio entre abas e limites de revogação

Antes/depois de operações assíncronas, o controlador verifica identidade da sessão
local e controle durável. O CAS relê o controle na transação que confirma os writes;
lock entre a última leitura e commit causa rejeição. Geração/credenciais novas
inutilizam tokens antigos. Cada aba precisa fornecer seu próprio segredo para abrir
a chave; nenhuma chave ou finança é transmitida.

BroadcastChannel envia apenas versão, tipo, namespace lógico e época. Mensagens
atrasadas com época já observada são ignoradas; perda/falha do canal não dá acesso.
Uma aba suspensa revalida o controle no próximo read/status/prepare/commit; reinício
exige desbloqueio e descobre envelopes no catálogo, inclusive offline. Não há UI
nesta etapa: futura integração deve ocultar conteúdo e revalidar antes de renderizar
ao retornar de suspensão/pageshow/BFCache, sem reutilizar plaintext visual em cache.

É revogação COOPERATIVA. Não é possível apagar fisicamente uma CryptoKey ou plaintext
já entregue à memória de outra aba, cancelar AES já em andamento, ou impedir código
malicioso da mesma origem de usar cópias de chaves. O fence impede confirmação/entrega
pelas APIs cooperativas após observar a revogação. Commit já confirmado antes do lock
pode permanecer durável mesmo que a entrega do resultado seja cancelada.

Épocas locais não têm âncora externa. Um atacante com escrita arbitrária no perfil
pode reverter controles e esconder um lock de uma aba que nunca o observou. Este
cenário e extensões/XSS/malware/DevTools ativos não têm garantia de revogação irreversível.
Mesmo trocar senha não revoga DEK de cópias antigas; revogação criptográfica exige
rotação da DEK, não só reempacotamento. Não há promessa de zerar strings/heap/swap.

## Validação, rollback e próxima etapa

Os testes usam modelo transacional no Node e IndexedDB real em Edge/Chrome, perfis
sintéticos novos, rede restrita a loopback e SW bloqueado. Testes de quota/abort/ACK
perdido são injetados, sem preencher disco nem acessar produção. Perfis novos ficam
no diretório temporário e não são apagados. O ensaio de reinício completo descobre
o catálogo persistido e desbloqueia com a rede offline, sem envelope no processo pai.

Comandos reproduzíveis:

```text
node --test tests/finance-vault-stage4.test.js
node scripts/test-vault-stage4-browser.mjs
node scripts/test-vault-backend-browser.mjs
node scripts/test-vault-browser.mjs
npm.cmd test
npm.cmd run check
git diff --check
```

Resultados finais desta execução:

| Verificação | Resultado |
| --- | --- |
| Etapa 4 no Node (incluindo codec e erros de provider) | 31 aprovados, 0 falhas, 0 ignorados |
| Todas as etapas específicas no Node | 131 aprovados, 0 falhas, 0 ignorados |
| Etapa 4 Edge/Chrome | 60 aprovados: 27 cenários IDB + upgrade de schema + abas reais/canal + reinício offline por navegador |
| Regressão backend Etapa 3 Edge/Chrome | 64 aprovados, 0 falhas, 0 ignorados |
| Regressão criptográfica Edge/Chrome | 100 aprovados, 0 falhas, 0 ignorados |
| npm.cmd test | 684 testes: 680 aprovados, 0 falhas, 4 ignorados dependentes do Emulator |
| npm.cmd run check | aprovado |
| node --check módulos/runner/testes novos e módulos alterados | aprovado |
| git diff --check | aprovado |

Cobertura inclui catálogo adulterado/rollback, versão incompatível, senha e segredo
incorretos, pacote incompleto/corrompido/outro owner, restauração abortada/ACK perdido,
idempotência com edições offline posteriores, codec completo e campos adicionais
de Timestamp sintético, A–B–A, corrida lock/commit, lock durante validação do pacote,
mensagem perdida, concorrência, troca de geração e troca atômica de senha.
O ensaio de schema cria um banco sintético v1 e comprova a retenção das reservas
anteriores ao abri-lo como v2; não abre bancos financeiros existentes.

Não há skip/fixme ou aumento de timeout para esconder falhas. A preservação da
origem corrompida é testada com destino de novo vaultId no MESMO banco sintético.
Nenhuma nova dependência foi adicionada. O checkpoint anterior permanece sem
novo commit, push, merge ou deploy nesta etapa.

Nenhum dado real foi migrado. Rollback do experimento consiste em manter esses módulos
fora do app; não limpar bancos. O banco experimental schema 2 não deve ser aberto
por versões antigas para escrita. Uma eventual ativação futura precisa de leitor
compatível e recuperação verificada; voltar a fonte legada desatualizada perderia
operações posteriores. Cópias legadas legíveis continuam expostas enquanto retidas.

Próxima etapa recomendada: revisão independente e benchmark móvel, testar adaptadores
com tipos reais do SDK em ambiente sintético, UX de segredo/custódia/recuperação e
integração de ciclo de sessão exclusivamente em harness. Validar revogação/pageshow,
rotacionar/aposentar chaves e dimensionar snapshots/pacotes antes de propor qualquer
migração opt-in. Auth/Firestore em memória e retirada de resíduos legados exigem
autorização e plano próprios. Ainda não disponibilizar o cofre para dados reais.
