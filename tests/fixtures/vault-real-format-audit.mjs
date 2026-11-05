// Real SDK type only. No Firebase app/Auth/Firestore instance or network setup.
import { Timestamp } from 'firebase/firestore';
import { createFinancialCodec } from '../../finance-vault-codec.js';
import { realFinancialFixture, auditOwner } from './vault-independent-audit.mjs';
export function realTimestampCodec() {
    return createFinancialCodec({ adapters: [{ tag: 'custom:firestore-timestamp:v1', matches: v => v instanceof Timestamp,
        encode: v => ({ seconds: v.seconds, nanoseconds: v.nanoseconds }), decode: v => new Timestamp(v.seconds, v.nanoseconds) }] });
}
export function realSdkFixture() {
    const data = realFinancialFixture();
    data[`fila:${auditOwner.uid}`].settingsBaseline.updatedAt = new Timestamp(1793275200, 123456789);
    data[`fila:${auditOwner.uid}`].conflicts[0].remote.updatedAt = new Timestamp(1793275201, 987654321);
    data[`estado:${auditOwner.uid}`].unknownLegacy = { optional: undefined, rawBytes: new Uint8Array([0, 255]), date: new Date('2026-10-29T12:00:00Z') };
    return data;
}
export function realFormatAudit() {
    const codec = realTimestampCodec(), original = realSdkFixture(), bytes = codec.encode(original), decoded = codec.decode(bytes);
    const direct = JSON.stringify([...codec.encode(decoded)]) === JSON.stringify([...bytes])
        && decoded[`fila:${auditOwner.uid}`].settingsBaseline.updatedAt instanceof Timestamp;
    const clone = structuredClone(original), standard = createFinancialCodec();
    const persisted = JSON.stringify([...standard.encode(clone)]) === JSON.stringify([...standard.encode(standard.decode(standard.encode(clone)))]);
    const wire = JSON.parse(new TextDecoder().decode(codec.encode(new Timestamp(1, 5))));
    let changed = false;
    function mutate(v) {
        if (!Array.isArray(v)) return;
        if (v[0] === 'array' && v[1]?.[0] === 2 && Array.isArray(v[1]?.[1])) {
            const entries = v[1][1], key = entries.find(pair => pair[0] === 0), value = entries.find(pair => pair[0] === 1);
            if (key?.[1]?.[0] === 'string' && key[1][1] === 'nanoseconds' && value?.[1]?.[0] === 'number') { value[1] = ['number', '2000000000']; changed = true; return; }
        }
        for (const item of v) mutate(item);
    }
    mutate(wire); if (!changed) throw new Error('Synthetic malformed timestamp probe not armed');
    let accepted = false, sdkRejects = false;
    try {
        const value = codec.decode(new TextEncoder().encode(JSON.stringify(wire)));
        accepted = value instanceof Timestamp && value.nanoseconds === 2000000000;
        try { new Timestamp(value.seconds, value.nanoseconds); } catch { sdkRejects = true; }
    } catch { /* A secure decoder rejects contradictory typed payloads. */ }
    return [
        { id: 'P01', name: 'real financial formats and real Timestamp round-trip', secure: direct },
        { id: 'P02', name: 'actual structuredClone persistence shape round-trip without adapter', secure: persisted },
        { id: 'A07', name: 'typed properties cannot bypass Timestamp validation', secure: !(accepted && sdkRejects), observation: { acceptedInvalidTimestamp: accepted, sdkConstructorRejects: sdkRejects } }
    ];
}
