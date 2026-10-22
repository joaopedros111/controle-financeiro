import { test, expect } from "@playwright/test";

const project = "demo-controle-financeiro";
const authURL = "http://127.0.0.1:9099", firestoreURL = "http://127.0.0.1:8080";
const stateKey = (uid) => `controleFinanceiro:v3:uid:${uid}`;
const metaKey = (uid) => `controleFinanceiro:sync:${uid}`;
async function stored(page, key) { return page.evaluate(async key => {
    const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('controleFinanceiro:integridade:v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try {
        const documentKey = key.startsWith('controleFinanceiro:sync:') ? 'fila:'+key.split(':').at(-1)
            : key.startsWith('controleFinanceiro:v3:uid:') ? 'estado:'+key.split(':').at(-1) : key === 'controleFinanceiro:v3' ? 'estado:@local' : null;
        if (!documentKey) return JSON.parse(localStorage.getItem(key) || 'null');
        const doc = await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readonly');let value;
            const r=tx.objectStore('documents').get(documentKey);r.onsuccess=()=>value=r.result;
            tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error);});
        return documentKey.startsWith('estado:') ? doc?.dados : doc;
    } finally {db.close();}
}, key); }
async function incomes(page, uid) { const state = await stored(page, stateKey(uid)); return Object.values(state?.meses || {}).flatMap((month) => month.receitas || []); }
async function createAccount(request, email) {
    const response = await request.post(`${authURL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only`,
        { data: { email, password: "synthetic-password-only", returnSecureToken: true } });
    expect(response.ok()).toBeTruthy(); return { ...(await response.json()), email };
}
async function prepare(context, page, email) {
    await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort("blockedbyclient");
    });
    await page.addInitScript((email) => { window.__testEmail = email; }, email);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/");
}
async function login(page, account) {
    await page.evaluate((email) => { window.__testEmail = email; }, account.email);
    await page.locator("#abrir-ajustes").click();
    await page.locator("#entrar-google").click();
    await expect(page.locator("#conta-sincronizacao")).toContainText(account.email);
    await expect.poll(async () => (await stored(page, metaKey(account.localId)))?.initialized).toBe(true);
    await expect.poll(async () => (await stored(page, metaKey(account.localId)))?.outbox?.length).toBe(0);
    await expect(page.locator("#estado-sincronizacao")).toHaveText("Sincronizado");
    await page.locator("#fechar-ajustes").click();
}
async function addIncome(page, name, amount) {
    await page.locator("#adicionar-receita").click();
    await page.locator("#receita-nome").fill(name);
    await page.locator("#receita-valor").fill(String(amount));
    await page.locator('#form-receita button[type="submit"]').click();
    await expect(page.locator("#dialogo-receita")).not.toBeVisible();
    await expect(page.locator("#aviso")).toContainText("confirmadas no armazenamento");
}
async function editIncome(page, amount) {
    if (!await page.locator("#conteudo-receitas").isVisible()) await page.locator('[aria-controls="conteudo-receitas"]').click();
    await page.locator(".editar-receita").first().click();
    await page.locator("#receita-valor").fill(String(amount));
    await page.locator('#form-receita button[type="submit"]').click();
}
async function remoteRecords(request, account) {
    const response = await request.get(`${firestoreURL}/v1/projects/${project}/databases/(default)/documents/users/${account.localId}/records`,
        { headers: { Authorization: `Bearer ${account.idToken}` } });
    expect(response.ok()).toBeTruthy(); return (await response.json()).documents || [];
}

test.beforeEach(async ({ request }) => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
    expect((await request.delete(`${firestoreURL}/emulator/v1/projects/${project}/databases/(default)/documents`)).ok()).toBeTruthy();
    expect((await request.delete(`${authURL}/emulator/v1/projects/${project}/accounts`)).ok()).toBeTruthy();
});

test.afterEach(async ({ context }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const snapshots = [];
    for (const page of context.pages()) {
        snapshots.push(await page.evaluate(() => ({ status: document.querySelector("#estado-sincronizacao")?.textContent,
            data: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("controleFinanceiro:"))) })).catch(() => ({ closed: true })));
    }
    await testInfo.attach("synthetic-state", { body: JSON.stringify(snapshots, null, 2), contentType: "application/json" });
});

test("A: criação offline, recarga do PWA e reconexão sem duplicação", async ({ context, page, request }) => {
    const account = await createAccount(request, "offline@local.test");
    await prepare(context, page, account.email); await login(page, account);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true); await addIncome(page, "Sintético offline", 0.29);
    await expect.poll(async () => (await stored(page, metaKey(account.localId)))?.outbox?.length).toBe(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#adicionar-receita")).toBeVisible();
    await expect(page.locator("#conta-sincronizacao")).toContainText(account.email);
    await expect.poll(async () => (await incomes(page, account.localId)).length).toBe(1);
    await context.setOffline(false);
    await expect.poll(async () => (await stored(page, metaKey(account.localId)))?.outbox?.length, { timeout: 30_000 }).toBe(0);
    await expect.poll(async () => (await remoteRecords(request, account)).length).toBe(1);
    expect((await incomes(page, account.localId))[0].valor).toBe(0.29);
});

test("B: duas sessões preservam revisão concorrente e permitem resolução", async ({ browser, context, page, request }) => {
    const account = await createAccount(request, "concurrent@local.test");
    await prepare(context, page, account.email); await login(page, account); await addIncome(page, "Sintético concorrente", 10);
    await expect.poll(async () => (await remoteRecords(request, account)).length).toBe(1);
    const second = await browser.newContext(), other = await second.newPage();
    try {
        await prepare(second, other, account.email); await login(other, account);
        await expect.poll(async () => (await incomes(other, account.localId)).length).toBe(1);
        await context.setOffline(true); await second.setOffline(true);
        await editIncome(page, 20);
    await expect.poll(async () => (await incomes(page, account.localId))[0]?.valor).toBe(20);
    await editIncome(other, 30);
        await context.setOffline(false);
        await expect.poll(async () => (await stored(page, metaKey(account.localId)))?.outbox?.length).toBe(0);
        await second.setOffline(false);
        await expect.poll(async () => (await stored(other, metaKey(account.localId)))?.conflicts?.filter((item) => item.kind !== "settings").length, { timeout: 30_000 }).toBeGreaterThan(0);
        expect((await incomes(other, account.localId))[0].valor).toBe(30);
        await other.locator("#abrir-ajustes").click(); await other.locator("#abrir-conflitos-sincronizacao").click();
        await other.getByRole("button", { name: "Manter versão local", exact: true }).first().click();
        await expect.poll(async () => (await stored(other, metaKey(account.localId)))?.conflicts?.filter((item) => item.kind !== "settings").length).toBe(0);
        const records = await remoteRecords(request, account);
        expect(records).toHaveLength(1);
        expect(Number(records[0].fields.record.mapValue.fields.valor.integerValue || records[0].fields.record.mapValue.fields.valor.doubleValue)).toBe(30);
    } finally { await second.close(); }
});

test("C: logout e troca de conta não apresentam dados ou fila de outro UID", async ({ context, page, request }) => {
    const alice = await createAccount(request, "alice@local.test"), bob = await createAccount(request, "bob@local.test");
    await prepare(context, page, alice.email); await login(page, alice); await addIncome(page, "Somente Alice", 123);
    await expect.poll(async () => (await stored(page, metaKey(alice.localId)))?.outbox?.length).toBe(0);
    await addIncome(page, "Remover somente Alice", 5);
    await expect.poll(async () => (await stored(page, metaKey(alice.localId)))?.outbox?.length).toBe(0);
    if (!await page.locator("#conteudo-receitas").isVisible()) await page.locator('[aria-controls="conteudo-receitas"]').click();
    await page.getByRole("button", { name: "Remover entrada Remover somente Alice", exact: true }).click();
    await expect(page.locator(".aviso-acao")).toHaveText("Desfazer");
    await page.locator("#abrir-ajustes").click(); await page.locator("#sair-google").click();
    await expect(page.locator("#conta-sincronizacao")).toBeEmpty();
    await expect(page.locator(".aviso-acao")).toHaveCount(0);
    await page.locator("#fechar-ajustes").click();
    await login(page, bob);
    expect(await incomes(page, bob.localId)).toHaveLength(0);
    expect(await remoteRecords(request, bob)).toHaveLength(0);
    expect((await stored(page, metaKey(bob.localId))).outbox).toHaveLength(0);
    expect(await incomes(page, alice.localId)).toHaveLength(1);
    await expect(page.locator("#lista-receitas")).not.toContainText("Somente Alice");
});

test("D: falha de gravação da fila preserva lançamento para recuperação após recarga", async ({ context, page, request }) => {
    const account = await createAccount(request, "recovery@local.test");
    await prepare(context, page, account.email); await login(page, account);
    await page.evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, key) {
            if (typeof key === 'string' && key.startsWith('fila:') && Object.keys(value.attempted || {}).length) throw new DOMException('synthetic quota', 'QuotaExceededError');
            return original.call(this, value, key);
        };
    });
    await addIncome(page, "Sintético preservado", 1.01);
    expect((await incomes(page, account.localId))[0].valor).toBe(1.01);
    expect(await remoteRecords(request, account)).toHaveLength(0);
    await page.reload(); // removes the injected fault; the financial state was durable
    await expect.poll(async () => (await remoteRecords(request, account)).length, { timeout: 30_000 }).toBe(1);
    expect(await incomes(page, account.localId)).toHaveLength(1);
});

test("E: HTML com sincronização desativada funciona localmente sem erro de inicialização", async ({ page }) => {
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/local-only.html");
    await addIncome(page, "Somente local", 0.29);
    const state = await stored(page, "controleFinanceiro:v3");
    expect(Object.values(state.meses).flatMap((month) => month.receitas)).toHaveLength(1);
    expect(errors).toEqual([]);
    await expect(page.locator("#entrar-google")).toHaveCount(0);
});

// Same browser context: shared Auth/IndexedDB/localStorage, separate application
// heaps. Offline is the explicit barrier preventing server snapshots from
// accidentally refreshing a stale tab before the second local save.
async function sharedTabs(context, page, request, email, initial = false) {
    const account = await createAccount(request, email);
    await prepare(context, page, account.email); await login(page, account);
    if (initial) {
        await addIncome(page, "Base compartilhada", 10);
        await expect.poll(async () => (await stored(page, metaKey(account.localId)))?.outbox?.length).toBe(0);
        await expect(page.locator("#estado-sincronizacao")).toHaveText("Sincronizado");
    }
    const other = await context.newPage(); other.on("dialog", (dialog) => dialog.accept());
    await other.addInitScript((email) => { window.__testEmail = email; }, account.email);
    await other.goto("/");
    await expect(other.locator("#conta-sincronizacao")).toContainText(account.email);
    await expect(other.locator("#estado-sincronizacao")).toHaveText("Sincronizado");
    if (initial) await expect(other.locator("#lista-receitas")).toContainText("Base compartilhada");
    await context.setOffline(true);
    return { account, other };
}

test("F: duas abas do mesmo contexto preservam criações sem exclusão implícita", async ({ context, page, request }) => {
    const { account, other } = await sharedTabs(context, page, request, "shared-create@local.test");
    await Promise.all([addIncome(page, "Criada na aba A", 20), addIncome(other, "Criada na aba B", 30)]);
    const saved = await incomes(other, account.localId), meta = await stored(other, metaKey(account.localId));
    expect.soft(saved.map((item) => item.nome).sort()).toEqual(["Criada na aba A", "Criada na aba B"]);
    expect.soft(meta.outbox.filter((op) => op.value.deleted)).toHaveLength(0);
    expect.soft(saved.length === 2 || (meta.conflicts || []).length > 0, "No silent loss without a persisted conflict").toBe(true);
});

test("G: duas abas editando a mesma revisão preservam as duas intenções", async ({ context, page, request }) => {
    const { account, other } = await sharedTabs(context, page, request, "shared-edit@local.test", true);
    await editIncome(page, 20); await editIncome(other, 30);
    const meta = await stored(other, metaKey(account.localId));
    // The accepted first edit must survive either as a pending operation or in
    // an explicit conflict; a single coalesced operation with 30 is insufficient.
    expect(JSON.stringify({ outbox: meta.outbox, conflicts: meta.conflicts })).toContain('"valor":20');
});

test("H: exclusão em uma aba e edição antiga na outra preservam conflito", async ({ context, page, request }) => {
    const { account, other } = await sharedTabs(context, page, request, "shared-delete@local.test", true);
    if (!await page.locator("#conteudo-receitas").isVisible()) await page.locator('[aria-controls="conteudo-receitas"]').click();
    await page.getByRole("button", { name: "Remover entrada Base compartilhada", exact: true }).click();
    await expect.poll(async () => (await stored(page, metaKey(account.localId)))?.outbox?.some((op) => op.value.deleted)).toBe(true);
    await editIncome(other, 30);
    const meta = await stored(other, metaKey(account.localId));
    expect(meta.outbox.some((op) => op.value.deleted) || (meta.conflicts || []).length > 0,
        "A edição antiga não pode apagar a intenção de exclusão já persistida").toBe(true);
});
