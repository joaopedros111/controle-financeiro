# Evidências — C01/C02

## Segunda rodada — 12/11/2026

Classificação: **IMPLANTAÇÃO BLOQUEADA**, independentemente das contagens de teste,
por incompatibilidade de escrita de clientes antigos com regras estritas e
ausência de CAS/completude servidor nas configurações. Não houve consulta de
produção para inventário, nem alteração de dados reais ou publicação.

Os resultados finais desta rodada são registrados abaixo após conclusão das
execuções. Os resultados seguintes de 11/11 continuam preservados como histórico.

## Primeira rodada — 11/11/2026

Data local: 11/11/2026. Ambiente: Windows, Node 24.21.0, Java 21,
Firestore Emulator 1.22.0 já instalado. Sem instalação/atualização de dependências.

## Execuções finais

| Comando | Aprovados | Reprovados | Ignorados |
| --- | ---: | ---: | ---: |
| `npm.cmd test` | 1006 | 0 | 11 |
| `node --test --test-concurrency=1 tests/firestore-integrity.test.js tests/firebase-sync-client.test.js tests/firestore-rules.test.js` no Emulator local | 63 | 0 | 0 |
| `npm.cmd run test:integrity` (runner final reproduzível) | 63 | 0 | 0 |
| `node --test --test-concurrency=1 tests/finance-vault-emulator.test.js tests/finance-vault-real-emulator.test.js tests/finance-epoch-rules.test.js` com emuladores locais | 22 | 0 | 0 |
| `npm.cmd run check` + sintaxe de transporte, runner e novos testes | sucesso | 0 | 0 |
| Build local `prepararArtefatoPages`, contador sintético `1` | sucesso | 0 | 0 |
| `git diff --check` | sucesso | 0 | 0 |

As 11 entradas ignoradas no comando global dependem do Emulator: oito pertencem
às suítes de regras/cliente/gerações e três aos protocolos experimentais. Foram
executadas nas duas linhas específicas seguintes, com seus subtestes. Os números
das linhas não devem ser somados como testes distintos: há sobreposição.

O Emulator final de regras foi iniciado diretamente com o JAR local e parâmetros
`--host 127.0.0.1 --port 8280 --project_id demo-integrity-final`, em sessão própria.
As variáveis `FIRESTORE_EMULATOR_HOST`, `NO_PROXY` e `no_grpc_proxy` foram limitadas
ao processo de teste. Os testes validam host loopback e usam projetos `demo-*`.
Os 22 testes adicionais usam 8080/9099, projetos separados; `demo-vault-integration`
recebeu as regras publicadas apenas nesse Emulator, e Epoch seu arquivo próprio.

O comando `node scripts/run-local-tests.mjs integrity` também foi executado
durante o desenvolvimento. Primeiras rodadas falharam e não são classificadas
como aprovadas: expuseram o limite RE2, caixa hexadecimal e concorrência descritos
no relatório. Os resultados finais acima correspondem à implementação corrigida.

## Navegadores

Resultados:

- `node scripts/run-local-tests.mjs integrity-browser`: regras candidatas,
  Edge e Chrome, perfis e site temporários, suíte principal: **100 aprovados,
  0 reprovados, 0 ignorados**, em 15,8 minutos.
- `node scripts/run-local-tests.mjs google-account`: regras publicadas,
  Edge e Chrome, suíte específica de autenticação/isolamento: **65 aprovados,
  1 timeout, 0 ignorados**, em 11,8 minutos. A suíte principal com candidato
  também cobre Auth, troca de UID e multiaba.

O timeout ocorreu no último cenário Chrome, após reload com Firestore retido.
O trace mostra clique em `#adicionar-receita` seguido de espera para preencher
um campo oculto. Isso localiza a falha, mas não estabelece sua causa. A repetição
isolada sem alterar o teste passou em 14,2 segundos. Uma hipótese de bootstrap
foi testada acrescentando a barreira de inicialização de `start()`: a repetição
produziu **2 aprovados no Edge, 1 timeout no Chrome e 1 não executado** por
`maxFailures=1`. A hipótese foi insuficiente e a alteração do teste foi retirada.
O limite de 60 segundos e as verificações financeiras foram preservados.
A suíte de contas não é classificada como 66/66 aprovada. Este cenário continua
como pendência de homologação, sem ocultar a falha por retries automáticos ou
aumento de timeout.

Controle de referência: os módulos `firebase-sync-entry.js` e
`finance-generation-transport.js` foram extraídos do commit homologado para uma
cópia temporária; o runner de teste foi copiado e apontado a esses módulos,
mantendo aplicação, teste original, regras publicadas e emuladores sintéticos.
O cenário Chrome repetido duas vezes passou: **2 aprovados, 0 falhas, 0 ignorados**
em 27,9 segundos. O candidato também teve uma repetição isolada aprovada, mas
falhou nas outras rodadas. Esta amostra não estabelece se o timeout é regressão
ou falha intermitente anterior; não se afirma nenhuma dessas causas. Investigar
esse cenário continua necessário para aprovação integral. As cópias de baseline
foram preservadas no temporário e retiradas da árvore de trabalho.

O comando global incluiu ainda verificações reais de IndexedDB/criptografia em
Edge e Chrome: backend (64), crypto (100), integração (50) e stage4 (72), todas
aprovadas. Elas são executadas por scripts contados na linha global, não devem
ser adicionadas novamente à contagem de `node --test`.

## Artefatos preservados

Logs finais locais (ignorados pelo Git):

- `integrity-global-final.log`
- `integrity-rules-final.log`
- `integrity-runner-final.log`
- `integrity-additional-emulator.log`
- `integrity-browser.log`
- `integrity-account-browser.log`
- `integrity-account-retest.log`
- `integrity-account-reload-final.log`
- `integrity-account-baseline.log`
- `integrity-check-final.log`
- `integrity-build.log`

Diretórios temporários sintéticos:

- E2E candidato: `C:\Users\T03469~1\AppData\Local\Temp\controle-financeiro-homolog-DVabZL`.
- E2E contas: `C:\Users\T03469~1\AppData\Local\Temp\controle-financeiro-homolog-IYByRp`.
- Repetição Chrome sem alteração do teste: `C:\Users\T03469~1\AppData\Local\Temp\controle-financeiro-homolog-6EiHcp`.
- Repetição da hipótese de bootstrap: `C:\Users\T03469~1\AppData\Local\Temp\controle-financeiro-homolog-Inrvxr`.
- Runner final de integridade: `C:\Users\T03469~1\AppData\Local\Temp\controle-financeiro-homolog-Qd1o7O`.
- Controle com transportes do commit inicial: `C:\Users\T03469~1\AppData\Local\Temp\controle-financeiro-homolog-WzVzEq`.
- Build completo: `C:\Users\T03469~1\AppData\Local\Temp\cf-integrity-build-vz20ec`.
- Diagnóstico/coverage: `C:\Users\T03469~1\AppData\Local\Temp\cf-integrity-diagnostics-1555ac829f00462da6290c46f905a802`.

O build sintético retornou versão `1.1.10` e cache
`controle-financeiro-pwa-cache-v21`; fonte `1.1.9` permaneceu intacta.
Essa numeração de teste não representa publicação. A referência e a versão de
produção informada no pedido continuam preservadas.

## Git e preservação

Branch: `fix/firestore-integridade`.
HEAD e `main`: `e0f6e2c54e92655432b0304ee35729f1d5a08769`.
Árvore inicial limpa. Nenhum commit, push, merge ou deploy.

`git diff --exit-code` contra a referência confirmou ausência de mudanças em
`firestore.rules`, `firestore.epoch.rules`, `firebase.json`, `app.js`,
`indexeddb-persistence.js`, `sw.js`, `version.json` e `package-lock.json`.

`git status --short`:

```text
 M finance-generation-transport.js
 M firebase-sync-entry.js
 M package.json
 M scripts/run-local-tests.mjs
 M tests/firebase-sync-client.test.js
 M tests/firestore-rules.test.js
?? docs/FIRESTORE-INTEGRIDADE-C01-C02.md
?? docs/FIRESTORE-INTEGRIDADE-RESULTADOS.md
?? firestore.integrity.rules
?? tests/firestore-integrity.test.js
```

`git diff --stat` (arquivos rastreados):

```text
 finance-generation-transport.js    | 12 ++++++++++--
 firebase-sync-entry.js             | 15 +++++++++++++--
 package.json                       |  2 ++
 scripts/run-local-tests.mjs        |  9 +++++----
 tests/firebase-sync-client.test.js | 28 ++++++++++++++++++++++++----
 tests/firestore-rules.test.js      | 18 +++++++++++-------
 6 files changed, 65 insertions(+), 19 deletions(-)
```

Os quatro arquivos novos estão indicados por `??`; o `git diff --stat` padrão
não os inclui. Nada foi adicionado ao index nem houve commit automático.

## Classificação

**Aprovação parcial local; implantação bloqueada.** As garantias de lançamentos
foram testadas. A ativação ainda exige inventário autorizado de legado,
identificação administrativa da release e tratamento validado de clientes
antigos. Configurações financeiras mantêm CAS de cliente, fora da garantia de
servidor implementada para lançamentos. O timeout Chrome descrito acima também
impede classificar toda a homologação de contas como aprovada. Não houve qualquer alteração em dados
reais. Ver `FIRESTORE-INTEGRIDADE-C01-C02.md` para contrato e rollout completo.
