import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCommand, entityPath, sameCommand, newStableId } from '../finance-epoch.js';
import { assertEmulator } from '../finance-epoch-emulator.js';
import { readFile } from 'node:fs/promises';

test('epoch: stable identity is independent of financial content and month', () => {
    const first = makeCommand({ uid: 'alice', epoch: 'e1', payload: { month: '2026-10' } });
    const edit = makeCommand({ ...first, operationId: newStableId(), baseRevision: 1, payload: { month: '2026-11' } });
    assert.equal(entityPath(first), entityPath(edit));
    assert.notEqual(first.operationId, edit.operationId);
    assert.equal(sameCommand(first, structuredClone(first)), true);
    assert.equal(sameCommand(first, edit), false);
});
test('epoch: rejects traversal, invalid revision and destructive malformed commands', () => {
    const input = { uid: 'alice', epoch: 'e1', payload: {} };
    for (const change of [{ uid: '../bob' }, { epoch: 'a/b' }, { baseRevision: -1 },
        { baseRevision: 1.5 }, { baseRevision: Number.MAX_SAFE_INTEGER }, { action: 'delete', payload: { x: 1 } },
        { collection: 'operations' }, { collection: 'settings', entityId: 'other' }]) {
        assert.throws(() => makeCommand({ ...input, ...change }));
    }
});
test('epoch: emulator adapter fails closed for real projects and remote hosts', () => {
    for (const [projectId, host, ssl] of [['real-project', '127.0.0.1:8080', false],
        ['demo-test', 'firestore.googleapis.com', true], ['demo-test', '192.168.1.1:8080', false]]) {
        assert.throws(() => assertEmulator({ app: { options: { projectId } }, toJSON: () => ({ settings: { host, ssl } }) }));
    }
});
test('epoch: production entry points and Firebase config remain disconnected', async () => {
    for (const file of ['app.js', 'sw.js', 'firebase-sync-entry.js', 'scripts/prepare-pages.mjs', 'firebase.json']) {
        assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /finance-epoch|firestore\.epoch/);
    }
});
