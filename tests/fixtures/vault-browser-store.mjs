import { openVaultStore, VAULT_DATABASE } from '../../finance-vault-store.js';

// All mutation/inspection helpers are exclusive to fresh synthetic QA databases.
export function browserStoreFactory() {
    const connections = [], names = [];
    async function makeStore() {
        const name = `${VAULT_DATABASE}:synthetic-${crypto.randomUUID()}`;
        names.push(name);
        let faults = {};
        const hooks = Object.fromEntries(['beforePut', 'afterPut', 'afterRead', 'afterReserve'].map(key => [key, (...args) => faults[key]?.(...args)]));
        const reopen = async () => {
            const store = await openVaultStore({ databaseName: name, testHooks: hooks }); connections.push(store); return store;
        };
        const store = await reopen();
        function raw(mode, stores, action) {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(name, 1);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result, tx = db.transaction(stores, mode, { durability: 'strict' });
                    let result, cause;
                    tx.oncomplete = () => { db.close(); resolve(result); };
                    tx.onabort = () => { db.close(); reject(cause || tx.error); };
                    tx.onerror = () => { cause ||= tx.error; };
                    try { action(tx, value => { result = value; }); }
                    catch (error) { cause = error; tx.abort(); }
                };
            });
        }
        return {
            store, reopen, setFaults(value) { faults = value; },
            inspect: () => raw('readonly', ['snapshots', 'heads', 'nonces', 'nonceKeys'], (tx, done) => {
                const output = {};
                for (const name of ['snapshots', 'heads', 'nonces', 'nonceKeys']) {
                    const store = tx.objectStore(name), values = store.getAll(), keys = store.getAllKeys();
                    let remaining = 2;
                    const ready = () => { if (!--remaining) { output[name] = keys.result.map((key, i) => [key, values.result[i]]); done(output); } };
                    values.onsuccess = ready; keys.onsuccess = ready;
                }
            }),
            mutate: transform => raw('readwrite', ['snapshots'], tx => {
                const cursor = tx.objectStore('snapshots').openCursor();
                cursor.onsuccess = () => {
                    if (!cursor.result) return;
                    const value = cursor.result.value; transform(value); cursor.result.update(value); cursor.result.continue();
                };
            })
        };
    }
    return { makeStore, names, close() { for (const store of connections) store.close(); } };
}
