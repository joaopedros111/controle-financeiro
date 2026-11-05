import { recordEntityKey, validConflictRecord, functionalSettings } from '../../sync-core.js';
// Explicit simulated protocol; never initializes an SDK or performs network I/O.
export function syntheticWriteRemote() {
    const accounts = new Map(); let failure = null, lost = false;
    function state(owner) {
        if (!owner.projectId.startsWith('demo-') || !owner.uid.startsWith('synthetic-')) throw new Error('Synthetic owner required');
        const key = JSON.stringify([owner.projectId, owner.uid]);
        if (!accounts.has(key)) accounts.set(key, { records: new Map(), receipts: new Map(), settings: null, writes: 0 }); return accounts.get(key);
    }
    function preflight() { if (failure) { const code = failure; failure = null; throw Object.assign(new Error('Synthetic server rejection'), { code }); } }
    function deliver(result) { if (lost) { lost = false; throw Object.assign(new Error('Synthetic lost ACK'), { code: 'unavailable' }); } return structuredClone(result); }
    function replay(s, op) { const receipt = s.receipts.get(op.id); if (!receipt) return null; if (receipt.payload !== JSON.stringify(op)) throw new Error('Divergent idempotency payload'); return receipt.result; }
    return {
        failNext(code = 'unavailable') { failure = code; }, loseNextAck() { lost = true; },
        async commit(owner, op) {
            preflight(); const s = state(owner);
            if (!validConflictRecord(op.value) || recordEntityKey(op.value) !== op.entityKey) throw new Error('Invalid operation');
            const prior = replay(s, op); if (prior) return deliver(prior);
            const remote = s.records.get(op.entityKey), conflict = (remote?.revision || null) !== (op.baseRevision || null) || remote?.deleted && !op.value.deleted;
            const result = { acknowledged: true, conflict: !!conflict, revision: conflict ? remote?.revision || null : op.id, ...(conflict ? { remote: remote || null } : {}) };
            if (!conflict) { s.records.set(op.entityKey, { ...structuredClone(op.value), revision: op.id }); s.writes++; }
            s.receipts.set(op.id, { payload: JSON.stringify(op), result: structuredClone(result) }); return deliver(result);
        },
        async commitSettings(owner, op) {
            preflight(); const s = state(owner), value = functionalSettings(op.value); if (!value) throw new Error('Invalid settings');
            const prior = replay(s, op); if (prior) return deliver(prior);
            const conflict = (s.settings?.revision || null) !== (op.baseRevision || null);
            const result = { acknowledged: true, conflict, revision: conflict ? s.settings.revision : op.id, ...(conflict ? { remote: structuredClone(s.settings) } : {}) };
            if (!conflict) { s.settings = { ...value, revision: op.id }; s.writes++; }
            s.receipts.set(op.id, { payload: JSON.stringify(op), result: structuredClone(result) }); return deliver(result);
        },
        inspect(owner) { const s = state(owner); return structuredClone({ records: [...s.records], receipts: [...s.receipts], settings: s.settings, writes: s.writes }); }
    };
}
