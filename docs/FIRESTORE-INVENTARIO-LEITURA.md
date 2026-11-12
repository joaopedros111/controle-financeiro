# Identidades legadas e inventário futuro — segunda rodada

12/11/2026, America/Sao_Paulo. **Nenhum inventário de produção foi executado.**
Esta entrega contém apenas análise de código Git, um analisador offline e testes
com identificadores/documentos sintéticos. Não cria credencial nem conexão Firebase.

## Histórico comprovado localmente

O primeiro cliente Firebase inspecionado (`b026a01`, `app.js`, função
`syncEntityKey`) já usa hexadecimal minúsculo dos bytes UTF-8 de
`month + '/' + type + '/' + id`. A partir de `6f2fb80`, o gerador está em
`sync-core.js::recordEntityKey` com a mesma codificação. O commit homologado
`e0f6e2c54e92655432b0304ee35729f1d5a08769` e a implementação da branch preservam
esse gerador. Os testes extraem o código histórico real por `git show`, em
leitura local, e comparam sua execução com a atual; não substituem o gerador
antigo por uma aproximação escrita para o teste.

IDs internos antigos gerados por UUID ou fallback de tempo/aleatoriedade são
strings preservadas pelo transporte. `finance-core.js::normalizarEstado` já
gerava um ID quando backups antigos traziam ID ausente, numérico ou vazio. O
analisador não faz essa normalização nem aplica essa política a documentos
remotos: uma identidade remota incompatível é reportada, nunca renomeada.

Não foi encontrado, nas implementações históricas inspecionadas, outro formato
documental legítimo que exija migração para a chave atual. Isso não comprova que
a base remota esteja limpa: as regras anteriores permitiam chaves arbitrárias,
e escritores externos/versões não presentes no Git não foram inspecionados.

## Garantias e limites

- Acentos, caracteres fora do BMP, espaços, barras, `%`, quebras de linha e
  caracteres especiais no ID interno mantêm sua identidade exata. Não há trim,
  percent-decoding ou normalização NFC aplicados à chave.
- `a/b` e `a%2Fb`, `é` e `e` + acento combinante, `id` e ` id ` permanecem
  entidades distintas. Espaço não transforma IDs diferentes em um mesmo registro.
- Mesma identidade em UIDs, meses, tipos ou gerações diferentes não é duplicata
  lógica. A auditoria agrupa por UID + geração + mês + tipo + ID.
- Chave incompatível, chave hexadecimal maiúscula, `record.id` divergente,
  tombstone com identidade de payload, ID inválido e duplicata lógica bloqueiam
  o resultado. Não se escolhe vencedor por timestamp ou revisão.
- Repetição da mesma linha/documento no inventário é identificada separadamente
  de duas chaves físicas para a mesma entidade.
- A existência de um alias antigo não pode ser consultada de forma geral pelas
  Security Rules. Não criar automaticamente a chave canônica ao encontrar um
  alias: isso pode duplicar a entidade. O sincronizador atual detecta essa
  inconsistência e interrompe a sincronização preservando estado/fila. O
  analisador fornece diagnóstico; não muda esse comportamento nem migra dados.

## Analisador offline entregue

`firestore-identity-audit.js::auditFirestoreIdentityMetadata(rows)` aceita apenas
uma projeção de identificadores e metadados. Não importa Firebase SDK, não abre
arquivo, não usa rede, não escreve dados e não imprime conteúdo. Recusa campos
adicionais como `record`, `nome`, `valor`, `categoria`, `budgets` ou `token`.

Formato de entrada por linha, com valores exclusivamente sintéticos neste exemplo:

```json
{
  "uid": "synthetic-owner",
  "generation": "legacy",
  "documentId": "323032362d31312f72656365697461732f61",
  "month": "2026-11",
  "type": "receitas",
  "id": "a",
  "recordId": "a",
  "deleted": false,
  "revision": "synthetic-revision"
}
```

Em tombstones, `recordId` deve estar ausente ou ser `null`. A saída contém
somente contadores, códigos e posições de linhas (`row`/`peerRow`), sem repetir
UIDs, IDs, chaves ou revisões. `eligible:true` significa somente que **a entrada
fornecida** não apresentou achados de identidade/metadados; não aprova uma
migração nem confirma completude do inventário ou integridade do conteúdo.
O limite padrão é de 200.000 linhas e 1.000 achados exibidos; o contador total e
`findingsTruncated` mantêm visível qualquer truncamento. Para bases maiores,
o operador precisa aprovar um limite e manter todas as linhas de cada namespace
juntas, pois separar páginas perderia a detecção de duplicatas entre elas.

Validação executada: `node --test tests/firestore-identity-audit.test.js`:
**10 aprovados, 0 reprovados, 0 ignorados**. Log: `round2-identity-audit.log`.
Sintaxe dos dois arquivos e `git diff --check` também verificados.

## Procedimento exclusivamente de leitura para aprovação posterior

Este procedimento é uma proposta. A sessão atual **não autoriza sua execução**.
Antes de executá-lo, a pessoa responsável deve aprovar o projeto/banco, a lista
de UIDs/gerações, a janela de leitura, o limite de documentos/custo, o operador
e o armazenamento protegido dos identificadores. Exigir identidade com apenas
as permissões de leitura necessárias, já autorizada pela administração; não
criar permissões/contas nem fazer login como parte desta entrega.

1. Identificar administrativamente a release/ruleset ativa em etapa separada.
   Comparação textual de arquivos não substitui essa identificação.
2. Para cada UID explicitamente aprovado, ler `control/restore` com máscara de
   `protocol`, `activeGeneration`, `previousGeneration`. Enumerar raízes de
   `financeGenerations` com máscara de `status` e `baseGeneration` para incluir
   gerações anteriores e preparações interrompidas. Não ignorar tombstones.
3. Listar documentos de `users/{uid}/records` somente com máscara de
   `month`, `type`, `id`, `record.id`, `deleted`, `revision`.
4. Para cada geração no escopo, listar
   `users/{uid}/financeGenerations/{generation}/records` somente com máscara de
   `value.month`, `value.type`, `value.id`, `value.record.id`, `value.deleted`,
   `value.revision`. O nome documental retornado fornece o ID físico; adaptar
   cada projeção ao formato offline acima.
5. Usar apenas chamadas REST `documents.get`/`documents.list` com máscara
   **não vazia**. A ausência da máscara devolveria todos os campos. Nenhum
   fallback para leitura completa é permitido. As respostas devem ser checadas
   antes de persistir: se contiverem campos além da projeção, interromper e não
   imprimir corpo da resposta. As APIs documentam máscaras, paginação e
   consistência por `readTime`.[¹](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/list)
   [²](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/get)
6. Fixar o mesmo `readTime` aprovado e ainda suportado pela API durante a
   paginação de um namespace; manter parâmetros/mascara/ordenação invariantes
   com `pageToken`. Usar ordenação por nome documental, sem `orderBy month`,
   para não omitir registros malformados sem mês. Se a janela expirar, marcar
   o namespace incompleto e planejar nova leitura; não misturar snapshots.
7. Não usar Console para copiar documentos completos, `exportDocuments`,
   `commit`, `batchWrite`, `patch`, `createDocument` ou `delete`. Não registrar
   cabeçalhos de autenticação, tokens, corpos financeiros ou URLs com credenciais.
8. Converter em memória apenas as projeções autorizadas; armazenar metadados em
   local protegido, sem colocá-los neste repositório, nos testes ou em logs.
   Executar o analisador offline e produzir somente seu resumo agregado.
9. Registrar completude por namespace, contagem de páginas/documentos,
   `readTime`, falhas, campos ausentes e hash do arquivo protegido. Uma leitura
   interrompida nunca autoriza declarar ausência de aliases/duplicatas.
10. Para cada achado, preparar revisão humana separada usando as posições de
    entrada. Preservar todos os documentos, tombstones, filas e revisões.
    Qualquer plano posterior de mapeamento de alias, restauração por nova
    geração ou migração requer autorização específica e teste sintético próprio.

Evidência necessária para remover o bloqueio C02 de implantação: inventário
completo dos namespaces aprovados, projeções sem divergência entre ID físico,
identidade e `record.id`, ausência de duplicatas/aliases não tratados e decisão
humana sobre cada achado. Nenhuma dessas evidências de produção foi obtida nesta
rodada, e nenhuma identidade real foi usada como massa de testes.
