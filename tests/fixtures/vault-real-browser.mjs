export { createRealVaultAdapter } from '../../experimental/finance-vault-real-adapter.js';
export { abrirPersistenciaFinanceira } from '../../indexeddb-persistence.js';
export { openVaultStore } from '../../finance-vault-store.js';
export { browserStoreFactory } from './vault-browser-store.mjs';
export { adapterCases, owner, password, month, documents, income, connect, equal, ok } from './vault-real-scenarios.mjs';
export function httpClient() {
    const call = async (method, args) => {
        const response = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
        const value = await response.json(); if (!response.ok) throw Object.assign(new Error('Synthetic remote failure'), { code: value.code }); return value;
    };
    return { ...Object.fromEntries(['list', 'getSettings', 'listConflicts', 'commit', 'saveAutomaticHistory', 'resolveConflict', 'generationSnapshot', 'generationMarker', 'listAutomaticHistory'].map(k => [k, (...args) => call(k, args)])),
        saveSettings: (uid, value, base) => call('saveSettings', [uid, value, base]), protocolVersion: 2,
        listen: () => () => {}, listenSettings: () => () => {}, listenConflicts: () => () => {}, listenGeneration: () => () => {} };
}
