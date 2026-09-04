/* =========================================================
   Tutorial do primeiro acesso do RotuLens

   A primeira tela do app pede uma FOTO. Quem chega de anúncio
   nunca viu isso antes: se não entender em dois segundos o que
   fotografar, vai embora — e essa saída custa o clique que foi
   pago no anúncio. Três frases resolvem, se estiverem apontando
   para o lugar certo.

   Então: escurece a tela, acende UM elemento por vez e aponta
   uma seta curva para ele.

   POR QUE APONTA PARA A TABELA E NÃO PARA A FRENTE DO PACOTE
   Os três slots são opcionais, mas a leitura vive da tabela e
   dos ingredientes — a frente só diz marca e se o produto se
   vende como diet ou light. Mandar a pessoa começar pela foto
   que menos importa é ensinar errado.

   PASSO SEM ALVO É PULADO em silêncio: se um slot mudar de nome
   ou sair da tela, o tutorial encurta em vez de apontar para o
   canto vazio. Sem nenhum alvo, ainda aparece um cartão de
   boas-vindas no meio da tela — melhor explicar sem seta que
   não explicar.

   QUANDO APARECE
   Só no primeiro acesso do aparelho. Para ver de novo (testar,
   ou gravar a tela para o vídeo):

     .../mercado/?tutorial=1
     RotuLensTutorial.iniciar()      no console
     RotuLensTutorial.esquecer()     volta a ser primeiro acesso

   Os estilos moram em mercado.css (.tour*), como o resto do app.
   ========================================================= */
(function () {
  "use strict";

  var CHAVE = "mercado_tutorial_v1";

  var PASSOS = [
    {
      alvo: '[data-slot="1"]',
      titulo: "Comece pela tabela",
      texto: "Toque aqui e fotografe a <strong>tabela nutricional</strong> do produto. " +
             "A foto do celular mesmo, na frente da prateleira, já serve."
    },
    {
      alvo: '[data-slot="2"]',
      titulo: "Depois, os ingredientes",
      texto: "É na <strong>lista miúda</strong> que está o que a embalagem não conta: " +
             "açúcar com outro nome, fila de aditivos."
    },
    {
      alvo: "[data-analisar]",
      titulo: "E é só",
      texto: "Eu leio com você: o que é bom, o que pesa contra e, se não valer a pena, " +
             "<strong>quais marcas levar no lugar</strong>."
    }
  ];

  function jaViu() {
    try { return localStorage.getItem(CHAVE) === "1"; } catch (e) { return false; }
  }
  function guardarVisto() {
    try { localStorage.setItem(CHAVE, "1"); } catch (e) { /* modo privado */ }
  }

  function menosMovimento() {
    return window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Alvo só vale se existe E ocupa espaço: elemento escondido tem retângulo
  // zerado, e a seta apontaria para o canto da tela.
  function alvoValido(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }

  var estado = null;

  function fechar() {
    if (estado && estado.camada) estado.camada.remove();
    estado = null;
    window.removeEventListener("resize", reposicionar);
    window.removeEventListener("scroll", reposicionar, true);
    document.removeEventListener("keydown", noTeclado);
    guardarVisto();
  }

  function noTeclado(e) {
    if (e.key === "Escape") { fechar(); return; }
    if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); avancar(); }
  }

  function avancar() {
    if (!estado) return;
    estado.i += 1;
    if (estado.i >= estado.passos.length) { fechar(); return; }
    desenhar(false);
  }

  function reposicionar() {
    if (estado) desenhar(true);
  }

  // Uma curva de Bézier em vez de linha reta: fica menos diagrama técnico e
  // mais gesto de mão apontando.
  function caminhoSeta(deX, deY, paraX, paraY) {
    var dx = paraX - deX, dy = paraY - deY;
    var cx = deX + dx * 0.15 - (dy > 0 ? 34 : -34);
    var cy = deY + dy * 0.62;
    var ang = Math.atan2(paraY - cy, paraX - cx);
    var g = 11;
    var p1x = paraX - g * Math.cos(ang - 0.42), p1y = paraY - g * Math.sin(ang - 0.42);
    var p2x = paraX - g * Math.cos(ang + 0.42), p2y = paraY - g * Math.sin(ang + 0.42);
    return '<path d="M ' + deX + ' ' + deY + ' Q ' + cx + ' ' + cy + ' ' +
             paraX + ' ' + paraY + '" fill="none" stroke="#fff" stroke-width="3" ' +
             'stroke-linecap="round"/>' +
           '<path d="M ' + paraX + ' ' + paraY + ' L ' + p1x + ' ' + p1y +
             ' M ' + paraX + ' ' + paraY + ' L ' + p2x + ' ' + p2y + '" ' +
             'fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>';
  }

  function desenhar(soPosicao) {
    var passo = estado.passos[estado.i];
    var el = passo.el;
    var r = el ? el.getBoundingClientRect() : null;

    // O alvo pode estar fora da tela — o app tem página longa e a pessoa pode
    // ter rolado. Traz de volta antes de apontar.
    if (r && (r.top < 8 || r.bottom > window.innerHeight - 8)) {
      try {
        el.scrollIntoView({ block: "center", behavior: menosMovimento() ? "auto" : "smooth" });
      } catch (e) { el.scrollIntoView(); }
      setTimeout(function () { if (estado) desenhar(true); }, menosMovimento() ? 0 : 320);
      r = el.getBoundingClientRect();
    }

    var pad = 8;
    var luz = null;
    if (r) {
      // Alvo mais alto que a tela (a área de resultado é uma leitura inteira):
      // acender tudo apagaria o escuro em volta, porque não sobraria tela para
      // escurecer, e a seta apontaria para fora do visível. A luz fica no
      // COMEÇO do alvo, que é onde a pessoa olha primeiro.
      var vh = window.innerHeight;
      var topo = Math.max(8, r.top - pad);
      var base = Math.min(vh - 8, r.bottom + pad);
      var teto = Math.round(vh * 0.45);
      if (base - topo > teto) base = topo + teto;
      luz = {
        top: topo,
        left: Math.max(8, r.left - pad),
        largura: Math.min(window.innerWidth - 16, r.width + pad * 2),
        altura: Math.max(24, base - topo)
      };
      estado.luz.style.display = "block";
      estado.luz.style.top = luz.top + "px";
      estado.luz.style.left = luz.left + "px";
      estado.luz.style.width = luz.largura + "px";
      estado.luz.style.height = luz.altura + "px";
    } else {
      estado.luz.style.display = "none";
      estado.camada.style.background = "rgba(56,6,36,.78)";
    }

    // O cartão vai para o lado do alvo que tiver mais espaço.
    var alturaCard = 190;
    var acima = luz ? (luz.top > window.innerHeight - (luz.top + luz.altura)) : false;
    var topoCard;
    if (!luz) {
      topoCard = Math.max(24, (window.innerHeight - alturaCard) / 2);
    } else if (acima) {
      topoCard = Math.max(16, luz.top - 60 - alturaCard);
    } else {
      topoCard = Math.min(window.innerHeight - alturaCard - 16, luz.top + luz.altura + 60);
    }
    estado.card.style.top = topoCard + "px";

    if (!soPosicao) {
      var ultimo = estado.i === estado.passos.length - 1;
      estado.card.innerHTML =
        '<p class="tour__conta">Passo ' + (estado.i + 1) + ' de ' + estado.passos.length + '</p>' +
        '<p class="tour__t">' + passo.titulo + '</p>' +
        '<p class="tour__p">' + passo.texto + '</p>' +
        '<div class="tour__acoes">' +
        '<button class="tour__ok" type="button">' +
        (ultimo ? "Entendi, vamos lá" : "Próximo") + '</button>' +
        (ultimo ? '' : '<button class="tour__pular" type="button">Pular</button>') +
        '</div>';
      var ok = estado.card.querySelector(".tour__ok");
      var pular = estado.card.querySelector(".tour__pular");
      ok.addEventListener("click", avancar);
      if (pular) pular.addEventListener("click", fechar);
      ok.focus();
    }

    if (luz) {
      var cr = estado.card.getBoundingClientRect();
      var deX = cr.left + cr.width / 2;
      var deY = acima ? cr.bottom + 6 : cr.top - 6;
      var paraY = acima ? luz.top - 8 : luz.top + luz.altura + 8;
      var paraX = Math.min(Math.max(luz.left + luz.largura / 2, 20), window.innerWidth - 20);
      estado.seta.setAttribute("width", window.innerWidth);
      estado.seta.setAttribute("height", window.innerHeight);
      estado.seta.setAttribute("viewBox", "0 0 " + window.innerWidth + " " + window.innerHeight);
      estado.seta.innerHTML = caminhoSeta(deX, deY, paraX, paraY);
      estado.seta.style.display = "block";
    } else {
      estado.seta.style.display = "none";
    }
  }

  function iniciar(forcado) {
    if (document.querySelector(".tour")) return;
    if (!forcado && jaViu()) return;

    var passos = PASSOS.map(function (p) {
      var el = document.querySelector(p.alvo);
      return alvoValido(el) ? { el: el, titulo: p.titulo, texto: p.texto } : null;
    }).filter(Boolean);

    if (!passos.length) {
      passos = [{ el: null, titulo: PASSOS[0].titulo, texto: PASSOS[0].texto }];
    }

    var camada = document.createElement("div");
    camada.className = "tour";
    camada.setAttribute("role", "dialog");
    camada.setAttribute("aria-modal", "true");
    camada.setAttribute("aria-label", "Como usar o app");
    camada.innerHTML =
      '<div class="tour__luz"></div>' +
      '<svg class="tour__seta" aria-hidden="true"></svg>' +
      '<div class="tour__card"></div>';
    document.body.appendChild(camada);

    estado = {
      i: 0,
      passos: passos,
      camada: camada,
      luz: camada.querySelector(".tour__luz"),
      seta: camada.querySelector(".tour__seta"),
      card: camada.querySelector(".tour__card")
    };

    window.addEventListener("resize", reposicionar);
    window.addEventListener("scroll", reposicionar, true);
    document.addEventListener("keydown", noTeclado);
    desenhar(false);
  }

  window.RotuLensTutorial = {
    iniciar: function () { iniciar(true); },
    jaViu: jaViu,
    esquecer: function () { try { localStorage.removeItem(CHAVE); } catch (e) {} }
  };

  /* Esperar o aviso de cookies sair é regra dos dois convites (este e a
     pílula de instalar), então a função mora no mercado.js, que carrega
     antes. Se ela não estiver lá, o app inteiro não subiu — seguir direto é
     o menor dos problemas. */
  function quandoLivre(seguir) {
    if (typeof window.RotuLensQuandoLivre === "function") {
      window.RotuLensQuandoLivre(seguir);
    } else {
      seguir();
    }
  }

  function talvez() {
    var forcado = /[?&]tutorial=1\b/.test(window.location.search);
    if (!forcado && jaViu()) return;
    quandoLivre(function () {
      // Meio segundo para a tela assentar: seta apontando para um botão que
      // ainda vai se mexer é pior que seta nenhuma.
      setTimeout(function () { iniciar(forcado); }, forcado ? 0 : 600);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", talvez);
  } else {
    talvez();
  }
})();
