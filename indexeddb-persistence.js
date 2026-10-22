// Persistência transacional opt-in. Não substitui o armazenamento legado até a homologação.
const DATABASE = 'controleFinanceiro:integridade:v1';
const STORE = 'documents';

export function abrirPersistenciaFinanceira(factory = globalThis.indexedDB) {
    if (!factory) return Promise.reject(new Error('IndexedDB indisponível'));
    return new Promise((resolve, reject) => {
        const request = factory.open(DATABASE, 1);
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
        return new Promise((resolve, reject) => {
            let resultado;
            let erroTransformacao;
            const tx = this.db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const read = store.get(chave);
            read.onsuccess = () => {
                try {
                    const atual = read.result === undefined ? null : structuredClone(read.result);
                    const proximo = transformar(atual);
                    if (proximo && typeof proximo.then === 'function') throw new Error('Transação assíncrona não suportada');
                    if (proximo === undefined) throw new Error('Transação sem resultado');
                    resultado = structuredClone(proximo);
                    store.put(resultado, chave);
                } catch (error) {
                    resultado = undefined;
                    erroTransformacao = error;
                    tx.abort();
                }
            };
            tx.oncomplete = () => resolve(resultado);
            tx.onabort = () => reject(erroTransformacao || tx.error || new Error('Transação cancelada'));
            tx.onerror = () => reject(tx.error || new Error('Falha na transação'));
        });
    }
    // Uma única transação para estado e fila: ou ambos são gravados, ou nenhum.
    alterarDocumentos(chaves, transformar) {
        if (!Array.isArray(chaves) || !chaves.length || new Set(chaves).size !== chaves.length ||
            chaves.some((chave) => typeof chave !== 'string' || !chave)) {
            return Promise.reject(new Error('Chaves transacionais inválidas'));
        }
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const valores = new Map();
            let erroTransformacao;
            let resultado;
            // As leituras são enfileiradas antes de qualquer escrita, na mesma transação.
            for (const chave of chaves) {
                const request = store.get(chave);
                request.onsuccess = () => {
                    valores.set(chave, request.result === undefined ? null : structuredClone(request.result));
                    if (valores.size !== chaves.length) return;
                    try {
                        const alterados = transformar(new Map(valores));
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
            tx.onerror = () => reject(tx.error || new Error('Falha na transação'));
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
