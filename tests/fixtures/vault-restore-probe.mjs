import { createIntegratedSession } from '../../experimental/finance-vault-integrated-session.js';
import { equal, ok } from './vault-real-scenarios.mjs';
import { prepareGenerationRestore } from '../../automatic-sync-policy.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export async function createRestoreProbe({ config, client, auth, makeStore, connectivity, crypto = globalThis.crypto, locks }) {
    const uid = config.accounts[0], events = []; let nextRead = null, nextCommit = null, session, observedControl;
    const log = (event, values = {}) => events.push({ event, ...values });
    const create = () => createIntegratedSession({ config, client, auth, connectivity, crypto, locks,
        onView(view) { log('view', { phase: view.phase, epoch: view.epoch, restorePending: view.restorePending }); },
        makeStore: async name => {
            const store = await makeStore(name);
            if (name !== config.databaseName) return store;
            return { ...store, async compareAndSwap(...args) {
                const gate = nextCommit; if (gate) nextCommit = null;
                const value = await store.compareAndSwap(...args);
                if (gate) { log('restore-commit-durable-before-delivery'); gate.entered.resolve(); await gate.release.promise; }
                return value;
            }, async loadCatalog(...args) {
                const gate = nextRead; if (gate) nextRead = null;
                const value = await store.loadCatalog(...args);
                observedControl = value.control; if (!gate) return value;
                gate.control = value.control; log('old-read-captured', { epoch: value.control.epoch, revision: value.control.revision });
                gate.entered.resolve(); await gate.release.promise; return value;
            } };
        }
    });
    async function wait(predicate) { for (let i = 0; i < 450; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Synthetic restore phase timeout'); }
    async function prepare() {
        session = create(); await session.start(); await session.login(uid); await wait(() => session.view.phase === 'missing');
        const { recoverySecret } = await session.create('synthetic-restore-probe-password'); await session.confirmCustody(recoverySecret, true);
        await wait(() => session.view.phase === 'offline');
        await session.edit(s => { s.meses['2026-11'].receitas.push({ id: 'synthetic-restore-pending', nome: 'SYNTHETIC RESTORE PENDING', valor: 11.11, recebido: false }); });
    }
    async function reproduce() {
        const before = await session.snapshot(), state = structuredClone(before.documents[`estado:${uid}`].dados);
        state.meses['2026-11'].receitas[0].valor = 87.65;
        const expected = prepareGenerationRestore(state, before.documents[`estado:${uid}`].dados.tema), viewEpoch = session.view.epoch;
        const gate = { entered: deferred(), release: deferred(), control: null }; nextRead = gate;
        // snapshot enters guard synchronously, so it consumes this one-shot gate.
        const oldRead = session.snapshot().then(() => ({ accepted: true }), e => ({ accepted: false, code: e.code, name: e.name, stack: e.stack }));
        await gate.entered.promise;
        try { log('restore-start'); await session.restoreFixture(state); log('restore-settled'); }
        finally { gate.release.resolve(); }
        const rejected = await oldRead; log('old-read-settled', { code: rejected.code, accepted: rejected.accepted });
        equal(rejected.accepted, false); equal(rejected.code, 'cancelled'); ok(rejected.stack.includes('guard'));
        const after = await session.snapshot(), q = after.documents[`fila:${uid}`], recovery = q.recoveryKeys.at(-1);
        ok(q.restoreJob); ok(after.generation !== before.generation); equal(after.documents[recovery].queue, before.documents[`fila:${uid}`]);
        equal(after.documents[recovery].state, before.documents[`estado:${uid}`].dados); equal(q.restoreJob.state, expected);
        equal(after.documents[`estado:${uid}`].dados, expected); equal(session.view.uid, uid); equal(session.view.epoch, viewEpoch);
        ok(observedControl.epoch > gate.control.epoch);
        log('new-read-valid', { epoch: observedControl.epoch, revision: observedControl.revision, generationChanged: true, archivedQueueExact: true, restoreJobPresent: true, phase: session.view.phase });
        return { rejected, events: structuredClone(events), before, after, recovery, state: expected };
    }
    async function reopenAndPublish(expected) {
        await session.shutdown(); session = create(); await session.start(); await session.login(uid); await wait(() => session.view.phase === 'locked');
        await session.unlock('synthetic-restore-probe-password');
        await wait(() => ['synced', 'recovery-history'].includes(session.view.phase));
        const result = await session.snapshot(), q = result.documents[`fila:${uid}`]; equal(q.restoreJob, null); equal(q.outbox.length, 0);
        equal(result.documents[`estado:${uid}`].dados, expected.state);
        equal(result.documents[expected.recovery], expected.after.documents[expected.recovery]);
        equal((await client.generationSnapshot(uid)).generation, result.generation);
        ok(q.recoveryNotices.some(n => !n.acknowledged)); log('published-and-archive-retained'); return { events, phase: session.view.phase };
    }
    async function reproduceAtCommit() {
        const before = await session.snapshot(), raw = structuredClone(before.documents[`estado:${uid}`].dados);
        raw.meses['2026-11'].receitas[0].valor = 87.65;
        const expected = prepareGenerationRestore(raw, raw.tema), gate = { entered: deferred(), release: deferred() }; nextCommit = gate;
        log('restore-start'); const restoring = session.restoreFixture(raw).then(() => ({ accepted: true }), e => ({ accepted: false, code: e.code }));
        await gate.entered.promise;
        let rejected;
        try { rejected = await session.snapshot().then(() => ({ accepted: true }), e => ({ accepted: false, code: e.code, name: e.name, stack: e.stack })); }
        finally { gate.release.resolve(); }
        equal(rejected.accepted, false); equal(rejected.code, 'cancelled'); ok(rejected.stack.includes('guard'));
        const delivery = await restoring; log('old-poll-interrupted-delivery', { readError: rejected.code, restoreError: delivery.code });
        equal(delivery.accepted, false); equal(delivery.code, 'cancelled');
        // The read races the controller's post-commit authorization, not IDB
        // atomicity. Reopen independently rather than accepting the stale lease.
        // Auth is still the same real in-memory SDK session. Do not perform a
        // new network login while this browser context is intentionally offline.
        await session.shutdown(); session = create(); await session.start(); await wait(() => session.view.phase === 'locked');
        await session.unlock('synthetic-restore-probe-password'); await wait(() => session.view.phase === 'offline');
        const after = await session.snapshot(), q = after.documents[`fila:${uid}`], recovery = q.recoveryKeys.at(-1);
        ok(q.restoreJob); ok(after.generation !== before.generation);
        equal(after.documents[recovery].queue, before.documents[`fila:${uid}`]); equal(after.documents[recovery].state, before.documents[`estado:${uid}`].dados);
        equal(after.documents[`estado:${uid}`].dados, expected); equal(q.restoreJob.state, expected);
        log('independent-reopen-valid', { archivedQueueExact: true, restoreJobPresent: true });
        return { rejected, delivery, events: structuredClone(events), before, after, recovery, state: expected };
    }
    return { prepare, reproduce, reproduceAtCommit, reopenAndPublish, close: () => session?.shutdown() };
}
