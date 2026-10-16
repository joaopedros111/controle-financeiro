# Controle Financeiro

Aplicativo web responsivo e instalável para acompanhar entradas, despesas, categorias e pagamentos. Os dados ficam no navegador atual; não há sincronização entre dispositivos.

## Arquivos

- `index.html`: estrutura da interface e formulários.
- `style.css`: estilos responsivos e temas.
- `controls.css`: estilos de opções, botão flutuante e calculadora.
- `app.js`: inicialização e interação da interface.
- `finance-core.js`: validação e normalização dos dados, cálculos em centavos e operações da calculadora.
- `preferences.js`: validação de preferências, com compatibilidade com opções antigas ou ausentes.
- `storage.js`: acesso ao armazenamento persistente e fallback temporário em memória.
- `sw.js`: cache offline e atualização do app.
- `manifest.json` e `icons/`: instalação e ícones do PWA.
- `tests/`: testes automatizados da camada de dados, armazenamento e calculadora.

O menu **Opções** mantém as preferências no armazenamento centralizado já existente. Ele oferece densidade de interface, gráficos/indicadores, seção inicial, mês de referência, privacidade visual dos valores e diagnóstico local. A tela inicial pode abrir o resumo, lançamentos, gráficos ou a última seção utilizada; o último destino válido é mantido entre inicializações. A opção **Lançamentos** abre as listas existentes de despesas e receitas. O CSV exporta o mês selecionado ou todos os meses que já tenham registros.

O **Orçamento por categoria** fica no resumo mensal e compara as despesas com um limite mensal padrão por categoria. A configuração separa o gerenciamento das categorias dos limites; cada limite padrão é reutilizado em todos os meses e fica junto ao estado financeiro nos backups. Personalizações mensais de backups anteriores são descartadas ao normalizar os dados, e os meses passam a usar o limite padrão. O formato financeiro permanece na versão 3; estados e backups da versão 2 sem orçamento são migrados com limites vazios, preservando lançamentos e categorias.

**Ocultar valores financeiros** mascara valores monetários na interface como `••••`; o controle pode revelar os valores novamente durante a sessão. **Iniciar com valores ocultos** define apenas o estado inicial ao abrir ou recarregar o app e não impede a revelação durante a sessão. Essa é uma proteção visual: os valores reais continuam nos dados locais e nos backups, sem criptografia. O dia inicial do período financeiro segue pendente, porque os cálculos e filtros atuais usam meses do calendário; alterar isso exigiria uma mudança coerente em totais, gráficos e histórico.

O diagnóstico não declara versão do aplicativo, pois o projeto não fornece uma versão funcional identificada. Ele informa a disponibilidade do armazenamento e os resultados registrados das operações locais; nada é enviado para serviços externos.

## Executar localmente

O service worker requer um contexto seguro. Para desenvolver localmente, inicie um servidor HTTP na pasta do projeto:

```sh
python -m http.server 8000
```

Abra `http://localhost:8000`. Para instalar o PWA em outros dispositivos, publique os arquivos em uma origem HTTPS.

## Testes

Requer Node.js 20 ou mais recente. Execute:

```sh
node --test
```

## Dados e migração

Os dados são guardados no armazenamento local do navegador e não são sincronizados. Exporte backups regularmente e guarde-os fora do dispositivo. Se o armazenamento persistente estiver bloqueado ou cheio, o app avisa que os dados estão apenas na memória e podem se perder ao fechar.

Na migração do formato antigo, os registros não continham ano; por isso, os meses são associados ao ano atual. Confira o período migrado e exporte um backup após a conversão.

Uma despesa fixa gera lançamentos para 12 meses a partir do mês escolhido. Uma despesa parcelada gera no máximo 60 parcelas. Despesas fixas não se estendem automaticamente além desses 12 meses.

Ao atualizar uma instalação existente, use **Salvar backup** antes de substituir os arquivos. Mantenha `manifest.json`, `sw.js`, os módulos JavaScript e a pasta `icons/` junto com a página.
