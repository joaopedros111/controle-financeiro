import { initializeApp } from "firebase/app";
import { snapshotConfirmed, validConflictRecord, recordEntityKey, validSyncIdentity, unicodeWellFormed } from "./sync-core.js";
import { initializeAuth, browserPopupRedirectResolver, GoogleAuthProvider, browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore, collection, doc, getDocs, getDocsFromServer, getDoc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp, query, orderBy, setDoc, Timestamp } from "firebase/firestore";

const settingsV2Ref = (db, uid) => doc(db, "users", uid, "settingsV2", "finance");
const generationCollection = (db, uid, generation) => collection(db, "users", uid, "settingsV2", "finance", "generations", generation, "categories");
const encodeSettingKey = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const settingsDocId = (kind, value) => `${kind}_${encodeSettingKey(value)}`;
async function readSettingsGeneration(db, uid, manifest, { serverOnly = false } = {}) {
    if (!manifest || manifest.version !== 4 || typeof manifest.generation !== "string" || !manifest.generation || manifest.generation.length > 128
        || !["claro", "escuro", "rosa", "floresta", "pangolim"].includes(manifest.theme)
        || !Number.isInteger(manifest.categoryCount) || manifest.categoryCount < 0 || manifest.categoryCount > 1000
        || !Number.isInteger(manifest.budgetCount) || manifest.budgetCount < 0 || manifest.budgetCount > 1000
        || typeof manifest.revision !== "string" || !manifest.revision || manifest.revision.length > 128) throw new Error("Manifesto de configurações remotas inválido.");
    const fetch = serverOnly ? getDocsFromServer : getDocs;
    const categorySnapshot = await fetch(generationCollection(db, uid, manifest.generation));
    if (serverOnly && !snapshotConfirmed(categorySnapshot.metadata)) throw new Error("As categorias ainda não foram confirmadas pelo servidor.");
    if (categorySnapshot.size !== manifest.categoryCount) throw new Error("A geração de configurações remotas está incompleta.");
    const categories = [], budgets = Object.create(null);
    for (const item of categorySnapshot.docs) {
        const value = item.data();
        if (Object.keys(value).some((key) => !["name", "budget"].includes(key)) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 40 || item.id !== settingsDocId("c", value.name) || categories.includes(value.name)) throw new Error("Documento de categoria remoto inválido.");
        categories.push(value.name);
        if (Object.hasOwn(value, "budget")) {
            if (!Number.isFinite(value.budget) || value.budget < 0 || value.budget > 2 ** 44) throw new Error("Orçamento remoto inválido.");
            budgets[value.name] = value.budget;
        }
    }
    if (Object.keys(budgets).length !== manifest.budgetCount) throw new Error("A geração de orçamentos remotos está incompleta.");
    return { version: 3, categories: categories.sort(), theme: manifest.theme, budgets: { padrao: budgets, meses: {} }, revision: manifest.revision, updatedAt: Timestamp.now() };
}
function makeSettingsRevision(baseRevision, settings) {
    const source = `${baseRevision || "new"}|${JSON.stringify(settings)}`; let first = 2166136261, second = 2246822519, third = 3266489917, fourth = 668265263;
    for (let index = 0; index < source.length; index += 1) { const code = source.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ (code + 31), 3266489917); third = Math.imul(third ^ (code + 62), 668265263); fourth = Math.imul(fourth ^ (code + 93), 2246822519); }
    return `settings-${[first, second, third, fourth].map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("")}`;
}

// Check only a unique probe owned by this call; never remove an Auth or financial key.
function verificarPersistenciaAuth() {
    const key = '__controle_financeiro_auth_probe__' + Date.now() + '-' + Math.random();
    let persistenceStorage;
    try {
        persistenceStorage = localStorage;
        persistenceStorage.setItem(key, key);
        if (persistenceStorage.getItem(key) !== key) throw new Error('Storage unavailable');
    } catch {
        throw Object.assign(new Error('O navegador bloqueou a persistencia da sessao. Permita o armazenamento e tente novamente.'), { code: 'auth/web-storage-unsupported' });
    } finally {
        try { persistenceStorage?.removeItem(key); } catch { /* Probe cleanup only. */ }
    }
}

export function criarFirebaseSync(config) {
    const app = initializeApp(config);
    verificarPersistenciaAuth();
    // Local storage is the definitive first choice. Legacy backends remain in
    // the SDK hierarchy for session recovery, without switching persistence in ready().
    // initializeAuth reuses identical options and rejects incompatible prior initialization.
    const auth = initializeAuth(app, {
        persistence: [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence],
        popupRedirectResolver: browserPopupRedirectResolver
    });
    const ensureUser = (uid) => { if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado."); };
    const provider = new GoogleAuthProvider();
    let db;
    try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
    catch { try { db = initializeFirestore(app, { localCache: memoryLocalCache() }); } catch { db = getFirestore(app); } }
    return {
        async ready() {
            await auth.authStateReady();
            verificarPersistenciaAuth();
            try { await getRedirectResult(auth); }
            catch (error) {
                if (globalThis.navigator?.onLine !== false || error?.code !== "auth/network-request-failed") throw error;
            }
            return auth.currentUser;
        },
        onUser: (callback) => onAuthStateChanged(auth, callback),
        // Called directly from the click gesture: do not await initialization here.
        login: () => signInWithPopup(auth, provider),
        logout: () => signOut(auth),
        async list(uid, { serverOnly = true } = {}) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            // Do not orderBy: it silently omits malformed documents missing `month`.
            const recordsQuery = collection(db, "users", uid, "records");
            const snap = serverOnly ? await getDocsFromServer(recordsQuery) : await getDocs(recordsQuery);
            if (!snapshotConfirmed(snap.metadata)) throw new Error("Os lançamentos ainda não foram confirmados pelo servidor.");
            return snap.docs.map((entry) => ({ ...entry.data(), _docId: entry.id, hasPendingWrites: entry.metadata.hasPendingWrites }));
        },
        async getSettings(uid, { serverOnly = true } = {}) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const fetch = serverOnly ? getDocFromServer : getDoc;
            const manifest = await fetch(settingsV2Ref(db, uid));
            if (serverOnly && !snapshotConfirmed(manifest.metadata)) throw new Error("O manifesto ainda não foi confirmado pelo servidor.");
            if (manifest.exists()) return readSettingsGeneration(db, uid, manifest.data(), { serverOnly });
            const legacy = await fetch(doc(db, "users", uid, "settings", "finance"));
            if (serverOnly && !snapshotConfirmed(legacy.metadata)) throw new Error("As configurações ainda não foram confirmadas pelo servidor.");
            return legacy.exists() ? legacy.data() : null;
        },
        async saveSettings(uid, settings, baseRevision = null, canWrite = () => true) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const ensureSettingsWrite = () => {
                ensureUser(uid);
                if (!canWrite()) throw Object.assign(new Error("Envio de configurações obsoleto ou persistência bloqueada."), { code: "sync/settings-stale" });
            };
            ensureSettingsWrite();
            const categories = settings?.categories, defaults = settings?.budgets?.padrao;
            if (!Array.isArray(categories) || categories.length > 1000 || categories.some((name) => typeof name !== "string" || !name.trim() || name.length > 40 || !unicodeWellFormed(name))
                || new Set(categories).size !== categories.length || !defaults || typeof defaults !== "object" || Array.isArray(defaults)
                || Object.entries(defaults).some(([name, amount]) => !categories.includes(name) || !Number.isFinite(amount) || amount < 0 || amount > 2 ** 44)
                || !["claro", "escuro", "rosa", "floresta", "pangolim"].includes(settings.theme)) throw new TypeError("Configurações financeiras inválidas para sincronização.");
            const revision = makeSettingsRevision(baseRevision, settings), generation = revision;
            const categoriesRef = generationCollection(db, uid, generation);
            const writeInChunks = async (entries, makeWrite) => {
                for (let offset = 0; offset < entries.length; offset += 20) {
                    const results = await Promise.allSettled(entries.slice(offset, offset + 20).map(makeWrite));
                    const failed = results.find((result) => result.status === "rejected");
                    if (failed) throw failed.reason;
                }
            };
            await writeInChunks(categories, async (name) => {
                ensureSettingsWrite();
                const reference = doc(categoriesRef, settingsDocId("c", name));
                const value = Object.hasOwn(defaults, name) ? { name, budget: defaults[name] } : { name };
                return runTransaction(db, async (tx) => {
                ensureSettingsWrite();
                const existing = await tx.get(reference);
                ensureSettingsWrite();
                if (existing.exists()) {
                    const remote = existing.data();
                    if (remote.name !== value.name || Object.hasOwn(remote, "budget") !== Object.hasOwn(value, "budget")
                        || (Object.hasOwn(value, "budget") && remote.budget !== value.budget)) throw new Error("A geração de configurações existente contém dados diferentes.");
                    return;
                }
                tx.set(reference, value);
                });
            });
            const target = settingsV2Ref(db, uid), legacyTarget = doc(db, "users", uid, "settings", "finance");
            return runTransaction(db, async (tx) => {
                ensureSettingsWrite();
                const [current, legacy] = await Promise.all([tx.get(target), tx.get(legacyTarget)]);
                ensureSettingsWrite();
                const active = current.exists() ? current.data() : legacy.exists() ? legacy.data() : null;
                if (active?.revision === revision) return { acknowledged: true, duplicate: true, revision };
                if ((active?.revision || null) !== baseRevision) return { conflict: true, remote: current.exists() ? await readSettingsGeneration(db, uid, active, { serverOnly: true }) : active };
                tx.set(target, { version: 4, theme: settings.theme, categoryCount: categories.length, budgetCount: Object.keys(defaults).length,
                    generation, revision });
                return { acknowledged: true, revision };
            });
        },
        listenSettings(uid, callback, failure) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            let generationUnsubscribers = [], active = true, generationToken = 0;
            const clearGeneration = () => { generationToken += 1; generationUnsubscribers.forEach((unsubscribe) => unsubscribe()); generationUnsubscribers = []; };
            const legacyRef = doc(db, "users", uid, "settings", "finance");
            const manifestUnsubscribe = onSnapshot(settingsV2Ref(db, uid), { includeMetadataChanges: true }, (manifest) => {
                if (!active || auth.currentUser?.uid !== uid) return;
                clearGeneration();
                const token = generationToken, current = () => active && token === generationToken && auth.currentUser?.uid === uid;
                if (!manifest.exists()) {
                    generationUnsubscribers.push(onSnapshot(legacyRef, { includeMetadataChanges: true }, (legacy) => {
                        if (current()) callback(legacy.exists() ? legacy.data() : null,
                            { fromCache: manifest.metadata.fromCache || legacy.metadata.fromCache, hasPendingWrites: manifest.metadata.hasPendingWrites || legacy.metadata.hasPendingWrites });
                    }, failure));
                    return;
                }
                const data = manifest.data(); let categories = null;
                const publish = () => {
                    if (!current() || !categories) return;
                    try {
                        if (categories.size !== data.categoryCount) throw new Error("A geração de configurações remotas está incompleta.");
                        const values = [], defaults = Object.create(null);
                        for (const item of categories.docs) { const value = item.data(); if (Object.keys(value).some((key) => !["name", "budget"].includes(key)) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 40 || item.id !== settingsDocId("c", value.name) || values.includes(value.name)) throw new Error("Documento de categoria remoto inválido."); values.push(value.name); if (Object.hasOwn(value, "budget")) { if (!Number.isFinite(value.budget) || value.budget < 0 || value.budget > 2 ** 44) throw new Error("Orçamento remoto inválido."); defaults[value.name] = value.budget; } }
                        if (Object.keys(defaults).length !== data.budgetCount) throw new Error("A geração de orçamentos remotos está incompleta.");
                        callback({ version: 3, categories: values.sort(), theme: data.theme, budgets: { padrao: defaults, meses: {} }, revision: data.revision, updatedAt: Timestamp.now() },
                            { fromCache: manifest.metadata.fromCache || categories.metadata.fromCache, hasPendingWrites: manifest.metadata.hasPendingWrites || categories.metadata.hasPendingWrites });
                    } catch (error) { failure?.(error); }
                };
                generationUnsubscribers.push(onSnapshot(generationCollection(db, uid, data.generation), { includeMetadataChanges: true }, (snapshot) => { categories = snapshot; publish(); }, failure));
            }, failure);
            return () => { active = false; clearGeneration(); manifestUnsubscribe(); };
        },
        listen(uid, callback, failure) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            return onSnapshot(collection(db, "users", uid, "records"), { includeMetadataChanges: true }, (snapshot) => callback(snapshot.docs.map((entry) => ({ ...entry.data(), _docId: entry.id, hasPendingWrites: entry.metadata.hasPendingWrites })), snapshot.metadata), failure);
        },
        async listConflicts(uid, { serverOnly = true } = {}) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const source = collection(db, "users", uid, "conflicts");
            const snap = serverOnly ? await getDocsFromServer(source) : await getDocs(source);
            if (!snapshotConfirmed(snap.metadata)) throw new Error("Os conflitos ainda não foram confirmados pelo servidor.");
            return snap.docs.map((entry) => ({ ...entry.data(), _docId: entry.id }));
        },
        listenConflicts(uid, callback, failure) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            return onSnapshot(collection(db, "users", uid, "conflicts"), { includeMetadataChanges: true }, (snapshot) => callback(snapshot.docs.map((entry) => ({ ...entry.data(), _docId: entry.id })), snapshot.metadata), failure);
        },
        async resolveConflict(uid, operationId, resolution) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const target = doc(db, "users", uid, "conflicts", operationId);
            return runTransaction(db, async (tx) => {
                ensureUser(uid);
                const snapshot = await tx.get(target);
                ensureUser(uid);
                if (!snapshot.exists()) return false;
                if (snapshot.data().resolved === true) return true;
                tx.update(target, { resolved: true, resolution, resolvedAt: serverTimestamp() });
                return true;
            });
        },
        async commit(uid, op) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            if (!op || typeof op.id !== "string" || !op.id || op.id.length > 128
                || !validConflictRecord(op.value) || !validSyncIdentity(op.value.id)
                || op.entityKey !== recordEntityKey(op.value)) throw new TypeError("Operação financeira inválida; os dados locais foram preservados.");
            const operationRef = doc(db, "users", uid, "operations", op.id);
            const recordRef = doc(db, "users", uid, "records", op.entityKey);
            return runTransaction(db, async (tx) => {
                ensureUser(uid);
                const [prior, current] = await Promise.all([tx.get(operationRef), tx.get(recordRef)]);
                ensureUser(uid);
                if (prior.exists()) {
                    const status = prior.data().status;
                    if (!["applied", "conflict"].includes(status)) throw new Error("Confirmação remota de operação inválida.");
                    return status === "conflict" ? { acknowledged: true, duplicate: true, conflict: true, remote: current.exists() ? current.data() : null }
                        : { acknowledged: true, duplicate: true };
                }
                const old = current.exists() ? current.data() : null;
                if ((old?.revision || null) !== op.baseRevision) {
                    const conflictRef = doc(db, "users", uid, "conflicts", op.id);
                    tx.set(conflictRef, { operationId: op.id, entityKey: op.entityKey, local: op.value, remote: old, createdAt: serverTimestamp() });
                    tx.set(operationRef, { status: "conflict", createdAt: serverTimestamp() });
                    return { acknowledged: true, conflict: true, remote: old };
                }
                tx.set(recordRef, { ...op.value, revision: op.id, updatedAt: serverTimestamp() });
                tx.set(operationRef, { status: "applied", createdAt: serverTimestamp() });
                return { acknowledged: true };
            });
        }
    };
}
