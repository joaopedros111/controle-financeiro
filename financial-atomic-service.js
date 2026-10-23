// API transacional para integração futura com os handlers do aplicativo.
// Não altera o armazenamento legado e não realiza operações de rede.
import { ConflitoPersistencia } from './transactional-state.js';
import { combinarEdicaoFinanceira } from './financial-intents.js';
import { registrosFinanceiros, recordEntityKey, operationId, coalesceOutbox, recordsEquivalent, blockedConflictKeys, validSyncIdentity, functionalSettings, settingsEquivalent, validateRemoteSettings, financialStatesEquivalent } from './sync-core.js';

const copy = (value) => structuredClone(value);
const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
export class ServicoFinanceiroAtomico {
    constructor(db, validarEstado, validarFila = () => true, locks = globalThis.navigator?.locks) {
        this.db = db;
        this.settingsLocks = locks;
        this.validarEstado = validarEstado;
        this.validarFila = validarFila;
    }
    // Importação conservadora: ambos os documentos são criados juntos.
    // Estado IndexedDB já existente jamais é substituído pela origem local.
    // Shared across cooperating tabs; no IndexedDB transaction stays open during network I/O.
    // Local edits remain available without Web Locks, but publication fails closed.
    coordenarSettings(uid, executar, publicacao = false) {
        if (!(uid === '@local' || /^[A-Za-z0-9_-]{1,128}$/.test(uid || ''))) return Promise.reject(new Error('UID invalido'));
        if (this.settingsLocks) return this.settingsLocks.request('controleFinanceiro:settings:' + uid, executar);
        if (publicacao) return Promise.reject(Object.assign(new Error('Publicacao de configuracoes requer Web Locks para coordenar abas.'), {code:'sync/coordination-unavailable'}));
        return Promise.resolve().then(executar);
    }
    async inicializar(uid, estadoLegado, filaLegada) {
        if (typeof uid !== 'string' || !uid.trim() || uid.includes(':') ||
            !this.validarEstado(estadoLegado) || !this.validarFila(filaLegada)) {
            throw new Error('Origem legada inválida; migração bloqueada');
        }
        const stateKey = `estado:${uid}`, queueKey = `fila:${uid}`;
        const docs = await this.db.alterarDocumentos([stateKey, queueKey], (records) => {
            const s = records.get(stateKey), q = records.get(queueKey);
            if ((s === null) !== (q === null)) throw new Error('Migração parcial: revisão manual obrigatória');
            if (s === null) {
                records.set(stateKey, { revisao: 0, dados: copy(estadoLegado), origem: 'localStorage' });
                records.set(queueKey, copy(filaLegada));
            } else if (!validRevision(s.revisao) || !this.validarEstado(s.dados) || !this.validarFila(q)) {
                throw new Error('Dados IndexedDB inválidos; migração bloqueada');
            }
            return records;
        });
        return { estado: docs.get(stateKey), fila: docs.get(queueKey) };
    }
    // Merge transacional de intenções, sem exclusões decorrentes de snapshots velhos.
    async aplicarEdicao(uid, estadoBase, estadoEditado, criarOperacoes = () => [], editarFila = () => {}, isCurrent = () => true) {
        if (typeof uid !== 'string' || !uid.trim() || uid.includes(':') ||
            !this.validarEstado(estadoBase) || !this.validarEstado(estadoEditado)) {
            throw new Error('Edição financeira inválida');
        }
        const stateKey = `estado:${uid}`, queueKey = `fila:${uid}`;
        const docs = await this.db.alterarDocumentos([stateKey, queueKey], (records) => {
            if (!isCurrent()) throw Object.assign(new Error('Sessão de persistência invalidada'), { code: 'persistence/cancelled' });
            const previous = records.get(stateKey), queue = records.get(queueKey);
            if (!previous || !validRevision(previous.revisao) || !this.validarEstado(previous.dados) ||
                !queue || !this.validarFila(queue) || !Array.isArray(queue.outbox)) {
                throw new Error('Persistência não inicializada ou inválida');
            }
            const merged = combinarEdicaoFinanceira(estadoBase, estadoEditado, previous.dados);
            if (!this.validarEstado(merged.estado)) throw new Error('Resultado financeiro inválido');
            // Não gerar operações por ausência em uma cópia obsoleta.
            const operations = criarOperacoes(copy(merged.mudancas), copy(queue), copy(merged.estado));
            if (!Array.isArray(operations) || operations.some((op) => !op || typeof op.id !== 'string' || !op.id))
                throw new Error('Operações de sincronização inválidas');
            const ids = new Map(queue.outbox.map((op) => [op.id, JSON.stringify(op)]));
            const newQueue = copy(queue);
            const criticalEdit = merged.mudancas.length || !recordsEquivalent(previous.dados.categorias, merged.estado.categorias)
                || !recordsEquivalent(previous.dados.orcamentos, merged.estado.orcamentos);
            if (criticalEdit) {
                if (newQueue.settingsPristine === true) newQueue.settingsPristine = false;
                if (newQueue.firstLinkSource === 'anonymous') newQueue.firstLinkSource = 'account';
            }
            for (const op of operations) {
                const prior = op.entityKey && newQueue.outbox.filter(item => item.entityKey === op.entityKey).at(-1);
                if (prior && !newQueue.attempted?.[prior.id]) {
                    op.baseRevision = prior.baseRevision;
                    op.id = operationId(op.entityKey, op.baseRevision, op.value);
                    newQueue.outbox = newQueue.outbox.filter(item => item.id !== prior.id);
                    ids.delete(prior.id);
                }
                if (ids.has(op.id) && ids.get(op.id) !== JSON.stringify(op)) throw new Error('Operação divergente');
                if (!ids.has(op.id)) { newQueue.outbox.push(copy(op)); ids.set(op.id, JSON.stringify(op)); }
            }
            editarFila(newQueue, copy(merged.estado));
            if (!this.validarFila(newQueue)) throw new Error('Fila resultante inválida');
            if (!isCurrent()) throw Object.assign(new Error('Sessão de persistência invalidada'), { code: 'persistence/cancelled' });
            const alterado = JSON.stringify(previous.dados) !== JSON.stringify(merged.estado);
            records.set(stateKey, alterado ? { ...previous, revisao: previous.revisao + 1, dados: merged.estado } : previous);
            records.set(queueKey, newQueue);
            return records;
        });
        return { estado: docs.get(stateKey), fila: docs.get(queueKey) };
    }
    async prepararPublicacao(uid, base, desired, remote, reviewed = null, deletions = [], isCurrent = () => true) {
        return this.aplicarEdicao(uid, base, desired, () => [], (queue, state) => {
            const blocked = blockedConflictKeys(queue.conflicts, reviewed);
            const former = new Map(remote.map(item => [recordEntityKey(item), item]));
            const records = registrosFinanceiros(state), keys = new Set(records.map(recordEntityKey));
            if (records.some(item => !validSyncIdentity(item.id))) throw new Error('IDs locais incompatíveis');
            const candidates = [];
            for (const item of [...records.map(item => ({ ...item, deleted: false })), ...deletions.filter(item => !keys.has(recordEntityKey(item))).map(item => ({ month: item.month, type: item.type, id: item.id, deleted: true }))]) {
                const entityKey = recordEntityKey(item), old = former.get(entityKey);
                if (blocked.has(entityKey) || old?.deleted && !item.deleted) continue;
                const value = item.deleted ? {month:item.month,type:item.type,id:item.id,deleted:true} : {month:item.month,type:item.type,id:item.id,record:item.record,deleted:false};
                const pending = queue.outbox.filter(op => op.entityKey === entityKey).at(-1);
                if (!pending && old && (item.deleted ? old.deleted : recordsEquivalent(item.record, old.record))) continue;
                if (pending && recordsEquivalent(pending.value, value)) continue;
                const baseRevision = pending ? (queue.attempted?.[pending.id] ? pending.id : pending.baseRevision) : old?.revision || null;
                candidates.push({id:operationId(entityKey,baseRevision,value),entityKey,baseRevision,value});
            }
            const attempted = queue.outbox.filter(op => queue.attempted?.[op.id]);
            queue.outbox = [...attempted, ...coalesceOutbox(queue.outbox.filter(op => !queue.attempted?.[op.id]), candidates)];
        }, isCurrent);
    }
    async concluirOperacao(uid, operation, result) {
        if (result?.acknowledged !== true) throw new Error('ACK ausente');
        return this.alterarFila(uid, fila => {
            if (!fila.outbox.some(op => op.id === operation.id)) return fila;
            if (result.conflict) fila.conflicts.push({ kind: 'concurrent-change', operation: copy(operation), remote: result.remote || null });
            fila.outbox = fila.outbox.filter(op => op.id !== operation.id);
            fila.remoteRevisions ||= {};
            if (!result.conflict) fila.remoteRevisions[operation.entityKey] = result.revision || operation.id;
            if (fila.attempted) delete fila.attempted[operation.id];
            return fila;
        });
    }
    async enviarFila(uid, commit, isCurrent = () => true, canSend = () => true, remote = []) {
        const snapshot = await this.lerFila(uid);
        for (const operation of snapshot.outbox) {
            if (!isCurrent()) break;
            const latest = await this.lerFila(uid);
            if (!latest.outbox.some(op => op.id === operation.id)) continue;
            if (!canSend(operation)) continue;
            const equivalent = remote.find(item => recordEntityKey(item) === operation.entityKey && item.revision === operation.baseRevision && (item.deleted ? operation.value?.deleted : !operation.value?.deleted && recordsEquivalent(item.record, operation.value?.record)));
            if (equivalent && !latest.attempted?.[operation.id]) {
                await this.concluirOperacao(uid, operation, {acknowledged:true, revision:equivalent.revision});
                continue;
            }
            const claimed = await this.alterarFila(uid, fila => {
                if (fila.outbox.some(op => op.id === operation.id)) {
                    fila.attempted ||= {}; fila.attempted[operation.id] = true;
                }
                return fila;
            });
            if (!claimed.outbox.some(op => op.id === operation.id)) continue;
            if (!isCurrent()) break;
            const result = await commit(uid, copy(operation));
            await this.concluirOperacao(uid, operation, result);
        }
        return this.lerFila(uid);
    }
    async aplicar(uid, revisaoEsperada, proximoEstado, operacoes = []) {
        if (typeof uid !== 'string' || !uid.trim() || uid.includes(':')) throw new Error('UID inválido');
        if (!validRevision(revisaoEsperada) || !this.validarEstado(proximoEstado) ||
            !Array.isArray(operacoes) || operacoes.some((op) => !op || typeof op.id !== 'string' || !op.id))
            throw new Error('Atualização inválida');
        const stateKey = `estado:${uid}`, queueKey = `fila:${uid}`;
        const result = await this.db.alterarDocumentos([stateKey, queueKey], (docs) => {
            const previous = docs.get(stateKey);
            if (!previous || !validRevision(previous.revisao) || previous.revisao !== revisaoEsperada)
                throw new ConflitoPersistencia();
            const queue = copy(docs.get(queueKey) || { outbox: [], conflicts: [], lastConfirmed: null });
            if (!this.validarFila(queue) || !Array.isArray(queue.outbox)) throw new Error('Fila inválida');
            const existing = new Map(queue.outbox.map((op) => [op.id, JSON.stringify(op)]));
            for (const op of operacoes) {
                if (existing.has(op.id) && existing.get(op.id) !== JSON.stringify(op))
                    throw new Error('ID de operação duplicado com payload divergente');
                if (!existing.has(op.id)) {
                    queue.outbox.push(copy(op));
                    existing.set(op.id, JSON.stringify(op));
                }
            }
            if (!this.validarFila(queue)) throw new Error('Fila inválida');
            docs.set(stateKey, { ...previous, dados: copy(proximoEstado), revisao: previous.revisao + 1 });
            docs.set(queueKey, queue);
            return docs;
        });
        return { estado: result.get(stateKey), fila: result.get(queueKey) };
    }
    // A fila é modificada dentro da transação IndexedDB, nunca por read-modify-write
    // realizado em memória entre abas. O método não faz rede nem altera o estado.
    async lerFila(uid) {
        if (!(uid === '@local' || /^[A-Za-z0-9_-]{1,128}$/.test(uid || ''))) throw new Error('UID inválido');
        const fila = await this.db.ler(`fila:${uid}`);
        if (!fila || !this.validarFila(fila) || !Array.isArray(fila.outbox))
            throw new Error('Fila não inicializada ou inválida');
        return copy(fila);
    }
    async confirmarSincronizacao(uid, estadoEsperado, quando, isCurrent) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || '') || !this.validarEstado(estadoEsperado)
            || typeof quando !== 'string' || typeof isCurrent !== 'function') throw new Error('Confirmação inválida');
        let confirmed = false;
        const stateKey = `estado:${uid}`, queueKey = `fila:${uid}`;
        const result = await this.db.alterarDocumentos([stateKey, queueKey], docs => {
            const state = docs.get(stateKey), queue = docs.get(queueKey);
            if (!state || !this.validarEstado(state.dados) || !queue || !this.validarFila(queue)) throw new Error('Persistência inválida');
            if (isCurrent() && financialStatesEquivalent(state.dados, estadoEsperado)
                && !queue.outbox.length && !queue.conflicts.length && !queue.restoredPending) {
                queue.lastConfirmed = !Number.isFinite(Date.parse(queue.lastConfirmed)) || quando > queue.lastConfirmed ? quando : queue.lastConfirmed;
                queue.migrationPending = false;
                confirmed = true;
            }
            return docs;
        });
        return { confirmed, fila: result.get(queueKey) };
    }
    async alterarFila(uid, transformar) {
        if (!(uid === '@local' || /^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) || typeof transformar !== 'function')
            throw new Error('UID ou transformação inválida');
        return this.coordenarSettings(uid, () => this.db.alterar(`fila:${uid}`, (original) => {
            if (!original || !this.validarFila(original) || !Array.isArray(original.outbox))
                throw new Error('Fila não inicializada ou inválida');
            const atual = copy(original);
            const proxima = transformar(atual);
            if (!proxima || typeof proxima.then === 'function' || !this.validarFila(proxima)
                || !Array.isArray(proxima.outbox)) throw new Error('Fila resultante inválida');
            return copy(proxima);
        }));
    }
    async enfileirar(uid, operation) {
        if (!operation || typeof operation.id !== 'string' || !operation.id)
            throw new Error('Operação inválida');
        return this.alterarFila(uid, (fila) => {
            const atual = fila.outbox.find((item) => item.id === operation.id);
            if (atual && JSON.stringify(atual) !== JSON.stringify(operation))
                throw new Error('ID de operação duplicado com payload divergente');
            if (!atual) fila.outbox.push(copy(operation));
            return fila;
        });
    }
    async registrarConflitoSettings(uid, conflito, isCurrent = () => true) {
        const candidate = copy(conflito);
        if (candidate?.kind !== 'settings' || !functionalSettings(candidate.local)
            || !validateRemoteSettings(candidate.remote)) throw new Error('Conflito de configurações inválido');
        return this.alterarFila(uid, fila => {
            if (!isCurrent()) throw Object.assign(new Error('Sessão de persistência invalidada'), { code: 'persistence/cancelled' });
            // Inspect the current queue inside the transaction, including entries
            // added by another tab. Existing entries remain byte-for-byte intact.
            if (!settingsEquivalent(candidate.local, candidate.remote) && !fila.conflicts.some(item =>
                item?.kind === 'settings' && settingsEquivalent(item.local, candidate.local)
                && settingsEquivalent(item.remote, candidate.remote))) fila.conflicts.push(candidate);
            return fila;
        });
    }
    async registrarConflito(uid, conflito) {
        const id = conflito?.operation?.id || conflito?.operationId;
        if (typeof id !== 'string' || !id) throw new Error('Conflito inválido');
        return this.alterarFila(uid, (fila) => {
            if (!fila.conflicts.some((item) => (item?.operation?.id || item?.operationId) === id))
                fila.conflicts.push(copy(conflito));
            return fila;
        });
    }
    async confirmar(uid, operationId, quando) {
        if (!(uid === '@local' || /^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) || typeof operationId !== 'string' || !operationId || typeof quando !== 'string' || !quando)
            throw new Error('ACK inválido');
        const key = `fila:${uid}`;
        return this.db.alterar(key, (original) => {
            if (!original || !this.validarFila(original) || !Array.isArray(original.outbox))
                throw new Error('Fila indisponível');
            const queue = copy(original);
            const found = queue.outbox.findIndex((op) => op.id === operationId);
            if (found < 0) return queue;
            queue.outbox.splice(found, 1);
            queue.lastConfirmed = quando;
            return queue;
        });
    }
}
