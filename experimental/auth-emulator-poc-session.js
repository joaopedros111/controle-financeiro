// Shared, Auth-only experimental session. Never imported by the published app.
import { createVaultLifecycle } from './finance-vault-lifecycle.js';
export const AUTH_POC_PROJECT = 'demo-controle-financeiro';
export const AUTH_POC_ORIGIN = 'http://127.0.0.1:9099';
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

export function createAuthEmulatorPocSession({ auth, sdk, allowedUids, revocations, signOut = () => sdk.signOut(auth), beforeRemoteProof = async () => {}, createLifecycle = createVaultLifecycle }) {
    ensure(auth.app.options.projectId === AUTH_POC_PROJECT, 'Unexpected Auth project');
    ensure(auth.emulatorConfig?.host === '127.0.0.1' && auth.emulatorConfig.port === 9099, 'Explicit Auth Emulator required');
    ensure(allowedUids.length === 2 && allowedUids.every(uid => /^synthetic-[\w-]+$/.test(uid)), 'Synthetic identities required');
    let memory = null;
    const store = revocations || { read: () => memory, write: value => { memory = value; }, remove: () => { memory = null; } };
    function revoked() {
        const value = store.read();
        if (value === null) return false;
        ensure(value?.version === 1 && typeof value.revoked === 'boolean', 'Invalid PoC revocation record');
        return value.revoked;
    }
    const initiallyRevoked = revoked(), states = [];
    let adapterOpens = 0, generation = 0, mode = initiallyRevoked ? 'closed' : 'restoring', alive = true;
    let desiredUid = null, last = null, lastObserved = null, lastPacket = null, waiter = null;
    let sdkQueue = Promise.resolve(), localClose = Promise.resolve(), proofs = 0, validating = 0, ignoredClosed = 0;
    let sdkSignOutPending = false, initial = true;
    const firstEvent = deferred(); firstEvent.promise.catch(() => {});
    const lifecycle = createLifecycle({ revocationScope: 'owner-vault-all-tabs',
        openAdapter: async () => { adapterOpens++; throw new Error('Vault adapter forbidden'); },
        onState: state => states.push(state) });
    lifecycle.start();
    function invalidate(next, uid = null) {
        generation++; mode = next; desiredUid = uid; last = null;
        waiter?.resolve(false); waiter = null;
    }
    function valid(c) { return alive && store.read()?.epoch === c.epoch && c.generation === generation && mode === 'active' && auth.currentUser === c.user && c.user?.uid === desiredUid; }
    async function reconcile() {
        if (!alive) return;
        invalidate('restored');
        const request = generation;
        if (revoked()) { mode = 'closed'; sdkSignOutPending = !!auth.currentUser; await lifecycle.close('logout'); return; }
        sdkSignOutPending = false;
        await lifecycle.close('lock');
        if (!alive || request !== generation || revoked()) return;
        const user = auth.currentUser;
        if (user) { desiredUid = user.uid; await lifecycle.identify({ kind: 'unconfirmed', owner: identity(user) }); }
        else { mode = 'closed'; await lifecycle.close('logout'); }
    }
    function enqueue(work) { const task = sdkQueue.then(work); sdkQueue = task.catch(() => {}); return task; }
    function identity(user) {
        ensure(auth.app.options.projectId === AUTH_POC_PROJECT && allowedUids.includes(user.uid) && user.tenantId === null, 'Unexpected project, UID or tenant');
        return { projectId: AUTH_POC_PROJECT, uid: user.uid };
    }
    async function validate(c) {
        try {
            const owner = identity(c.user);
            await lifecycle.identify({ kind: 'unconfirmed', owner });
            if (!valid(c)) return false;
            validating++;
            let token;
            try {
                await beforeRemoteProof(); if (!valid(c)) return false;
                await sdk.reload(c.user); if (!valid(c)) return false;
                token = await sdk.getIdTokenResult(c.user, true);
            } finally { validating--; }
            if (!valid(c)) return false;
            identity(c.user);
            ensure(token.claims.aud === AUTH_POC_PROJECT && token.claims.sub === c.user.uid && token.claims.firebase?.tenant == null, 'Unexpected token identity');
            // Only a fresh proof for the current explicit intent clears revocation.
            store.write({ version: 1, revoked: false, epoch: c.epoch });
            await lifecycle.identify({ kind: 'confirmed', owner });
            if (!valid(c)) return false;
            proofs++; return true;
        } catch (error) {
            if (!valid(c)) return false;
            if (error.code === 'auth/network-request-failed') return false;
            throw error;
        }
    }
    function receive(packet) {
        if (!alive || packet.generation !== generation) return Promise.resolve(false);
        if (mode !== 'active') { if (packet.user) ignoredClosed++; return Promise.resolve(false); }
        if (!packet.user) {
            if (waiter) return Promise.resolve(false);
            invalidate('closed'); localClose = lifecycle.close('logout'); return localClose.then(() => false);
        }
        if (packet.user !== auth.currentUser || packet.user.uid !== desiredUid) return Promise.resolve(false);
        if (last?.generation === generation && last.user === packet.user) return last.work;
        const c = { generation, user: packet.user, epoch: store.read()?.epoch }, completion = waiter, work = validate(c);
        last = { ...c, work };
        work.then(value => completion?.resolve(value), () => completion?.resolve(false)); work.catch(() => {});
        return work;
    }
    async function login(uid, invalidToken = false) {
        ensure(!sdkSignOutPending, 'SDK signOut reconciliation required'); ensure(allowedUids.includes(uid), 'Synthetic identity required');
        if (!invalidToken && auth.currentUser?.uid === uid) return revalidate();
        invalidate('active', uid); const current = generation, completion = deferred(); waiter = completion;
        localClose = lifecycle.close('lock');
        return enqueue(async () => {
            await localClose; if (current !== generation) return false;
            try {
                await sdk.signInWithCustomToken(auth, invalidToken ? 'synthetic-invalid-token' : JSON.stringify({ uid }));
                if (current !== generation) return false;
                const result = await completion.promise;
                if (current === generation) waiter = null;
                if (last?.generation === current) await last.work;
                return result;
            } catch (error) {
                if (current !== generation) return false;
                waiter = null; mode = 'failed'; await lifecycle.identify({ kind: 'failed' });
                if (invalidToken && error.code === 'auth/invalid-custom-token') return false;
                throw error;
            }
        });
    }
    function logout() {
        invalidate('closed'); sdkSignOutPending = true; localClose = lifecycle.close('logout');
        try { store.write({ version: 1, revoked: true, epoch: crypto.randomUUID() }); } catch (error) { return Promise.reject(error); }
        return enqueue(async () => { await localClose; await signOut(); sdkSignOutPending = false; return true; });
    }
    function revalidate() {
        ensure(alive && !revoked() && lastObserved && auth.currentUser === lastObserved && !sdkSignOutPending, 'Revalidation forbidden for revoked/absent session');
        invalidate('active', lastObserved.uid); return receive({ generation, user: lastObserved });
    }
    const unsubscribe = sdk.onAuthStateChanged(auth, user => {
        if (!alive || user !== auth.currentUser) return;
        lastObserved = user; lastPacket = { generation, user };
        if (initial) {
            initial = false;
            const restoring = async () => {
                if (revoked() || mode === 'closed') { sdkSignOutPending = !!user; return; }
                if (user) { const owner = identity(user); mode = 'restored'; desiredUid = user.uid; await lifecycle.identify({ kind: 'unconfirmed', owner }); }
                else mode = 'closed';
            };
            restoring().then(firstEvent.resolve, firstEvent.reject); return;
        }
        if ((revoked() && mode !== 'active') || (mode !== 'active' && mode !== 'suspended') || (mode === 'active' && user && user.uid !== desiredUid)) {
            if (user && revoked()) ignoredClosed++;
            void reconcile().catch(firstEvent.reject);
        } else void receive(lastPacket);
    }, firstEvent.reject);
    return Object.freeze({
        lifecycle, states, ready: firstEvent.promise, login, logout, revalidate, receive, reconcile,
        get lastPacket() { return lastPacket; }, get localClosed() { return localClose; },
        get stats() { return { registrations: 1, adapterOpens, proofs, validating, ignoredClosed, revoked: revoked(), mode }; },
        suspend() { invalidate('suspended'); return lifecycle.suspend(); },
        async resume() { ensure(mode === 'suspended', 'Suspend required'); await lifecycle.resume(); mode = 'resumed'; },
        clearRevocationRecord() {
            ensure(mode === 'closed' && !auth.currentUser && !sdkSignOutPending, 'SDK logout required before PoC record cleanup');
            store.remove();
        },
        async dispose() {
            if (!alive) return;
            alive = false; invalidate('closed'); unsubscribe(); localClose = lifecycle.close('logout');
            firstEvent.resolve(false);
            await localClose; await sdkQueue;
            // Disposal/reload is NOT logout: preserve SDK persistence and marker.
        }
    });
}
