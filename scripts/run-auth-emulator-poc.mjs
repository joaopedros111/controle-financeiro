// Standalone Auth-only PoC. No application bootstrap or financial adapter.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuthEmulatorPocSession } from '../experimental/auth-emulator-poc-session.js';

const projectId = 'demo-controle-financeiro', origin = 'http://127.0.0.1:9099';
if (process.argv.length !== 2) throw new Error('No endpoint/project overrides allowed');
const config = JSON.parse((await readFile(new URL('../firebase.auth-emulator.poc.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
assert.equal(config.emulators?.auth?.host, '127.0.0.1');
assert.equal(config.emulators?.auth?.port, 9099);
const nativeFetch = globalThis.fetch;
const health = await nativeFetch(`${origin}/emulator/v1/projects/${projectId}/config`, { redirect: 'error', signal: AbortSignal.timeout(2500) });
assert.equal(health.status, 200, 'Auth Emulator unavailable; no SDK initialized');
console.log(JSON.stringify({ preflight: 'approved', projectId, origin, status: health.status }));

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function gate() { return { entered: deferred(), release: deferred() }; }
const faults = { offline: false, signOut: false, loginGate: null, validationGate: null };
let requests = 0, blocked = 0, app, auth, sdk, session;
const held = [];
// Installed BEFORE importing Auth: the Node SDK captures this fetch provider.
globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== origin || url.username || url.password) { blocked++; throw new Error('Non-emulator request refused'); }
    if (faults.offline) throw new TypeError('Synthetic offline transport');
    if (faults.loginGate && url.pathname.includes('accounts:signInWithCustomToken')) {
        const g = faults.loginGate; faults.loginGate = null; held.push(g); g.entered.resolve(); await g.release.promise;
    }
    if (session?.stats.validating && faults.validationGate && url.pathname.includes('accounts:lookup')) {
        const g = faults.validationGate; faults.validationGate = null; held.push(g); g.entered.resolve(); await g.release.promise;
    }
    requests++;
    return nativeFetch(input, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
};

const runId = crypto.randomUUID(), A = `synthetic-auth-poc-A-${runId}`, B = `synthetic-auth-poc-B-${runId}`;
const login = (...args) => session.login(...args), logout = () => session.logout();
const revalidate = () => session.revalidate(), receive = packet => session.receive(packet);
function locked(uid, ownership) {
    const s = session.lifecycle.state(); assert.equal(s.phase, 'locked'); assert.equal(s.owner.uid, uid);
    assert.equal(s.ownership, ownership); assert.equal(s.data, null);
}
let passed = 0, failed = 0;
async function scenario(name, work) {
    let timer;
    try {
        await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PoC scenario timeout')), 15000); })]);
        passed++; console.log(JSON.stringify({ scenario: name, result: 'approved' }));
    } catch (error) { failed++; console.error(JSON.stringify({ scenario: name, result: 'failed', error: error.code || error.message })); throw error; }
    finally { clearTimeout(timer); }
}
try {
    const appSDK = await import('firebase/app'); sdk = await import('firebase/auth');
    app = appSDK.initializeApp({ projectId, apiKey: 'demo-only-auth-poc', appId: 'synthetic-auth-only-poc' }, `synthetic-${runId}`);
    auth = sdk.initializeAuth(app, { persistence: sdk.inMemoryPersistence });
    sdk.connectAuthEmulator(auth, origin, { disableWarnings: true });
    assert.equal(auth.emulatorConfig.host, '127.0.0.1'); assert.equal(auth.emulatorConfig.port, 9099);
    session = createAuthEmulatorPocSession({ auth, sdk, allowedUids: [A, B], signOut: () => {
        if (faults.signOut) throw Object.assign(new Error('Synthetic signOut boundary failure'), { code: 'poc/signout-failed' });
        return sdk.signOut(auth);
    } });
    await session.ready;
    let delayedA;
    await scenario('login A: local event is unconfirmed until real remote proof', async () => {
        const g = gate(); faults.validationGate = g;
        const signingIn = login(A); await g.entered.promise;
        locked(A, 'unconfirmed'); assert.equal(session.stats.proofs, 0);
        g.release.resolve(); assert.equal(await signingIn, true); locked(A, 'confirmed'); delayedA = session.lastPacket;
    });
    await scenario('duplicate callback is idempotent', async () => {
        const n = session.states.length, reads = requests, verified = session.stats.proofs;
        await receive(delayedA); await receive(delayedA);
        assert.equal(session.states.length, n); assert.equal(requests, reads); assert.equal(session.stats.proofs, verified);
    });
    await scenario('A to B and delayed A callback', async () => {
        assert.equal(await login(B), true); locked(B, 'confirmed');
        assert.equal(await receive(delayedA), false); locked(B, 'confirmed');
    });
    await scenario('offline remote proof fails without confirming; explicit recovery', async () => {
        const verified = session.stats.proofs; faults.offline = true;
        assert.equal(await revalidate(), false); locked(B, 'unconfirmed'); assert.equal(session.stats.proofs, verified);
        faults.offline = false; assert.equal(await revalidate(), true); locked(B, 'confirmed');
    });
    await scenario('suspend and resume never auto-confirm or unlock', async () => {
        const verified = session.stats.proofs, old = session.lastPacket;
        await session.suspend(); assert.equal(session.lifecycle.state().phase, 'suspended');
        await session.resume(); locked(B, 'unconfirmed');
        assert.equal(await receive(old), false); assert.equal(session.stats.proofs, verified);
        assert.equal(await revalidate(), true);
    });
    await scenario('logout rejects old callbacks', async () => {
        const old = session.lastPacket, leaving = logout();
        assert.ok(['closing', 'signed-out'].includes(session.lifecycle.state().phase));
        assert.equal(await leaving, true); assert.equal(auth.currentUser, null);
        assert.equal(await receive(old), false); assert.equal(session.lifecycle.state().phase, 'signed-out'); assert.equal(session.lifecycle.state().owner, null);
    });
    await scenario('real Emulator authentication rejection', async () => {
        assert.equal(await login(A, true), false); assert.equal(session.lifecycle.state().phase, 'error');
        assert.equal(session.lifecycle.state().owner, null); await logout();
    });
    await scenario('logout during real SDK login held at transport', async () => {
        const g = gate(); faults.loginGate = g; const ignored = session.stats.ignoredClosed;
        const signingIn = login(A); await g.entered.promise;
        const leaving = logout(); await session.localClosed;
        assert.equal(session.lifecycle.state().phase, 'signed-out'); assert.equal(session.lifecycle.state().owner, null);
        g.release.resolve(); assert.equal(await signingIn, false); assert.equal(await leaving, true);
        assert.ok(session.stats.ignoredClosed > ignored); assert.equal(auth.currentUser, null); assert.equal(session.lifecycle.state().owner, null);
    });
    await scenario('signOut boundary failure cannot restore local identity', async () => {
        assert.equal(await login(A), true); const old = session.lastPacket;
        faults.signOut = true; await assert.rejects(logout(), { code: 'poc/signout-failed' });
        assert.equal(auth.currentUser.uid, A); assert.equal(session.lifecycle.state().phase, 'signed-out'); assert.equal(session.lifecycle.state().owner, null);
        assert.equal(await receive(old), false); await assert.rejects(login(B), /reconciliation required/);
        faults.signOut = false; assert.equal(await logout(), true); assert.equal(auth.currentUser, null);
    });
    await scenario('one Auth subscription; no financial authorization or external request', async () => {
        assert.equal(session.stats.registrations, 1); assert.equal(session.stats.adapterOpens, 0); assert.equal(blocked, 0);
        assert.ok(session.states.every(s => s.data === null && s.inFlight === 0 && !['ready', 'unlocking', 'operating'].includes(s.phase)));
        assert.ok(session.stats.proofs >= 2); assert.ok(requests > session.stats.proofs);
    });
} catch (error) {
    process.exitCode = 1;
    if (!failed) console.error(JSON.stringify({ setup: 'failed', error: error.code || error.message }));
} finally {
    faults.offline = faults.signOut = false;
    for (const g of held) g.release.resolve();
    faults.loginGate?.release.resolve(); faults.validationGate?.release.resolve();
    await session?.dispose();
    try { if (auth) await sdk.signOut(auth); } finally { if (app) await (await import('firebase/app')).deleteApp(app); }
    globalThis.fetch = nativeFetch;
    console.log(JSON.stringify({ passed, failed, notExecuted: 10 - passed - failed, registrations: session?.stats.registrations,
        adapterOpens: session?.stats.adapterOpens, remoteProofs: session?.stats.proofs, emulatorRequests: requests,
        nonEmulatorRequestsBlocked: blocked, storage: 'Auth inMemoryPersistence only', projectId }));
}
