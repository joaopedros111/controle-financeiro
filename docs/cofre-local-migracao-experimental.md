# Migração copiadora experimental — somente dados sintéticos

Data: 2026-10-29. Branch `security/cofre-local-etapa1`, HEAD
`2f22aa400bb11395925b5ccb94573c0375cb7a5b`. O checkpoint não foi alterado.
Os dez arquivos da integração anterior foram preservados; nenhum commit foi criado.

## Escopo

Foi implementado um copiador isolado e uma autorização de leitura experimental.
Não existe descoberta automática de dados do usuário, importação de arquivos reais,
troca do backend do aplicativo, alteração de Auth/Firestore, sincronização, UI ou SW.
Os exemplos são fixtures conhecidas, com projetos `demo-*` e UIDs `synthetic-*`.

Origem e destinos são bancos de teste novos. Nenhum banco/cache/fila existente do
aplicativo foi aberto, migrado, limpo ou apagado. Nenhum dado real foi utilizado.
Não houve commit, push, merge ou deploy.

## Arquitetura e estados

```text
Origem sintética explícita e somente leitura para o migrador
  → validar proprietário + formatos + revisão + geração
  → snapshot imutável em memória, codec por documento
  → comparação canônica e SHA-256 por documento / manifesto
  → cofre destino novo: dados originais + manifesto cifrado
  → reler a origem e descriptografar/comparar o destino
  → COPIADO / PREPARADO, sem ativação persistida

Senha reapresentada + segredo independente + declaração de custódia
  → equivalência integral novamente
  → exportar pacote autenticado
  → restaurar em OUTRO banco dedicado, com nova DEK
  → fechar/reabrir e desbloquear essa reconstrução pelo novo segredo
  → comparar novamente todos os documentos e rever as revisões
  → autorização efêmera de leitura do destino original
```

`prepare()` nunca retorna uma conta vazia como recuperação de erro. Se o destino
está ausente, cria uma cópia integral com o controlador, backend e criptografia reais.
Se já existe, autentica-o antes de examinar o manifesto. Só reconhece repetição
quando a origem, sua revisão e todos os documentos continuam equivalentes.
Não substitui um destino existente, não atualiza documentos para fazê-los coincidir
e não gera um novo segredo para uma cópia já existente.

`activate()` não cria o destino quando ele falta. Exige senha, segredo independente
reapresentado, `externalCustodyConfirmed:true` e um segundo destino dedicado para
teste da recuperação. Falta de custódia, segredo errado, divergência, corrupção,
mudança de revisão/geração ou falha na reconstrução interrompem a ativação.

A ativação é um objeto de leitura ligado à identidade da operação. Não existe flag
durável `active=true` que possa ser aceita após reinício sem nova prova. Cada leitura
verifica novamente origem, documentos, revisão do cofre, identidade da chave e fences
do controlador. Novo comando, desativação ou fechamento revogam a autorização anterior.
Erro atrasado de uma autorização antiga não pode revogar sua substituta.

`deactivate()` remove somente a autorização local. Não escreve na origem, não apaga
o destino, não escolhe automaticamente uma fonte de dados e não representa logout
global entre abas. O controlador real continua aplicando suas verificações duráveis
de épocas; o aplicativo principal permanece fora deste mecanismo.

## Perfil explícito da origem

O envelope sintético de origem é versão 1:

```text
format: cf-synthetic-financial-source
version: 1
owner: { projectId: demo-*, uid: synthetic-* }
sourceId: synthetic-*
revision: inteiro positivo monotônico
financialVersion: 3
generation: explícita, não vazia
documents: mapa completo de documentos financeiros
```

O formato físico de teste guarda esse conjunto em um registro IndexedDB, para
leitura consistente. Os corpos e chaves são representativos do aplicativo atual:
`estado:{uid}`, `fila:{uid}`, `restore-recovery:{uid}:*`, `conflicts:{uid}:*` e
`snapshot:{uid}:*`. Este perfil não afirma reproduzir o layout físico do banco legado;
nunca o abre. As fixtures usam normalização apenas na sua construção inicial,
antes de serem gravadas como origem. O migrador não normaliza nem transforma dados.

São preservados os campos efetivamente usados: receitas recebidas/pendentes e
legadas, despesas, categorias, orçamentos, preferências financeiras, `revisao`,
`generation`, IDs, `outbox`, `attempted`, `remoteRevisions`, `conflictDecisions`,
`automaticSettingsDirty/Value`, `settingsBaseline/Revision`, `automaticHistory`,
`automaticResolutions`, `backupJobs`, `restoreJob`, tombstones e referências de
recuperação. Incluem-se campos desconhecidos, opcionais `undefined`, datas,
timestamps em sua forma persistida, bytes e um número fracionário sem arredondamento.

Proprietário divergente, documento de outra conta, ausência de estado/fila,
versão desconhecida, geração ambígua ou operações incompatíveis são erros.
Não se infere `legacy` quando a geração está ausente. Documentos históricos podem
conter seus metadados antigos; a fila ativa precisa de geração explícita coerente.
Um eventual adaptador de outros formatos legados deverá ser versionado e autorizado
separadamente. Nenhum campo é descartado para fazer um formato inválido caber.

## Isolamento físico e capacidades

- Origem: `controleFinanceiro:migration-source:synthetic-*`.
- Destino e reconstrução: `controleFinanceiro:cofre-isolado:v1:synthetic-migration-*`.
- Origem de teste: schema 1, object store `synthetic-origin`.
- Destinos: backend do cofre schema 2 existente, sem alterações.

Adaptadores de origem/destino são capacidades registradas e restritas aos prefixes
sintéticos. O migrador recebe apenas `source.read`; o escritor `editForTest` é
separado e usado exclusivamente para simular alterações externas nos testes.
Inicializar uma origem já existente é recusado. Abrir uma origem ausente sem
snapshot explícito falha, sem fabricar finanças vazias.

As capacidades e os prefixes evitam seleção acidental do armazenamento principal;
não constituem uma prova matemática de que conteúdo arbitrário é sintético. A
proveniência sintética é garantida pelo harness fechado e suas fixtures conhecidas.
Não há seletor de bancos de produção, upload ou caminho de arquivo de usuário.

## Equivalência e evidências

O codec real codifica cada documento separadamente. Uma representação canônica
versionada ordena propriedades de objetos sem alterar ordem dos arrays, números,
tipos, datas, campos ausentes/undefined ou arrays esparsos. Comparam-se as
representações completas, não somente hashes ou totais. O tipo do mapa externo
também é preservado; uma primeira execução revelou diferença entre mapa comum e
mapa sem protótipo, corrigida no retorno sem alterar as expectativas de equivalência.

SHA-256 é calculado por documento e sobre um manifesto que vincula:
proprietário, banco/identificador da origem, versão financeira, codec, perfil de
comparação, revisão, geração, IDs e hashes/tamanhos dos documentos. A revisão da
origem sintética, a revisão financeira e a revisão nova do cofre são domínios distintos:
por exemplo, 17 na origem, 7 no documento financeiro e 1 no novo cofre. A revisão
financeira original não é substituída pela revisão inicial do backend.

O manifesto é um documento adicional cifrado:
`snapshot:{uid}:synthetic-migration-manifest-v1`. Uma colisão com esse ID é recusada.
Nenhum nome livre de categoria é tratado como referência ou metadado.
IDs de documento e cabeçalhos criptográficos continuam metadados visíveis; hashes
financeiros, contagens e o manifesto completo ficam dentro do ciphertext. O chamador
autorizado recebe somente hash agregado e contagens para evidência, sem payloads.

O conjunto sintético principal tem cinco documentos, duas receitas, uma despesa,
duas operações offline, um conflito, um tombstone na fila e um documento de
recuperação. O tombstone histórico em outro documento também é comparado integralmente;
`queuedTombstones` conta apenas tombstones na fila ativa. Logs de navegador mostram
somente SHA-256 e contagens. Segredos, DEKs e dados financeiros não são logados.

O destino deve conter exatamente os documentos originais mais o manifesto; conteúdo
faltante, adicional ou semanticamente alterado interrompe a ativação. O limite
agregado inclui o manifesto antes da primeira cópia. Mantêm-se 8 MiB de documentos,
limites do codec e pacotes de 32 MiB; são aceitos até 999 documentos de origem,
reservando o milésimo para o manifesto. Não foram removidos limites de segurança.

## Atomicidade, falhas e retomada

Web Crypto ocorre fora da transação. O backend confirma estado, fila, documentos,
manifesto, catálogo e revisões conjuntamente via CAS, com reservas duráveis de IV
antes de cifrar. Falhas podem consumir reservas, que nunca são recicladas; não
podem deixar um subconjunto de documentos financeiros confirmado.

Uma cópia confirmada cujo ACK se perdeu permanece preparada. Repetir o comando
reconhece o conteúdo, mas não inventa um segredo que não chegou ao chamador.
Sem caminho de recuperação verificável, a ativação para. A origem continua intacta;
um novo destino dedicado pode ser escolhido explicitamente, sem apagar o anterior.

Se a origem muda após a cópia, o destino anterior é conservado e não é atualizado
silenciosamente. Uma nova migração requer nova seleção explícita de destino. A revisão
monotônica detecta A–B–A mesmo com conteúdo final igual. Duas abas podem competir:
somente um CAS inicial cria o cofre; a outra pode reler e reconhecer a cópia, sem
criar outro snapshot financeiro. Não se depende somente de locks em memória.

O teste de recuperação usa outro banco, nunca a origem ou o destino principal.
Importação valida o pacote, cria uma DEK nova e reconstrói integralmente o grafo.
Falha nessa reconstrução deixa a cópia principal preparada; repetir com novo banco
de recuperação não sobrescreve tentativas anteriores. Bancos sintéticos e reservas
de tentativas falhas são retidos, sem limpeza automática.

Depois de reiniciar o navegador, o harness reapresenta senha/segredo mantidos apenas
na RAM do processo Node que simula o custodiante independente. Nada é gravado no
perfil para desbloqueio automático. Exigir a declaração de custódia e demonstrar
posse não provam armazenamento externo durável por uma pessoa; mantém-se essa limitação.

## Cobertura dos cenários pedidos

| Cenário | Critério automatizado |
| --- | --- |
| Antes da primeira gravação | Interrupções em `source-read` e `before-create`; zero snapshots financeiros |
| Preparação criptográfica | Reserva durável falha; nenhuma cópia parcial; retry íntegro |
| Quota | Commit recusado; origem e destino anterior preservados |
| Commit | Abort após puts reverte snapshot/catálogo; ACK perdido não gera segredo fictício |
| Reinício | Redescoberta preparada; nenhuma ativação automática; prova offline novamente |
| Repetição | Mesmos hashes; um snapshot; credenciais não substituídas |
| Origem modificada | Antes/depois de criar e antes de ativar: interrupção sem sobrescrita |
| Duas abas | Corrida CAS real; uma criação financeira; repetição reconhecida |
| Destino existente | Cofre alheio à migração recusado depois de autenticado; bytes mantidos |
| Corrupção | Ciphertext adulterado não vira conta vazia nem é substituído |
| Chave indisponível | Senha errada, segredo errado e falta de custódia recusam ativação |
| Recuperação interrompida | Destino de teste sem commit parcial; principal/origem mantidos |
| Divergência legítima no destino | Edição posterior preservada e ativação/leitura recusadas |
| Sessão antiga | Desativação interrompe operação pendente; erro atrasado não revoga substituta |
| Origem inválida/ausente | Falha explícita; nenhuma inicialização financeira |
| Confidencialidade | Destino inspecionado sem nomes, valores, IDs de lançamento, senha ou segredo |

As 30 provas compartilhadas rodam em Node e em IndexedDB real nos navegadores.
O harness de navegador acrescenta isolamento de armazenamento, duas páginas reais
e fechamento/reabertura completa do processo com ativação e recuperação offline.
Os perfis são novos e exclusivamente sintéticos; SW e rede externa ficam bloqueados.

## Arquivos desta etapa

Novos:

- `experimental/finance-vault-migration.js`: copiador, manifesto, equivalência e autorização efêmera.
- `experimental/finance-vault-migration-storage.js`: capacidades e origem IndexedDB sintética.
- `tests/fixtures/vault-migration-scenarios.mjs`: fixtures representativas e 30 cenários.
- `tests/fixtures/vault-migration-browser.mjs`: exports para o bundle isolado de navegador.
- `tests/finance-vault-migration.test.js`: execução Node dos cenários.
- `scripts/run-vault-migration-browser.mjs`: Edge/Chrome, bancos reais, abas e reinício.
- `docs/cofre-local-migracao-experimental.md`: este relatório.

Modificado:

- `tests/fixtures/vault-browser-store.mjs`: opção restrita `prefix:'migration-'` e
  exposição do nome do banco de teste. O comportamento padrão permanece igual.

Os dez arquivos novos da etapa de integração continuam presentes. Não se alteraram
os módulos principais de criptografia, catálogo, backend, recuperação, dados financeiros,
autenticação, Firestore, sincronização, interface, SW ou dependências.

## Execução

```powershell
node --test tests/finance-vault-migration.test.js
node scripts/run-vault-migration-browser.mjs
node scripts/audit-vault-independent.mjs
node scripts/run-vault-integration-emulator.mjs
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

A suíte geral usa a execução sequencial já validada no ambiente, sem remover
asserts ou testes. O timeout de 180 segundos é por arquivo, em lugar de espera
ilimitada. Os resultados completos constam abaixo.

Firebase não faz parte do copiador e não recebe dados nesta migração. O runner de
integração anterior é executado com Auth/Firestore Emulator e projeto `demo-*`
como regressão do adaptador, sem configuração de produção. Não se declara testada
migração de caches do SDK, protocolo alternativo de épocas, OAuth Google ou ativação
no aplicativo publicado.

## Limitações, rollback e próxima fase

Não existe transação distribuída entre dois bancos independentes. São feitas
releituras, hashes e verificação de revisões antes/depois das etapas e de cada leitura
autorizada. Mudança observada interrompe a autorização; não se promete impedir um
escritor externo de alterar armazenamento depois de uma verificação. A ativação
não autoriza escrita e não é persistida como uma verdade para sempre.

Rollback experimental significa revogar a autorização e manter os dois lados para
comparação. Não há escolha automática de origem: depois de uma edição posterior no
destino, voltar a uma cópia antiga perderia intenção. O teste exige conservar essa
edição e interromper a leitura/ativação, não revertê-la.

Permanecem XSS/malware, objetos/chaves já em memória, custódia perdida, força da senha,
rollback integral coordenado sem âncora externa, evicção do navegador e falhas físicas.
As falhas de quota/ACK/abort são injetadas; não equivalem a teste de queda de energia.
Continuam pendentes benchmark móvel, custo de recriptografar snapshots, crescimento
dos bancos de recuperação e política de rotação da DEK/limite de IVs. Nenhum segredo
ou chave descriptografada é persistido pelo mecanismo.

Critérios de aceitação: origem preservada; grafo exato e proprietário/versionamento
explícitos; uma cópia atômica; nenhuma perda/duplicação de operações; recuperação
reconstruída e reaberta; erros sem ativação/fallback vazio; rejeição de concorrência
e sessões antigas; nenhuma alteração no aplicativo principal ou dados reais.

Recomendação: com os testes abaixo aprovados, avançar somente para operações de escrita
**ainda sintéticas**, com intenções duráveis, recuperação após novas edições e rollback
com reconciliação explícita. Ciclo Auth/UI/SDK, migração de outros formatos, dispositivos
reais e qualquer migração de dados financeiros reais exigem autorização e validação próprias.

## Resultados executados

| Execução | Aprovados | Falhas | Ignorados | Saída |
| --- | ---: | ---: | ---: | ---: |
| Migração específica em Node | 30 | 0 | 0 | 0 |
| Migração Edge e Chrome | 66 | 0 | 0 | 0 |
| Harness independente Node/Edge/Chrome | 30 | 0 | 0 | 0 |
| Integração Auth/Firestore Emulator anterior | 7 | 0 | 0 | 0 |
| Suíte geral, 746 testes descobertos | 741 | 0 | 5 | 0 |
| `npm.cmd run check` | Aprovado | — | — | 0 |
| Sintaxe dos seis novos arquivos JS | Aprovada | — | — | 0 |
| `git diff --check` | Aprovado | — | — | 0 |

A suíte geral terminou sem intervenção e sem nenhum arquivo atingir o timeout.
Inclui novamente os testes de criptografia, codec/Timestamp real, backend,
atomicidade, concorrência, catálogo, recuperação, integração, migração e restauração
do pacote legado de exatamente 4.522.367 bytes. Os scripts anteriores executados
pela suíte mantiveram criptografia 100/100, backend 64/64, Etapa 4 72/72 e integração
50/50 em Edge/Chrome. Os totais se sobrepõem; não devem ser somados como casos exclusivos.

Os cinco ignorados da suíte geral são os quatro grupos existentes dependentes de
Emulator/configuração própria e o grupo de integração Emulator, que foi executado
separadamente (grupo + seis subcenários, todos aprovados). Os outros grupos de
regras/protocolo alternativo de épocas não foram executados por seus runners nesta
etapa. Não são testes de migração ignorados nem autorização para afirmar cobertura
completa de protocolos remotos.

O harness independente confirmou zero violações e zero erros inesperados, mantendo
as seis provas positivas anteriores e a resolução das 24 violações históricas.
O copiador não enviou documentos ao Firebase; o Emulator validou a não regressão
da integração sintética anterior, não uma migração de Firestore ou de seu cache.

Exemplos de evidência do teste de duas abas, somente com hashes de fixtures:

| Motor | SHA-256 do manifesto da origem | Contagens |
| --- | --- | --- |
| Edge | `92eb7f50e82659ea701708e53a8f64bed777407156d43fe6e6586c1c25b4288c` | 5 docs, 2 receitas, 1 despesa, 2 operações offline |
| Chrome | `711235447a5c258c2ba51a8b63c2d6f6af28e155542a68039a2217a03fb918dc` | 5 docs, 2 receitas, 1 despesa, 2 operações offline |

Os hashes diferem porque incluem a identidade do banco sintético criado em cada
execução. Dentro de cada cenário o conteúdo da origem permaneceu igual, houve
exatamente um snapshot financeiro no destino e uma repetição foi reconhecida sem
reescrita. Na prova de reinício, o hash reconhecido permaneceu igual após reabrir
o perfil, e a leitura liberada correspondeu estruturalmente a todos os documentos.

Revisão final: os oito arquivos desta etapa não contêm padrões de credenciais reais,
marcadores de conflito ou espaços finais. Fixtures e senhas fixas são declaradamente
sintéticas; segredos gerados e chaves descriptografadas não foram escritos em arquivos.
O HEAD continua `2f22aa4`, sem staging/commit novo. O diff rastreado contém somente
a ampliação do helper de testes; os arquivos principais e de produção permanecem iguais.

## Decisão de homologação

**Migração copiadora exclusivamente sintética homologada para o perfil documentado,
com ativação experimental somente leitura, origem preservada e recuperação verificada.**

É possível iniciar uma próxima fase isolada de escritas sintéticas e reconciliação,
com nova autorização. Não está homologada migração de dados reais, ativação no fluxo
principal, retirada da origem legada, sincronização de gerações remotas ou publicação.
Não foi contornado qualquer erro para liberar a ativação: divergência de proprietário,
equivalência ou impossibilidade de recuperação continuam interrompendo a operação.
