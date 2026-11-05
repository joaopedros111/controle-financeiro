# Homologação integrada experimental do cofre

Base confirmada antes das alterações: `security/cofre-local-etapa1`, HEAD
`1e0f4a57d555e09b66a6bd58dd15cd119d053341`. As sete alterações rastreadas e os
15 arquivos novos das fases anteriores foram preservados. Sem commits nesta etapa.

## Limite de ciclo de vida identificado antes de implementar

O `app.js` inicia armazenamento/estado anônimo antes de Auth e assume dados
disponíveis para renderizar. O adaptador cifrado é vinculado a proprietário e
não pode tratar bloqueio como estado `@local` vazio. Substituir esse bootstrap ou
adaptar seus globais exigiria uma mudança significativa de ciclo de vida.
**Essa parte está interrompida e não será implementada nesta etapa.**

O harness terá interface experimental própria e coordenará os módulos reais:
`criarFirebaseSync` por runtime oficial em memória, `AutomaticFinanceSync`,
`ServicoFinanceiroAtomico`, adaptador cifrado, controlador, codec, Web Crypto e
IndexedDB dedicado. Não se declarará homologado o DOM/bootstrap de app.js com cofre.
A regressão do app padrão será executada separadamente.

O experimento exige configuração explícita, projeto demo, contas synthetic,
endpoints exatos de loopback e bancos com prefixo synthetic-integrated. Não há
leitura/migração do banco financeiro existente nem alteração de configuração,
regras, interface publicada ou Service Worker.

## Arquitetura implementada

```text
Configuração explícita do harness (demo + synthetic + loopback + banco dedicado)
  → interface experimental → coordenador de sessão/época
    → Firebase Auth real em memória → Auth Emulator
    → criar/desbloquear/recuperar → adaptador cifrado real
      → controlador + codec + Web Crypto + IndexedDB real
    → ServicoFinanceiroAtomico real → estado e fila no mesmo commit cifrado
    → AutomaticFinanceSync real → fábrica Firebase pelo runtime oficial
      → Firestore SDK com memoryLocalCache → Firestore Emulator/regras reais
```

`experimental/finance-vault-integrated-session.js` coordena a autorização sem
reimplementar reconciliação, coalescência, tombstones, restauração por geração ou
protocolo remoto. Os cálculos/validações são de finance-core, as intenções passam
pelo serviço atômico e o ciclo automático executa snapshot/reconciliação/envio/
ACK/settings/históricos/listeners reais. O leitor legado injetado retorna ausência
somente para a origem sintética conhecida, nunca como resposta a erro do cofre.

`experimental/finance-vault-integrated-browser.js` compõe os SDKs pela API oficial
`criarFirebaseSync(config, runtime)`: initializeAuth/inMemoryPersistence e
initializeFirestore/memoryLocalCache são conectados aos Emulators imediatamente.
Login usa o protocolo real do Auth Emulator com token JSON sintético. Não representa
Google OAuth homologado. Não há Auth persistente, cache financeiro persistente do
SDK, importação por arquivo ou escolha de banco do aplicativo publicado.

O runner serve apenas HTML experimental e bundle em memória em `127.0.0.1`.
Só o documento com `experimental_vault=1` e namespace sintético válido recebe
configuração e módulo. Sem opt-in não inicializa SDK ou banco. CSP e interceptação
de rede permitem somente a origem local e `127.0.0.1:9099`/`:8080`. Não se
transforma código de SDK, não se troca resposta financeira por mock no browser e
não se inicializa a configuração Firebase do projeto publicado.

Os processos de Emulator usam `demo-vault-integration`, configuração/logs novos,
regras copiadas do repositório sem alteração e variáveis de credenciais removidas
apenas do processo filho. Portas ocupadas recusam início; não encerram serviços
existentes. Perfis e bancos sintéticos são retidos, sem limpeza.

## Autenticação, desbloqueio e custódia

Auth e posse da chave são autorizações distintas. Cada intenção de login/logout
revoga imediatamente a autorização financeira e limpa o DOM. Intenções de Auth
são serializadas; eventos de conta superada não reabrem seu cofre. Não se concede
acesso por UID sozinho. Antes/depois dos awaits são conferidas identidade da
operação, proprietário, sessão do sincronizador e autorização do adaptador.

Logout/lock fecham o sincronizador e seus listeners, revogam o adaptador antes do
await do fence durável, aguardam a limpeza e fecham a conexão. A próxima sessão
aguarda essa limpeza para impedir que um lock antigo revogue o novo desbloqueio.
Uma requisição remota já enviada pode ser aplicada antes do logout; a resposta
antiga não confirma a fila ou a interface nova. Reabertura reenvia o mesmo ID e
recebe o recibo imutável, sem duplicar o lançamento.

Criação exige status autenticável `missing`, comando explícito e documentos
sintéticos completos. Antes de permitir escrita, exporta o grafo integral,
restaura em outro banco vazio com DEK nova, compara todos os documentos/geração,
bloqueia e reabre por segredo independente. A senha desse destino de prova é
aleatória e efêmera; não é uma credencial fixa do protocolo.

Depois da prova, a interface entrega o segredo e exige reapresentação mais declaração
de custódia externa. Só então grava a autoridade cifrada vinculada ao proprietário
e keyId e inicia o sincronizador. Senha correta sem custódia ainda não libera
edição. Interrupção da preparação mantém esse bloqueio; o segredo guardado permite
retomar a confirmação. Não há recriação silenciosa de destino existente.

O segredo reabre o cofre atual, incluindo novas revisões, fila tentada e conflitos;
não restaura a cópia antiga sobre ele. Uma prova independente é refeita para essa
recuperação. Os destinos de prova recusam existência e nunca sobrescrevem outro
snapshot. São cópias de QA, não substitutos de backup externo: suas credenciais
efêmeras são descartadas após a prova. Posse/reabertura e declaração não comprovam
custódia externa durável; perder senha e todos os segredos continua irrecuperável.

## Estados e interface

| Estado | Conteúdo e operações |
| --- | --- |
| signed-out / authenticating / signing-out / checking | Dados e campos financeiros removidos; sem autorização financeira |
| missing | Conta autenticada sem cofre; oferece criação explícita, não saldo zero |
| creating / custody | Sem finanças visíveis ou escrita; prova e custódia ainda necessárias |
| locked / unlocking / recovery-required | `data:null`, pendências desconhecidas (`?`); senha/segredo são necessários |
| offline / pending / syncing | Dados autorizados da conta atual, com indicação de trabalho não confirmado |
| synced | Somente após confirmação global real e conferência de pendências atuais |
| recovery-history | Dados ativos confirmados, mas há conteúdo arquivado/aviso de recuperação |
| error | Falha explícita; erros de storage revogam a autorização e ocultam dados, sem inicializar vazio |
| closed | Listeners e autorização encerrados |

O renderer remove os nós financeiros com replaceChildren, usa textContent e limpa
inputs em transições. Não há apenas uma máscara CSS sobre conteúdo anterior.
Callbacks de interface e retorno de ações verificam a época, inclusive para não
entregar o segredo de A ou apagar um campo de B com um finally atrasado de A.
Metadados de geração/pendências/histórico também são removidos na troca.

Edição e restauração entram em pendente antes de mudar o estado exibido. Snapshot
recebido não significa sincronização. A indicação synced depende do ACK global
real e nova leitura da fila, incluindo settings, restoreJob, conflitos, históricos
e resoluções pendentes. A UI não remove o aviso de histórico para obter estado verde.

## Persistência, conflitos e interrupção

Receitas/despesas/edições/exclusões são intenções do serviço real, com IDs, geração,
baseRevision, attempted e tombstones preservados. Estado e fila compartilham o
snapshot/manifesto/catálogo atômico. Reservas de IV confirmadas não são recicladas
quando uma gravação falha. A serialização de leitura e escrita no adaptador
experimental evita ler durante seu próprio prepare/commit; Web Locks coordenam
instâncias cooperantes, e CAS/época continuam obrigatórios dentro da transação.

O sincronizador usa sua política automática existente: conflito de edição escolhe
versão confirmada do servidor e preserva a alternativa local em automaticHistory.
O teste cria a concorrência com outro cliente SDK real autenticado no mesmo UID,
enquanto o browser mantém sua edição offline. Não há escolha remota simulada.
Exclusão resulta em tombstone conferido no snapshot do servidor.

O ACK atrasado é retido somente depois da transação SDK real aplicada. Logout e
A–B–A provam que ele não confirma a nova sessão. Outro cenário encerra o processo
com esse ACK ainda retido: o novo processo faz login sintético, desbloqueia offline,
reencontra o mesmo ID e attempted, e recebe o recibo único ao reconectar.

A restauração usa importBackup/publishRestore reais. Primeiro arquiva o estado e
a fila anterior, troca geração e cria restoreJob no mesmo commit. O browser é
encerrado offline antes de publicar. No novo processo o job retoma, publica a nova
geração no Emulator e só desaparece após confirmação. O arquivo cifrado preserva
as operações anteriores e o aviso de recuperação. Não há rollback para origem
legada, limpeza de fila para contornar erro ou importação sobre cofre mais recente.

## Evidências de isolamento e armazenamento

- Bancos principais/provas: `controleFinanceiro:cofre-isolado:v1:synthetic-integrated-*`.
  Os nomes são escolhidos pelo harness, não por leitura do banco financeiro.
- Auth e Firestore usam somente memória no cliente. A listagem de bancos recusa
  cache financeiro/Auth persistente ou qualquer nome fora da lista explícita.
- O SDK real cria `firebase-heartbeat-database`, confirmado no código instalado de
  `@firebase/app`. Seus stores também são lidos e inspecionados; os objetos só
  podem conter heartbeats/lastSentHeartbeatDate. É metadado técnico do SDK, não
  exceção para dados financeiros ou credenciais. Nada é apagado para obter aprovação.
- Todos os stores dos bancos do perfil são inspecionados, incluindo esse banco.
  Procuram-se nomes, valores, IDs de registros, senha e segredos de ambas as contas.
  Objetos CryptoKey persistidos são rejeitados, inclusive quando JSON.stringify
  não revelaria suas propriedades. localStorage/sessionStorage/Cache Storage vazios.
- O teste de B lê diretamente documento de A pelo SDK, sem a guarda do cliente;
  o servidor responde permission-denied. A interface de B não contém registros de A.
- CSP e allowlist de rede bloqueiam outros destinos; a matriz final exige zero
  requisições fora da lista. O Node peer também usa runtime restrito aos Emulators.

UIDs, IDs de documento, tamanhos, gerações, revisões, envelopes, IVs e fingerprints
continuam metadados visíveis. Não se promete ocultá-los. O Firestore Emulator recebe
finanças sintéticas pelo protocolo atual; cofre local não significa E2EE remoto.

## Falhas identificadas e correções

| Achado | Correção/evidência |
| --- | --- |
| Runner resolveu bundle a partir do diretório temporário do Emulator | absWorkingDir explícito; primeira execução falhou antes dos cenários |
| Fixture de despesa parcial produzia divergência no ACK global | A interface experimental agora constrói os campos canônicos do app (fixa/serie/parcela); não se alterou a regra real de confirmação |
| UI anunciava locked antes de terminar limpeza/reabertura | Fase checking até finalizar; intenções Auth serializadas e callbacks por época; recuperação repetida |
| Leitura concorrente com escrita no adaptador experimental | Leituras e writes coordenados na mesma fila e Web Lock, mantendo CAS/fences |
| A nova implementação de ler lançou erro síncrono em lease antigo | Mantido async/Promise do contrato anterior; regressão SDK A–B–A voltou a passar |
| Teste exigia synced depois de arquivar operações em restauração | Exige confirmação ativa e outbox vazia, preservando recovery-history e aviso não reconhecido |
| Banco auxiliar real do SDK não estava inventariado | Heartbeat inventariado e inspecionado por esquema; outros bancos permanecem proibidos |
| Falha de leitura poderia ocorrer em diagnóstico antes do clique de teste | Falhas reais de leitura revogam autorização/limpam UI; injeção e ação são disparadas no mesmo turno para testar a falha sem clicar num botão já bloqueado |
| Auth pode não emitir evento ao autenticar novamente o mesmo UID | UserCredential do SDK real confirma a identidade; a sessão anterior é revogada e exige novo desbloqueio; testes Node e ambos os browsers |
| Confirmação assíncrona poderia publicar status de leitura anterior | Contador de status invalida respostas superadas, além da época; removida leitura redundante no fim do desbloqueio |
| Possível indicação otimista ao receber estado ou editar | Estado recebido fica syncing/offline; edição começa pendente; confirmação relê as pendências |

Os ensaios reprovados terminaram com saída 1 e estão nos logs temporários; não foram
transformados em skips, não se aumentaram os tempos para esconder falhas e não se
apagaram perfis/bancos. Nenhuma falha observada exigiu alterar app.js ou regras.
O protocolo recusou confirmação quando os formatos divergiam, em vez de declarar
sucesso indevido. Snapshots/filas foram preservados nos erros exercitados.

## Arquivos desta etapa

- Novo `experimental/finance-vault-integrated-session.js`: coordenação local e gates.
- Novo `experimental/finance-vault-integrated-browser.js`: UI experimental e SDK real.
- Novo `scripts/run-vault-integrated-browser.mjs`: matriz Edge/Chrome e peer SDK Node.
- Novo `scripts/run-vault-integrated-emulator.mjs`: serviços/configuração temporários.
- Novo `tests/finance-vault-integrated.test.js`: testes Node do coordenador.
- Alterado `experimental/finance-vault-real-adapter.js`: status e coordenação de
  leituras/escritas, preservando o contrato Promise e os serviços reais.
- Novo `docs/cofre-local-homologacao-integrada.md`: este relatório.

Os sete diffs rastreados da etapa anterior permanecem com os mesmos conteúdos;
não se modificaram o aplicativo publicado, seu bootstrap, autenticação padrão,
configuração de produção, regras, Service Worker ou IndexedDB financeiro atual.
Não há dependências novas, bundle de produção gerado, staging ou commit.

## Execução reproduzível e resultados

```powershell
node --test tests/finance-vault-integrated.test.js tests/finance-vault-real-adapters.test.js
node scripts/run-vault-integrated-emulator.mjs
node scripts/run-vault-real-emulator.mjs
node scripts/run-app-injection-browser.mjs
node scripts/audit-vault-independent.mjs
npm.cmd test -- --test-concurrency=1 --test-timeout=180000
npm.cmd run check
git diff --check
```

O runner integrado requer Emulators explicitamente ativos; seu wrapper os inicia
com configuração local isolada. No Node, o coordenador usa modelo transacional e
modelo do remoto só para testes de estado/concorrência; esses casos não são alegados
como IndexedDB/SDK real. No browser integrado todos esses componentes são reais.

| Verificação | Aprovados | Falhas | Ignorados | Saída |
| --- | ---: | ---: | ---: | ---: |
| Coordenador integrado Node | 9 | 0 | 0 | 0 |
| Coordenador + adaptadores reais Node | 31 | 0 | 0 | 0 |
| Ciclo único Edge/Chrome + Auth/Firestore Emulator | 30 | 0 | 0 | 0 |
| Regressão SDK/Emulator anterior | 5 | 0 | 0 | 0 |
| Regressão do aplicativo completo com defaults/injeção sintética | 12 | 0 | 0 | 0 |
| Harness independente Node/Edge/Chrome | 30 | 0 | 0 | 0 |
| Suíte completa `npm.cmd test` | 807 | 0 | 6 | 0 |
| `npm.cmd run check` | Aprovado | — | — | 0 |
| Sintaxe dos seis arquivos experimentais envolvidos | Aprovada | — | — | 0 |
| `git diff --check` | Aprovado | — | — | 0 |

A suíte geral descobriu 813 testes: 807 aprovados, seis ignorados, nenhum cancelado,
em 545,3 segundos. Foi executada antes dos ajustes finais de relogin no mesmo UID
e ordenação de status. Após esses ajustes passaram novamente os 31 testes
específicos e os 30 grupos browser/Emulator; não houve segunda execução integral.
Totais se sobrepõem; não
somá-los como testes exclusivos. O runner integrado é separado de node --test,
para que a descoberta da suíte não inicialize serviços implicitamente.

Os 30 correspondem a 15 grupos de verificações por motor: opt-in ausente,
criação/custódia, CRUD/ACK global, tombstone real, lock/senha incorreta, offline,
conflito concorrente, ACK atrasado/A–B–A/negação cruzada, relogin no mesmo UID,
ACK perdido com reinício,
quota, leitura falha, recuperação independente, restore interrompido/reinício e
inspeção integral do armazenamento. Cada grupo contém várias asserções.

Na matriz Node também passaram intenções rápidas de Auth, custódia interrompida
antes de confirmar, catálogo inválido com operação pendente e rejeição de
recriação sobre um cofre existente. O harness independente mantém 30 critérios
sem violações/erros/ignorados nas fundações; não constitui auditoria externa
completa da nova interface/coordenador.

**Ignorados:** seis grupos condicionais na suíte geral: quatro de regras/protocolo,
um SDK/Emulator da primeira integração e um SDK/Emulator de adaptadores reais.
Este último foi executado separadamente (5/5); os outros cinco não foram repetidos
com Emulator nesta etapa. Nenhum caso integrado Node ou browser/Emulator foi
marcado como skip.

**Não executados:** os fluxos listados na seção de limitações; runners específicos
de regras/protocolo alternativo de épocas e o grupo SDK/Emulator da primeira fase
de integração não foram repetidos. A regressão SDK de adaptadores reais foi
executada separadamente com 5/5, não inferida a partir de um skip.

Evidências fora do Git: `%TEMP%/cf-integrated-delivery-node.log`,
`cf-integrated-final-integrated.log`, `cf-integrated-session-node.log`,
`cf-integrated-final-node.log`, `cf-integrated-accepted-browser.log`,
`cf-integrated-accepted-sdk.log`, `cf-integrated-accepted-default.log`,
`cf-integrated-audit.log`, `cf-integrated-check.log` e `cf-integrated-full-suite.log`.
As tentativas anteriores permanecem nos logs `cf-integrated-browser*.log` e nos
diretórios temporários informados pelo Emulator, sem limpar perfis. A última
matriz integrada usou `%TEMP%/cf-integrated-msedge-r8CInZ` e
`%TEMP%/cf-integrated-chrome-nSf1CB`. Logs contêm estados/códigos/contagens e
caminhos de QA; não incluem senhas, segredos de recuperação ou DEKs abertas.

## Limitações e decisão para o aplicativo principal

O processo novo começa sem Auth persistido. Faz login sintético no Emulator e então
desbloqueia o cofre offline; não se homologou descoberta/autorização totalmente
offline após perder a sessão Auth. Posse da chave local e autorização remota ainda
precisam de política explícita no aplicativo futuro.

Não há promessa de apagar fisicamente dados/chaves já entregues à memória.
memoryLocalCache evita cache financeiro em disco, mas o SDK é compartilhado entre
contas nesta página e não prova zeroização de objetos de A no heap após B. Guardas
de proprietário, leitura de servidor, regras e época protegem o caminho exercitado
da interface. Uma política de clientes SDK por sessão exige revisão adicional.

Fora desta homologação: OAuth Google real, DOM/bootstrap publicado com cofre,
BFCache/pageshow, múltiplas abas completas de Auth+UI integradas, falha física de
energia/evicção, benchmark móvel/KDF/crescimento das provas e rotação operacional
da DEK. As regressões anteriores cobrem abas/fences separadamente; não substituem
essa matriz integrada. Quota, leitura falha e retenção de ACK são injeções de teste.

Falha ao persistir o lock revoga a autorização local, mas não promete revogar outra
aba sem fence durável. O coordenador falha fechado e pode exigir reinício para
retomar após falha na limpeza. Perder o próprio banco exige pacote externo atual;
a interface desta etapa recupera acesso ao destino existente e testa cópias novas,
não é um importador de desastre para arquivos arbitrários.

**Ainda não apto para avançar à integração controlada do cofre no aplicativo
principal.** O ciclo dos módulos reais está exercitado na interface experimental,
mas a prontidão do bootstrap/estado anônimo/UI publicada requer a mudança de
ciclo de vida identificada no início e deliberadamente não implementada.

Critérios para avançar: revisar/autorizar esse bootstrap sem estado vazio, definir
contexto @local e autoria offline, clientes SDK e callbacks por sessão, recuperação
de desastre em destino novo sem sobrescrever revisões recentes, e homologar o DOM
real junto de Auth+cofre+sync, BFCache e múltiplas abas. Nenhum desses critérios
autoriza migração de dados reais, retirada de fontes ou publicação nesta entrega.
