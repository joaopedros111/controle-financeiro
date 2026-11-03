import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { memoryMigrationSource } from './fixtures/vault-migration-scenarios.mjs';
import { writeCases } from './fixtures/vault-write-scenarios.mjs';
for (const scenario of writeCases({ makeStore: async () => memoryVaultFactory(), makeSource: async snapshot => memoryMigrationSource(snapshot, webcrypto), crypto: webcrypto })) {
    test(`synthetic vault writes: ${scenario.name}`, scenario.run);
}
