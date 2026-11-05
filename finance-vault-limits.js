// Shared resource profile: bounded per-document work and aggregate recovery.
export const MAX_FINANCIAL_BYTES = 8 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 28 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
export class VaultCapacityError extends Error {
    constructor() { super('Capacidade documentada do cofre excedida.'); this.name = 'VaultCapacityError'; this.code = 'capacity-exceeded'; }
}
const invalid = () => { const error = new Error('Invalid document map'); error.code = 'invalid-input'; throw error; };
export function copyDocumentMap(documents, encode, decode) {
    if (!documents || ![Object.prototype, null].includes(Object.getPrototypeOf(documents)) || Reflect.ownKeys(documents).length > 1000) invalid();
    const result = Object.create(null); let total = 0;
    for (const id of Reflect.ownKeys(documents)) {
        const descriptor = Object.getOwnPropertyDescriptor(documents, id);
        if (typeof id !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
        const bytes = encode(descriptor.value);
        try {
            total += bytes.length;
            if (total > MAX_FINANCIAL_BYTES) throw new VaultCapacityError();
            result[id] = decode(bytes);
        } finally { bytes.fill(0); }
    }
    return result;
}
