# Controle Financeiro — versão reformulada

## Arquivos
- `index.html`: estrutura e formulários.
- `style.css`: identidade visual responsiva, temas claro/escuro, estados de foco e diálogos.
- `app.js`: regras do aplicativo, cálculos e armazenamento local.

## Instalação
1. Faça uma cópia da pasta atual.
2. Substitua os três arquivos pelos arquivos deste pacote.
3. Abra `index.html` no navegador.
4. Antes de substituir uma versão em uso, use **Ferramentas → Salvar backup** no aplicativo antigo.

## Recursos preservados
- Entradas e despesas por mês/ano.
- Edição e remoção de lançamentos, incluindo desfazer exclusão.
- Marcação de despesas pagas/pendentes.
- Categorias e resumo por categoria.
- Despesas fixas e parceladas, propagação de alterações e remoção de séries.
- Navegação entre meses, cópia do mês anterior e limpeza do mês.
- Exportação CSV, backup JSON e restauração de backup.
- Tema claro/escuro e armazenamento em `localStorage`.

## Mudanças
- Layout com cartões, hierarquia visual mais clara e melhor leitura dos totais.
- Ajustes para celular, foco visível no teclado e respeito à preferência por movimento reduzido.
- Validação para não salvar entrada/despesa sem valor positivo.
- Verificação mais rigorosa da estrutura do backup antes de substituir os dados locais.

## Importante
Os dados ficam no armazenamento local do navegador e não são sincronizados automaticamente entre dispositivos. Faça backups regulares.
