import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createVaultBackend } from '../finance-vault-backend.js';
import { createVaultController } from '../finance-vault-controller.js';
import { createFinancialCodec } from '../finance-vault-codec.js';
import { validateCatalog } from '../finance-vault-catalog.js';
import { exportRecoveryPackage } from '../finance-vault-recovery.js';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { auditOwner as owner, auditPassword as password, realFinancialFixture } from './fixtures/vault-independent-audit.mjs';

test('legacy catalog v1: the original 4,522,367-byte history package restores without a graph-wide codec budget', async () => {
    const storage = memoryVaultFactory(), codec = createFinancialCodec(), vaultId = 'synthetic-independent-audit';
    const context = { owner, vaultId, keyId: webcrypto.randomUUID() }, logicalScope = JSON.stringify([owner.projectId, owner.uid, vaultId]);
    const backend = createVaultBackend({ store: storage.store, context, codec, validateCatalog, crypto: webcrypto });
    const destination = memoryVaultFactory();
    const controller = createVaultController({ store: destination.store, owner, vaultId, crypto: webcrypto, channelFactory: () => null });
    try {
        await backend.createKey();
        const recovery = await backend.protectWithRecovery();
        let catalog = { format: 'cf-vault-catalog', version: 1, ...context, generation: 'legacy', revision: 1, snapshotRevision: 1,
            codec: codec.id, password: await backend.protectWithPassword(password), recovery: recovery.envelope, originPackageId: null };
        const base = realFinancialFixture(), queue = structuredClone(base[`fila:${owner.uid}`]);
        await backend.initialize({ generation: 'legacy', documents: base, catalog,
            coordination: { logicalScope, expected: null, locator: { version: 1, context, catalog } } });
        const state = { ...base[`estado:${owner.uid}`].dados, meses: { '2026-10': { receitas: Array.from({ length: 4000 }, (_, i) => ({
            id: `synthetic-history-${i}`, nome: 'Synthetic history income', valor: 1.25, recebido: false
        })), despesas: [] } } };
        for (let i = 0; i < 5; i++) {
            const id = `restore-recovery:${owner.uid}:synthetic-growth-${i}`; queue.recoveryKeys.push(id);
            const before = await storage.store.loadCatalog(logicalScope);
            catalog = { ...catalog, revision: i + 2, snapshotRevision: i + 2 };
            const token = await backend.prepare({ expectedRevision: i + 1, generation: 'legacy', catalog,
                updates: { [id]: { state, reason: 'synthetic-history-growth' }, [`fila:${owner.uid}`]: queue } });
            await backend.commit(token, { logicalScope, expected: before.control, locator: { version: 1, context, catalog } });
        }
        const bytes = await exportRecoveryPackage(backend, webcrypto);
        assert.equal(bytes.length, 4522367);
        await controller.importRecoveryPackage(bytes, { recoverySecret: recovery.recoverySecret, newPassword: password });
        assert.deepStrictEqual((await controller.read()).documents, (await backend.read()).documents);
    } finally { backend.close(); controller.close(); }
});
