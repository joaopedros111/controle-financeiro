import test from "node:test";
import assert from "node:assert/strict";
import { criarArmazenamento, criarRecuperacaoFinanceira } from "../storage.js";
import { normalizarEstado, validarBackup } from "../finance-core.js";

function armazenamentoFalso() {
    const dados = new Map();
    return {
        dados,
        getItem: (chave) => dados.get(chave) ?? null,
        setItem: (chave, valor) => dados.set(chave, String(valor)),
        removeItem: (chave) => dados.delete(chave)
    };
}

test("camada de armazenamento lê e grava JSON no armazenamento persistente", () => {
    const fake = armazenamentoFalso();
    const store = criarArmazenamento(fake);
    assert.equal(store.persistente, true);
    assert.equal(store.escreverJson("estado", { valor: 42 }), true);
    assert.deepEqual(store.lerJson("estado"), { valor: 42 });
    store.remover("estado");
    assert.equal(store.ler("estado"), null);
});

test("camada mantém cópia temporária quando o armazenamento persistente falha", () => {
    const fake = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem() {} };
    const store = criarArmazenamento(fake);
    assert.equal(store.escreverJson("estado", { valor: 7 }), false);
    assert.deepEqual(store.lerJson("estado"), { valor: 7 });
    assert.equal(store.persistente, false);
});

test("camada sem armazenamento local mantém os dados apenas na memória", () => {
    const store = criarArmazenamento(null, new Map());
    assert.equal(store.persistente, false);
    assert.equal(store.escrever("chave", "valor"), false);
    assert.equal(store.ler("chave"), "valor");
});

test("leitura JSON diferencia chave ausente, JSON válido e JSON corrompido", () => {
    const fake = armazenamentoFalso();
    fake.setItem("estado", "{json inválido");
    const store = criarArmazenamento(fake);

    assert.deepEqual(store.lerJsonResultado("ausente"), {
        estado: "ausente", valor: null, bruto: null
    });
    assert.equal(store.escreverJson("valido", { meses: {} }), true);
    assert.deepEqual(store.lerJsonResultado("valido"), {
        estado: "valido", valor: { meses: {} }, bruto: "{\"meses\":{}}"
    });
    assert.deepEqual(store.lerJsonResultado("estado", { protegerInvalido: true }), {
        estado: "invalido", valor: null, bruto: "{json inválido"
    });
});

test("estado JSON corrompido preserva o conteúdo e bloqueia gravação e remoção automáticas", () => {
    const fake = armazenamentoFalso();
    const original = '{"meses": "conteúdo recuperável incompleto"';
    fake.setItem("estado", original);
    const store = criarArmazenamento(fake);

    const resultado = store.lerJsonResultado("estado", { protegerInvalido: true });
    assert.equal(resultado.estado, "invalido");
    assert.equal(store.escreverJson("estado", { meses: {} }), false);
    assert.equal(store.remover("estado"), false);
    assert.equal(fake.getItem("estado"), original);
    assert.deepEqual(store.dadosProtegidos(), [{ chave: "estado", bruto: original }]);

    assert.equal(store.escreverJson("estado", { meses: {} }, { substituirProtegido: true }), true);
    assert.deepEqual(store.lerJsonResultado("estado").valor, { meses: {} });
    assert.deepEqual(store.dadosProtegidos(), []);
});

test("estado JSON legível mas com estrutura inválida também pode ser protegido da gravação automática", () => {
    const fake = armazenamentoFalso();
    const original = '{"meses":"estrutura inválida"}';
    fake.setItem("estado", original);
    const store = criarArmazenamento(fake);
    const resultado = store.lerJsonResultado("estado");

    assert.equal(resultado.estado, "valido");
    assert.equal(resultado.valor.meses, "estrutura inválida");
    store.proteger("estado", resultado.bruto);
    assert.equal(store.escreverJson("estado", { meses: {} }), false);
    assert.equal(fake.getItem("estado"), original);
});

test("falha de leitura é distinta de ausência e não substitui conteúdo inacessível", () => {
    let escritaRealizada = false;
    const local = {
        getItem: () => { throw new Error("indisponível"); },
        setItem: () => { escritaRealizada = true; },
        removeItem() {}
    };
    const store = criarArmazenamento(local);

    assert.deepEqual(store.lerJsonResultado("estado"), {
        estado: "erro", valor: null, bruto: null
    });
    store.proteger("estado");
    assert.equal(store.escreverJson("estado", { meses: {} }), false);
    assert.equal(escritaRealizada, false);
});

test("armazenamento indisponível sem dados preserva o fallback em memória", () => {
    const store = criarArmazenamento(null, new Map());

    assert.equal(store.lerJsonResultado("estado").estado, "indisponivel");
    assert.equal(store.escreverJson("estado", { meses: {} }), false);
    assert.equal(store.persistente, false);
    assert.deepEqual(store.lerJson("estado"), { meses: {} });
});

test("recuperação distingue chave ausente e libera exportação normal quando não há proteção", () => {
    const fake = armazenamentoFalso();
    const store = criarArmazenamento(fake);
    const recuperacao = criarRecuperacaoFinanceira(store);
    let geracoes = 0;

    assert.equal(store.lerJsonResultado("estado").estado, "ausente");
    assert.equal(recuperacao.exportarBackup(() => { geracoes += 1; }), true);
    assert.equal(geracoes, 1);
    assert.equal(recuperacao.exportarBackup(() => false), false);
});

test("recuperação protege JSON corrompido e bloqueia geração do backup normal", () => {
    const fake = armazenamentoFalso();
    const original = '{"meses":';
    fake.setItem("estado", original);
    const store = criarArmazenamento(fake);
    const leitura = store.lerJsonResultado("estado", { protegerInvalido: true });
    const recuperacao = criarRecuperacaoFinanceira(store);
    recuperacao.proteger("estado", leitura.bruto);
    let geracoes = 0;

    assert.equal(recuperacao.exportarBackup(() => { geracoes += 1; }), false);
    assert.equal(geracoes, 0);
    assert.equal(fake.getItem("estado"), original);
    assert.deepEqual(recuperacao.fontes(), [{ chave: "estado", bruto: original }]);
});

test("restauração rejeita backup inválido e cancelamento mantém intacta a fonte protegida", () => {
    const fake = armazenamentoFalso();
    const original = '{"meses":';
    fake.setItem("estado", original);
    const store = criarArmazenamento(fake);
    const recuperacao = criarRecuperacaoFinanceira(store);
    recuperacao.proteger("estado", original);
    const opcoes = {
        chave: "estado",
        backup: { meses: {} },
        validar: (backup) => backup.valido === true,
        normalizar: (backup) => backup,
        confirmar: () => true
    };

    assert.equal(recuperacao.restaurar(opcoes).estado, "invalido");
    assert.equal(fake.getItem("estado"), original);
    assert.equal(recuperacao.restaurar({
        ...opcoes,
        backup: { valido: true, meses: {} },
        confirmar: () => false
    }).estado, "cancelado");
    assert.equal(fake.getItem("estado"), original);
    assert.equal(recuperacao.protegido, true);
});

test("restauração confirmada valida e persiste antes de liberar a proteção", () => {
    const fake = armazenamentoFalso();
    const original = '{"meses":';
    fake.setItem("estado", original);
    const store = criarArmazenamento(fake);
    const recuperacao = criarRecuperacaoFinanceira(store);
    recuperacao.proteger("estado", original);
    const dadosRestaurados = { meses: { "2026-01": { receitas: [], despesas: [] } } };

    const resultado = recuperacao.restaurar({
        chave: "estado",
        backup: { valido: true },
        validar: (backup) => backup.valido,
        normalizar: () => dadosRestaurados,
        confirmar: () => true
    });

    assert.equal(resultado.estado, "restaurado");
    assert.equal(resultado.persistido, true);
    assert.deepEqual(JSON.parse(fake.getItem("estado")), dadosRestaurados);
    assert.equal(recuperacao.protegido, false);
});

test("falha ao persistir restauração conserva a fonte bruta e relata fallback em memória", () => {
    const original = '{"meses":';
    const backup = {
        versao: 3,
        categorias: [],
        meses: { "2026-01": { receitas: [{ nome: "Entrada válida", valor: 12.34 }], despesas: [] } },
        orcamentos: { padrao: {}, meses: {} }
    };
    const fake = {
        getItem: () => original,
        setItem: () => { throw new Error("quota"); },
        removeItem() {}
    };
    const store = criarArmazenamento(fake);
    const recuperacao = criarRecuperacaoFinanceira(store);
    recuperacao.proteger("estado", original);

    const resultado = recuperacao.restaurar({
        chave: "estado",
        backup,
        validar: validarBackup,
        normalizar: (dados) => normalizarEstado(dados, () => "restore-id"),
        confirmar: () => true
    });

    assert.equal(resultado.estado, "restaurado");
    assert.equal(resultado.persistido, false);
    assert.equal(fake.getItem("estado"), original);
    assert.deepEqual(store.lerJson("estado"), normalizarEstado(backup, () => "restore-id"));
    assert.equal(recuperacao.protegido, true);
    assert.equal(recuperacao.exportarBackup(() => true), false);
});

test("fluxo real de recuperação valida, confirma e preserva a fonte até persistir", () => {
    const chave = "estado";
    const backupValido = {
        versao: 3,
        categorias: [],
        meses: {
            "2026-01": {
                receitas: [{ nome: "Entrada válida", valor: 12.34 }],
                despesas: []
            }
        },
        orcamentos: { padrao: {}, meses: {} }
    };
    const fake = armazenamentoFalso();
    const store = criarArmazenamento(fake);
    const recuperacao = criarRecuperacaoFinanceira(store);

    assert.equal(store.lerJsonResultado(chave).estado, "ausente");
    assert.equal(recuperacao.exportarBackup(() => true), true);

    const original = '{"meses":';
    fake.setItem(chave, original);
    const leitura = store.lerJsonResultado(chave, { protegerInvalido: true });
    recuperacao.proteger(chave, leitura.bruto);
    assert.equal(recuperacao.exportarBackup(() => true), false);

    const opcoes = {
        chave,
        backup: { meses: { "2026-01": { receitas: [{ nome: "Inválida", valor: -1 }], despesas: [] } } },
        validar: validarBackup,
        normalizar: (backup) => normalizarEstado(backup, () => "restore-id"),
        confirmar: () => true
    };
    assert.equal(recuperacao.restaurar(opcoes).estado, "invalido");
    assert.equal(fake.getItem(chave), original);

    assert.equal(recuperacao.restaurar({
        ...opcoes,
        backup: backupValido,
        confirmar: () => false
    }).estado, "cancelado");
    assert.equal(fake.getItem(chave), original);

    const resultado = recuperacao.restaurar({
        ...opcoes,
        backup: backupValido
    });
    assert.equal(resultado.estado, "restaurado");
    assert.equal(resultado.persistido, true);
    assert.deepEqual(
        JSON.parse(fake.getItem(chave)),
        normalizarEstado(backupValido, () => "restore-id")
    );
    assert.equal(recuperacao.protegido, false);
});
