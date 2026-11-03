// Remote durability is simulated in RAM. This is not Firestore or an SDK cache.
export function simulatedVaultTransport() {
    const accounts = new Map(); let lose = false;
    const scope = owner => {
        if (!owner.projectId.startsWith('demo-') || !owner.uid.startsWith('synthetic-')) throw new Error('Synthetic accounts only');
        const key = JSON.stringify([owner.projectId, owner.uid]);
        if (!accounts.has(key)) accounts.set(key, { records: new Map(), acknowledgements: new Map(), writes: 0 });
        return accounts.get(key);
    };
    return {
        loseNextAcknowledgement() { lose = true; },
        async commit(owner, op) {
            const account = scope(owner), prior = account.acknowledgements.get(op.id), serialized = JSON.stringify(op);
            if (prior && prior.serialized !== serialized) throw Object.assign(new Error('Divergent operation'), { code: 'invalid-operation' });
            let result = prior?.result;
            if (!result) {
                const remote = account.records.get(op.entityKey);
                const conflict = (remote?.revision || null) !== (op.baseRevision || null);
                result = { acknowledged: true, conflict, revision: conflict ? remote?.revision || null : op.id, ...(conflict ? { remote: remote || null } : {}) };
                if (!conflict) { account.records.set(op.entityKey, { ...structuredClone(op.value), revision: op.id }); account.writes++; }
                account.acknowledgements.set(op.id, { serialized, result: structuredClone(result) });
            }
            if (lose) { lose = false; throw Object.assign(new Error('Synthetic lost ACK'), { code: 'unavailable' }); }
            return structuredClone(result);
        },
        inspect(owner) { const a = scope(owner); return structuredClone({ records: [...a.records], acknowledgements: [...a.acknowledgements], writes: a.writes }); }
    };
}
