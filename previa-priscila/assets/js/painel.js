/* ============================================================
   PAINEL — a página onde a Priscila libera o acesso aos materiais.

   Existe por causa da cláusula 1.3 do contrato: na versão sem checkout, quem
   libera o acesso é a própria contratante. Sem esta página, a liberação só
   seria possível mexendo no painel do Supabase — inviável para ela e, na
   prática, trabalho que cairia na Ana todo mês.

   O que dá poder aqui é o banco, não o JavaScript: as policies só deixam
   escrever em ebook_acessos quem tem profiles.tipo = dona (ver
   scripts/schema/base.sql). Esconder a aba não seria segurança nenhuma; o
   redirecionamento abaixo é só cortesia com quem entrou na página errada.

   Requer supabase-client.js incluído ANTES deste arquivo.
   ============================================================ */
(function () {
  "use strict";

  var PAPEL_DONA = "dona";

  var CARREGANDO = document.getElementById("pn-loading");
  var CORPO      = document.getElementById("pn-corpo");
  var TB_PESSOAS = document.getElementById("pn-pessoas");
  var TB_MATS    = document.getElementById("pn-materiais");
  var TB_LEADS   = document.getElementById("pn-leads");
  var MODAL      = document.getElementById("pn-modal");
  var MODAL_NOME = document.getElementById("pn-modal-nome");
  var MODAL_LIST = document.getElementById("pn-modal-lista");

  var cliente = null;
  var materiais = [];   // catálogo inteiro (inclusive inativos)
  var pessoas = [];
  var atual = null;     // pessoa aberta no modal

  window.SiteDBReady.then(function (c) {
    cliente = c;
    return c.auth.getSession();
  }).then(function (r) {
    if (!r.data.session) { window.location.replace("entrar.html?next=painel.html"); return null; }
    return cliente.from("profiles").select("tipo").maybeSingle();
  }).then(function (r) {
    if (!r) return null;
    if (!r.data || r.data.tipo !== PAPEL_DONA) { window.location.replace("biblioteca.html"); return null; }
    return carregarTudo();
  }).catch(function (e) {
    if (CARREGANDO) CARREGANDO.textContent = "Não foi possível abrir o painel. Verifique sua conexão.";
    console.error(e);
  });

  function carregarTudo() {
    return Promise.all([
      cliente.from("profiles").select("id,nome,email,tipo,criado_em").order("criado_em", { ascending: false }),
      cliente.from("ebooks").select("*").order("ordem"),
      cliente.from("ebook_acessos").select("user_id,ebook_slug,expira_em")
      , cliente.from("leads").select("*").order("criado_em", { ascending: false }).limit(300)
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw r.error; });
      pessoas   = res[0].data || [];
      materiais = res[1].data || [];
      var acessos = res[2].data || [];

      var porPessoa = {};
      acessos.forEach(function (a) {
        (porPessoa[a.user_id] = porPessoa[a.user_id] || []).push(a.ebook_slug);
      });
      pessoas.forEach(function (p) { p.acessos = porPessoa[p.id] || []; });

      if (CARREGANDO) CARREGANDO.hidden = true;
      if (CORPO) CORPO.hidden = false;
      pintarPessoas();
      pintarMateriais();
      pintarLeads(res[3].data || []);
    });
  }

  /* ---------------- pessoas cadastradas ---------------- */
  function pintarPessoas() {
    TB_PESSOAS.innerHTML = "";
    if (!pessoas.length) {
      TB_PESSOAS.innerHTML = '<tr><td colspan="5" class="pn-vazio">Ninguém se cadastrou ainda.</td></tr>';
      return;
    }
    pessoas.forEach(function (p) {
      var tr = document.createElement("tr");
      var quantos = p.acessos.indexOf("*") >= 0 ? "tudo" : String(p.acessos.length);
      tr.innerHTML =
        "<td><strong>" + esc(p.nome || "—") + "</strong>" +
          (p.tipo === PAPEL_DONA ? ' <span class="pn-tag">você</span>' : "") + "</td>" +
        "<td>" + esc(p.email || "—") + "</td>" +
        "<td>" + data(p.criado_em) + "</td>" +
        '<td class="pn-num">' + quantos + "</td>" +
        '<td><button class="pn-btn" type="button">Liberar acesso…</button></td>';
      tr.querySelector("button").addEventListener("click", function () { abrirModal(p); });
      TB_PESSOAS.appendChild(tr);
    });
  }

  /* ---------------- catálogo ---------------- */
  function pintarMateriais() {
    TB_MATS.innerHTML = "";
    if (!materiais.length) {
      TB_MATS.innerHTML = '<tr><td colspan="4" class="pn-vazio">Nenhum material cadastrado ainda. ' +
        'Quem cadastra os materiais é quem cuida do site.</td></tr>';
      return;
    }
    materiais.forEach(function (m) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td><strong>" + esc(m.titulo) + "</strong>" +
          (m.subtitulo ? '<br><span class="pn-sub">' + esc(m.subtitulo) + "</span>" : "") + "</td>" +
        "<td>" + esc(m.categoria || "—") + "</td>" +
        "<td>" + (m.formato || "html").toUpperCase() + "</td>" +
        '<td><label class="pn-check"><input type="checkbox" data-campo="gratuito"' +
          (m.gratuito ? " checked" : "") + "> liberado para todo mundo</label>" +
        '<label class="pn-check"><input type="checkbox" data-campo="ativo"' +
          (m.ativo ? " checked" : "") + "> aparece na biblioteca</label></td>";
      tr.querySelectorAll("input[data-campo]").forEach(function (chk) {
        chk.addEventListener("change", function () {
          var campo = chk.getAttribute("data-campo");
          var patch = {};
          patch[campo] = chk.checked;
          chk.disabled = true;
          cliente.from("ebooks").update(patch).eq("id", m.id).then(function (r) {
            chk.disabled = false;
            if (r.error) { chk.checked = !chk.checked; falhou(r.error); return; }
            m[campo] = chk.checked;
          });
        });
      });
      TB_MATS.appendChild(tr);
    });
  }


  /* ---------------- contatos deixados no site ---------------- */
  function pintarLeads(leads) {
    if (!TB_LEADS) return;
    TB_LEADS.innerHTML = "";
    if (!leads.length) {
      TB_LEADS.innerHTML = '<tr><td colspan="4" class="pn-vazio">Nenhum contato ainda.</td></tr>';
      return;
    }
    leads.forEach(function (l) {
      var tr = document.createElement("tr");
      var zap = String(l.whatsapp || "").replace(/\D/g, "");
      tr.innerHTML =
        "<td><strong>" + esc(l.nome || "—") + "</strong></td>" +
        "<td>" + (zap ? '<a href="https://wa.me/' + zap + '" target="_blank" rel="noopener">' +
                  esc(l.whatsapp) + "</a>" : "—") + "</td>" +
        "<td>" + esc(l.origem || "—") + "</td>" +
        "<td>" + data(l.criado_em) + "</td>";
      TB_LEADS.appendChild(tr);
    });
  }

  /* ---------------- modal de liberação ---------------- */
  function abrirModal(p) {
    atual = p;
    MODAL_NOME.textContent = p.nome || p.email || "esta pessoa";
    MODAL_LIST.innerHTML = "";

    MODAL_LIST.appendChild(linhaAcesso({
      slug: "*", titulo: "Tudo o que existe e o que vier depois",
      sub: "Cortesia: libera o catálogo inteiro de uma vez."
    }, p));

    materiais.forEach(function (m) {
      MODAL_LIST.appendChild(linhaAcesso({
        slug: m.slug, titulo: m.titulo,
        sub: m.gratuito ? "Já é gratuito para todo mundo." : (m.subtitulo || "")
      }, p));
    });

    MODAL.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function linhaAcesso(item, p) {
    var tem = p.acessos.indexOf(item.slug) >= 0;
    var li = document.createElement("label");
    li.className = "pn-item";
    li.innerHTML =
      '<input type="checkbox"' + (tem ? " checked" : "") + ">" +
      "<span><strong>" + esc(item.titulo) + "</strong>" +
        (item.sub ? '<br><span class="pn-sub">' + esc(item.sub) + "</span>" : "") + "</span>";
    var chk = li.querySelector("input");
    chk.addEventListener("change", function () {
      chk.disabled = true;
      var acao = chk.checked
        ? cliente.from("ebook_acessos").insert({
            user_id: p.id, ebook_slug: item.slug, origem: "painel"
          })
        : cliente.from("ebook_acessos").delete()
            .eq("user_id", p.id).eq("ebook_slug", item.slug);
      acao.then(function (r) {
        chk.disabled = false;
        if (r.error) { chk.checked = !chk.checked; falhou(r.error); return; }
        var i = p.acessos.indexOf(item.slug);
        if (chk.checked && i < 0) p.acessos.push(item.slug);
        if (!chk.checked && i >= 0) p.acessos.splice(i, 1);
        pintarPessoas();
      });
    });
    return li;
  }

  function fecharModal() {
    MODAL.hidden = true;
    atual = null;
    document.body.style.overflow = "";
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-fechar-modal]")) fecharModal();
    if (e.target === MODAL) fecharModal();
    if (e.target.closest("[data-logout]")) {
      e.preventDefault();
      if (cliente) cliente.auth.signOut().then(function () { window.location.replace("index.html"); });
    }
    var aba = e.target.closest("[data-aba]");
    if (aba) {
      var alvo = aba.getAttribute("data-aba");
      document.querySelectorAll("[data-aba]").forEach(function (b) {
        b.classList.toggle("is-ativa", b === aba);
      });
      document.querySelectorAll("[data-painel]").forEach(function (s) {
        s.hidden = s.getAttribute("data-painel") !== alvo;
      });
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && MODAL && !MODAL.hidden) fecharModal();
  });

  /* ---------------- utilidades ---------------- */
  function falhou(e) {
    console.error(e);
    alert("Não consegui salvar essa mudança agora. Tente de novo em alguns segundos.");
  }
  function data(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return isNaN(d) ? "—" : d.toLocaleDateString("pt-BR");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
})();
