import test from 'node:test';
import assert from 'node:assert/strict';

import { analisarMigracaoLocal } from '../account-local-migration.js';
import { normalizarEstado } from '../finance-core.js';
import { recordEntityKey } from '../sync-core.js';

const analisarComFila = (estado, remoto) =>
    analisarMigracaoLocal(estado, remoto, {
        outbox: [],
        conflicts: []
    });
const entrada = (id, nome, valor) => ({ id, nome, valor });

function estadoCom(...receitas) {
    return normalizarEstado({
        meses: {
            '2026-11': { receitas, despesas: [] }
        }
    });
}

const remoto = (id, nome, valor) => {
    const item = {
        month: '2026-11',
        type: 'receitas',
        id,
        deleted: false,
        revision: 'rev-1',
        updatedAt: { seconds: 100, nanoseconds: 0 },
        record: entrada(id, nome, valor)
    };
    return { ...item, _docId: recordEntityKey(item) };
};

test('migração aceita estado financeiro vazio', () => {
    const estado = normalizarEstado(null);
    const resultado = analisarComFila(estado, []);

    assert.equal(resultado.quantidadeLocal, 0);
    assert.equal(resultado.quantidadeRemota, 0);
    assert.equal(resultado.conflitos.length, 0);
    assert.equal(resultado.duplicidades.length, 0);
    assert.deepEqual(resultado.estado.meses, estado.meses);
});

test('migração rejeita dados locais inválidos', () => {
    assert.throws(
        () => analisarComFila(null, []),
        /Dados locais inválidos/
    );
});

test('migração rejeita lista remota inválida', () => {
    assert.throws(
        () => analisarComFila(normalizarEstado(null), null),
        /Registros remotos inválidos/
    );
});

test('combina lançamentos locais e remotos distintos', () => {
    const resultado = analisarComFila(
        estadoCom(entrada('local-1', 'Salário', 5000)),
        [remoto('remoto-1', 'Extra', 500)]
    );

    const receitas = resultado.estado.meses['2026-11'].receitas;

    assert.equal(receitas.length, 2);
    assert.deepEqual(
        new Set(receitas.map(item => item.id)),
        new Set(['local-1', 'remoto-1'])
    );
});

test('preserva duas versões quando o mesmo ID tem valores diferentes', () => {
    const resultado = analisarComFila(
        estadoCom(entrada('registro-1', 'Salário', 5000)),
        [remoto('registro-1', 'Salário', 6000)]
    );

    const receitas = resultado.estado.meses['2026-11'].receitas;

    assert.equal(receitas.length, 2);
    assert.equal(resultado.conflitos.length, 1);
    assert.deepEqual(
        new Set(receitas.map(item => item.valor)),
        new Set([5000, 6000])
    );
});

test('identifica possível duplicidade sem excluir lançamentos', () => {
    const resultado = analisarComFila(
        estadoCom(entrada('local-1', 'Salário', 5000)),
        [remoto('remoto-1', 'Salário', 5000)]
    );

    assert.equal(resultado.duplicidades.length, 1);
    assert.equal(resultado.estado.meses['2026-11'].receitas.length, 2);
});
test('bloqueia migração com exclusão remota sem ressuscitar registro', () => {
    const local = estadoCom(
        entrada('registro-1', 'Salário', 5000)
    );

    const tombstone = {
        month: '2026-11',
        type: 'receitas',
        id: 'registro-1',
        deleted: true,
        revision: 'rev-2'
    };

    const original = structuredClone(local);

    assert.throws(
        () => analisarComFila(local, [tombstone]),
        /Migração bloqueada/
    );

    assert.deepEqual(local, original);
});

test('bloqueia migração quando existe operação offline pendente', () => {
    const estado = estadoCom(entrada('local-1', 'Salário', 5000));

    const fila = {
        outbox: [{ id: 'operacao-1', state: 'pending' }],
        conflicts: []
    };

    assert.throws(
        () => analisarMigracaoLocal(estado, [], fila),
        /Migração bloqueada/
    );
});

test('bloqueia migração quando existem conflitos locais', () => {
    const fila = {
        outbox: [],
        conflicts: [{ kind: 'concurrent-change' }]
    };

    assert.throws(
        () => analisarMigracaoLocal(normalizarEstado(null), [], fila),
        /Migração bloqueada/
    );
});

test('aceita análise com fila local vazia', () => {
    const fila = { outbox: [], conflicts: [] };
    const resultado = analisarMigracaoLocal(normalizarEstado(null), [], fila);

    assert.equal(resultado.quantidadeLocal, 0);
    assert.equal(resultado.conflitos.length, 0);
});

test('rejeita migração sem fila local verificada', () => {
    const estado = estadoCom(entrada('local-1', 'Salário', 5000));

    assert.throws(
        () => analisarMigracaoLocal(estado, [], null),
        /Fila local.*inválida|Fila local.*obrigatória/
    );
});

test('rejeita registro remoto incompleto', () => {
    const estado = normalizarEstado(null);

    assert.throws(
        () => analisarComFila(estado, [
            {
                month: '2026-11',
                type: 'receitas',
                id: 'remoto-1',
                _docId: recordEntityKey({
                    month: '2026-11',
                    type: 'receitas',
                    id: 'remoto-1'
                })
            }
        ]),
        /remot.*inválid|Registro remoto inválido/i
    );
});

test('rejeita documentos remotos com a mesma chave', () => {
    const item = remoto('remoto-1', 'Salário', 5000);

    assert.throws(
        () => analisarComFila(normalizarEstado(null), [item, structuredClone(item)]),
        /chaves duplicadas/
    );
});

test('rejeita documento remoto com _docId inconsistente', () => {
    const item = {
        ...remoto('remoto-1', 'Salário', 5000),
        _docId: 'documento-incorreto'
    };

    assert.throws(
        () => analisarComFila(normalizarEstado(null), [item]),
        /inconsistentes/
    );
});

test('rejeita registro remoto sem revisão', () => {
    const item = remoto('remoto-1', 'Salário', 5000);
    delete item.revision;

    assert.throws(
        () => analisarComFila(normalizarEstado(null), [item]),
        /Registro remoto inválido/
    );
});

test('rejeita registro remoto com timestamp inválido', () => {
    const item = remoto('remoto-1', 'Salário', 5000);
    item.updatedAt = 'data-invalida';

    assert.throws(
        () => analisarComFila(normalizarEstado(null), [item]),
        /Registro remoto inválido/
    );
});

test('rejeita valor financeiro remoto negativo', () => {
    const item = remoto('remoto-1', 'Salário', -100);

    assert.throws(
        () => analisarComFila(normalizarEstado(null), [item]),
        /Registro remoto inválido/
    );
});

import { descobrirFontesAnonimas, analisarFontesDescobertas, revisarFontesAnonimas, importarFontesAnonimas } from '../account-local-migration.js';
import { financeSettings } from '../automatic-sync-policy.js';
const reviewUid = 'synthetic-migration-owner';
function fontes({ idb = {}, local = {}, unavailable, current = () => true } = {}) {
    const docs = new Map(Object.entries({ [`estado:${reviewUid}`]: { revisao: 5, dados: estadoCom() }, [`fila:${reviewUid}`]: { outbox: [], conflicts: [], generation: 'legacy' }, ...idb }));
    const data = new Map(Object.entries(local)), calls = [];
    const db = { async lerDocumentos(keys) { calls.push(['read', [...keys]]); if (unavailable === 'idb') throw new Error('Synthetic IDB failure'); return new Map(keys.map(key => [key, structuredClone(docs.get(key) ?? null)])); }, alterarDocumentos() { throw new Error('Discovery must never write'); } };
    const storage = { getItem(key) { calls.push(['get', key]); if (unavailable === key) throw new Error('Synthetic storage failure'); return data.get(key) ?? null; }, setItem() { throw new Error('Discovery must never write'); }, removeItem() { throw new Error('Discovery must never delete'); } };
    const options = { db, storage, uid: reviewUid, isCurrent: current, anoLegado: 2026 };
    return { docs, data, calls, options, snapshot: () => JSON.stringify([[...docs], [...data]]) };
}
const anonPair = (state = estadoCom(), fila = { outbox: [], conflicts: [] }) => ({ 'estado:@local': { revisao: 3, dados: state }, 'fila:@local': fila });
const server = (records = []) => ({ uid: reviewUid, generation: 'legacy', protocol: 1, metadata: { fromCache: false, hasPendingWrites: false }, records,
    settings: { ...financeSettings(estadoCom()), revision: 'synthetic-settings', updatedAt: { seconds: 100, nanoseconds: 0 } }, conflicts: [] });
const review = (h, reader = async () => server()) => revisarFontesAnonimas({ ...h.options, online: true, snapshotReader: reader });

test('descoberta exige sessão válida antes de qualquer leitura financeira', async () => {
    const h = fontes({ current: () => false });
    await assert.rejects(descobrirFontesAnonimas(h.options), { code: 'migration/session-changed' }); assert.equal(h.calls.length, 0);
});
test('fontes realmente ausentes não são confundidas com fila vazia verificada', async () => {
    const h = fontes(), before = h.snapshot(), found = await descobrirFontesAnonimas(h.options);
    assert.equal(found.required, false); assert.equal(found.queue, null); assert.equal(found.quantity, 0);
    assert.ok(found.sources.every(s => s.status === 'ausente')); assert.equal(h.snapshot(), before);
});
test('descobre v3 somente leitura, preserva bruto e bloqueia fila não verificada', async () => {
    const state = estadoCom(entrada('synthetic-v3', 'Origem v3', 20)), raw = JSON.stringify(state);
    const h = fontes({ local: { 'controleFinanceiro:v3': raw } }), found = await descobrirFontesAnonimas(h.options);
    assert.equal(found.selected, 'controleFinanceiro:v3'); assert.equal(found.quantity, 1);
    assert.equal(found.sources.find(s => s.key === 'controleFinanceiro:v3').raw, raw);
    assert.ok(found.blockers.some(x => x.code === 'queue-unverified')); assert.equal(h.data.get('controleFinanceiro:v3'), raw);
});
test('v2 numérico textual tem prévia determinística e conversão declarada, sem regravação', async () => {
    const state = estadoCom(entrada('synthetic-v2', 'Origem v2', 20)); state.versao = 2; state.meses['2026-11'].receitas[0].valor = '20';
    const h = fontes({ local: { 'controleFinanceiro:v2': JSON.stringify(state) } }), before = h.snapshot();
    const a = await descobrirFontesAnonimas(h.options), b = await descobrirFontesAnonimas(h.options);
    assert.equal(a.candidates[0].state.meses['2026-11'].receitas[0].valor, 20); assert.equal(a.sources.find(s => s.key === 'controleFinanceiro:v2').conversions, true);
    assert.equal(a.fingerprint, b.fingerprint); assert.equal(h.snapshot(), before);
});
test('IDs ausentes recebem apenas IDs de prévia determinísticos; original fica intacto', async () => {
    const state = estadoCom(); state.meses['2026-11'].receitas.push({ nome: 'Sem ID', valor: 8 });
    const h = fontes({ local: { 'controle-financeiro-dados': JSON.stringify(state) } });
    const a = await descobrirFontesAnonimas(h.options), b = await descobrirFontesAnonimas(h.options);
    assert.deepEqual(a.candidates, b.candidates); assert.ok(a.sources.find(s => s.key === 'controle-financeiro-dados').assignedIds > 0);
    assert.equal(JSON.parse(h.data.get('controle-financeiro-dados')).meses['2026-11'].receitas[0].id, undefined);
});
test('prioridade IndexedDB/v3/v2 não elimina fontes divergentes nem suas configurações', async () => {
    const idb = estadoCom(entrada('synthetic-idb', 'IDB', 30)), v3 = estadoCom(entrada('synthetic-v3', 'V3', 50)), v2 = estadoCom(entrada('synthetic-v2', 'V2', 70));
    v3.orcamentos.padrao.Casa = 200;
    const h = fontes({ idb: anonPair(idb), local: { 'controleFinanceiro:v3': JSON.stringify(v3), 'controleFinanceiro:v2': JSON.stringify(v2) } }), before = h.snapshot();
    const found = await descobrirFontesAnonimas(h.options);
    assert.equal(found.selected, 'estado:@local'); assert.equal(found.candidates.length, 3); assert.equal(found.divergent.length, 2);
    assert.ok(found.blockers.some(x => x.code === 'divergent-sources')); assert.equal(h.snapshot(), before);
});
test('fonte prioritária inválida não é silenciosamente ignorada em favor de v2 válida', async () => {
    const h = fontes({ local: { 'controleFinanceiro:v3': '{invalid', 'controleFinanceiro:v2': JSON.stringify(estadoCom()) } });
    const found = await descobrirFontesAnonimas(h.options); assert.equal(found.sources.find(s => s.key === 'controleFinanceiro:v3').status, 'invalido');
    assert.ok(found.blockers.some(x => x.code === 'invalid-source'));
});
test('estado e fila parcialmente existentes bloqueiam mesmo com alternativa local válida', async () => {
    for (const idb of [{ 'estado:@local': { revisao: 2, dados: estadoCom() } }, { 'fila:@local': { outbox: [], conflicts: [] } }]) {
        const h = fontes({ idb, local: { 'controleFinanceiro:v3': JSON.stringify(estadoCom()) } });
        assert.ok((await descobrirFontesAnonimas(h.options)).blockers.some(x => x.code === 'partial-state-queue'));
    }
});
test('falhas IndexedDB e localStorage são inacessíveis, nunca fontes vazias', async () => {
    for (const unavailable of ['idb', 'controleFinanceiro:v3']) {
        const h = fontes({ unavailable }), found = await descobrirFontesAnonimas(h.options);
        assert.equal(found.required, true); assert.ok(found.sources.some(s => s.status === 'inacessivel')); assert.ok(found.blockers.some(x => x.code === 'source-unavailable'));
    }
});
test('legados mensais reutilizam conversor puro e explicitam ano inferido', async () => {
    const raw = JSON.stringify({ renda: '250', categorias: ['Casa'], despesas: [{ nome: 'Despesa mensal', valor: 10, categoria: 'Casa' }] });
    const h = fontes({ local: { 'controleFinanceiro-1': raw } }), before = h.snapshot(), found = await descobrirFontesAnonimas(h.options);
    assert.equal(found.candidates[0].state.meses['2026-01'].receitas[0].valor, 250); assert.equal(found.quantity, 2);
    assert.ok(found.blockers.some(x => x.code === 'legacy-year-requires-review')); assert.equal(h.snapshot(), before);
});
test('mês legado inválido não desaparece silenciosamente do relatório', async () => {
    const h = fontes({ local: { 'controleFinanceiro-2': JSON.stringify({ despesas: [{ nome: '', valor: 10 }] }), 'controleFinanceiro-3': JSON.stringify({ renda: 50 }) } });
    const found = await descobrirFontesAnonimas(h.options); assert.equal(found.sources.find(s => s.key === 'controleFinanceiro-2').status, 'invalido');
    assert.ok(found.blockers.some(x => x.code === 'invalid-source'));
});
test('metadados anônimos são registrados sem misturar fila à conta Google', async () => {
    const raw = JSON.stringify({ outbox: [{ id: 'synthetic-legacy-operation' }], conflicts: [] });
    const h = fontes({ local: { 'controleFinanceiro:sync:@local': raw } }), found = await descobrirFontesAnonimas(h.options);
    assert.ok(found.blockers.some(x => x.code === 'legacy-metadata-unverified'));
    assert.deepEqual(h.docs.get(`fila:${reviewUid}`).outbox, []); assert.equal(h.data.get('controleFinanceiro:sync:@local'), raw);
});
test('outbox, tombstones, conflitos e referências de recuperação permanecem byte a byte', async () => {
    const deleted = { month: '2026-11', type: 'receitas', id: 'synthetic-delete-target', deleted: true };
    const q = { outbox: [{ id: 'synthetic-delete', entityKey: recordEntityKey(deleted), baseRevision: null, value: deleted, generation: 'old' }], conflicts: [{ kind: 'same-id' }], recoveryKeys: ['original-copy'] };
    const h = fontes({ idb: anonPair(estadoCom(entrada('x', 'Não ressuscitar', 5)), q) }), before = h.snapshot();
    const found = await descobrirFontesAnonimas(h.options), meta = found.sources.find(s => s.key === 'fila:@local');
    assert.equal(meta.tombstones, 1); assert.equal(meta.conflicts, 1); assert.ok(found.blockers.some(x => x.code === 'pending-queue-or-recovery'));
    assert.deepEqual(found.queue, q); assert.equal(h.snapshot(), before);
});
test('campos desconhecidos são preservados e sinalizados, não descartados como migração concluída', async () => {
    const state = { ...estadoCom(), customRecovery: { important: true } }, h = fontes({ idb: anonPair(state) });
    const found = await descobrirFontesAnonimas(h.options); assert.ok(found.blockers.some(x => x.code === 'unsupported-fields'));
    assert.equal(found.sources.find(s => s.key === 'estado:@local').original.dados.customRecovery.important, true);
});
test('análise consolidada relata conflitos e duplicidades sem alterar origens ou conta preexistente', async () => {
    const local = estadoCom(entrada('same', 'Mesmo ID', 10), entrada('other', 'Duplicado', 20)), h = fontes({ idb: anonPair(local) }), before = h.snapshot();
    const found = await descobrirFontesAnonimas(h.options), report = analisarFontesDescobertas(found, server([remoto('same', 'Mesmo ID', 15), remoto('another', 'Duplicado', 20)]));
    assert.equal(report.analyses[0].conflicts, 1); assert.equal(report.analyses[0].duplicates, 1); assert.equal(report.importAllowed, false);
    assert.ok(report.sources.every(s => !('original' in s) && !('raw' in s))); assert.equal(h.snapshot(), before);
});
test('snapshot cacheado, ausente ou com pending writes jamais é confirmado pela revisão', async () => {
    const h = fontes({ idb: anonPair() }), found = await descobrirFontesAnonimas(h.options);
    for (const metadata of [undefined, { fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }])
        assert.throws(() => analisarFontesDescobertas(found, { ...server(), metadata }), { code: 'migration/unconfirmed-snapshot' });
});
test('tombstone remoto bloqueia importação e não ressuscita lançamento local', async () => {
    const h = fontes({ idb: anonPair(estadoCom(entrada('gone', 'Excluído', 5))) }), found = await descobrirFontesAnonimas(h.options);
    const tombstone = remoto('gone', 'Excluído', 5); tombstone.deleted = true; delete tombstone.record;
    const report = analisarFontesDescobertas(found, server([tombstone]));
    assert.ok(report.blockers.some(x => x.code === 'remote-tombstones')); assert.equal(report.importAllowed, false); assert.equal(report.quantityRemote, 0);
});
test('protocolo, UID, configurações e conflitos remotos inválidos bloqueiam revisão', async () => {
    const h = fontes({ idb: anonPair() }), found = await descobrirFontesAnonimas(h.options);
    for (const patch of [{ protocol: 3 }, { uid: 'different-owner' }, { settings: { invalid: true } }, { conflicts: [{}] }]) assert.throws(() => analisarFontesDescobertas(found, { ...server(), ...patch }));
});
test('offline bloqueia antes de ler fontes ou acessar leitor remoto', async () => {
    const h = fontes(); let calls = 0;
    await assert.rejects(revisarFontesAnonimas({ ...h.options, online: false, snapshotReader: async () => { calls++; } }), { code: 'migration/offline' });
    assert.equal(calls, 0); assert.equal(h.calls.length, 0);
});
test('falha remota interrompe revisão sem gravação de recuperação fictícia em memória', async () => {
    const h = fontes({ idb: anonPair() }), before = h.snapshot();
    await assert.rejects(review(h, async () => { throw Object.assign(new Error('Servidor indisponível'), { code: 'unavailable' }); }), { code: 'unavailable' });
    assert.equal(h.snapshot(), before);
});
test('logout ou troca de UID durante snapshot invalida toda resposta tardia', async () => {
    let active = true; const h = fontes({ idb: anonPair(), current: () => active }), before = h.snapshot();
    await assert.rejects(review(h, async () => { active = false; return server(); }), { code: 'migration/session-changed' });
    assert.equal(h.snapshot(), before);
});
test('outra aba alterando revisão anônima exige nova revisão sem sobrescrever a alteração', async () => {
    const h = fontes({ idb: anonPair() });
    await assert.rejects(review(h, async () => { h.docs.get('estado:@local').revisao++; return server(); }), { code: 'migration/source-changed' });
    assert.equal(h.docs.get('estado:@local').revisao, 4);
});
test('outra aba alterando estado ou fila Google também invalida a revisão', async () => {
    for (const change of [h => { h.docs.get(`estado:${reviewUid}`).revisao++; }, h => { h.docs.get(`fila:${reviewUid}`).outbox.push({ id: 'synthetic-new' }); }]) {
        const h = fontes({ idb: anonPair() }); await assert.rejects(review(h, async () => { change(h); return server(); }), { code: 'migration/account-changed' });
    }
});
test('repetir e retomar revisão após interrupção é determinístico e não duplica lançamentos', async () => {
    const h = fontes({ idb: anonPair(estadoCom(entrada('repeat', 'Repetir', 8))) }), before = h.snapshot();
    await assert.rejects(review(h, async () => { throw new Error('Interrupção'); }));
    const a = await review(h), b = await review(h); assert.deepEqual(a, b); assert.equal(h.snapshot(), before);
});
test('consentimento ou repetição jamais contorna importação explicitamente não homologada', () => {
    const h = fontes({ idb: anonPair() }), before = h.snapshot();
    for (let i = 0; i < 2; i++) assert.throws(() => importarFontesAnonimas({ consent: true, db: h.options.db }), { code: 'migration/import-blocked' });
    assert.equal(h.snapshot(), before);
});


test('payload de fila malformado é inválido e não vira fila vazia ou verificada', async () => {
    const h = fontes({ idb: anonPair(estadoCom(), { outbox: [{ id: 'malformed' }], conflicts: [] }) }), before = h.snapshot();
    const found = await descobrirFontesAnonimas(h.options);
    assert.equal(found.sources.find(s => s.key === 'fila:@local').status, 'invalido');
    assert.equal(found.queue, null); assert.ok(found.blockers.some(x => x.code === 'invalid-queue'));
    assert.equal(h.snapshot(), before);
});
