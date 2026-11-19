# Padrão de testes, homologação e publicação

**Projeto:** Controle Financeiro (PWA)
**Arquivo recomendado:** `docs/PADRAO-DE-TESTES-E-PUBLICACAO.md`
**Status:** padrão proposto para adoção após a conclusão da release 1.1.20
**Objetivo:** reduzir falhas falsas, impedir regressões reais e preservar dados financeiros durante testes, atualizações e publicações.

## 1. Princípios inegociáveis

1. **Preservação dos dados em primeiro lugar.** Nenhum teste deve acessar, apagar, sobrescrever ou sincronizar dados financeiros reais. Usar dados sintéticos, origens e perfis de navegador isolados e projetos Firebase de demonstração com emuladores.
2. **Mudança mínima e rastreável.** Uma demanda visual não autoriza mudanças não relacionadas na lógica financeira, infraestrutura ou processo de publicação.
3. **Não mascarar falhas.** Nunca remover uma asserção, ampliar tolerâncias arbitrariamente, desabilitar segurança ou marcar um teste como ignorado só para obter resultado verde.
4. **Comparar com uma base conhecida.** Antes de atribuir uma falha ao código novo, executá-la também na versão-base, quando viável.
5. **Testar comportamento observável.** Preferir verificações de funcionalidade, alinhamento, acessibilidade, transbordamento e preservação de dados. Exigir valores exatos de CSS apenas quando forem requisitos explícitos e estáveis.
6. **Resultados verificáveis.** Registrar comando, ambiente, versão, quantidade de testes, falhas e evidências. Uma mensagem impressa manualmente não substitui um código de saída igual a zero.
7. **Publicação bloqueada diante de incerteza crítica.** Falha na integridade, persistência, atualização offline ou em um teste obrigatório impede o deploy até ser esclarecida.

## 2. Separação dos ambientes

| Ambiente | Uso | Restrições |
|---|---|---|
| Desenvolvimento | Alterações e testes rápidos | Trabalhar em branch/worktree isolado |
| Testes unitários e integração | Regras financeiras, persistência e interface isolada | Dados sintéticos; sem serviços reais |
| E2E local | Navegador, responsividade, fluxos financeiros e sincronização | Firebase Auth/Firestore emuladores; isolamento obrigatório |
| Homologação de atualização PWA | Instalação, troca de Service Worker, funcionamento offline | Validar versão anterior e candidata, sem dados pessoais |
| Produção | GitHub Pages e usuários reais | Publicar somente artefato aprovado e verificável |

Dependências devem ser reproduzíveis a partir do `package-lock.json`; para um ambiente limpo, utilizar `npm ci --include=dev` e verificar previamente a presença do Firebase Tools e dos navegadores necessários. Não copiar manualmente dependências de outro worktree nem instalar versões aleatórias para contornar um erro.

## 3. Fluxo obrigatório para cada alteração

### Etapa A — Antes de modificar

- Confirmar branch e worktree; atualizar a referência da branch principal sem modificar a produção.
- Registrar versão-base, commit, escopo da mudança e plano de reversão.
- Verificar os testes pertinentes na base, quando possível, para identificar falhas preexistentes.
- Separar explicitamente alterações funcionais de melhorias de infraestrutura de testes.

### Etapa B — Implementação

- Alterar somente os arquivos necessários à demanda.
- Proteger funcionalidades financeiras, IndexedDB, sincronização, backup e migração contra efeitos colaterais.
- Não incorporar instrumentação temporária, logs de diagnóstico ou arquivos pessoais no pacote publicado.

### Etapa C — Testes direcionados

- Executar primeiro os testes do módulo e do cenário alterados.
- Para layout, testar as larguras relevantes, incluindo **320, 375, 390, 414 e 1280 px**, e os seis idiomas atualmente cobertos pelo cenário do Panorama, se a mudança afetar essa interface.
- Para persistência, verificar escrita durável, falhas, reload, operações pendentes, conflitos e múltiplas abas.
- Só passar à suíte mais ampla quando os cenários afetados estiverem aprovados.

### Etapa D — Suíte geral e E2E

- Executar `npm test` e verificar explicitamente **0 falhas**; testes ignorados devem ser contabilizados, não chamados de aprovados.
- Executar os comandos E2E com o executor isolado do projeto; este inicializa os emuladores e prepara as variáveis exigidas pelo Playwright.
- Para um cenário específico, preferir o filtro repassado pelo executor, por exemplo:

```powershell
node scripts/run-local-tests.mjs browser e2e/panorama.spec.mjs --project=msedge --workers=1
```

- Após corrigir um cenário isolado, executar a suíte E2E completa. Não inferir aprovação da suíte inteira a partir de um único teste.
- Para uma mudança com impacto multiplataforma, verificar os navegadores configurados; um teste no Edge não comprova funcionamento no Chrome nem no Safari/iPhone.

### Etapa E — Preparação da release

- Atualizar `version.json`, a identidade do Service Worker, a chave de cache e as referências de release relacionadas, de forma consistente.
- Conferir os arquivos listados pelo precache e os hashes embutidos no Service Worker antes de produzir o manifesto final.
- Gerar o manifesto externo SHA-256 **depois** de concluir todas as alterações em `published-site`, incluindo `sw.js`.
- Verificar cada hash, a inexistência de caminhos duplicados e a cobertura de todos os arquivos publicados.
- Não regenerar hashes automaticamente diante de divergência inesperada: primeiro identificar qual arquivo mudou e por quê.
- Manter o workflow de produção coerente com o modelo de artefato adotado; não mudar para um gerador dinâmico por causa de uma asserção de teste sem decisão de arquitetura.

### Etapa F — Homologação de atualização

- Simular atualização da versão publicada anterior para a candidata.
- Validar instalação, ativação, versão ativa, integridade do precache e recuperação em caso de instalação incompleta.
- Confirmar abertura offline após atualização, preservação de IndexedDB, filas, conflitos e dados sintéticos.
- Verificar que a nova instalação não destrói a versão funcional prematuramente.
- Funcionalidades dependentes do iOS PWA instalado, como seletor nativo de data, exigem verificação em dispositivo real ou evidência equivalente claramente identificada; testes desktop não substituem essa etapa.

### Etapa G — Aprovação e publicação

- Revisar `git diff`, `git diff --check`, branch, status e alterações pendentes.
- Excluir backups, relatórios, traces, dados sintéticos e arquivos temporários do commit.
- Registrar evidências e limitações de cobertura antes da aprovação.
- Criar commit apenas com arquivos intencionais. Fazer push/deploy somente após os critérios de liberação serem atendidos e autorizados.
- Conferir o resultado efetivo do GitHub Actions e a versão servida. Manter plano de rollback.

## 4. Como tratar uma falha de teste

A primeira ação é **classificar**, não corrigir às cegas:

| Categoria | Evidência típica | Ação correta |
|---|---|---|
| Regressão da aplicação | Comportamento incorreto que não existia na base | Corrigir produto e adicionar teste de regressão |
| Teste desatualizado ou frágil | Asserção contradiz o comportamento aprovado, inclusive na base | Atualizar a asserção para medir o requisito real, sem perder cobertura |
| Ambiente ou dependência | `MODULE_NOT_FOUND`, navegador ausente, emulador não iniciado | Restaurar ambiente e repetir o mesmo teste |
| Flutuação / sincronização | Falha intermitente por tempo, ordem, estado compartilhado | Isolar estado e aguardar condição observável, sem sleeps arbitrários |
| Segurança / integridade | CSP, hashes, cache ou regras inconsistentes | Investigar origem; não desabilitar a proteção |
| Falha ainda indeterminada | Mensagem booleana sem valores intermediários | Instrumentar medidas e produzir diagnóstico antes de alterar limites |

**Procedimento de diagnóstico:** conservar log, trace, captura e comando; reproduzir no menor cenário possível; comparar com a base; registrar medidas reais; aplicar uma única correção justificada; repetir o teste isolado e depois o conjunto afetado; remover instrumentação temporária.

## 5. Padrões específicos que evitam os erros observados na 1.1.20

### Interface e CSS

- Não validar indiscriminadamente `height: 14px` quando o CSS aprovado contém regras responsivas de `8px` ou `6px`.
- Se a intenção é legibilidade, medir **conteúdo visível**, ausência de sobreposição, limites dos elementos e rolagem horizontal.
- Elementos com `display: contents` não geram caixa própria; seus `getBoundingClientRect()` não representam a posição dos filhos. Medir o elemento realmente renderizado, como `.grafico-categoria-valor`, quando adequado.
- Asserções de layout devem distinguir explicitamente mobile e desktop. Não relaxar tolerâncias sem dados reais.

### Testes de código isolado

- Preferir funções/módulos exportados a recortes de texto extraídos do `app.js` por `slice()`.
- Quando o teste precisar de `vm.runInContext()`, declarar as dependências e efeitos simulados explicitamente, incluindo funções auxiliares e estados de animação pertinentes.
- Não usar mocks que ocultem operações financeiras que o teste deveria detectar.

### CSP e QA

- Hashes CSP de scripts inline devem corresponder **exatamente** aos bytes do HTML servido no ambiente de teste.
- Calcular o hash do script autorizado depois das transformações da cópia de QA.
- Validar o **cabeçalho efetivo** recebido pelo navegador. Expressões de interpolação precisam ser efetivamente avaliadas; texto literal como `${inlineHash}` dentro de aspas comuns não resolve a política.
- Manter `unsafe-inline` e `unsafe-eval` proibidos quando o cenário exige essa restrição; manter o bloqueio de Service Worker no QA IndexedDB.

### E2E e emuladores

- Usar o executor `scripts/run-local-tests.mjs`, que aceita argumentos adicionais do Playwright após o modo `browser`.
- Não executar o Playwright isoladamente ignorando as exigências de ambiente do `playwright.config.mjs`.
- Diante de falha em um cenário tardio, executá-lo de maneira filtrada antes de repetir todos os testes.
- O resultado de um script com saída diferente de zero é **falha**, mesmo que posteriormente alguém execute `Write-Host 'APROVADO'`.

## 6. Critérios de liberação (go/no-go)

A publicação somente está autorizada quando todos os itens obrigatórios abaixo estiverem satisfeitos:

- [ ] Escopo revisado, branch correta, diff limpo de erros e sem arquivos de diagnóstico no commit.
- [ ] Testes direcionados aprovados.
- [ ] Suíte principal aprovada, com ignorados explicitamente registrados.
- [ ] Compatibilidade E2E aprovada nos cenários exigidos para a mudança.
- [ ] E2E completo aprovado nos navegadores exigidos, ou exceção formal documentada e autorizada antes do deploy.
- [ ] Integridade dos arquivos do site e hashes do Service Worker verificados.
- [ ] Atualização da versão anterior para a candidata testada, incluindo funcionamento offline e preservação de dados sintéticos.
- [ ] Requisitos específicos de dispositivo (por exemplo, iPhone PWA instalado) comprovados ou registrados como **pendência bloqueante** quando indispensáveis ao objetivo da release.
- [ ] Workflow de produção, versão e manifesto coerentes.
- [ ] Evidências e plano de rollback registrados.
- [ ] Autorização explícita para commit/push/publicação.

**Regra:** a ausência de evidência não equivale a aprovação. Corrigir uma falha conhecida nunca autoriza ignorar outras ainda não executadas.

## 7. Registro de homologação por release

Usar este modelo como anexo ou arquivo de release:

```text
Release:
Branch / commit-base / commit candidato:
Escopo aprovado:
Ambiente: Node, navegador(es), Firebase Emulator, SO:
Testes direcionados (comandos e resultado):
Suíte principal: total / aprovados / falhas / ignorados:
Compatibilidade E2E:
E2E completo: total / aprovados / falhas / não executados:
Atualização offline: origem -> destino / evidências:
Preservação do IndexedDB e operações pendentes:
Manifesto SHA-256: número de arquivos / divergências:
Testes específicos em dispositivos reais:
Pendências e exceções autorizadas:
Responsável pela aprovação:
Data e hora:
Link do workflow / artefato implantado:
Plano de rollback:
```

## 8. Adoção incremental

Este documento é uma **proposta de padrão**, não uma declaração de que a infraestrutura já o implementa por completo. Adoção recomendada após concluir a 1.1.20:

1. Registrar o documento em `docs/` em uma mudança separada de infraestrutura/qualidade.
2. Criar verificações de pré-voo para dependências, navegadores, emuladores e integridade.
3. Reduzir testes frágeis que recortam `app.js` e estabilizar testes de CSS responsivo.
4. Definir uma automação de pré-publicação com relatórios e falha imediata na etapa crítica.
5. Validar periodicamente o procedimento de atualização offline e rollback.

**Histórico de motivação:** durante a preparação da 1.1.20, surgiram divergências entre teste e workflow, dependências ausentes em um worktree, hash CSP desatualizado e medições CSS incompatíveis com `display: contents` e com o layout responsivo. Essas ocorrências fundamentam os controles acima, mas não constituem, isoladamente, evidência de defeitos na aplicação publicada.
