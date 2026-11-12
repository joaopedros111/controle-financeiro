import { recordEntityKey, unicodeWellFormed, validSyncIdentity } from './sync-core.js';

const fields = new Set(['uid', 'generation', 'documentId', 'month', 'type', 'id', 'recordId', 'deleted', 'revision']);
const monthValid = value => typeof value === 'string' && /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value);
const scopeValid = row => typeof row.uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.uid)
    && typeof row.generation === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.generation);
const documentIdValid = value => typeof value === 'string' && value.length > 0 && unicodeWellFormed(value)
    && new TextEncoder().encode(value).length <= 1500 && !value.includes('/') && !['.', '..'].includes(value)
    && !/^__.*__$/.test(value);

// Offline only: no Firebase SDK, network, credentials, logging, filesystem or writes.
// Input must already be a metadata-only projection, never a financial export.
// Output intentionally contains counts and input row positions, not identifiers.
export function auditFirestoreIdentityMetadata(rows, { maxRows = 200000, maxFindings = 1000 } = {}) {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || !Number.isSafeInteger(maxFindings) || maxFindings < 0
        || !Array.isArray(rows) || rows.length > maxRows) throw new TypeError('Invalid metadata audit input or limits.');
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)
            || Object.keys(row).some(key => !fields.has(key))) throw new TypeError('Metadata projection required; unsupported fields rejected.');
    }
    const counts = { documents: rows.length, canonical: 0, noncanonical: 0, invalid: 0,
        duplicateDocuments: 0, duplicateIdentities: 0, namespaces: 0, findings: 0 };
    const findings = [], documents = new Map(), identities = new Map(), namespaces = new Set();
    const report = (row, code, peerRow) => {
        counts.findings++;
        if (findings.length < maxFindings) findings.push({ row, code, ...(peerRow === undefined ? {} : { peerRow }) });
    };
    rows.forEach((row, index) => {
        const position = index + 1;
        const identityValid = monthValid(row.month) && ['receitas', 'despesas'].includes(row.type) && validSyncIdentity(row.id);
        const envelopeValid = typeof row.deleted === 'boolean' && typeof row.revision === 'string'
            && row.revision.length > 0 && row.revision.length <= 128 && unicodeWellFormed(row.revision);
        const validScope = scopeValid(row), validDocument = documentIdValid(row.documentId);
        if (!validScope) report(position, 'INVALID_SCOPE');
        if (!validDocument) report(position, 'INVALID_DOCUMENT_ID');
        if (!identityValid) report(position, 'INVALID_RECORD_IDENTITY');
        if (!envelopeValid) report(position, 'INVALID_ENVELOPE_METADATA');
        if (!row.deleted && row.recordId !== row.id) report(position, 'RECORD_ID_MISMATCH');
        if (row.deleted === true && row.recordId != null) report(position, 'TOMBSTONE_HAS_RECORD_ID');
        if (!validScope || !validDocument || !identityValid || !envelopeValid) counts.invalid++;
        if (!validScope) return;
        const scope = JSON.stringify([row.uid, row.generation]);
        namespaces.add(scope);
        if (validDocument) {
            const documentKey = JSON.stringify([scope, row.documentId]);
            const priorDocument = documents.get(documentKey);
            if (priorDocument !== undefined) { counts.duplicateDocuments++; report(position, 'DUPLICATE_DOCUMENT', priorDocument); }
            else documents.set(documentKey, position);
        }
        if (!identityValid) return;
        const canonical = recordEntityKey(row);
        if (row.documentId === canonical) counts.canonical++;
        else {
            counts.noncanonical++;
            report(position, row.documentId === canonical.toUpperCase() ? 'UPPERCASE_DOCUMENT_KEY' : 'NONCANONICAL_DOCUMENT_KEY');
        }
        const entityKey = JSON.stringify([scope, canonical]);
        const priorIdentity = identities.get(entityKey);
        if (priorIdentity && priorIdentity.documentId !== row.documentId) {
            counts.duplicateIdentities++; report(position, 'DUPLICATE_IDENTITY', priorIdentity.row);
        } else if (!priorIdentity) identities.set(entityKey, { row: position, documentId: row.documentId });
    });
    counts.namespaces = namespaces.size;
    return { version: 1, eligible: counts.findings === 0, counts, findings,
        findingsTruncated: counts.findings > findings.length };
}
