// Synthetic contract examples only. No encryption, storage access or real accounts.
const b64 = (length, byte) => Buffer.alloc(length, byte).toString('base64url');

export function documentFixture(uid = 'synthetic-A') {
    const suffix = uid === 'synthetic-A' ? 'a' : 'b';
    return {
        format: 'cf-vault-document', version: 1, algorithm: 'AES-256-GCM',
        keyId: `dek-synthetic-${suffix}-1`,
        owner: { projectId: 'demo-cf-vault', uid }, vaultId: `vault-synthetic-${suffix}`,
        documentId: `estado:${uid}`, schemaVersion: 1, revision: 7,
        generation: `generation-${suffix}`, iv: b64(12, suffix === 'a' ? 1 : 2),
        ciphertext: b64(48, 3)
    };
}

export function keyFixture(slot = 'password') {
    const doc = documentFixture();
    return {
        format: 'cf-vault-key', version: 1, slot, algorithm: doc.algorithm,
        keyId: doc.keyId, owner: doc.owner, vaultId: doc.vaultId, wrapRevision: 1,
        kdf: slot === 'password'
            ? { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: b64(16, 4) }
            : { name: 'HKDF', hash: 'SHA-256', salt: b64(16, 5), info: 'cf-vault-recovery/v1' },
        iv: b64(12, slot === 'password' ? 6 : 7), wrappedKey: b64(48, 8)
    };
}

export function preservationFixture() {
    const uid = 'synthetic-A';
    const state = { revisao: 7, dados: {
        registros: [
            { id: 'synthetic-income', tipo: 'entrada', valor: 1234.56, recebido: false },
            { id: 'synthetic-expense', tipo: 'despesa', valor: 42.17, pago: false }
        ], categorias: ['Categoria sintética'], orcamentos: { padrao: {}, meses: {} }
    } };
    const keys = [`restore-recovery:${uid}:before-generation-a`, `restore-recovery:${uid}:edit-one`];
    return {
        synthetic: true, owner: { projectId: 'demo-cf-vault', uid },
        // This graph is a preservation specimen, not an app backup/import fixture.
        documents: {
            [`estado:${uid}`]: state,
            [`fila:${uid}`]: {
                generation: 'generation-a', outbox: [
                    { id: 'synthetic-pending', attempted: true, baseRevision: 'remote-3', record: state.dados.registros[0] },
                    { id: 'synthetic-delete', tombstone: true, baseRevision: 'remote-2' }
                ], conflicts: [{ id: 'synthetic-conflict', local: 42.17, remote: 43.17 }],
                remoteRevisions: { 'synthetic-income': 'remote-3' },
                automaticHistory: [{ id: 'synthetic-history', uploaded: false }],
                automaticResolutions: [{ id: 'synthetic-resolution', confirmed: false }],
                pendingDecisions: [{ id: 'synthetic-decision', confirmed: false }],
                settingsPending: { categories: ['Categoria sintética'] },
                recoveryNotices: [{ id: keys[0], acknowledged: true }], recoveryKeys: [keys[0]],
                restoreJob: { generation: 'generation-a', baseGeneration: 'legacy', state: state.dados }
            },
            [keys[0]]: { state: state.dados, recoveryKeys: [keys[1]] },
            [keys[1]]: { base: state.dados, proposta: { ...state.dados, syntheticRejected: true } }
        }
    };
}

export const stateContract = {
    states: ['inexistente', 'bloqueado', 'desbloqueado', 'senha-incorreta', 'corrupcao', 'recuperacao-necessaria'],
    transitions: [
        ['inexistente', 'creation-verified', 'bloqueado'],
        ['bloqueado', 'authenticated-unlock', 'desbloqueado'],
        ['bloqueado', 'unlock-failed', 'senha-incorreta'],
        ['senha-incorreta', 'retry', 'bloqueado'],
        ['desbloqueado', 'logout', 'bloqueado'],
        ['desbloqueado', 'lock', 'bloqueado'],
        ['desbloqueado', 'authenticated-document-failed', 'corrupcao'],
        ['corrupcao', 'request-recovery', 'recuperacao-necessaria'],
        ['recuperacao-necessaria', 'recovery-verified', 'bloqueado']
    ]
};

export function migrationFixture(phase = 'inventariada') {
    return {
        version: 1, owner: { projectId: 'demo-cf-vault', uid: 'synthetic-A' },
        phase, sourceRevision: 7, observedSourceRevision: 7,
        expectedDocuments: 4, verifiedDocuments: phase === 'verificada' || phase === 'ativa' ? 4 : 0,
        sourceRetained: true, recoveryVerified: true, coordinatedTabs: true,
        destinationWritesAfterActivation: 0
    };
}
