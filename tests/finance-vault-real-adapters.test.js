import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { adapterCases } from './fixtures/vault-real-scenarios.mjs';
// useAccount reads this global in the real module. Dedicated test process only.
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
for (const scenario of adapterCases({ makeStore: async () => memoryVaultFactory(), crypto: webcrypto })) test(`real vault adapters: ${scenario.name}`, scenario.run);
