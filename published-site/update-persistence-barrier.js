const falha = (code = 'update/draining') => Object.assign(new Error(code === 'update/draining'
    ? 'Atualização em preparação. A nova alteração não foi iniciada.'
    : 'A persistência não foi confirmada. Atualização cancelada; dados preservados.'), { code });
const escritasBanco = new Set(['alterar', 'alterarDocumentos', 'alterarComLeituras', 'preservarOperacaoBloqueada',
    'removerCredenciaisLocaisObsoletas', 'removerContasConfirmadas', 'importarLegado', 'enfileirar', 'confirmar']);
const escritasServico = new Set(['inicializar', 'preservarEdicaoRejeitada', 'aplicarEdicao', 'prepararPublicacao',
    'preservarIntencoes', 'preservarConfirmacaoInconclusiva', 'concluirOperacao', 'aplicar', 'confirmarSincronizacao',
    'confirmarDecisao', 'alterarFila', 'enfileirar', 'registrarConflitoSettings', 'registrarConflito', 'confirmar', 'coordenarSettings']);

// Local to one JavaScript realm. Permits are capabilities, never UID-based.
export class BarreiraPersistencia {
    constructor({ timeoutMs = 30000 } = {}) {
        this.timeoutMs = timeoutMs; this.operacoes = new Set(); this.transacoes = new Set();
        this.versao = 0; this.tentativa = null; this.permissaoAtual = null;
        this.bancos = new WeakMap(); this.servicos = new WeakMap();
    }
    get fechada() { return this.tentativa !== null; }
    valida(token) { return token?.ativa && (!token.manutencao || this.tentativa === token.manutencao); }
    admitir(token = this.permissaoAtual) {
        if (token && !this.valida(token)) throw falha();
        if (!token) {
            if (this.fechada) throw falha();
            token = { ativa: true, referencias: 0 };
            token.promise = new Promise(resolve => token.resolver = resolve);
            this.operacoes.add(token); this.versao++;
        }
        token.referencias++;
        let encerrada = false;
        return { token, concluir: error => {
            if (encerrada) return; encerrada = true;
            if (error && this.tentativa) this.tentativa.erros.push(error);
            if (--token.referencias === 0) {
                token.ativa = false; this.operacoes.delete(token); token.resolver?.(); this.versao++;
            }
        } };
    }
    comPermissao(token, executar) {
        if (!this.valida(token)) throw falha();
        const anterior = this.permissaoAtual; this.permissaoAtual = token;
        try { return executar(); } finally { this.permissaoAtual = anterior; }
    }
    executar(executar, token) {
        const admissao = this.admitir(token);
        try {
            const result = this.comPermissao(admissao.token, () => executar(this.contexto(admissao.token)));
            if (result?.then) return Promise.resolve(result).then(value => { admissao.concluir(); return value; }, error => { admissao.concluir(error); throw error; });
            admissao.concluir(); return result;
        } catch (error) { admissao.concluir(error); throw error; }
    }
    protegerFuncao(fn) {
        const barreira = this;
        return function(...args) { return barreira.executar(() => fn.apply(this, args)); };
    }
    contexto(token = this.permissaoAtual) {
        if (!this.valida(token)) throw falha();
        return { token, banco: db => this.vincularBanco(db, token), servico: service => this.vincularServico(service, token),
            vincular: fn => (...args) => this.comPermissao(token, () => fn(...args)) };
    }
    observarTransacao(tx) {
        let erro;
        const registro = {};
        registro.promise = new Promise(resolve => {
            const terminar = () => {
                if (erro && this.tentativa) this.tentativa.erros.push(erro);
                this.transacoes.delete(registro); this.versao++; resolve();
            };
            tx.addEventListener('error', () => { erro ||= tx.error || falha('update/persistence-failed'); });
            tx.addEventListener('abort', () => { erro ||= tx.error || falha('update/persistence-failed'); terminar(); }, { once: true });
            tx.addEventListener('complete', terminar, { once: true });
        });
        this.transacoes.add(registro); this.versao++;
        return tx;
    }
    vincularBanco(db, token = null) {
        const raw = this.bancos.get(db) || db, barreira = this;
        let facade;
        const native = raw.db && new Proxy(raw.db, { get(target, name) {
            if (name === 'transaction') return (...args) => {
                if (args[1] !== 'readwrite') return target.transaction(...args);
                if (!barreira.valida(token)) {
                    if (token || barreira.fechada) throw falha();
                }
                return barreira.observarTransacao(target.transaction(...args));
            };
            const value = Reflect.get(target, name, target);
            return typeof value === 'function' ? value.bind(target) : value;
        } });
        facade = new Proxy(raw, { get(target, name) {
            if (name === 'db') return native;
            if (name === 'executarMutacao') return executar => barreira.executar(executar, token || undefined);
            const value = Reflect.get(target, name, target);
            if (typeof value !== 'function') return value;
            if (!escritasBanco.has(name)) return (...args) => value.apply(facade, args);
            return (...args) => barreira.executar(ctx => value.apply(barreira.vincularBanco(raw, ctx.token), args), token || undefined);
        } });
        this.bancos.set(facade, raw); return facade;
    }
    vincularServico(service, token = null) {
        const raw = this.servicos.get(service) || service, barreira = this;
        let facade;
        facade = new Proxy(raw, { get(target, name) {
            if (name === 'db') return barreira.vincularBanco(target.db, token);
            const value = Reflect.get(target, name, target);
            if (typeof value !== 'function') return value;
            return (...args) => {
                if (!escritasServico.has(name) || name === 'coordenarSettings' && args[2] === true) return value.apply(facade, args);
                return barreira.executar(ctx => {
                    if (name === 'coordenarSettings') args[1] = ctx.vincular(args[1]);
                    return value.apply(barreira.vincularServico(raw, ctx.token), args);
                }, token || undefined);
            };
        } });
        this.servicos.set(facade, raw); return facade;
    }
    fechar() {
        if (this.fechada) throw falha('update/in-progress');
        const tentativa = { erros: [], pronta: -1, commit: false, ativacaoSolicitada: false };
        tentativa.cancelada = new Promise((_, reject) => tentativa.rejeitar = reject);
        void tentativa.cancelada.catch(() => {});
        return this.tentativa = tentativa;
    }
    marcarAtivacao(tentativa) {
        this.conferir(tentativa);
        tentativa.ativacaoSolicitada = true;
    }
    desmarcarAtivacao(tentativa) {
        if (this.tentativa !== tentativa || tentativa.commit || !tentativa.ativacaoSolicitada) return false;
        tentativa.ativacaoSolicitada = false;
        return true;
    }
    conferir(tentativa) {
        if (this.tentativa !== tentativa || tentativa.commit) throw falha('update/cancelled');
        if (tentativa.erros.length) throw falha('update/persistence-failed');
    }
    async esperar(tentativa, tarefa, timeoutMs = this.timeoutMs) {
        let timer;
        try {
            return await Promise.race([tarefa, tentativa.cancelada, new Promise((_, reject) => {
                timer = setTimeout(() => reject(falha('update/persistence-pending')), timeoutMs);
            })]);
        } finally { clearTimeout(timer); }
    }
    async drenar(tentativa, obterCauda = () => null) {
        let timer;
        const esgotou = new Promise((_, reject) => { timer = setTimeout(() => reject(falha('update/persistence-pending')), this.timeoutMs); });
        const esperar = async () => {
            for (;;) {
                this.conferir(tentativa);
                const cauda = obterCauda(), versao = this.versao;
                await Promise.all([...this.operacoes, ...this.transacoes].map(item => item.promise).concat(cauda || []));
                this.conferir(tentativa);
                if (!this.operacoes.size && !this.transacoes.size && obterCauda() === cauda && versao === this.versao) {
                    tentativa.pronta = this.versao; tentativa.cauda = cauda; return;
                }
            }
        };
        try { await Promise.race([esperar(), esgotou, tentativa.cancelada]); } finally { clearTimeout(timer); }
    }
    async manutencao(tentativa, executar) {
        this.conferir(tentativa);
        const token = { ativa: true, referencias: 1, manutencao: tentativa };
        try { return await this.comPermissao(token, () => executar(this.contexto(token))); }
        finally { token.ativa = false; }
    }
    cancelar(tentativa) {
        if (this.tentativa !== tentativa || tentativa.commit || tentativa.ativacaoSolicitada) return false;
        this.tentativa = null; tentativa.rejeitar(falha('update/cancelled')); return true;
    }
    recarregar(tentativa, executar, obterCauda = () => null) {
        this.conferir(tentativa);
        if (this.operacoes.size || this.transacoes.size || tentativa.pronta !== this.versao || tentativa.cauda !== obterCauda()) throw falha('update/persistence-pending');
        tentativa.commit = true;
        try { executar(); } catch (error) { tentativa.commit = false; throw error; }
    }
}
