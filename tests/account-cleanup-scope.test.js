import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistenciaFinanceira } from '../indexeddb-persistence.js';
import { ACCOUNT_ACCESS_KEY } from '../account-data-policy.js';
import { normalizarEstado } from '../finance-core.js';
const a = 'synthetic-cleanup-A', b = 'synthetic-cleanup-B';
function fixture({ pending = false, epoch = 8 } = {}) {
    const state = { revisao: 4, dados: normalizarEstado({ meses: {}, categorias: ['Synthetic'] }) };
    const queue = { outbox: [], conflicts: [], lastConfirmed: '2026-11-06T12:00:00Z', confirmedRevision: 4, confirmedGeneration: 'legacy' };
    const docs = new Map([[ACCOUNT_ACCESS_KEY, { version: 1, epoch, uid: null, closing: false, revoked: [a, b] }],
        ['estado:' + a, structuredClone(state)], ['fila:' + a, { ...structuredClone(queue), ...(pending ? { outbox: [{ id: 'unacked' }] } : {}) }],
        ['estado:' + b, structuredClone(state)], ['fila:' + b, structuredClone(queue)],
        ['restore-recovery:' + b + ':synthetic', { preserved: true }]]);
    // Transactional cursor model exercises the production cleanup selection.
    const db = new PersistenciaFinanceira({ transaction() {
        const tx = {}, keys = [...docs.keys()], deleted = []; let index = 0, aborted = false;
        tx.abort = () => { aborted = true; queueMicrotask(() => tx.onabort()); };
        const request = {};
        const advance = () => queueMicrotask(() => {
            if (aborted) return;
            const key = keys[index++];
            request.result = key === undefined ? null : { key, value: structuredClone(docs.get(key)), continue: advance };
            request.onsuccess();
            if (key === undefined && !aborted) { for (const k of deleted) docs.delete(k); tx.oncomplete(); }
        });
        tx.objectStore = () => ({ openCursor() { advance(); return request; }, delete(key) { deleted.push(key); } });
        return tx;
    } });
    return { db, docs };
}
for (const selected of [a, b]) test('cleanup removes only selected owner ' + selected, async () => {
    const h = fixture(), other = selected === a ? b : a;
    const original = structuredClone([...h.docs].filter(([k]) => k.includes(other)));
    assert.deepEqual((await h.db.removerContasConfirmadas(8, selected)).map(x => x.uid), [selected]);
    assert.equal(h.docs.has('estado:' + selected), false);
    assert.equal(h.docs.has('fila:' + selected), false);
    assert.deepEqual([...h.docs].filter(([k]) => k.includes(other)), original);
});
test('cleanup without explicit owner preserves every account', async () => {
    const h = fixture(), before = structuredClone([...h.docs]);
    assert.deepEqual(await h.db.removerContasConfirmadas(8), []); assert.deepEqual([...h.docs], before);
});
test('pending selected owner is retained even if another account is confirmed', async () => {
    const h = fixture({ pending: true }), before = structuredClone([...h.docs]);
    assert.deepEqual(await h.db.removerContasConfirmadas(8, a), []); assert.deepEqual([...h.docs], before);
});
test('changed session aborts cleanup without partial removal', async () => {
    const h = fixture({ epoch: 9 }), before = structuredClone([...h.docs]);
    await assert.rejects(h.db.removerContasConfirmadas(8, a), /Session changed/); assert.deepEqual([...h.docs], before);
});


test('pending journal discovery is read-only, owner scoped and includes prepared plans without queue references', async () => {
    const h = fixture(); h.docs.set('restore-recovery:' + a + ':migration-prepared', { state: 'prepared' });
    h.docs.set('restore-recovery:' + a + ':migration-done', { state: 'confirmed' }); h.docs.set('restore-recovery:' + b + ':migration-other', { state: 'applied' });
    const before = structuredClone([...h.docs]); assert.deepEqual(await h.db.listarImportacoesPendentes(a), ['restore-recovery:' + a + ':migration-prepared']); assert.deepEqual([...h.docs], before);
});
