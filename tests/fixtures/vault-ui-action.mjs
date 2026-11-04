// Await a REAL click handler without modifying the experimental UI module.
// Completion is not inferred from a financial snapshot that may change generation.
export async function clickAndWait(page, id) {
    const key = `__syntheticAction_${crypto.randomUUID()}`;
    await page.evaluate(({ id, key }) => {
        const button = document.getElementById(id), handler = button?.onclick;
        if (!button || button.disabled || typeof handler !== 'function') throw new Error('Synthetic action unavailable');
        let resolve, reject; const settled = new Promise((yes, no) => { resolve = yes; reject = no; }); settled.catch(() => {});
        const wrapper = function (event) {
            try { const result = handler.call(this, event);
                if (!result || typeof result.then !== 'function') throw new Error('Synthetic action must return its completion Promise');
                Promise.resolve(result).then(resolve, reject); return result;
            } catch (error) { reject(error); }
        };
        globalThis[key] = { button, handler, wrapper, settled }; button.onclick = wrapper;
    }, { id, key });
    try {
        await page.click(`#${id}`);
        await page.evaluate(async key => {
            let timer;
            try { await Promise.race([globalThis[key].settled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic action completion timeout')), 45000); })]); }
            finally { clearTimeout(timer); }
            const error = document.getElementById('action-error')?.textContent || document.getElementById('error')?.textContent;
            if (error) throw new Error(`Synthetic action failed: ${error}`);
        }, key);
    } finally {
        await page.evaluate(key => { const a = globalThis[key]; if (!a) return; if (a.button.onclick === a.wrapper) a.button.onclick = a.handler; delete globalThis[key]; }, key);
    }
}
