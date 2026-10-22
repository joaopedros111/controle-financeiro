import test from "node:test";
import assert from "node:assert/strict";
import { chaveLocalConta, caminhoConta, registrosFinanceiros, combinarRegistros, operationId, makeOperation, applyRemoteRecord, createSyncQueue, migrationBackup, revisionMatches, recordsEquivalent, coalesceOutbox, flushSyncQueue, createSyncSessionGuard, validateRemoteSettings, mergeRemoteSettings, validRemoteTombstone, reconcileRemoteConflicts, validateRemoteConflicts } from "../sync-core.js";

const income = (id, extra = {}) => ({ month: "2026-10", type: "receitas", id, record: { id, nome: "Salário", valor: 1000, ...extra } });
const state = (records = []) => ({ versao: 3, tema: "claro", categorias: [], orcamentos: { padrao: {}, meses: {} }, meses: { "2026-10": { receitas: records, despesas: [] } } });

test("contas têm chaves e caminhos estritamente isolados por UID", () => {
    assert.notEqual(chaveLocalConta("user-a"), chaveLocalConta("user-b"));
    assert.equal(caminhoConta("user-a", "records", "abc"), "users/user-a/records/abc");
    assert.throws(() => caminhoConta("user-a", "public", "abc"));
    assert.throws(() => chaveLocalConta("../user"));
});

test("primeira migração combina os meses e mantém IDs; repetição é idempotente", () => {
    const result = combinarRegistros([income("local")], [income("remote")]);
    assert.deepEqual(result.records.map((entry) => entry.id).sort(), ["local", "remote"]);
    const repeat = combinarRegistros(result.records, [income("remote")]);
    assert.equal(repeat.records.length, 2);
});

test("IDs idênticos com conteúdo diferente preservam ambos e registram conflito", () => {
    const result = combinarRegistros([income("same", { valor: 10 })], [income("same", { valor: 20 })]);
    assert.equal(result.conflitos.length, 1);
    assert.equal(result.records.length, 2);
});

test("IDs distintos com campos equivalentes são candidatos e não somem por padrão", () => {
    const result = combinarRegistros([income("a")], [income("b")]);
    assert.equal(result.possiveisDuplicatas.length, 1);
    assert.equal(result.records.length, 2);
    assert.equal(combinarRegistros([income("a")], [income("b")], { deduplicarExatos: true }).records.length, 1);
    assert.equal(combinarRegistros([income("a", { valor: 1 })], [income("b")]).possiveisDuplicatas.length, 0);
});

test("outbox usa IDs idempotentes, permite retomar depois de falha e confirma apenas ACK", () => {
    const data = new Map(); const storage = { get: (key) => data.get(key), set: (key, value) => data.set(key, structuredClone(value)) };
    const queue = createSyncQueue(storage, "user-a"), operation = makeOperation("record-1", { deleted: true }, "rev-1");
    assert.equal(operation.id, operationId("record-1", "rev-1", { deleted: true }));
    queue.enqueue(operation); queue.enqueue(operation);
    assert.equal(queue.state().outbox.length, 1);
    queue.acknowledge(operation.id, "2026-10-19T00:00:00.000Z");
    assert.equal(queue.state().outbox.length, 0);
    assert.equal(queue.state().lastConfirmed, "2026-10-19T00:00:00.000Z");
});

test("tombstone remove local entry e impede que um restore implícito altere a regra", () => {
    const current = state([income("r1").record]);
    const deleted = applyRemoteRecord(current, { month: "2026-10", type: "receitas", id: "r1", deleted: true });
    assert.equal(deleted.meses["2026-10"].receitas.length, 0);
});

test("backup pré-migração tem chave por UID e falha de escrita interrompe o fluxo", () => {
    const stateValue = state([income("r1").record]); const store = new Map();
    migrationBackup(stateValue, { set: (key, value) => (store.set(key, value), true) }, "user-a");
    assert.ok(store.has("controleFinanceiro:sync-backup:user-a"));
    assert.throws(() => migrationBackup(stateValue, { set: () => false }, "user-b"));
    assert.equal(registrosFinanceiros(stateValue).length, 1);
});

test("interrupção de migração pode ser repetida sem mudar o backup inicial ou duplicar registros", () => {
    const store = new Map(); const storage = { get: (key) => store.get(key), set: (key, value) => (store.set(key, structuredClone(value)), true) };
    const local = [income("same"), income("local")], remote = [income("same"), income("remote")];
    migrationBackup(state(local.map((entry) => entry.record)), storage, "user-a");
    const first = combinarRegistros(local, remote);
    const backupBeforeRetry = structuredClone(store.get("controleFinanceiro:sync-backup:user-a"));
    migrationBackup(state(first.records.map((entry) => entry.record)), storage, "user-a");
    const resumed = combinarRegistros(first.records, remote);
    assert.deepEqual(store.get("controleFinanceiro:sync-backup:user-a"), backupBeforeRetry);
    assert.equal(resumed.records.length, first.records.length);
});

test("revisões rejeitam concorrência e tombstones impedem uma versão offline antiga", () => {
    assert.equal(revisionMatches({ revision: "r1" }, "r1"), true);
    assert.equal(revisionMatches({ revision: "tombstone-r2", deleted: true }, "r1"), false);
    assert.equal(revisionMatches(null, null), true);
});

test("recorrências de entradas e despesas mantêm os identificadores da série na combinação", () => {
    const local = [income("income-1", { serie: "serie-receita" }), { month: "2026-10", type: "despesas", id: "expense-1", record: { id: "expense-1", nome: "Parcela", valor: 100, categoria: "Casa", serie: "serie-despesa", parcela: { atual: 1, total: 3 } } }];
    const merged = combinarRegistros(local, []);
    assert.equal(merged.records[0].record.serie, "serie-receita");
    assert.equal(merged.records[1].record.serie, "serie-despesa");
    assert.equal(merged.records[1].record.parcela.total, 3);
});

test("listener remoto pode atualizar uma cópia sem criar automaticamente uma operação de envio", () => {
    const remote = applyRemoteRecord(state(), income("remote").month ? { ...income("remote"), deleted: false } : {});
    const store = new Map(); const queue = createSyncQueue({ get: (key) => store.get(key), set: (key, value) => store.set(key, value) }, "user-a");
    assert.equal(registrosFinanceiros(remote).length, 1);
    assert.equal(queue.state().outbox.length, 0);
});

test("fila offline mantém operação após falha e reenvia até receber confirmação", () => {
    const store = new Map(); const storage = { get: (key) => store.get(key), set: (key, value) => store.set(key, structuredClone(value)) };
    const op = makeOperation("r1", { deleted: true }, "revision-1"); createSyncQueue(storage, "user-a").enqueue(op);
    return assert.rejects(flushSyncQueue("user-a", storage, async () => { throw new Error("offline"); }), /offline/)
        .then(() => {
            assert.equal(createSyncQueue(storage, "user-a").state().outbox.length, 1);
            return flushSyncQueue("user-a", storage, async (_uid, operation) => ({ acknowledged: operation.id === op.id }), () => "confirmed");
        }).then((result) => assert.equal(result.outbox.length, 0));
});

test("edição concorrente é reconhecida como conflito e não é marcada como resolução silenciosa", async () => {
    const store = new Map(), storage = { get: (key) => store.get(key), set: (key, value) => store.set(key, structuredClone(value)) };
    const op = makeOperation("record", { record: { valor: 20 } }, "revision-a"); createSyncQueue(storage, "user-a").enqueue(op);
    const result = await flushSyncQueue("user-a", storage, async () => ({ acknowledged: true, conflict: true, remote: { revision: "revision-b", record: { valor: 10 } } }), () => "confirmed");
    assert.equal(result.outbox.length, 0);
    assert.equal(result.conflicts[0].remote.revision, "revision-b");
});

test("reverter B para A antes de reconectar remove a operação obsoleta da fila", async () => {
    const entityKey = "2026-10/receitas/r1";
    const remoteA = income("r1", { nome: "Salário", valor: 1000 });
    const pendingB = makeOperation(entityKey, {
        month: "2026-10", type: "receitas", id: "r1",
        record: { ...remoteA.record, valor: 1200 }, deleted: false
    }, "revision-a");
    const data = new Map();
    const storage = {
        get: (key) => data.get(key),
        set: (key, value) => data.set(key, structuredClone(value))
    };
    const queue = createSyncQueue(storage, "user-a");
    queue.enqueue(pendingB);

    // O snapshot remoto e o estado local voltaram a ser exatamente A.
    const localA = { valor: 1000, nome: "Salário", id: "r1" };
    const settled = recordsEquivalent(remoteA.record, localA) ? [entityKey] : [];
    const reconciled = coalesceOutbox(queue.state().outbox, [], settled);
    data.set("controleFinanceiro:sync:user-a", { ...queue.state(), outbox: reconciled });
    const sent = [];
    const result = await flushSyncQueue("user-a", storage, async (_uid, operation) => {
        sent.push(operation);
        return { acknowledged: true };
    }, () => "confirmed");

    assert.deepEqual(sent, []);
    assert.deepEqual(result.outbox, []);
});

test("equivalência de registros ignora ordem das chaves, mas compara todos os campos", () => {
    const remote = { id: "r1", nome: "Salário", valor: 1000, serie: "serie-a" };
    const sameData = { serie: "serie-a", valor: 1000, nome: "Salário", id: "r1" };
    const changedMetadata = { ...sameData, serie: "serie-b" };

    assert.equal(recordsEquivalent(remote, sameData), true);
    assert.equal(recordsEquivalent(remote, changedMetadata), false);
});

test("nova edição coalesce a pendência da mesma entidade sem trocar a revisão-base", () => {
    const first = makeOperation("record", { record: { valor: 10 } }, "revision-a");
    const second = makeOperation("record", { record: { valor: 20 } }, "revision-b");
    const result = coalesceOutbox([first], [second]);
    assert.equal(result.length, 1);
    assert.equal(result[0].value.record.valor, 20);
    assert.equal(result[0].baseRevision, "revision-a");
});

test("exclusão local substitui atualização pendente por tombstone mantendo a revisão-base", () => {
    const update = makeOperation("record", {
        month: "2026-10", type: "receitas", id: "r1",
        record: { id: "r1", nome: "Salário", valor: 1200 }, deleted: false
    }, "revision-a");
    const deletion = makeOperation("record", {
        month: "2026-10", type: "receitas", id: "r1", deleted: true
    }, "revision-b");
    const result = coalesceOutbox([update], [deletion]);

    assert.equal(result.length, 1);
    assert.deepEqual(result[0].value, deletion.value);
    assert.equal(result[0].value.deleted, true);
    assert.equal(result[0].baseRevision, "revision-a");
});

test("restaurar backup combina registros sem transformar ausências em exclusões da nuvem", () => {
    const restoredBackup = [income("backup")], remote = [income("cloud")];
    const merged = combinarRegistros(restoredBackup, remote);
    assert.deepEqual(new Set(merged.records.map((entry) => entry.id)), new Set(["backup", "cloud"]));
    assert.equal(merged.records.some((entry) => entry.deleted), false);
});

test("resposta atrasada da conta A não altera a sessão B nem uma sessão encerrada", async () => {
    const guard = createSyncSessionGuard(), applied = [];
    const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
    const a = guard.begin(), responseA = deferred();
    const finishA = responseA.promise.then((value) => { if (guard.isCurrent(a)) applied.push(value); });
    guard.begin(); responseA.resolve("dados-A"); await finishA;
    assert.deepEqual(applied, []);
    const b = guard.begin(), responseB = deferred();
    const finishB = responseB.promise.then((value) => { if (guard.isCurrent(b)) applied.push(value); });
    guard.invalidate(); responseB.resolve("dados-B"); await finishB;
    assert.deepEqual(applied, []);
});

test("configuração remota é rejeitada inteira se qualquer categoria ou orçamento for inválido", () => {
    const valid = { version: 3, categories: ["Casa"], theme: "claro", budgets: { padrao: { Casa: 10 }, meses: {} }, revision: "rev-1", updatedAt: { seconds: 10, nanoseconds: 0 } };
    assert.equal(validateRemoteSettings(valid), true);
    assert.equal(validateRemoteSettings({ ...valid, categories: ["Casa", 12] }), false);
    assert.equal(validateRemoteSettings({ ...valid, budgets: { ...valid.budgets, padrao: { Casa: "10" } } }), false);
    assert.equal(validateRemoteSettings({ ...valid, budgets: { ...valid.budgets, meses: { "2026-10": { Casa: 20 } } } }), false);
    assert.equal(validateRemoteSettings({ ...valid, injected: { unsafe: true } }), false);
    const many = Array.from({ length: 14 }, (_, index) => `Categoria ${index}`);
    const manySettings = { ...valid, categories: many, budgets: { padrao: Object.fromEntries(many.map((category, index) => [category, index * 10])), meses: {} } };
    assert.equal(validateRemoteSettings(manySettings), true);
    assert.equal(validateRemoteSettings({ ...manySettings, categories: [...many, 3] }), false);
    assert.equal(validateRemoteSettings({ ...manySettings, categories: [...many, "Categoria 0"] }), false);
    assert.equal(validateRemoteSettings({ ...manySettings, budgets: { padrao: { ...manySettings.budgets.padrao, "Categoria desconhecida": 1 }, meses: {} } }), false);
    const local = { categorias: ["Local"], tema: "rosa", orcamentos: { padrao: { Local: 50 }, meses: {} } };
    const rejected = mergeRemoteSettings(local, { ...valid, categories: ["Casa", 12] });
    assert.equal(rejected.valid, false);
    assert.deepEqual(rejected.state, local);
    assert.equal(mergeRemoteSettings(local, valid).valid, true);
});

test("tombstone exige envelope estrito e não aceita record nem campos extras", () => {
    const tombstone = { month: "2026-10", type: "receitas", id: "r1", deleted: true, revision: "rev-2", updatedAt: { seconds: 10, nanoseconds: 0 }, _docId: "key", hasPendingWrites: false };
    assert.equal(validRemoteTombstone(tombstone), true);
    assert.equal(validRemoteTombstone({ ...tombstone, record: income("r1").record }), false);
    assert.equal(validRemoteTombstone({ ...tombstone, extra: true }), false);
    assert.equal(validRemoteTombstone({ ...tombstone, updatedAt: null }), false);
});

test("segundo dispositivo recupera conflitos remotos uma vez e respeita resolução remota", () => {
    const conflict = { operationId: "op-1", entityKey: "entity-1", local: { month: "2026-10", type: "receitas", id: "r1", record: { id: "r1", nome: "A", valor: 10 }, deleted: false }, remote: null, createdAt: { seconds: 10, nanoseconds: 0 }, _docId: "op-1" };
    assert.equal(validateRemoteConflicts([conflict]).length, 1);
    assert.equal(validateRemoteConflicts([{ ...conflict, createdAt: "invalid" }]), null);
    const first = reconcileRemoteConflicts([], [conflict]);
    assert.equal(first.length, 1);
    assert.equal(first[0].operationId, "op-1");
    assert.equal(reconcileRemoteConflicts(first, [conflict]).length, 1);
    assert.equal(reconcileRemoteConflicts([{ kind: "concurrent-change", operation: { id: "op-1", value: conflict.local }, remote: null }], [conflict])[0].source, "firestore");
    assert.deepEqual(reconcileRemoteConflicts(first, [{ ...conflict, resolved: true, resolution: "local", resolvedAt: { seconds: 11, nanoseconds: 0 } }]), []);
    assert.deepEqual(reconcileRemoteConflicts([], [{ ...conflict, operationId: null }]), []);
});
