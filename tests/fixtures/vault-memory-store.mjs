// Serializable transactional model, not a substitute for browser IndexedDB QA.
import { VaultStoreError, storeError } from '../../finance-vault-store.js';
export function memoryVaultFactory() {
    const snapshots = new Map(), heads = new Map(), nonces = new Map(), counts = new Map(), catalogs = new Map(), controls = new Map();
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
        compareAndSwap: (scope, expected, next, isCurrent = () => true, coordination) => transaction(() => {
            try {
                if (JSON.stringify(snapshots.get(scope) ?? null) !== JSON.stringify(expected)) throw new VaultStoreError('stale-revision');
                if (!isCurrent()) throw new VaultStoreError('cancelled');
                if ((next.catalog || expected?.catalog) && !coordination) throw new VaultStoreError('cancelled');
                const old = coordination ? controls.get(coordination.logicalScope) : null;
                if (coordination && JSON.stringify(old ?? null) !== JSON.stringify(coordination.expected)) throw new VaultStoreError('cancelled');
                const tx = { abort() { throw new VaultStoreError('write-failed'); } };
                faults.beforePut?.(tx);
                const copy = structuredClone(next); // staged, not applied until all hooks pass
                faults.afterPut?.(tx);
                if (!isCurrent()) throw new VaultStoreError('cancelled');
                snapshots.set(scope, copy); heads.set(scope, { revision: copy.revision, generation: copy.generation });
                if (coordination) {
                    catalogs.set(coordination.logicalScope, structuredClone(coordination.locator));
                    const changed = expected?.catalog && (expected.catalog.password.wrappedKey !== copy.catalog.password.wrappedKey || expected.catalog.recovery.wrappedKey !== copy.catalog.recovery.wrappedKey);
                    controls.set(coordination.logicalScope, { version: 1, epoch: (old?.epoch || 0) + (old?.keyScope !== scope || old?.generation !== copy.generation || changed ? 1 : 0),
                        revision: copy.catalog.revision, keyScope: scope, generation: copy.generation });
                }
                return copy.revision;
            } catch (error) { throw storeError(error, 'write-failed'); }
        }),
        loadCatalog: logicalScope => transaction(() => {
            try {
                faults.afterRead?.(); const locator = catalogs.get(logicalScope), control = controls.get(logicalScope);
                if (!locator) {
                    if (control?.revision) throw new VaultStoreError('recovery-required');
                    if ([...heads.keys(), ...snapshots.keys()].some(key => JSON.stringify(JSON.parse(key).slice(0, 3)) === logicalScope)) throw new VaultStoreError('recovery-required');
                    return structuredClone({ locator: null, control: control ?? null });
                }
                if (!control || control.revision !== locator.catalog.revision || control.generation !== locator.catalog.generation) throw new VaultStoreError('corruption');
                const snapshot = snapshots.get(control.keyScope), head = heads.get(control.keyScope);
                if (!snapshot || !head || snapshot.revision !== head.revision || snapshot.generation !== head.generation || snapshot.revision !== locator.catalog.snapshotRevision
                    || JSON.stringify(snapshot.catalog) !== JSON.stringify(locator.catalog)) throw new VaultStoreError('corruption');
                return structuredClone({ locator, control });
            } catch (error) { throw storeError(error, 'read-failed'); }
        }),
        bumpEpoch: logicalScope => transaction(() => {
            const previous = controls.get(logicalScope) || { version: 1, epoch: 0, revision: 0, keyScope: null, generation: null };
            const next = { ...previous, epoch: previous.epoch + 1 }; controls.set(logicalScope, next); return structuredClone(next);
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
        inspect: async () => ({ snapshots: [...snapshots], heads: [...heads], nonces: [...nonces], nonceKeys: [...counts], catalogs: [...catalogs], controls: [...controls] }),
        mutateCatalog: async transform => { for (const [scope, entry] of catalogs) { const copy = structuredClone(entry); transform(copy); catalogs.set(scope, copy); } },
        mutate: async transform => {
            for (const [scope, snapshot] of snapshots) { const copy = structuredClone(snapshot); transform(copy); snapshots.set(scope, copy); }
        }
    };
}
