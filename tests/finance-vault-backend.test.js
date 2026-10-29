import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { backendCases } from './fixtures/vault-backend-scenarios.mjs';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { openVaultStore, VAULT_DATABASE } from '../finance-vault-store.js';

for (const scenario of backendCases({ makeStore: async () => memoryVaultFactory(), crypto: webcrypto })) {
    test(`vault backend model: ${scenario.name}`, scenario.run);
}
test('vault backend: dedicated database cannot be redirected to application or SDK databases', async () => {
    assert.notEqual(VAULT_DATABASE, 'controleFinanceiro:integridade:v1');
    for (const databaseName of ['controleFinanceiro:integridade:v1', 'firestore/test', '', 'other']) {
        await assert.rejects(openVaultStore({ databaseName }), { code: 'unavailable' });
    }
    await assert.rejects(openVaultStore({ indexedDB: null }), { code: 'unavailable' });
});
test('vault backend: no application integration, destructive DB operations or network access', async () => {
    for (const file of ['finance-vault-store.js', 'finance-vault-backend.js']) {
        const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /deleteDatabase|\.clear\(|\bstore\.delete\(|\bfetch\(|\bconsole\.|firebase\/|localStorage|sessionStorage/);
    }
    for (const file of ['app.js', 'sw.js', 'indexeddb-persistence.js', 'firebase-sync-entry.js']) {
        assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /finance-vault-(backend|store|crypto)/);
    }
});
