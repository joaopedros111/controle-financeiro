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