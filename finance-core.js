export const CATEGORIAS_PADRAO = [
    "Moradia", "Alimentação", "Transporte", "Contas", "Assinaturas",
    "Lazer", "Saúde", "Educação", "Outros"
];

export const CATEGORIA_FIXA = "Outros";
const ANO_MINIMO = 2000;
const ANO_MAXIMO = 2100;

const gerarId = () => globalThis.crypto?.randomUUID?.()
    || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function valorValido(valor) {
    return typeof valor === "number" && Number.isFinite(valor) && valor >= 0;
}

function valorNormalizavel(valor) {
    if (typeof valor === "number") return valorValido(valor);
    if (typeof valor !== "string" || !valor.trim()) return false;
    return valorValido(Number(valor));
}

function listaValida(lista) {
    return (Array.isArray(lista) ? lista : []).filter((item) =>
        item && typeof item === "object" && !Array.isArray(item)
        && valorNormalizavel(item.valor)
    );
}

export function validarBackup(bruto) {
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)
        || !bruto.meses || typeof bruto.meses !== "object" || Array.isArray(bruto.meses)) return false;

    const ids = new Set();
    const idValido = (item) => {
        if (item.id === undefined || item.id === null || item.id === "") return true;
        if (typeof item.id !== "string" || ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
    };

    if (bruto.versao !== undefined && bruto.versao !== 2) return false;
    if (bruto.tema !== undefined && bruto.tema !== null
        && !["claro", "escuro", "rosa", "pangolim", "floresta"].includes(bruto.tema)) return false;
    if (bruto.categorias !== undefined && (!Array.isArray(bruto.categorias)
        || bruto.categorias.some((categoria) => typeof categoria !== "string" || !categoria.trim() || categoria.length > 40))) return false;

    return Object.entries(bruto.meses).every(([chave, mes]) => {
        const ano = Number(chave.slice(0, 4));
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(chave) || ano < ANO_MINIMO || ano > ANO_MAXIMO
            || !mes || typeof mes !== "object" || Array.isArray(mes)) return false;
        for (const [campo, registros] of [["receitas", mes.receitas], ["despesas", mes.despesas]]) {
            if (registros === undefined) continue;
            if (!Array.isArray(registros)) return false;
            for (const item of registros) {
                if (!item || typeof item !== "object" || Array.isArray(item)
                    || typeof item.nome !== "string" || !item.nome.trim() || item.nome.length > 80
                    || !valorValido(item.valor) || !idValido(item)) return false;
                if (campo === "despesas" && item.categoria !== undefined && typeof item.categoria !== "string") return false;
                if (campo === "despesas" && item.pago !== undefined && typeof item.pago !== "boolean") return false;
                if (campo === "despesas" && item.fixa !== undefined && typeof item.fixa !== "boolean") return false;
                if (campo === "despesas" && item.serie !== undefined && item.serie !== null && typeof item.serie !== "string") return false;
                if (campo === "despesas" && item.parcela !== undefined && item.parcela !== null) {
                    const { atual, total } = item.parcela;
                    if (!Number.isInteger(atual) || !Number.isInteger(total) || atual < 1 || total < 2 || atual > total) return false;
                }
            }
        }
        return true;
    });
}

export function normalizarEstado(bruto, criarId = gerarId) {
    const estado = { versao: 2, tema: null, categorias: [], meses: {} };
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
        estado.categorias = [...CATEGORIAS_PADRAO];
        return estado;
    }

    if (["claro", "escuro", "rosa", "pangolim", "floresta"].includes(bruto.tema)) estado.tema = bruto.tema;
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
        const registro = { id, nome, valor: Math.round(Number(item.valor) * 100) / 100 };
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
        const ano = Number(chave.slice(0, 4));
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(chave) || ano < ANO_MINIMO || ano > ANO_MAXIMO
            || !mes || typeof mes !== "object" || Array.isArray(mes)) continue;
        estado.meses[chave] = {
            receitas: listaValida(mes.receitas).map((item) => normalizarRegistro(item, "receita")),
            despesas: listaValida(mes.despesas).map((item) => normalizarRegistro(item, "despesa"))
        };
    }

    if (!estado.categorias.length) estado.categorias = [...CATEGORIAS_PADRAO];
    if (!estado.categorias.includes(CATEGORIA_FIXA)) estado.categorias.push(CATEGORIA_FIXA);
    Object.values(estado.meses).forEach((mes) => mes.despesas.forEach((despesa) => {
        if (!estado.categorias.includes(despesa.categoria)) estado.categorias.push(despesa.categoria);
    }));
    return estado;
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
        const numero = Number(valor);
        return Number.isFinite(numero) ? total + Math.round(numero * 100) : total;
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
        dados.receitas.forEach((r) => linhas.push([periodo, "Entrada", r.nome, "", valorCsv(r.valor), "", ""]));
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
