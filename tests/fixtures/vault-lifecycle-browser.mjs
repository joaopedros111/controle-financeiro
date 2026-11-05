export * from './vault-lifecycle-cases.mjs';
export { browserStoreFactory } from './vault-browser-store.mjs';
export { openVaultStore } from '../../finance-vault-store.js';
export { createRealVaultAdapter } from '../../experimental/finance-vault-real-adapter.js';
export { createVaultLifecycle } from '../../experimental/finance-vault-lifecycle.js';
import { makeLifecycle, enroll, ownerA } from './vault-lifecycle-cases.mjs';
import { openVaultStore } from '../../finance-vault-store.js';
export async function attach(name, create = false) {
    if (!/^controleFinanceiro:cofre-isolado:v1:synthetic-lifecycle-[\w-]+$/.test(name)) throw new Error('Synthetic DB only');
    const storage = { reopen: () => openVaultStore({ databaseName: name }) };
    if (create) await enroll(await storage.reopen(), ownerA, crypto, navigator.locks);
    const controller = await makeLifecycle(storage, null, { crypto, locks: navigator.locks });
    const h = { controller, name, persisted: false, resumed: Promise.resolve() };
    addEventListener('pagehide', () => { h.resumed = controller.suspend(); h.resumed.catch(() => {}); });
    addEventListener('pageshow', event => { if (event.persisted) { h.persisted = true; h.resumed = controller.resume(); h.resumed.catch(() => {}); } });
    return h;
}
