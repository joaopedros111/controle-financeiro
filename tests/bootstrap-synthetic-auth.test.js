import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createVaultLifecycle } from '../experimental/finance-vault-lifecycle.js';

// Execute the same pure helper as the browser, without executing the DOM fixture.
const source = await readFile(new URL('./fixtures/app-injection-bootstrap.mjs', import.meta.url), 'utf8');
const start = source.indexOf('export function createSyntheticLifecycleAuth(');
const end = source.indexOf('// Synthetic test document', start);
assert.ok(start >= 0 && end > start);
const createAuth = vm.runInNewContext(`(${source.slice(start, end).replace('export ', '')})`);
const A = 'synthetic-injection-A', B = 'synthetic-injection-B';
async function setup({ flush = true } = {}) {
    const states = [], users = [], errors = []; let auth, initial, opens = 0, observers = 0, active = 0;
    const lifecycle = createVaultLifecycle({ revocationScope: 'owner-vault-all-tabs',
        openAdapter: async () => { opens++; throw new Error('Forbidden test adapter'); },
        onState: state => { states.push(state); auth?.onLifecycleState(state); } });
    lifecycle.start();
    auth = createAuth(lifecycle, callback => { observers++; active++; if (flush) queueMicrotask(callback); else initial = callback; return () => { active--; }; });
    const stop = auth.onUser(user => users.push(user?.uid || null), error => errors.push(error.code));
    const settle = async () => { await Promise.resolve(); await auth.settled(); };
    if (flush) await settle();
    return { auth, lifecycle, states, users, errors, stop, settle, deliverInitial: () => initial(), observers: () => observers, active: () => active,
        safe() { assert.equal(opens, 0); assert.ok(states.every(s => s.data === null && !['ready', 'unlocking', 'operating'].includes(s.phase))); } };
}
function owner(h, uid, ownership = 'confirmed') {
    const s = h.lifecycle.state(); assert.equal(s.phase, 'locked'); assert.equal(s.owner.uid, uid); assert.equal(s.ownership, ownership);
}

test('synthetic Auth forwards A, B, logout and failure through one subscription', async () => {
    const h = await setup(); assert.equal(h.lifecycle.state().phase, 'signed-out');
    await h.auth.switchAccount(A); owner(h, A);
    await h.auth.switchAccount(B); owner(h, B);
    await h.auth.switchAccount(null); assert.equal(h.lifecycle.state().phase, 'signed-out'); assert.equal(h.lifecycle.state().owner, null);
    await h.auth.failAuth(); assert.equal(h.lifecycle.state().phase, 'error'); assert.equal(h.lifecycle.state().error, 'lifecycle/auth-failed');
    assert.equal(h.lifecycle.state().owner, null); assert.deepEqual(h.errors, ['auth/synthetic-unavailable']);
    assert.deepEqual(h.users, [null, A, B, null]); assert.equal(h.observers(), 1); assert.equal(h.active(), 1); h.safe();
});

test('old initial callback and duplicate user delivery do not repeat identity transitions', async () => {
    const h = await setup({ flush: false }); await h.auth.switchAccount(A); h.deliverInitial(); await h.settle(); owner(h, A);
    assert.deepEqual(h.users, [A], 'old anonymous initialization cannot overwrite login');
    const duplicate = h.auth.duplicateCallback(), states = h.states.length;
    await duplicate(); await duplicate(); assert.equal(h.states.length, states); assert.deepEqual(h.users, [A]);
    await h.auth.switchAccount(null); assert.equal(await duplicate(), false);
    assert.equal(h.lifecycle.state().phase, 'signed-out'); assert.equal(h.lifecycle.state().owner, null); h.safe();
});

test('delayed callbacks after logout or newer identity and rapid A-B-A retain only the last intent', async () => {
    const h = await setup(); const delayed = h.auth.delayedCallback(A);
    await h.auth.switchAccount(null); assert.equal(await delayed(), false); assert.equal(h.lifecycle.state().owner, null);
    const oldB = h.auth.delayedCallback(B); await h.auth.switchAccount(A); assert.equal(await oldB(), false); owner(h, A);
    const outcomes = await Promise.all([h.auth.switchAccount(A), h.auth.switchAccount(B), h.auth.switchAccount(A)]);
    assert.equal(outcomes.at(-1), true); owner(h, A); assert.equal(h.observers(), 1); h.safe();
});

test('failure fences delayed login, duplicate error is idempotent and explicit fresh login recovers', async () => {
    const h = await setup(); const old = h.auth.delayedCallback(A);
    await h.auth.failAuth(); const duplicate = h.auth.duplicateCallback(), states = h.states.length;
    await duplicate(); assert.equal(h.states.length, states); assert.equal(h.errors.length, 1);
    assert.equal(await old(), false); assert.equal(h.lifecycle.state().phase, 'error'); assert.equal(h.lifecycle.state().owner, null);
    await h.auth.switchAccount(A); owner(h, A); h.safe();
});

test('direct suspension, unconfirmed resume and direct logout cannot be undone by queued Auth', async () => {
    const h = await setup(); await h.auth.switchAccount(B); const duplicate = h.auth.duplicateCallback();
    const delayed = h.auth.delayedCallback(A); await h.lifecycle.suspend(); assert.equal(h.lifecycle.state().phase, 'suspended');
    assert.equal(await delayed(), false); await h.lifecycle.resume(); owner(h, B, 'unconfirmed');
    assert.equal(await duplicate(), false); owner(h, B, 'unconfirmed');
    const later = h.auth.delayedCallback(A); await h.lifecycle.close('logout');
    assert.equal(await later(), false); assert.equal(h.lifecycle.state().phase, 'signed-out'); assert.equal(h.lifecycle.state().owner, null); h.safe();
});

test('unsubscribe invalidates old registration, rejects a second observer and allows clean resubscription', async () => {
    const h = await setup(); await h.auth.switchAccount(A); const old = h.auth.delayedCallback(B);
    assert.throws(() => h.auth.onUser(() => {}), /already registered/);
    h.stop(); h.stop(); await h.settle(); assert.equal(h.active(), 0); assert.equal(await old(), false);
    h.auth.onUser(user => h.users.push(user?.uid || null)); await h.settle();
    assert.equal(h.active(), 1); assert.equal(h.observers(), 2); assert.equal(h.lifecycle.state().phase, 'signed-out');
    assert.equal(await old(), false); assert.equal(await h.auth.ready(), null); h.safe();
});
