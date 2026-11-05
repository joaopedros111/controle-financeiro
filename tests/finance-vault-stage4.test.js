import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createFinancialCodec } from '../finance-vault-codec.js';
import { stage4Cases, stage4Codec, stage4Documents, SyntheticTimestamp } from './fixtures/vault-stage4-scenarios.mjs';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { createVaultController } from '../finance-vault-controller.js';
import { vaultDigest } from '../finance-vault-recovery.js';
import { stage4Owner, stage4Vault, stage4Password } from './fixtures/vault-stage4-scenarios.mjs';
for (const scenario of stage4Cases({ makeStore: async () => memoryVaultFactory(), crypto: webcrypto })) test(`vault stage4: ${scenario.name}`, scenario.run);
test('financial codec: exact round-trip of financial graphs, optional fields, SDK adapter and legacy structures', () => {
    const codec = stage4Codec(), data = stage4Documents();
    assert.deepStrictEqual(codec.decode(codec.encode(data)), data);
    assert.ok(codec.decode(codec.encode(new SyntheticTimestamp(1, 999999999))) instanceof SyntheticTimestamp);
    const typed = new Uint8Array([1, 2]); typed.extra = 'must not disappear';
    assert.throws(() => codec.encode(typed), { code: 'codec-invalid' });
    assert.throws(() => codec.encode(new Array(100001)), { code: 'codec-invalid' });
});
test('financial codec: lossless scalar, null prototype, sparse array, precision and prototype-safe keys', () => {
    const sparse = new Array(3); sparse[1] = undefined;
    const data = { amount: 0.1 + 0.2, negativeZero: -0, nan: NaN, infinity: Infinity, undefined, huge: 12345678901234567890n,
        bytes: new Uint8Array([0, 255]), sparse, date: new Date(NaN), plainTimestamp: { seconds: 1, nanoseconds: 9 }, legacy: Object.assign(Object.create(null), { amount: 0.01 }) };
    Object.defineProperty(data, '__proto__', { value: { safe: true }, enumerable: true });
    const codec = createFinancialCodec(); assert.deepStrictEqual(codec.decode(codec.encode(data)), data); assert.equal({}.safe, undefined);
});
test('financial codec: unsupported versions/types, accessors, cycles and unknown adapters fail without invoking getters', () => {
    const codec = createFinancialCodec(); let calls = 0; const accessor = { get secret() { calls++; return 'secret'; } };
    const cycle = {}; cycle.self = cycle;
    for (const value of [accessor, cycle, new Map(), new SyntheticTimestamp(1, 1), () => {}]) assert.throws(() => codec.encode(value), { code: 'codec-invalid' });
    assert.equal(calls, 0);
    for (const wire of [['cf-financial-codec', 2, ['null', null]], ['cf-financial-codec', 1, ['object', [['duplicate', ['null', null]], ['duplicate', ['null', null]]]]]]) {
        assert.throws(() => codec.decode(new TextEncoder().encode(JSON.stringify(wire))), { code: 'codec-invalid' });
    }
    assert.throws(() => codec.decode(stage4Codec().encode(new SyntheticTimestamp(1, 1))), { code: 'codec-invalid' });
});
test('vault stage4: direct UUID/digest provider errors do not expose secrets or initialize data', async () => {
    const secret = 'synthetic-sensitive-provider-message', storage = memoryVaultFactory();
    const controller = createVaultController({ store: storage.store, owner: stage4Owner, vaultId: stage4Vault, codec: stage4Codec(), channelFactory: () => null,
        crypto: { randomUUID() { throw new Error(secret); } } });
    try {
        await assert.rejects(controller.create({ password: stage4Password, generation: 'generation-a', documents: stage4Documents() }), error => error.code === 'crypto-failed' && !error.stack.includes(secret));
        assert.equal((await storage.inspect()).snapshots.length, 0);
        await assert.rejects(vaultDigest(new Uint8Array(), { subtle: { digest() { throw new Error(secret); } } }), error => error.code === 'invalid-package' && !error.stack.includes(secret));
    } finally { controller.close(); }
});
