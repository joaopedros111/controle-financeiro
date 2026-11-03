import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { integrationCases } from './fixtures/vault-integration-scenarios.mjs';

for (const scenario of integrationCases({ makeStore: async () => memoryVaultFactory(), crypto: webcrypto })) {
    test(`isolated vault integration: ${scenario.name}`, scenario.run);
}
