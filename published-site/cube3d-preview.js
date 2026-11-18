(() => {
    "use strict";

    const main = document.querySelector("main.container");
    const periodo = document.querySelector("nav.periodo");
    const anterior = document.getElementById("mes-anterior");
    const proximo = document.getElementById("mes-proximo");

    if (!main || !periodo || !anterior || !proximo) {
        console.warn("[Cubo 3D] Controles de período não encontrados.");
        return;
    }

    const CHAVE = "controleFinanceiro:cubo3d-preview";
    let habilitado = true;
    let ocupado = false;
    let ignorarClique = false;
    let inicioToque = null;

    try {
        habilitado = localStorage.getItem(CHAVE) !== "desligado";
    } catch {}

    const painel = document.createElement("div");
    painel.className = "cubo3d-controle ajuste-linha";

    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "cubo3d-botao";
    botao.setAttribute("aria-label", "Ativar ou desativar animação Cubo 3D");

    function atualizarBotao() {
        botao.textContent = habilitado
            ? "Ativado"
            : "Desativado";
        botao.setAttribute("aria-pressed", String(habilitado));
    }

    botao.addEventListener("click", () => {
        habilitado = !habilitado;
        atualizarBotao();
        try {
            localStorage.setItem(CHAVE, habilitado ? "ligado" : "desligado");
        } catch {}
    });

    atualizarBotao();
    const descricaoCubo = document.createElement("span");
    descricaoCubo.textContent = "Animação Cubo 3D";
    painel.append(descricaoCubo, botao);
    const secaoAparencia = document.getElementById("titulo-aparencia")
        ?.closest(".ajustes-secao");
    const linhaTema = document.getElementById("alternar-tema")
        ?.closest(".ajuste-linha");

    if (!secaoAparencia) {
        console.warn("[Cubo 3D] Seção Aparência não encontrada.");
        return;
    }

    if (linhaTema && secaoAparencia.contains(linhaTema)) {
        linhaTema.insertAdjacentElement("afterend", painel);
    } else {
        secaoAparencia.prepend(painel);
    }


    /* Preferências visuais locais: sem conexão com a conta ou registros financeiros. */
    const CHAVE_ANIMACOES = "controleFinanceiro:animacoes-interface-v1";
    const TIPOS_ANIMACAO = [
        ["barras", "Barras dos gráficos"],
        ["contadores", "Contadores do resumo"],
        ["mes", "Transição entre meses"],
        ["botoes", "Efeito de toque nos botões"],
        ["lancamentos", "Entrada de novos lançamentos"],
        ["cartoes3d", "Profundidade 3D dos cartões"],
        ["skeleton", "Esqueleto de carregamento"]
    ];

    function lerAnimacoes() {
        let salvas = {};
        try {
            const valor = JSON.parse(localStorage.getItem(CHAVE_ANIMACOES) || "{}");
            if (valor && typeof valor === "object" && !Array.isArray(valor)) salvas = valor;
        } catch {}
        return Object.fromEntries(TIPOS_ANIMACAO.map(([id]) => [id, salvas[id] !== false]));
    }

    let animacoesAtuais = lerAnimacoes();
    const aplicarPreferencias = () => {
        for (const [id] of TIPOS_ANIMACAO) {
            document.documentElement.toggleAttribute("data-animacao-" + id + "-desativada",
                animacoesAtuais[id] === false);
        }
    };
    aplicarPreferencias();

    const painelAnimacoes = document.createElement("div");
    painelAnimacoes.className = "animacoes-interface-painel";

    const botaoAnimacoes = document.createElement("button");
    botaoAnimacoes.id = "abrir-configuracoes-animacoes";
    botaoAnimacoes.type = "button";
    botaoAnimacoes.className = "btn btn-secundario abrir-animacoes-interface";
    botaoAnimacoes.textContent = "Configurar animações";
    botaoAnimacoes.setAttribute("aria-controls", "painel-configuracoes-animacoes");
    botaoAnimacoes.setAttribute("aria-expanded", "false");

    const grupoAnimacoes = document.createElement("fieldset");
    grupoAnimacoes.id = "painel-configuracoes-animacoes";
    grupoAnimacoes.className = "animacoes-interface-opcoes";
    grupoAnimacoes.hidden = true;
    botaoAnimacoes.addEventListener("click", () => {
        const expandir = grupoAnimacoes.hidden;
        grupoAnimacoes.hidden = !expandir;
        botaoAnimacoes.setAttribute("aria-expanded", String(expandir));
        botaoAnimacoes.textContent = expandir ? "Ocultar animações" : "Configurar animações";
    });
    const tituloAnimacoes = document.createElement("legend");
    tituloAnimacoes.textContent = "Animações da interface";
    grupoAnimacoes.append(tituloAnimacoes);
    for (const [id, descricao] of TIPOS_ANIMACAO) {
        const linha = document.createElement("label");
        linha.className = "ajuste-linha ajuste-controle ajuste-alternancia animacao-interface-linha";
        const texto = document.createElement("span");
        texto.textContent = descricao;
        const campo = document.createElement("input");
        campo.type = "checkbox";
        campo.name = "animacao-" + id;
        campo.checked = animacoesAtuais[id];
        campo.addEventListener("change", () => {
            animacoesAtuais[id] = campo.checked;
            try {
                localStorage.setItem(CHAVE_ANIMACOES, JSON.stringify(animacoesAtuais));
            } catch {}
            aplicarPreferencias();
            window.dispatchEvent(new CustomEvent("controle-financeiro:animacoes-atualizadas",
                { detail: { ...animacoesAtuais } }));
        });
        linha.append(texto, campo);
        grupoAnimacoes.append(linha);
    }
    const avisoAnimacoes = document.createElement("p");
    avisoAnimacoes.className = "nota";
    avisoAnimacoes.textContent =
        "Ajustes apenas deste dispositivo. A preferência Reduzir Movimento tem prioridade. " +
        "Com o Cubo 3D ligado, ele assume a transição entre meses quando disponível.";
    grupoAnimacoes.append(avisoAnimacoes);
    painelAnimacoes.append(botaoAnimacoes, grupoAnimacoes);
    painel.insertAdjacentElement("afterend", painelAnimacoes);

    window.addEventListener("storage", evento => {
        if (evento.key !== CHAVE_ANIMACOES) return;
        animacoesAtuais = lerAnimacoes();
        const campos = grupoAnimacoes.querySelectorAll('input[type="checkbox"]');
        campos.forEach(campo => {
            campo.checked = animacoesAtuais[campo.name.slice("animacao-".length)];
        });
        aplicarPreferencias();
    });

    const movimentoReduzido = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );

    function podeAnimar() {
        return habilitado &&
            !ocupado &&
            !movimentoReduzido.matches &&
            !document.querySelector("dialog[open]") &&
            typeof document.startViewTransition === "function";
    }

    function executarDirecao(direcao) {
        const destino = direcao === "next" ? proximo : anterior;

        if (!podeAnimar()) {
            ignorarClique = true;
            try {
                destino.click();
            } finally {
                ignorarClique = false;
            }
            return;
        }

        ocupado = true;
        document.documentElement.dataset.cubeDirection = direcao;

        // A captura é visual. Não copia nem modifica registros financeiros.
        /* Cubo 3D: profundidade dinamica */
        const larguraFace = main.getBoundingClientRect().width;
        document.documentElement.style.setProperty(
            "--cube3d-depth",
            `${larguraFace / 2}px`
        );
        main.style.viewTransitionName = "finance-cube";

        try {
            const transicao = document.startViewTransition(() => {
                ignorarClique = true;
                try {
                    destino.click();
                } finally {
                    ignorarClique = false;
                }
            });

            transicao.finished
                .catch(() => {})
                .finally(() => {
                    main.style.viewTransitionName = "";
                    delete document.documentElement.dataset.cubeDirection;
                    ocupado = false;
                });
        } catch (erro) {
            console.warn("[Cubo 3D] Transição indisponível:", erro);
            main.style.viewTransitionName = "";
            delete document.documentElement.dataset.cubeDirection;
            ocupado = false;
        }
    }

    // Intercepta somente as setas de mês, preservando os handlers originais.
    document.addEventListener("click", (evento) => {
        if (ignorarClique || !podeAnimar()) return;

        const alvo = evento.target instanceof Element
            ? evento.target.closest("button")
            : null;

        if (alvo !== anterior && alvo !== proximo) return;

        evento.preventDefault();
        evento.stopImmediatePropagation();
        executarDirecao(alvo === proximo ? "next" : "prev");
    }, true);

    // Aproveita o gesto já existente, sem alterar a lógica de navegação.
    main.addEventListener("touchstart", (evento) => {
        inicioToque = null;
        if (!podeAnimar() || evento.touches.length !== 1) return;

        const alvo = evento.target;
        if (alvo instanceof Element && alvo.closest(
            'button, select, input, textarea, a, [contenteditable="true"]'
        )) return;

        inicioToque = {
            x: evento.touches[0].clientX,
            y: evento.touches[0].clientY
        };
    }, { capture: true, passive: true });

    main.addEventListener("touchend", (evento) => {
        if (!inicioToque || evento.changedTouches.length !== 1) return;

        const dx = evento.changedTouches[0].clientX - inicioToque.x;
        const dy = evento.changedTouches[0].clientY - inicioToque.y;
        inicioToque = null;

        if (!podeAnimar() || Math.abs(dx) < 55 ||
            Math.abs(dx) < Math.abs(dy) * 1.25) return;

        evento.stopImmediatePropagation();
        executarDirecao(dx < 0 ? "next" : "prev");
    }, { capture: true, passive: true });

    main.addEventListener("touchcancel", () => {
        inicioToque = null;
    }, { passive: true });

    console.info("[Cubo 3D] Prévia experimental carregada.");
})();