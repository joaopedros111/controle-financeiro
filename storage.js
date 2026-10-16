(function () {
  const CHAVE = 'controle-financeiro-dados';
  const memoria = new Map();

  function disponivel() {
    try {
      const teste = '__teste_storage__';
      localStorage.setItem(teste, '1');
      localStorage.removeItem(teste);
      return true;
    } catch {
      return false;
    }
  }

  const temStorage = disponivel();

  function ler() {
    try {
      if (!temStorage) return memoria.get(CHAVE) || null;

      const bruto = localStorage.getItem(CHAVE);
      return bruto ? JSON.parse(bruto) : null;
    } catch (erro) {
      console.error('Não foi possível ler os dados salvos.', erro);
      return null;
    }
  }

  function salvar(dados) {
    try {
      const serializado = JSON.stringify(dados);

      if (temStorage) {
        localStorage.setItem(CHAVE, serializado);
      } else {
        memoria.set(CHAVE, dados);
      }

      return true;
    } catch (erro) {
      console.error('Não foi possível salvar os dados.', erro);
      return false;
    }
  }

  function limpar() {
    try {
      if (temStorage) localStorage.removeItem(CHAVE);
      memoria.delete(CHAVE);
      return true;
    } catch (erro) {
      console.error('Não foi possível limpar os dados.', erro);
      return false;
    }
  }

  window.ControleFinanceiroStorage = {
    ler,
    salvar,
    limpar,
    temStorage
  };
})();