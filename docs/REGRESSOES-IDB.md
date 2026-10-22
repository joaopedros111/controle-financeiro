# Regressoes IndexedDB: baseline e correcoes

Baseline reproduzida antes de alterar testes: 224 testes, 210 aprovados, 11 falhas, 1 cancelamento, 2 ignorados. Mensagens e linhas referem-se ao arquivo original tests/app-sync.test.js.

| Teste / linha original | Erro observado | Causa raiz / responsabilidade | Correcao |
| --- | --- | --- | --- |
| A -> B -> A / 74 | 20 != 10 | App: publicacao nao preparava o estado desejado, nem reconciliava reversao | Preparacao atomica antes da rede; equivalencia apenas contra snapshot do servidor; preservar operacoes tentadas |
| Offline / 152 | undefined.value | App: publicacao dependia de uma fila preparada por outro caminho | Preparar estado e fila mesmo offline, antes de testar conectividade |
| Falha de fila / 165 | 1 leitura != 0 | App: falha ocorria somente depois de consultar servidor | Aguardar commit local antes de qualquer chamada de rede |
| Edicao durante leitura / 226 | undefined.value | App e teste: preparacao ausente; assercao anterior ao commit assincrono | Preparacao independente do envio; aguardar idbPendente antes da assercao; ignorar publicacoes obsoletas |
| Inicializacao com chave legada / 244 | undefined.valor | App e teste: callback nao aguardado; banco simulado sem estado/inicializacao | await em onRemoteRecords; simular ambos os documentos com servico real |
| Logout durante ACK / 275 | timeout 5000 ms (cancelado) | App: fila nunca preparada, commit esperado nao iniciava | Preparacao antes do envio; verificar sessao antes de cada commit; ACK no UID capturado |
| Fila corrompida / 290 | Missing expected exception | Teste: assert.throws sobre Promise e injetava defeito na fonte legada | Injetar documento IDB invalido; await assert.rejects; preservar rejeicao por validacao |
| Recarga desconhecido / 316 | undefined.id | App e teste: callback remoto sem await e persistidor simulado nao atualizava documento financeiro | Aguardar reconciliacao e usar documento duravel na preparacao seguinte |
| Recarga divergente / 323 | conflicts.length == 0 | Mesma inicializacao incompleta; reconciliacao nao terminava antes do envio | Aguardar callback com preserveDivergent e manter bloqueio por conflito |
| Exclusao explicita / 338 | 0 commits != 1 | App: argumento de exclusao explicita ignorado | Preparar tombstone somente para exclusoes fornecidas explicitamente |
| Unicode / 370 | Missing expected rejection | App: validacao retirada junto com staging anterior | Validar identidades dentro da preparacao transacional; impedir rede |
| Detalhes ocultos / 377 | undefined.children | Teste: segunda renderizacao assincrona nao aguardada | await nas duas renderizacoes, sem mudar as assercoes de privacidade |

## Correcoes adicionais encontradas na homologacao

- Leitura dos testes de navegador passou a usar IndexedDB nativo, inclusive offline; importar um modulo nao precacheado durante offline falhava antes de ler os dados.
- Injecao de falha do teste D passou de Storage.setItem para IDBObjectStore.put na marcacao de envio. Mantem a propriedade original: estado/fila ja duraveis sobrevivem a falha posterior e recarga, sem envio antecipado.
- Observacoes duplicadas do mesmo operationId nao podem bloquear a resolucao umas das outras. Conflitos de outras operacoes continuam bloqueando.
- Operacoes com tentativa de rede iniciada sao imutaveis; edicoes seguintes dependem de sua revisao. Operacoes ainda nao tentadas podem ser combinadas na transacao.
- Logout restaura estado:@local e aguarda a drenagem das gravacoes locais antes de bloquear a nova sessao.

## Homologacao

Executada somente com dados sinteticos, perfil temporario Playwright e projeto demo do Emulator. Nenhuma fonte legada foi apagada; nenhum commit/push/deploy foi realizado.

## Outras regressoes resolvidas durante a execucao

- Meses vazios criados pela navegacao nao diferenciam dois snapshots financeiros equivalentes. Essa diferenca de interface impedia a confirmacao apos login.
- A mensagem assincrona de persistencia nao substitui o botao Desfazer de uma exclusao.
- Atualizacoes concorrentes de lastConfirmed sao monotonicas. A confirmacao final volta a verificar fila e conflitos na transacao; uma inclusao intercalada impede sucesso visual.
- Observacoes antigas de revisoes remotas nao sobrescrevem revisoes atualizadas por outra aba.
- Renderizacao de conflitos e aplicacao de snapshots verificam o UID capturado depois de await; detalhes da conta anterior nao aparecem na nova sessao.
- Uma publicacao usa o estado duravel combinado retornado pela transacao. Uma aba antiga nao reverte o estado novo nem interrompe indefinidamente o reenvio na reconexao.
- O teste F de navegador tinha um matcher invalido (comprimento -1). Sua condicao original de ausencia de perda silenciosa foi expressa como booleano, mantendo a exigencia de ambos os registros e de nenhum tombstone. Agora as duas inclusoes sao disparadas simultaneamente.
- O teste G aguarda a primeira edicao persistir antes da segunda edicao obsoleta; tambem verifica o aviso de bloqueio. O teste B usa contextos separados e continua exigindo aceitacao local das duas versoes e resolucao remota explicita.

## Arquivos alterados nesta continuacao

app.js; financial-atomic-service.js; sync-core.js; tests/app-sync.test.js;
tests/app-idb-integration.test.js; tests/multitab-integrity.test.js;
e2e/sync.spec.mjs; e2e/idb-transactions.spec.mjs; este relatorio e o link no registro historico de auditoria.

## Limites da evidencia

Dados sinteticos, projeto demo e perfil efemero de navegador. As falhas de persistencia
sao injetadas sobre transacoes IndexedDB reais, inclusive entre as escritas de estado
e fila. Nao equivalem a corte de energia do sistema operacional. Outros navegadores,
volumes legados reais e o ambiente Firebase de producao nao foram homologados nesta
execucao. Os resultados locais nao sao uma declaracao de prontidao para producao.
