# Cofre local — Etapa 1: especificação e contratos

Status: proposta versionada, sem implementação criptográfica ou integração.
Base inspecionada: main, commit 2f54144. Data: 2026-10-29.

## Escopo e modelo de ameaças

Objetivo futuro: confidencialidade dos dados financeiros persistidos num perfil de
navegador compartilhado depois do bloqueio/logout, preservando integralmente o
trabalho offline. A conta Google autentica acesso remoto; desbloquear o cofre é
uma autorização local independente. UID não é segredo nem autorização de sessão.

Adversário considerado: outra pessoa com acesso ao mesmo perfil e às APIs locais,
DevTools ou cópia dos bancos, sem o segredo do cofre. Considerar troca de conta,
abas antigas, retorno de navegação, interrupções e adulteração de documentos.

Fora da proteção: XSS/código malicioso na origem, extensão privilegiada, malware,
captura de teclado/tela/memória, sessão desbloqueada, acesso legítimo à conta Google
na nuvem, exclusão do perfil, cópia antiga integral do cofre e downloads externos.
JavaScript não garante apagamento de memória ou eliminação física dos bytes.
AES-GCM detecta adulteração, mas não impede exclusão nem rollback integral de um
snapshot válido. Anti-replay absoluto offline requer uma âncora externa confiável.

Riscos atuais comprovados na auditoria: IndexedDB e cache Firestore permanecem
legíveis após logout; isolamento visual/remoto não equivale a sigilo local.
Esta etapa NÃO reduz esses riscos: só adiciona documentação e testes sintéticos.

## Compatibilidade e patrimônio que não pode ser descartado

Manter os contratos lógicos de estado e fila, IDs, valores, flags, revisões-base,
recorrências, tombstones, gerações, ordem relevante e formatos financeiros atuais.
Nenhuma alteração de cálculo, protocolo remoto, CSV ou backup financeiro nesta etapa.

Fontes a inventariar na futura migração:

| Fonte | Conteúdo a preservar |
| --- | --- |
| `controleFinanceiro:integridade:v1` / `documents` | `estado:<UID>`, `fila:<UID>` e referências de recuperação |
| `restore-recovery:<UID>:...` | snapshot anterior, base, proposta rejeitada e referências transitivas |
| `estado:@local`, `fila:@local`, compatibilidade `local` | dados anônimos separados, nunca atribuídos automaticamente ao Google |
| LocalStorage `controleFinanceiro:v3:uid:<UID>` | estado legado por conta |
| `controleFinanceiro:v3`, `v2`, `controle-financeiro-dados`, meses `controleFinanceiro-1..12` | fontes legadas e dados sem proprietário demonstrável |
| `controleFinanceiro:sync:<UID>`, `controleFinanceiro:sync-backup:<UID>` | fila/metadados e cópia histórica de migração |
| cache persistente do SDK Firestore | documentos consultados e possíveis escritas pendentes; inventariar pelo SDK |

Preservar na fila: outbox inclusive operações tentadas sem ACK, conflitos,
remoteRevisions, configurações pendentes, decisões e resoluções não confirmadas,
automaticHistory, automaticResolutions, recoveryKeys, recoveryNotices,
restoreJob e sua geração. Fila vazia não autoriza descarte de recuperações.
Aviso reconhecido ou download iniciado não significa backup externo confirmado.
Fontes inválidas devem ser preservadas como bytes brutos; erro não vira ausência.

## Formato proposto v1

Formato físico novo, separado do backend atual. Os exemplos em testes são apenas
bytes artificiais com tamanho correto; NÃO são vetores criptográficos válidos.
Campos desconhecidos são rejeitados no envelope v1. Versão futura exige leitor
explícito; não reinterpretar silenciosamente nem inicializar conta vazia.

Envelope de documento (JSON):

```json
{
  "format": "cf-vault-document",
  "version": 1,
  "algorithm": "AES-256-GCM",
  "keyId": "dek-synthetic-a-1",
  "owner": { "projectId": "demo-cf-vault", "uid": "synthetic-A" },
  "vaultId": "vault-synthetic-a",
  "documentId": "estado:synthetic-A",
  "schemaVersion": 1,
  "revision": 7,
  "generation": "generation-a",
  "iv": "base64url-sem-padding-de-12-bytes",
  "ciphertext": "base64url-sem-padding-ciphertext-e-tag"
}
```

`algorithm` é identificação do formato; Web Crypto recebe `name: 'AES-GCM'`,
chave de 256 bits e `tagLength: 128`. `ciphertext` concatena cifrado e tag, como
retornado por Web Crypto. Payload JSON UTF-8, sem conversão de valores financeiros.
Datas/tipos SDK devem ter codec explícito e round-trip exato antes de integração;
não presumir que JSON stringify genérico preserve qualquer structuredClone.

AAD: UTF-8 de JSON.stringify do array abaixo, nessa ordem, sem normalizar strings:

```text
["cf-vault-document",1,"AES-256-GCM",keyId,projectId,uid,vaultId,
 documentId,schemaVersion,revision,generation]
```

Rejeitar tipos inválidos, strings Unicode malformadas e revisões fora de inteiros
seguros não negativos. `owner`, `vaultId`, `keyId` e `documentId` devem corresponder
ao contexto esperado fornecido pelo chamador, nunca derivado somente do envelope.
O IV é entrada autenticada do GCM; substituí-lo invalida a tag. Todo metadado
semântico está no AAD. Tamanhos, UID, IDs, revisão e geração continuam visíveis;
criptografia do conteúdo não oculta esses metadados.

IV: 96 bits por operação, gerado com crypto.getRandomValues, nunca Math.random,
timestamp, UID ou contador apenas em memória. Nunca reutilizar sob a mesma chave,
inclusive em tentativas abortadas. Registro compartilhado de IVs reservados por
keyId, em transação curta, deve impedir reutilização conhecida entre abas; uma
colisão exige IV novo e nova cifragem. Reservas abortadas não são recicladas.
O desenho do backend deve permitir reserva durável antes da cifragem. Limite
conservador proposto: 1.000.000 de reservas por chave, depois bloquear novas
cifragens até rotação segura. Randômicos não provam unicidade matemática; cópias
ou rollback do registro continuam um limite a avaliar antes da produção.

## Chaves, senha e recuperação

DEK: 32 bytes aleatórios por cofre, sem derivação de UID/token. Uma única DEK pode
proteger documentos do cofre; envelopes de senha e recuperação usam chaves KEK
distintas. Chave não exportável em memória reduz exportação acidental, mas NÃO
substitui segredo independente do perfil. Não persistir senha, DEK aberta ou uma
CryptoKey que permita abrir o cofre sem segredo adicional. Logs nunca recebem
segredos, conteúdo, envelopes completos ou credenciais.

Envelope de chave v1: `format: cf-vault-key`, `version: 1`, `slot: password` ou
`recovery`, `algorithm: AES-256-GCM`, `keyId`, `owner`, `vaultId`, `wrapRevision`,
`kdf`, `iv`, `wrappedKey` (32 bytes da DEK + tag de 16 bytes).
AAD é JSON.stringify do array:

```text
["cf-vault-key",1,slot,"AES-256-GCM",keyId,projectId,uid,vaultId,
 wrapRevision,kdf.name,kdf.hash,kdf.iterations-ou-null,kdf.salt,kdf.info-ou-null]
```

Senha: entrada separada do login Google, nunca token, senha Google ou segredo
embutido. Codificar UTF-8 exatamente, sem trim/normalização silenciosa; explicar
isso na futura UI. Propor mínimo de 15 pontos de código e aceitar frases longas,
Unicode e espaços; rejeitar Unicode malformado e impor limite documentado de
4096 bytes para proteger recursos. Não truncar. Regras de UX ainda serão validadas.

KDF de senha v1: PBKDF2, SHA-256, salt aleatório de 16 bytes por novo envelope,
600.000 iterações como piso proposto, saída 256 bits para KEK AES-GCM. Leitor v1
aceita 600.000 a 2.000.000 iterações, rejeita parâmetros fora do perfil antes do
trabalho caro. Benchmark em celulares é obrigatório antes da ativação; não reduzir
silenciosamente o custo, versionar alterações. Derivar uma vez por desbloqueio,
fora da thread principal quando necessário. Salt e parâmetros não são secretos.
Trocar senha recifra apenas a DEK, com novo salt/IV e wrapRevision, atomicamente;
não reescreve todo o histórico financeiro. Cópias antigas + senha antiga continuam
capazes de abrir dados protegidos pela mesma DEK; revogação exige rotação completa.

Recuperação: segredo aleatório separado de 32 bytes, exportado fora do perfil,
codificado base64url canônico. KEK de recuperação via HKDF-SHA-256 com salt de
16 bytes e info `cf-vault-recovery/v1`, saída 256 bits; não usar PBKDF2 para esse
segredo de alta entropia. Autenticar o envelope e proprietário antes de importar
a DEK. Recuperação pode criar novo envelope de senha, sem apagar a origem.
Perda da senha E do segredo de recuperação torna dados exclusivamente locais
irrecuperáveis. Login Google não recupera esses dados. Segredo de recuperação sem
os documentos cifrados também não recupera um banco excluído.

Antes de ativar um cofre: oferecer pacote de recuperação contendo identidade,
envelopes e versão, exigir confirmação de que foi guardado fora do perfil e
desafio de reabertura em teste local. Não armazenar segredo de recuperação aberto
no pacote mantido no navegador. Backup cifrado completo deve incluir manifestos,
documentos e envelopes de chave; validar abertura e referências antes de restaurar.
Coordenar rotação e backups para não inutilizar cópias anteriores inadvertidamente.

## Estados e autorização

| Estado | Significado e comportamento obrigatório |
| --- | --- |
| inexistente | nenhum manifesto válido encontrado; não equivale a fonte legada ausente |
| bloqueado | manifesto disponível, sem DEK autorizada; nenhuma leitura financeira ou envio |
| desbloqueado | DEK em memória, contexto de conta/cofre/sessão válido; offline permitido |
| senha-incorreta | falha de abertura com senha; preservar tudo, permitir nova tentativa/recuperação |
| corrupcao | formato impossível, referência faltante ou falha autenticada de documento com chave válida; preservar bytes |
| recuperacao-necessaria | acesso normal indisponível ou migração inconsistente; exigir caminho explícito, sem reset automático |

Uma falha GCM ao abrir o envelope de senha não distingue senha incorreta de
adulteração do envelope. Mensagem correta: senha incorreta OU envelope danificado;
`senha-incorreta` é estado de tentativa, não diagnóstico criptográfico definitivo.
Nunca usar esse erro para sobrescrever dados. Cofre bloqueado não é conta vazia.

Transições previstas: inexistente -> bloqueado somente após criação validada;
bloqueado -> desbloqueado após abertura autenticada; tentativa inválida ->
senha-incorreta -> bloqueado; desbloqueado -> bloqueado ao sair/bloquear;
falha estrutural -> corrupcao -> recuperacao-necessaria; recuperação validada ->
bloqueado (exigir nova autorização antes do uso). Trocar A-B-A ou relogar o mesmo
UID cria contexto novo. Antes/depois de await, validar identidade do controlador,
sessão, cofre e época de desbloqueio. Não distribuir autorização reutilizável por UID.

## Atomicidade, abas e persistência futura

Backend atual exige callbacks síncronas. Web Crypto não pode executar dentro
dessas callbacks: ler versão, preparar cifragem fora da transação, confirmar por
compare-and-swap curto verificando todas as revisões e geração esperadas.
Estado + fila + recuperações afetadas + manifesto devem ter commit indivisível.
Falha/quota/abort não pode deixar metade do conjunto nem produzir sucesso na UI.
Conflito exige reler e recalcular a intenção original, não repetir efeitos laterais.
Reservas de IV são metadados separados; podem sobreviver a commit financeiro abortado.

Web Locks por projeto/cofre e revisão transacional são complementares. Definir
ordem total entre locks de cofre e os settings locks atuais para evitar deadlock
ou reentrada. BroadcastChannel carrega apenas eventos de controle; não transmite
DEK nem finanças. Cada aba desbloqueia independentemente. Época durável de bloqueio
e migração é revalidada no retorno de aba congelada/pageshow, antes de renderizar.
UI deve ocultar conteúdo ao sair; revisar BFCache explicitamente. Sem coordenação
suportada, bloquear publicação/migração; não apagar filas para contornar o problema.

Logout: invalidar contexto primeiro, impedir novos commits/envios obsoletos,
preservar commits próprios já concluídos e resolver resultado remoto ambíguo por
IDs idempotentes no próximo acesso do proprietário. Não tentar desfazer um commit
remoto confirmado nem enviar fila de A como B. Liberar referências às chaves e
limpar UI, sem prometer zeroização física. Reabrir offline exige segredo do cofre;
publicar requer também Auth da mesma conta. Falhas mantêm operações duráveis.

Auth/Firestore em memória no modo compartilhado serão avaliados em etapa futura,
antes de inicializar SDK. Preferir Firestore em memória também no modo confiável,
usando fila própria como fonte durável. Não aceitar silenciosamente instância
persistente já inicializada. Memória não elimina cache SDK legado; seu tratamento
exige plano separado, instâncias encerradas e prova sobre escritas pendentes.
Não manipular stores privados do SDK. Esta etapa não altera configuração Firebase.

## Migração, ativação e rollback

Fases futuras: inventariada -> copiada -> verificada -> ativa. Manifesto de migração
versionado registra proprietário, revisões de origem/destino, referências, fase e
verificação, sem payload financeiro legível. Cada fase é retomável/idempotente.

1. Opt-in, verificar recuperação e espaço disponível, coordenar TODAS as abas e
   bloquear versões antigas de escrita antes de estabilizar a origem.
2. Copiar para backend separado, cifrar e preservar fontes brutas, sem exclusão.
3. Reabrir e comparar integralmente IDs, valores, flags, revisões, filas, conflitos,
   gerações e fechamento transitivo das referências. Hash sozinho não substitui
   comparação semântica e teste de abertura. Referência perdida bloqueia ativação.
4. Verificar revisão de origem novamente e ativar manifesto atomicamente; novos
   writes vão somente ao cofre. Não fazer dual-write financeiro em texto legível.
5. Inspecionar falhas em cada fronteira, reinício, concorrência e restauração.

Antes de ativação, origem continua canônica; rollback ignora destino incompleto
sem o apagar automaticamente. Depois de novos writes, origem antiga NÃO é fallback:
usar leitor compatível, correção adiante ou backup cifrado verificado com todas as
operações posteriores. Feature flag não autoriza downgrade perdedor de dados.
Reinstalar versão antiga da PWA deve ser bloqueado por compatibilidade de protocolo.
Não editar protocolos de produção nesta fase.

Fontes legadas retidas continuam expondo dados. Não declarar privacidade completa
até retirada explícita e autorizada dessas fontes, incluindo cache SDK. Apagamento
lógico não garante sobrescrita física. Nunca representar limpeza local como uma
exclusão financeira remota/tombstone. Pendências e recuperações não são descartáveis.

## Critérios de aceitação e etapas seguintes

Etapa 1 (este PR local): só documentação/fixtures/testes; sem import no app, sem
dependências novas, sem criptografia ativa ou gravação de dados reais. Contratos
verificam formato, AAD, isolamento de contexto, parâmetros, referências e estados.
Não comprovam AES, qualidade RNG, concorrência real ou resistência criptográfica.

Etapa 2 proposta, sujeita a autorização: módulo criptográfico puro e isolado, sem
IndexedDB/Firebase/UI. Implementar envelopes, serialização AAD, KDFs, criar/abrir
DEK, cifrar/abrir documento, rewrap e recuperação, com Web Crypto e RNG injetável
somente para testes. Vetores conhecidos externos + round-trip; senha errada,
mutação de cada campo AAD/IV/tag/ciphertext, UID/projeto/cofre/documento errado,
metadados futuros e malformados, Unicode, limites de recursos e recuperação.
Teste de IV novo a cada operação não substitui futura reserva multiaba durável.
Sem integração, alteração de Auth/cache ou migração. Medir KDF em celulares antes
de ativação; desempenho ainda não homologado.

Etapa 3 futura: backend cifrado/CAS, reservas de IV e atomicidade com falhas de
quota/abort; depois sessões/UI/múltiplas abas; depois migração sintética e opt-in.
Antes de liberação: preservar 97 testes de sessões e regressões de backup; testar
Emulator A-B/A-B-A/mesmo UID, browser reiniciado offline, ACK perdido, logout durante
cifragem/sync/restore, bloqueio em abas e BFCache. Inspecionar bytes locais: nenhum
payload financeiro/segredo persistido aberto no backend novo. Rodar check, suíte
unitária, regras e E2E desktop/mobile. Simular restauração completa de backup antes
de autorizar retirada de fontes. Nenhuma etapa elimina necessidade de backups.

Riscos residuais: força da senha e ataques offline; segredo perdido; XSS e sessão
aberta; metadados visíveis; remoção/evicção pelo navegador; cópias históricas; rollback
integral; múltiplos dispositivos com cofres/chaves independentes; custos de KDF e
memória em celular. Sincronização da chave entre dispositivos não está prevista:
novo dispositivo cria cofre próprio ou usa pacote externo autorizado; finanças
confirmadas continuam recuperáveis pela nuvem, operações só locais não.

## Referências e pontos de integração

- `indexeddb-persistence.js`: transações síncronas e leitura sem criptografia.
- `financial-atomic-service.js`: estado/fila atômicos e recuperação de edição.
- `automatic-finance-sync.js`: identidade de sessão, gerações e restauração.
- `app.js`: bootstrap local, logout, UI e exportação de recuperação.
- `firebase-sync-entry.js`: Auth persistente/cache Firestore atual.
- `storage.js`, `sync-core.js`: legados e proteção contra sobrescrita inválida.
- `sw.js`, `scripts/prepare-pages.mjs`: distribuição futura de módulos compatíveis.
- https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey
- https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://firebase.google.com/docs/firestore/manage-data/enable-offline
- https://firebase.google.com/docs/auth/web/auth-state-persistence

O piso PBKDF2 usa como referência a recomendação OWASP para HMAC-SHA-256; sua
adoção no envelope de chave é decisão deste projeto, não certificação do desenho.
