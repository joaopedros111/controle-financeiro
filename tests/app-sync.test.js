import { settingsLocks } from './helpers/settings-locks.js';
import { ServicoFinanceiroAtomico } from "../financial-atomic-service.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as sync from "../sync-core.js";
import { normalizarEstado, normalizarValorMonetario, validarBackup, mesFinanceiroValido, LIMITE_MONETARIO_SEGURO } from "../finance-core.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const timestamp = { seconds: 10, nanoseconds: 0 };
const metadata = { fromCache: false, hasPendingWrites: false };
const entry = (id = "r1", valor = 10) => {
    const item = { month: "2026-10", type: "receitas", id, deleted: false,
        record: { id, nome: "Receita", valor }, revision: "rev-a", updatedAt: timestamp };
    return { ...item, _docId: sync.recordEntityKey(item) };
};
const financialState = (...items) => normalizarEstado({ versao: 3, tema: "claro", categorias: [],
    meses: { "2026-10": { receitas: items.map((item) => item.record), despesas: [] } } });

// Execute the application functions themselves. Only browser/SDK boundaries are stubbed.
function harness(items = [entry()], initial = financialState(entry())) {
    const values = new Map(), statuses = [], commits = [];
    const context = vm.createContext({ ...sync, structuredClone, TextEncoder, console,
        validarBackup, normalizarEstado, normalizarValorMonetario, mesFinanceiroValido,
        CHAVE_ESTADO: "controleFinanceiro:v3", IDB_HOMOLOGACAO: false, idbBase: structuredClone(initial),
        setGoogleAuthUser() {}, updateGoogleLoginButton() {}, window: { addEventListener() {} }, idbPendente: Promise.resolve(), idbBloqueado: false,
        estado: structuredClone(initial), syncUser: { uid: "alice" }, syncRemoteRecords: items,
        syncRemoteRecordsLoaded: true, syncRemoteSettings: null, settingsConflictActive: false,
        applyingRemoteSync: false, chaveEstadoAtual: "account-alice", navigator: { onLine: true },
        syncUi: { enabled: { checked: true }, last: { textContent: "old" } },
        syncSessions: { current: () => 1 }, isCurrentSyncSession: () => true,
        readSyncMeta: () => JSON.parse(values.get("controleFinanceiro:sync:alice") || '{"outbox":[],"conflicts":[],"lastConfirmed":"old"}'),
        writeSyncMeta: (_uid, value) => { values.set("controleFinanceiro:sync:alice", JSON.stringify(value)); return value; },
        localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
        storage: { escreverJson: (key, value) => { values.set(key, JSON.stringify(value)); return true; } },
        renderTudo: () => {}, renderSyncConflicts: () => {},
        setSyncStatus: (message) => statuses.push(message), formatLastSync: (date) => date,
        firebaseClient: { list: async () => structuredClone(items), getSettings: async () => ({
            ...context.financialSettings(initial), revision: "settings-a", updatedAt: timestamp }),
        commit: async (_uid, op) => { commits.push(op); return { acknowledged: true }; },
        saveSettings: async () => ({ acknowledged: true, revision: "settings-b" }) }
    });
    context.estadoParaSalvar = () => structuredClone(context.estado);
    context.persistirEstadoFinanceiro = async (key, value) => { if (!context.storage.escreverJson(key, value)) return false; const result = await context.idbServico.aplicarEdicao("alice", context.idbBase, value); context.idbBase = structuredClone(result.estado.dados); return true; };
    let serial = Promise.resolve();
    const docs = new Map([["estado:alice",{revisao:0,dados:structuredClone(initial)}],["estado:@local",{revisao:0,dados:financialState()}]]);
    const db = {
        ler: async key => key.startsWith("fila:") ? context.readSyncMeta() : structuredClone(docs.get(key) ?? null),
        alterarDocumentos(keys, transform) {
            const run = serial.then(() => {
                const input = new Map(keys.map(key => [key,key.startsWith("fila:") ? context.readSyncMeta() : structuredClone(docs.get(key) ?? null)]));
                const next = transform(input);
                for (const key of keys) if (key.startsWith("fila:")) context.writeSyncMeta("alice",next.get(key));
                for (const key of keys) if (!key.startsWith("fila:")) docs.set(key,structuredClone(next.get(key)));
                return next;
            }); serial = run.catch(()=>{}); return run;
        },
        alterar(key, transform) {return this.alterarDocumentos([key],m=>{m.set(key,transform(m.get(key)));return m;}).then(m=>m.get(key));}
    };
    context.idbBanco = db;
    context.idbServico = new ServicoFinanceiroAtomico(db, validarBackup, q => Array.isArray(q?.outbox) && Array.isArray(q?.conflicts),settingsLocks());
    const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
    vm.runInContext(part("function syncEntityKey(", "let firebaseInitPromise ="), context);
    vm.runInContext(part("let syncPublishChain =", 'window.addEventListener("finance-local-change"'), context);
    vm.runInContext(part("async function resolveSyncConflict(", 'syncUi.conflicts.addEventListener'), context);
    return { context, values, statuses, commits, meta: () => context.readSyncMeta(),
        pending(value = entry("r1", 20)) { const op = sync.makeOperation(sync.recordEntityKey(value), {
            month: value.month, type: value.type, id: value.id, record: value.record, deleted: false
        }, "rev-a"); context.writeSyncMeta("alice", { outbox: [op], conflicts: [], lastConfirmed: "old" }); return op; } };
}

test("cache e snapshots com pendências não alteram dados, fila nem confirmação visual", { timeout: 5000 }, async () => {
    for (const flags of [{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }, undefined]) {
        const h = harness(); h.pending(); const before = JSON.stringify(h.context.estado);
        await h.context.onRemoteRecords([entry("r1", 999)], flags);
        assert.equal(JSON.stringify(h.context.estado), before);
        assert.equal(h.meta().outbox.length, 1);
        assert.equal(h.meta().lastConfirmed, "old");
        assert.equal(h.context.syncUi.last.textContent, "old");
        assert.equal(h.context.syncRemoteRecordsLoaded, false);
        assert.doesNotMatch(h.statuses.at(-1), /^Sincronizado$/);
    }
});

test("A → B → A só reconcilia após servidor; falha preserva fila e reconexão não envia B", { timeout: 5000 }, async () => {
    const h = harness(); const op = h.pending();
    await h.context.onRemoteRecords([], { fromCache: true, hasPendingWrites: false });
    assert.equal(h.meta().outbox[0].id, op.id);
    h.context.firebaseClient.list = async () => { throw new Error("unavailable"); };
    await assert.rejects(h.context.publishFirebaseState(h.context.estado), /unavailable/);
    assert.equal(h.meta().outbox.length, 1);
    assert.equal(h.meta().outbox[0].value.record.valor, 10);
    assert.equal(h.meta().lastConfirmed, "old");
    h.context.firebaseClient.list = async () => [entry()];
    await h.context.onRemoteRecords([entry()], metadata);
    await h.context.publishFirebaseState(h.context.estado);
    await h.context.publishFirebaseState(h.context.estado);
    assert.equal(h.meta().outbox.length, 0);
    assert.equal(h.commits.length, 0);
    assert.notEqual(h.meta().lastConfirmed, "old");
    assert.equal(h.statuses.at(-1), "Sincronizado");
});

test("ACK de registros não confirma a sincronização quando configurações falham", { timeout: 5000 }, async () => {
    const h = harness([entry()], financialState(entry("r1", 20))); h.pending();
    h.context.firebaseClient.getSettings = async () => { throw new Error("settings unavailable"); };
    await assert.rejects(h.context.publishFirebaseState(h.context.estado), /settings unavailable/);
    assert.equal(h.commits.length, 1);
    assert.equal(h.meta().outbox.length, 0);
    assert.equal(h.meta().lastConfirmed, "old");
    assert.equal(h.context.syncUi.last.textContent, "old");
});

test("duplicatas lógicas são rejeitadas em qualquer ordem; chave legada continua legível sem envio", { timeout: 5000 }, async () => {
    const a = entry(), b = { ...entry("r1", 20), _docId: "legacy" };
    const h = harness(); const before = JSON.stringify(h.context.estado);
    for (const items of [[a, b], [b, a]]) {
        await h.context.onRemoteRecords(items, metadata);
        assert.equal(JSON.stringify(h.context.estado), before);
        h.context.firebaseClient.list = async () => items;
        await assert.rejects(h.context.publishFirebaseState(h.context.estado), /duplicados/);
    }
    await h.context.onRemoteRecords([b], metadata);
    assert.equal(h.context.estado.meses["2026-10"].receitas[0].valor, 20);
    h.pending(); h.context.firebaseClient.list = async () => [b];
    await assert.rejects(h.context.publishFirebaseState(h.context.estado), /Chaves remotas/);
    assert.equal(h.meta().outbox.length, 1);
    assert.equal(h.commits.length, 0);
});

test("resolução malformada ou que exceda agregado preserva estado e conflito", { timeout: 5000 }, async () => {
    for (const bad of [entry("r1", -1), { ...entry(), month: "1999-12" },
        { ...entry(), record: { ...entry().record, nome: "\u00a0" } },
        entry("r1", LIMITE_MONETARIO_SEGURO)]) {
        const h = harness([], financialState(entry("other", 1)));
        const local = { ...entry(), updatedAt: undefined, revision: undefined };
        h.context.writeSyncMeta("alice", { outbox: [], conflicts: [{ operation: { value: local }, remote: bad }], lastConfirmed: "old" });
        const before = JSON.stringify(h.context.estado), beforeMeta = JSON.stringify(h.meta());
        await h.context.resolveSyncConflict(0, "remote");
        assert.equal(JSON.stringify(h.context.estado), before);
        assert.equal(JSON.stringify(h.meta()), beforeMeta);
        assert.equal(h.values.has("account-alice"), false);
    }
});

test("falha na persistência da resolução mantém estado e conflito", { timeout: 5000 }, async () => {
    const h = harness();
    h.context.writeSyncMeta("alice", { outbox: [], conflicts: [{ operation: { value: entry() }, remote: entry("r1", 20) }] });
    h.context.storage.escreverJson = () => false;
    const before = JSON.stringify(h.context.estado);
    await h.context.resolveSyncConflict(0, "remote");
    assert.equal(JSON.stringify(h.context.estado), before);
    assert.equal(h.meta().conflicts.length, 1);
});

test("registro novo surgido no servidor entre leituras não vira tombstone", { timeout: 5000 }, async () => {
    const h = harness(); h.context.firebaseClient.list = async () => [entry(), entry("new")];
    await h.context.publishFirebaseState(h.context.estado);
    assert.equal(h.commits.length, 0);
    assert.equal(h.meta().lastConfirmed, "old");
});

test("edição offline é persistida na fila antes de qualquer leitura ou envio", { timeout: 5000 }, async () => {
    const h = harness([entry()], financialState(entry("r1", 20)));
    h.context.navigator.onLine = false;
    h.context.firebaseClient.list = async () => { throw new Error("must not read"); };
    await h.context.publishFirebaseState(h.context.estado);
    assert.equal(h.meta().outbox[0].value.record.valor, 20);
    assert.equal(h.meta().lastConfirmed, "old");
    await h.context.onRemoteRecords([entry()], metadata);
    assert.equal(h.context.estado.meses["2026-10"].receitas[0].valor, 20);
    assert.equal(h.meta().conflicts.length, 0);
    assert.equal(h.commits.length, 0);
});

test("falha ao persistir fila impede rede; IDs legados longos não são reescritos", { timeout: 5000 }, async () => {
    const h = harness([entry()], financialState(entry("r1", 20)));
    h.context.writeSyncMeta = () => { throw new Error("quota"); };
    let reads = 0; h.context.firebaseClient.list = async () => { reads += 1; return [entry()]; };
    await assert.rejects(h.context.publishFirebaseState(h.context.estado), /quota/);
    assert.equal(reads, 0); assert.equal(h.commits.length, 0);
    const long = "🪙".repeat(65), legacy = harness([], financialState(entry(long)));
    await assert.rejects(legacy.context.publishFirebaseState(legacy.context.estado), /IDs locais/);
    assert.equal(legacy.context.estado.meses["2026-10"].receitas[0].id, long);
    assert.equal(legacy.commits.length, 0);
});

test("resolução válida persiste antes de remover conflito; tombstone remoto remove registro", { timeout: 5000 }, async () => {
    for (const remote of [entry("r1", 20), { ...entry(), deleted: true, record: undefined }]) {
        if (remote.deleted) delete remote.record;
        const h = harness();
        h.context.writeSyncMeta("alice", { outbox: [], conflicts: [{ operation: { value: entry() }, remote }] });
        await h.context.resolveSyncConflict(0, "remote");
        assert.equal(h.meta().conflicts.length, 0);
        const records = JSON.parse(h.values.get("account-alice")).meses["2026-10"].receitas;
        assert.equal(records.length, remote.deleted ? 0 : 1);
        if (!remote.deleted) assert.equal(records[0].valor, 20);
    }
});

test("contrato de conflitos reutiliza meses e arredondamento sem invalidar IDs legados", { timeout: 5000 }, async () => {
    for (const amount of [0, 0.01, 0.29, 0.001, LIMITE_MONETARIO_SEGURO]) {
        assert.equal(sync.validConflictRecord(entry("🪙".repeat(100), amount)), true);
    }
    for (const amount of [-0.01, NaN, Infinity, LIMITE_MONETARIO_SEGURO + 1, "1"]) assert.equal(sync.validConflictRecord(entry("r1", amount)), false);
    for (const month of ["1999-12", "2101-01", "2026-00", "2026-13", "2026-1"]) assert.equal(sync.validConflictRecord({ ...entry(), month }), false);
    for (const month of ["2000-01", "2100-12"]) assert.equal(sync.validConflictRecord({ ...entry(), month }), true);
    for (const nome of ["", " ", "\u00a0", "\u2003", "\ufeff"]) assert.equal(sync.validConflictRecord({ ...entry(), record: { ...entry().record, nome } }), false);
    assert.equal(sync.validConflictRecord({ ...entry(), id: " " }), false);
    assert.equal(sync.validConflictRecord({ ...entry(), record: { ...entry().record, id: "other" } }), false);
    assert.equal(sync.validateRemoteConflicts([{ operationId: "op", entityKey: "key", createdAt: timestamp,
        local: entry(), remote: { ...entry(), month: "1999-12" } }]), null);
});

test("fila mantém operação sem ACK e permite repetir após falha ao salvar remoção", { timeout: 5000 }, async () => {
    const data = new Map(); let rejectWrite = false;
    const storage = { get: (key) => data.get(key), set: (key, value) => {
        if (rejectWrite) return false;
        data.set(key, structuredClone(value)); return true;
    } };
    const queue = sync.createSyncQueue(storage, "alice"), op = sync.makeOperation("key", { deleted: true });
    queue.enqueue(op);
    await assert.rejects(sync.flushSyncQueue("alice", storage, async () => ({})), /confirmação/);
    assert.equal(queue.state().outbox.length, 1);
    const applied = new Set(); let created = 0;
    const commit = async (_uid, operation) => {
        if (!applied.has(operation.id)) { applied.add(operation.id); created += 1; }
        return { acknowledged: true };
    };
    rejectWrite = true;
    await assert.rejects(sync.flushSyncQueue("alice", storage, commit), /persistir/);
    assert.equal(queue.state().outbox.length, 1);
    rejectWrite = false; await sync.flushSyncQueue("alice", storage, commit);
    assert.equal(created, 1); assert.equal(queue.state().outbox.length, 0);
});

test("edição durante leitura em andamento é enfileirada imediatamente e não é sobrescrita", { timeout: 5000 }, async () => {
    const h = harness([entry()], financialState(entry("r1", 20)));
    let release, entered;
    const started = new Promise((resolve) => { entered = resolve; });
    h.context.firebaseClient.list = async () => { entered(); await new Promise((resolve) => { release = resolve; }); return [entry()]; };
    const first = h.context.publishFirebaseState(h.context.estado);
    await started;
    h.context.estado = financialState(entry("r1", 30));
    const second = h.context.publishFirebaseState(h.context.estado);
    await h.context.idbPendente;
    assert.equal(h.meta().outbox[0].value.record.valor, 30);
    await h.context.onRemoteRecords([entry()], metadata);
    assert.equal(h.context.estado.meses["2026-10"].receitas[0].valor, 30);
    h.context.firebaseClient.list = async () => [entry()];
    release(); await Promise.all([first, second]);
    assert.equal(h.commits.length, 1);
    assert.equal(h.commits[0].value.record.valor, 30);
});

test("inicialização real permite ler chave legada sem iniciar migração ou envio", { timeout: 5000 }, async () => {
    const legacy = { ...entry("r1", 20), _docId: "legacy" }, h = harness([legacy], financialState());
    Object.assign(h.context, { syncStopListener: null, syncSettingsStop: null, syncConflictsStop: null,
        lerEstadoPersistido: () => ({ estado: "valido", valor: financialState() }),
        recuperacaoFinanceira: { protegido: false },
        setFinancialStateKey: (_key, state) => { h.context.estado = state; return true; } });
    for (const name of ["account", "login", "logout", "enabledLine", "restore"]) h.context.syncUi[name] = {};
    h.context.syncSessions.begin = () => 1;
    const start = source.indexOf("async function onFirebaseUser("), end = source.indexOf("let syncPublishChain =");
    vm.runInContext(source.slice(start, end), h.context);
    await h.context.onFirebaseUser({ uid: "alice" });
    assert.equal(h.context.estado.meses["2026-10"].receitas[0].valor, 20);
    assert.equal(h.meta().initialized, undefined);
    assert.equal(h.commits.length, 0);
    assert.match(h.statuses.at(-1), /chaves legadas/);
});

test("leitura de configurações atrasada da conta A não modifica variáveis da conta B", { timeout: 5000 }, async () => {
    const h = harness(); let release, started;
    const waiting = new Promise((resolve) => { started = resolve; });
    h.context.firebaseClient.getSettings = async () => { started(); return new Promise((resolve) => { release = resolve; }); };
    h.context.isCurrentSyncSession = (_session, uid) => h.context.syncUser.uid === uid;
    const pending = h.context.publishFirebaseState(h.context.estado);
    await waiting;
    const bobSettings = { revision: "bob-only" };
    h.context.syncUser = { uid: "bob" }; h.context.syncRemoteSettings = bobSettings;
    release({ ...h.context.financialSettings(), revision: "alice-old", updatedAt: timestamp });
    await pending;
    assert.equal(h.context.syncRemoteSettings, bobSettings);
});

test("logout durante ACK impede o envio das operações seguintes", { timeout: 5000 }, async () => {
    const h = harness([], financialState(entry("one"), entry("two")));
    let release, started; const waiting = new Promise((resolve) => { started = resolve; });
    h.context.firebaseClient.commit = async (_uid, operation) => {
        h.commits.push(operation); started();
        if (h.commits.length === 1) await new Promise((resolve) => { release = resolve; });
        return { acknowledged: true };
    };
    h.context.isCurrentSyncSession = (_session, uid) => h.context.syncUser?.uid === uid;
    const pending = h.context.publishFirebaseState(h.context.estado); await waiting;
    h.context.syncUser = null; release(); await pending;
    assert.equal(h.commits.length, 1);
    assert.equal(h.meta().outbox.length, 1);
});

test("metadados de fila corrompidos não são tratados como fila vazia", { timeout: 5000 }, async () => {
    const h = harness(); const raw = '{"outbox":';
    h.context.idbBanco.ler = async () => ({ outbox: raw, conflicts: [] });
    vm.runInContext(source.slice(source.indexOf("const syncMetaKey ="), source.indexOf("function setSyncStatus(")), h.context);
    await assert.rejects(vm.runInContext('readSyncMeta("alice")', h.context));
});

test("combinação de mesmo ID preserva identidade externa e interna da cópia", { timeout: 5000 }, async () => {
    const combined = sync.combinarRegistros([entry("r1", 20)], [entry("r1", 10)]);
    for (const item of combined.records) assert.equal(item.id, item.record.id);
    assert.equal(validarBackup(financialState(...combined.records)), true);
});

function initializedFlow(h, saved = h.context.estado) {
    Object.assign(h.context, { syncStopListener: null, syncSettingsStop: null, syncConflictsStop: null,
        lerEstadoPersistido: () => ({ estado: "valido", valor: structuredClone(saved) }),
        recuperacaoFinanceira: { protegido: false },
        setFinancialStateKey: (_key, state) => { h.context.estado = structuredClone(state); return true; } });
    for (const name of ["account", "login", "logout", "enabledLine", "restore"]) h.context.syncUi[name] = {};
    h.context.syncSessions.begin = () => 1;
    h.context.firebaseClient.listConflicts = async () => [];
    for (const name of ["listen", "listenSettings", "listenConflicts"]) h.context.firebaseClient[name] = () => () => {};
    h.context.writeSyncMeta("alice", { initialized: true, outbox: [], conflicts: [], lastConfirmed: "old" });
    vm.runInContext(source.slice(source.indexOf("async function onFirebaseUser("), source.indexOf("let syncPublishChain =")), h.context);
}

test("recarga importa registro remoto desconhecido sem produzir exclusão", { timeout: 5000 }, async () => {
    const h = harness([entry()], financialState()); initializedFlow(h);
    await h.context.onFirebaseUser({ uid: "alice" });
    assert.equal(h.commits.some((operation) => operation.value.deleted), false);
    assert.equal(h.context.estado.meses["2026-10"].receitas[0].id, "r1");
});

test("recarga divergente sem fila preserva as versões para revisão", { timeout: 5000 }, async () => {
    const h = harness([entry()], financialState(entry("r1", 20))); initializedFlow(h);
    await h.context.onFirebaseUser({ uid: "alice" });
    assert.equal(h.commits.length, 0);
    assert.equal(h.context.estado.meses["2026-10"].receitas[0].valor, 20);
    assert.ok(h.meta().conflicts.length);
});

test("nova revisão de configurações equivalentes não cria conflito artificial", { timeout: 5000 }, async () => {
    const h = harness(), settings = h.context.financialSettings();
    h.context.syncRemoteSettings = { ...settings, revision: "previous", updatedAt: timestamp };
    await h.context.onRemoteSettings({ ...settings, revision: "new", updatedAt: timestamp }, metadata);
    assert.equal(h.meta().conflicts.length, 0);
});

// Use the production metadata merge as well as the production application
// handlers. The adapter is in-memory; no user storage or Firebase is accessed.
function settingsHarness() {
    const initial = financialState(entry()); initial.categorias = ["Casa", "Moto", "Serasa"];
    const h = harness([entry()], initial);
    vm.runInContext(source.slice(source.indexOf("const syncMetaKey ="), source.indexOf("function setSyncStatus(")), h.context);
    return h;
}
const settingsSnapshot = (value, revision) => ({ ...value, revision: String(revision),
    updatedAt: { seconds: 100, nanoseconds: Number(revision) || 0 } });
function eightSettingsConflicts(local) {
    return Array.from({ length: 8 }, (_, i) => ({ kind: "settings", local: structuredClone(local),
        remote: settingsSnapshot(i < 2 ? { ...local, categories: ["Casa"] } : local, i) }));
}

test("settings: eight preexisting conflicts, categories and pending operations survive equivalent and repeated snapshots", async () => {
    const h = settingsHarness(); h.pending();
    const local = h.context.financialSettings(), conflicts = eightSettingsConflicts(local);
    h.context.writeSyncMeta("alice", { ...h.meta(), conflicts });
    const before = JSON.stringify(h.meta()), stateBefore = JSON.stringify(h.context.estado);
    for (let i = 10; i < 18; i++) await h.context.onRemoteSettings(settingsSnapshot({ ...local, categories: [...local.categories].reverse() }, i), metadata);
    // A real but already recorded pair is also reused, without replacing metadata.
    await h.context.onRemoteSettings(settingsSnapshot({ ...local, categories: ["Casa"] }, 18), metadata);
    assert.equal(JSON.stringify(h.meta()), before);
    assert.equal(JSON.stringify(h.context.estado), stateBefore);
    assert.equal(h.context.settingsConflictActive, true);
    assert.equal(h.context.syncRemoteSettings.revision, "18");
    assert.ok(h.context.estado.categorias.includes("Moto")); assert.ok(h.context.estado.categorias.includes("Serasa"));
});

test("settings: two genuine observations and six converged snapshots create only one conflict", async () => {
    const h = settingsHarness(), local = h.context.financialSettings();
    h.context.syncRemoteSettings = settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 0);
    for (let i = 1; i <= 2; i++) await h.context.onRemoteSettings(settingsSnapshot({ ...local, categories: ["Casa"] }, i), metadata);
    const original = JSON.stringify(h.meta().conflicts);
    for (let i = 3; i <= 8; i++) await h.context.onRemoteSettings(settingsSnapshot(local, i), metadata);
    assert.equal(h.meta().conflicts.length, 1);
    assert.equal(JSON.stringify(h.meta().conflicts), original);
    assert.equal(h.context.syncRemoteSettings.revision, "8");
    assert.equal(h.context.settingsConflictActive, true);
});

test("settings: concurrent callbacks deduplicate and preserve a concurrent financial inclusion", async () => {
    const h = settingsHarness(), local = h.context.financialSettings();
    h.context.syncRemoteSettings = settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 0);
    const op = sync.makeOperation(sync.recordEntityKey(entry("new")), { month: "2026-10", type: "receitas", id: "new", record: entry("new").record, deleted: false }, null);
    await Promise.all([h.context.onRemoteSettings(settingsSnapshot({ ...local, categories: ["Casa"] }, 1), metadata),
        h.context.onRemoteSettings(settingsSnapshot({ ...local, categories: ["Casa"] }, 2), metadata),
        h.context.idbServico.enfileirar("alice", op)]);
    assert.equal(h.meta().conflicts.length, 1);
    assert.equal(h.meta().outbox[0].id, op.id);
});

test("settings: asynchronous snapshots retain callback order and do not advance a baseline over a concurrent conflict", async () => {
    const h = settingsHarness(), local = h.context.financialSettings();
    h.context.syncRemoteSettings = settingsSnapshot(local, 0);
    const read = h.context.idbServico.lerFila.bind(h.context.idbServico);
    let release, entered, reads = 0;
    const waiting = new Promise(resolve => { entered = resolve; });
    h.context.idbServico.lerFila = async uid => {
        const meta = await read(uid);
        if (++reads === 1) { entered(); await new Promise(resolve => { release = resolve; }); }
        return meta;
    };
    const first = h.context.onRemoteSettings(settingsSnapshot(local, 1), metadata);
    await waiting;
    const second = h.context.onRemoteSettings(settingsSnapshot(local, 2), metadata);
    const conflict = { kind: "settings", local, remote: settingsSnapshot({ ...local, categories: ["Casa"] }, 9) };
    await h.context.idbServico.registrarConflitoSettings("alice", conflict);
    release(); await Promise.all([first, second]);
    assert.equal(h.context.syncRemoteSettings.revision, "2");
    assert.equal(h.context.settingsConflictActive, true);
    assert.equal(h.meta().settingsBaseline, undefined);
    assert.equal(JSON.stringify(h.meta().conflicts), JSON.stringify([conflict]));
});

test("settings: convergence against an old baseline creates no conflict and keeps the confirmed revision", async () => {
    const h = settingsHarness(), local = h.context.financialSettings();
    h.context.syncRemoteSettings = settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 0);
    await h.context.onRemoteSettings(settingsSnapshot(local, 1), metadata);
    assert.equal(h.meta().conflicts.length, 0);
    assert.equal(h.context.syncRemoteSettings.revision, "1");
    assert.equal(sync.settingsEquivalent(h.meta().settingsBaseline, local), true);
});

test("settings: persisted conflicts block automatic publication even if the in-memory flag is false", async () => {
    const h = settingsHarness(), local = h.context.financialSettings(), conflicts = eightSettingsConflicts(local);
    h.context.writeSyncMeta("alice", { ...h.meta(), conflicts });
    h.context.firebaseClient.getSettings = async () => settingsSnapshot({ ...local, categories: ["Casa"] }, 10);
    let writes = 0; h.context.firebaseClient.saveSettings = async () => { writes++; throw new Error("must not send"); };
    await h.context.publishFirebaseState(h.context.estado);
    assert.equal(writes, 0);
    assert.equal(JSON.stringify(h.meta().conflicts), JSON.stringify(conflicts));
    assert.equal(h.context.settingsConflictActive, true);
});

test("settings: a conflict from another tab during a remote read blocks settings publication", async () => {
    const h = settingsHarness(), local = h.context.financialSettings();
    h.context.firebaseClient.getSettings = async () => {
        await h.context.idbServico.registrarConflitoSettings("alice", { kind: "settings", local, remote: settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 1) });
        return settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 2);
    };
    let writes = 0; h.context.firebaseClient.saveSettings = async () => { writes++; };
    await h.context.publishFirebaseState(h.context.estado);
    assert.equal(writes, 0); assert.equal(h.meta().conflicts.length, 1);
    assert.equal(h.context.settingsConflictActive, true);
});

test("settings: revision rejection with the desired server result causes no conflict or retry", async () => {
    const h = settingsHarness(), local = h.context.financialSettings();
    h.context.syncRemoteSettings = settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 0);
    h.context.firebaseClient.getSettings = async () => settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 1);
    let writes = 0;
    h.context.firebaseClient.saveSettings = async () => { writes++; return { conflict: true, remote: settingsSnapshot(local, 2) }; };
    await h.context.publishFirebaseState(h.context.estado);
    assert.equal(writes, 1); assert.equal(h.meta().conflicts.length, 0);
    assert.equal(h.context.syncRemoteSettings.revision, "2");
    await h.context.onRemoteSettings(settingsSnapshot(local, 3), metadata);
    assert.equal(h.meta().conflicts.length, 0);
});

test("settings: a genuine CAS difference persists a conflict and blocks subsequent automatic settings writes", async () => {
    const h = settingsHarness(), local = h.context.financialSettings();
    h.context.firebaseClient.getSettings = async () => settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 1);
    let writes = 0; h.context.firebaseClient.saveSettings = async () => { writes++; return { conflict: true, remote: settingsSnapshot({ ...local, theme: "rosa",budgets:{padrao:{Moto:200},meses:{}} }, 2) }; };
    await h.context.publishFirebaseState(h.context.estado); await h.context.publishFirebaseState(h.context.estado);
    assert.equal(writes, 1); assert.equal(h.meta().conflicts.length, 1);
    assert.equal(h.context.settingsConflictActive, true);
});

test("settings: confirmed observations do not overwrite a local change or accept cache/pending snapshots", async () => {
    const h = settingsHarness(), local = h.context.financialSettings();
    const remote = settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 0);
    h.context.syncRemoteSettings = remote;
    await h.context.onRemoteSettings({ ...remote, revision: "1" }, metadata);
    assert.equal(h.context.estado.tema, "claro"); assert.equal(h.meta().conflicts.length, 0);
    for (const flags of [{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }])
        await h.context.onRemoteSettings(settingsSnapshot({ ...local, theme: "rosa",budgets:{padrao:{Moto:200},meses:{}} }, 2), flags);
    assert.equal(h.context.syncRemoteSettings.revision, "1");
});

test("settings: storage failure preserves conflicts and queue; an obsolete session cannot replace another account's reference", async () => {
    const h = settingsHarness(); h.pending(); const local = h.context.financialSettings();
    h.context.syncRemoteSettings = settingsSnapshot({ ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} }, 0);
    const before = JSON.stringify(h.meta()), stateBefore = JSON.stringify(h.context.estado);
    h.context.idbServico.registrarConflitoSettings = async () => { throw new Error("quota"); };
    await assert.rejects(h.context.onRemoteSettings(settingsSnapshot({ ...local, categories: ["Casa"] }, 1), metadata), /quota/);
    assert.equal(JSON.stringify(h.meta()), before); assert.equal(JSON.stringify(h.context.estado), stateBefore);
    const read = h.context.idbServico.lerFila.bind(h.context.idbServico);
    h.context.idbServico.lerFila = async uid => { const queue = await read(uid); h.context.syncUser = { uid: "bob" }; h.context.syncRemoteSettings = { revision: "bob" }; return queue; };
    h.context.isCurrentSyncSession = (_session, uid) => h.context.syncUser?.uid === uid;
    await h.context.onRemoteSettings(settingsSnapshot(local, 2), metadata);
    assert.equal(h.context.syncRemoteSettings.revision, "bob");
});

test("settings: first link uses functional equivalence and a legitimate conflict blocks automatic settings publication", async () => {
    for (const genuine of [false, true]) {
        const h = settingsHarness(); initializedFlow(h);
        h.context.writeSyncMeta("alice", { ...h.meta(), initialized: false });
        h.context.storage.lerJsonResultado = () => ({ estado: "ausente" });
        let prompts = 0, writes = 0; h.context.confirm = () => { prompts++; return true; };
        const local = h.context.financialSettings();
        h.context.firebaseClient.getSettings = async () => settingsSnapshot({ ...local, categories: genuine ? ["Casa"] : [...local.categories].reverse() }, 1);
        h.context.firebaseClient.saveSettings = async () => { writes++; return { acknowledged: true, revision: "saved" }; };
        await h.context.onFirebaseUser({ uid: "alice" });
        assert.equal(prompts, genuine ? 2 : 1); assert.equal(writes, 0);
        assert.equal(h.meta().conflicts.length, genuine ? 1 : 0);
        assert.ok(h.context.estado.categorias.includes("Moto")); assert.ok(h.context.estado.categorias.includes("Serasa"));
    }
});

test("settings: reconnect distinguishes convergence from genuine divergence against a saved baseline", async () => {
    for (const genuine of [false, true]) {
        const h = settingsHarness(); initializedFlow(h); const local = h.context.financialSettings();
        h.context.writeSyncMeta("alice", { ...h.meta(), settingsBaseline: { ...local, theme: "escuro",budgets:{padrao:{Moto:100},meses:{}} } });
        h.context.firebaseClient.getSettings = async () => settingsSnapshot({ ...local, categories: genuine ? ["Casa"] : [...local.categories].reverse() }, 1);
        await h.context.onFirebaseUser({ uid: "alice" });
        assert.equal(h.meta().conflicts.length, genuine ? 1 : 0);
    }
});

test("settings: backup review reuses an existing pair and leaves all eight original entries intact", async () => {
    const h = settingsHarness(), local = h.context.financialSettings(), conflicts = eightSettingsConflicts(local);
    h.context.writeSyncMeta("alice", { ...h.meta(), conflicts, restoredPending: true });
    h.context.syncRemoteSettings = settingsSnapshot({ ...local, categories: ["Casa"] }, 20);
    h.context.confirm = () => true;
    h.context.syncUi.restore = { addEventListener: (_event, callback) => { h.restore = callback; } };
    h.context.onFirebaseUser = async () => {};
    vm.runInContext(source.slice(source.indexOf('syncUi.restore.addEventListener('), source.indexOf('syncUi.enabled.addEventListener(')), h.context);
    await h.restore();
    assert.equal(JSON.stringify(h.meta().conflicts), JSON.stringify(conflicts));
    assert.equal(h.meta().restoredPending, false);
    assert.ok(h.context.estado.categorias.includes("Moto")); assert.ok(h.context.estado.categorias.includes("Serasa"));
});

test("ausência local não vira exclusão; exclusão explícita produz tombstone", { timeout: 5000 }, async () => {
    const unknown = harness([entry()], financialState());
    await unknown.context.publishFirebaseState(unknown.context.estado);
    assert.equal(unknown.commits.length, 0);
    const deletion = harness([entry()], financialState());
    await deletion.context.publishFirebaseState(deletion.context.estado, undefined, false, null, [entry()]);
    assert.equal(deletion.commits.length, 1);
    assert.equal(deletion.commits[0].value.deleted, true);
    assert.equal(deletion.meta().outbox.length, 0);
});

test("manter ambas preserva remoto no ID original e local em cópia com ID limitado", { timeout: 5000 }, async () => {
    const id = "i".repeat(128), local = entry(id, 20), remote = entry(id, 10);
    const h = harness([remote], financialState(local));
    h.context.writeSyncMeta("alice", { outbox: [], conflicts: [{ operation: { value: local }, remote }] });
    await h.context.resolveSyncConflict(0, "both");
    const records = h.context.estado.meses["2026-10"].receitas;
    assert.equal(records.find((record) => record.id === id).valor, 10);
    const copied = records.find((record) => record.id !== id);
    assert.equal(copied.valor, 20); assert.ok(copied.id.length <= 128);
    assert.equal(h.meta().conflicts.length, 0);
});

test("snapshot confirmado retoma confirmação visual; cache não dispara tentativa", { timeout: 5000 }, async () => {
    const h = harness(); let reads = 0;
    h.context.firebaseClient.list = async () => { reads += 1; return [entry()]; };
    await h.context.onRecordsSnapshot([entry()], { fromCache: true, hasPendingWrites: false }, 1, "alice");
    assert.equal(reads, 0); assert.equal(h.meta().lastConfirmed, "old");
    await h.context.onRecordsSnapshot([entry()], metadata, 1, "alice");
    assert.equal(reads, 1); assert.equal(h.statuses.at(-1), "Sincronizado");
});

test("Unicode malformado é bloqueado para envio, sem reescrever o ID local", { timeout: 5000 }, async () => {
    const id = "broken-\ud800", h = harness([], financialState(entry(id)));
    await assert.rejects(h.context.publishFirebaseState(h.context.estado), /IDs locais/);
    assert.equal(h.context.estado.meses["2026-10"].receitas[0].id, id);
    assert.equal(h.commits.length, 0);
});

test("detalhes de conflitos respeitam valores ocultos", { timeout: 5000 }, async () => {
    const h = harness(), list = { children: [], replaceChildren() { this.children = []; }, append(item) { this.children.push(item); } };
    h.context.document = { createElement: () => ({ children: [], append(...items) { this.children.push(...items); }, addEventListener() {} }) };
    h.context.syncUi.conflictList = list; h.context.syncUi.conflicts = {};
    h.context.valoresOcultos = true;
    h.context.writeSyncMeta("alice", { outbox: [], conflicts: [{ kind: "test", local: { valor: 12345.67 } }] });
    vm.runInContext(source.slice(source.indexOf("async function renderSyncConflicts("), source.indexOf("async function resolveSyncConflict(")), h.context);
    await h.context.renderSyncConflicts();
    assert.doesNotMatch(list.children[0].children[1].textContent, /12345\.67/);
    h.context.valoresOcultos = false; await h.context.renderSyncConflicts();
    assert.match(list.children[0].children[1].textContent, /12345\.67/);
});

test("troca de UID invalida desfazer, edição e diálogos financeiros da conta anterior", { timeout: 5000 }, async () => {
    const h = harness(); initializedFlow(h);
    Object.assign(h.context, { CHAVE_ESTADO: "controleFinanceiro:v3", ultimaRemocao: [{ item: entry().record }],
        receitaEmEdicao: "alice-record", receitaSerieEmCriacao: "alice-series", despesaEmEdicao: "alice-expense",
        despesaParaRemover: entry().record, receitaParaRemover: entry().record, temporizadorAviso: null, clearTimeout });
    let closed = 0;
    h.context.ui = { dialogoReceita: { close: () => { closed += 1; } }, receitaNome: { value: "Somente Alice" },
        aviso: { replaceChildren() {}, classList: { remove() {} } } };
    const start = source.indexOf("function resetFinancialInteractions(");
    if (start >= 0) vm.runInContext(source.slice(start, source.indexOf("async function setFinancialStateKey(")), h.context);
    await h.context.onFirebaseUser(null);
    assert.equal(h.context.ultimaRemocao, null);
    assert.equal(h.context.receitaEmEdicao, null);
    assert.equal(h.context.despesaParaRemover, null);
    assert.equal(h.context.ui.receitaNome.value, "");
    assert.equal(closed, 1);
});

test('review includes duplicate observations of the same operation, not unrelated conflicts', async()=>{
    const op=sync.makeOperation(sync.recordEntityKey(entry()),entry(),'rev-a');
    const first={kind:'concurrent-change',operation:op}, second={kind:'remote-changed-while-pending',operation:op};
    const other={kind:'concurrent-change',operation:{...op,id:'other'}};
    assert.equal(sync.blockedConflictKeys([first,second],first).size,0);
    assert.equal(sync.blockedConflictKeys([first,second,other],first).size,1);
});

test('concurrent confirmations merge monotonically and a new operation prevents confirmation',async()=>{
    const h=harness();
    const c=vm.createContext({idbServico:h.context.idbServico,structuredClone,Symbol,
        syncSessions:h.context.syncSessions,isCurrentSyncSession:h.context.isCurrentSyncSession,updateSettingsConflictActive:h.context.updateSettingsConflictActive});
    vm.runInContext(source.slice(source.indexOf('const syncMetaKey ='),source.indexOf('function setSyncStatus(')),c);
    const read=()=>vm.runInContext('readSyncMeta("alice")',c);
    const write=async value=>{c.proposal=value;return vm.runInContext('writeSyncMeta("alice",proposal)',c);};
    const a=await read(),b=await read();a.lastConfirmed='2026-10-22T10:00:00Z';b.lastConfirmed='2026-10-22T11:00:00Z';
    // The fixture's old textual value is replaced by a real timestamp first.
    h.context.writeSyncMeta('alice',{outbox:[],conflicts:[],lastConfirmed:null});
    await Promise.all([write(a),write(b)]);assert.equal(h.meta().lastConfirmed,b.lastConfirmed);
    const before=await read();await h.context.idbServico.enfileirar('alice',{id:'late',entityKey:'late'});
    before.lastConfirmed='2026-10-22T12:00:00Z';const result=await write(before);
    assert.equal(result.lastConfirmed,b.lastConfirmed);assert.equal(result.outbox[0].id,'late');
});

test('late conflict rendering from Alice cannot expose details in the Bob session', async()=>{
    const h=harness(),list={children:[],replaceChildren(){this.children=[];},append(value){this.children.push(value);}};
    h.context.syncUi.conflictList=list;h.context.syncUi.conflicts={};h.context.valoresOcultos=false;
    h.context.document={createElement:()=>({children:[],append(...items){this.children.push(...items);},addEventListener(){}})};
    let release;h.context.readSyncMeta=()=>new Promise(resolve=>{release=resolve;});
    vm.runInContext(source.slice(source.indexOf('async function renderSyncConflicts('),source.indexOf('async function resolveSyncConflict(')),h.context);
    const pending=h.context.renderSyncConflicts();h.context.syncUser={uid:'bob'};
    release({outbox:[],conflicts:[{kind:'alice-only',local:{valor:12345}}]});await pending;
    assert.equal(list.children.length,0);
});

test('a stale tab publishes the merged durable state instead of stopping reconnection or reverting it',async()=>{
    const h=harness(),base=structuredClone(h.context.estado);
    await h.context.idbServico.aplicarEdicao('alice',base,financialState(entry('r1',20)));
    h.pending(entry('r1',20));
    await h.context.publishFirebaseState(base);
    assert.equal(h.context.estado.meses['2026-10'].receitas[0].valor,20);
    assert.equal(h.commits.length,1);assert.equal(h.commits[0].value.record.valor,20);
});
