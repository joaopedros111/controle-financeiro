export { createSyntheticWriter } from '../../experimental/finance-vault-writes.js';
export { createSyntheticMigrator } from '../../experimental/finance-vault-migration.js';
export { openSyntheticMigrationSource, openSyntheticMigrationTarget, SYNTHETIC_SOURCE_PREFIX, SYNTHETIC_TARGET_PREFIX } from '../../experimental/finance-vault-migration-storage.js';
export { browserStoreFactory } from './vault-browser-store.mjs';
export { writeCases, writingSourceFixture, writeOwner, writePassword, writeMonth, writeIncome, writeEdit } from './vault-write-scenarios.mjs';
export function httpWriteRemote() {
    const call = async (action, owner, operation) => {
        const response = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, owner, operation }) });
        const value = await response.json(); if (!response.ok) throw Object.assign(new Error('Synthetic remote failure'), { code: value.code }); return value;
    };
    return { commit: (owner, op) => call('record', owner, op), commitSettings: (owner, op) => call('settings', owner, op) };
}
