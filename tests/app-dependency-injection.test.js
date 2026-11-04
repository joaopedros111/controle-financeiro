import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';
import { createRealVaultAdapter } from '../experimental/finance-vault-real-adapter.js';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { documents, owner, password } from './fixtures/vault-real-scenarios.mjs';
let moduleId = 0;
const isolatedStorage = () => import(`../storage.js?synthetic-injection=${++moduleId}`);
test('app dependency defaults are captured unchanged and cannot be replaced after bootstrap', async () => {
    const m = await isolatedStorage(), defaults = { storage: m.storage, openPersistence: () => 'original' };
    const captured = m.capturarDependenciasAplicacao(defaults);
    assert.equal(captured.storage, defaults.storage); assert.equal(captured.openPersistence, defaults.openPersistence); assert.ok(Object.isFrozen(captured));
    assert.throws(() => m.configurarDependenciasAplicacao({ openPersistence() {} }));
});
test('explicit factories are captured lazily without changing default storage or invoking any backend', async () => {
    const m = await isolatedStorage(); let opens = 0;
    const injected = { openPersistence: () => { opens++; return 'synthetic'; } }, factory = injected.openPersistence;
    m.configurarDependenciasAplicacao(injected); injected.openPersistence = () => 'mutated';
    const captured = m.capturarDependenciasAplicacao({ storage: m.storage, openPersistence: () => 'default' });
    assert.equal(opens, 0); assert.equal(captured.storage, m.storage); assert.equal(captured.openPersistence, factory); assert.equal(captured.openPersistence(), 'synthetic'); assert.equal(opens, 1);
    assert.throws(() => m.configurarDependenciasAplicacao({}));
});
test('invalid injection is rejected and an injected backend failure never falls back to the default backend', async () => {
    const m = await isolatedStorage();
    for (const value of [null, [], { vaultEnabled: true }, { openPersistence: null }, { storage: {} }]) assert.throws(() => m.configurarDependenciasAplicacao(value));
    let defaults = 0; m.configurarDependenciasAplicacao({ openPersistence: async () => { throw new Error('Synthetic open failure'); } });
    const d = m.capturarDependenciasAplicacao({ openPersistence: () => { defaults++; } }); await assert.rejects(d.openPersistence()); assert.equal(defaults, 0);
});
test('injected legacy metadata supports real account hydration without reading global localStorage', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Global storage must not be read'); } });
    const adapter = createRealVaultAdapter({ store: memoryVaultFactory().store, owner });
    try {
        const { session } = await adapter.create({ password, generation: 'legacy', documents: documents() }); const seen = [];
        const sync = new AutomaticFinanceSync({ db: session.db, service: session.service, client: {}, readLegacy: () => ({ estado: 'ausente' }),
            readLegacyMetadata: uid => { seen.push(uid); return {}; }, onAccount() {}, onState() {}, onStatus() {}, connectivity: { navigator: { onLine: false } } });
        await sync.useAccount({ uid: owner.uid }); await sync.useAccount(null); await sync.useAccount({ uid: owner.uid }); assert.deepEqual(seen, [owner.uid, owner.uid]);
        assert.equal((await session.db.ler(`estado:${owner.uid}`)).revisao, 0); sync.stop();
    } finally { adapter.close(); if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; }
});
test('failed or malformed injected metadata preserves existing financial state and queue', async () => {
    const adapter = createRealVaultAdapter({ store: memoryVaultFactory().store, owner });
    try {
        const { session } = await adapter.create({ password, generation: 'legacy', documents: documents() }), before = (await adapter.read()).documents;
        for (const reader of [() => { throw new Error('Synthetic read failure'); }, () => null, () => Promise.resolve({}), () => []]) {
            const sync = new AutomaticFinanceSync({ db: session.db, service: session.service, client: {}, readLegacy: () => ({ estado: 'ausente' }), readLegacyMetadata: reader, onStatus() {}, onTransition() {}, onAccount() {}, onState() {}, connectivity: { navigator: { onLine: false } } });
            await assert.rejects(sync.useAccount({ uid: owner.uid })); sync.stop(); assert.deepEqual((await adapter.read()).documents, before);
        }
    } finally { adapter.close(); }
});
