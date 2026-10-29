import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { documentFixture, keyFixture, preservationFixture, stateContract, migrationFixture } from './fixtures/vault-contract.mjs';

// Test-only format oracle for a future implementation. This is NOT a cryptographic
// validator: structurally valid arbitrary ciphertext still cannot authenticate.
function exactKeys(value, keys) {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}
function text(value) {
    assert.equal(typeof value, 'string');
    assert.ok(value.length > 0 && value.isWellFormed());
}
function integer(value) { assert.ok(Number.isSafeInteger(value) && value >= 0); }
function bytes(value, length, minimum = false) {
    assert.equal(typeof value, 'string');
    assert.match(value, /^[A-Za-z0-9_-]+$/);
    const decoded = Buffer.from(value, 'base64url');
    assert.equal(decoded.toString('base64url'), value);
    assert.ok(minimum ? decoded.length >= length : decoded.length === length);
}
function identity(value, expected) {
    exactKeys(value.owner, ['projectId', 'uid']);
    for (const field of ['keyId', 'vaultId']) { text(value[field]); assert.equal(value[field], expected[field]); }
    for (const field of ['projectId', 'uid']) { text(value.owner[field]); assert.equal(value.owner[field], expected.owner[field]); }
    assert.equal(value.version, 1); assert.equal(value.algorithm, 'AES-256-GCM');
    bytes(value.iv, 12);
}
function documentContract(value, expected) {
    exactKeys(value, ['format', 'version', 'algorithm', 'keyId', 'owner', 'vaultId', 'documentId',
        'schemaVersion', 'revision', 'generation', 'iv', 'ciphertext']);
    assert.equal(value.format, 'cf-vault-document'); identity(value, expected);
    text(value.documentId); assert.equal(value.documentId, expected.documentId);
    assert.equal(value.schemaVersion, 1); integer(value.revision); text(value.generation);
    assert.equal(value.revision, expected.revision); assert.equal(value.generation, expected.generation);
    bytes(value.ciphertext, 16, true);
}
function documentAAD(value) {
    return JSON.stringify([value.format, value.version, value.algorithm, value.keyId,
        value.owner.projectId, value.owner.uid, value.vaultId, value.documentId,
        value.schemaVersion, value.revision, value.generation]);
}
function keyContract(value, expected) {
    exactKeys(value, ['format', 'version', 'slot', 'algorithm', 'keyId', 'owner', 'vaultId',
        'wrapRevision', 'kdf', 'iv', 'wrappedKey']);
    assert.equal(value.format, 'cf-vault-key'); identity(value, expected);
    integer(value.wrapRevision); bytes(value.wrappedKey, 48);
    assert.ok(['password', 'recovery'].includes(value.slot));
    const kdf = value.kdf;
    if (value.slot === 'password') {
        exactKeys(kdf, ['name', 'hash', 'iterations', 'salt']);
        assert.equal(kdf.name, 'PBKDF2'); integer(kdf.iterations);
        assert.ok(kdf.iterations >= 600000 && kdf.iterations <= 2000000);
    } else {
        exactKeys(kdf, ['name', 'hash', 'salt', 'info']);
        assert.equal(kdf.name, 'HKDF'); assert.equal(kdf.info, 'cf-vault-recovery/v1');
    }
    assert.equal(kdf.hash, 'SHA-256'); bytes(kdf.salt, 16);
}
function keyAAD(value) {
    return JSON.stringify([value.format, value.version, value.slot, value.algorithm, value.keyId,
        value.owner.projectId, value.owner.uid, value.vaultId, value.wrapRevision,
        value.kdf.name, value.kdf.hash, value.kdf.iterations ?? null, value.kdf.salt, value.kdf.info ?? null]);
}
function recoveryClosure(fixture) {
    const uid = fixture.owner.uid;
    const visited = new Set(), pending = [`estado:${uid}`, `fila:${uid}`];
    while (pending.length) {
        const key = pending.pop();
        if (visited.has(key)) continue;
        assert.ok(key === `estado:${uid}` || key === `fila:${uid}` || key.startsWith(`restore-recovery:${uid}:`));
        assert.ok(Object.hasOwn(fixture.documents, key), `Missing ${key}`);
        visited.add(key);
        pending.push(...(fixture.documents[key].recoveryKeys || []));
    }
    assert.deepEqual([...visited].sort(), Object.keys(fixture.documents).sort());
    return visited;
}

test('vault contract: synthetic v1 document has strict algorithm, identity and byte lengths', () => {
    const a = documentFixture(), b = documentFixture('synthetic-B');
    documentContract(a, a); documentContract(b, b);
    assert.notEqual(a.iv, b.iv); // Fixture distinction only; not a proof about RNG.
    for (const mutate of [v => { v.algorithm = 'AES-CBC'; }, v => { v.version = 2; },
        v => { v.iv = 'AA'; }, v => { v.iv += '='; }, v => { v.ciphertext = 'AA'; },
        v => { v.revision = -1; }, v => { v.revision = Number.MAX_SAFE_INTEGER + 1; },
        v => { v.documentId = '\ud800'; }, v => { v.plaintext = 'forbidden'; }]) {
        const bad = structuredClone(a); mutate(bad); assert.throws(() => documentContract(bad, a));
    }
});

test('vault contract: expected context rejects account/project/vault/document/key substitution', () => {
    const a = documentFixture();
    assert.throws(() => documentContract(documentFixture('synthetic-B'), a));
    for (const field of ['keyId', 'vaultId', 'documentId', 'revision', 'generation']) {
        const bad = structuredClone(a);
        bad[field] = field === 'revision' ? 8 : `${bad[field]}-other`;
        assert.throws(() => documentContract(bad, a));
    }
    for (const field of ['projectId', 'uid']) {
        const bad = structuredClone(a); bad.owner[field] += '-other';
        assert.throws(() => documentContract(bad, a));
    }
});

test('vault contract: AAD order is canonical and every semantic header changes it', () => {
    const a = documentFixture(), aad = documentAAD(a);
    assert.equal(aad, '["cf-vault-document",1,"AES-256-GCM","dek-synthetic-a-1","demo-cf-vault","synthetic-A","vault-synthetic-a","estado:synthetic-A",1,7,"generation-a"]');
    assert.equal(documentAAD(Object.fromEntries(Object.entries(a).reverse())), aad);
    for (const field of ['format', 'version', 'algorithm', 'keyId', 'vaultId', 'documentId', 'schemaVersion', 'revision', 'generation']) {
        const changed = structuredClone(a); changed[field] = String(changed[field]) + 'x';
        assert.notEqual(documentAAD(changed), aad);
    }
    for (const field of ['projectId', 'uid']) {
        const changed = structuredClone(a); changed.owner[field] += 'x'; assert.notEqual(documentAAD(changed), aad);
    }
});

test('vault contract: password and recovery wrap the same DEK through distinct versioned slots', () => {
    const password = keyFixture(), recovery = keyFixture('recovery'), expected = documentFixture();
    keyContract(password, expected); keyContract(recovery, expected);
    assert.equal(password.keyId, recovery.keyId);
    assert.notEqual(password.iv, recovery.iv); assert.notEqual(password.kdf.salt, recovery.kdf.salt);
    assert.equal(keyAAD(password), '["cf-vault-key",1,"password","AES-256-GCM","dek-synthetic-a-1","demo-cf-vault","synthetic-A","vault-synthetic-a",1,"PBKDF2","SHA-256",600000,"BAQEBAQEBAQEBAQEBAQEBA",null]');
    assert.notEqual(keyAAD(password), keyAAD(recovery));
    for (const mutate of [v => { v.kdf.iterations = 1; }, v => { v.kdf.iterations = 2000001; },
        v => { v.kdf.hash = 'SHA-1'; }, v => { v.kdf.salt = 'AA'; },
        v => { v.wrappedKey = 'AA'; }, v => { v.password = 'do not persist'; },
        v => { v.slot = 'browser-profile'; }, v => { v.owner.uid = 'synthetic-B'; }]) {
        const bad = structuredClone(password); mutate(bad); assert.throws(() => keyContract(bad, expected));
    }
    const bad = structuredClone(recovery); bad.kdf.info = 'another-domain';
    assert.throws(() => keyContract(bad, expected));
});

test('vault contract: recovery graph preserves pending, attempted, deleted and acknowledged history', () => {
    const graph = preservationFixture(), before = structuredClone(graph);
    assert.equal(recoveryClosure(graph).size, 4);
    assert.deepEqual(graph, before);
    const queue = graph.documents['fila:synthetic-A'];
    assert.equal(queue.outbox[0].attempted, true); assert.equal(queue.outbox[1].tombstone, true);
    assert.equal(queue.recoveryNotices[0].acknowledged, true);
    assert.ok(queue.conflicts.length && queue.pendingDecisions.length && queue.settingsPending);
    assert.equal(queue.automaticHistory[0].uploaded, false);
    assert.equal(queue.automaticResolutions[0].confirmed, false);
    assert.equal(queue.restoreJob.generation, queue.generation);
    const copy = JSON.parse(JSON.stringify(graph)); assert.deepEqual(copy, graph);
    delete copy.documents['restore-recovery:synthetic-A:edit-one'];
    assert.throws(() => recoveryClosure(copy));
    const cross = structuredClone(graph);
    cross.documents['fila:synthetic-A'].recoveryKeys.push('restore-recovery:synthetic-B:other');
    assert.throws(() => recoveryClosure(cross));
});

test('vault contract: locked/error states never grant financial access; recovery returns locked', () => {
    assert.deepEqual(stateContract.states, ['inexistente', 'bloqueado', 'desbloqueado', 'senha-incorreta', 'corrupcao', 'recuperacao-necessaria']);
    const transition = (state, event) => {
        const edge = stateContract.transitions.find(([from, action]) => from === state && action === event);
        assert.ok(edge, `Forbidden ${state}/${event}`); return edge[2];
    };
    for (const state of stateContract.states.filter(s => s !== 'desbloqueado')) {
        assert.throws(() => transition(state, 'read-financial-data'));
        assert.throws(() => transition(state, 'initialize-empty-on-error'));
    }
    assert.equal(transition('bloqueado', 'authenticated-unlock'), 'desbloqueado');
    assert.equal(transition('desbloqueado', 'logout'), 'bloqueado');
    assert.equal(transition('recuperacao-necessaria', 'recovery-verified'), 'bloqueado');
    assert.equal(transition('bloqueado', 'unlock-failed'), 'senha-incorreta');
});

test('vault contract: fixtures have no application imports or storage/network effects', async () => {
    const source = await readFile(new URL('./fixtures/vault-contract.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s|indexedDB|localStorage|sessionStorage|\bfetch\s*\(|subtle\./m);
    const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    assert.doesNotMatch(app, /vault-contract|cofre-local-etapa1/);
});

test('vault contract: activation requires stable, complete, coordinated migration and verified recovery', () => {
    // Acceptance oracle only; no migration/rollback is executed by this test.
    const mayActivate = m => m.version === 1 && m.phase === 'verificada'
        && m.sourceRevision === m.observedSourceRevision && m.expectedDocuments === m.verifiedDocuments
        && m.sourceRetained && m.recoveryVerified && m.coordinatedTabs;
    assert.equal(mayActivate(migrationFixture()), false);
    assert.equal(mayActivate(migrationFixture('copiada')), false);
    const verified = migrationFixture('verificada'); assert.equal(mayActivate(verified), true);
    for (const change of [{ observedSourceRevision: 8 }, { verifiedDocuments: 3 }, { sourceRetained: false },
        { recoveryVerified: false }, { coordinatedTabs: false }, { version: 2 }]) {
        assert.equal(mayActivate({ ...verified, ...change }), false);
    }
    const rollbackSource = m => ['inventariada', 'copiada', 'verificada'].includes(m.phase)
        && m.destinationWritesAfterActivation === 0 ? 'legacy-source' : 'compatible-vault-or-verified-backup';
    assert.equal(rollbackSource(migrationFixture('copiada')), 'legacy-source');
    const active = migrationFixture('ativa'); active.destinationWritesAfterActivation = 1;
    assert.equal(rollbackSource(active), 'compatible-vault-or-verified-backup');
});
