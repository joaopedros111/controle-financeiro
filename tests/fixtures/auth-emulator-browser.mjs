import { initializeApp, deleteApp } from 'firebase/app';
import * as authSDK from 'firebase/auth';
import { createAuthEmulatorPocSession, AUTH_POC_PROJECT, AUTH_POC_ORIGIN } from '../../experimental/auth-emulator-poc-session.js';
const config = globalThis.authPocConfiguration;
if (location.hostname !== '127.0.0.1' || config?.projectId !== AUTH_POC_PROJECT || !/^[a-f0-9-]{36}$/.test(config.run)) throw new Error('Explicit isolated PoC required');
const allowedUids = ['A', 'B'].map(name => `synthetic-auth-browser-${name}-${config.run}`);
const markerKey = `__cf_auth_emulator_poc_revocation_v1__:${AUTH_POC_PROJECT}:${config.run}`;
const app = initializeApp({ projectId: AUTH_POC_PROJECT, apiKey: 'demo-only-auth-poc', appId: 'synthetic-auth-only-browser' }, `synthetic-auth-${config.run}`);
const auth = authSDK.initializeAuth(app, { persistence: authSDK.browserLocalPersistence });
authSDK.connectAuthEmulator(auth, AUTH_POC_ORIGIN, { disableWarnings: true });
let observers = 0, failSignOut = false, hold = null, held = false, saved = null;
const revocations = {
    read() { const raw = localStorage.getItem(markerKey); return raw === null ? null : JSON.parse(raw); },
    write(value) { const raw = JSON.stringify(value); localStorage.setItem(markerKey, raw); if (localStorage.getItem(markerKey) !== raw) throw new Error('PoC revocation not durable'); },
    remove() { localStorage.removeItem(markerKey); if (localStorage.getItem(markerKey) !== null) throw new Error('PoC record cleanup failed'); }
};
const session = createAuthEmulatorPocSession({ auth, allowedUids, revocations,
    sdk: { ...authSDK, onAuthStateChanged(...args) { observers++; return authSDK.onAuthStateChanged(...args); } },
    signOut: () => { if (failSignOut) throw Object.assign(new Error('Synthetic signOut failure'), { code: 'poc/signout-failed' }); return authSDK.signOut(auth); },
    beforeRemoteProof: async () => { if (hold) { const pending = hold; held = true; await pending.promise; hold = null; held = false; } }
});
await session.ready;
const pageEvents = [];
let pageTransition = Promise.resolve();
addEventListener('storage', event => {
    if (event.key === markerKey) pageTransition = session.reconcile();
});
addEventListener('pagehide', event => {
    pageEvents.push({ type: 'pagehide', persisted: event.persisted });
    pageTransition = event.persisted ? session.suspend() : session.dispose();
});
addEventListener('pageshow', event => {
    pageEvents.push({ type: 'pageshow', persisted: event.persisted });
    if (event.persisted) pageTransition = pageTransition.then(() => session.reconcile());
});
globalThis.authPoc = Object.freeze({
    ready: true, login: name => session.login(allowedUids[['A', 'B'].indexOf(name)]), logout: () => session.logout(),
    revalidate: () => session.revalidate(), suspend: () => session.suspend(), resume: () => session.resume(),
    failSignOut(value) { failSignOut = value; },
    holdProof() { let release; const promise = new Promise(r => { release = r; }); hold = { promise, release }; },
    proofHeld: () => held, releaseProof() { hold?.release(); },
    captureCallback() { saved = session.lastPacket; }, replayCallback: () => session.receive(saved),
    async snapshot() {
        return { state: session.lifecycle.state(), stats: session.stats, sdkUid: auth.currentUser?.uid || null,
            observers, pageEvents, marker: revocations.read(), markerKey, localKeys: Object.keys(localStorage).sort(),
            databases: (await indexedDB.databases()).map(d => d.name),
            safe: session.states.every(s => s.data === null && s.inFlight === 0 && !['ready', 'unlocking', 'operating'].includes(s.phase)) };
    },
    clearMarker() { session.clearRevocationRecord(); },
    async close() { hold?.release(); await session.dispose(); await deleteApp(app); }
});
