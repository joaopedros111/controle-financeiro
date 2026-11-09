import { createRealVaultAdapter } from '../../experimental/finance-vault-real-adapter.js';
import { normalizarEstado } from '../../finance-core.js';
import { financeSettings } from '../../automatic-sync-policy.js';
import { makeOperation, recordEntityKey } from '../../sync-core.js';
import { criarArmazenamento, criarRecuperacaoFinanceira } from '../../storage.js';
import { realContractClient } from './vault-real-client.mjs';
export const owner = { projectId: 'demo-vault-real', uid: 'synthetic-real-A' }, password = 'synthetic-real-adapter-password', month = '2026-11';
const clone = v => structuredClone(v);
export function equal(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Synthetic equivalence assertion failed'); }
export const ok = v => { if (!v) throw new Error('Synthetic assertion failed'); };
export async function rejects(fn) { let e; try { await fn(); } catch (error) { e = error; } ok(e); return e; }
export function documents(uid = owner.uid) {
    const state = normalizarEstado({ versao: 3, categorias: ['Casa'], meses: { [month]: { receitas: [], despesas: [] } } });
    return { [`estado:${uid}`]: { revisao: 0, dados: state }, [`fila:${uid}`]: { generation: 'legacy', initialized: true, automaticPolicyInitialized: true,
        outbox: [], conflicts: [], remoteRevisions: {}, attempted: {}, recoveryKeys: [], settingsBaseline: financeSettings(state), automaticSettingsDirty: false } };
}
export function serialLocks() {
    const chains = new Map(); return { request(key, fn) { const p = (chains.get(key) || Promise.resolve()).then(fn); chains.set(key, p.catch(() => {})); return p; } };
}
export async function edit(h, fn, settingsIntent = false) {
    const base = (await h.session.db.ler(`estado:${h.owner.uid}`)).dados, desired = clone(base); fn(desired.meses[month], desired);
    return h.session.service.aplicarEdicao(h.owner.uid, base, desired, (changes, q) => changes.map(value => {
        const key = recordEntityKey(value), prior = q.outbox.filter(o => o.entityKey === key).at(-1);
        return makeOperation(key, value, prior && q.attempted?.[prior.id] ? prior.id : q.remoteRevisions?.[key] || null);
    }), (q, state) => { if (settingsIntent) { q.automaticSettingsDirty = true; q.automaticSettingsValue = financeSettings(state); } }, () => h.session.isCurrent(), (await h.session.db.ler(`fila:${h.owner.uid}`)).generation);
}
export const income = (h, id = 'synthetic-real-income') => edit(h, m => m.receitas.push({ id, nome: 'SYNTHETIC REAL ADAPTER INCOME', valor: 123.45, recebido: false }));
export function connect(h, client = h.client) {
    const statuses = [], states = [], sync = h.session.attachSync({ client, connectivity: { navigator: { onLine: true } }, onAccount() {}, onState: value => states.push(clone(value)), onStatus: value => statuses.push(value) });
    // Scenarios explicitly drive cycles. Keep scheduling separate from connectivity.
    sync.request = () => {};
    h.sync = sync; h.statuses = statuses; h.states = states; return sync;
}
export async function cycle(h) {
    h.sync.session.again = false; // Match run() when explicitly starting the next cycle.
    return h.sync.cycle(h.sync.session);
}
export function adapterCases({ makeStore, crypto, locks = serialLocks() }) {
    const cases = [], closers = [];
    const add = (name, run) => cases.push({ name, run: async () => { try { await run(); } finally { closers.splice(0).reverse().forEach(fn => fn()); } } });
    async function setup(customOwner = owner) {
        const storage = await makeStore(), adapter = createRealVaultAdapter({ store: storage.store, owner: customOwner, crypto, locks }); closers.push(() => adapter.close());
        const created = await adapter.create({ password, generation: 'legacy', documents: documents(customOwner.uid) });
        const remote = realContractClient(customOwner), h = { ...remote, owner: customOwner, storage, adapter, session: created.session, secret: created.recoverySecret };
        connect(h); await h.sync.useAccount({ uid: customOwner.uid }); return h;
    }
    const q = h => h.session.service.lerFila(h.owner.uid), state = async h => (await h.session.db.ler(`estado:${h.owner.uid}`)).dados;
    add('synchronous Auth identity preserves the owner object and rejects mismatched or revoked leases', async () => {
        const h = await setup(), user = { uid: owner.uid };
        h.client.authenticatedUser = () => user;
        ok(h.sync.client.authenticatedUser() === user);
        await income(h); await cycle(h); equal((await q(h)).outbox.length, 0);
        h.client.authenticatedUser = () => ({ uid: 'synthetic-other-owner' });
        equal(h.sync.client.authenticatedUser(), null);
        equal((await rejects(() => cycle(h))).code, 'auth/user-token-expired');
        await h.adapter.lock();
        await rejects(() => h.sync.client.authenticatedUser());
    });
    add('real controller creates, edits, deletes and confirms the corresponding operations', async () => {
        const h = await setup(); await income(h); await edit(h, m => m.despesas.push({ id: 'synthetic-expense', nome: 'SYNTHETIC EXPENSE', valor: 5.67, categoria: 'Casa', pago: false }));
        h.sync.online = false; await cycle(h);
        equal((await q(h)).outbox.length, 2); equal(h.remote.inspect(owner).records.length, 0);
        ok(!h.statuses.includes('Sincronizado'));
        h.sync.online = true; await cycle(h); equal((await q(h)).outbox.length, 0);
        await edit(h, m => { m.receitas[0].valor = 99.99; m.despesas = []; }); await cycle(h);
        const records = await h.client.list(owner.uid); ok(records.some(r => r.deleted)); equal(records.find(r => r.id === 'synthetic-real-income').record.valor, 99.99);
    });
    add('individual ACK only removes its own ID and duplicate ACK is harmless', async () => {
        const h = await setup(); await income(h, 'synthetic-one'); await income(h, 'synthetic-two'); const before = await q(h), first = before.outbox[0];
        await rejects(() => h.session.service.concluirOperacao(owner.uid, first, {})); equal((await q(h)).outbox, before.outbox);
        await h.session.service.concluirOperacao(owner.uid, first, { acknowledged: true, revision: first.id });
        await h.session.service.concluirOperacao(owner.uid, first, { acknowledged: true }); equal((await q(h)).outbox.map(o => o.id), [before.outbox[1].id]);
    });
    add('delayed ACK cannot report synchronized or remove a newer queued operation', async () => {
        const h = await setup(); await income(h); let enter, release;
        const started = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; }), original = h.client.commit;
        h.client.commit = async (...args) => { const ack = await original(...args); enter(); await gate; return ack; };
        const pending = cycle(h); await started;
        try { equal((await q(h)).outbox.length, 1); ok(!h.statuses.includes('Sincronizado')); await income(h, 'synthetic-newer'); } finally { release(); }
        await pending; ok((await q(h)).outbox.some(o => o.value.id === 'synthetic-newer')); h.client.commit = original; await cycle(h); equal((await q(h)).outbox.length, 0);
    });
    add('lost ACK and offline reopen retry the exact durable operation once', async () => {
        const h = await setup(); await income(h); const before = (await q(h)).outbox[0]; h.remote.loseNextAck(); await rejects(() => cycle(h));
        await h.adapter.lock(); h.session = await h.adapter.unlock(password); connect(h); await h.sync.useAccount({ uid: owner.uid }); equal((await q(h)).outbox[0].id, before.id);
        await cycle(h); equal(h.remote.inspect(owner).records.length, 1); equal((await q(h)).outbox.length, 0);
    });
    for (const deleted of [false, true]) add(`real automatic policy archives a concurrent ${deleted ? 'deletion' : 'edit'} without losing the rejected local version`, async () => {
        const h = await setup(); await income(h); await cycle(h); const old = (await h.client.list(owner.uid))[0];
        await edit(h, m => { m.receitas[0].valor = 11.11; });
        const value = deleted ? { month, type: 'receitas', id: old.id, deleted: true } : { ...old, record: { ...old.record, valor: 77.77 } };
        await h.client.commit(owner.uid, makeOperation(recordEntityKey(old), value, old.revision)); await cycle(h);
        const queue = await q(h); ok(queue.automaticHistory.some(x => JSON.stringify(x).includes('11.11'))); ok(queue.automaticHistory.every(x => x.uploaded));
        equal((await state(h)).meses[month].receitas.length, deleted ? 0 : 1); if (!deleted) equal((await state(h)).meses[month].receitas[0].valor, 77.77);
    });
    add('permission rejection preserves the exact attempted operation and explicit retry recovers', async () => {
        const h = await setup(); await income(h); const before = (await q(h)).outbox[0]; h.remote.failNext('permission-denied'); await rejects(() => cycle(h));
        equal((await q(h)).outbox[0], before); ok((await q(h)).attempted[before.id]); await cycle(h); equal((await q(h)).outbox.length, 0);
    });
    add('real run/report records permanent permission failure without discarding work and explicit resumption synchronizes', async () => {
        const h = await setup(); await income(h);
        h.client.onUser = callback => { queueMicrotask(() => callback({ uid: owner.uid })); return () => {}; }; h.client.ready = async () => null;
        await h.sync.start(); equal(h.sync.session.uid, owner.uid);
        const before = (await q(h)).outbox[0]; h.sync.online = true; h.remote.failNext('permission-denied');
        await h.sync.run(h.sync.session); ok(h.sync.session.permanent); equal((await q(h)).outbox[0], before); ok(!h.statuses.includes('Sincronizado'));
        h.sync.session.permanent = false; await h.sync.run(h.sync.session); equal((await q(h)).outbox.length, 0); ok(h.statuses.includes('Sincronizado'));
    });
    add('real importBackup archives the old queue, atomically changes generation and resumes interrupted publication', async () => {
        const h = await setup(); await income(h); const oldQueue = await q(h), backup = clone(await state(h)); backup.meses[month].receitas[0].valor = 44.44;
        await h.sync.importBackup(backup, () => true); const pending = await q(h), snapshot = await h.adapter.read(); equal(snapshot.generation, pending.generation); ok(pending.restoreJob);
        equal(snapshot.documents[pending.recoveryKeys.at(-1)].queue, oldQueue); h.failRestore(); await rejects(() => cycle(h)); ok((await q(h)).restoreJob);
        await h.adapter.lock(); h.session = await h.adapter.unlock(password); connect(h); await h.sync.useAccount({ uid: owner.uid }); await cycle(h);
        equal((await q(h)).restoreJob, null); equal((await h.client.generationSnapshot(owner.uid)).records[0].record.valor, 44.44); ok((await q(h)).recoveryKeys.length);
    });
    add('A-B-A and logout during sync cannot deliver an old ACK into the new controller session', async () => {
        const h = await setup(); await income(h); let enter, release; const started = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; }), original = h.client.commit;
        h.client.commit = async (...args) => { const ack = await original(...args); enter(); await gate; return ack; };
        const pending = cycle(h).then(() => null, e => e.code); await started; await h.sync.useAccount(null); await h.adapter.lock();
        const b = await setup({ ...owner, uid: 'synthetic-real-B' }); await income(b); equal((await q(b)).outbox.length, 1);
        h.session = await h.adapter.unlock(password); connect(h); await h.sync.useAccount({ uid: owner.uid }); const before = await q(h); release(); ok([null, 'persistence/cancelled'].includes(await pending));
        equal(await q(h), before); h.client.commit = original; await cycle(h); equal(h.remote.inspect(owner).records.length, 1);
    });
    add('lock revokes leases and blocks reads until a fresh unlock', async () => {
        const h = await setup(), old = h.session; await income(h); await h.adapter.lock(); await rejects(() => old.db.ler(`estado:${owner.uid}`)); await rejects(() => h.adapter.read());
        await rejects(() => h.adapter.unlock('synthetic-wrong-password')); h.session = await h.adapter.unlock(password); equal((await q(h)).outbox.length, 1);
    });
    add('logout inside the final storage commit fences the old sync session before any put becomes durable', async () => {
        const h = await setup(), before = (await h.adapter.read()).documents;
        h.storage.setFaults({ beforePut() { h.sync.closeSession(); } }); await rejects(() => income(h, 'synthetic-cancelled-at-commit'));
        h.storage.setFaults({}); h.session = await h.adapter.unlock(password); connect(h); await h.sync.useAccount({ uid: owner.uid }); equal((await h.adapter.read()).documents, before);
    });
    add('two independent vault connections preserve concurrent intentions and reject a stale edit', async () => {
        const h = await setup(), adapter = createRealVaultAdapter({ store: await h.storage.reopen(), owner, crypto, locks }); closers.push(() => adapter.close());
        const peer = { owner, session: await adapter.unlock(password) };
        await Promise.all([income(h, 'synthetic-tab-a'), income(peer, 'synthetic-tab-b')]); equal((await q(h)).outbox.length, 2);
        const base = clone(await state(h)), desired = clone(base); desired.meses[month].receitas[0].valor = 6;
        await edit(h, m => { m.receitas[0].valor = 7; }); await rejects(() => peer.session.service.aplicarEdicao(owner.uid, base, desired)); equal((await state(h)).meses[month].receitas[0].valor, 7);
    });
    for (const fault of ['quota', 'abort', 'read']) add(`${fault} preserves state, queue and recoveries without empty fallback`, async () => {
        const h = await setup(); await income(h); const before = await h.adapter.read();
        h.storage.setFaults(fault === 'quota' ? { beforePut() { throw Object.assign(new Error('Synthetic quota'), { name: 'QuotaExceededError' }); } } : fault === 'abort' ? { afterPut(tx) { tx.abort(); } } : { afterRead() { throw new Error('Synthetic read failure'); } });
        await rejects(() => income(h, 'synthetic-failed')); h.storage.setFaults({}); h.session = await h.adapter.unlock(password);
        equal((await h.adapter.read()).documents, before.documents);
    });
    add('invalid state and asynchronous transaction callbacks cannot be committed', async () => {
        const h = await setup(), before = await h.adapter.read();
        await rejects(() => h.session.db.alterar(`estado:${owner.uid}`, s => ({ ...s, dados: { meses: null } })));
        await rejects(() => h.session.db.alterarDocumentos([`fila:${owner.uid}`], async docs => docs)); equal((await h.adapter.read()).documents, before.documents);
    });
    add('recovery package after real controller writes restores all documents with a fresh key', async () => {
        const h = await setup(); await income(h); const before = await h.adapter.read(), pack = await h.adapter.exportRecoveryPackage(), fresh = await makeStore();
        const dest = createRealVaultAdapter({ store: fresh.store, owner, crypto, locks }); closers.push(() => dest.close());
        const result = await dest.restore(pack, { recoverySecret: h.secret, newPassword: password }); const restored = await dest.read(); equal(restored.documents, before.documents); ok(restored.catalog.keyId !== before.catalog.keyId);
        ok(result.recoverySecret && result.recoverySecret !== h.secret); await dest.lock(); await dest.unlockWithRecovery(result.recoverySecret); equal((await dest.read()).documents, before.documents);
    });
    add('real settings ACK cannot clear a newer intent and online success waits for every ACK', async () => {
        const h = await setup(); await cycle(h); h.sync.online = true;
        h.statuses.length = 0;
        await edit(h, (_, state) => { state.categorias.push('Primeira'); }, true);
        let enter, release; const started = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; }), original = h.client.saveSettings;
        h.client.saveSettings = async (...args) => { const result = await original(...args); enter(); await gate; return result; };
        const pending = cycle(h); await started;
        try { ok(!h.statuses.includes('Sincronizado')); await edit(h, (_, state) => { state.categorias.push('Segunda'); }, true); } finally { release(); }
        await pending; ok((await q(h)).automaticSettingsDirty); h.client.saveSettings = original; await cycle(h);
        ok((await h.client.getSettings(owner.uid)).categories.includes('Segunda')); equal((await q(h)).automaticSettingsDirty, false); ok(h.statuses.includes('Sincronizado'));
    });
    add('missing history ACK keeps the rejected version pending and prevents synchronized status', async () => {
        const h = await setup(); await income(h); await cycle(h); const old = (await h.client.list(owner.uid))[0];
        h.statuses.length = 0;
        await edit(h, m => { m.receitas[0].valor = 11.11; }); await h.client.commit(owner.uid, makeOperation(recordEntityKey(old), { ...old, record: { ...old.record, valor: 77.77 } }, old.revision));
        const original = h.client.saveAutomaticHistory; h.client.saveAutomaticHistory = async () => ({}); h.sync.online = true;
        equal((await rejects(() => cycle(h))).code, 'sync/invalid-ack'); ok((await q(h)).automaticHistory.some(x => !x.uploaded)); ok(!h.statuses.includes('Sincronizado'));
        h.client.saveAutomaticHistory = original; await cycle(h); ok((await q(h)).automaticHistory.every(x => x.uploaded)); ok(h.statuses.includes('Sincronizado'));
    });
    add('ciphertext stores contain no financial values, IDs, password or recovery secret', async () => {
        const h = await setup(); await income(h); const raw = JSON.stringify(await h.storage.inspect());
        for (const marker of ['SYNTHETIC REAL ADAPTER INCOME', '123.45', 'synthetic-real-income', password, h.secret]) ok(!raw.includes(marker));
    });
    add('real legacy storage distinguishes corrupt, missing and failed sources and preserves recovery on persistence failure', async () => {
        const values = new Map([['synthetic-corrupt', '{invalid']]), local = { getItem: k => values.get(k) ?? null, setItem() { throw new Error('Synthetic quota'); }, removeItem: k => values.delete(k) };
        const storage = criarArmazenamento(local), recovery = criarRecuperacaoFinanceira(storage);
        equal(storage.lerJsonResultado('synthetic-missing').estado, 'ausente'); equal(storage.lerJsonResultado('synthetic-corrupt', { protegerInvalido: true }).estado, 'invalido');
        recovery.proteger('synthetic-corrupt', '{invalid'); const result = recovery.restaurar({ chave: 'synthetic-corrupt', backup: documents()[`estado:${owner.uid}`].dados, validar: () => true, normalizar: clone, confirmar: () => true });
        equal(result.persistido, false); ok(recovery.protegido); equal(values.get('synthetic-corrupt'), '{invalid');
        local.getItem = () => { throw new Error('Synthetic read failure'); }; equal(storage.lerJsonResultado('synthetic-other').estado, 'erro');
    });
    return cases;
}
