# Persistência offline, autorização local e logout

Branch: fix/offline-dados-locais-logout. Base: 5361999. Dados de validação exclusivamente sintéticos. Sem commit, publicação, configuração Firebase real ou migração de dados reais.

## Diagnóstico

O armazenamento durável por UID e as transações de estado/fila já existiam. O desaparecimento após logout era consequência do contrato Google-only: o logout revogava toda autoridade local e a UI apagava o estado em memória. Preservar os documentos não concedia acesso offline. Além disso, a descoberta de fontes antigas ocorria antes da hidratação autorizada e bloqueava a operação normal; a limpeza de pares confirmados não restringia a seleção ao UID que saiu.

## Implementação

- account-offline-access.js: autorização independente por UID. Envelopes versionados vinculam UID, identificador aleatório e geração. PIN de 8–64 dígitos, PBKDF2-SHA-256 com 600.000 iterações e salt aleatório de 128 bits, AES-256-GCM com IV aleatório de 96 bits, AAD e tag de 128 bits. Os parâmetros seguem o custo já adotado no projeto. Cada cadastro gera novo salt/IV. O envelope protege uma prova aleatória de autorização, não o banco financeiro.
- PIN, chave derivada e prova descriptografada não são persistidos. Há limitação durável de tentativas, sem alegação de resistência a ataque offline contra uma cópia do perfil.
- account-data-policy.js: modo local distinto de Google, época durável, identidade de grant e geração validadas nas transações. Nenhum token Google é usado no desbloqueio. Login explícito revoga o contexto anterior; mudanças de geração exigem novo cadastro autorizado, sem limpar a fila antiga. Erros de leituras e pares incompletos falham fechados.
- automatic-finance-sync.js: lê e apresenta a cópia válida da conta autorizada antes da descoberta ou sincronização. Modo local recusa snapshot, ciclo, reconciliação, restauração remota, listeners e flush autenticado. A retomada remota exige novo login Google, com os mecanismos existentes de ACK, conflitos e tombstones.
- app.js: confirmação Manter / Apagar / Cancelar, cadastro/confirmação de PIN e desbloqueio independente do carregamento do SDK Firebase. Ao manter, encerra a sessão da aplicação e deixa os dados bloqueados até o PIN. Bloqueio explícito e ao passar para segundo plano; reinício exige desbloqueio novamente. Estado local é identificado como Google desconectado. Os diálogos reutilizam a função modal e os estilos existentes.
- O SDK é ligado ao coordenador após carregar; não condiciona a disponibilidade do desbloqueio local. navigator.onLine não é utilizado como prova de disponibilidade do Firebase. Callbacks antigos de Auth e falhas de hidratação são cercados por identidade de sessão/controlador/acesso.
- Na saída, a revogação local é durável antes de aguardar o SDK. Se signOut permanecer pendente, a autorização remota continua bloqueada e novo login aguarda a conclusão dessa saída. Uma saída antiga não é aplicada a outro UID ou a uma sessão renovada.
- A opção apagar tenta confirmar o estado exato e atua somente no UID selecionado. Dados pendentes, conflitos e cópias exclusivas são conservadoramente preservados quando a confirmação não é possível. A confirmação adicional permite sair preservando os dados; não autoriza perda irreversível.

## Migração e interrupções

Somente a chave histórica explicitamente vinculada ao UID pode ser copiada automaticamente. Metadados que indiquem associação anônima não revisada, estrutura inválida ou referências de outra conta impedem a cópia. Fontes anônimas permanecem em recuperação separada, sem decisão obrigatória no fluxo normal da conta Google. A revisão manual excepcional continua disponível e mantém as verificações anteriores.

Estado, fila e diário da cópia por UID são confirmados na mesma transação. O diário guarda hash e snapshot da fonte para recuperação; não altera nem apaga a origem. Destino existente é preservado. Leituras antes do commit verificam mudanças na origem e na sessão. Revisões, operações, tombstones, conflitos e referências são copiados sem transformar os identificadores. O limite entre localStorage e IndexedDB não permite uma transação conjunta: escritores legados externos que continuem gravando após o commit não são sincronizados automaticamente; as fontes permanecem disponíveis para recuperação, sem sobrescrever o destino.

Se houver interrupção do logout após registrar a intenção de manter, a inicialização revoga a sessão e preserva o candidato ao desbloqueio por PIN. Interrupções e falhas de quota na cópia ou no desbloqueio não criam estado financeiro vazio. Duas tentativas concorrentes não sobrescrevem um destino já inicializado.

## Limites de proteção e operação

1. O IndexedDB financeiro original continua em texto legível para DevTools, extensões privilegiadas ou código executado na mesma origem. O PIN protege o fluxo da aplicação, não oferece a confidencialidade de um cofre financeiro cifrado. O cofre experimental existente não foi integrado.
2. XSS, comprometimento do dispositivo, cópia/restauração integral do perfil, relógio adulterado e força bruta offline não são resolvidos por este controle. Não há âncora externa contra rollback do armazenamento. Chaves em memória dependem do coletor de lixo; não há garantia de zeroização.
3. PIN é a opção implementada. Biometria/WebAuthn não foi implementada nem homologada. PIN esquecido exige novo login Google e recadastro; documentos e operações locais não são apagados nesse processo.
4. A saída não revoga globalmente tokens previamente copiados nem a conta Google em outros serviços. Em erro do SDK, a aplicação mantém revogação durável de sua autoridade e bloqueia a publicação; não afirma revogação de tokens no servidor.
5. Não há exclusão forçada de dados sem ACK ou com evidência de recuperação pendente. Esse limite evita perda silenciosa; o usuário recebe aviso de preservação.
6. Uma única conta pode ter autoridade ativa no mesmo banco/perfil. Desbloquear em outra aba avança a época e cerca a anterior. Abas em segundo plano bloqueiam o modo local; retornam ao PIN.
7. Não há validação física em Android/iOS, biometria ou interrupção elétrica real. Os testes móveis utilizam Edge/Chrome, viewports 375/390, Service Worker real e perfis sintéticos reiniciados.

## Validação

Execução completa Node: 997 testes, 991 aprovados, 0 falhas e 6 grupos condicionais ignorados. npm.cmd run check, verificações sintáticas dos novos módulos e git diff --check aprovados. Google-only completo: 52/52 aprovados (26 por navegador). Regras em Emulator isolado: 26/26 aprovados. A alteração final de início adiado do SDK é revalidada separadamente pelos 10 cenários de PIN de Edge/Chrome; reteste final: 10/10 aprovados, 0 falhas, 0 ignorados. Os testes incluem políticas/transações reais com I/O sintético em Node; IndexedDB nativo, Auth/Firestore Emulators isolados, Service Worker e processos reais de Edge/Chrome. Perfis e logs sintéticos ficam em diretórios temporários externos ao repositório e são preservados.

## Critérios para produção

A funcionalidade offline precisa terminar com as suítes obrigatórias sem falhas e revisão independente das novas fronteiras de autorização. Para oferecer confidencialidade contra acesso ao perfil de um dispositivo compartilhado, será necessária integração aprovada do cofre cifrado, proteção das chaves e migração recuperável; este PIN não substitui essa etapa. Não declarar proteção criptográfica dos documentos financeiros com esta entrega.
## Revisões adicionais verificadas

- Uma marca negativa por UID em localStorage (controleFinanceiro:revoked:UID) impede restauração automática do SDK quando o logout não consegue escrever o controle IndexedDB. Ela nunca concede acesso; só um novo login explícito a remove. Se todos os mecanismos de persistência e o SDK falharem simultaneamente, não há como garantir revogação durável por código cliente; o acesso atual falha fechado.
- A intenção de manter confere na mesma transação a identidade do envelope correspondente ao PIN recém-confirmado. Cadastro concorrente de outro PIN impede confirmar a retenção com um segredo diferente. Nova autenticação explícita, mesmo no mesmo UID, avança a época.
- Um callback inicial sem usuário não revoga um desbloqueio local independente em andamento. Bloqueio explícito, troca de sessão e callbacks antigos são cobertos por testes negativos reais.
- A recuperação manual aguarda o ciclo já iniciado e cerca novas publicações. A indicação Sincronizado não atravessa um estado de revisão pendente. Voltar à aba com a mesma sessão Google reidrata um snapshot local consistente sem destruir o contexto válido de revisão; modo local continua exigindo novo desbloqueio após segundo plano.
- O adaptador existente produz updatedAt de configurações no momento da leitura. Foi reproduzida a rejeição indevida de um destino inalterado. A recuperação agora valida os dois envelopes e compara todo o conteúdo e a revisão das configurações, desconsiderando exclusivamente esse horário de leitura. UID, geração, protocolo, registros, conflitos, metadados e alterações reais de configuração continuam sendo verificados. Testes negativos preservam o bloqueio a revisão/orçamento modificados.
- Diários preparados são descobertos antes do ciclo normal, mesmo sem referência na fila; não podem ser confundidos com ausência de importação. Par incompleto com diário pendente exige recuperação.
- Registros legados sem IDs estáveis, com IDs duplicados/incompatíveis, estruturas inválidas ou metadados incompatíveis não são automaticamente importados. A origem permanece disponível para recuperação assistida. Fontes ambíguas não são prova de que a conta Google atual é proprietária.
- Apagar não é uma limpeza irrestrita: pendências, fontes legadas não comprovadas e históricos de recuperação são preservados. Não se promete apagar todas as cópias históricas do perfil. A confidencialidade física desses resíduos exige o cofre cifrado e uma política específica de descarte.

## Arquivos da entrega

Código: account-data-policy.js, account-offline-access.js, account-local-migration.js, app.js, automatic-finance-sync.js, indexeddb-persistence.js, sw.js e scripts/prepare-pages.mjs.

Testes: tests/account-data-policy.test.js, tests/account-cleanup-scope.test.js, tests/account-offline-access.test.js, tests/account-migration-journal.test.js, tests/async-session-isolation.test.js e e2e/google-account-policy.spec.mjs.

Relatório: docs/offline-dados-locais-logout.md.

Não foram alterados Firebase Auth/Firestore de produção, configurações, regras, núcleo financeiro, serviço atômico, protocolo principal de ACK/tombstones, temas ou dependências. As listas estáticas do PWA foram ampliadas para manter os módulos necessários disponíveis offline. Os arquivos que já estavam modificados no worktree do cofre foram conferidos e preservados.

O início adiado do SDK evita restaurar um usuário persistido ou renovar tokens na inicialização local. O módulo pode estar no cache, mas Auth/Firestore só são instanciados após ação explícita de login Google. O cenário móvel verifica zero assinaturas de Auth durante o desbloqueio offline, duas reinicializações e sincronização única após novo login. A conectividade é relida quando o coordenador começa, para não conservar o estado offline da construção anterior.

Dos seis grupos ignorados na execução Node padrão, dois são cobertos pela execução de regras/cliente Firestore isolada; os outros quatro grupos condicionais (Epoch, integrações do cofre com SDK/Emulator e barreira de geração dedicada) não foram executados separadamente nesta etapa. As suítes Node/navegador do cofre que a execução padrão descobre continuaram passando, mas isso não homologa integração do cofre ao aplicativo. Google OAuth real, biometria e celulares físicos não foram utilizados.

## Decisão da entrega

Apto para homologação funcional controlada do modo offline por PIN, com dados sintéticos. Não declarar pronto para produção em dispositivos compartilhados quando o requisito for confidencialidade do armazenamento: o banco financeiro permanece legível no perfil e a biometria não foi implementada. Exige revisão independente da autorização, validação física móvel e definição da integração cifrada antes dessa garantia. Nenhum commit, push, merge ou deploy foi realizado; branch e HEAD permanecem fix/offline-dados-locais-logout / 5361999.
