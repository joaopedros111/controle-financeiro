import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
async function assertDenied(operation) {
    await assert.rejects(operation, (error) => {
        assert.equal(error?.code, "permission-denied", `Expected a normal permission denial, received: ${error?.code || error}`);
        assert.doesNotMatch(String(error?.message || error), /evaluation error|expression.{0,20}limit|maximum.{0,20}expression/i,
            `Rules evaluation failed instead of denying the operation: ${error?.message || error}`);
        return true;
    });
}
test("Firestore rules have no public grants and deny unknown user paths", async () => {
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    assert.match(rules, /request\.auth != null && request\.auth\.uid == uid/);
    assert.match(rules, /match \/users\/\{uid\}\/\{document=\*\*\} \{ allow read, write: if false; \}/);
    assert.match(rules, /allow delete: if false;/);
    assert.doesNotMatch(rules, /allow\s+read\s*,\s*write\s*:\s*if\s+true/);
});
test("Firestore rules restrict records by UID and require tombstones", { skip: !host && "Requires Firestore Emulator" }, async () => {
    const [hostname, port] = host.split(":");
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
        await assertDenied(setDoc(doc(alice, "users/alice/records/key2"), { ...entry, record: { ...entry.record, id: "other" }, updatedAt: clientStamp }));
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
