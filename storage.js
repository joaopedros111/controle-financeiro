function detectarArmazenamentoLocal() {
    try {
        const teste = "__controle_financeiro_storage_test__";
        globalThis.localStorage.setItem(teste, "1");
        globalThis.localStorage.removeItem(teste);
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

export function criarArmazenamento(local = detectarArmazenamentoLocal(), memoria = new Map()) {
    return {
        persistente: Boolean(local),

        ler(chave) {
            if (memoria.has(chave)) return memoria.get(chave);
            try {
                return local ? local.getItem(chave) : null;
            } catch {
                return memoria.get(chave) ?? null;
            }
        },

        escrever(chave, valor) {
            try {
                if (!local) throw new Error("armazenamento local indisponível");
                local.setItem(chave, valor);
                memoria.delete(chave);
                return true;
            } catch {
                memoria.set(chave, valor);
                return false;
            }
        },

        remover(chave) {
            try {
                if (local) local.removeItem(chave);
            } catch { /* remove também da cópia temporária */ }
            memoria.delete(chave);
        },

        lerJson(chave) {
            try {
                const valor = this.ler(chave);
                return valor === null ? null : JSON.parse(valor);
            } catch {
                return null;
            }
        },

        escreverJson(chave, valor) {
            try {
                return this.escrever(chave, JSON.stringify(valor));
            } catch {
                return false;
            }
        }
    };
}

export const storage = criarArmazenamento();
