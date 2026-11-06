import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountDataPolicy, ACCOUNT_ACCESS_KEY, assertAccountAccess } from '../account-data-policy.js';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { normalizarEstado, validarBackup } from '../finance-core.js';
import { migrarFonteDaConta } from '../account-local-migration.js';
import { chaveLocalConta, makeOperation, recordEntityKey } from '../sync-core.js';
const a = { uid: 'synthetic-local-A' }, b = { uid: 'synthetic-local-B' }, pin = '8347291056', month = '2026-11';
function fixture() {
    const state = normalizarEstado({ meses: { [month]: { receitas: [{ id: 'synthetic-r', nome: 'Synthetic income', valor: 12, recebido: false }], despesas: [{ id: 'synthetic-d', nome: 'Synthetic expense', valor: 2, pago: false, categoria: 'Synthetic' }] } }, categorias: ['Synthetic'], orcamentos: { padrao: { Synthetic: 80 }, meses: {} } });
    const docs = new Map([[ 'estado:' + a.uid, { revisao: 8, dados: state } ], ['fila:' + a.uid, { outbox: [], conflicts: [], generation: 'legacy', recoveryKeys: [] }]]);
    let serial = Promise.resolve();
    const db = { requerConta: false, acessoConta: null,
        ler: async k => structuredClone(docs.get(k) ?? null), lerDocumentos: async keys => new Map(keys.map(k => [k, structuredClone(docs.get(k) ?? null)])),
        alterarComLeituras(keys, reads, fn) {
            const access = this.acessoConta;
            const task = serial.then(() => { if (this.requerConta) assertAccountAccess(docs.get(ACCOUNT_ACCESS_KEY), access, keys);
                const result = fn(new Map(keys.map(k => [k, structuredClone(docs.get(k) ?? null)])), new Map(reads.map(k => [k, structuredClone(docs.get(k) ?? null)])));
                for (const [k, v] of result) docs.set(k, structuredClone(v)); return structuredClone(result); }); serial = task.catch(() => {}); return task;
        }, alterarDocumentos(keys, fn) { return this.alterarComLeituras(keys, [], fn); }, alterar(k, fn) { return this.alterarDocumentos([k], docs => { docs.set(k, fn(docs.get(k))); return docs; }).then(docs => docs.get(k)); }
    };
    const storageMap = new Map(), storage = { getItem: k => storageMap.get(k) ?? null, setItem: (k, v) => storageMap.set(k, v), removeItem: k => storageMap.delete(k) };
    const policy = new AccountDataPolicy(db, { storage }), service = new ServicoFinanceiroAtomico(db, validarBackup);
    return { docs, db, policy, service, storage, storageMap, state };
}
async function prepared() { const h = fixture(); await h.policy.initialize(); await h.policy.identify(a); await h.policy.offline.enroll(a.uid, pin); return h; }
async function retained() { const h = await prepared(); const result = await h.policy.logout({ uid: a.uid, mode: 'keep', flush: () => { throw Error('must not use network'); }, signOut: async () => {} }); assert.equal(result.error, null); return h; }
const financial = h => structuredClone([...h.docs].filter(([k]) => /^(estado:|fila:|restore-recovery:)/.test(k)));

test('retention revokes Google, keeps financial graph and requires PIN after restart', async () => {
    const h = await retained(), before = financial(h);
    assert.equal(h.policy.access, null); await assert.rejects(h.policy.identify(a), { code: 'account/access-revoked' });
    const p = new AccountDataPolicy(h.db, { storage: h.storage }); await p.initialize(); assert.equal(p.access, null);
    const local = await p.offline.unlock(a.uid, pin); assert.equal(local.access.kind, 'local'); assert.equal(await p.isCurrent(), true);
    assert.deepEqual(financial(h), before); assert.deepEqual(local.state.dados, h.state);
    assert.equal(h.docs.get(ACCOUNT_ACCESS_KEY).mode, 'local');
    await assert.rejects(p.identify(a), { code: 'account/access-revoked' });
});
test('wrong PIN and ciphertext tampering never create or erase finance', async () => {
    for (const corrupt of [false, true]) {
        const h = await retained(), before = financial(h);
        if (corrupt) h.docs.get('account-offline:v1:' + a.uid).ciphertext = '00'.repeat(64);
        await assert.rejects(h.policy.offline.unlock(a.uid, corrupt ? pin : '00000000'), { code: 'offline/pin' });
        assert.equal(h.policy.access, null); assert.deepEqual(financial(h), before);
    }
});
test('malformed envelopes reject unsafe KDF costs without running derivation', async () => {
    for (const patch of [{ iterations: 1 }, { iterations: 999999999 }, { version: 99 }, { uid: b.uid }, { ciphertext: '00'.repeat(2049) }]) {
        const h = await retained(); Object.assign(h.docs.get('account-offline:v1:' + a.uid), patch);
        await assert.rejects(h.policy.offline.unlock(a.uid, pin), { code: 'offline/unavailable' }); assert.equal(h.policy.access, null);
    }
});
test('generation change and incomplete local pair require recovery, never an empty state', async () => {
    for (const missing of [false, true]) {
        const h = await retained(), before = financial(h);
        if (missing) h.docs.delete('estado:' + a.uid); else h.docs.get('fila:' + a.uid).generation = 'new-generation';
        await assert.rejects(h.policy.offline.unlock(a.uid, pin), { code: missing ? 'offline/invalid-data' : 'offline/unavailable' });
        assert.equal(h.docs.has('estado:' + a.uid), !missing); assert.equal(h.policy.access, null); assert.ok(before.length);
    }
});
test('cancel logout performs no action and changes no authorization', async () => {
    const h = await prepared(), before = structuredClone([...h.docs]), access = h.policy.access;
    const result = await h.policy.logout({ uid: a.uid, mode: 'cancel', signOut: () => { throw Error('must not sign out'); } });
    assert.equal(result.cancelled, true); assert.deepEqual([...h.docs], before); assert.equal(h.policy.access, access);
});
test('PIN derivation from old A session cannot unlock after B or A-B-A transition', async () => {
    for (const aba of [false, true]) {
        const h = await retained(), original = crypto.subtle.deriveKey.bind(crypto.subtle); let release, entered;
        const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
        crypto.subtle.deriveKey = async (...args) => { const key = await original(...args); entered(); await gate; return key; };
        try {
            const operation = h.policy.offline.unlock(a.uid, pin); const rejected = assert.rejects(operation, { code: 'offline/locked' }); await started;
            await h.policy.acceptLogin(b, h.policy.loginIntent(), () => true); if (aba) await h.policy.acceptLogin(a, h.policy.loginIntent(), () => true);
            const active = h.policy.access; release(); await rejected; assert.equal(h.policy.access, active); assert.equal(active.kind, 'google');
        } finally { release?.(); crypto.subtle.deriveKey = original; }
    }
});
test('independent tabs revalidate epoch; old local key cannot write after a newer unlock', async () => {
    const h = await retained(); const first = await h.policy.offline.unlock(a.uid, pin);
    const second = new AccountDataPolicy(h.db, { storage: h.storage }); await second.initialize(); await second.offline.unlock(a.uid, pin);
    assert.throws(() => assertAccountAccess(h.docs.get(ACCOUNT_ACCESS_KEY), first.access, ['estado:' + a.uid]), { code: 'account/access-revoked' });
    assert.throws(() => assertAccountAccess(h.docs.get(ACCOUNT_ACCESS_KEY), second.access, ['estado:' + b.uid]), { code: 'account/access-revoked' });
});
test('local atomic editing preserves outbox/tombstones/conflicts and every remote entry point refuses', async t => {
    const h = await retained(), unlocked = await h.policy.offline.unlock(a.uid, pin); let remoteCalls = 0;
    const client = new Proxy({}, { get() { return () => { remoteCalls++; throw Error('remote forbidden'); }; } });
    const sync = new AutomaticFinanceSync({ client, db: h.db, service: h.service, accountPolicy: h.policy, onAccount() {}, onState() {}, onStatus() {}, readLegacy() {}, connectivity: { navigator: { onLine: true } } }); t.after(() => sync.stop());
    await sync.useLocal(unlocked); const base = structuredClone(unlocked.state.dados), desired = structuredClone(base); desired.meses[month].receitas = [];
    await h.service.aplicarEdicao(a.uid, base, desired, changes => changes.map(value => makeOperation(recordEntityKey(value), value, null)), () => {}, () => true, 'legacy');
    assert.equal(h.docs.get('fila:' + a.uid).outbox[0].value.deleted, true);
    for (const call of [() => sync.cycle(sync.session), () => sync.snapshot(sync.session), () => sync.importBackup(base), () => sync.resumeRestore(sync.session, {})]) await assert.rejects(call(), { code: 'account/local-only' });
    sync.request(0); await sync.run(sync.session); assert.equal(remoteCalls, 0);
});
test('interrupted retained logout restarts locked with recoverable PIN grant and unchanged graph', async () => {
    const h = await prepared(), before = financial(h);
    await h.db.alterar(ACCOUNT_ACCESS_KEY, c => ({ ...c, closing: true, closingToken: 'synthetic-interruption', keepLocal: true }));
    const p = new AccountDataPolicy(h.db, { storage: h.storage }); await p.initialize();
    assert.equal(p.access, null); assert.deepEqual(financial(h), before);
    assert.equal((await p.offline.unlock(a.uid, pin)).access.uid, a.uid);
});
test('network signOut failure does not restore Google authority or destroy offline grant', async () => {
    const h = await prepared(), result = await h.policy.logout({ uid: a.uid, mode: 'keep', flush: () => { throw Error('no flush'); }, signOut: async () => { throw Error('synthetic SDK failure'); } });
    assert.equal(result.signedOut, false); assert.equal(result.preserved, true);
    await assert.rejects(h.policy.identify(a), { code: 'account/access-revoked' }); await h.policy.offline.unlock(a.uid, pin); assert.equal(h.policy.access.kind, 'local');
});
test('UID source copies atomically/idempotently with queue, tombstones and original bytes preserved', async () => {
    const h = fixture(); await h.policy.initialize(); await h.policy.identify(a); h.docs.delete('estado:' + a.uid); h.docs.delete('fila:' + a.uid);
    const original = JSON.stringify(h.state), meta = JSON.stringify({ outbox: [{ id: 'delete-op', entityKey: month + '/receitas/synthetic-r', baseRevision: null, value: { month, type: 'receitas', id: 'synthetic-r', deleted: true } }], conflicts: [], firstLinkSource: 'account', generation: 'legacy' });
    // Use the production entity-key encoding.
    const parsed = JSON.parse(meta); parsed.outbox[0].entityKey = recordEntityKey(parsed.outbox[0].value);
    h.storageMap.set(chaveLocalConta(a.uid), original); h.storageMap.set('controleFinanceiro:sync:' + a.uid, JSON.stringify(parsed));
    const options = { db: h.db, storage: h.storage, uid: a.uid, isCurrent: () => true };
    assert.equal((await migrarFonteDaConta(options)).status, 'copied'); const before = financial(h);
    assert.equal((await migrarFonteDaConta(options)).status, 'existing'); assert.deepEqual(financial(h), before);
    assert.equal(h.storageMap.get(chaveLocalConta(a.uid)), original); assert.deepEqual(h.docs.get('fila:' + a.uid).outbox, parsed.outbox);
});
test('anonymous sources are never silently associated with a Google UID', async () => {
    const h = fixture(); await h.policy.initialize(); await h.policy.identify(a); h.docs.delete('estado:' + a.uid); h.docs.delete('fila:' + a.uid);
    h.storageMap.set('controleFinanceiro:v3', JSON.stringify(h.state));
    assert.equal((await migrarFonteDaConta({ db: h.db, storage: h.storage, uid: a.uid, isCurrent: () => true })).status, 'absent');
    assert.equal(h.docs.has('estado:' + a.uid), false); assert.ok(h.storageMap.has('controleFinanceiro:v3'));
});


test('late Auth callbacks for old A cannot replace a new A session after A-B-A', async t => {
    const h = fixture(); await h.policy.initialize(); let auth = a, deliver;
    const client = { authenticatedUser: () => auth, onUser(fn) { deliver = fn; queueMicrotask(() => fn(auth)); return () => {}; }, ready: async () => auth };
    const sync = new AutomaticFinanceSync({ client, db: h.db, service: h.service, accountPolicy: h.policy, onAccount() {}, onState() {}, onStatus() {}, readLegacy: () => ({ estado: 'ausente' }), readLegacyMetadata: () => ({}), connectivity: { navigator: { onLine: false } } }); t.after(() => sync.stop());
    await sync.start(); auth = b; await h.policy.acceptLogin(b, h.policy.loginIntent(), () => true); await sync.useAccount(b);
    auth = { uid: a.uid }; await h.policy.acceptLogin(auth, h.policy.loginIntent(), () => true); await sync.useAccount(auth);
    const current = sync.session, access = h.policy.access; deliver(a); await Promise.resolve();
    assert.equal(sync.session, current); assert.equal(h.policy.access, access);
});


test('delayed old closing token cannot hide or revoke newly authorized A after A-B-A', async () => {
    const h = fixture(); await h.policy.initialize(); await h.policy.identify(a);
    await h.db.alterar(ACCOUNT_ACCESS_KEY, c => ({ ...c, closing: true, closingToken: 'old-close' }));
    await h.policy.revoke(a.uid, 'old-close');
    await h.policy.acceptLogin(b, h.policy.loginIntent(), () => true); await h.policy.acceptLogin(a, h.policy.loginIntent(), () => true);
    const access = h.policy.access, before = structuredClone(h.docs.get(ACCOUNT_ACCESS_KEY)), intent = h.policy.intent;
    await h.policy.revoke(a.uid, 'old-close');
    assert.equal(h.policy.access, access); assert.equal(h.policy.intent, intent); assert.deepEqual(h.docs.get(ACCOUNT_ACCESS_KEY), before);
});


async function ownedSource() {
    const h = fixture(); await h.policy.initialize(); await h.policy.identify(a); h.docs.delete('estado:' + a.uid); h.docs.delete('fila:' + a.uid);
    h.storageMap.set(chaveLocalConta(a.uid), JSON.stringify(h.state));
    h.options = { db: h.db, storage: h.storage, uid: a.uid, isCurrent: () => true }; return h;
}
test('owned migration quota abort leaves originals intact and retry copies once', async () => {
    const h = await ownedSource(), before = structuredClone([...h.docs]), source = h.storageMap.get(chaveLocalConta(a.uid)), write = h.db.alterarDocumentos;
    h.db.alterarDocumentos = async () => { throw new DOMException('Synthetic quota', 'QuotaExceededError'); };
    await assert.rejects(migrarFonteDaConta(h.options), { name: 'QuotaExceededError' }); assert.deepEqual([...h.docs], before); assert.equal(h.storageMap.get(chaveLocalConta(a.uid)), source);
    h.db.alterarDocumentos = write; await migrarFonteDaConta(h.options); assert.equal(h.docs.get('estado:' + a.uid).dados.meses[month].receitas.length, 1);
});
test('source mutation during digest rejects migration without a partial destination', async () => {
    const h = await ownedSource(), original = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => { const result = await original(...args); h.storageMap.set(chaveLocalConta(a.uid), JSON.stringify({ ...h.state, categorias: ['SYNTHETIC NEW SOURCE'] })); return result; };
    try { await assert.rejects(migrarFonteDaConta(h.options), { code: 'migration/source-changed' }); assert.equal(h.docs.has('estado:' + a.uid), false); assert.equal(h.docs.has('fila:' + a.uid), false); }
    finally { crypto.subtle.digest = original; }
});
test('concurrent UID migration has one journal and never duplicates operations', async () => {
    const h = await ownedSource(), source = structuredClone([...h.storageMap]);
    await Promise.all([migrarFonteDaConta(h.options), migrarFonteDaConta(h.options)]);
    assert.equal([...h.docs.keys()].filter(k => k.startsWith('restore-recovery:' + a.uid)).length, 1);
    assert.equal(h.docs.get('estado:' + a.uid).dados.meses[month].receitas.length, 1); assert.deepEqual([...h.storageMap], source);
});
test('ambiguous ownership and invalid generation never initialize an empty destination', async () => {
    for (const meta of [{ firstLinkSource: 'anonymous', outbox: [], conflicts: [] }, { generation: 99, outbox: [], conflicts: [] }]) {
        const h = await ownedSource(); h.storageMap.set('controleFinanceiro:sync:' + a.uid, JSON.stringify(meta));
        if (meta.firstLinkSource) assert.equal((await migrarFonteDaConta(h.options)).status, 'ambiguous');
        else await assert.rejects(migrarFonteDaConta(h.options), { code: 'migration/invalid-local' });
        assert.equal(h.docs.has('estado:' + a.uid), false); assert.ok(h.storageMap.get(chaveLocalConta(a.uid)));
    }
});
test('storage failure at unlock commit preserves the existing grant and every financial document', async () => {
    const h = await retained(), before = structuredClone([...h.docs]), original = h.db.alterarComLeituras;
    h.db.alterarComLeituras = async () => { throw new DOMException('Synthetic unlock quota', 'QuotaExceededError'); };
    await assert.rejects(h.policy.offline.unlock(a.uid, pin), { name: 'QuotaExceededError' });
    assert.equal(h.policy.access, null); assert.deepEqual([...h.docs], before);
    h.db.alterarComLeituras = original; assert.equal((await h.policy.offline.unlock(a.uid, pin)).access.uid, a.uid);
});

for (const transition of ['A-B-A', 'same-UID', 'logout', 'controller']) test('late hydration failure cannot notify new UI: ' + transition, async () => {
    const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8'), start = source.lastIndexOf('onState: async (next, meta) => {'), end = source.indexOf('\n            },', start) + '\n            }'.length;
    assert.ok(start >= 0 && end > start); let reject, entered; const called = new Promise(r => { entered = r; }), failure = new Promise((_, r) => { reject = r; });
    const statuses = [], context = { politicaDadosConta: { access: { uid: a.uid }, closing: false, isCurrent() { entered(); return failure; } }, automaticController: { session: {} }, document: { visibilityState: 'visible' }, showStatus: (...args) => statuses.push(args) };
    const handler = vm.runInNewContext('(' + source.slice(start + 'onState: '.length, end) + ')', context), operation = handler({}, {}); await called;
    if (transition === 'controller') context.automaticController = { session: {} };
    else { context.automaticController.session = transition === 'logout' ? null : {}; context.politicaDadosConta.access = transition === 'logout' ? null : { uid: a.uid }; }
    reject(new Error('Synthetic delayed storage error')); await operation; assert.deepEqual(statuses, []);
});


test('concurrent PIN replacement cannot retain a grant different from the PIN just confirmed', async () => {
    const h = await prepared(), before = financial(h), other = new AccountDataPolicy(h.db, { storage: h.storage });
    await other.initialize(); await other.identify(a); await other.offline.enroll(a.uid, '7482910563');
    const result = await h.policy.logout({ uid: a.uid, mode: 'keep', flush: () => { throw Error('no flush'); }, signOut: async () => {} });
    assert.equal(result.error, 'offline/locked'); assert.equal(await h.policy.offline.available(), null); assert.deepEqual(financial(h), before);
});
test('negative durable fence blocks restored SDK identity when IndexedDB logout writes and signOut fail', async () => {
    const h = await prepared(), before = financial(h), write = h.db.alterar, transaction = h.db.alterarComLeituras;
    h.db.alterar = h.db.alterarComLeituras = async () => { throw new DOMException('Synthetic quota', 'QuotaExceededError'); };
    await h.policy.logout({ uid: a.uid, mode: 'keep', flush: async () => {}, signOut: async () => { throw Error('Synthetic SDK failure'); } });
    h.db.alterar = write; h.db.alterarComLeituras = transaction;
    const restarted = new AccountDataPolicy(h.db, { storage: h.storage }); await restarted.initialize();
    await assert.rejects(restarted.identify(a), { code: 'account/access-revoked' }); assert.deepEqual(financial(h), before);
    await restarted.acceptLogin(a, restarted.loginIntent(), () => true); assert.equal(restarted.access.kind, 'google');
});
test('fresh Google login resets a forgotten PIN without losing offline work', async () => {
    const h = await retained(), before = financial(h); await h.policy.acceptLogin(a, h.policy.loginIntent(), () => true);
    await h.policy.offline.enroll(a.uid, '7482910563'); await h.policy.logout({ uid: a.uid, mode: 'keep', signOut: async () => {} });
    assert.equal((await h.policy.offline.unlock(a.uid, '7482910563')).access.kind, 'local'); assert.deepEqual(financial(h), before);
    const stored = JSON.stringify([...h.docs]); assert.ok(!stored.includes(pin)); assert.ok(!stored.includes('7482910563'));
});
test('UID migration without stable entry IDs preserves the source for separate recovery', async () => {
    const h = await ownedSource(), raw = JSON.parse(h.storageMap.get(chaveLocalConta(a.uid))); delete raw.meses[month].receitas[0].id;
    h.storageMap.set(chaveLocalConta(a.uid), JSON.stringify(raw)); const source = h.storageMap.get(chaveLocalConta(a.uid));
    await assert.rejects(migrarFonteDaConta(h.options), { code: 'migration/invalid-local' });
    assert.equal(h.docs.has('estado:' + a.uid), false); assert.equal(h.storageMap.get(chaveLocalConta(a.uid)), source);
});


test('cold signed-out Auth callback cannot invalidate an independent PIN unlock in progress', async t => {
    const h = await retained(), original = crypto.subtle.deriveKey.bind(crypto.subtle); let release, entered;
    const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
    crypto.subtle.deriveKey = async (...args) => { const key = await original(...args); entered(); await gate; return key; };
    const sync = new AutomaticFinanceSync({ client: {}, db: h.db, service: h.service, accountPolicy: h.policy, onAccount() {}, onState() {}, onStatus() {}, readLegacy() {}, connectivity: {} }); t.after(() => sync.stop());
    try {
        const unlocking = h.policy.offline.unlock(a.uid, pin); await started; const epoch = h.docs.get(ACCOUNT_ACCESS_KEY).epoch;
        await sync.useAccount(null); assert.equal(h.docs.get(ACCOUNT_ACCESS_KEY).epoch, epoch); release();
        const unlocked = await unlocking; await sync.useLocal(unlocked); assert.equal(sync.session.localOnly, true);
    } finally { release?.(); crypto.subtle.deriveKey = original; }
});


test('explicit local lock invalidates PIN derivation even before an access object exists', async () => {
    const h = await retained(), original = crypto.subtle.deriveKey.bind(crypto.subtle); let release, entered;
    const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
    crypto.subtle.deriveKey = async (...args) => { const key = await original(...args); entered(); await gate; return key; };
    try {
        const unlocking = h.policy.offline.unlock(a.uid, pin), rejected = assert.rejects(unlocking, { code: 'offline/locked' }); await started;
        await h.policy.revoke(a.uid); release(); await rejected; assert.equal(h.policy.access, null);
    } finally { release?.(); crypto.subtle.deriveKey = original; }
});


test('deferred Auth start refreshes connectivity after offline local bootstrap', async t => {
    const connectivity = { navigator: { onLine: false } }, client = { ready: async () => null, onUser(fn) { queueMicrotask(() => fn(null)); return () => {}; } };
    const sync = new AutomaticFinanceSync({ client, db: {}, service: {}, onAccount() {}, onState() {}, onStatus() {}, connectivity }); t.after(() => sync.stop());
    assert.equal(sync.online, false); connectivity.navigator.onLine = true; await sync.start(); assert.equal(sync.online, true);
});
