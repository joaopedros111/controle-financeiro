# Controle Financeiro

Aplicativo web responsivo e instalável para acompanhar entradas, despesas, categorias e pagamentos. Os dados ficam no navegador atual; não há sincronização entre dispositivos.

## Arquivos

- `index.html`: estrutura da interface e formulários.
- `style.css`: estilos responsivos e temas.
- `controls.css`: estilos de opções, botão flutuante e calculadora.
- `app.js`: inicialização e interação da interface.
- `finance-core.js`: validação e normalização dos dados, cálculos em centavos e operações da calculadora.
- `storage.js`: acesso ao armazenamento persistente e fallback temporário em memória.
- `sw.js`: cache offline e atualização do app.
- `manifest.json` e `icons/`: instalação e ícones do PWA.
- `tests/`: testes automatizados da camada de dados, armazenamento e calculadora.

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
