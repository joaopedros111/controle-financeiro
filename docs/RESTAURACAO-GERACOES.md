# Restauração financeira por geração — homologação local

## Garantia de publicação

`users/{uid}/control/restore` aponta para uma geração em
`users/{uid}/financeGenerations/{generation}`. Antes da primeira restauração,
a ausência do controle mantém o protocolo legado.

A preparação grava registros com os mesmos IDs e configurações em partes
imutáveis. As regras exigem o avanço transacional dos contadores junto de cada
parte/registro e impedem selar uma preparação incompleta. O cliente também
verifica o conteúdo preparado. Só então uma transação troca o ponteiro da conta,
comparando a geração anterior. A conta nunca aponta para uma preparação parcial.

Depois da ativação, gravações legadas e de gerações inativas são recusadas pelo
servidor. Um cliente atualizado arquiva a fila antiga e carrega a nova geração;
não converte operações antigas em intenções da geração nova. Tombstones antigos
permanecem na geração anterior, sem impedir recuperação dos IDs no backup.

## Recuperação e interrupções

Antes da substituição local, uma transação grava o estado anterior e a fila em
`restore-recovery:{uid}:{generation}` no IndexedDB. A fila nova contém o trabalho
de restauração, que é retomado após reconexão ou reabertura. Uma confirmação de
ativação perdida é reconhecida pelo próprio ponteiro, sem reaplicar a restauração.

As gerações remotas anteriores não são apagadas. O botão existente **Baixar
histórico** inclui cópias locais anteriores e a geração remota anterior. Extraia
o objeto `state` para um arquivo financeiro e valide-o antes de outra restauração.
Não importe filas/metadados do histórico como dados financeiros.

Edições rejeitadas por restauração ou incompatibilidade guardam `base` e `proposta`
em uma cópia durável separada, sem criar operações. Avisos de recuperação ficam
visíveis após recarga até o usuário baixar o histórico; baixar não reaplica dados.
Uma falha ao consultar o histórico remoto não impede baixar as cópias locais.

Clientes atualizados bloqueiam gravações locais e envio quando detectam um
protocolo incompatível. Mostram um aviso e usam a ação de atualização existente,
sem permitir adiar essa ação obrigatória. O desbloqueio exige leitura compatível
do servidor; pendências anteriores ficam arquivadas, com aviso, sem reenvio.
Não há recarga forçada de clientes antigos: suas gravações continuam bloqueadas
pelas regras e o usuário precisa obter a versão nova. A atualização mantém o
Service Worker e as verificações de identidade de release existentes.

Restaurações concorrentes usam comparação da geração base: uma vence; a outra
fica pausada, com suas cópias preservadas para revisão. Após revisar, uma nova
importação explicitamente confirmada pode substituir o trabalho pendente: ele
também será arquivado e a nova tentativa observará a geração atual do servidor.
Preparações abandonadas
e gerações antigas não têm limpeza automática. Orçamentos mensais são preservados
e transportados; os cálculos e a interface existentes não foram alterados.

## Migração em produção — exige nova autorização

1. Homologar com projeto `demo-*`, emuladores e perfis descartáveis. Executar
   `npm.cmd run test:rules` e `npm.cmd run test:e2e -- backup-generation.spec.mjs --project=msedge`.
2. Após autorização, publicar primeiro as regras compatíveis com o legado;
   sem controle de restauração existente, os clientes atuais continuam funcionando.
3. Distribuir a aplicação e seu bundle correspondente. Só então habilitar o uso
   da restauração por geração. Não basta atualizar apenas JavaScript ou apenas regras.
4. A primeira restauração de cada conta ativa a barreira. Clientes antigos podem
   continuar mostrando seu cache, mas suas gravações são bloqueadas. Precisam atualizar.
5. Não remover o controle nem reabrir gravações legadas como rollback: isso permitiria
   reaplicar filas offline antigas. Recuperar dados por uma nova restauração explícita.

Nenhuma migração, publicação ou restauração de dados reais é executada pelos testes.
