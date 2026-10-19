# Controle Financeiro

Aplicativo web responsivo e instalável para acompanhar entradas, despesas, categorias e pagamentos. Os dados financeiros continuam salvos localmente e podem, opcionalmente, ser sincronizados entre dispositivos por uma conta Google e Firebase.

## Arquivos

- `index.html`: estrutura da interface e formulários.
- `style.css`: estilos responsivos e temas.
- `controls.css`: estilos de opções, botão flutuante e calculadora.
- `app.js`: inicialização e interação da interface.
- `finance-core.js`: validação e normalização dos dados, cálculos em centavos e operações da calculadora.
- `preferences.js`: validação de preferências, com compatibilidade com opções antigas ou ausentes.
- `localization.js`: textos da interface, formatação por idioma e moeda de apresentação.
- `storage.js`: acesso ao armazenamento persistente e fallback temporário em memória.
- `update-manager.js` e `version.json`: comparação semântica e metadados de versão instalada/publicada.
- `sw.js`: cache offline e atualização do app.
- `manifest.json` e `icons/`: instalação e ícones do PWA.
- `.github/workflows/pages.yml` e `scripts/prepare-pages.mjs`: validação e preparação do artefato para GitHub Pages.
- `tests/`: testes automatizados da camada de dados, armazenamento e calculadora.

Os valores monetários são normalizados para o centavo mais próximo usando a representação decimal do número; frações exatamente no meio são arredondadas para cima. Isso evita que a representação binária de valores como `1.005` mude o arredondamento esperado. Entradas negativas, não finitas ou acima do limite monetário de `2^44` unidades são rejeitadas na validação e na importação. Esse teto mantém os centavos como inteiros exatos e, mesmo na borda máxima, a resolução do `Number` é menor que um centavo, permitindo converter o valor de volta sem perder centavos. A soma das receitas e, separadamente, das despesas de cada mês também precisa respeitar o teto. Cálculos de totais, orçamentos e gráficos acima do limite geram erro explícito; o app impede salvar ou exportar somas mensais inválidas, em vez de exibir ou persistir totais imprecisos.

O cálculo decimal usa `BigInt`; portanto, o PWA requer uma engine JavaScript com suporte a `BigInt`.

Se dados financeiros armazenados não puderem ser lidos ou validados, o app bloqueia a gravação automática para não substituir o conteúdo original. Quando o texto bruto está acessível, é possível baixá-lo como cópia preservada; a substituição do estado só ocorre após selecionar e confirmar a restauração de um backup válido. A indisponibilidade do armazenamento, sem dados inacessíveis detectados, continua usando o fallback temporário em memória e é informada ao usuário.

O menu **Opções** mantém as preferências no armazenamento centralizado já existente. Em **Aparência e visualização**, permite escolher um dos cinco temas (Claro é o padrão para quem ainda não escolheu um tema), densidade da interface, gráficos/indicadores e visibilidade independente de Planejamento, Despesas do mês e Entradas, além de configurar a privacidade visual dos valores. As três seções de lançamentos permanecem visíveis por padrão em instalações existentes. As demais opções incluem seção inicial, mês de referência, idioma, moeda de apresentação e diagnóstico local. A interface oferece Português (Brasil), Inglês, Espanhol, Francês, Alemão e Japonês. A moeda pode ser exibida em BRL, USD, EUR ou JPY; essa escolha altera somente a formatação, não converte os valores guardados nem suas moedas de origem. A tela inicial pode abrir o resumo, lançamentos, gráficos ou a última seção utilizada; o último destino válido é mantido entre inicializações. A opção **Lançamentos** abre as listas existentes de despesas e receitas. O CSV exporta o mês selecionado ou todos os meses que já tenham registros.

A versão base do código é declarada em `version.json`, no formato `MAJOR.MINOR.PATCH`, e deve corresponder a `VERSAO_SERVICE_WORKER` em `sw.js`. O workflow `.github/workflows/pages.yml` publica somente a branch `main`: testa o projeto, monta um artefato estático e usa as actions oficiais do GitHub Pages. No artefato, o script `scripts/prepare-pages.mjs` soma o número da execução ao patch da versão base e ao número do cache. Assim, cada execução de publicação tem uma identidade de versão/cache nova, sem alterar os arquivos fonte ou incrementar versões durante verificações do aplicativo.

A verificação consulta `version.json` por caminho relativo à aplicação, com cache HTTP desativado e bypass explícito do cache do Service Worker para a consulta publicada. A abertura, o retorno ao primeiro plano e a reconexão solicitam verificações automáticas com controle de frequência; a mesma versão adiada não repete o aviso durante a sessão. Um Service Worker novo só é ativado após confirmação do usuário e validação da identidade do worker que passa a controlar a página. Sem rede, a versão instalada continua disponível pelo precache, mas a versão publicada não pode ser verificada. O cache do Service Worker armazena recursos do app, não os dados financeiros, que permanecem no armazenamento local do navegador.

Para habilitar o workflow após revisão, altere manualmente a origem de publicação do GitHub Pages para **GitHub Actions** em *Settings → Pages*. Nenhuma configuração remota é alterada pelo repositório ou pelo workflow.

**Planejamento**, logo acima de **Despesas do mês**, exibe o orçamento por categoria em uma seção independente e recolhível. Ele compara somente despesas com os limites padrão por categoria. A configuração separa o gerenciamento das categorias dos limites; cada limite padrão é reutilizado em todos os meses e fica junto ao estado financeiro nos backups. Personalizações mensais de backups anteriores são descartadas ao normalizar os dados, e os meses passam a usar o limite padrão. O formato financeiro permanece na versão 3; estados e backups da versão 2 sem orçamento são migrados com limites vazios, preservando lançamentos e categorias. Ocultar uma seção da tela inicial não modifica os dados nem sua participação nos totais, gráficos ou relatórios.

**Ocultar valores financeiros** mascara valores monetários na interface como `••••`; o controle pode revelar os valores novamente durante a sessão. **Iniciar com valores ocultos** define apenas o estado inicial ao abrir ou recarregar o app e não impede a revelação durante a sessão. Essa é uma proteção visual: os valores reais continuam nos dados locais e nos backups, sem criptografia. O dia inicial do período financeiro segue pendente, porque os cálculos e filtros atuais usam meses do calendário; alterar isso exigiria uma mudança coerente em totais, gráficos e histórico.

O diagnóstico mostra a versão instalada, a última versão publicada consultada, o horário e o resultado da verificação, além do estado do Service Worker e do armazenamento. Nada é enviado para serviços externos.

## Recorrência de entradas

Ao adicionar uma entrada, é possível repeti-la mensalmente por 12 meses a partir do mês atual. Cada ocorrência fica salva no mês correspondente e compartilha um identificador de série, preservado em backups e indicado na lista e no CSV. O controle de cancelamento remove somente as ocorrências posteriores ao mês selecionado; entradas anteriores permanecem. Editar ou excluir uma ocorrência afeta somente aquele mês. A função de copiar o mês anterior não copia entradas recorrentes, para evitar duplicações ou reativar uma série cancelada.
## Executar localmente

O service worker requer um contexto seguro. Para desenvolver localmente, inicie um servidor HTTP na pasta do projeto:

```sh
python -m http.server 8000
```

Abra `http://localhost:8000`. Para instalar o PWA em outros dispositivos, publique os arquivos em uma origem HTTPS.

## Testes

Para desenvolvimento e testes automatizados, é necessário Node.js 20 ou superior. Execute os testes e a verificação sintática definidos no projeto:

```sh
node --test
npm run check
npm run test:rules
```

`npm run test:rules` inicia o Firestore Emulator e precisa de um JDK 21 ou superior; o workflow do GitHub instala Java 21 antes de executar esses testes. Sem o emulador, `node --test` executa os testes estáticos das regras e marca a integração de segurança como ignorada.

## Compatibilidade de navegadores

O aplicativo tem como alvo as duas versões principais estáveis mais recentes de cada navegador suportado, verificadas no momento de cada publicação:

- Google Chrome para desktop e Android.
- Microsoft Edge para desktop e Android.
- Mozilla Firefox para desktop e Android.
- Apple Safari para macOS, iPhone e iPad.

Navegadores desatualizados, Internet Explorer e ambientes sem suporte às funcionalidades exigidas não são oficialmente suportados.

A aplicação requer suporte a `BigInt`, módulos JavaScript, `Intl.NumberFormat`, `localStorage` e Service Workers. A instalação e o funcionamento do PWA fora de `localhost` exigem uma origem segura, normalmente HTTPS.

O suporte teórico às funcionalidades não substitui testes funcionais. Antes de uma publicação, valide os fluxos essenciais — inicialização, lançamentos, cálculos financeiros, armazenamento, backup e recuperação — nos navegadores e sistemas operacionais da matriz acima. Registre os ambientes efetivamente testados; não declare compatibilidade verificada sem executar esses testes.

## Dados e migração

Sem configurar o Firebase e entrar com Google, o app funciona somente com o armazenamento local existente. Exporte backups regularmente e guarde-os fora do dispositivo. Se o armazenamento persistente estiver bloqueado ou cheio, o app avisa que os dados estão apenas na memória e podem se perder ao fechar.

### Configurar sincronização Firebase

A integração usa o SDK Web modular do Firebase, carregado de um bundle local gerado pelo build. A aplicação não precisa de Firebase para abrir ou continuar funcionando offline. As configurações do cliente Web são públicas; o isolamento dos dados depende obrigatoriamente das regras `firestore.rules` versionadas neste repositório.

1. Crie um projeto em [Firebase Console](https://console.firebase.google.com/) e adicione um aplicativo Web. Copie `apiKey`, `authDomain`, `projectId` e `appId` para `firebase-config.js`, substituindo os valores `CONFIGURE_*`. Não coloque chaves de conta de serviço ou credenciais administrativas no frontend.
2. Em **Authentication → Sign-in method**, habilite o provedor **Google** e escolha o e-mail de suporte.
3. Em **Authentication → Settings → Authorized domains**, adicione o domínio exato do GitHub Pages (por exemplo, `usuario.github.io`) e `localhost` para desenvolvimento local.
4. Crie o banco em **Firestore Database** no modo de produção. Escolha a região considerando os usuários; a região não pode ser alterada depois da criação.
5. Publique as regras do repositório com Firebase CLI: `npx firebase login`, depois `npx firebase deploy --only firestore:rules --project SEU_PROJECT_ID`. Confira no console que essas regras estão publicadas antes de habilitar usuários.
6. Instale dependências com `npm ci`. Para desenvolvimento local, gere `firebase-sync.bundle.js` com `npm run build:sync` antes de servir o PWA. O workflow do Pages gera o bundle automaticamente dentro do artefato.
7. Abra Opções → Sincronização entre dispositivos e entre com Google. No primeiro vínculo, o app busca a conta autenticada, apresenta quantidades e candidatos a duplicidade e pede confirmação. Ele guarda uma cópia recuperável do estado financeiro local antes de enviar.

O Firestore guarda cada lançamento separadamente em `/users/{uid}/records`, configurações financeiras em `/users/{uid}/settings/finance`, operações idempotentes em `operations` e conflitos em `conflicts`. Exclusões são tombstones; não são apagadas fisicamente. Operações locais não confirmadas permanecem numa fila local e são reenviadas quando a conexão retorna. Alterações concorrentes são comparadas por revisão transacional do documento, sem decidir pelo relógio do dispositivo. Conflitos preservam as duas versões; revise-os antes de continuar usando os dados divergentes.

O login e a sincronização real não foram testados contra uma configuração Firebase deste usuário: os valores de configuração permanecem como marcadores até serem preenchidos e as regras só passam a proteger o banco após sua publicação. Os testes locais usam mocks/casos puros e o Emulator Suite, sem conta Google nem banco de produção.

Os backups existentes continuam contendo apenas o estado financeiro no formato atual. Eles não incluem tokens, fila, estado de autenticação ou metadados de sincronização. Restaurar enquanto uma conta está vinculada fica somente local e suspende a sincronização automática; a seção de sincronização oferece a combinação explícita com os dados remotos. Essa combinação preserva registros remotos ausentes no backup e solicita confirmação antes do envio.

Na migração do formato antigo, os registros não continham ano; por isso, os meses são associados ao ano atual. Confira o período migrado e exporte um backup após a conversão.

Uma despesa fixa gera lançamentos para 12 meses a partir do mês escolhido. Uma despesa parcelada gera no máximo 60 parcelas. Despesas fixas não se estendem automaticamente além desses 12 meses.

Ao atualizar uma instalação existente, use **Salvar backup** antes de substituir os arquivos. Mantenha `manifest.json`, `sw.js`, os módulos JavaScript e a pasta `icons/` junto com a página.
