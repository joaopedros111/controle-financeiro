// Isolated protocol v1. No imports from the production UI or legacy sync.
export const PROTOCOL = 1;
export const ENTITY_COLLECTIONS = ['records', 'categories', 'budgets', 'settings'];
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function assertIdentity(value) {
    if (!identifier(value)) throw new TypeError('Invalid protocol identity');
    return value;
}
export function epochPath(uid, epoch) {
    return `users/${assertIdentity(uid)}/financeEpochs/${assertIdentity(epoch)}`;
}
export function entityPath(command) {
    validateCommand(command);
    return `${epochPath(command.uid, command.epoch)}/${command.collection}/${command.entityId}`;
}
export function newStableId() {
    return globalThis.crypto.randomUUID();
}
export function validateCommand(command) {
    const keys = ['protocol', 'uid', 'epoch', 'operationId', 'collection', 'entityId', 'baseRevision', 'action', 'payload'];
    if (!command || Object.keys(command).length !== keys.length || keys.some(key => !Object.hasOwn(command, key))
        || command.protocol !== PROTOCOL || !ENTITY_COLLECTIONS.includes(command.collection)
        || !['put', 'delete'].includes(command.action)
        || !Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0
        || command.baseRevision >= Number.MAX_SAFE_INTEGER
        || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)
        || command.action === 'delete' && Object.keys(command.payload).length) throw new TypeError('Invalid command');
    for (const key of ['uid', 'epoch', 'operationId', 'entityId']) assertIdentity(command[key]);
    if (command.collection === 'settings' && command.entityId !== 'finance') throw new TypeError('Invalid settings identity');
    return command;
}
export function makeCommand({ uid, epoch, collection = 'records', entityId = newStableId(),
    operationId = newStableId(), baseRevision = 0, action = 'put', payload = {} }) {
    return structuredClone(validateCommand({ protocol: PROTOCOL, uid, epoch, operationId, collection,
        entityId, baseRevision, action, payload }));
}
const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const sameCommand = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
