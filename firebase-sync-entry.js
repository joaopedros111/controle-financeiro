import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
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
    if (categorySnapshot.size !== manifest.categoryCount) throw new Error("A geração de configurações remotas está incompleta.");
    const categories = [], budgets = {};
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
    return { version: 3, categories, theme: manifest.theme, budgets: { padrao: budgets, meses: {} }, revision: manifest.revision, updatedAt: Timestamp.now() };
}
function makeSettingsRevision(baseRevision, settings) {
    const source = `${baseRevision || "new"}|${JSON.stringify(settings)}`; let first = 2166136261, second = 2246822519, third = 3266489917, fourth = 668265263;
    for (let index = 0; index < source.length; index += 1) { const code = source.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ (code + 31), 3266489917); third = Math.imul(third ^ (code + 62), 668265263); fourth = Math.imul(fourth ^ (code + 93), 2246822519); }
    return `settings-${[first, second, third, fourth].map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("")}`;
}

export function criarFirebaseSync(config) {
    const app = initializeApp(config);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    let db;
    try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
    catch { try { db = initializeFirestore(app, { localCache: memoryLocalCache() }); } catch { db = getFirestore(app); } }
    return {
        async ready() { await setPersistence(auth, browserLocalPersistence); await getRedirectResult(auth); return auth.currentUser; },
        onUser: (callback) => onAuthStateChanged(auth, callback),
        login: () => signInWithRedirect(auth, provider),
        logout: () => signOut(auth),
        async list(uid, { serverOnly = false } = {}) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const recordsQuery = query(collection(db, "users", uid, "records"), orderBy("month"));
            const snap = serverOnly ? await getDocsFromServer(recordsQuery) : await getDocs(recordsQuery);
            return snap.docs.map((entry) => ({ ...entry.data(), _docId: entry.id, hasPendingWrites: entry.metadata.hasPendingWrites }));
        },
        async getSettings(uid, { serverOnly = false } = {}) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const fetch = serverOnly ? getDocFromServer : getDoc;
            const manifest = await fetch(settingsV2Ref(db, uid));
            if (manifest.exists()) return readSettingsGeneration(db, uid, manifest.data(), { serverOnly });
            const legacy = await fetch(doc(db, "users", uid, "settings", "finance"));
            return legacy.exists() ? legacy.data() : null;
        },
        async saveSettings(uid, settings, baseRevision = null) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const categories = settings?.categories, defaults = settings?.budgets?.padrao;
            if (!Array.isArray(categories) || categories.length > 1000 || categories.some((name) => typeof name !== "string" || !name.trim() || name.length > 40)
                || new Set(categories).size !== categories.length || !defaults || typeof defaults !== "object" || Array.isArray(defaults)
                || Object.entries(defaults).some(([name, amount]) => !categories.includes(name) || !Number.isFinite(amount) || amount < 0 || amount > 2 ** 44)
                || !["claro", "escuro", "rosa", "floresta", "pangolim"].includes(settings.theme)) throw new TypeError("Configurações financeiras inválidas para sincronização.");
            const revision = makeSettingsRevision(baseRevision, settings), generation = revision;
            const categoriesRef = generationCollection(db, uid, generation);
            const writeInChunks = async (entries, makeWrite) => {
                for (let offset = 0; offset < entries.length; offset += 20) await Promise.all(entries.slice(offset, offset + 20).map(makeWrite));
            };
            await writeInChunks(categories, async (name) => {
                const reference = doc(categoriesRef, settingsDocId("c", name));
                const value = Object.hasOwn(defaults, name) ? { name, budget: defaults[name] } : { name };
                const existing = await getDocFromServer(reference);
                if (existing.exists()) {
                    const remote = existing.data();
                    if (remote.name !== value.name || Object.hasOwn(remote, "budget") !== Object.hasOwn(value, "budget")
                        || (Object.hasOwn(value, "budget") && remote.budget !== value.budget)) throw new Error("A geração de configurações existente contém dados diferentes.");
                    return;
                }
                await setDoc(reference, value);
            });
            const target = settingsV2Ref(db, uid), legacyTarget = doc(db, "users", uid, "settings", "finance");
            return runTransaction(db, async (tx) => {
                const [current, legacy] = await Promise.all([tx.get(target), tx.get(legacyTarget)]);
                const active = current.exists() ? current.data() : legacy.exists() ? legacy.data() : null;
                if ((active?.revision || null) !== baseRevision) return { conflict: true, remote: current.exists() ? await readSettingsGeneration(db, uid, active) : active };
                tx.set(target, { version: 4, theme: settings.theme, categoryCount: categories.length, budgetCount: Object.keys(defaults).length,
                    generation, revision });
                return { acknowledged: true, revision };
            });
        },
        listenSettings(uid, callback, failure) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            let generationUnsubscribers = [];
            const clearGeneration = () => { generationUnsubscribers.forEach((unsubscribe) => unsubscribe()); generationUnsubscribers = []; };
            const legacyRef = doc(db, "users", uid, "settings", "finance");
            const legacyUnsubscribe = onSnapshot(legacyRef, (legacy) => { if (!legacy.exists()) callback(null, legacy.metadata); }, failure);
            const manifestUnsubscribe = onSnapshot(settingsV2Ref(db, uid), (manifest) => {
                clearGeneration();
                if (!manifest.exists()) {
                    generationUnsubscribers.push(onSnapshot(legacyRef, (legacy) => callback(legacy.exists() ? legacy.data() : null, legacy.metadata), failure));
                    return;
                }
                const data = manifest.data(); let categories = null, emitted = false;
                const publish = () => {
                    if (emitted || !categories) return;
                    emitted = true;
                    try {
                        if (categories.size !== data.categoryCount) throw new Error("A geração de configurações remotas está incompleta.");
                        const values = [], defaults = {};
                        for (const item of categories.docs) { const value = item.data(); if (Object.keys(value).some((key) => !["name", "budget"].includes(key)) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 40 || item.id !== settingsDocId("c", value.name) || values.includes(value.name)) throw new Error("Documento de categoria remoto inválido."); values.push(value.name); if (Object.hasOwn(value, "budget")) { if (!Number.isFinite(value.budget) || value.budget < 0 || value.budget > 2 ** 44) throw new Error("Orçamento remoto inválido."); defaults[value.name] = value.budget; } }
                        if (Object.keys(defaults).length !== data.budgetCount) throw new Error("A geração de orçamentos remotos está incompleta.");
                        callback({ version: 3, categories: values, theme: data.theme, budgets: { padrao: defaults, meses: {} }, revision: data.revision, updatedAt: Timestamp.now() }, manifest.metadata);
                    } catch (error) { failure?.(error); }
                };
                generationUnsubscribers.push(onSnapshot(generationCollection(db, uid, data.generation), (snapshot) => { categories = snapshot; publish(); }, failure));
            }, failure);
            return () => { clearGeneration(); legacyUnsubscribe(); manifestUnsubscribe(); };
        },
        listen(uid, callback, failure) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            return onSnapshot(collection(db, "users", uid, "records"), (snapshot) => callback(snapshot.docs.map((entry) => ({ ...entry.data(), _docId: entry.id, hasPendingWrites: entry.metadata.hasPendingWrites })), snapshot.metadata), failure);
        },
        async listConflicts(uid, { serverOnly = false } = {}) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const source = collection(db, "users", uid, "conflicts");
            const snap = serverOnly ? await getDocsFromServer(source) : await getDocs(source);
            return snap.docs.map((entry) => ({ ...entry.data(), _docId: entry.id }));
        },
        listenConflicts(uid, callback, failure) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            return onSnapshot(collection(db, "users", uid, "conflicts"), (snapshot) => callback(snapshot.docs.map((entry) => ({ ...entry.data(), _docId: entry.id })), snapshot.metadata), failure);
        },
        async resolveConflict(uid, operationId, resolution) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const target = doc(db, "users", uid, "conflicts", operationId);
            return runTransaction(db, async (tx) => {
                const snapshot = await tx.get(target);
                if (!snapshot.exists()) return false;
                if (snapshot.data().resolved === true) return true;
                tx.update(target, { resolved: true, resolution, resolvedAt: serverTimestamp() });
                return true;
            });
        },
        async commit(uid, op) {
            if (auth.currentUser?.uid !== uid) throw new Error("Conta não corresponde ao usuário autenticado.");
            const operationRef = doc(db, "users", uid, "operations", op.id);
            const recordRef = doc(db, "users", uid, "records", op.entityKey);
            return runTransaction(db, async (tx) => {
                const [prior, current] = await Promise.all([tx.get(operationRef), tx.get(recordRef)]);
                if (prior.exists()) return { acknowledged: true, duplicate: true };
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
