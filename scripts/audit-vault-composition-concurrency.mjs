// Independent negative audit: never import the new composition or published app.
import { createRealVaultAdapter } from '../experimental/finance-vault-real-adapter.js';
import { memoryVaultFactory } from '../tests/fixtures/vault-memory-store.mjs';
import { realContractClient } from '../tests/fixtures/vault-real-client.mjs';
import { owner, password, documents, income } from '../tests/fixtures/vault-real-scenarios.mjs';
import { registrosFinanceiros, recordEntityKey, recordsEquivalent } from '../sync-core.js';
const storage = memoryVaultFactory(), backend = realContractClient(owner);
let enter, release, enabled = false, calls = 0;
const entered = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
const a = createRealVaultAdapter({ store: storage.store, owner }), b = createRealVaultAdapter({ store: storage.store, owner });
const connect = h => { h.sync = h.session.attachSync({ client: h.client, readLegacyMetadata: () => ({}), connectivity: { navigator: { onLine: false } }, onAccount() {}, onState() {}, onStatus() {} }); };
const watchdog = setTimeout(() => { console.error('CP-05 probe timeout: no security conclusion'); process.exit(2); }, 15000);
try {
    const created = await a.create({ password, generation: 'legacy', documents: documents() });
    const clientA = { ...backend.client, async generationSnapshot(...args) {
        const result = await backend.client.generationSnapshot(...args);
        if (enabled && ++calls === 2) { enter(); await gate; }
        return result;
    } };
    const hA = { owner, adapter: a, session: created.session, client: clientA }; connect(hA); await hA.sync.useAccount({ uid: owner.uid }); hA.sync.online = true;
    const hB = { owner, adapter: b, session: await b.unlock(password), client: backend.client }; connect(hB); await hB.sync.useAccount({ uid: owner.uid }); hB.sync.online = true;
    await income(hA, 'synthetic-audit-existing'); await hA.sync.cycle(hA.sync.session);
    enabled = true;
    const oldCycle = hA.sync.cycle(hA.sync.session).then(() => null, e => e.code); await entered;
    await income(hB, 'synthetic-audit-other-tab'); await hB.sync.cycle(hB.sync.session); release();
    const code = await oldCycle, localState = await hA.session.db.ler(`estado:${owner.uid}`), queue = await hA.session.service.lerFila(owner.uid);
    const remote = await backend.client.generationSnapshot(owner.uid), local = registrosFinanceiros(localState.dados), live = remote.records.filter(r => !r.deleted);
    const equivalent = local.length === live.length && local.every(l => live.some(r => recordEntityKey(l) === recordEntityKey(r) && recordsEquivalent(l.record, r.record)));
    const secure = code === null;
    console.log(JSON.stringify({ id: 'CP-05', secure, error: code, localCount: local.length, remoteCount: live.length, pending: queue.outbox.length, equivalent,
        storage: 'Node transactional model', remote: 'SDK I/O model with real generation transport', compositionImported: false }));
    process.exitCode = secure && equivalent && queue.outbox.length === 0 ? 0 : 1;
} finally { clearTimeout(watchdog); release?.(); a.close(); b.close(); }
