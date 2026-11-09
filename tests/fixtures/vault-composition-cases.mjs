import { createVaultComposition } from '../../experimental/finance-vault-composition.js';
import { memoryVaultFactory } from './vault-memory-store.mjs';
import { realContractClient } from './vault-real-client.mjs';
export const password = 'synthetic-composition-password', accounts = ['synthetic-integrated-composition-A', 'synthetic-integrated-composition-B'];
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export async function setup() {
    const stores = new Map(), subscribers = new Set(), remotes = new Map(); let user = null, failAuth = false, hold = null, authGate = null;
    const config = { experimentalVault: true, projectId: 'demo-vault-integration', authEmulator: 'http://127.0.0.1:9099', firestoreEmulator: 'http://127.0.0.1:8080', databaseName: 'controleFinanceiro:cofre-isolado:v1:synthetic-integrated-composition-node', accounts };
    const notify = next => { user = next; for (const f of [...subscribers]) f(user); };
    const client = new Proxy({ ready: async () => user, onUser(fn) { subscribers.add(fn); queueMicrotask(() => { if (subscribers.has(fn)) fn(user); }); return () => subscribers.delete(fn); }, protocolVersion: 2 }, {
        get(target, key) { if (key === 'authenticatedUser') return () => user;
            if (key in target) return target[key]; if (typeof key === 'symbol') return;
            return (uid, ...args) => { if (uid !== user?.uid) throw new Error('Synthetic auth owner mismatch'); if (!remotes.has(uid)) remotes.set(uid, realContractClient({ projectId: config.projectId, uid })); return remotes.get(uid).client[key](uid, ...args); };
        }
    });
    const connectivity = { navigator: { onLine: false }, addEventListener() {}, removeEventListener() {} };
    const auth = { async login(uid) { const gate = authGate; authGate = null; if (gate) { gate.entered.resolve(); await gate.release.promise; }
        if (failAuth) throw Object.assign(new Error('Synthetic Auth offline'), { code: 'auth/network-request-failed' }); if (user?.uid !== uid) notify({ uid }); return user; }, async logout() { notify(null); } };
    const make = () => createVaultComposition({ config, client, auth, connectivity,
        makeStore: async name => { if (!stores.has(name)) stores.set(name, memoryVaultFactory()); const store = stores.get(name).store;
            return { ...store, async compareAndSwap(...args) { const gate = hold; if (gate) { hold = null; gate.entered.resolve(); await gate.release.promise; } return store.compareAndSwap(...args); } }; }
    });
    const c = make(); await c.start(); return { c, make, stores, client, connectivity, remotes, failAuth: value => { failAuth = value; },
        holdAuth() { authGate = { entered: deferred(), release: deferred() }; return authGate; }, holdWrite() { hold = { entered: deferred(), release: deferred() }; return hold; } };
}
export async function create(h, uid = accounts[0]) { await h.c.login(uid); const secret = await h.c.create(password); await h.c.confirm(secret, true, password); return secret; }
export const income = (c, id = 'synthetic-composition-income') => c.edit(s => s.meses['2026-11'].receitas.push({ id, nome: 'SYNTHETIC COMPOSITION INCOME', valor: 123.45, recebido: false }));
export const queue = async c => (await c.snapshot()).documents[`fila:${c.view().uid}`];
