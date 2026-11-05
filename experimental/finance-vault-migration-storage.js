// Capabilities for synthetic migration only; never opens the financial database.
import { openVaultStore, VAULT_DATABASE } from '../finance-vault-store.js';
export const SYNTHETIC_SOURCE_PREFIX = 'controleFinanceiro:migration-source:synthetic-';
export const SYNTHETIC_TARGET_PREFIX = `${VAULT_DATABASE}:synthetic-migration-`;
const sources = new WeakSet(), targets = new WeakSet();
const reject = code => { throw Object.assign(new Error('Synthetic migration storage unavailable.'), { code }); };
export function syntheticSourceCapability({ id, read }) {
    if (typeof id !== 'string' || !id.startsWith(SYNTHETIC_SOURCE_PREFIX) || typeof read !== 'function') reject('synthetic-only');
    const source = Object.freeze({ id, read }); sources.add(source); return source;
}
export function syntheticTargetCapability({ id, store }) {
    if (typeof id !== 'string' || !id.startsWith(SYNTHETIC_TARGET_PREFIX) || !['loadCatalog', 'load', 'compareAndSwap', 'reserveIV'].every(k => typeof store?.[k] === 'function')) reject('synthetic-only');
    const target = Object.freeze({ id, store }); targets.add(target); return target;
}
export function requireMigrationCapabilities(source, target) {
    if (!sources.has(source) || !targets.has(target) || source.id === target.id) reject('synthetic-only');
}
export async function openSyntheticMigrationTarget({ databaseName, testHooks }) {
    if (typeof databaseName !== 'string' || !databaseName.startsWith(SYNTHETIC_TARGET_PREFIX)) reject('synthetic-only');
    return syntheticTargetCapability({ id: databaseName, store: await openVaultStore({ databaseName, testHooks }) });
}
export async function openSyntheticMigrationSource({ databaseName, initialSnapshot, indexedDB = globalThis.indexedDB }) {
    if (typeof databaseName !== 'string' || !databaseName.startsWith(SYNTHETIC_SOURCE_PREFIX) || !indexedDB) reject('synthetic-only');
    let fresh = false, abandoned = false;
    const db = await new Promise((resolve, fail) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
            if (initialSnapshot === undefined) { request.transaction.abort(); return; }
            fresh = true; request.result.createObjectStore('synthetic-origin');
        };
        request.onblocked = () => { abandoned = true; fail(Object.assign(new Error('Synthetic source blocked.'), { code: 'source-unavailable' })); };
        request.onerror = () => fail(Object.assign(new Error('Synthetic source unavailable.'), { code: initialSnapshot === undefined ? 'source-missing' : 'source-unavailable' }));
        request.onsuccess = () => abandoned ? request.result.close() : resolve(request.result);
    });
    db.onversionchange = () => db.close();
    function transaction(mode, action) {
        return new Promise((resolve, fail) => {
            let result, cause, tx;
            try {
                tx = db.transaction('synthetic-origin', mode, { durability: 'strict' });
                tx.oncomplete = () => resolve(result);
                tx.onabort = () => fail(Object.assign(new Error('Synthetic source transaction failed.'), { code: 'source-unavailable' }));
                tx.onerror = () => { cause = tx.error; };
                if (mode === 'readwrite' && tx.durability !== 'strict') throw new Error('Strict durability required');
                action(tx.objectStore('synthetic-origin'), value => { result = value; }, fn => (...args) => { try { fn(...args); } catch (e) { cause = e; tx.abort(); } });
            } catch (error) { cause = error; if (tx) tx.abort(); else fail(Object.assign(new Error('Synthetic source unavailable.'), { code: 'source-unavailable' })); }
            void cause; // Provider messages/values are intentionally never exposed.
        });
    }
    try {
        if (initialSnapshot !== undefined) {
            if (!fresh) reject('source-already-exists');
            await transaction('readwrite', (store, done) => { store.add(structuredClone(initialSnapshot), 'origin'); done(); });
        }
    } catch (error) { db.close(); throw error; }
    const read = () => transaction('readonly', (store, done, guard) => { const req = store.get('origin'); req.onsuccess = guard(() => { if (!req.result) reject('source-missing'); done(req.result); }); });
    return {
        source: syntheticSourceCapability({ id: databaseName, read }), read, close: () => db.close(),
        // Deliberately separate test writer. The migrator receives ONLY source.read.
        editForTest: mutate => transaction('readwrite', (store, done, guard) => {
            const req = store.get('origin'); req.onsuccess = guard(() => {
                if (!req.result || !Number.isSafeInteger(req.result.revision + 1)) reject('source-invalid');
                const value = req.result, revision = value.revision + 1; mutate(value); value.revision = revision;
                store.put(value, 'origin'); done();
            });
        })
    };
}
