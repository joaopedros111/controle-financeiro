import test from 'node:test';
import assert from 'node:assert/strict';
import { realSdkFixture, realTimestampCodec } from './fixtures/vault-real-format-audit.mjs';
import { createFinancialCodec } from '../finance-vault-codec.js';
import { validarBackup } from '../finance-core.js';
import { auditOwner } from './fixtures/vault-independent-audit.mjs';
import { Timestamp } from 'firebase/firestore';
test('independent audit: real SDK Timestamp and real financial field names survive codec round-trip', () => {
    const fixture = realSdkFixture(), codec = realTimestampCodec();
    assert.equal(validarBackup(fixture[`estado:${auditOwner.uid}`].dados), true);
    assert.deepStrictEqual(codec.decode(codec.encode(fixture)), fixture);
});
test('independent audit: structuredClone SDK shape used by current persistence needs no type coercion', () => {
    const persisted = structuredClone(realSdkFixture()), codec = createFinancialCodec();
    assert.deepStrictEqual(codec.decode(codec.encode(persisted)), persisted);
});

test('real SDK Timestamp: boundary values survive and malformed final values are rejected', () => {
    const codec = realTimestampCodec();
    for (const [seconds, nanoseconds] of [[-62135596800, 0], [253402300799, 999999999]]) {
        const value = new Timestamp(seconds, nanoseconds);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
    }
    for (const [seconds, nanoseconds] of [[NaN, 0], [Infinity, 0], [1.5, 0], [-62135596801, 0], [253402300800, 0], [0, -1], [0, 1e9], [0, NaN], [0, 0.1]]) {
        // Mutate real writable SDK fields: instanceof alone cannot validate them.
        const value = new Timestamp(1, 5); value.seconds = seconds; value.nanoseconds = nanoseconds;
        assert.throws(() => codec.encode(value), { code: 'codec-invalid' });
    }
    const wire = JSON.parse(new TextDecoder().decode(codec.encode(new Timestamp(1, 5))));
    function alter(value) {
        if (!Array.isArray(value)) return;
        if (value[0] === 'number' && value[1] === '5') value[1] = 'NaN';
        else value.forEach(alter);
    }
    alter(wire);
    assert.throws(() => codec.decode(new TextEncoder().encode(JSON.stringify(wire))), { code: 'codec-invalid' });
});
