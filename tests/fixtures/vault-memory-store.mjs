// Serializable transactional model, not a substitute for browser IndexedDB QA.
import { VaultStoreError, storeError } from '../../finance-vault-store.js';
export function memoryVaultFactory() {
    const snapshots = new Map(), heads = new Map(), nonces = new Map(), counts = new Map();
    let previous = Promise.resolve(), faults = {};
    function transaction(fn) {
        const result = previous.then(fn); previous = result.catch(() => {}); return result;
    }
    const store = {
        close() {},
        load: scope => transaction(() => {
            try {
                faults.afterRead?.();
                const snapshot = snapshots.get(scope), head = heads.get(scope);
                if ((!snapshot !== !head) || (head && (head.revision !== snapshot.revision || head.generation !== snapshot.generation))) throw new VaultStoreError('corruption');
                return structuredClone(snapshot ?? null);
            } catch (error) { throw storeError(error, 'read-failed'); }
        }),
        compareAndSwap: (scope, expected, next, isCurrent = () => true) => transaction(() => {
            try {
                if (JSON.stringify(snapshots.get(scope) ?? null) !== JSON.stringify(expected)) throw new VaultStoreError('stale-revision');
                if (!isCurrent()) throw new VaultStoreError('cancelled');
                const tx = { abort() { throw new VaultStoreError('write-failed'); } };
                faults.beforePut?.(tx);
                const copy = structuredClone(next); // staged, not applied until all hooks pass
                faults.afterPut?.(tx);
                if (!isCurrent()) throw new VaultStoreError('cancelled');
                snapshots.set(scope, copy); heads.set(scope, { revision: copy.revision, generation: copy.generation });
                return copy.revision;
            } catch (error) { throw storeError(error, 'write-failed'); }
        }),
        reserveIV: ({ keyFingerprint, iv }) => transaction(() => {
            try {
                const id = JSON.stringify([keyFingerprint, iv]);
                if (nonces.has(id)) return false;
                if ((counts.get(keyFingerprint) || 0) >= 1_000_000) throw new VaultStoreError('rotation-required');
                faults.afterReserve?.({ abort() { throw new VaultStoreError('write-failed'); } });
                nonces.set(id, { version: 1, keyFingerprint, iv });
                counts.set(keyFingerprint, (counts.get(keyFingerprint) || 0) + 1); return true;
            } catch (error) { throw storeError(error, 'write-failed'); }
        })
    };
    return {
        store, reopen: async () => store, setFaults(value) { faults = value; },
        inspect: async () => ({ snapshots: [...snapshots], heads: [...heads], nonces: [...nonces], nonceKeys: [...counts] }),
        mutate: async transform => {
            for (const [scope, snapshot] of snapshots) { const copy = structuredClone(snapshot); transform(copy); snapshots.set(scope, copy); }
        }
    };
}
