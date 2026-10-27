import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, getDocsFromServer, doc, setDoc, getDoc, deleteDoc, updateDoc, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
import { withFinanceGenerations } from '../finance-generation-transport.js';
import { LIMITE_MONETARIO_SEGURO, mesFinanceiroValido, normalizarEstado, validarBackup } from "../finance-core.js";
import { makeOperation, recordEntityKey as financialKey } from "../sync-core.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
async function assertDenied(operation) {
    await assert.rejects(operation, (error) => {
        assert.equal(error?.code, "permission-denied", `Expected a normal permission denial, received: ${error?.code || error}`);
        assert.doesNotMatch(String(error?.message || error), /evaluation error|expression.{0,20}limit|maximum.{0,20}expression/i,
            `Rules evaluation failed instead of denying the operation: ${error?.message || error}`);
        return true;
    });
}

function backupWithRecords(month, type, records) {
    return { versao: 3, meses: { [month]: { receitas: type === "receitas" ? records : [], despesas: type === "despesas" ? records : [] } } };
}

function recordEntityKey(month, type, id) {
    const value = `${month}/${type}/${id}`;
    return [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Mirrors the transaction contract in firebase-sync-entry.js while using the
// authenticated Firestore instance supplied by rules-unit-testing.
async function commitOperation(db, uid, operation) {
    const operationRef = doc(db, "users", uid, "operations", operation.id);
    const recordRef = doc(db, "users", uid, "records", operation.entityKey);
    return runTransaction(db, async (transaction) => {
        const [prior, current] = await Promise.all([transaction.get(operationRef), transaction.get(recordRef)]);
        if (prior.exists()) return { acknowledged: true, duplicate: true };
        const remote = current.exists() ? current.data() : null;
        if ((remote?.revision || null) !== operation.baseRevision) {
            transaction.set(doc(db, "users", uid, "conflicts", operation.id), {
                operationId: operation.id,
                entityKey: operation.entityKey,
                local: operation.value,
                remote,
                createdAt: serverTimestamp()
            });
            transaction.set(operationRef, { status: "conflict", createdAt: serverTimestamp() });
            return { acknowledged: true, conflict: true, remote };
        }
        transaction.set(recordRef, { ...operation.value, revision: operation.id, updatedAt: serverTimestamp() });
        transaction.set(operationRef, { status: "applied", createdAt: serverTimestamp() });
        return { acknowledged: true };
    });
}

test("Firestore rules have no public grants and deny unknown user paths", async () => {
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    assert.match(rules, /request\.auth != null && request\.auth\.uid == uid/);
    assert.match(rules, /match \/users\/\{uid\}\/\{document=\*\*\} \{ allow read, write: if false; \}/);
    assert.match(rules, /allow delete: if false;/);
    assert.doesNotMatch(rules, /allow\s+read\s*,\s*write\s*:\s*if\s+true/);
});

test('generation barrier atomically publishes complete restores, fences legacy/offline clients and retains recovery namespaces', { skip: !host && 'Requires Firestore Emulator' }, async () => {
    const [hostname, port] = host.split(':');
    assert.match(hostname, /^(127\.0\.0\.1|localhost)$/);
    const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
    const env = await initializeTestEnvironment({ projectId: 'demo-controle-financeiro', firestore: { host: hostname, port: Number(port), rules } });
    try {
        const uid = 'generation-owner', db = env.authenticatedContext(uid).firestore();
        const legacy = {
            list: async () => (await getDocsFromServer(collection(db, 'users', uid, 'records'))).docs.map(item => ({ ...item.data(), _docId: item.id })),
            getSettings: async () => null, listConflicts: async () => [], listAutomaticHistory: async () => []
        };
        const client = withFinanceGenerations(legacy, db, value => assert.equal(value, uid));
        const raw = normalizarEstado({ categorias: ['Casa'], tema: 'claro', meses: { '2026-10': {
            receitas: [{ id: 'same', nome: 'Salary', valor: 100, recebido: true }, { id: 'deleted', nome: 'Restored', valor: 25 }],
            despesas: [{ id: 'expense', nome: 'Bill', categoria: 'Casa', valor: 20, pago: true }]
        } }, orcamentos: { padrao: { Casa: 200 }, meses: { '2026-10': { Casa: 150 } } } });
        const first = { month: '2026-10', type: 'receitas', id: 'same', record: { id: 'same', nome: 'Old', valor: 999 }, deleted: false, revision: 'old', updatedAt: serverTimestamp() };
        const legacyRef = doc(db, 'users', uid, 'records', financialKey(first));
        await setDoc(legacyRef, first);
        const dead = { month: first.month, type: first.type, id: 'deleted', deleted: true, revision: 'dead', updatedAt: serverTimestamp() };
        await setDoc(doc(db, 'users', uid, 'records', financialKey(dead)), dead);
        const job = { generation: 'restore-one', baseGeneration: 'legacy', state: raw };
        let checks = 0;
        await assert.rejects(client.publishRestore(uid, job, () => ++checks < 6), { code: 'persistence/cancelled' });
        assert.equal((await client.generationSnapshot(uid)).generation, 'legacy');
        // A staged generation cannot be sealed or activated without its records.
        await assert.rejects(updateDoc(doc(db, 'users', uid, 'financeGenerations', job.generation), { status: 'ready' }), error => error.code === 'permission-denied');
        await assert.rejects(setDoc(doc(db, 'users', uid, 'control', 'restore'), {
            protocol: 2, activeGeneration: job.generation, previousGeneration: 'legacy', activatedAt: serverTimestamp()
        }), error => error.code === 'permission-denied');
        await client.publishRestore(uid, job);
        const restored = await client.generationSnapshot(uid);
        assert.equal(restored.records.length, 3);
        assert.equal(restored.records.find(item => item.id === 'same').record.valor, 100);
        assert.equal(restored.records.find(item => item.id === 'same').record.recebido, true);
        assert.equal(restored.records.find(item => item.id === 'expense').record.pago, true);
        assert.deepEqual(restored.settings.budgets, raw.orcamentos);
        assert.equal((await getDoc(legacyRef)).data().record.valor, 999, 'old remote state remains readable for recovery');
        // This is a real old-client write, without the new wrapper or generation metadata.
        await assert.rejects(setDoc(doc(db, 'users', uid, 'records', 'offline-created-before-restore'), {
            ...first, updatedAt: Timestamp.now()
        }), error => error.code === 'permission-denied');
        assert.equal((await getDoc(doc(db, 'users', uid, 'records', 'offline-created-before-restore'))).exists(), false);
        const fresh = { month: '2026-10', type: 'receitas', id: 'normal-new', record: { id: 'normal-new', nome: 'New', valor: 15, recebido: false }, deleted: false };
        const create = { ...makeOperation(financialKey(fresh), fresh, null), generation: job.generation };
        await client.commit(uid, create);
        const edit = { ...makeOperation(create.entityKey, { ...fresh, record: { ...fresh.record, valor: 30 } }, create.id), generation: job.generation };
        await client.commit(uid, edit);
        const deletion = { ...makeOperation(create.entityKey, { month: fresh.month, type: fresh.type, id: fresh.id, deleted: true }, edit.id), generation: job.generation };
        await client.commit(uid, deletion);
        assert.equal((await client.generationSnapshot(uid)).records.find(item => item.id === fresh.id).deleted, true);
        const second = { generation: 'restore-two', baseGeneration: job.generation, state: raw };
        await client.publishRestore(uid, second);
        assert.equal((await client.generationSnapshot(uid)).records.some(item => item.id === fresh.id), false);
        await assert.rejects(client.commit(uid, { ...create, id: 'old-offline-operation' }), { code: 'sync/generation-changed' });
        await assert.rejects(setDoc(doc(db, 'users', uid, 'financeGenerations', job.generation, 'records', create.entityKey), {
            value: { ...fresh, revision: 'stale', updatedAt: Timestamp.now() }
        }), error => error.code === 'permission-denied');
        const settings = (await client.generationSnapshot(uid)).settings;
        const updated = { version: 3, theme: settings.theme, categories: settings.categories, budgets: { ...settings.budgets, meses: { '2026-11': { Casa: 80 } } } };
        await client.saveSettings(uid, updated, settings.revision, () => true, second.generation);
        assert.equal((await client.generationSnapshot(uid)).settings.budgets.meses['2026-11'].Casa, 80);
        const outsider = env.authenticatedContext('generation-outsider').firestore();
        await assertDenied(getDoc(doc(outsider, 'users', uid, 'control', 'restore')));
        await client.publishRestore(uid, { generation: 'restore-empty', baseGeneration: second.generation,
            state: normalizarEstado({ categorias: ['Casa'], meses: {} }) });
        assert.equal((await client.generationSnapshot(uid)).records.length, 0);
    } finally { await env.cleanup(); }
});

test("núcleo financeiro define limites de mês, ID, nome, precisão e agregado", () => {
    const records = (type, month, values) => backupWithRecords(month, type, values.map(({ id, nome = "Registro", valor }) => ({ id, nome, valor })));
    assert.equal(validarBackup(records("receitas", "2000-01", [{ id: "inicio", valor: 1 }])), true);
    assert.equal(validarBackup(records("receitas", "2100-12", [{ id: "fim", valor: 1 }])), true);
    assert.equal(validarBackup(records("receitas", "1999-12", [{ id: "antes", valor: 1 }])), false);
    assert.equal(validarBackup(records("receitas", "2101-01", [{ id: "depois", valor: 1 }])), false);
    assert.equal(mesFinanceiroValido("2000-01"), true);
    assert.equal(mesFinanceiroValido("2100-12"), true);
    assert.equal(mesFinanceiroValido("1999-12"), false);
    assert.equal(mesFinanceiroValido("2101-01"), false);
    assert.equal(mesFinanceiroValido("2026-13"), false);

    const longId = "i".repeat(129);
    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: "i".repeat(128), valor: 1 }])), true);
    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: longId, valor: 1 }])), true);
    assert.equal(normalizarEstado(records("receitas", "2026-10", [{ id: longId, valor: 1 }])).meses["2026-10"].receitas[0].id, longId);
    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: "", valor: 1 }])), true);
    assert.notEqual(normalizarEstado(records("receitas", "2026-10", [{ id: "", valor: 1 }])).meses["2026-10"].receitas[0].id, "");
    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: "empty-name", nome: "", valor: 1 }])), false);
    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: "space-name", nome: "   ", valor: 1 }])), false);

    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: "negative", valor: -0.01 }])), false);
    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: "zero", valor: 0 }])), true);
    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: "maximum", valor: LIMITE_MONETARIO_SEGURO }])), true);
    assert.equal(validarBackup(records("receitas", "2026-10", [{ id: "sub-cent", valor: 0.001 }])), true);
    assert.equal(normalizarEstado(records("receitas", "2026-10", [{ id: "sub-cent", valor: 0.001 }])).meses["2026-10"].receitas[0].valor, 0);

    for (const type of ["receitas", "despesas"]) {
        const aggregate = records(type, "2026-10", [
            { id: `${type}-a`, valor: LIMITE_MONETARIO_SEGURO / 2 },
            { id: `${type}-b`, valor: LIMITE_MONETARIO_SEGURO / 2 },
            { id: `${type}-c`, valor: 0.01 }
        ]);
        assert.equal(validarBackup(aggregate), false, `the ${type} monthly total must be bounded`);
    }
});

test("Firestore rules restrict records by UID and require tombstones", { skip: !host && "Requires Firestore Emulator" }, async () => {
    const [hostname, port] = host.split(":");
    assert.match(hostname, /^(127\.0\.0\.1|localhost)$/, "Somente o Emulator local pode receber os testes.");
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    const env = await initializeTestEnvironment({ projectId: "demo-controle-financeiro", firestore: { host: hostname, port: Number(port), rules } });
    try {
        const alice = env.authenticatedContext("alice").firestore();
        const bob = env.authenticatedContext("bob").firestore();
        const anonymous = env.unauthenticatedContext().firestore();
        const clientStamp = Timestamp.fromDate(new Date());
        const entry = { month: "2026-10", type: "receitas", id: "r1", record: { id: "r1", nome: "Salário", valor: 1000 }, deleted: false, revision: "op1", updatedAt: serverTimestamp() };
        const pathAlice = doc(alice, "users/alice/records/key1");
        await assertSucceeds(setDoc(pathAlice, entry));
        await assertSucceeds(getDoc(pathAlice));
        for (const recebido of [true, false]) {
            const receivedPath = doc(alice, `users/alice/records/received-${recebido}`);
            await assertSucceeds(setDoc(receivedPath, { ...entry, record: { ...entry.record, recebido }, updatedAt: serverTimestamp() }));
            assert.equal((await getDoc(receivedPath)).data().record.recebido, recebido);
        }
        for (const recebido of [null, 'true', 1, {}]) {
            await assertDenied(setDoc(doc(alice, 'users/alice/records/invalid-received'), {
                ...entry, record: { ...entry.record, recebido }, updatedAt: clientStamp
            }));
        }
        await assertDenied(setDoc(doc(alice, 'users/alice/records/expense-received'), {
            ...entry, type: 'despesas', record: { ...entry.record, recebido: true }, updatedAt: clientStamp
        }));
        await assertSucceeds(setDoc(doc(alice, "users/alice/records/key-zero"), {
            ...entry, record: { ...entry.record, valor: 0 }, updatedAt: serverTimestamp()
        }));
        await assertSucceeds(setDoc(doc(alice, "users/alice/records/key-maximum"), {
            ...entry, id: "maximum", record: { ...entry.record, id: "maximum", valor: LIMITE_MONETARIO_SEGURO }, updatedAt: serverTimestamp()
        }));
        await assertSucceeds(setDoc(doc(alice, "users/alice/records/key-cent"), {
            ...entry, id: "cent", record: { ...entry.record, id: "cent", valor: 0.01 }, updatedAt: serverTimestamp()
        }));
        await assertSucceeds(setDoc(doc(alice, "users/alice/records/key-cent-29"), {
            ...entry, id: "cent-29", record: { ...entry.record, id: "cent-29", valor: 0.29 }, updatedAt: serverTimestamp()
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-sub-cent"), {
            ...entry, id: "sub-cent", record: { ...entry.record, id: "sub-cent", valor: 0.001 }, updatedAt: Timestamp.fromDate(new Date())
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-before-core-range"), {
            ...entry, month: "1999-12", id: "before-core-range", record: { ...entry.record, id: "before-core-range" }, updatedAt: Timestamp.fromDate(new Date())
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-after-core-range"), {
            ...entry, month: "2101-01", id: "after-core-range", record: { ...entry.record, id: "after-core-range" }, updatedAt: Timestamp.fromDate(new Date())
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-empty-id"), {
            ...entry, id: "", record: { ...entry.record, id: "" }, updatedAt: Timestamp.fromDate(new Date())
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-space-name"), {
            ...entry, id: "space-name", record: { ...entry.record, id: "space-name", nome: "   " }, updatedAt: Timestamp.fromDate(new Date())
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-unicode-space-name"), {
            ...entry, id: "unicode-space-name", record: { ...entry.record, id: "unicode-space-name", nome: "\u00a0" }, updatedAt: Timestamp.fromDate(new Date())
        }));
        await assertSucceeds(setDoc(doc(alice, "users/alice/records/key-id-128"), {
            ...entry, id: "i".repeat(128), record: { ...entry.record, id: "i".repeat(128) }, updatedAt: serverTimestamp()
        }));
        for (const type of ["receitas", "despesas"]) {
            const amounts = [LIMITE_MONETARIO_SEGURO / 2, LIMITE_MONETARIO_SEGURO / 2, 0.01];
            for (const [index, valor] of amounts.entries()) {
                const id = `aggregate-${type}-${index}`;
                await assertSucceeds(setDoc(doc(alice, `users/alice/records/${id}`), {
                    month: "2026-10", type, id,
                    record: { id, nome: "Agregado", valor }, deleted: false,
                    revision: `aggregate-revision-${type}-${index}`, updatedAt: serverTimestamp()
                }));
            }
        }
        // Current rules do not bind recordId to the client's derived entity key.
        await assertSucceeds(setDoc(doc(alice, "users/alice/records/arbitrary-document-key"), entry));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-negative"), {
            ...entry, record: { ...entry.record, valor: -0.01 }, updatedAt: Timestamp.fromDate(new Date())
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-over-limit"), {
            ...entry, record: { ...entry.record, valor: 17592186044416.01 }, updatedAt: Timestamp.fromDate(new Date())
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key2"), { ...entry, record: { ...entry.record, id: "other" }, updatedAt: clientStamp }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-long-id"), {
            ...entry, id: "i".repeat(129), record: { ...entry.record, id: "i".repeat(129) }, updatedAt: clientStamp
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key-empty-name"), {
            ...entry, record: { ...entry.record, nome: "" }, updatedAt: clientStamp
        }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key2"), { ...entry, record: { ...entry.record, valor: "1000" }, updatedAt: Timestamp.fromDate(new Date()) }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key2"), { ...entry, unexpected: true, updatedAt: clientStamp }));
        await assertDenied(getDoc(doc(bob, "users/alice/records/key1")));
        await assertDenied(setDoc(doc(bob, "users/alice/records/key2"), entry));
        await assertDenied(getDoc(doc(anonymous, "users/alice/records/key1")));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key3"), { ...entry, unexpected: true, updatedAt: clientStamp }));
        await assertDenied(deleteDoc(pathAlice));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key2"), { ...entry, month: "2026-13", updatedAt: clientStamp }));
        const tombstone = { month: "2026-10", type: "receitas", id: "r1", deleted: true, revision: "op2", updatedAt: serverTimestamp() };
        await assertSucceeds(setDoc(doc(alice, "users/alice/records/key2"), tombstone));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key3"), { ...tombstone, record: entry.record, updatedAt: clientStamp }));
        await assertDenied(setDoc(doc(alice, "users/alice/records/key4"), { ...tombstone, unexpected: true, updatedAt: clientStamp }));

        const operationEntityKey = recordEntityKey("2026-10", "receitas", "transaction-record");
        const activeValue = { month: "2026-10", type: "receitas", id: "transaction-record", record: { id: "transaction-record", nome: "Original", valor: 10 }, deleted: false };
        const createOperation = makeOperation(operationEntityKey, activeValue, null);
        assert.deepEqual(await commitOperation(alice, "alice", createOperation), { acknowledged: true });
        const transactionRecordRef = doc(alice, "users/alice/records", operationEntityKey);
        const createSnapshot = await getDoc(transactionRecordRef);
        assert.equal(createSnapshot.data().revision, createOperation.id);
        assert.equal((await getDoc(doc(alice, "users/alice/operations", createOperation.id))).data().status, "applied");

        const updatedValue = { ...activeValue, record: { ...activeValue.record, valor: 20 } };
        const updateOperation = makeOperation(operationEntityKey, updatedValue, createOperation.id);
        assert.deepEqual(await commitOperation(alice, "alice", updateOperation), { acknowledged: true });
        assert.equal((await getDoc(transactionRecordRef)).data().record.valor, 20);
        assert.deepEqual(await commitOperation(alice, "alice", updateOperation), { acknowledged: true, duplicate: true });
        assert.equal((await getDoc(transactionRecordRef)).data().revision, updateOperation.id);

        const staleOperation = makeOperation(operationEntityKey, { ...activeValue, record: { ...activeValue.record, valor: 30 } }, "stale-revision");
        const conflictResult = await commitOperation(alice, "alice", staleOperation);
        assert.equal(conflictResult.conflict, true);
        assert.equal((await getDoc(transactionRecordRef)).data().revision, updateOperation.id);
        assert.equal((await getDoc(doc(alice, "users/alice/operations", staleOperation.id))).data().status, "conflict");
        assert.equal((await getDoc(doc(alice, "users/alice/conflicts", staleOperation.id))).data().local.record.valor, 30);

        const deleteOperation = makeOperation(operationEntityKey, {
            month: "2026-10", type: "receitas", id: "transaction-record", deleted: true
        }, updateOperation.id);
        assert.deepEqual(await commitOperation(alice, "alice", deleteOperation), { acknowledged: true });
        const tombstoneSnapshot = await getDoc(transactionRecordRef);
        assert.equal(tombstoneSnapshot.data().deleted, true);
        assert.equal(Object.hasOwn(tombstoneSnapshot.data(), "record"), false);

        const settingsRef = doc(alice, "users/alice/settings/finance");
        const legacySettings = { version: 3, categories: ["Casa"], theme: "claro", budgets: { padrao: { Casa: 20 }, meses: {} }, revision: "legacy-settings", updatedAt: clientStamp };
        await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "users/alice/settings/finance"), legacySettings));
        await assertSucceeds(getDoc(settingsRef));
        await assertDenied(setDoc(settingsRef, { ...legacySettings, updatedAt: serverTimestamp() }));
        const categories = Array.from({ length: 14 }, (_, index) => `Categoria ${index}`);
        const generation = "generation-14";
        const manifest = { version: 4, theme: "claro", categoryCount: categories.length, budgetCount: categories.length - 1,
            generation, revision: "settings-v2-14" };
        const settingsV2 = doc(alice, "users/alice/settingsV2/finance");
        for (const category of categories) {
            const encoded = encodeURIComponent(category).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
            await assertSucceeds(setDoc(doc(alice, `users/alice/settingsV2/finance/generations/${generation}/categories/c_${encoded}`),
                category !== categories.at(-1) ? { name: category, budget: 20 } : { name: category }));
        }
        await assertSucceeds(setDoc(settingsV2, manifest));
        await assertSucceeds(updateDoc(settingsV2, { theme: "pangolim", revision: "settings-v2-update" }));
        await assertDenied(setDoc(doc(alice, `users/alice/settingsV2/finance/generations/${generation}/categories/c_invalid`), { name: 3 }));
        await assertDenied(setDoc(doc(alice, `users/alice/settingsV2/finance/generations/${generation}/categories/c_bad-budget`), { name: "Categoria inválida", budget: "20" }));
        await assertDenied(setDoc(doc(alice, `users/alice/settingsV2/finance/generations/${generation}/categories/c_extra`), { name: "Extra", arbitrary: true }));
        await assertDenied(setDoc(settingsV2, { ...manifest, theme: "neon", revision: "settings-invalid" }));
        await assertDenied(setDoc(doc(bob, "users/alice/settingsV2/finance"), manifest));
        await assertDenied(updateDoc(doc(alice, `users/alice/settingsV2/finance/generations/${generation}/categories/c_${encodeURIComponent(categories[0])}`), { name: "alterada" }));
        const conflictRef = doc(alice, "users/alice/conflicts/op-conflict");
        await assertSucceeds(setDoc(conflictRef, { operationId: "op-conflict", entityKey: "e1", local: { month: "2026-10" }, remote: null, createdAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(conflictRef, { resolved: true, resolution: "local", resolvedAt: serverTimestamp() }));
        await assertDenied(getDoc(doc(alice, "users/alice/private/key")));
    } finally { await env.cleanup(); }
});
