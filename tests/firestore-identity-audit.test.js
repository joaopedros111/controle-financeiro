import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { auditFirestoreIdentityMetadata } from '../firestore-identity-audit.js';
import { recordEntityKey, inspectRemoteKeys, validSyncIdentity } from '../sync-core.js';
import { normalizarEstado } from '../finance-core.js';

const synthetic = (id = 'synthetic-id', patch = {}) => {
    const row = { uid: 'synthetic-owner', generation: 'legacy', month: '2026-11', type: 'receitas',
        id, recordId: id, deleted: false, revision: 'synthetic-revision', ...patch };
    return { ...row, documentId: patch.documentId ?? recordEntityKey(row) };
};
const ids = ['550e8400-e29b-41d4-a716-446655440000', 'm9abc123xyz', 'ação', 'com espaço', ' leading ',
    'a/b', 'a%2Fb', 'a.b_-', '#?&=+', '😀', 'e\u0301', 'é', 'a\nb', '\tvalid\t', 'a\u0000b', 'i'.repeat(128), '😀'.repeat(64)];

test('metadata-only audit accepts old/current string IDs without changing UTF-8 identity', () => {
    const rows = ids.map(id => synthetic(id));
    const before = structuredClone(rows), result = auditFirestoreIdentityMetadata(rows);
    assert.equal(result.eligible, true); assert.equal(result.counts.canonical, ids.length);
    assert.deepEqual(rows, before); assert.equal(result.counts.findings, 0);
});

test('actual historical Firebase key generators and current generator produce the same keys', () => {
    const root = new URL('../', import.meta.url);
    const sourceAt = (revision, filename) => {
        const result = spawnSync('git', ['show', `${revision}:${filename}`], { cwd: root, encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, 0, 'Local historical source must be available for compatibility evidence.');
        return result.stdout;
    };
    const first = sourceAt('b026a01', 'app.js').match(/function syncEntityKey\(entry\) \{[^\n]+\}/)?.[0];
    assert.ok(first, 'First Firebase integration must retain its historical key generator.');
    const firstGenerator = Function(`${first}; return syncEntityKey;`)();
    const currentReference = sourceAt('e0f6e2c54e92655432b0304ee35729f1d5a08769', 'sync-core.js')
        .match(/export function recordEntityKey\(entry\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(currentReference);
    const referenceGenerator = Function(`${currentReference.replace('export ', '')}; return recordEntityKey;`)();
    for (const id of ids) {
        const row = synthetic(id);
        assert.equal(firstGenerator(row), recordEntityKey(row));
        assert.equal(referenceGenerator(row), recordEntityKey(row));
        assert.equal(auditFirestoreIdentityMetadata([row]).eligible, true);
    }
});

test('separators, percent encoding, Unicode normalization and whitespace are never silently merged', () => {
    const rows = ['a/b', 'a%2Fb', 'é', 'e\u0301', ' id ', 'id'].map(id => synthetic(id));
    assert.equal(new Set(rows.map(row => row.documentId)).size, rows.length);
    assert.equal(auditFirestoreIdentityMetadata(rows).eligible, true);
});

test('aliases and uppercase keys are reported; canonical plus alias is a blocking logical duplicate', () => {
    const canonical = synthetic('synthetic-duplicate'), alias = { ...canonical, documentId: 'historical-alias' };
    const before = structuredClone([canonical, alias]);
    const result = auditFirestoreIdentityMetadata([canonical, alias]);
    assert.equal(result.eligible, false); assert.equal(result.counts.duplicateIdentities, 1);
    assert.deepEqual(result.findings.map(item => item.code), ['NONCANONICAL_DOCUMENT_KEY', 'DUPLICATE_IDENTITY']);
    assert.deepEqual([canonical, alias], before);
    const uppercase = auditFirestoreIdentityMetadata([{ ...canonical, documentId: canonical.documentId.toUpperCase() }]);
    assert.equal(uppercase.findings[0].code, 'UPPERCASE_DOCUMENT_KEY');
    const remote = [canonical, alias].map(row => ({ month: row.month, type: row.type, id: row.id, _docId: row.documentId }));
    assert.equal(inspectRemoteKeys(remote).duplicates.length, 1);
    assert.equal(inspectRemoteKeys(remote).mismatches.length, 1);
});

test('duplicate scans are distinct from duplicate entities and namespaces remain independent', () => {
    const row = synthetic(), repeat = auditFirestoreIdentityMetadata([row, { ...row }]);
    assert.equal(repeat.counts.duplicateDocuments, 1); assert.equal(repeat.counts.duplicateIdentities, 0);
    const separated = auditFirestoreIdentityMetadata([row, { ...row, uid: 'synthetic-other' },
        { ...row, generation: 'synthetic-previous' }, synthetic(row.id, { month: '2026-12' }), synthetic(row.id, { type: 'despesas' })]);
    assert.equal(separated.eligible, true); assert.equal(separated.counts.namespaces, 3);
});

test('internal record ID mismatch and tombstone payload identity cannot pass metadata inspection', () => {
    assert.equal(auditFirestoreIdentityMetadata([synthetic('a', { recordId: 'b' })]).findings[0].code, 'RECORD_ID_MISMATCH');
    const dead = synthetic('dead', { deleted: true }); delete dead.recordId;
    assert.equal(auditFirestoreIdentityMetadata([dead]).eligible, true);
    assert.equal(auditFirestoreIdentityMetadata([synthetic('dead', { deleted: true })]).findings[0].code, 'TOMBSTONE_HAS_RECORD_ID');
});

test('malformed, ambiguous and overlong identities are rejected without repairing source data', () => {
    for (const id of ['', ' ', '\u00a0', '\uFEFF', 'x'.repeat(129), '😀'.repeat(65), '\uD800', 123]) {
        const row = synthetic('valid', { id, recordId: id }), before = structuredClone(row);
        assert.equal(validSyncIdentity(id), false);
        assert.ok(auditFirestoreIdentityMetadata([row]).findings.some(item => item.code === 'INVALID_RECORD_IDENTITY'));
        assert.deepEqual(row, before);
    }
    for (const documentId of ['', '.', '..', 'a/b', '__reserved__', 'x'.repeat(1501)]) {
        assert.ok(auditFirestoreIdentityMetadata([synthetic('valid', { documentId })]).findings.some(item => item.code === 'INVALID_DOCUMENT_ID'));
    }
    assert.ok(auditFirestoreIdentityMetadata([synthetic('valid', { month: '2101-01' })]).findings.some(item => item.code === 'INVALID_RECORD_IDENTITY'));
});

test('old backups with missing or numeric IDs are normalized before transport; audit never migrates them', () => {
    const backup = { versao: 2, meses: { '2026-11': { receitas: [{ id: 7, nome: 'Synthetic only', valor: 1 }], despesas: [] } } };
    const before = structuredClone(backup);
    const state = normalizarEstado(backup, () => 'synthetic-normalized');
    assert.deepEqual(backup, before);
    const id = state.meses['2026-11'].receitas[0].id;
    assert.equal(id, 'synthetic-normalized'); assert.equal(auditFirestoreIdentityMetadata([synthetic(id)]).eligible, true);
});

test('financial fields are refused and reports never echo input identifiers, payloads or revisions', () => {
    for (const forbidden of ['record', 'nome', 'valor', 'categoria', 'categories', 'budgets', 'token']) {
        assert.throws(() => auditFirestoreIdentityMetadata([{ ...synthetic(), [forbidden]: 'SYNTHETIC_PRIVATE_SENTINEL' }]),
            error => error instanceof TypeError && !error.message.includes('SYNTHETIC_PRIVATE_SENTINEL'));
    }
    const row = synthetic('SYNTHETIC_PRIVATE_ID', { revision: 'SYNTHETIC_PRIVATE_REVISION', documentId: 'SYNTHETIC_PRIVATE_ALIAS' });
    const serialized = JSON.stringify(auditFirestoreIdentityMetadata([row]));
    assert.doesNotMatch(serialized, /SYNTHETIC_PRIVATE/);
    assert.ok(serialized.includes('NONCANONICAL_DOCUMENT_KEY'));
});

test('audit bounds findings and rows without silently classifying an incomplete report as eligible', () => {
    const rows = [synthetic('a', { documentId: 'alias-a' }), synthetic('b', { documentId: 'alias-b' })];
    const result = auditFirestoreIdentityMetadata(rows, { maxFindings: 1 });
    assert.equal(result.eligible, false); assert.equal(result.counts.findings, 2);
    assert.equal(result.findings.length, 1); assert.equal(result.findingsTruncated, true);
    assert.throws(() => auditFirestoreIdentityMetadata(rows, { maxRows: 1 }), TypeError);
    assert.throws(() => auditFirestoreIdentityMetadata(null), TypeError);
});
