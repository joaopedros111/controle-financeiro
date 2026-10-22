// Combina apenas mudanças explicitamente realizadas sobre um estado-base.
// Estado divergente no mesmo registro ou configuração gera conflito, nunca last-writer-wins.
export class ConflitoEdicao extends Error {
    constructor(keys) {
        super(`Edição concorrente requer revisão: ${keys.join(', ')}`);
        this.name = 'ConflitoEdicao';
        this.keys = keys;
    }
}
const copy = (value) => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const types = ['receitas', 'despesas'];
const monthData = (state, month, type) => state?.meses?.[month]?.[type] || [];
function recordsOf(state) {
    const result = new Map();
    for (const [month, data] of Object.entries(state?.meses || {})) {
        for (const type of types) {
            const records = data?.[type];
            if (!Array.isArray(records)) throw new Error('Lista de lançamentos inválida');
            for (const item of records) {
                if (!item || typeof item.id !== 'string' || !item.id) throw new Error('ID de lançamento inválido');
                const key = JSON.stringify([month, type, item.id]);
                if (result.has(key)) throw new Error('ID de lançamento duplicado');
                result.set(key, { month, type, item: copy(item) });
            }
        }
    }
    return result;
}
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function combinarEdicaoFinanceira(base, proposta, atual) {
    if (!base || !proposta || !atual || typeof base !== 'object' || typeof proposta !== 'object' || typeof atual !== 'object')
        throw new Error('Estados financeiros inválidos');
    const before = recordsOf(base), desired = recordsOf(proposta), existing = recordsOf(atual);
    const output = copy(atual), conflicts = [], changed = [];
    for (const key of new Set([...before.keys(), ...desired.keys()])) {
        const prev = before.get(key)?.item;
        const next = desired.get(key)?.item;
        if (equal(prev, next)) continue;
        const current = existing.get(key)?.item;
        if (!equal(current, prev) && !equal(current, next)) { conflicts.push(`registro:${key}`); continue; }
        const { month, type } = desired.get(key) || before.get(key);
        output.meses ||= {};
        output.meses[month] ||= { receitas: [], despesas: [] };
        const list = output.meses[month][type];
        if (!Array.isArray(list)) throw new Error('Lista financeira atual inválida');
        const index = list.findIndex((record) => record.id === (next || prev).id);
        if (next === undefined) {
            if (index >= 0) list.splice(index, 1);
            changed.push({ month, type, id: prev.id, deleted: true });
        } else {
            if (index >= 0) list[index] = copy(next);
            else list.push(copy(next));
            changed.push({ month, type, id: next.id, record: copy(next), deleted: false });
        }
    }
    const reserved = new Set(['meses']);
    for (const key of new Set([...Object.keys(base), ...Object.keys(proposta)])) {
        if (reserved.has(key) || equal(base[key], proposta[key])) continue;
        if (!equal(atual[key], base[key]) && !equal(atual[key], proposta[key])) {
            conflicts.push(`configuração:${key}`); continue;
        }
        if (hasOwn(proposta, key)) output[key] = copy(proposta[key]);
        else delete output[key];
    }
    // Preserva campos não financeiros dos meses sem aceitar alterações ocultas.
    for (const month of new Set([...Object.keys(base.meses || {}), ...Object.keys(proposta.meses || {})])) {
        const prev = base.meses?.[month] || {};
        const next = proposta.meses?.[month] || {};
        const curr = atual.meses?.[month] || {};
        for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
            if (types.includes(key) || equal(prev[key], next[key])) continue;
            if (!equal(curr[key], prev[key]) && !equal(curr[key], next[key])) {
                conflicts.push(`mês:${month}:${key}`); continue;
            }
            output.meses ||= {};
            output.meses[month] ||= { receitas: [], despesas: [] };
            if (hasOwn(next, key)) output.meses[month][key] = copy(next[key]);
            else delete output.meses[month][key];
        }
    }
    if (conflicts.length) throw new ConflitoEdicao(conflicts);
    return { estado: output, mudancas: changed };
}
