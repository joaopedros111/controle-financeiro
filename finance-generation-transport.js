import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { registrosFinanceiros, recordEntityKey, recordsEquivalent, operationId, validConflictRecord, validateRemoteSettings, snapshotConfirmed } from './sync-core.js';
import { normalizarEstado, validarBackup, validarTotaisMonetarios } from './finance-core.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const generationOf = marker => marker?.activeGeneration || 'legacy';
const chunkText = text => {
    const chunks = []; let chunk = '';
    for (const point of text) { if (chunk.length + point.length > 32000) { chunks.push(chunk); chunk = ''; } chunk += point; }
    chunks.push(chunk); return chunks;
};

// The legacy transport remains unchanged until the first explicit replacement.
// All new namespaces share one server-enforced account generation barrier.
export function withFinanceGenerations(legacy, db, ensureUser, sdk = { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, serverTimestamp, Timestamp }) {
    const { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, serverTimestamp, Timestamp } = sdk;
    const control = uid => doc(db, 'users', uid, 'control', 'restore');
    const root = (uid, generation) => doc(db, 'users', uid, 'financeGenerations', generation);
    const reference = (uid, generation, kind, id) => doc(root(uid, generation), kind, id);
    const source = (uid, generation, kind) => collection(root(uid, generation), kind);
    async function marker(uid) {
        ensureUser(uid);
        const snap = await getDocFromServer(control(uid)); ensureUser(uid);
        if (!snapshotConfirmed(snap.metadata)) throw fail('unavailable', 'Geração ainda não confirmada pelo servidor.');
        const value = snap.exists() ? snap.data() : null;
        if (value && Number.isInteger(value.protocol) && value.protocol > 2) throw fail('sync/upgrade-required', 'Atualização obrigatória: esta versão não é compatível com a geração da conta. Os dados locais foram preservados.');
        if (value && (value.protocol !== 2 || !identity(value.activeGeneration) || value.activeGeneration === 'legacy')) throw fail('sync/invalid-data', 'Geração financeira inválida.');
        return value;
    }
    async function assertActive(uid, generation, tx = null) {
        ensureUser(uid);
        const value = tx ? await tx.get(control(uid)) : null;
        const active = tx ? generationOf(value.exists() ? value.data() : null) : generationOf(await marker(uid));
        if (active !== generation) throw fail('sync/generation-changed', 'A geração financeira mudou. Atualizando a cópia local.');
    }
    async function settings(uid, generation) {
        const pointer = await getDocFromServer(reference(uid, generation, 'settings', 'finance'));
        if (!pointer.exists()) throw fail('sync/invalid-data', 'Configurações da geração ausentes.');
        const value = pointer.data();
        const base = reference(uid, generation, 'settingsSnapshots', value.snapshot);
        const [manifest, pieces] = await Promise.all([getDocFromServer(base), getDocsFromServer(collection(base, 'chunks'))]);
        if (!manifest.exists() || manifest.data().status !== 'ready' || pieces.size !== manifest.data().count) throw fail('sync/invalid-data', 'Configurações incompletas.');
        const chunks = pieces.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => a.index - b.index);
        if (chunks.some((item, index) => item.index !== index || item.id !== String(index) || typeof item.text !== 'string')) throw fail('sync/invalid-data', 'Partes de configurações inválidas.');
        const decoded = JSON.parse(chunks.map(item => item.text).join(''));
        if (operationId('settings-content', null, decoded) !== manifest.data().hash) throw fail('sync/invalid-data', 'Configurações divergentes do manifesto.');
        const result = { ...decoded, revision: value.snapshot, updatedAt: value.updatedAt };
        if (!validateRemoteSettings(result)) throw fail('sync/invalid-data', 'Configurações financeiras inválidas.');
        return result;
    }
    async function stageSettings(uid, generation, id, value, canWrite) {
        const text = JSON.stringify(value), chunks = chunkText(text), hash = operationId('settings-content', null, value);
        const base = reference(uid, generation, 'settingsSnapshots', id);
        await runTransaction(db, async tx => {
            ensureUser(uid); if (!canWrite()) throw fail('persistence/cancelled', 'Sessão alterada.');
            const existing = await tx.get(base);
            if (existing.exists()) {
                if (existing.data().hash !== hash || existing.data().count !== chunks.length) throw fail('sync/invalid-data', 'Preparação de configurações divergente.');
            } else tx.set(base, { count: chunks.length, written: 0, hash, status: 'staging' });
        });
        for (let index = 0; index < chunks.length; index++) {
            await runTransaction(db, async tx => {
                ensureUser(uid); if (!canWrite()) throw fail('persistence/cancelled', 'Sessão alterada.');
                const current = await tx.get(base);
                if (current.data().written > index) return;
                if (current.data().written !== index || current.data().status !== 'staging') throw fail('sync/invalid-data', 'Ordem de preparação inválida.');
                tx.set(doc(base, 'chunks', String(index)), { index, text: chunks[index] });
                tx.update(base, { written: index + 1 });
            });
        }
        await runTransaction(db, async tx => {
            ensureUser(uid); if (!canWrite()) throw fail('persistence/cancelled', 'Sessão alterada.');
            const current = await tx.get(base);
            if (current.data().written !== chunks.length) throw fail('sync/invalid-data', 'Configurações incompletas.');
            if (current.data().status !== 'ready') tx.update(base, { status: 'ready' });
        });
    }
    const api = {
        ...legacy,
        protocolVersion: 2,
        generationMarker: marker,
        async generationSnapshot(uid) {
            for (let attempt = 0; attempt < 3; attempt++) {
                const before = await marker(uid), generation = generationOf(before);
                try {
                    const [records, currentSettings, conflicts] = generation === 'legacy'
                        ? await Promise.all([api.list(uid), api.getSettings(uid), api.listConflicts(uid)])
                        : await Promise.all([api.list(uid, { generation }), api.getSettings(uid, { generation }), api.listConflicts(uid, { generation })]);
                    const after = await marker(uid);
                    if (generation !== generationOf(after)) continue;
                    return { generation, protocol: before?.protocol || 1, records, settings: currentSettings, conflicts };
                } catch (cause) {
                    if (generation !== generationOf(await marker(uid))) continue;
                    throw cause;
                }
            }
            throw fail('aborted', 'Geração mudou durante a leitura.');
        },
        async publishRestore(uid, job, canWrite = () => true) {
            ensureUser(uid);
            const { generation, baseGeneration, state } = job;
            if (!identity(generation) || generation === 'legacy' || !validarBackup(state) || !validarTotaisMonetarios(state)) throw fail('sync/invalid-backup', 'Restauração inválida.');
            const active = generationOf(await marker(uid));
            if (active === generation) return generation; // Lost activation ACK: never publish twice.
            if (active !== baseGeneration) throw fail('sync/restore-conflict', 'Outra restauração foi ativada. Sua cópia permanece recuperável.');
            const rows = registrosFinanceiros(state).sort((a, b) => recordEntityKey(a).localeCompare(recordEntityKey(b)));
            const financial = { version: 3, categories: state.categorias, theme: state.tema || 'claro', budgets: state.orcamentos };
            const settingsId = operationId('restore-settings', generation, financial);
            await runTransaction(db, async tx => {
                await assertActive(uid, baseGeneration, tx);
                if (!canWrite()) throw fail('persistence/cancelled', 'Sessão alterada.');
                const existing = await tx.get(root(uid, generation));
                if (existing.exists()) {
                    if (existing.data().recordCount !== rows.length || existing.data().settingsId !== settingsId || existing.data().baseGeneration !== baseGeneration) throw fail('sync/invalid-data', 'Restauração preparada com conteúdo diferente.');
                } else tx.set(root(uid, generation), { baseGeneration, recordCount: rows.length, written: 0, lastKey: '', settingsId, status: 'staging', createdAt: serverTimestamp() });
            });
            await stageSettings(uid, generation, settingsId, financial, canWrite);
            for (let index = 0; index < rows.length; index++) {
                const item = rows[index], key = recordEntityKey(item);
                await runTransaction(db, async tx => {
                    await assertActive(uid, baseGeneration, tx);
                    if (!canWrite()) throw fail('persistence/cancelled', 'Sessão alterada.');
                    const current = await tx.get(root(uid, generation));
                    if (current.data().written > index) return;
                    if (current.data().written !== index || current.data().status !== 'staging') throw fail('sync/invalid-data', 'Ordem de preparação inválida.');
                    tx.set(reference(uid, generation, 'records', key), { index, value: { ...item, deleted: false, revision: operationId(key, generation, item.record), updatedAt: serverTimestamp() } });
                    tx.update(root(uid, generation), { written: index + 1, lastKey: key });
                });
            }
            await runTransaction(db, async tx => {
                await assertActive(uid, baseGeneration, tx);
                if (!canWrite()) throw fail('persistence/cancelled', 'Sessão alterada.');
                const current = await tx.get(root(uid, generation));
                if (current.data().written !== rows.length) throw fail('sync/invalid-data', 'Restauração incompleta.');
                if (current.data().status === 'ready') return;
                tx.set(reference(uid, generation, 'settings', 'finance'), { snapshot: settingsId, updatedAt: serverTimestamp() });
                tx.update(root(uid, generation), { status: 'ready' });
            });
            // Verify the sealed, immutable preparation before switching any reader.
            const [prepared, preparedSettings] = await Promise.all([api.list(uid, { generation }), settings(uid, generation)]);
            if (prepared.length !== rows.length || !recordsEquivalent(preparedSettings.budgets, financial.budgets)
                || prepared.some(item => !validConflictRecord(item) || item.deleted || recordEntityKey(item) !== item._docId
                    || !recordsEquivalent(item.record, rows.find(row => recordEntityKey(row) === item._docId)?.record))) throw fail('sync/invalid-data', 'Verificação da preparação falhou.');
            await runTransaction(db, async tx => {
                ensureUser(uid); if (!canWrite()) throw fail('persistence/cancelled', 'Sessão alterada.');
                const [current, ready] = await Promise.all([tx.get(control(uid)), tx.get(root(uid, generation))]);
                const previous = generationOf(current.exists() ? current.data() : null);
                if (previous === generation) return;
                if (previous !== baseGeneration || ready.data()?.status !== 'ready') throw fail('sync/restore-conflict', 'Outra restauração foi ativada. Sua cópia permanece recuperável.');
                tx.set(control(uid), { protocol: 2, activeGeneration: generation, previousGeneration: baseGeneration, activatedAt: serverTimestamp() });
            });
            return generation;
        },
        async list(uid, { generation = 'legacy', ...options } = {}) {
            if (generation === 'legacy') return legacy.list(uid, options);
            ensureUser(uid);
            const snap = await getDocsFromServer(source(uid, generation, 'records'));
            if (!snapshotConfirmed(snap.metadata)) throw fail('unavailable', 'Lançamentos ainda não confirmados.');
            return snap.docs.map(item => ({ ...item.data().value, _docId: item.id }));
        },
        getSettings(uid, { generation = 'legacy', ...options } = {}) { return generation === 'legacy' ? legacy.getSettings(uid, options) : settings(uid, generation); },
        async commit(uid, operation) {
            const generation = operation.generation || 'legacy';
            if (generation === 'legacy') { await assertActive(uid, generation); return legacy.commit(uid, operation); }
            if (!validConflictRecord(operation.value) || operation.entityKey !== recordEntityKey(operation.value)) throw fail('sync/invalid-data', 'Operação inválida.');
            return runTransaction(db, async tx => {
                await assertActive(uid, generation, tx);
                const target = reference(uid, generation, 'records', operation.entityKey), receipt = reference(uid, generation, 'operations', operation.id);
                const [prior, current] = await Promise.all([tx.get(receipt), tx.get(target)]);
                const old = current.exists() ? current.data().value : null;
                if (prior.exists()) return { acknowledged: true, duplicate: true, conflict: prior.data().status === 'conflict', remote: old };
                if ((old?.revision || null) !== operation.baseRevision || old?.deleted && !operation.value.deleted) {
                    tx.set(reference(uid, generation, 'conflicts', operation.id), { operationId: operation.id, entityKey: operation.entityKey, local: operation.value, remote: old, createdAt: serverTimestamp() });
                    tx.set(receipt, { status: 'conflict', createdAt: serverTimestamp() });
                    return { acknowledged: true, conflict: true, remote: old };
                }
                tx.set(target, { value: { ...operation.value, revision: operation.id, updatedAt: serverTimestamp() } });
                tx.set(receipt, { status: 'applied', createdAt: serverTimestamp() });
                return { acknowledged: true };
            });
        },
        async saveSettings(uid, value, baseRevision = null, canWrite = () => true, generation = 'legacy') {
            if (generation === 'legacy') {
                if (Object.keys(value.budgets?.meses || {}).length) throw fail('sync/generation-required', 'Orçamentos mensais exigem uma geração financeira. Restaure um backup para ativar o novo protocolo.');
                await assertActive(uid, generation); return legacy.saveSettings(uid, value, baseRevision, canWrite);
            }
            const snapshot = operationId('settings', baseRevision, value);
            if (!validateRemoteSettings({ ...value, revision: snapshot, updatedAt: Timestamp.now() })) throw fail('sync/invalid-data', 'Configurações inválidas.');
            await stageSettings(uid, generation, snapshot, value, canWrite);
            return runTransaction(db, async tx => {
                await assertActive(uid, generation, tx);
                if (!canWrite()) throw fail('persistence/cancelled', 'Sessão alterada.');
                const target = reference(uid, generation, 'settings', 'finance'), old = await tx.get(target);
                if (old.data()?.snapshot === snapshot) return { acknowledged: true, duplicate: true, revision: snapshot };
                if ((old.data()?.snapshot || null) !== baseRevision) return { conflict: true };
                tx.set(target, { snapshot, updatedAt: serverTimestamp() });
                return { acknowledged: true, revision: snapshot };
            });
        },
        async listConflicts(uid, { generation = 'legacy', ...options } = {}) {
            if (generation === 'legacy') return legacy.listConflicts(uid, options);
            ensureUser(uid); const snap = await getDocsFromServer(source(uid, generation, 'conflicts'));
            return snap.docs.map(item => ({ ...item.data(), _docId: item.id }));
        },
        listenGeneration(uid, callback, failure) { ensureUser(uid); return onSnapshot(control(uid), { includeMetadataChanges: true }, snap => callback(snap.exists() ? snap.data() : null, snap.metadata), failure); },
        listen(uid, callback, failure, generation = 'legacy') {
            if (generation === 'legacy') return legacy.listen(uid, callback, failure);
            ensureUser(uid); return onSnapshot(source(uid, generation, 'records'), { includeMetadataChanges: true }, snap => callback(null, snap.metadata), failure);
        },
        listenSettings(uid, callback, failure, generation = 'legacy') {
            if (generation === 'legacy') return legacy.listenSettings(uid, callback, failure);
            ensureUser(uid); return onSnapshot(reference(uid, generation, 'settings', 'finance'), { includeMetadataChanges: true }, snap => callback(null, snap.metadata), failure);
        },
        listenConflicts(uid, callback, failure, generation = 'legacy') {
            if (generation === 'legacy') return legacy.listenConflicts(uid, callback, failure);
            ensureUser(uid); return onSnapshot(source(uid, generation, 'conflicts'), { includeMetadataChanges: true }, snap => callback(null, snap.metadata), failure);
        },
        async resolveConflict(uid, id, resolution, generation = 'legacy') {
            if (generation === 'legacy') { await assertActive(uid, generation); return legacy.resolveConflict(uid, id, resolution); }
            return runTransaction(db, async tx => {
                await assertActive(uid, generation, tx); const target = reference(uid, generation, 'conflicts', id), old = await tx.get(target);
                if (!old.exists()) return false;
                if (!old.data().resolved) tx.update(target, { resolved: true, resolution, resolvedAt: serverTimestamp() });
                return true;
            });
        },
        async saveAutomaticHistory(uid, item, generation = 'legacy') {
            if (generation === 'legacy') { await assertActive(uid, generation); return legacy.saveAutomaticHistory(uid, item); }
            return runTransaction(db, async tx => {
                await assertActive(uid, generation, tx); const target = reference(uid, generation, 'operations', item.id), old = await tx.get(target);
                if (!old.exists()) tx.set(target, { status: 'conflict', local: item, createdAt: serverTimestamp() });
                return { acknowledged: true };
            });
        },
        async listAutomaticHistory(uid) {
            ensureUser(uid); const active = await marker(uid), current = generationOf(active);
            const previous = await legacy.listAutomaticHistory(uid);
            if (current === 'legacy') return previous;
            const snap = await getDocsFromServer(source(uid, current, 'operations'));
            const recovery = await api.readGenerationRecovery(uid, active.previousGeneration);
            return [...previous, ...snap.docs.filter(item => item.id.startsWith('auto-history-')).map(item => ({ id: item.id, ...item.data() })),
                { type: 'generation-recovery', generation: active.previousGeneration, state: recovery }];
        },
        async readGenerationRecovery(uid, generation) {
            ensureUser(uid);
            const [records, savedSettings] = await Promise.all([api.list(uid, { generation }), api.getSettings(uid, { generation })]);
            const raw = { versao: 3, meses: {}, categorias: savedSettings?.categories, tema: savedSettings?.theme, orcamentos: savedSettings?.budgets };
            for (const item of records) if (!item.deleted) {
                raw.meses[item.month] ||= { receitas: [], despesas: [] };
                raw.meses[item.month][item.type].push(item.record);
            }
            if (!validarBackup(raw)) throw fail('sync/invalid-data', 'A cópia anterior precisa de revisão. Os documentos foram preservados.');
            return normalizarEstado(raw);
        }
    };
    return api;
}
