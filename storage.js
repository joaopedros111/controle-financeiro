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
    let persistenciaDisponivel = Boolean(local);
    const dadosProtegidos = new Map();

    function lerJsonResultado(chave, { protegerInvalido = false } = {}) {
        let bruto;
        if (memoria.has(chave)) {
            bruto = memoria.get(chave);
        } else if (!local) {
            return { estado: "indisponivel", valor: null, bruto: null };
        } else {
            try {
                bruto = local.getItem(chave);
            } catch {
                persistenciaDisponivel = false;
                return { estado: "erro", valor: null, bruto: null };
            }
        }

        if (bruto === null) return { estado: "ausente", valor: null, bruto: null };
        try {
            return { estado: "valido", valor: JSON.parse(bruto), bruto };
        } catch {
            if (protegerInvalido) dadosProtegidos.set(chave, bruto);
            return { estado: "invalido", valor: null, bruto };
        }
    }

    return {
        get persistente() { return persistenciaDisponivel; },

        ler(chave) {
            if (memoria.has(chave)) return memoria.get(chave);
            try {
                return local ? local.getItem(chave) : null;
            } catch {
                persistenciaDisponivel = false;
                return memoria.get(chave) ?? null;
            }
        },

        escrever(chave, valor, { substituirProtegido = false } = {}) {
            if (dadosProtegidos.has(chave) && !substituirProtegido) return false;
            try {
                if (!local) throw new Error("armazenamento local indisponível");
                local.setItem(chave, valor);
                memoria.delete(chave);
                if (substituirProtegido) dadosProtegidos.delete(chave);
                persistenciaDisponivel = true;
                return true;
            } catch {
                memoria.set(chave, valor);
                persistenciaDisponivel = false;
                return false;
            }
        },

        remover(chave, { removerProtegido = false } = {}) {
            if (dadosProtegidos.has(chave) && !removerProtegido) return false;
            if (removerProtegido) dadosProtegidos.delete(chave);
            try {
                if (local) local.removeItem(chave);
            } catch { /* remove também da cópia temporária */ }
            memoria.delete(chave);
            return true;
        },

        lerJson(chave) {
            try {
                const valor = this.ler(chave);
                return valor === null ? null : JSON.parse(valor);
            } catch {
                return null;
            }
        },

        lerJsonResultado,

        proteger(chave, bruto = null) {
            dadosProtegidos.set(chave, bruto);
        },

        desproteger(chave) {
            dadosProtegidos.delete(chave);
        },

        dadosProtegidos() {
            return [...dadosProtegidos].map(([chave, bruto]) => ({ chave, bruto }));
        },

        escreverJson(chave, valor, opcoes = {}) {
            try {
                return this.escrever(chave, JSON.stringify(valor), opcoes);
            } catch {
                return false;
            }
        }
    };
}

export function criarRecuperacaoFinanceira(storage) {
    const fontes = new Map();

    return {
        get protegido() { return fontes.size > 0; },
        fontes() {
            return [...fontes].map(([chave, bruto]) => ({ chave, bruto }));
        },
        proteger(chave, bruto = null) {
            storage.proteger(chave, bruto);
            fontes.set(chave, bruto);
        },
        exportarBackup(exportar) {
            if (fontes.size > 0) return false;
            return exportar() !== false;
        },
        restaurar({ chave, backup, validar, normalizar, confirmar }) {
            if (!validar(backup)) return { estado: "invalido", dados: null, persistido: false };

            const dados = normalizar(backup);
            if (!confirmar()) return { estado: "cancelado", dados: null, persistido: false };

            const substituirProtegido = fontes.has(chave);
            const persistido = storage.escreverJson(chave, dados, { substituirProtegido });
            if (persistido) {
                fontes.forEach((_, fonte) => storage.desproteger(fonte));
                fontes.clear();
            }
            return { estado: "restaurado", dados, persistido };
        }
    };
}

export const storage = criarArmazenamento();
