// Camada de integração transacional opt-in; não apaga a fonte legada.
import { abrirPersistenciaFinanceira } from './indexeddb-persistence.js';

export class ConflitoPersistencia extends Error {
    constructor(message = 'Estado alterado por outra aba; revisão necessária') {
        super(message); this.name = 'ConflitoPersistencia';
    }
}
const clone = (value) => structuredClone(value);
const fingerprint = (value) => JSON.stringify(value);

export class EstadoTransacional {
    constructor(db, validar) { this.db = db; this.validar = validar; }
    async carregar(chave, lerLegado) {
        const legado = lerLegado(chave);
        if (!legado || !['valido', 'ausente'].includes(legado.estado)) throw new Error('Fonte legada inválida ou indisponível');
        if (legado.estado === 'valido' && !this.validar(legado.valor)) throw new Error('Dados legados inválidos');
        const doc = await this.db.alterar(`estado:${chave}`, (atual) => {
            if (atual !== null) return atual;
            return { revisao: 0, dados: legado.estado === 'valido' ? clone(legado.valor) : null,
                origem: legado.estado, criadoEm: new Date().toISOString() };
        });
        if (!Number.isSafeInteger(doc.revisao) || doc.revisao < 0 || (doc.dados !== null && !this.validar(doc.dados))) {
            throw new Error('Estado IndexedDB inválido');
        }
        return clone(doc);
    }
    async gravar(chave, revisaoEsperada, proximo) {
        if (!this.validar(proximo)) throw new Error('Estado financeiro inválido');
        return this.db.alterar(`estado:${chave}`, (atual) => {
            if (!atual || atual.revisao !== revisaoEsperada) throw new ConflitoPersistencia();
            if (fingerprint(atual.dados) === fingerprint(proximo)) return atual;
            return { ...atual, revisao: atual.revisao + 1, dados: clone(proximo) };
        });
    }
    async consultar(chave) { return this.db.ler(`estado:${chave}`); }
}
export async function iniciarEstadoTransacional(validar, factory) {
    const db = await abrirPersistenciaFinanceira(factory);
    return new EstadoTransacional(db, validar);
}
