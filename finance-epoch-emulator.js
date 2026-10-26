// Stage-one adapter: deliberately refuses non-local/non-demo environments.
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { epochPath, entityPath, validateCommand, sameCommand } from './finance-epoch.js';

export function assertEmulator(db) {
    db = db?._delegate || db;
    const settings = db?.toJSON?.()?.settings;
    if (!/^demo-[a-z0-9-]+$/.test(db?.app?.options?.projectId || '')
        || !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(settings?.host || '') || settings.ssl !== false) {
        throw new Error('Local demo emulator required');
    }
}

export async function commitEpochOperation(db, input) {
    assertEmulator(db);
    const command = structuredClone(validateCommand(input));
    const controlRef = doc(db, `users/${command.uid}/control/finance`);
    const entityRef = doc(db, entityPath(command));
    const operationRef = doc(db, `${epochPath(command.uid, command.epoch)}/operations/${command.operationId}`);
    const execute = () => runTransaction(db, async transaction => {
        const [control, operation, entity] = await Promise.all([
            transaction.get(controlRef), transaction.get(operationRef), transaction.get(entityRef)
        ]);
        if (!control.exists() || control.data().protocol !== 1 || control.data().activeEpoch !== command.epoch
            || control.data().status !== 'active') throw Object.assign(new Error('Inactive generation'), { code: 'epoch/inactive' });
        if (operation.exists()) {
            if (!sameCommand(operation.data().command, command)) throw Object.assign(new Error('Operation ID reused'), { code: 'epoch/id-reused' });
            return { status: 'applied', duplicate: true, revision: operation.data().resultRevision };
        }
        const current = entity.exists() ? entity.data() : null;
        if ((current?.revision || 0) !== command.baseRevision || current?.deleted
            || command.action === 'delete' && !current) {
            return { status: 'conflict', command, current };
        }
        const revision = command.baseRevision + 1;
        transaction.set(entityRef, { payload: command.payload, deleted: command.action === 'delete',
            revision, operationId: command.operationId, updatedAt: serverTimestamp() });
        transaction.set(operationRef, { command, resultRevision: revision, appliedAt: serverTimestamp() });
        return { status: 'applied', duplicate: false, revision };
    });
    // A revision guard can deny a transaction whose reads raced another commit.
    // Re-read once in a fresh transaction: return the conflict (or propagate a
    // genuine authorization failure). Never change the original base revision.
    try { return await execute(); }
    catch (error) {
        if (error.code !== 'permission-denied') throw error;
        return execute();
    }
}
