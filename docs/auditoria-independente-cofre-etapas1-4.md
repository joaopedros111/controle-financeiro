# Auditoria independente do cofre — Etapas 1 a 4

Data: 2026-10-29. Branch `security/cofre-local-etapa1`, HEAD `c8340ca`.
Escopo: checkpoint das Etapas 1–3 MAIS as alterações locais da Etapa 4; não somente
o conteúdo do commit. O armazenamento ativo do aplicativo permanece fora do cofre.

## Decisão

**APTO SOMENTE APÓS CORREÇÕES.** Não iniciar a integração experimental com o fluxo
do aplicativo no estado atual. Continuar apenas diagnóstico/harnesses sintéticos.

Não foi confirmada quebra de AES-GCM/KDF, leitura entre proprietários sem segredo
ou exposição persistente de chave aberta. Foram confirmadas cinco falhas de
disponibilidade, recuperação e validação: duas altas e três médias. Ausência de
falha crítica encontrada não é certificação de segurança nem autorização de produção.

Esta auditoria não implementou correções. Só acrescentou relatório, fixtures,
testes de equivalência e harness de reprodução. Nenhum arquivo de implementação
foi corrigido, nenhum banco/cache existente foi limpo, nenhum dado real foi acessado.
Sem commit, push, merge, migração, integração ou deploy.

## Método e evidência independente

Revisão cruzada em três frentes: criptografia/catálogo/recuperação; transações e
sessões; codec e formatos reais/adaptadores. Os achados consolidados foram
reproduzidos por harness próprio em Node e IndexedDB REAL do Edge e Chrome.

O harness novo `scripts/audit-vault-independent.mjs` testa invariantes de segurança.
Quando há `secure:false`, ele registra a violação e termina com exit code 1. Esse
resultado é uma falha real do critério auditado, não um teste ignorado ou corrigido.
Os testes existentes verdes não substituem essas evidências negativas.

Todas as contas, lançamentos, IDs e segredos dos ensaios são sintéticos. Fixtures
usam normalizarEstado/validarBackup, makeOperation, recordEntityKey e financeSettings
do aplicativo. Contêm estados mensais reais em forma, filas/outbox/tombstones,
attempted, remoteRevisions, conflictDecisions, automaticSettingsDirty/Value,
settingsBaseline/Revision, automaticHistory/Resolutions, backupJobs, restoreJob
e referências de recuperação. Não se inicializa Firebase.

O tipo Timestamp é o REAL de `firebase/firestore` instalado (Firebase 13.0.0),
somente construtor/codec. O bundle de QA fica em memória, a rede do navegador é
limitada a loopback, SW é bloqueado e cada banco/perfil de ensaio é novo/sintético.

## Resumo dos achados confirmados

| ID | Gravidade | Falha | Probes | Bloqueia integração? |
| --- | --- | --- | --- | --- |
| F1 | Média | Operação antiga pode bloquear sessão recém-desbloqueada | A01, A02, A02C, A03 | Sim |
| F2 | Alta | Renovação de recuperação pode confirmar novo slot sem entregar novo segredo | A05 | Sim |
| F3 | Alta | Histórico aceito/exportado pode não ser importável | A06 | Sim |
| F4 | Média | Categoria válida `recoveryKeys` é interpretada como referência interna | A04 | Sim |
| F5 | Média | Codec sobrescreve campos semânticos depois da validação do adaptador | A07 | Sim, antes de integrar adaptadores tipados |

### F1 — Erros/cancelamentos antigos invalidam sessão posterior

Evidência: `finance-vault-controller.js:23` invalida a sessão global ativa;
`guard():35` e `verifiedRead():50` fazem isso incondicionalmente no catch.
`status():133` e `:134` repetem o problema para corrupção/recovery-required.

Reprodução A01:

1. Criar/desbloquear um cofre e iniciar read().
2. Reter a primeira loadCatalog em um gate.
3. Fazer novo unlockWithPassword no MESMO controlador; confirmar status unlocked.
4. Liberar a operação antiga rejeitando com read-failed.
5. O erro antigo muda a sessão NOVA para locked. O snapshot anterior fica intacto.

A02 reproduz pela leitura de snapshot `store.load`. A03 usa um status antigo que
recebe corrupção depois do novo unlock. **A02C não injeta erro de I/O:** libera a
leitura antiga normalmente; ela é cancelada por sua época obsoleta, mas o catch
de verifiedRead ainda destrói a sessão nova. Todos os quatro casos foram observados
nos três ambientes. Não é vazamento entre contas nem perda persistida reproduzida.
É negação de disponibilidade e regressão do isolamento de sessões assíncronas.

Outros fluxos examinados: catches de unlock/create bloqueiam o backend candidato
capturado, não a sessão global nova; guardas local() antes/depois de awaits e o
fence transacional rejeitam tokens obsoletos. Não foi reproduzida sobrescrita financeira
cruzada nesses caminhos. Não remover esses fences ao corrigir os catches.

Recomendação: limpeza condicional à identidade do controlador/sessão/época capturada.
Erro/cancelamento de operação obsoleta deve terminar só a operação antiga.
status() precisa capturar sua identidade ANTES do primeiro await. Não usar igualdade
de UID como autorização reutilizável. Nenhuma correção foi aplicada.

Teste de aceitação: inverter os probes A01/A02/A02C/A03 para exigir que a sessão
nova permaneça unlocked e operacional; repetir logout/relogin, A–B–A, corrupção
tardia e cancelamento normal, mantendo a revogação correta da sessão realmente ativa.

### F2 — Renovação de recuperação sem protocolo de custódia/ACK

Evidência: `finance-vault-controller.js:147–151`: renewRecovery gera o segredo
internamente, substitui o slot por commit e só então retorna o segredo novo.
Não há retenção confirmada do slot anterior nem fase persistente de custódia.

Reprodução A05:

1. Usuário entra SOMENTE com o segredo de recuperação, pois perdeu a senha.
2. renewRecovery confirma snapshot/catálogo revisão 2.
3. O adapter simula perda do ACK DEPOIS da confirmação e lança write-failed.
4. Nenhum novo segredo chega ao chamador.
5. Após lock, o segredo anterior falha com recovery-failed. Os dados cifrados
   continuam armazenados; o caminho normal de recuperação ficou indisponível.

Confirmado em Node/Edge/Chrome. Não foi apagado lançamento. A falha é de acesso
e disponibilidade dos dados, especialmente grave para operações só locais.
Se houver senha ainda conhecida ou cópia externa do envelope antigo, podem existir
caminhos de salvamento; não se afirma impossibilidade matemática de recuperação.
Mas a API normal não oferece fallback e o ensaio não depende da senha perdida.

Recomendação: protocolo preparar → guardar/testar segredo novo → ativar, ou retenção
autenticada do slot anterior até confirmação explícita de custódia. Não tratar
download iniciado ou commit local como prova de que o segredo foi guardado.
Prever resposta perdida, aba fechada, suspensão e revogação durante esse protocolo.

Teste de aceitação: mesmo sem senha, em cada fronteira antes/depois do commit,
fechamento ou ACK perdido deve restar um segredo já entregue e verificável capaz
de abrir os dados MAIS RECENTES. Nenhum reset ou descarte de pendências.

### F3 — Limites assimétricos tornam backup válido não restaurável

Evidência: `finance-vault-controller.js:67` codifica o grafo INTEIRO em create;
`:94` limita somente updates no prepare; `finance-vault-backend.js:142–145`
cifra cada documento separadamente. `finance-vault-codec.js:18` limita a 100.000
nós por chamada e `:108` limita a 16 MiB. Importação em `controller:177` chama create
com todos os documentos. O limite externo de pacote é diferente (32 MiB em
`finance-vault-recovery.js:18`).

Reprodução A06, representativa de históricos financeiros:

- Começar com estado válido e fila pendente.
- Adicionar cinco snapshots de recuperação em commits separados, cada um com
  4.000 receitas sintéticas válidas. Cada update/documento cabe nos limites.
- Fonte chega à revisão 6 e permanece legível; exportRecoveryPackage funciona.
- O pacote tem 4.522.367 bytes, ABAIXO de 32 MiB.
- Importação com segredo correto falha em codec-invalid; destino permanece vazio.

O conjunto ultrapassa o orçamento global de nós aplicado apenas na restauração.
Confirmado em Node/Edge/Chrome. Portanto, não é só uma recusa honesta de pacote
maior que o máximo anunciado: o pacote foi exportado e validado, mas não pode ser
reconstruído pelo fluxo público. O mesmo descompasso existe para o limite de bytes.

Recomendação: contrato coerente de capacidade para criação, crescimento, leitura,
exportação e importação, preferencialmente processamento/codec por documento com
limites agregados e pacote segmentado/streaming autenticado. Se houver limite global,
verificá-lo ANTES de aceitar writes que eliminem recuperabilidade. Nunca truncar
históricos, IDs, filas ou valores para fazer o pacote caber.

Teste de aceitação: todo snapshot aceito, inclusive após crescimento incremental,
deve sobreviver a exportação/importação para destino novo com equivalência integral.
Testar limites de nós, bytes, quantidade de documentos e falhas em cada segmento.

### F4 — Nome livre de categoria colide com metadado interno

Evidência: `finance-core.js:155–160`, `:195–212` e normalizarEstado aceitam nomes
livres de categoria. `finance-vault-backend.js:60–80` percorre TODO objeto e em
`:71–73` trata qualquer propriedade `recoveryKeys` como lista de IDs de documentos.

Reprodução A04: categoria chamada `recoveryKeys` e orçamento padrão 100, com receita
e despesa normais. validarBackup retorna true e codec preserva integralmente o
estado. No entanto, controller.create falha invalid-input porque interpreta
`dados.orcamentos.padrao.recoveryKeys` (número) como metadado de recuperação.
Nenhum snapshot é criado. Confirmado em Node/Edge/Chrome.

Impacto: dados válidos do aplicativo não podem entrar no cofre; edição/restauração
com esse nome também fica sujeita à rejeição. É incompatibilidade real, não ataque
à criptografia. Não foi observada alteração dos dados anteriores.

Recomendação: extrair referências a partir do SCHEMA de fila/recuperação, distinguindo
payload financeiro e metadados. Não reservar/proibir nomes de categorias nem remover
a validação de referências. Uma opção é manifesto explícito de referências produzido
pelo adaptador, validado contra o grafo de documentos.

Teste de aceitação: categorias, orçamentos e campos legados com nomes iguais aos
metadados devem preservar-se; referências reais ausentes ou de outro owner ainda
devem ser rejeitadas, inclusive nas filas arquivadas em snapshots de recuperação.

### F5 — Adaptador real pode produzir Timestamp inválido

Evidência: `finance-vault-codec.js:50` chama o decoder do adaptador e valida a
representação. `:56–60` sobrescreve propriedades próprias com outra representação;
`:62` só exige matches, que nos adaptadores demonstrados é instanceof.

Reprodução A07 com Timestamp REAL do SDK:

1. Codificar new Timestamp(1, 5) com adaptador explícito.
2. Manter representation válida, mas mudar properties.nanoseconds no wire para 2e9.
3. decode aceita objeto instanceof Timestamp com nanoseconds=2e9.
4. O construtor do SDK rejeita os MESMOS valores como inválidos.

Confirmado em Node/Edge/Chrome com bundle do SDK instalado. A construção normal e
o round-trip de Timestamp válido passam. Não é bypass de AES: o ensaio usa bytes
malformados no boundary do codec; um atacante externo sem chave não cria tag GCM
válida. A falha importa para adapters/importadores e invariantes de objetos tipados.

Recomendação: impedir contradição entre representation e propriedades semânticas
do tipo, ou validar o objeto FINAL após restaurar todas as propriedades. matches
não pode ser apenas instanceof quando se promete validade semântica. Preservar
campos adicionais legítimos sem sobrescrever silenciosamente invariantes do tipo.

Teste de aceitação: wires contraditórios devem falhar; seconds/nanoseconds inválidos,
versões futuras e campos extras devem ter comportamento explícito. Timestamp válido,
campos opcionais e plain {seconds,nanoseconds} precisam continuar equivalentes.

## Controles positivos examinados e limites conhecidos

### Criptografia

- AES-256-GCM com chave aleatória de 32 bytes, IV de 12 bytes e tag de 128 bits.
  AAD vincula owner, cofre, chave, documento, versão, revisão e geração; envelopes
  de chave incluem também slot/KDF/wrapRevision. Formatos extras/futuros rejeitados.
- PBKDF2-SHA-256 600.000 iterações para senha, salt aleatório 16 bytes e parâmetros
  de leitura limitados; HKDF-SHA-256 para segredo independente de recuperação 32 bytes.
- Reservas por fingerprint da chave efetiva (DEK/KEK), não só UID/keyId; transação
  strict de ledger+contador antes de AES. Reserva confirmada não é liberada em abort
  posterior. Casos existentes de colisão, reinício e abort foram reexecutados.
- Catálogo duplicado dentro do manifesto cifrado; importação valida o pacote por
  inteiro, usa origem decrypt-only e gera DEK nova no destino. Destinos existentes
  são conservados; repetição do pacote não reverte novas operações offline.
- Não foi encontrado log de senha/DEK/recoverySecret nos módulos. Erros do provider
  são normalmente sanitizados; chaves/bytes temporários vivem em memória.

O IV GCM precisa ser único sob a mesma chave e AAD é autenticado, não cifrado;
isso foi usado como critério de revisão, não inferido apenas dos testes.
Referência: [Web Crypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams).

Limites conhecidos: factory criptográfica sem reserveIV é apenas memória; não
continuar uma DEK importada em ledger novo. Chave interna da DEK é exportável para
rewrap, encapsulada por handle privado; isso não protege contra debugger/XSS/malware
com sessão aberta. Senha antiga + envelope antigo continuam abrindo a mesma DEK;
revogação criptográfica exige rotação, não só troca de senha. A separação entre
segredo e dados segue o princípio de [armazenamento de chaves da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).

### Transações e armazenamento

O código confirma snapshot/head/catalog/control numa única transação com CAS de
conteúdo e versão; só retorna sucesso em oncomplete. Web Crypto está fora dessa
transação. Guardas de época são relidas antes do put. Não foi reproduzida confirmação
parcial nem sobrescrita financeira cruzada nos casos normais de concorrência/quota/
abort. Há limites nos ensaios: quota/ACK/abort são injetados; não houve queda física
de energia, evicção real ou teste de hardware. Node usa modelo, browsers usam IDB real.

Épocas/heads/ledger locais não constituem âncora externa. Rollback coordenado do banco
pode esconder revogação/freshness; mensagens não apagam CryptoKey ou plaintext já
copiados para outra aba. Isso já é limite documentado, não descoberta de uma quebra
de AES. Uma aba suspensa precisa revalidar antes de entregar conteúdo à interface.

### Capacidade e performance — risco potencial, não novo bypass

Cada prepare recifra TODOS os documentos, inclusive recuperações retidas. No máximo
de 1000 documentos, cada tentativa pode consumir 1001 IVs da DEK. O limite de
1.000.000 permite cerca de 999 snapshots completos antes de exigir rotação; tentativas
abortadas aceleram o consumo. Rotação automática ainda não existe. Além de F3,
esse limite deve ter preflight/capacidade e plano de recuperação antes de autosave.
Não foi provocado esgotamento de um milhão de entradas nem medido desempenho móvel.

## Codec real, adaptadores e integração

Os dois testes novos positivos usam campos reais, sem normalizar durante o round-trip.
Receitas/despesas, categoria, orçamento, IDs/baseRevision/generation, pendências,
tombstones, conflitos/decisões e histórias permanecem deepStrictEqual. O SDK real com
adaptador explícito também passa. structuredClone, utilizado pelo serviço/IDB atuais,
transforma Timestamp em plain object; essa forma passa com codec padrão, sem coerção.
Logo, ausência de adaptador SDK não significa perda inevitável dos dados já persistidos.

As fixtures anteriores têm alguns nomes artificiais (`pendingDecisions`,
`settingsPending`) enquanto o aplicativo usa `conflictDecisions`,
`automaticSettingsDirty/Value`, `settingsBaseline` e `backupJobs`. O codec genérico
preserva os nomes reais no novo ensaio, mas essa lacuna explicava parte da cobertura
insuficiente. Os probes negativos não alteram os valores monetários para obter êxito.

| Integração | Situação e condição anterior à implementação |
| --- | --- |
| IndexedDB financeiro atual | Interface ler/alterar/alterarDocumentos difere de read/prepare/commit; preservar origem e revisões, sem trocar backend por configuração |
| ServicoFinanceiroAtomico | Callbacks síncronas e múltiplos docs (`financial-atomic-service.js:32`, `:69`); adaptador precisa reler/CAS e reaplicar intenção original, não repetir efeitos/IDs ou snapshot de UI obsoleto |
| AutomaticFinanceSync | useAccount cria fila legítima sem generation e usa fallback legacy (`automatic-finance-sync.js:75–83`); mapear metadado explicitamente, sem conta vazia quando locked/read-failed |
| Firebase Auth | Sessão Google e desbloqueio local são autorizações distintas; vincular identidade do controlador/objeto da sessão em cada await, sem autorização reutilizável por UID |
| Firestore | O cache persistente atual continua em texto legível, fora do cofre; avaliar memoryLocalCache com fila própria durável e tratamento separado de resíduos |
| Interface de bloqueio | Ainda inexistente no app; máscara de valores não substitui bloqueio. BFCache/pageshow/aba suspensa não podem renderizar plaintext antigo sem revalidação |
| Recuperação e senha perdida | Não permitir ativação apenas porque download começou; protocolo de custódia e F2 precisam ser resolvidos antes de confiar dados só locais |

Auth persistente e cache Firestore continuam configurados em `firebase-sync-entry.js:62`
e `:68`; logout é signOut em `:83`. O cache Firestore não se limpa automaticamente
entre sessões, conforme [documentação Firebase](https://firebase.google.com/docs/firestore/manage-data/enable-offline).
O cofre isolado não corrigiu a exposição do armazenamento original em dispositivo
compartilhado. Não foi feito novo teste de contas reais/produção nesta auditoria.

## Validação e reprodutibilidade

```text
node scripts/audit-vault-independent.mjs
node --test tests/vault-real-formats-audit.test.js
node scripts/test-vault-stage4-browser.mjs
node scripts/test-vault-backend-browser.mjs
node scripts/test-vault-browser.mjs
npm.cmd test
npm.cmd run check
git diff --check
```

O primeiro comando DEVE sair com 1 enquanto as falhas persistirem. Produz observações
sanitizadas, sem segredos ou payloads. Ele verifica 10 critérios por ambiente: quatro
variantes de F1, F2/F3/F4/F5 e dois round-trips positivos. São 30 observações totais:
24 invariantes violadas, seis positivas e zero erros inesperados/ignorados. As oito
falhas por engine representam CINCO problemas, não 24 vulnerabilidades distintas.

Os resultados das suítes existentes e verificações finais estão registrados na
entrega. A suíte geral verde NÃO inclui a aceitação dos invariantes negativos desse
script; seus dois testes novos positivos comprovam só compatibilidade de formatos.

| Validação final | Resultado |
| --- | --- |
| Harness independente Node/Edge/Chrome | 30 critérios: 24 violações, 6 positivos, 0 erros inesperados, 0 ignorados; exit 1 |
| Equivalência nova com SDK real no Node | 2 aprovados, 0 falhas |
| npm.cmd test | 686 testes: 682 aprovados, 0 falhas, 4 ignorados dependentes do Emulator |
| Suíte existente Etapa 4 Edge/Chrome | 60 aprovados, 0 falhas/ignorados |
| Suíte existente backend Edge/Chrome | 64 aprovados, 0 falhas/ignorados |
| Suíte existente criptografia Edge/Chrome | 100 aprovados, 0 falhas/ignorados |
| npm.cmd run check | aprovado |
| node --check dos novos assets de auditoria | aprovado |
| git diff --check | aprovado |

Arquivos acrescentados somente para auditoria:

- `docs/auditoria-independente-cofre-etapas1-4.md`;
- `scripts/audit-vault-independent.mjs`;
- `tests/fixtures/vault-independent-audit.mjs`;
- `tests/fixtures/vault-real-format-audit.mjs`;
- `tests/vault-real-formats-audit.test.js`.

O código das Etapas 1–4 e todas as alterações locais anteriores foram preservados.
Os testes negativos não foram convertidos em skips/fixmes nem escondidos com novos
timeouts. O harness é separado da suíte unitária para expor o diagnóstico sem
reescrever os testes de implementação existentes como se aprovassem a segurança.

Limitações: não houve integração experimental, migração, limpeza, produção, App Check,
auditoria de regras de produção, login Google real, E2E do app completo, dispositivos
móveis físicos ou ataque de sistema operacional. Os testes do Emulator dependentes
do ambiente continuam explicitamente ignorados pelo npm test; não foram tratados
como controles comprovados. APIs/harnesses locais não conferem prontidão de produto.

## Ordem recomendada e critérios de liberação

1. Corrigir F1 com teste de identidade por sessão antes de qualquer limpeza global.
   Manter os fences que revogam a sessão ativa legítima; exigir A01/A02/A02C/A03 seguros.
2. Resolver F2 com protocolo de recuperação/custódia que sobreviva a ACK perdido,
   fechamento e senha já perdida. Não depender de manter uma string apenas no heap.
3. Unificar limites de F3 e provar export/import de TODO estado aceito, inclusive
   históricos crescidos, sem truncar operações offline nem recuperações.
4. Corrigir F4 pelo schema de referências e F5 por validação do objeto tipado final,
   mantendo campos adicionais, tipos plain e SDK real equivalentes.
5. Rodar novamente o harness: exigir zero secure:false e zero erros inesperados em
   Node/Edge/Chrome, além de toda a regressão e diff check. Benchmark móvel e rotação
   de chave/capacidade são gates adicionais antes de dados reais.
6. Só então projetar adaptador de serviço/IDB e lifecycle Auth/UI num harness de
   integração sintético, com recuperação e rollback revisados. Migração, integração
   no app principal e publicação continuarão exigindo autorização específica.

Resumo: a fundação tem controles criptográficos e transacionais úteis, mas a
recuperabilidade e o isolamento de sessões ainda não cumprem os contratos. **Apto
somente após correções**, mantendo o aplicativo principal e seus dados intocados.
