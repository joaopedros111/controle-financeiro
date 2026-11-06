import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountDataPolicy, ACCOUNT_ACCESS_KEY, assertAccountAccess, confirmedForRemoval, pendingFinancialData } from '../account-data-policy.js';
import { normalizarEstado } from '../finance-core.js';
const clone = structuredClone;
const userA = { uid: 'synthetic-account-A' }, userB = { uid: 'synthetic-account-B' };
const state = () => ({ revisao: 7, dados: normalizarEstado({ meses: {}, categorias: ['Casa'], orcamentos: { padrao: { Casa: 10 }, meses: {} } }) });
const queue = () => ({ outbox: [], conflicts: [], lastConfirmed: '2026-11-05T12:00:00.000Z', confirmedRevision: 7, confirmedGeneration: 'legacy' });
function fixture() {
    const docs = new Map([[`estado:${userA.uid}`, state()], [`fila:${userA.uid}`, queue()]]), calls = [];
    let serial = Promise.resolve();
    const db = {
        ler: async key => clone(docs.get(key) ?? null),
        alterar(key, fn) { const next = serial.then(() => { const v = fn(clone(docs.get(key) ?? null)); docs.set(key, clone(v)); return clone(v); }); serial = next.catch(() => {}); return next; },
        async removerContasConfirmadas(epoch, uid) { assert.equal(uid, userA.uid); calls.push('cleanup'); assert.equal(docs.get(ACCOUNT_ACCESS_KEY).epoch, epoch); return [{ uid: userA.uid, state: state().dados }]; }
    };
    const notices = [], policy = new AccountDataPolicy(db, { storage: { setItem() {}, getItem: () => null }, onHide: () => calls.push('hide'), onNotice: x => notices.push(x) });
    return { policy, db, docs, calls, notices };
}
async function ready() { const h = fixture(); await h.policy.initialize(); await h.policy.identify(userA); return h; }

test('account deletion requires exact revision, generation, valid data and no pending evidence', () => {
    assert.equal(confirmedForRemoval(state(), queue()), true);
    for (const patch of [ { confirmedRevision: 6 }, { confirmedGeneration: 'older' }, { lastConfirmed: null }, { outbox: [{ id: 'unacked' }] }, { conflicts: [{}] }, { recoveryKeys: ['only-copy'] }, { conflictHistory: [{}] }, { automaticSettingsDirty: true }, { migrationPending: true }, { restoreJob: {} }, { attempted: { op: true } }, { backupJobs: [{ status: 'pending' }] } ])
        assert.equal(confirmedForRemoval(state(), { ...queue(), ...patch }), false, JSON.stringify(patch));
    assert.equal(confirmedForRemoval({ ...state(), dados: { invalid: true } }, queue()), false);
    assert.equal(pendingFinancialData(null), true);
});
test('logout hides immediately, drains local saves, confirms, revokes, signs out, then cleans', async () => {
    const h = await ready();
    const result = await h.policy.logout({ uid: userA.uid, drainLocal: async () => h.calls.push('drain'), flush: async () => { h.calls.push('flush'); assert.equal(await h.policy.isCurrent(), true); }, signOut: async () => { h.calls.push('signOut'); assert.equal(await h.policy.isCurrent(), false); } });
    assert.deepEqual(h.calls, ['hide', 'drain', 'flush', 'hide', 'signOut', 'cleanup']);
    assert.equal(result.preserved, false); assert.equal(result.signedOut, true);
    await assert.rejects(h.policy.identify(userA), { code: 'account/access-revoked' });
});
test('offline logout signs out, preserves exact state and queue, and never calls cleanup', async () => {
    const h = await ready(), before = JSON.stringify([...h.docs].filter(([k]) => k.startsWith('estado:') || k.startsWith('fila:')));
    const result = await h.policy.logout({ uid: userA.uid, flush: async () => { throw Object.assign(new Error('offline'), { code: 'account/offline' }); }, signOut: async () => h.calls.push('signOut') });
    assert.equal(result.preserved, true); assert.equal(result.error, 'account/offline'); assert.ok(!h.calls.includes('cleanup'));
    assert.equal(JSON.stringify([...h.docs].filter(([k]) => k.startsWith('estado:') || k.startsWith('fila:'))), before);
});
test('missing ACK, conflicts and recovery references never authorize deletion', async () => {
    for (const patch of [{ outbox: [{ id: 'pending' }] }, { conflicts: [{}] }, { recoveryKeys: ['archive'] }, { confirmedRevision: 4 }]) {
        const h = await ready(); h.docs.set(`fila:${userA.uid}`, { ...queue(), ...patch });
        const result = await h.policy.logout({ uid: userA.uid, flush: async () => {}, signOut: async () => {} });
        assert.equal(result.confirmed, false); assert.equal(result.preserved, true); assert.ok(!h.calls.includes('cleanup'));
    }
});
test('signOut failure remains revoked after policy restart and does not delete anything', async () => {
    const h = await ready(); const result = await h.policy.logout({ uid: userA.uid, flush: async () => {}, signOut: async () => { throw new Error('SDK failed'); } });
    assert.equal(result.signedOut, false); assert.equal(result.preserved, true); assert.ok(!h.calls.includes('cleanup'));
    const restarted = new AccountDataPolicy(h.db, { storage: null }); await restarted.initialize();
    await assert.rejects(restarted.identify(userA), { code: 'account/access-revoked' });
});
test('logout takes precedence over a pending login and its delayed callback', async () => {
    const h = await ready(), ticket = h.policy.loginIntent();
    await h.policy.logout({ uid: userA.uid, flush: async () => {}, signOut: async () => {} });
    await assert.rejects(h.policy.acceptLogin(userA, ticket, () => true), { code: 'account/stale-login' });
    assert.equal(h.policy.access, null);
});
test('A-B-A requires explicit current login and obsolete accounts cannot regain authority', async () => {
    const h = await ready(), old = h.policy.access;
    await h.policy.acceptLogin(userB, h.policy.loginIntent(), () => true);
    assert.throws(() => assertAccountAccess(h.docs.get(ACCOUNT_ACCESS_KEY), old, [`estado:${userA.uid}`]), { code: 'account/access-revoked' });
    await assert.rejects(h.policy.identify(userA), { code: 'account/access-revoked' });
    await h.policy.acceptLogin(userA, h.policy.loginIntent(), () => true);
    assert.equal(h.policy.access.uid, userA.uid); assert.notEqual(h.policy.access.epoch, old.epoch);
});
test('duplicate identity does not advance durable epoch; cross-owner writes are rejected', async () => {
    const h = await ready(), epoch = h.policy.access.epoch; await h.policy.identify(userA);
    assert.equal(h.policy.access.epoch, epoch);
    assert.throws(() => assertAccountAccess(h.docs.get(ACCOUNT_ACCESS_KEY), h.policy.access, [`fila:${userB.uid}`]), { code: 'account/access-revoked' });
});
test('interrupted logout restarts revoked and keeps the financial pair intact', async () => {
    const h = await ready(); await h.db.alterar(ACCOUNT_ACCESS_KEY, c => ({ ...c, closing: true, closingToken: 'interrupted' }));
    await h.policy.initialize(); assert.equal(h.docs.get(ACCOUNT_ACCESS_KEY).uid, null);
    await assert.rejects(h.policy.identify(userA), { code: 'account/access-revoked' });
    assert.deepEqual(h.docs.get(`estado:${userA.uid}`), state());
});
test('quota or invalid control does not become an empty financial state', async () => {
    const h = await ready(), before = clone(h.docs.get(`estado:${userA.uid}`)); h.docs.set(ACCOUNT_ACCESS_KEY, { invalid: true });
    await assert.rejects(h.policy.initialize(), { code: 'account/invalid-control' }); assert.deepEqual(h.docs.get(`estado:${userA.uid}`), before);
});
