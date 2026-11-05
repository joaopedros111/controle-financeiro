import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { migrationCases, memoryMigrationSource } from './fixtures/vault-migration-scenarios.mjs';
for (const scenario of migrationCases({ makeStore: async () => memoryVaultFactory(), makeSource: async () => memoryMigrationSource(undefined, webcrypto), crypto: webcrypto })) {
    test(`synthetic vault migration: ${scenario.name}`, scenario.run);
}
