// Dedicated vault database. Never opens/deletes the application's financial DB.
export const VAULT_DATABASE = 'controleFinanceiro:cofre-isolado:v1';
const messages = {
    unavailable: 'Armazenamento do cofre indisponível.',
    'read-failed': 'Leitura do cofre não concluída.',
    'write-failed': 'Gravação do cofre não concluída.',
    'quota-exceeded': 'Espaço insuficiente no armazenamento do cofre.',
    'stale-revision': 'Revisão do cofre alterada por outra operação.',
    cancelled: 'Operação do cofre invalidada.',
    corruption: 'Estrutura persistida do cofre inconsistente.',
    'rotation-required': 'Limite de reservas atingido; rotação necessária.'
};
export class VaultStoreError extends Error {
    constructor(code) { super(messages[code] || messages.unavailable); this.name = 'VaultStoreError'; this.code = Object.hasOwn(messages, code) ? code : 'unavailable'; }
}
export const storeError = (error, fallback) => error instanceof VaultStoreError ? error
    : new VaultStoreError(error?.name === 'QuotaExceededError' ? 'quota-exceeded' : fallback);

export async function openVaultStore({ indexedDB = globalThis.indexedDB, databaseName = VAULT_DATABASE, testHooks = {} } = {}) {
    // A test may append a synthetic suffix, never select a legacy/application DB.
    if (typeof databaseName !== 'string' || !(databaseName === VAULT_DATABASE || databaseName.startsWith(`${VAULT_DATABASE}:synthetic-`))) throw new VaultStoreError('unavailable');
    if (!indexedDB) throw new VaultStoreError('unavailable');
    const db = await new Promise((resolve, reject) => {
        let abandoned = false;
        let request;
        try { request = indexedDB.open(databaseName, 1); }
        catch (error) { reject(storeError(error, 'unavailable')); return; }
        request.onupgradeneeded = () => {
            const database = request.result;
            database.createObjectStore('snapshots');
            database.createObjectStore('heads');
            database.createObjectStore('nonceKeys');
            database.createObjectStore('nonces').createIndex('byKey', 'keyFingerprint');
        };
        request.onblocked = () => { abandoned = true; reject(new VaultStoreError('unavailable')); };
        request.onerror = () => reject(storeError(request.error, 'unavailable'));
        request.onsuccess = () => abandoned ? request.result.close() : resolve(request.result);
    });
    db.onversionchange = () => db.close();
    function transaction(stores, mode, execute, fallback) {
        return new Promise((resolve, reject) => {
            let tx, result, cause;
            try {
                // Fail closed if strict durability is unsupported; never silently
                // weaken the reservation acknowledgement to relaxed durability.
                tx = db.transaction(stores, mode, { durability: 'strict' });
                tx.oncomplete = () => resolve(result);
                tx.onabort = () => reject(storeError(cause || tx.error, fallback));
                tx.onerror = () => { cause ||= tx.error; };
                if (mode === 'readwrite' && tx.durability !== 'strict') throw new VaultStoreError('unavailable');
                const guard = fn => (...args) => {
                    try { fn(...args); } catch (error) { cause = error; try { tx.abort(); } catch { /* Already aborted: onabort owns rejection. */ } }
                };
                execute(tx, value => { result = value; }, guard);
            } catch (error) {
                if (tx) { cause = error; try { tx.abort(); } catch { reject(storeError(error, fallback)); } }
                else reject(storeError(error, fallback));
            }
        });
    }
    return Object.freeze({
        close() { db.close(); },
        load(scope) {
            return transaction(['snapshots', 'heads'], 'readonly', (tx, done, guard) => {
                const request = tx.objectStore('snapshots').get(scope);
                const head = tx.objectStore('heads').get(scope);
                let remaining = 2;
                const ready = guard(() => {
                    if (--remaining) return;
                    const snapshot = request.result, saved = head.result;
                    if ((!snapshot !== !saved) || (snapshot && (saved.version !== 1 || saved.revision !== snapshot.revision || saved.generation !== snapshot.generation))) throw new VaultStoreError('corruption');
                    testHooks.afterRead?.(); done(snapshot ?? null);
                });
                request.onsuccess = ready; head.onsuccess = ready;
            }, 'read-failed');
        },
        compareAndSwap(scope, expected, next, isCurrent = () => true) {
            // Full byte-equivalent snapshot comparison catches same-revision
            // replacement/corruption occurring after the authenticated read.
            const baseline = JSON.stringify(expected), copy = structuredClone(next);
            return transaction(['snapshots', 'heads'], 'readwrite', (tx, done, guard) => {
                const store = tx.objectStore('snapshots'), request = store.get(scope);
                const heads = tx.objectStore('heads'), head = heads.get(scope);
                let remaining = 2;
                const ready = guard(() => {
                    if (--remaining) return;
                    if (!isCurrent()) throw new VaultStoreError('cancelled');
                    if (JSON.stringify(request.result ?? null) !== baseline) throw new VaultStoreError('stale-revision');
                    const saved = head.result;
                    if ((!request.result !== !saved) || (saved && (saved.version !== 1 || saved.revision !== request.result.revision || saved.generation !== request.result.generation))) throw new VaultStoreError('corruption');
                    if (copy.revision !== (request.result?.revision || 0) + 1) throw new VaultStoreError('stale-revision');
                    testHooks.beforePut?.(tx);
                    store.put(copy, scope);
                    heads.put({ version: 1, revision: copy.revision, generation: copy.generation }, scope);
                    testHooks.afterPut?.(tx);
                    if (!isCurrent()) throw new VaultStoreError('cancelled');
                    done(copy.revision);
                });
                request.onsuccess = ready; head.onsuccess = ready;
            }, 'write-failed');
        },
        reserveIV({ keyFingerprint, iv }) {
            if (!/^[A-Za-z0-9_-]{43}$/.test(keyFingerprint) || !/^[A-Za-z0-9_-]{16}$/.test(iv)) return Promise.reject(new VaultStoreError('corruption'));
            return transaction(['nonceKeys', 'nonces'], 'readwrite', (tx, done, guard) => {
                const keys = tx.objectStore('nonceKeys'), nonces = tx.objectStore('nonces');
                const ledger = keys.get(keyFingerprint), exists = nonces.get([keyFingerprint, iv]);
                const count = nonces.index('byKey').count(keyFingerprint);
                let remaining = 3;
                const ready = guard(() => {
                    if (--remaining) return;
                    const saved = ledger.result;
                    if ((saved && (saved.version !== 1 || !Number.isSafeInteger(saved.count) || saved.count < 0))
                        || (saved?.count || 0) !== count.result) throw new VaultStoreError('corruption');
                    if (exists.result) { done(false); return; }
                    if (count.result >= 1_000_000) throw new VaultStoreError('rotation-required');
                    nonces.add({ version: 1, keyFingerprint, iv }, [keyFingerprint, iv]);
                    keys.put({ version: 1, count: count.result + 1 }, keyFingerprint);
                    testHooks.afterReserve?.(tx);
                    done(true);
                });
                ledger.onsuccess = ready; exists.onsuccess = ready; count.onsuccess = ready;
            }, 'write-failed');
        }
    });
}
