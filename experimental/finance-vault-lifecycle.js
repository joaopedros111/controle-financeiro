// Experimental lifecycle only. No application bootstrap, DOM, Auth SDK or DB discovery.
import { makeOperation, recordEntityKey } from '../sync-core.js';
import { financeSettings } from '../automatic-sync-policy.js';

const fail = code => { throw Object.assign(new Error('Experimental lifecycle rejected.'), { code }); };
const validOwner = o => o && Object.keys(o).sort().join() === 'projectId,uid'
    && /^demo-[\w-]+$/.test(o.projectId) && /^synthetic-[\w-]+$/.test(o.uid);
const same = (a, b) => a?.uid === b?.uid && a?.projectId === b?.projectId;
export function createVaultLifecycle({ openAdapter, revocationScope, onState = () => {} }) {
    if (typeof openAdapter !== 'function' || revocationScope !== 'owner-vault-all-tabs') fail('lifecycle/configuration');
    let phase = 'initializing', ownership = 'none', owner = null, resource = null, epoch = {}, failure = null;
    let transitions = Promise.resolve(), closing = null, closingReason = null, intent = 0, local = new Set();
    const view = () => Object.freeze({ phase, ownership, owner: owner && { ...owner }, error: failure,
        inFlight: local.size, data: null }); // Data is delivered only by an explicit authorized read.
    const emit = next => { phase = next; onState(view()); };
    const active = token => token === epoch && resource && ['ready', 'operating'].includes(phase);
    function capture() { if (!active(epoch)) fail('lifecycle/not-ready'); return { token: epoch, ...resource, owner }; }
    function check(c) { if (!active(c.token)) fail('lifecycle/stale-session'); }
    function failureState(error, token) { if (token !== epoch || phase === 'closing') return; failure = error.code || 'lifecycle/storage'; emit('error'); }
    function schedule(work) { const p = transitions.then(work); transitions = p.catch(() => {}); return p; }
    async function closeNow(reason) {
        closingReason = reason;
        if (closing) return closing;
        const old = resource; epoch = {}; emit('closing');
        closing = (async () => {
            // New commands/remote responses are fenced immediately. Already started
            // local commands finish for their captured owner, before durable revocation.
            await Promise.allSettled([...local]);
            if (old) {
                try { await old.adapter.lock(); }
                catch (error) { failure = error.code || 'lifecycle/revocation-failed'; emit('error'); throw error; }
                old.adapter.close();
            }
            resource = null; failure = null;
            if (closingReason === 'logout') { owner = null; ownership = 'none'; emit('signed-out'); }
            else emit(closingReason === 'suspend' ? 'suspended' : 'locked');
        })().finally(() => { closing = null; });
        return closing;
    }
    function localTask(work) {
        const c = capture(); emit('operating');
        // The receipt resolves only after the financial transaction completes.
        // Started != accepted/durable. No network promise belongs to this set.
        const p = Promise.resolve().then(() => work(c)); local.add(p);
        p.then(() => {}, e => failureState(e, c.token)).finally(() => {
            local.delete(p); if (active(c.token) && local.size === 0) emit('ready');
        });
        return p;
    }
    const api = {
        state: view,
        start() { if (phase !== 'initializing') fail('lifecycle/transition'); emit('signed-out'); },
        identify(identity) {
            // Revoke entry points synchronously even while a prior transition waits.
            if (!identity || !['confirmed', 'unconfirmed', 'none', 'failed'].includes(identity.kind)
                || (['confirmed', 'unconfirmed'].includes(identity.kind) && !validOwner(identity.owner))) fail('lifecycle/identity');
            const selection = structuredClone(identity);
            const request = ++intent;
            const done = closeNow('change');
            return schedule(async () => {
                await done; if (request !== intent) fail('lifecycle/stale-session');
                owner = selection.owner ? Object.freeze({ ...selection.owner }) : null;
                ownership = selection.kind; failure = null; emit('authenticating');
                if (selection.kind === 'failed') { owner = null; failure = 'lifecycle/auth-failed'; emit('error'); }
                else emit(selection.kind === 'none' ? 'signed-out' : 'locked');
            });
        },
        unlock(password) {
            if (phase !== 'locked' || !owner || !['confirmed', 'unconfirmed'].includes(ownership)) return Promise.reject(Object.assign(new Error('Explicit owner required.'), { code: 'lifecycle/identity' }));
            const token = epoch, selected = owner; emit('unlocking');
            return schedule(async () => {
                let adapter;
                try {
                    if (epoch !== token || phase !== 'unlocking') fail('lifecycle/stale-session');
                    adapter = await openAdapter(selected);
                    if (epoch !== token) fail('lifecycle/stale-session');
                    const session = await adapter.unlock(password);
                    if (epoch !== token) fail('lifecycle/stale-session');
                    // Authenticated owner attestation was provisioned explicitly at
                    // synthetic enrollment. Discovery metadata alone never grants access.
                    const binding = await session.db.ler(`snapshot:${selected.uid}:lifecycle-owner`);
                    if (epoch !== token) fail('lifecycle/stale-session');
                    if (binding?.format !== 'synthetic-authenticated-owner-v1' || !same(binding.owner, selected)) fail('lifecycle/owner-binding');
                    resource = { adapter, session }; failure = null; emit('ready');
                } catch (e) { adapter?.close(); failureState(e, token); if (epoch === token && phase === 'error' && ['unlock-failed', 'missing'].includes(e.code)) emit(e.code === 'missing' ? 'missing' : 'locked'); throw e; }
            });
        },
        async read() {
            const c = capture();
            try { const value = await c.adapter.read(); check(c); return value; }
            catch (e) { failureState(e, c.token); throw e; }
        },
        edit(transform) {
            if (typeof transform !== 'function') fail('lifecycle/command');
            return localTask(async c => {
                const stored = await c.session.db.ler(`estado:${c.owner.uid}`), queue = await c.session.service.lerFila(c.owner.uid);
                const next = structuredClone(stored.dados), result = transform(next);
                if (result?.then) fail('lifecycle/async-command');
                const receipt = await c.session.service.aplicarEdicao(c.owner.uid, stored.dados, next,
                    (changes, q) => changes.map(value => { const key = recordEntityKey(value), prior = q.outbox.filter(op => op.entityKey === key).at(-1);
                        return makeOperation(key, value, prior && q.attempted?.[prior.id] ? prior.id : q.remoteRevisions?.[key] || null); }),
                    (q, state) => { if (JSON.stringify(financeSettings(stored.dados)) !== JSON.stringify(financeSettings(state))) { q.automaticSettingsDirty = true; q.automaticSettingsValue = financeSettings(state); } },
                    () => c.session.isCurrent(), queue.generation);
                return { durable: true, owner: c.owner, revision: receipt.estado.revisao };
            });
        },
        async send(commit) {
            const c = capture(); if (ownership !== 'confirmed') fail('lifecycle/owner-unconfirmed');
            if (typeof commit !== 'function') fail('lifecycle/command');
            try {
                return await c.session.service.enviarFila(c.owner.uid, async (uid, op) => {
                    check(c); const ack = await commit(uid, op); check(c);
                    // The real SDK correlates ACK by this commit invocation, without
                    // echoing ID/generation. Validate echoes too when transport has them.
                    if (ack?.acknowledged !== true || (ack.operationId !== undefined && ack.operationId !== op.id)
                        || (ack.generation !== undefined && ack.generation !== (op.generation || 'legacy'))) fail('lifecycle/invalid-ack');
                    return ack;
                }, () => active(c.token), () => active(c.token));
            } catch (e) { if (active(c.token) && !['lifecycle/invalid-ack'].includes(e.code)) failureState(e, c.token); throw e; }
        },
        close(reason = 'lock') {
            if (!['lock', 'logout', 'suspend'].includes(reason)) fail('lifecycle/transition');
            intent++;
            return closeNow(reason);
        },
        // pagehide MUST synchronously remove entry points; browser delivery/drain
        // is not guaranteed. Resume never reuses a DEK or silently unlocks.
        suspend() { intent++; return closeNow('suspend'); },
        async resume() {
            const request = ++intent;
            await (closing || Promise.resolve());
            if (request !== intent) fail('lifecycle/stale-session');
            await closeNow('lock');
            if (request !== intent) fail('lifecycle/stale-session');
            if (owner) { ownership = 'unconfirmed'; emit('locked'); }
        }
    };
    return Object.freeze(api);
}
