/* ============================================================
   BIBLIOTECA DE E-BOOKS — versão do site institucional (marca da Ana).
   Mesma lógica e mesmo banco da biblioteca do NutriPlat
   (Plataforma/prototipo/assets/js/biblioteca.js) — o que muda é a casca.
   Se mexer na regra de liberação aqui, mexa lá também.

   Lista o catálogo (público) e libera a LEITURA só do que a pessoa
   adquiriu (ou do que é gratuito). O arquivo vem de um bucket PRIVADO;
   quem não tem direito, o banco recusa (RLS) — o gate não é o JS.
   Requer supabase-client.js incluído ANTES deste arquivo.
   ============================================================ */
(function () {
  "use strict";

  var CATALOGO = document.getElementById("bib-catalogo");
  var LOADING  = document.getElementById("bib-loading");
  var HI       = document.getElementById("bib-hi");
  var READER   = document.getElementById("bib-reader");
  var FRAME    = document.getElementById("bib-frame");
  var RTITLE   = document.getElementById("bib-reader-title");

  // Onde comprar o que ainda não é seu (a vitrine do próprio site).
  var COMPRAR_URL = "index.html#ebooks";

  // capa_url e previa_url no catálogo são relativos à PLATAFORMA
  // (ex.: "assets/img/capas/x.jpg", "assets/previas/x.html"). Aqui no site
  // esses caminhos não existem — resolvemos contra a base da plataforma.
  var PLATAFORMA_BASE = "https://nutrianarocha.github.io/Plataforma/prototipo/";
  function resolver(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;      // já é absoluto
    return PLATAFORMA_BASE + String(url).replace(/^\.?\//, "");
  }

  var blobEmUso = null; // object URL atual do leitor (revogado ao fechar)

  window.NutriDBReady.then(function (c) {
    // Logout (botão "Sair")
    document.addEventListener("click", function (e) {
      if (!e.target.closest("[data-logout]")) return;
      e.preventDefault();
      c.auth.signOut().then(function () { window.location.replace("index.html"); });
    });

    return c.auth.getSession().then(function (r) {
      if (!r.data.session) { window.location.replace("entrar.html?next=biblioteca.html"); return; }
      var user = r.data.session.user;
      var nome = nomeCurto(user);
      if (HI) HI.textContent = nome ? ("Olá, " + nome + " 🌸") : "Minha Biblioteca";
      return carregar(c, user);
    });
  }).catch(function (e) {
    if (LOADING) LOADING.textContent = "Não foi possível carregar sua biblioteca. Verifique sua conexão.";
    console.error(e);
  });

  function nomeCurto(user) {
    var n = (user.user_metadata && user.user_metadata.nome) || "";
    return n ? n.split(" ")[0] : "";
  }

  function carregar(c, user) {
    // Catálogo (público) + acessos da pessoa, em paralelo.
    return Promise.all([
      c.from("ebooks").select("*").eq("ativo", true).order("ordem"),
      c.from("ebook_acessos").select("ebook_slug,expira_em").eq("user_id", user.id)
    ]).then(function (res) {
      if (res[0].error) throw res[0].error;
      // O erro da 2ª query NÃO pode passar batido: o catálogo é legível por
      // anônimo, mas ebook_acessos depende de auth.uid(). Se a chamada sair sem
      // token, o RLS devolve 0 linhas SEM erro e a pessoa que pagou veria tudo
      // como "🔒 Adquirir" — pior falha possível. Melhor falhar visível.
      if (res[1].error) throw res[1].error;
      var ebooks = res[0].data || [];
      var acessos = (res[1].data || []).filter(function (a) {
        return !a.expira_em || new Date(a.expira_em) > new Date();
      });
      // ebook_slug '*' = acesso a tudo (assinante / cortesia).
      var temTudo = acessos.some(function (a) { return a.ebook_slug === "*"; });
      var slugs = {};
      acessos.forEach(function (a) { slugs[a.ebook_slug] = true; });

      renderizar(c, ebooks, function (eb) {
        return eb.gratuito || temTudo || !!slugs[eb.slug];
      });
    });
  }

  function renderizar(c, ebooks, temAcesso) {
    if (LOADING) LOADING.hidden = true;
    CATALOGO.innerHTML = "";
    if (!ebooks.length) {
      CATALOGO.innerHTML = '<p class="bib-empty">Nenhum material disponível ainda.</p>';
      return;
    }
    // Agrupa por categoria, preservando a ordem em que aparecem (já vêm por 'ordem').
    var ordemCats = [];
    var grupos = {};
    ebooks.forEach(function (eb) {
      var cat = (eb.categoria && String(eb.categoria).trim()) || "Materiais";
      if (!grupos[cat]) { grupos[cat] = []; ordemCats.push(cat); }
      grupos[cat].push(eb);
    });

    ordemCats.forEach(function (cat) {
      var sec = document.createElement("section");
      sec.className = "bib-section";
      var h = document.createElement("h2");
      h.className = "bib-cat";
      h.textContent = cat;
      var grid = document.createElement("div");
      grid.className = "bib-grid";
      grupos[cat].forEach(function (eb) {
        grid.appendChild(criarCard(c, eb, temAcesso(eb)));
      });
      sec.appendChild(h);
      sec.appendChild(grid);
      CATALOGO.appendChild(sec);
    });
  }

  function criarCard(c, eb, liberado) {
    var card = document.createElement("article");
    card.className = "bib-card" + (liberado ? "" : " is-locked");

    var capa = eb.capa_url
      ? '<img class="bib-cover" src="' + escapeAttr(resolver(eb.capa_url)) + '" alt="" loading="lazy">'
      : '<div class="bib-cover bib-cover--ph">' + escapeHtml(eb.titulo) + "</div>";

    var selo = eb.gratuito
      ? '<span class="bib-badge bib-badge--free">Grátis</span>'
      : (liberado ? '<span class="bib-badge bib-badge--own">Adquirido</span>' : "");

    var acao = liberado
      ? '<button class="btn btn-primary btn-block bib-ler" type="button">Ler agora →</button>'
      : ((eb.previa_url ? '<button class="btn btn-primary btn-block bib-previa" type="button">Ver prévia</button>' : "") +
         '<a class="btn btn-outline btn-block" href="' + COMPRAR_URL + '">🔒 Adquirir</a>');

    card.innerHTML =
      '<div class="bib-cover-wrap">' + capa + selo + "</div>" +
      '<div class="bib-body">' +
        "<h3>" + escapeHtml(eb.titulo) + "</h3>" +
        (eb.subtitulo ? "<p>" + escapeHtml(eb.subtitulo) + "</p>" : "") +
        '<div class="bib-foot"></div>' +
      "</div>";
    card.querySelector(".bib-foot").innerHTML = acao;

    if (liberado) {
      card.querySelector(".bib-ler").addEventListener("click", function () {
        abrirLeitor(c, eb, this);
      });
    } else if (eb.previa_url) {
      var bp = card.querySelector(".bib-previa");
      if (bp) bp.addEventListener("click", function () { abrirPrevia(resolver(eb.previa_url), eb.titulo); });
    }
    return card;
  }

  // Prévia: página pública (não passa pelo bucket gated).
  function abrirPrevia(url, titulo) {
    if (blobEmUso) { URL.revokeObjectURL(blobEmUso); blobEmUso = null; }
    FRAME.src = url;
    RTITLE.textContent = (titulo || "E-book") + " — prévia";
    READER.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function abrirLeitor(c, eb, btn) {
    var txt = btn.textContent;
    btn.disabled = true; btn.textContent = "Abrindo…";
    c.storage.from("ebooks").download(eb.arquivo).then(function (res) {
      btn.disabled = false; btn.textContent = txt;
      if (res.error || !res.data) {
        alert("Não foi possível abrir este material. Se você já adquiriu, fale com a Ana.");
        console.error(res.error);
        return;
      }
      if (blobEmUso) { URL.revokeObjectURL(blobEmUso); }
      // Re-tipa o Blob p/ text/html: sem isso o iframe baixa em vez de renderizar.
      blobEmUso = URL.createObjectURL(res.data.slice(0, res.data.size, "text/html"));
      FRAME.src = blobEmUso;
      RTITLE.textContent = eb.titulo;
      READER.hidden = false;
      document.body.style.overflow = "hidden";
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = txt;
      alert("Não foi possível abrir este material agora.");
      console.error(e);
    });
  }

  function fecharLeitor() {
    READER.hidden = true;
    FRAME.src = "about:blank";
    if (blobEmUso) { URL.revokeObjectURL(blobEmUso); blobEmUso = null; }
    document.body.style.overflow = "";
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-fechar-leitor]")) fecharLeitor();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !READER.hidden) fecharLeitor();
  });

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
