export const CATEGORIAS_PADRAO = [
    "Moradia", "Alimentação", "Transporte", "Contas", "Assinaturas",
    "Lazer", "Saúde", "Educação", "Outros"
];

export const CATEGORIA_FIXA = "Outros";
const ANO_MINIMO = 2000;
const ANO_MAXIMO = 2100;
export const LIMITE_MONETARIO_SEGURO = 2 ** 44;
const LIMITE_CENTAVOS_SEGURO = BigInt(LIMITE_MONETARIO_SEGURO) * 100n;

export function mesFinanceiroValido(chave) {
    if (typeof chave !== "string") return false;
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(chave);
    if (!match) return false;
    const ano = Number(match[1]);
    return ano >= ANO_MINIMO && ano <= ANO_MAXIMO;
}

const gerarId = () => globalThis.crypto?.randomUUID?.()
    || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function centavosMonetarios(valor) {
    const texto = typeof valor === "number" ? valor.toString()
        : typeof valor === "string" ? valor.trim() : "";
    if (!texto || !Number.isFinite(Number(texto)) || Number(texto) < 0) return null;
    if (/^[+-]?0+(?:\.0*)?(?:e[+-]?\d+)?$/i.test(texto)) return 0;

    const partes = texto.match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (!partes) return null;
    const inteiros = partes[1] || "";
    const fracao = partes[2] || "";
    const digitos = (inteiros + fracao).replace(/^0+/, "");
    if (!digitos) return 0;
    const coeficiente = BigInt(digitos);
    const escala = fracao.length - Number(partes[3] || 0) - 2;
    let centavos;
    if (escala <= 0) {
        const casasAdicionais = -escala;
        if (digitos.length + casasAdicionais > LIMITE_CENTAVOS_SEGURO.toString().length) return null;
        centavos = coeficiente * 10n ** BigInt(casasAdicionais);
    } else {
        if (escala > digitos.length + 1) return 0;
        const divisor = 10n ** BigInt(escala);
        centavos = coeficiente / divisor;
        if ((coeficiente % divisor) * 2n >= divisor) centavos += 1n;
    }
    if (centavos > LIMITE_CENTAVOS_SEGURO) return null;
    return Number(centavos);
}

export function normalizarValorMonetario(valor) {
    const centavos = centavosMonetarios(valor);
    return centavos === null ? null : centavos / 100;
}

function somarCentavosSeguros(total, centavos) {
    const soma = total + centavos;
    if (soma > LIMITE_CENTAVOS_SEGURO) {
        throw new RangeError(`O total financeiro excede o limite seguro de ${LIMITE_MONETARIO_SEGURO} por conjunto.`);
    }
    return soma;
}

function valorValido(valor) {
    return typeof valor === "number" && centavosMonetarios(valor) !== null;
}

function limiteOrcamentoValido(valor) {
    return typeof valor === "number" && centavosMonetarios(valor) !== null;
}

function limiteOrcamentoNormalizavel(valor) {
    return centavosMonetarios(valor) !== null;
}

function valorNormalizavel(valor) {
    return normalizarValorMonetario(valor) !== null;
}

const MESES_SERIE_RECEITA = 12;

function deslocarChaveMes(chave, deslocamento) {
    const partes = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(chave);
    if (!partes) return null;
    const indice = Number(partes[1]) * 12 + Number(partes[2]) - 1 + deslocamento;
    const ano = Math.floor(indice / 12);
    if (ano < ANO_MINIMO || ano > ANO_MAXIMO) return null;
    return `${ano}-${String((indice % 12) + 1).padStart(2, "0")}`;
}

export function criarSerieReceitas(meses, { chaveInicial, nome, valor, serie }, criarId = gerarId) {
    if (!meses || typeof meses !== "object" || !serie || typeof serie !== "string"
        || typeof nome !== "string" || !nome.trim() || !valorValido(valor)) return [];

    const criadas = [];
    for (let indice = 0; indice < MESES_SERIE_RECEITA; indice += 1) {
        const chave = deslocarChaveMes(chaveInicial, indice);
        if (!chave) break;
        const mes = meses[chave] || (meses[chave] = { receitas: [], despesas: [] });
        if (!Array.isArray(mes.receitas)) mes.receitas = [];
        if (mes.receitas.some((receita) => receita.serie === serie)) continue;
        const item = { id: criarId(), nome: nome.trim(), valor: normalizarValorMonetario(valor), serie };
        mes.receitas.push(item);
        criadas.push({ chave, item });
    }
    return criadas;
}

export function listarReceitasDaSerie(meses, serie) {
    if (!meses || typeof meses !== "object" || typeof serie !== "string" || !serie) return [];
    return Object.entries(meses).flatMap(([chave, mes]) =>
        (Array.isArray(mes?.receitas) ? mes.receitas : [])
            .filter((item) => item.serie === serie)
            .map((item) => ({ chave, item }))
    ).sort((a, b) => a.chave.localeCompare(b.chave));
}

export function editarReceita(meses, chave, id, dados) {
    const receita = meses?.[chave]?.receitas?.find((item) => item.id === id);
    if (!receita || typeof dados?.nome !== "string" || !dados.nome.trim() || !valorValido(dados.valor)) return null;
    receita.nome = dados.nome.trim();
    receita.valor = normalizarValorMonetario(dados.valor);
    return receita;
}

export function excluirReceita(meses, chave, id) {
    const receitas = meses?.[chave]?.receitas;
    if (!Array.isArray(receitas)) return null;
    const indice = receitas.findIndex((item) => item.id === id);
    if (indice < 0) return null;
    const [item] = receitas.splice(indice, 1);
    return { chave, item, indice };
}

export function cancelarProximasReceitas(meses, serie, chaveReferencia) {
    const futuras = listarReceitasDaSerie(meses, serie)
        .filter(({ chave }) => chave > chaveReferencia)
        .map(({ chave, item }) => ({ chave, item, indice: meses[chave].receitas.indexOf(item) }));
    [...futuras].sort((a, b) => a.chave.localeCompare(b.chave) || b.indice - a.indice)
        .forEach(({ chave, indice }) => meses[chave].receitas.splice(indice, 1));
    return futuras;
}

function listaValida(lista) {
    return (Array.isArray(lista) ? lista : []).filter((item) =>
        item && typeof item === "object" && !Array.isArray(item)
        && valorNormalizavel(item.valor)
    );
}

function mapaOrcamentosValido(mapa, permitirTextoNumerico = false) {
    return mapa && typeof mapa === "object" && !Array.isArray(mapa)
        && Object.entries(mapa).every(([categoria, limite]) =>
            categoria.trim() !== "" && categoria.length <= 40
            && (permitirTextoNumerico ? limiteOrcamentoNormalizavel(limite) : limiteOrcamentoValido(limite))
        );
}

function orcamentosValidos(orcamentos, permitirTextoNumerico = false) {
    if (!orcamentos || typeof orcamentos !== "object" || Array.isArray(orcamentos)) return false;
    if (orcamentos.padrao !== undefined && !mapaOrcamentosValido(orcamentos.padrao, permitirTextoNumerico)) return false;
    if (orcamentos.meses === undefined) return true;
    if (!orcamentos.meses || typeof orcamentos.meses !== "object" || Array.isArray(orcamentos.meses)) return false;
    return Object.entries(orcamentos.meses).every(([chave, mapa]) => {
        return mesFinanceiroValido(chave)
            && mapaOrcamentosValido(mapa, permitirTextoNumerico);
    });
}

function normalizarMapaOrcamentos(mapa) {
    if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) return {};
    return Object.fromEntries(Object.entries(mapa)
        .filter(([categoria, limite]) => typeof categoria === "string" && categoria.trim()
            && categoria.length <= 40 && limiteOrcamentoNormalizavel(limite))
        .map(([categoria, limite]) => [categoria.trim(), centavosMonetarios(limite) / 100]));
}

function normalizarOrcamentos(bruto) {
    const padrao = normalizarMapaOrcamentos(bruto?.padrao);
    return { padrao, meses: {} };
}

function definirLimiteOrcamento(mapa, categoria, limite) {
    Object.defineProperty(mapa, categoria, {
        value: limite, enumerable: true, configurable: true, writable: true
    });
}

export function validarBackup(bruto, { permitirTextoNumerico = false } = {}) {
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)
        || !bruto.meses || typeof bruto.meses !== "object" || Array.isArray(bruto.meses)) return false;

    const ids = new Set();
    const idValido = (item) => {
        if (item.id === undefined || item.id === null || item.id === "") return true;
        if (typeof item.id !== "string" || ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
    };

    if (bruto.versao !== undefined && ![2, 3].includes(bruto.versao)) return false;
    if (bruto.orcamentos !== undefined && !orcamentosValidos(bruto.orcamentos, permitirTextoNumerico)) return false;
    if (bruto.tema !== undefined && bruto.tema !== null
        && !["claro", "escuro", "rosa", "pangolim", "floresta"].includes(bruto.tema)) return false;
    if (bruto.categorias !== undefined && (!Array.isArray(bruto.categorias)
        || bruto.categorias.some((categoria) => typeof categoria !== "string" || !categoria.trim() || categoria.length > 40))) return false;

    return Object.entries(bruto.meses).every(([chave, mes]) => {
        if (!mesFinanceiroValido(chave)
            || !mes || typeof mes !== "object" || Array.isArray(mes)) return false;
        for (const [campo, registros] of [["receitas", mes.receitas], ["despesas", mes.despesas]]) {
            if (registros === undefined) continue;
            if (!Array.isArray(registros)) return false;
            for (const item of registros) {
                if (!item || typeof item !== "object" || Array.isArray(item)
                    || typeof item.nome !== "string" || !item.nome.trim() || item.nome.length > 80
                    || !(permitirTextoNumerico
                        ? valorNormalizavel(item.valor)
                        : valorValido(item.valor))
                    || (!permitirTextoNumerico && typeof item.valor !== "number")
                    || !idValido(item)) return false;
                if (campo === "despesas" && item.categoria !== undefined && typeof item.categoria !== "string") return false;
                if (item.serie !== undefined && item.serie !== null && typeof item.serie !== "string") return false;
                if (campo === "despesas" && item.pago !== undefined && typeof item.pago !== "boolean") return false;
                if (campo === "despesas" && item.fixa !== undefined && typeof item.fixa !== "boolean") return false;
                if (campo === "despesas" && item.parcela !== undefined && item.parcela !== null) {
                    const { atual, total } = item.parcela;
                    if (!Number.isInteger(atual) || !Number.isInteger(total) || atual < 1 || total < 2 || atual > total) return false;
                }
            }
        }
        if (!validarTotaisMonetarios({ meses: { [chave]: mes } })) return false;
        return true;
    });
}

export function validarTotaisMonetarios(estado) {
    if (!estado?.meses || typeof estado.meses !== "object" || Array.isArray(estado.meses)) return false;
    try {
        return Object.values(estado.meses).every((mes) => {
            if (!mes || typeof mes !== "object" || Array.isArray(mes)) return false;
            const receitas = mes.receitas === undefined ? [] : mes.receitas;
            const despesas = mes.despesas === undefined ? [] : mes.despesas;
            return Array.isArray(receitas) && Array.isArray(despesas)
                && somarCentavos(receitas.map((item) => item.valor)) <= LIMITE_CENTAVOS_SEGURO
                && somarCentavos(despesas.map((item) => item.valor)) <= LIMITE_CENTAVOS_SEGURO;
        });
    } catch {
        return false;
    }
}

export function normalizarEstado(bruto, criarId = gerarId) {
    const estado = { versao: 3, tema: null, categorias: [], meses: {}, orcamentos: { padrao: {}, meses: {} } };
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
        estado.categorias = [...CATEGORIAS_PADRAO];
        return estado;
    }

    if (["claro", "escuro", "rosa", "pangolim", "floresta"].includes(bruto.tema)) estado.tema = bruto.tema;
    estado.orcamentos = normalizarOrcamentos(bruto.orcamentos);
    if (Array.isArray(bruto.categorias)) {
        for (const categoria of bruto.categorias) {
            if (typeof categoria !== "string") continue;
            const nome = categoria.trim();
            if (nome && !estado.categorias.includes(nome)) estado.categorias.push(nome);
        }
    }
    const meses = bruto.meses && typeof bruto.meses === "object" && !Array.isArray(bruto.meses)
        ? bruto.meses : {};
    const ids = new Set();
    const normalizarRegistro = (item, tipo) => {
        const idOriginal = typeof item.id === "string" && item.id.trim() ? item.id : criarId();
        let id = idOriginal;
        while (ids.has(id)) id = criarId();
        ids.add(id);
        const nome = typeof item.nome === "string" ? item.nome.trim() : "";
        const registro = { id, nome, valor: normalizarValorMonetario(item.valor) };
        if (tipo === "receita" && typeof item.serie === "string" && item.serie) registro.serie = item.serie;
        if (tipo === "despesa") {
            const atual = Number(item.parcela?.atual);
            const total = Number(item.parcela?.total);
            const parcelaValida = Number.isInteger(atual) && Number.isInteger(total)
                && atual >= 1 && total >= 2 && atual <= total;
            registro.categoria = typeof item.categoria === "string" && item.categoria.trim()
                ? item.categoria.trim() : CATEGORIA_FIXA;
            registro.pago = item.pago === true;
            registro.fixa = item.fixa === true;
            registro.serie = typeof item.serie === "string" && item.serie ? item.serie : null;
            registro.parcela = parcelaValida ? { atual, total } : null;
        }
        return registro;
    };

    for (const [chave, mes] of Object.entries(meses)) {
        if (!mesFinanceiroValido(chave)
            || !mes || typeof mes !== "object" || Array.isArray(mes)) continue;
        estado.meses[chave] = {
            receitas: listaValida(mes.receitas).map((item) => normalizarRegistro(item, "receita")),
            despesas: listaValida(mes.despesas).map((item) => normalizarRegistro(item, "despesa"))
        };
    }

    if (!estado.categorias.length) estado.categorias = [...CATEGORIAS_PADRAO];
    Object.keys(estado.orcamentos.padrao).forEach((categoria) => {
        if (!estado.categorias.includes(categoria)) estado.categorias.push(categoria);
    });
    Object.values(estado.meses).forEach((mes) => mes.despesas.forEach((despesa) => {
        if (!estado.categorias.includes(despesa.categoria)) estado.categorias.push(despesa.categoria);
    }));
    return estado;
}

export function renomearCategoriaOrcamentos(orcamentos, antiga, nova) {
    const resultado = {
        padrao: { ...(orcamentos?.padrao || {}) },
        meses: {}
    };
    if (Object.prototype.hasOwnProperty.call(resultado.padrao, antiga)) {
        definirLimiteOrcamento(resultado.padrao, nova, resultado.padrao[antiga]);
        delete resultado.padrao[antiga];
    }
    return resultado;
}

export function removerCategoriaOrcamentos(orcamentos, categoria) {
    const resultado = {
        padrao: { ...(orcamentos?.padrao || {}) },
        meses: {}
    };
    delete resultado.padrao[categoria];
    return resultado;
}

export function calcularOrcamentosPorCategoria(categorias, despesas, orcamentos) {
    const gastos = new Map();
    (Array.isArray(despesas) ? despesas : []).forEach((despesa) => {
        if (!despesa || typeof despesa.categoria !== "string") return;
        const categoria = despesa.categoria.trim();
        const centavos = centavosMonetarios(despesa.valor);
        if (!categoria || centavos === null) return;
        gastos.set(categoria, somarCentavosSeguros(gastos.get(categoria) || 0, centavos));
    });

    const padrao = orcamentos?.padrao || {};
    const nomes = new Set([
        ...(Array.isArray(categorias) ? categorias.filter((categoria) => typeof categoria === "string" && categoria.trim()) : []),
        ...gastos.keys(),
        ...Object.keys(padrao)
    ]);

    return [...nomes].map((categoria) => {
        const gastoCentavos = gastos.get(categoria) || 0;
        const temLimitePadrao = Object.prototype.hasOwnProperty.call(padrao, categoria);
        const valorLimite = temLimitePadrao ? padrao[categoria] : null;
        const limiteCentavos = valorLimite !== null && valorLimite !== undefined
            ? centavosMonetarios(valorLimite)
            : null;
        return {
            categoria,
            gastoCentavos,
            limiteCentavos,
            restanteCentavos: limiteCentavos === null ? null : limiteCentavos - gastoCentavos,
            percentualConsumido: limiteCentavos === null
                ? null
                : limiteCentavos === 0
                    ? (gastoCentavos > 0 ? null : 0)
                    : (gastoCentavos / limiteCentavos) * 100
        };
    });
}

export function agruparDespesasPorCategoria(despesas) {
    const totaisCentavos = Object.create(null);
    (Array.isArray(despesas) ? despesas : []).forEach((despesa) => {
        if (!despesa || typeof despesa.categoria !== "string") return;
        const centavos = centavosMonetarios(despesa.valor);
        if (centavos === null) return;
        if (centavos <= 0) return;
        totaisCentavos[despesa.categoria] = somarCentavosSeguros(
            totaisCentavos[despesa.categoria] || 0,
            centavos
        );
    });
    return Object.entries(totaisCentavos).map(([categoria, centavos]) => [categoria, centavos / 100]);
}

export function agruparLancamentosPorCategoria(despesas) {
    const grupos = new Map();
    (Array.isArray(despesas) ? despesas : []).forEach((despesa) => {
        if (!despesa || typeof despesa !== "object") return;
        const categoria = typeof despesa.categoria === "string" && despesa.categoria.trim()
            ? despesa.categoria.trim()
            : CATEGORIA_FIXA;
        if (!grupos.has(categoria)) grupos.set(categoria, []);
        grupos.get(categoria).push(despesa);
    });
    return [...grupos].map(([categoria, itens]) => ({
        categoria,
        despesas: itens,
        totalCentavos: somarCentavos(itens.map((item) => item.valor))
    }));
}

export function agruparLancamentosComOrcamento(despesas, categorias, orcamentos) {
    const limites = new Map(calcularOrcamentosPorCategoria(categorias, despesas, orcamentos)
        .map(({ categoria, limiteCentavos }) => [categoria, limiteCentavos]));
    return agruparLancamentosPorCategoria(despesas).map((grupo) => {
        const limiteCentavos = limites.get(grupo.categoria) ?? null;
        return {
            ...grupo,
            limiteCentavos,
            excedido: limiteCentavos !== null && grupo.totalCentavos > limiteCentavos
        };
    });
}

export function ordenarOrcamentosComGastos(itens) {
    return (Array.isArray(itens) ? itens : [])
        .filter((item) => item && Number.isFinite(item.gastoCentavos) && item.gastoCentavos > 0)
        .sort((a, b) => b.gastoCentavos - a.gastoCentavos
            || a.categoria.localeCompare(b.categoria, "pt-BR"));
}

export function migrarDadosLegados(registrosPorMes, ano) {
    const bruto = { categorias: [], meses: {} };
    let encontrou = false;
    for (let mes = 1; mes <= 12; mes += 1) {
        const dados = registrosPorMes[mes];
        if (!dados || typeof dados !== "object" || Array.isArray(dados)) continue;
        if (Array.isArray(dados.categorias)) {
            dados.categorias.forEach((categoria) => {
                if (typeof categoria === "string" && !bruto.categorias.includes(categoria)) bruto.categorias.push(categoria);
            });
        }
        const renda = Number(dados.renda);
        const despesas = Array.isArray(dados.despesas)
            ? dados.despesas.filter((item) => item && typeof item === "object" && !Array.isArray(item))
            : [];
        bruto.meses[`${ano}-${String(mes).padStart(2, "0")}`] = {
            receitas: Number.isFinite(renda) && renda > 0 ? [{ nome: "Renda mensal", valor: renda }] : [],
            despesas
        };
        encontrou = true;
    }
    return encontrou ? bruto : null;
}

export function somarCentavos(valores) {
    return valores.reduce((total, valor) => {
        const centavos = centavosMonetarios(valor);
        if (centavos === null) {
            throw new RangeError("Não é possível somar um valor financeiro inválido.");
        }
        return somarCentavosSeguros(total, centavos);
    }, 0);
}

export function escaparCelulaCsv(valor) {
    let texto = String(valor);
    if (/^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(texto)) texto = "'" + texto;
    return '"' + texto.replace(/"/g, '""') + '"';
}

export function gerarCsv(estado, { ano, mes, escopo = "mes" } = {}) {
    const chaveSelecionada = `${ano}-${String(mes).padStart(2, "0")}`;
    const meses = escopo === "todos"
        ? Object.entries(estado?.meses || {}).sort(([a], [b]) => a.localeCompare(b))
        : [[chaveSelecionada, estado?.meses?.[chaveSelecionada] || { receitas: [], despesas: [] }]];
    const registros = meses.filter(([, dados]) => dados?.receitas?.length || dados?.despesas?.length);
    if (!registros.length) return "";
    const valorCsv = (valor) => {
        const n = Number(valor);
        return (Number.isFinite(n) ? n : 0).toFixed(2).replace(".", ",");
    };
    const linhas = [["Período", "Tipo", "Nome", "Categoria", "Valor", "Situação", "Observação"]];
    registros.forEach(([periodo, dados]) => {
        dados.receitas.forEach((r) => linhas.push([
            periodo, "Entrada", r.nome, "", valorCsv(r.valor), "",
            r.serie ? `Recorrente mensal (${r.serie})` : ""
        ]));
        dados.despesas.forEach((d) => {
            const observacao = d.parcela
                ? `Parcela ${d.parcela.atual}/${d.parcela.total}`
                : (d.fixa ? "Fixa" : "");
            linhas.push([periodo, "Despesa", d.nome, d.categoria, valorCsv(d.valor), d.pago ? "Paga" : "A pagar", observacao]);
        });
    });
    return "\ufeff" + linhas.map((linha) => linha.map(escaparCelulaCsv).join(";")).join("\r\n");
}

export function calcularExpressao(expressao) {
    const texto = String(expressao).replace(/,/g, ".").replace(/\s+/g, "");
    if (!texto) throw new Error("Expressão vazia");
    const tokens = texto.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/%-]/g) || [];
    if (tokens.join("") !== texto) throw new Error("Expressão inválida");
    let posicao = 0;
    const primario = () => {
        const token = tokens[posicao++];
        if (token === "+") return primario();
        if (token === "-") return -primario();
        if (token === "(") {
            const valor = expressaoSoma();
            if (tokens[posicao++] !== ")") throw new Error("Parênteses inválidos");
            return valor;
        }
        const valor = Number(token);
        if (token === undefined || !Number.isFinite(valor)) throw new Error("Número inválido");
        let resultado = valor;
        while (tokens[posicao] === "%") {
            posicao += 1;
            resultado /= 100;
        }
        return resultado;
    };
    const expressaoProduto = () => {
        let valor = primario();
        while (tokens[posicao] === "*" || tokens[posicao] === "/") {
            const operador = tokens[posicao++];
            const proximo = primario();
            if (operador === "/" && proximo === 0) throw new Error("Divisão por zero");
            valor = operador === "*" ? valor * proximo : valor / proximo;
        }
        return valor;
    };
    const expressaoSoma = () => {
        let valor = expressaoProduto();
        while (tokens[posicao] === "+" || tokens[posicao] === "-") {
            const operador = tokens[posicao++];
            const proximo = expressaoProduto();
            valor = operador === "+" ? valor + proximo : valor - proximo;
        }
        return valor;
    };
    const resultado = expressaoSoma();
    if (posicao !== tokens.length || !Number.isFinite(resultado)) throw new Error("Expressão inválida");
    return resultado;
}
