import { ACCOUNT_ACCESS_KEY, assertAccountAccess, validAccountControl, confirmedForRemoval } from './account-data-policy.js';
// Persistência transacional opt-in. Não substitui o armazenamento legado até a homologação.
const DATABASE = 'controleFinanceiro:integridade:v1';
const STORE = 'documents';

export function abrirPersistenciaFinanceira(factory = globalThis.indexedDB) {
    if (!factory) return Promise.reject(new Error('IndexedDB indisponível'));
    return new Promise((resolve, reject) => {
        const request = factory.open(DATABASE, 2);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        request.onerror = () => reject(request.error || new Error('Falha ao abrir IndexedDB'));
        request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close();
            resolve(new PersistenciaFinanceira(request.result));
        };
        request.onblocked = () => reject(new Error('Atualização IndexedDB bloqueada por outra aba'));
    });
}

export class PersistenciaFinanceira {
    constructor(db) { this.db = db; }
    fechar() { this.db.close(); }
    // A callback deve ser síncrona: await dentro da transação pode encerrá-la.
    alterar(chave, transformar) {
        if (typeof chave !== 'string' || !chave) return Promise.reject(new Error('Chave inválida'));
        return this.alterarDocumentos([chave], docs => {
            const value = transformar(docs.get(chave));
            if (value === undefined || value?.then) throw new Error('Invalid transaction result');
            docs.set(chave, value); return docs;
        }).then(docs => docs.get(chave));
    }
    // Uma única transação para estado e fila: ou ambos são gravados, ou nenhum.
    alterarDocumentos(chaves, transformar) {
        return this.alterarComLeituras(chaves, [], transformar);
    }
    // Read-set participates in the same transaction but can never be written.
    alterarComLeituras(chaves, somenteLeitura, transformar) {
        if (!Array.isArray(chaves) || !chaves.length || new Set(chaves).size !== chaves.length ||
            chaves.some((chave) => typeof chave !== 'string' || !chave)) {
            return Promise.reject(new Error('Chaves transacionais inválidas'));
        }
        if (!Array.isArray(somenteLeitura) || somenteLeitura.some(key => typeof key !== 'string' || !key || chaves.includes(key)) || new Set(somenteLeitura).size !== somenteLeitura.length)
            return Promise.reject(new Error('Read-set invalido'));
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const valores = new Map();
            const access = this.acessoConta;
            const guarded = this.requerConta && chaves.some(key => /^(estado:|fila:|restore-recovery:)/.test(key));
            const reads = [...new Set([...chaves, ...somenteLeitura, ...(guarded ? [ACCOUNT_ACCESS_KEY] : [])])];
            let erroTransformacao;
            let resultado;
            // As leituras são enfileiradas antes de qualquer escrita, na mesma transação.
            for (const chave of reads) {
                const request = store.get(chave);
                request.onsuccess = () => {
                    valores.set(chave, request.result === undefined ? null : structuredClone(request.result));
                    if (valores.size !== reads.length) return;
                    try {
                        if (guarded) assertAccountAccess(valores.get(ACCOUNT_ACCESS_KEY), access, chaves);
                        const alterados = transformar(new Map(chaves.map(key => [key, valores.get(key)])), new Map(somenteLeitura.map(key => [key, valores.get(key)])));
                        if (!(alterados instanceof Map) || alterados.size !== chaves.length ||
                            chaves.some((key) => !alterados.has(key))) throw new Error('Resultado transacional incompleto');
                        for (const key of chaves) {
                            const value = alterados.get(key);
                            if (value === undefined || (value && typeof value.then === 'function'))
                                throw new Error('Resultado transacional inválido');
                            store.put(structuredClone(value), key);
                        }
                        resultado = new Map([...alterados].map(([key, value]) => [key, structuredClone(value)]));
                    } catch (error) {
                        erroTransformacao = error;
                        tx.abort();
                    }
                };
            }
            tx.oncomplete = () => resolve(resultado);
            tx.onabort = () => reject(erroTransformacao || tx.error || new Error('Transação cancelada'));
            tx.onerror = () => reject(erroTransformacao || tx.error || new Error('Falha na transação'));
        });
    }
    ler(chave) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE, 'readonly');
            const request = tx.objectStore(STORE).get(chave);
            let resultado;
            request.onsuccess = () => { resultado = request.result === undefined ? null : structuredClone(request.result); };
            tx.oncomplete = () => resolve(resultado);
            tx.onabort = () => reject(tx.error || new Error('Leitura cancelada'));
            request.onerror = () => reject(request.error);
        });
    }
    // Read-only snapshot, including anonymous state/queue. Never writes or bypasses UID guards.
    lerDocumentos(chaves) {
        if (!Array.isArray(chaves) || !chaves.length || new Set(chaves).size !== chaves.length || chaves.some(k => typeof k !== 'string' || !k))
            return Promise.reject(new Error('Chaves de leitura inválidas'));
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE, 'readonly'), values = new Map();
            for (const key of chaves) {
                const request = tx.objectStore(STORE).get(key);
                request.onsuccess = () => values.set(key, request.result === undefined ? null : structuredClone(request.result));
            }
            tx.oncomplete = () => resolve(values);
            tx.onabort = () => reject(tx.error || new Error('Leitura de fontes cancelada'));
            tx.onerror = () => reject(tx.error || new Error('Não foi possível ler as fontes'));
        });
    }
    listarImportacoesPendentes(uid) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) return Promise.reject(new Error('UID inválido'));
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE, 'readonly'), keys = [], prefix = 'restore-recovery:' + uid + ':migration-';
            const request = tx.objectStore(STORE).openCursor();
            request.onsuccess = () => { const row = request.result; if (!row) return;
                if (typeof row.key === 'string' && row.key.startsWith(prefix) && row.value?.state !== 'confirmed') keys.push(row.key);
                row.continue();
            };
            tx.oncomplete = () => resolve(keys);
            tx.onabort = () => reject(tx.error || new Error('Leitura de diários interrompida'));
            request.onerror = () => reject(request.error || new Error('Falha ao ler diários'));
        });
    }
    listarRecuperacoesConta(uid) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE, 'readonly'), rows = [], request = tx.objectStore(STORE).openCursor();
            request.onsuccess = () => { const row = request.result; if (!row) return;
                if (typeof row.key === 'string' && row.key.startsWith('account-recovery:' + uid + ':')) rows.push(structuredClone(row.value));
                row.continue();
            };
            tx.oncomplete = () => resolve(rows);
            tx.onabort = () => reject(tx.error || new Error('Recovery read failed'));
        });
    }
    async preservarOperacaoBloqueada(uid, base, proposta, code) {
        const key = 'account-recovery:' + uid + ':' + crypto.randomUUID();
        await this.alterar(key, previous => {
            if (previous !== null) throw new Error('Recovery already exists');
            return { uid, base: structuredClone(base), proposta: structuredClone(proposta), code };
        });
        return key;
    }
    // One transaction: proof, session fence, and deletion of ONLY confirmed pairs.
    removerContasConfirmadas(epoch, onlyUid) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), docs = new Map();
            let result = [], failure;
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
                const row = cursor.result;
                if (row) { docs.set(row.key, row.value); row.continue(); return; }
                try {
                    const control = docs.get(ACCOUNT_ACCESS_KEY);
                    if (!validAccountControl(control) || control.uid !== null || control.epoch !== epoch || control.closing)
                        throw new Error('Session changed during cleanup; copies preserved');
                    for (const [key, state] of docs) {
                        if (!/^estado:[A-Za-z0-9_-]{1,128}$/.test(key)) continue;
                        const uid = key.slice(7), queue = docs.get('fila:' + uid);
                        if (uid === 'local' || uid !== onlyUid) continue;
                        if (!confirmedForRemoval(state, queue) || [...docs.keys()].some(k => k.startsWith('account-recovery:' + uid + ':'))) continue;
                        store.delete(key); store.delete('fila:' + uid); result.push({ uid, state: structuredClone(state.dados) });
                    }
                } catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(failure || tx.error || new Error('Cleanup aborted'));
            tx.onerror = () => reject(tx.error || new Error('Cleanup failed'));
        });
    }
    async importarLegado(chave, lerLegado, validar) {
        // Nunca sobrescreve IndexedDB existente, nem remove a fonte localStorage.
        const origem = lerLegado(chave);
        if (origem?.estado !== 'valido') {
            if (origem?.estado === 'ausente') return { status: 'ausente' };
            return { status: 'bloqueado', motivo: origem?.estado || 'leitura-invalida' };
        }
        if (!validar(structuredClone(origem.valor))) return { status: 'bloqueado', motivo: 'validacao' };
        let importado = false;
        await this.alterar(chave, (atual) => {
            if (atual !== null) return atual;
            importado = true;
            return { versao: 1, legado: structuredClone(origem.valor), migradoEm: new Date().toISOString() };
        });
        return { status: importado ? 'importado' : 'existente' };
    }
    async enfileirar(uid, operacao) {
        if (!uid || !operacao?.id) throw new Error('Operação inválida');
        return this.alterar(`fila:${uid}`, (atual) => {
            const fila = atual || { outbox: [], conflicts: [], lastConfirmed: null };
            if (!fila.outbox.some((item) => item.id === operacao.id)) fila.outbox.push(structuredClone(operacao));
            return fila;
        });
    }
    async confirmar(uid, id, instante) {
        return this.alterar(`fila:${uid}`, (atual) => {
            if (!atual) throw new Error('Fila não inicializada');
            const index = atual.outbox.findIndex((item) => item.id === id);
            if (index < 0) return atual; // ACK antigo não confirma operações desconhecidas.
            atual.outbox.splice(index, 1);
            atual.lastConfirmed = instante;
            return atual;
        });
    }
}
