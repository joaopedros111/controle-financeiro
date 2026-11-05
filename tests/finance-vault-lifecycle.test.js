import test from 'node:test';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { lifecycleCases } from './fixtures/vault-lifecycle-cases.mjs';
for (const scenario of lifecycleCases({ makeStore: async () => memoryVaultFactory() })) test(scenario.name, scenario.run);
