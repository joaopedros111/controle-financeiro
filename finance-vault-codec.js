// Lossless tagged codec. No financial normalization, SDK, storage or side effects.
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
export class VaultCodecError extends Error {
    constructor() { super('Formato ou tipo incompatível com o codec financeiro.'); this.name = 'VaultCodecError'; this.code = 'codec-invalid'; }
}
const bad = () => { throw new VaultCodecError(); };
const string = v => { if (typeof v !== 'string' || !v.isWellFormed()) bad(); return v; };
const plain = v => v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function validateTyped(adapter, value) {
    if (!adapter.matches(value)) bad();
    // These versioned adapter tags declare the Firestore Timestamp contract.
    if (['custom:timestamp:v1', 'custom:firestore-timestamp:v1'].includes(adapter.tag)) {
        if (!Number.isInteger(value.seconds) || value.seconds < -62135596800 || value.seconds > 253402300799
            || !Number.isInteger(value.nanoseconds) || value.nanoseconds < 0 || value.nanoseconds > 999999999) bad();
    }
    if (adapter.validate && adapter.validate(value) !== true) bad();
}
export function createFinancialCodec({ adapters = [] } = {}) {
    const tags = new Set();
    for (const a of adapters) {
        if (!/^custom:[a-z0-9-]+:v[1-9][0-9]*$/.test(a.tag) || tags.has(a.tag) || !['matches', 'encode', 'decode'].every(k => typeof a[k] === 'function') || (a.validate !== undefined && typeof a.validate !== 'function')) bad();
        tags.add(a.tag);
    }
    function transform(value, reading) {
        let nodes = 0; const active = new Set();
        function walk(v, depth = 0) {
            if (++nodes > 100000 || depth > 64) bad();
            if (reading) {
                if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'string') bad();
                const [tag, p] = v;
                switch (tag) {
                    case 'null': if (p !== null) bad(); return null;
                    case 'undefined': if (p !== null) bad(); return undefined;
                    case 'boolean': if (typeof p !== 'boolean') bad(); return p;
                    case 'string': return string(p);
                    case 'number': {
                        string(p); const n = p === '-0' ? -0 : Number(p);
                        if (!['NaN', 'Infinity', '-Infinity', '-0'].includes(p) && (!Number.isFinite(n) || String(n) !== p)) bad();
                        return n;
                    }
                    case 'bigint': if (typeof p !== 'string' || !/^(0|-?[1-9][0-9]*)$/.test(p) || p.length > 4096) bad(); return BigInt(p);
                    case 'date': { if (p === null) return new Date(NaN); const date = new Date(p); if (!Number.isFinite(date.getTime()) || date.toISOString() !== p) bad(); return date; }
                    case 'bytes': if (!Array.isArray(p) || p.length > 16 * 1024 * 1024 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) bad(); return Uint8Array.from(p);
                    case 'array': {
                        if (!Array.isArray(p) || p.length !== 2 || !Number.isSafeInteger(p[0]) || p[0] < 0 || p[0] > 100000 || !Array.isArray(p[1])) bad();
                        const out = new Array(p[0]), seen = new Set();
                        for (const item of p[1]) { if (!Array.isArray(item) || item.length !== 2 || !Number.isSafeInteger(item[0]) || item[0] < 0 || item[0] >= out.length || seen.has(item[0])) bad(); seen.add(item[0]); out[item[0]] = walk(item[1], depth + 1); }
                        return out;
                    }
                    case 'object': case 'null-object': {
                        if (!Array.isArray(p)) bad(); const out = tag === 'object' ? {} : Object.create(null), seen = new Set();
                        for (const item of p) { if (!Array.isArray(item) || item.length !== 2 || seen.has(string(item[0]))) bad(); seen.add(item[0]); Object.defineProperty(out, item[0], { value: walk(item[1], depth + 1), enumerable: true, writable: true, configurable: true }); }
                        return out;
                    }
                    default: {
                        const adapter = adapters.find(a => a.tag === tag); if (!adapter) bad();
                        const payload = walk(p, depth + 1);
                        if (!plain(payload) || Object.keys(payload).sort().join() !== 'properties,representation' || !Array.isArray(payload.properties)) bad();
                        const decoded = adapter.decode(payload.representation), seen = new Set();
                        if (!adapter.matches(decoded)) bad();
                        for (const item of payload.properties) {
                            if (!Array.isArray(item) || item.length !== 2 || seen.has(string(item[0]))) bad(); seen.add(item[0]);
                        }
                        if (Reflect.ownKeys(decoded).some(k => typeof k !== 'string' || !seen.has(k))) bad();
                        for (const [key, value] of payload.properties) {
                            const d = Object.getOwnPropertyDescriptor(decoded, key);
                            if (d && (!d.enumerable || !Object.hasOwn(d, 'value'))) bad();
                            if (d) {
                                // Constructor-validated semantic fields are immutable at this boundary.
                                if (JSON.stringify(transform(d.value, false)) !== JSON.stringify(transform(value, false))) bad();
                            } else {
                                if (key in decoded) bad();
                                Object.defineProperty(decoded, key, { value, enumerable: true, writable: true, configurable: true });
                            }
                        }
                        validateTyped(adapter, decoded); return decoded;
                    }
                }
            }
            if (v === null) return ['null', null];
            if (v === undefined) return ['undefined', null];
            if (typeof v === 'string') return ['string', string(v)];
            if (typeof v === 'boolean') return ['boolean', v];
            if (typeof v === 'number') return ['number', Object.is(v, -0) ? '-0' : String(v)];
            if (typeof v === 'bigint') { if (String(v).length > 4096) bad(); return ['bigint', String(v)]; }
            if (typeof v !== 'object' || active.has(v)) bad(); active.add(v);
            try {
                if (v instanceof Date && Object.getPrototypeOf(v) === Date.prototype) { if (Reflect.ownKeys(v).length) bad(); return ['date', Number.isNaN(v.getTime()) ? null : v.toISOString()]; }
                if (v instanceof Uint8Array && Object.getPrototypeOf(v) === Uint8Array.prototype) {
                    if (Reflect.ownKeys(v).some(k => typeof k !== 'string' || !/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) bad();
                    return ['bytes', [...v]];
                }
                const matching = adapters.filter(a => a.matches(v));
                if (matching.length > 1) bad();
                if (matching.length) {
                    validateTyped(matching[0], v);
                    const properties = [];
                    for (const key of Reflect.ownKeys(v)) {
                        const d = Object.getOwnPropertyDescriptor(v, key);
                        if (typeof key !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value')) bad();
                        properties.push([string(key), d.value]);
                    }
                    return [matching[0].tag, walk({ representation: matching[0].encode(v), properties }, depth + 1)];
                }
                if (!Array.isArray(v) && !plain(v)) bad();
                if (Array.isArray(v) && v.length > 100000) bad();
                const items = [];
                for (const k of Reflect.ownKeys(v)) {
                    if (Array.isArray(v) && k === 'length') continue;
                    const d = Object.getOwnPropertyDescriptor(v, k);
                    if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value')) bad();
                    if (Array.isArray(v) && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) bad();
                    items.push([Array.isArray(v) ? Number(k) : string(k), walk(d.value, depth + 1)]);
                }
                return Array.isArray(v) ? ['array', [v.length, items]] : [Object.getPrototypeOf(v) === null ? 'null-object' : 'object', items];
            } finally { active.delete(v); }
        }
        return walk(value);
    }
    const safe = fn => value => { try { return fn(value); } catch { bad(); } };
    return Object.freeze({
        id: 'cf-financial-codec-v1',
        encode: safe(value => { const bytes = encoder.encode(JSON.stringify(['cf-financial-codec', 1, transform(value, false)])); if (bytes.length > 16 * 1024 * 1024) bad(); return bytes; }),
        decode: safe(bytes => {
            if (!(bytes instanceof Uint8Array) || bytes.length > 16 * 1024 * 1024) bad();
            const text = decoder.decode(bytes), wire = JSON.parse(text);
            if (!Array.isArray(wire) || wire.length !== 3 || wire[0] !== 'cf-financial-codec' || wire[1] !== 1 || JSON.stringify(wire) !== text) bad();
            return transform(wire[2], true);
        })
    });
}
