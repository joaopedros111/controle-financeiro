import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { normalizarEstado, validarBackup } from '../finance-core.js';
import { makeOperation, recordEntityKey, registrosFinanceiros } from '../sync-core.js';
import { realContractClient } from './fixtures/vault-real-client.mjs';

const uid = 'synthetic-review-owner', owner = { uid, projectId: 'demo-local-review' };
function setup(t, discover = async () => ({ required: true, keys: ['estado:@local'], unavailable: [] })) {
    const financial = normalizarEstado({ meses: { '2026-11': { receitas: [{ id: 'synthetic-owned', nome: 'Conta preexistente', valor: 15 }], despesas: [] } } });
    const row = registrosFinanceiros(financial)[0], tracked = makeOperation(recordEntityKey(row), { ...row, deleted: false }, null);
    const docs = new Map([[`estado:${uid}`, { revisao: 2, dados: financial }], [`fila:${uid}`, { outbox: [tracked], conflicts: [], initialized: true }], ['estado:@local', { revisao: 8, dados: financial }], ['fila:@local', { outbox: [{ id: 'never-transfer' }], conflicts: [] }]]);
    let serial = Promise.resolve(); const writes = [];
    const db = { ler: async key => structuredClone(docs.get(key) ?? null), alterar(key, fn) { return this.alterarDocumentos([key], rows => { rows.set(key, fn(rows.get(key))); return rows; }).then(rows => rows.get(key)); },
        alterarDocumentos(keys, fn) {
            assert.ok(keys.every(key => key !== 'estado:@local' && key !== 'fila:@local'), 'no anonymous key may be included in an authorized UID write');
            const next = serial.then(() => { const rows = fn(new Map(keys.map(k => [k, structuredClone(docs.get(k) ?? null)]))); for (const [key, value] of rows) docs.set(key, structuredClone(value)); writes.push([...keys]); return rows; }); serial = next.catch(() => {}); return next;
        } };
    const service = new ServicoFinanceiroAtomico(db, validarBackup), remote = realContractClient(owner), calls = [];
    const client = { ...remote.client };
    for (const name of ['generationSnapshot','generationMarker','commit','saveSettings','publishRestore','saveAutomaticHistory']) { const fn = client[name]; if (fn) client[name] = (...args) => { calls.push(name); return fn(...args); }; }
    const sync = new AutomaticFinanceSync({ client, db, service, readLegacy: () => ({ estado: 'ausente' }), readLegacyMetadata: () => ({}), beforeAccountSync: discover,
        onAccount() {}, onState() {}, onStatus() {}, connectivity: { navigator: { onLine: true } } });
    t.after(() => sync.stop()); return { sync, docs, calls, writes, financial };
}

test('unresolved anonymous sources pause automatic sync before any network publication', async t => {
    const h = setup(t), before = JSON.stringify([h.docs.get('estado:@local'), h.docs.get('fila:@local')]);
    await h.sync.useAccount({ uid }); const s = h.sync.session;
    h.sync.request(0); h.sync.localChanged(); await h.sync.run(s);
    await assert.rejects(h.sync.cycle(s), { code: 'migration/review-required' });
    await assert.rejects(h.sync.flushForLogout(), { code: 'migration/review-required' });
    await assert.rejects(h.sync.importBackup(h.financial, () => true), { code: 'migration/review-required' });
    assert.equal(h.calls.length, 0); assert.equal(s.localMigration.pending, true);
    assert.equal(JSON.stringify([h.docs.get('estado:@local'), h.docs.get('fila:@local')]), before);
    assert.deepEqual(h.docs.get(`estado:${uid}`).dados, h.financial);
});
test('explicit keep-separate resumes only the Google account without importing anonymous outbox', async t => {
    const h = setup(t), before = JSON.stringify([h.docs.get('estado:@local'), h.docs.get('fila:@local')]); await h.sync.useAccount({ uid });
    const s = h.sync.session; await assert.rejects(h.sync.resumeAfterLocalReview(s, 'import'), { code: 'migration/review-required' });
    await h.sync.resumeAfterLocalReview(s, 'keep-separate'); clearTimeout(s.timer); await h.sync.cycle(s);
    assert.ok(h.calls.includes('generationSnapshot')); assert.equal(s.localMigration, null);
    assert.ok(!h.docs.get(`fila:${uid}`).outbox.some(op => op.id === 'never-transfer'));
    assert.equal(JSON.stringify([h.docs.get('estado:@local'), h.docs.get('fila:@local')]), before);
});
test('accounts with genuinely absent sources retain the normal automatic flow', async t => {
    const h = setup(t, async () => ({ required: false, keys: [], unavailable: [] })); await h.sync.useAccount({ uid }); clearTimeout(h.sync.session.timer);
    assert.equal(h.sync.session.localMigration, null); await h.sync.cycle(h.sync.session); assert.ok(h.calls.includes('generationSnapshot'));
});
test('logout and account replacement reject stale review consent without network calls', async t => {
    const h = setup(t); await h.sync.useAccount({ uid }); const old = h.sync.session; await h.sync.useAccount(null);
    await assert.rejects(h.sync.resumeAfterLocalReview(old, 'keep-separate'), { code: 'migration/review-required' }); assert.equal(h.calls.length, 0);
});
test('another tab changing account generation cannot be approved by an older review', async t => {
    const h = setup(t); await h.sync.useAccount({ uid }); h.docs.get(`fila:${uid}`).generation = 'synthetic-new-generation';
    await assert.rejects(h.sync.resumeAfterLocalReview(h.sync.session, 'keep-separate'), { code: 'sync/generation-changed' });
    assert.equal(h.calls.length, 0); assert.equal(h.sync.session.localMigration.pending, true);
});
test('discovery failure leaves the gate closed and preserves the existing Google state', async t => {
    const h = setup(t, async () => { throw new Error('Synthetic source failure'); });
    await assert.rejects(h.sync.useAccount({ uid }), /source failure/); await h.sync.run(h.sync.session);
    assert.equal(h.calls.length, 0); assert.deepEqual(h.docs.get(`estado:${uid}`).dados, h.financial);
});
test('late discovery from a previous owner cannot enable a new session', async t => {
    let release, entered; const arrived = new Promise(r => { entered = r; });
    const h = setup(t, () => { entered(); return new Promise(r => { release = r; }); });
    const pending = h.sync.useAccount({ uid }); await arrived; await h.sync.useAccount(null);
    release({ required: false, keys: [], unavailable: [] }); await pending;
    assert.equal(h.sync.session, null); assert.equal(h.calls.length, 0);
});
