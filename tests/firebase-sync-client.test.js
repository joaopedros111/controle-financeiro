import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { snapshotConfirmed, makeOperation, recordEntityKey, validConflictRecord, validSyncIdentity, unicodeWellFormed } from "../sync-core.js";

const source = (await readFile(new URL("../firebase-sync-entry.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace("export function criarFirebaseSync", "function criarFirebaseSync");

// The production factory and transaction callbacks run unchanged; SDK I/O is local.
function harness() {
    const data = new Map(), listeners = [], auth = { currentUser: { uid: "alice" }, authStateReady: async()=>{} };
    const stamp = { seconds: 10, nanoseconds: 0 };
    const snapshot = (key) => {
        const present = data.has(key), value = structuredClone(data.get(key));
        return { exists: () => present, data: () => structuredClone(value), metadata: { fromCache: false, hasPendingWrites: false } };
    };
    let lock = Promise.resolve(), failWrite = false;
    const context = vm.createContext({ snapshotConfirmed, validConflictRecord, recordEntityKey, validSyncIdentity, unicodeWellFormed, console,
        initializeApp: () => ({}), initializeAuth: (_app,options) => { context.authOptions=options; return auth; }, GoogleAuthProvider: class {},
        browserLocalPersistence: {type:'LOCAL'}, indexedDBLocalPersistence: {type:'LOCAL-IDB'}, browserSessionPersistence: {type:'SESSION'}, browserPopupRedirectResolver: {},
        localStorage: {setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k)},
        initializeFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
        doc: (...parts) => parts.filter((part) => typeof part === "string").join("/"),
        collection: (...parts) => parts.filter((part) => typeof part === "string").join("/"),
        getDocFromServer: async (key) => snapshot(key), getDoc: async (key) => snapshot(key),
        getDocsFromServer: async (key) => {
            const docs = [...data].filter(([path]) => path.startsWith(key + "/") && !path.slice(key.length + 1).includes("/"))
                .map(([path, value]) => ({ id: path.split("/").at(-1), data: () => structuredClone(value), metadata: { hasPendingWrites: false } }));
            return { metadata: { fromCache: false, hasPendingWrites: false }, docs, size: docs.length };
        },
        setDoc: async (key, value) => { if (failWrite) { failWrite = false; throw new Error("write unavailable"); } data.set(key, structuredClone(value)); },
        onSnapshot: (key, options, callback) => { assert.equal(options.includeMetadataChanges, true); const entry = { key, callback }; listeners.push(entry); return () => { entry.stopped = true; }; },
        serverTimestamp: () => stamp, Timestamp: { now: () => stamp },
        runTransaction: (_db, callback) => {
            const pending = lock.then(async () => {
                const writes = [];
                const result = await callback({ get: async (key) => snapshot(key),
                    set: (key, value) => writes.push([key, structuredClone(value)]),
                    update: (key, value) => writes.push([key, { ...data.get(key), ...value }]) });
                if (writes.length && failWrite) { failWrite = false; throw new Error("write unavailable"); }
                writes.forEach(([key, value]) => data.set(key, value)); return result;
            });
            lock = pending.catch(() => {}); return pending;
        }
    });
    vm.runInContext(source, context);
    return { client: context.criarFirebaseSync({}), context, data, listeners, auth,
        failNextWrite: () => { failWrite = true; } };
}
const value = (valor = 10) => ({ month: "2026-10", type: "receitas", id: "r1", record: { id: "r1", nome: "Receita", valor }, deleted: false });

test('automatic recovery upload is immutable, idempotent and isolated by UID', async () => {
    const h = harness(), item = { id: 'auto-history-synthetic', entityKey: recordEntityKey(value()),
        policy: 'server-confirmed-wins', local: value(30), remote: { ...value(20), revision: 'server' } };
    await h.client.saveAutomaticHistory('alice', item);
    await h.client.saveAutomaticHistory('alice', { ...item, local: value(99) });
    const rows = await h.client.listAutomaticHistory('alice');
    assert.equal(rows.length, 1); assert.equal(rows[0].local.value.record.valor, 30);
    await assert.rejects(h.client.saveAutomaticHistory('bob', item));
    await assert.rejects(h.client.listAutomaticHistory('bob'));
});

test('even an edit carrying the tombstone revision cannot resurrect a deleted record', async () => {
    const h = harness(), deletion = makeOperation(recordEntityKey(value()), { month: '2026-10', type: 'receitas', id: 'r1', deleted: true }, null);
    await h.client.commit('alice', deletion);
    const delayed = makeOperation(recordEntityKey(value()), value(99), deletion.id);
    assert.equal((await h.client.commit('alice', delayed)).conflict, true);
    const rows = await h.client.list('alice'); assert.equal(rows[0].deleted, true);
    assert.equal(rows[0].revision, deletion.id);
});

test("factory real valida UID e listagem completa exige metadados do servidor", async () => {
    const h = harness(); h.data.set("users/alice/records/malformed", { id: "missing-month" });
    const items = await h.client.list("alice");
    assert.equal(items.length, 1); // missing-month must not disappear behind orderBy
    await assert.rejects(h.client.list("bob"), /autenticado/);
    h.context.getDocsFromServer = async () => ({ docs: [], metadata: { fromCache: true, hasPendingWrites: false } });
    await assert.rejects(h.client.list("alice"), /confirmados/);
});

test("factory real repete operação idempotente, detecta concorrência e preserva tombstone", async () => {
    const h = harness(), key = recordEntityKey(value()), op = makeOperation(key, value());
    await h.client.commit("alice", op);
    const repeated = await h.client.commit("alice", op);
    assert.equal(repeated.duplicate, true);
    const changes = await Promise.all([20, 30].map((amount) => h.client.commit("alice", makeOperation(key, value(amount), op.id))));
    assert.equal(changes.filter((result) => result.conflict).length, 1);
    const path = `users/alice/records/${key}`, revision = h.data.get(path).revision;
    const deletion = makeOperation(key, { month: "2026-10", type: "receitas", id: "r1", deleted: true }, revision);
    await h.client.commit("alice", deletion);
    assert.equal(h.data.get(path).deleted, true);
    assert.equal(Object.hasOwn(h.data.get(path), "record"), false);
    const staleOperation = makeOperation(key, value(40), revision);
    const stale = await h.client.commit("alice", staleOperation);
    assert.equal(stale.conflict, true);
    const repeatedConflict = await h.client.commit("alice", staleOperation);
    assert.equal(repeatedConflict.conflict, true);
    assert.equal(repeatedConflict.duplicate, true);
    assert.equal(h.data.get(path).deleted, true);
});

test("configurações só confirmam geração quando manifesto e categorias vêm do servidor", () => {
    const h = harness(), received = [];
    const stop = h.client.listenSettings("alice", (value, metadata) => received.push({ value, metadata }));
    const manifest = { version: 4, generation: "g1", theme: "claro", categoryCount: 1, budgetCount: 0, revision: "rev1" };
    const server = { fromCache: false, hasPendingWrites: false }, cache = { fromCache: true, hasPendingWrites: false };
    h.listeners[0].callback({ exists: () => true, data: () => manifest, metadata: server });
    const categories = h.listeners.at(-1);
    const docs = [{ id: "c_Casa", data: () => ({ name: "Casa" }) }];
    categories.callback({ size: 1, docs, metadata: cache });
    assert.equal(received.length, 1);
    assert.equal(snapshotConfirmed(received[0].metadata), false);
    categories.callback({ size: 1, docs, metadata: server });
    assert.equal(received.length, 2);
    assert.equal(snapshotConfirmed(received[1].metadata), true);
    stop(); assert.equal(h.listeners.every((entry) => entry.stopped), true);
});

test("falha parcial de geração não publica manifesto; repetição retoma sem apagar documentos", async () => {
    const h = harness(), settings = { categories: ["Casa", "Lazer"], theme: "claro", budgets: { padrao: { Casa: 20 }, meses: {} } };
    h.failNextWrite();
    await assert.rejects(h.client.saveSettings("alice", settings), /write unavailable/);
    assert.equal(h.data.has("users/alice/settingsV2/finance"), false);
    assert.equal(h.data.size, 1);
    const result = await h.client.saveSettings("alice", settings);
    assert.equal(result.acknowledged, true);
    const before = h.data.size;
    assert.equal((await h.client.saveSettings("alice", settings)).duplicate, true);
    assert.equal(h.data.size, before);
    const conflict = await h.client.saveSettings("alice", { ...settings, theme: "escuro" }, "stale");
    assert.equal(conflict.conflict, true);
    assert.equal(h.data.get("users/alice/settingsV2/finance").revision, result.revision);
    assert.ok(h.data.size > before); // orphan generation retained; no automatic cleanup
});

test("settings SDK rechecks a cancelled write after category reads before writing any document", async () => {
    const h = harness(); let valid = true;
    const transaction = h.context.runTransaction;
    h.context.runTransaction = (db, callback) => transaction(db, tx => callback({ ...tx,
        get: async key => { const result = await tx.get(key); valid = false; return result; } }));
    await assert.rejects(h.client.saveSettings("alice", { categories: ["Moto"], theme: "claro", budgets: { padrao: {}, meses: {} } }, null, () => valid),
        error => error.code === 'sync/settings-stale');
    assert.equal(h.data.size, 0);
});

test("settings SDK cancels at the manifest boundary and retains completed generation data for an idempotent retry", async () => {
    const h = harness(); let valid = true;
    const transaction = h.context.runTransaction;
    h.context.runTransaction = (db, callback) => transaction(db, tx => callback({ ...tx,
        get: async key => { const result = await tx.get(key); if (key === 'users/alice/settingsV2/finance') valid = false; return result; } }));
    const settings = { categories: ["Moto", "Serasa"], theme: "claro", budgets: { padrao: {}, meses: {} } };
    await assert.rejects(h.client.saveSettings("alice", settings, null, () => valid), error => error.code === 'sync/settings-stale');
    assert.equal(h.data.has('users/alice/settingsV2/finance'), false); assert.equal(h.data.size, 2);
    const generation = structuredClone([...h.data]); h.context.runTransaction = transaction;
    const ack = await h.client.saveSettings("alice", settings, null, () => true);
    assert.equal(ack.acknowledged, true);
    for (const [key, value] of generation) assert.deepEqual(h.data.get(key), value);
});

test("cliente de produção executa transações e configurações nas regras do Emulator", {
    skip: !process.env.FIRESTORE_EMULATOR_HOST && "Requires Firestore Emulator"
}, async () => {
    const sdk = await import("firebase/firestore");
    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
    assert.match(host, /^(127\.0\.0\.1|localhost)$/, "Somente o Emulator local pode receber os testes.");
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    const env = await initializeTestEnvironment({ projectId: "demo-sync-client-contract", firestore: { host, port: Number(port), rules } });
    const dependencies = { ...sdk, snapshotConfirmed, validConflictRecord, recordEntityKey, validSyncIdentity, unicodeWellFormed,
        initializeApp: () => ({}), initializeAuth: () => ({ currentUser: { uid: "alice" } }), GoogleAuthProvider: class {},
        browserLocalPersistence: {},indexedDBLocalPersistence:{},browserSessionPersistence:{},browserPopupRedirectResolver:{},
        localStorage: {setItem(k,v){this[k]=v;},getItem(k){return this[k]??null;},removeItem(k){delete this[k];}},
        initializeFirestore: () => env.authenticatedContext("alice").firestore(),
        persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}) };
    // Same realm as the SDK so Firestore sees ordinary objects, with only auth/bootstrap replaced.
    const factory = Function(...Object.keys(dependencies), `${source}\nreturn criarFirebaseSync;`)(...Object.values(dependencies));
    try {
        const client = factory({}), key = recordEntityKey(value()), create = makeOperation(key, value());
        assert.equal((await client.commit("alice", create)).acknowledged, true);
        assert.equal((await client.commit("alice", create)).duplicate, true);
        const results = await Promise.all([20, 30].map((amount) => client.commit("alice", makeOperation(key, value(amount), create.id))));
        assert.equal(results.filter((result) => result.conflict).length, 1);
        const records = await client.list("alice");
        assert.equal(records.length, 1);
        const remove = makeOperation(key, { month: "2026-10", type: "receitas", id: "r1", deleted: true }, records[0].revision);
        await client.commit("alice", remove);
        assert.equal((await client.list("alice"))[0].deleted, true);
        assert.equal((await client.listConflicts("alice")).length, 1);
        const settings = { categories: ["Casa"], theme: "claro", budgets: { padrao: { Casa: 0.29 }, meses: {} } };
        const saves = await Promise.all([client.saveSettings("alice", settings), client.saveSettings("alice", settings)]);
        assert.equal(saves.every((result) => result.acknowledged === true), true);
        const saved = saves[0];
        assert.equal(saved.acknowledged, true);
        assert.equal((await client.saveSettings("alice", settings)).duplicate, true);
        assert.equal((await client.getSettings("alice")).budgets.padrao.Casa, 0.29);
        await assert.rejects(client.list("bob"), /autenticado/);
        await assert.rejects(client.commit("alice", { ...create, entityKey: "arbitrary" }), /inválida/);
    } finally { await env.cleanup(); }
});

test("orçamento da categoria __proto__ é preservado na leitura", async () => {
    const h = harness(), defaults = JSON.parse('{"__proto__":0.29}');
    await h.client.saveSettings("alice", { categories: ["__proto__"], theme: "claro", budgets: { padrao: defaults, meses: {} } });
    assert.equal((await h.client.getSettings("alice")).budgets.padrao.__proto__, 0.29);
});

test("callbacks de geração cancelada e listener encerrado não publicam configurações", () => {
    const h = harness(), received = [];
    const stop = h.client.listenSettings("alice", (value) => received.push(value));
    const stamp = { fromCache: false, hasPendingWrites: false };
    const emitManifest = (generation) => h.listeners[0].callback({ exists: () => true,
        data: () => ({ version: 4, generation, theme: "claro", categoryCount: 0, budgetCount: 0, revision: generation }), metadata: stamp });
    emitManifest("one"); const old = h.listeners.at(-1);
    emitManifest("two"); const current = h.listeners.at(-1);
    old.callback({ size: 0, docs: [], metadata: stamp }); assert.equal(received.length, 0);
    stop(); current.callback({ size: 0, docs: [], metadata: stamp }); assert.equal(received.length, 0);
});

test("Auth persistido continua acessível quando redirect falha somente por estar offline", async () => {
    const h = harness(); h.context.browserLocalPersistence = {};
    h.context.setPersistence = async () => {};
    h.context.navigator = { onLine: false };
    h.context.getRedirectResult = async () => { throw Object.assign(new Error("offline"), { code: "auth/network-request-failed" }); };
    assert.equal((await h.client.ready()).uid, "alice");
});

test('Google popup success preserves existing session and does not use redirect', async()=>{
    const h=harness();let calls=0;h.context.signInWithPopup=async auth=>{calls++;return {user:auth.currentUser};};
    h.context.signInWithRedirect=()=>{throw new Error('unexpected redirect');};
    assert.equal((await h.client.login()).user.uid,'alice');assert.equal(calls,1);
});
for(const code of ['auth/popup-closed-by-user','auth/popup-blocked','auth/network-request-failed']) test('Google popup propagates '+code+' without clearing session',async()=>{
    const h=harness();h.context.signInWithPopup=async()=>{throw Object.assign(new Error(code),{code});};
    await assert.rejects(h.client.login(),error=>error.code===code);assert.equal(h.auth.currentUser.uid,'alice');assert.equal(h.data.size,0);
});
test('ready restores existing session even when no redirect result exists',async()=>{
    const h=harness();h.context.setPersistence=async()=>{};h.context.browserLocalPersistence={};h.context.getRedirectResult=async()=>null;
    assert.equal((await h.client.ready()).uid,'alice');
});

 test('Auth bootstrap declares one consistent hierarchy and preserves browser popup resolver',()=>{
  const h=harness(),options=h.context.authOptions;
  assert.equal(options.persistence[0],h.context.browserLocalPersistence);
  assert.equal(options.persistence[1],h.context.indexedDBLocalPersistence);
  assert.equal(options.persistence[2],h.context.browserSessionPersistence);
  assert.equal(options.popupRedirectResolver,h.context.browserPopupRedirectResolver);
  assert.equal(h.data.size,0,'probe leaves no keys');
 });
 test('ready waits for restored Auth without changing its persistence',async()=>{
  const h=harness();let release,redirectCalls=0;h.auth.authStateReady=()=>new Promise(r=>release=r);
  h.context.setPersistence=()=>{throw new Error('late persistence switch');};
  h.context.getRedirectResult=async()=>{redirectCalls++;return null;};
  const ready=h.client.ready();await Promise.resolve();assert.equal(redirectCalls,0);
  release();assert.equal((await ready).uid,'alice');assert.equal(redirectCalls,1);
 });
 test('incompatible prior Auth initialization fails without replacing or signing out the user',()=>{
  const h=harness();h.context.initializeAuth=()=>{throw Object.assign(new Error('different options'),{code:'auth/already-initialized'});};
  assert.throws(()=>h.context.criarFirebaseSync({}),e=>e.code==='auth/already-initialized');assert.equal(h.auth.currentUser.uid,'alice');
 });
 test('unavailable local persistence fails closed before Auth bootstrap and can retry without clearing existing keys',()=>{
  const h=harness();h.data.set('existing-auth-source','preserve');let calls=0;
  const original=h.context.initializeAuth;h.context.initializeAuth=(...args)=>{calls++;return original(...args);};
  const set=h.context.localStorage.setItem;h.context.localStorage.setItem=()=>{throw new Error('blocked');};
  assert.throws(()=>h.context.criarFirebaseSync({}),e=>e.code==='auth/web-storage-unsupported');assert.equal(calls,0);assert.equal(h.data.get('existing-auth-source'),'preserve');
  h.context.localStorage.setItem=set;assert.ok(h.context.criarFirebaseSync({}));assert.equal(calls,1);
 });
 test('persistence revoked before ready prevents redirect and preserves the restored user',async()=>{
  const h=harness();let redirects=0;h.context.getRedirectResult=async()=>{redirects++;};
  h.context.localStorage.setItem=()=>{throw new Error('blocked');};
  await assert.rejects(h.client.ready(),e=>e.code==='auth/web-storage-unsupported');assert.equal(redirects,0);assert.equal(h.auth.currentUser.uid,'alice');
 });
