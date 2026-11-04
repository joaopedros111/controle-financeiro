import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { clickAndWait } from './fixtures/vault-ui-action.mjs';
function fakePage(handler, error = '') {
    const button = { onclick: handler, disabled: false }, errors = { 'action-error': { textContent: error }, error: { textContent: '' } };
    const context = vm.createContext({ document: { getElementById: id => id === 'restore-fixture' ? button : errors[id] }, setTimeout, clearTimeout });
    return { button, context, errors,
        async evaluate(fn, args) { context.args = args; return vm.runInContext(`(${fn.toString()})(args)`, context); },
        async click() { button.onclick.call(button, { type: 'click' }); }
    };
}
test('real click completion is awaited; event dispatch alone does not release snapshot assertions', async () => {
    let release, entered; const began = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; }); let finished = false;
    const original = async () => { entered(); await gate; }, page = fakePage(original);
    const pending = clickAndWait(page, 'restore-fixture').then(() => { finished = true; }); await began; assert.equal(finished, false);
    release(); await pending; assert.equal(finished, true); assert.equal(page.button.onclick, original); assert.equal(Object.keys(page.context).filter(k => k.startsWith('__syntheticAction')).length, 0);
});
test('handler rejection, including cancellation, is propagated and original handler restored', async () => {
    const original = async () => { throw new Error('cancelled'); }, page = fakePage(original);
    await assert.rejects(clickAndWait(page, 'restore-fixture'), /cancelled/); assert.equal(page.button.onclick, original);
});
test('UI action error cannot be mistaken for successful completion', async () => {
    const original = async () => {}, page = fakePage(original, 'storage-failed');
    await assert.rejects(clickAndWait(page, 'restore-fixture'), /storage-failed/); assert.equal(page.button.onclick, original);
});
test('synchronous handler cannot pretend to represent asynchronous completion', async () => {
    const original = () => {}, page = fakePage(original);
    await assert.rejects(clickAndWait(page, 'restore-fixture'), /completion Promise/); assert.equal(page.button.onclick, original);
});
test('disabled actions are rejected before dispatch', async () => {
    const page = fakePage(async () => {}); page.button.disabled = true;
    await assert.rejects(clickAndWait(page, 'restore-fixture'), /unavailable/);
});
