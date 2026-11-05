# Cofre local — módulo criptográfico isolado

Implementação local na branch `security/cofre-local-etapa1`, sobre a especificação
`cofre-local-etapa1.md`. Nenhuma integração ou migração foi realizada. A aplicação
continua usando os mecanismos anteriores; sua exposição local atual não foi corrigida.

## Decisões revisadas antes da implementação

Não foi necessário alterar algoritmo, custo KDF, AAD ou envelopes da Etapa 1.
Há limites que não podem ser resolvidos apenas com criptografia isolada:

- Abertura GCM de chave falha tanto com senha errada quanto com envelope adulterado.
  O código `unlock-failed` preserva essa ambiguidade. Recuperação usa `recovery-failed`.
- Reempacotar invalida a senha antiga SOMENTE no envelope substituto. Uma cópia
  anterior continua funcionando. Revogar cópias exige rotação da DEK e dos dados.
- Reserva durável de IVs entre abas exige backend. Nesta etapa, o módulo gera IVs
  pelo RNG nativo e rejeita repetições conhecidas na instância, com até oito tentativas
  e limite de um milhão de reservas por contexto. Não é garantia multiaba ou reinício.
- O codec financeiro ainda não foi especificado para todos os tipos SDK. A camada
  criptográfica aceita/devolve bytes exatos (`Uint8Array`), sem converter valores,
  datas ou JSON. Um codec completo deve preceder qualquer integração financeira.
- Para evitar alocações descontroladas, o módulo isolado admite até 16 MiB de
  plaintext por documento e IDs de até 128 unidades UTF-16 (documentId até 512).
  Esses limites operacionais não truncam entradas; rejeitam excedentes. Confirmar
  adequação com históricos reais anonimizados/sintéticos antes da integração;
  se necessário, definir chunking autenticado/versionado, sem quebrar o formato v1.

## API

`finance-vault-crypto.js` exporta `createVaultCrypto()` e `VaultCryptoError`.
A factory usa `globalThis.crypto` em contexto seguro. Aceita um provider Web Crypto
injetado exclusivamente para testes, sem fallback para Math.random ou bibliotecas.
Cada factory mantém handles privados e reservas de IV em memória.

```js
const crypto = createVaultCrypto();
const context = { owner: { projectId: 'demo-cf-vault', uid: 'synthetic-A' },
  vaultId: 'vault-synthetic-a', keyId: 'dek-synthetic-a-1' };
const key = await crypto.generateDataKey(context);
const passwordEnvelope = await crypto.protectWithPassword(key, password, 1);
const { envelope: recoveryEnvelope, recoverySecret } =
  await crypto.protectWithRecovery(key, 1);
// Somente memória nesta etapa. O chamador é responsável por proteger recoverySecret.
const documentContext = { ...context, documentId: 'estado:synthetic-A',
  schemaVersion: 1, revision: 7, generation: 'generation-a' };
const envelope = await crypto.encryptDocument(key, bytes, documentContext);
const restoredBytes = await crypto.decryptDocument(key, envelope, documentContext);
crypto.destroyKey(key);
```

Abrir: `unlockWithPassword(envelope, password, { ...context, wrapRevision })`.
Recuperar: `recoverDataKey(recoveryEnvelope, secret, { ...context, wrapRevision })`.
Ambos retornam novo handle opaco. O contexto esperado vem do chamador; nunca usar
os campos do envelope recebido como fonte independente de autorização.

Trocar senha: `changePassword(previousEnvelope, oldPassword, newPassword, expected)`.
Autentica o envelope original, mantém a mesma DEK, incrementa wrapRevision e produz
novo salt/IV. Não modifica o original nem os documentos. Não persiste a substituição;
futuro chamador fará o commit atômico. Para redefinir após recuperação, recuperar o
handle e chamar `protectWithPassword` com a próxima revisão verificada no manifesto.

Handles não expõem CryptoKey, bytes ou função de exportação. Internamente a CryptoKey
da DEK é exportável para permitir o reempacotamento, guardada apenas em WeakMap privado.
KEKs são não exportáveis. Bytes temporários controlados são preenchidos com zeros
quando possível; strings, cópias internas do SDK/Web Crypto e memória do runtime
não têm zeroização garantida. `destroyKey` remove a referência privada e invalida
entrega de cifragem/descriptografia/wrapping pendente, mas não é logout nem barreira
de sessão da aplicação. O chamador futuro também deve invalidar operações de unlock
pendentes antes de entregar qualquer chave à sessão ativa.

Todo método assíncrono captura e valida entradas antes de awaits relevantes. O
payload é copiado explicitamente, inclusive Buffer do Node. Callbacks/accessors,
campos extras, versões desconhecidas, base64url não canônico e parâmetros fora
do perfil são rejeitados. Não há acesso a storage, rede, Firebase, console ou UI.

## Algoritmos e erros

- DEK: 32 bytes via getRandomValues, AES-GCM 256 bits.
- Documentos e DEK encapsulada: IV de 12 bytes, tag de 16 bytes, AAD da Etapa 1.
- Senha: UTF-8 exato, mínimo 15 pontos de código, máximo 4096 bytes, sem trim/NFC.
- PBKDF2 SHA-256: escrita 600.000 iterações, leitura 600.000–2.000.000, salt 16 bytes.
- Recuperação: segredo randômico independente de 32 bytes, HKDF SHA-256,
  salt 16 bytes e info `cf-vault-recovery/v1`.

Erros públicos possuem só códigos/mensagens constantes, sem cause do provider:
`invalid-envelope`, `context-mismatch`, `invalid-secret`, `unlock-failed`,
`recovery-failed`, `integrity-failed`, `invalid-key`, `nonce-unavailable`,
`rotation-required`, `crypto-unavailable` e `crypto-failed`.
`integrity-failed` nunca autoriza reset, exclusão ou fila vazia. Comparação de contexto
é adicional à autenticação do AAD; correspondência de strings não prova autenticidade.

## Verificação reproduzível

```text
node --test tests/finance-vault-crypto.test.js tests/vault-contract.test.js
node scripts/test-vault-browser.mjs
npm.cmd test
npm.cmd run check
git diff --check
```

O runner browser serve APENAS módulo e cenários sintéticos em 127.0.0.1, bloqueia
outras origens e Service Worker e usa contextos novos do Edge e Chrome no Windows
(Chromium em outras plataformas). Nenhum perfil de usuário, Firebase, aplicativo
ou dados reais são abertos. Não grava payloads, chaves ou senhas em arquivos.

Os mesmos casos reais de Web Crypto são executados em Node e nos dois navegadores.
Há interoperabilidade bidirecional de documentos e envelopes de senha/recuperação.
Vetores conhecidos verificam primitivas do provider; comparação independente com
`node:crypto` verifica os bytes e AAD efetivamente produzidos pelo módulo. RNG
determinístico é usado só no teste de referência, nunca no runner de navegador.

Referências dos vetores (parâmetros de teste não são parâmetros de produção):

- AES-256-GCM: McGrew/Viega, GCM specification, caso 14, chave e IV zero, sem AAD:
  https://csrc.nist.gov/groups/ST/toolkit/BCM/documents/proposedmodes/gcm/gcm-spec.pdf
- HKDF-SHA-256: RFC 5869, apêndice A.1:
  https://www.rfc-editor.org/rfc/rfc5869.html#appendix-A.1
- PBKDF2-HMAC-SHA-256: RFC 7914, seção 11:
  https://www.rfc-editor.org/rfc/rfc7914.html#section-11

Esses testes não certificam a implementação nem medem entropia do hardware.

## Próxima etapa e bloqueios para ativação

Etapa 3 recomendada, sujeita a nova autorização: projetar backend cifrado separado,
reserva durável de IVs, CAS de revisões, ordem de locks e commit atômico de estado,
fila, manifesto e recuperações. Primeiro usar fixtures, injetar abort/quota/reinício
e preservar a origem. Não substituir callbacks síncronas por async dentro de IDB.

Antes de integrar: benchmark KDF em celulares; codec financeiro exato; sessões e
cancelamento de unlock; rotação de chave/limite de IVs; múltiplas abas/BFCache;
recuperação completa com referências transitivas; plano para resíduos legados.
Depois avaliar política de Auth/Firestore em memória, sem mudanças implícitas.

Continuam fora da proteção: XSS, extensão/malware, memória desbloqueada, segredo
fraco/perdido, UID/IDs/tamanho visíveis, exclusão/evicção, replay de snapshot integral,
downloads e cópias antigas. Sem integração, a exposição local atual permanece.
