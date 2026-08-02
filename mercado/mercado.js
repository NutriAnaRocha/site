/* =========================================================
   NO MERCADO COM A NUTRI ANA — comportamento do app.

   Fluxo: até 3 fotos do mesmo produto -> edge function
   'analisar-rotulo' -> leitura + ingredientes explicados +
   (quando o produto não é boa escolha) 3 marcas alternativas.

   DUAS COISAS QUE EXPLICAM O DESENHO DESTE ARQUIVO

   1. A FOTO NÃO SOBE PARA LUGAR NENHUM. Ela é reduzida aqui e vai
      no corpo da chamada, em base64. Não há bucket, não há arquivo
      guardado, não há foto órfã para limpar depois. Ver a migração
      0051 e o cabeçalho da edge function.

   2. NÃO PRECISA DE CONTA. Quem está no corredor do mercado não vai
      criar login para ler um rótulo. O visitante é identificado por
      um uuid no localStorage — que serve para o histórico dele e
      para o limite diário. Entrar só muda o tamanho do limite (e é
      o que libera as pacientes da Ana).

   Requer supabase-client.js ANTES deste arquivo (só para a parte
   de conta; a leitura de rótulo funciona sem sessão).
   ========================================================= */
(function () {
  "use strict";

  var FUNCAO = "https://btsqrpxzlkmucrfvsytl.supabase.co/functions/v1/analisar-rotulo";
  var ANON = "sb_publishable_WinaFUxjvv0ODjSs7sT2dQ_k7GlLLxh";

  /* Rótulo é letra miúda em fundo colorido: 1400 px é o menor lado em
     que a lista de ingredientes ainda sai legível para o modelo. No
     diário do prato 1024 basta, aqui não — errar "0,5 g" por "0,6 g"
     é errar a leitura inteira. */
  var MAX_LADO = 1400;
  var QUALIDADE = 0.85;

  var CHAVE_DISP = "mercado.dispositivo";
  var CHAVE_HIST = "mercado.historico";
  var MAX_HIST = 20;

  var VEREDITOS = {
    boa:     { rotulo: "Pode levar",     icone: "✓" },
    atencao: { rotulo: "Dá para levar, mas…", icone: "!" },
    evitar:  { rotulo: "Eu deixaria na prateleira", icone: "✕" }
  };

  var fotos = [null, null, null];   // { blob, dataUrl } por slot
  var slotAlvo = 0;
  var ocupado = false;

  /* ---------- utilidades ---------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function $(sel) { return document.querySelector(sel); }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // localStorage pode estar bloqueado (navegação privada no iOS). Nada
  // aqui é essencial, então tudo falha em silêncio para um valor de sessão.
  function ler(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v == null ? padrao : JSON.parse(v); }
    catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* ignora */ }
  }

  var dispositivo = (function () {
    var d = ler(CHAVE_DISP, null);
    if (typeof d !== "string" || d.length < 8) { d = uuid(); gravar(CHAVE_DISP, d); }
    return d;
  })();

  function dataBR(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " às " + p(d.getHours()) + "h" + p(d.getMinutes());
  }

  /* ---------- navegação ---------- */

  function irPara(tela) {
    document.querySelectorAll("[data-tela]").forEach(function (s) {
      s.classList.toggle("is-on", s.getAttribute("data-tela") === tela);
    });
    document.querySelectorAll("[data-ir]").forEach(function (b) {
      if (b.classList.contains("barra__b")) {
        b.classList.toggle("is-on", b.getAttribute("data-ir") === tela);
      }
    });
    window.scrollTo(0, 0);
  }

  document.querySelectorAll("[data-ir]").forEach(function (b) {
    b.addEventListener("click", function () { irPara(b.getAttribute("data-ir")); });
  });

  /* ---------- fotos ---------- */

  // Reduz antes de mandar: foto de celular tem 4 MB e chegaria a ~5,3 MB
  // em base64. Reduzida, são ~250 KB — e o modelo enxerga igual.
  function processar(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Não consegui ler essa foto.")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("Esse arquivo não parece ser uma imagem.")); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var s = Math.min(1, MAX_LADO / Math.max(w, h));
          var cv = document.createElement("canvas");
          cv.width = Math.round(w * s);
          cv.height = Math.round(h * s);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          resolve({ dataUrl: cv.toDataURL("image/jpeg", QUALIDADE) });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function pintarSlot(i) {
    var el = document.querySelector('[data-slot="' + i + '"]');
    if (!el) return;
    var f = fotos[i];
    el.querySelectorAll(".slot__img,.slot__x").forEach(function (n) { n.remove(); });
    el.classList.toggle("tem", !!f);
    if (f) {
      var img = document.createElement("img");
      img.className = "slot__img";
      img.src = f.dataUrl;
      img.alt = "";
      var x = document.createElement("span");
      x.className = "slot__x";
      x.setAttribute("data-tirar", String(i));
      x.textContent = "×";
      el.appendChild(img);
      el.appendChild(x);
    }
    atualizarBotao();
  }

  function atualizarBotao() {
    var qtd = fotos.filter(Boolean).length;
    var btn = $("[data-analisar]");
    btn.disabled = qtd === 0 || ocupado;
    btn.textContent = qtd === 0 ? "Ler o rótulo"
      : ocupado ? "Lendo…"
      : "Ler o rótulo (" + qtd + (qtd === 1 ? " foto)" : " fotos)");

    var dica = $("[data-dica]");
    if (qtd === 0) {
      dica.innerHTML = "Dá para mandar só uma foto, mas com a <strong>tabela</strong> e os " +
        "<strong>ingredientes</strong> a leitura fica bem melhor. Aproxime e mantenha firme.";
    } else if (!fotos[1] && !fotos[2]) {
      dica.innerHTML = "Se der, fotografe também a <strong>tabela nutricional</strong> e a " +
        "<strong>lista de ingredientes</strong> — é ali que está o que interessa.";
    } else if (!fotos[2]) {
      dica.innerHTML = "Falta a <strong>lista de ingredientes</strong>. É ela que mostra açúcar " +
        "disfarçado e fila de aditivos.";
    } else if (!fotos[1]) {
      dica.innerHTML = "Falta a <strong>tabela nutricional</strong> — sem ela não dá para comparar " +
        "com outras marcas.";
    } else {
      dica.innerHTML = "Prontinho, é isso. Pode ler. 🌸";
    }
  }

  document.querySelectorAll("[data-slot]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      var x = e.target.closest("[data-tirar]");
      if (x) {                                   // toque no × remove a foto
        fotos[Number(x.getAttribute("data-tirar"))] = null;
        pintarSlot(Number(x.getAttribute("data-tirar")));
        return;
      }
      slotAlvo = Number(el.getAttribute("data-slot"));
      $("#camera").click();
    });
  });

  // Câmera x galeria. O atributo capture é o que faz o celular ir direto para a
  // câmera; tirá-lo devolve o seletor do sistema (onde a câmera ainda aparece,
  // só que num toque a mais). Fica num link visível, e não num ajuste escondido,
  // para a pessoa saber em que modo está.
  var galeria = false;
  var btFonte = $("[data-fonte]");
  if (btFonte) {
    btFonte.addEventListener("click", function () {
      galeria = !galeria;
      if (galeria) $("#camera").removeAttribute("capture");
      else $("#camera").setAttribute("capture", "environment");
      btFonte.textContent = galeria
        ? "Voltar a fotografar com a câmera"
        : "Prefiro escolher fotos já salvas";
    });
  }

  $("#camera").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";                              // permite reescolher a MESMA foto
    if (!f) return;
    processar(f).then(function (r) {
      fotos[slotAlvo] = r;
      pintarSlot(slotAlvo);
    }).catch(function (e) {
      mostrarErro(e.message || "Não consegui usar essa foto.");
    });
  });

  /* ---------- análise ---------- */

  function mostrarErro(msg, comBotao) {
    $("[data-resultado]").innerHTML =
      '<div class="erro"><p>' + esc(msg) + '</p>' +
      (comBotao ? '<button class="btn btn--linha btn--peq" type="button" data-ir="conta">Entrar na minha conta</button>' : '') +
      '</div>';
    var b = $("[data-resultado] [data-ir]");
    if (b) b.addEventListener("click", function () { irPara("conta"); });
    $("[data-resultado]").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Cada slot tem um papel, e o servidor precisa saber qual é: a foto da
  // frente vai ao modelo em resolução baixa (dali só saem nome e marca) e
  // as outras duas em alta. Isso corta boa parte do custo de cada leitura.
  var TIPO_DO_SLOT = ["frente", "tabela", "ingredientes"];

  function analisar() {
    if (ocupado) return;
    var envio = [];
    fotos.forEach(function (f, i) {
      if (f) envio.push({ url: f.dataUrl, tipo: TIPO_DO_SLOT[i] });
    });
    if (!envio.length) return;

    ocupado = true;
    atualizarBotao();
    $("[data-resultado]").innerHTML =
      '<div class="cartao carregando"><div class="carregando__p"></div>' +
      '<p class="carregando__t">Lendo o rótulo com você…</p></div>';

    sessaoAtual().then(function (token) {
      var h = { "Content-Type": "application/json", "apikey": ANON };
      // O token só amplia o limite. Sem ele a chamada funciona igual.
      h.Authorization = "Bearer " + (token || ANON);
      return fetch(FUNCAO, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ fotos: envio, dispositivo: dispositivo })
      });
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (res) {
      ocupado = false;
      atualizarBotao();
      var b = res.body || {};

      if (res.status === 429) {
        mostrarErro(b.detail || "Você chegou ao limite de hoje.", b.liberado !== true);
        return;
      }
      if (b.nao_e_rotulo) { mostrarErro(b.error); return; }
      if (!b.ok || !b.analise) {
        mostrarErro(b.detail && /openai/i.test(b.detail)
          ? "A leitura falhou agora. Tente de novo daqui a pouco."
          : (b.error || "Não consegui ler esse rótulo. Tente uma foto mais próxima e com boa luz."));
        return;
      }

      $("[data-resultado]").innerHTML = resultadoHTML(b);
      esconderIsca();
      guardarNoHistorico(b.analise);
      pintarRestam(b);
      $("[data-resultado]").scrollIntoView({ behavior: "smooth", block: "start" });

      // Limpa os slots: a próxima leitura é de outro produto, e deixar as
      // fotos antigas ali já fez gente reanalisar o mesmo pacote sem querer.
      fotos = [null, null, null];
      [0, 1, 2].forEach(pintarSlot);
    }).catch(function () {
      ocupado = false;
      atualizarBotao();
      mostrarErro("Sem conexão com o servidor. Verifique a internet do celular e tente de novo.");
    });
  }

  $("[data-analisar]").addEventListener("click", analisar);

  function pintarRestam(b) {
    var el = $("[data-restam]");
    if (typeof b.restam !== "number") { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = b.restam > 0
      ? "Você ainda pode ler " + b.restam + (b.restam === 1 ? " rótulo hoje" : " rótulos hoje") + "."
      : "Foi a sua última leitura de hoje. Amanhã o app abre de novo. 🌸";
  }

  /* ---------- resultado ---------- */

  function numsHTML(t) {
    var p = (t && t.por_100g) || {};
    var linhas = [
      ["kcal", p.kcal, ""],
      ["Açúcar", p.acucar_g, "g"],
      ["Gord. sat.", p.sat_g, "g"],
      ["Sódio", p.sodio_mg, "mg"],
      ["Fibra", p.fibra_g, "g"]
    ].filter(function (l) { return l[1] != null && l[1] !== ""; });
    if (!linhas.length) return "";
    return '<div class="bloco"><p class="bloco__t">Por 100 g</p><div class="nums">' +
      linhas.map(function (l) {
        return '<div class="num"><span class="num__v">' + esc(l[1]) + esc(l[2]) + '</span>' +
          '<span class="num__k">' + esc(l[0]) + '</span></div>';
      }).join("") +
      '</div><p class="nums__nota">Comparamos por 100 g porque a porção do rótulo é escolha do fabricante.</p></div>';
  }

  function resultadoHTML(b) {
    var a = b.analise;
    var v = VEREDITOS[a.veredito] || VEREDITOS.atencao;

    var faltando = (b.falta || []).map(function (f) {
      if (f === "tabela") return "a tabela nutricional";
      if (f === "ingredientes") return "a lista de ingredientes";
      if (f === "nitidez") return "uma foto mais nítida";
      return "";
    }).filter(Boolean);

    var destaques = (a.destaques || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
    var alertas = (a.alertas || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");

    var ingr = (a.ingredientes || []).map(function (i) {
      return '<div class="ingr"><strong class="ingr__t">' + esc(i.termo) + '</strong>' +
        '<span class="ingr__e">' + esc(i.explicacao) + '</span></div>';
    }).join("");

    var alts = (a.alternativas || []).map(function (x, i) {
      return '<div class="alt"><span class="alt__n">' + (i + 1) + '</span><div>' +
        '<strong class="alt__nome">' + esc(x.nome) + (x.quantidade ? " · " + esc(x.quantidade) : "") + '</strong>' +
        '<span class="alt__marca">' + esc(x.marca) + '</span>' +
        '<span class="alt__pq">' + esc(x.porque) + '</span>' +
      '</div></div>';
    }).join("");

    return '<div class="res res--' + esc(a.veredito) + '">' +
      '<div class="res__topo">' +
        '<div class="res__selo"><b>' + v.icone + '</b> ' + esc(v.rotulo) + '</div>' +
        '<div class="res__prod">' + esc(a.produto || "Produto") + '</div>' +
        (a.marca ? '<div class="res__marca">' + esc(a.marca) + (a.categoria ? " · " + esc(a.categoria) : "") + '</div>' : '') +
      '</div>' +
      '<div class="res__corpo">' +
        (a.resumo ? '<p class="res__resumo">' + esc(a.resumo) + '</p>' : '') +

        (faltando.length
          ? '<div class="aviso">Não consegui ver ' + esc(faltando.join(" nem ")) +
            '. A leitura vale, mas fica mais certeira com essa foto também.</div>'
          : '') +

        numsHTML(a.tabela) +

        /* O que está bom vem ANTES do que pesa contra. A pessoa está
           decidindo uma compra, não sendo avaliada — começar pela cobrança
           faz ela fechar o app. */
        (destaques ? '<div class="bloco"><p class="bloco__t">A favor</p><ul class="lista lista--bom">' + destaques + '</ul></div>' : '') +
        (alertas ? '<div class="bloco"><p class="bloco__t">Contra</p><ul class="lista lista--ruim">' + alertas + '</ul></div>' : '') +

        (ingr ? '<div class="bloco"><p class="bloco__t">O que esses nomes querem dizer</p>' + ingr + '</div>' : '') +

        (alts
          ? '<div class="bloco"><p class="bloco__t">Se quiser trocar, olhe estas</p>' + alts +
            '<p class="alt-nota">Três marcas diferentes, escolhidas por comparação de tabela na base ' +
            'pública Open Food Facts. A Ana não recebe de nenhuma delas — e nunca indica só uma.</p></div>'
          : (b.sem_alternativa
              ? '<div class="bloco"><p class="bloco__t">E as alternativas?</p><p class="alt__pq">' +
                esc(b.sem_alternativa) + '</p></div>'
              : '')) +

        '<p class="res__rodape">Leitura gerada com apoio de inteligência artificial a partir das suas ' +
        'fotos — pode conter erro; o que vale é o que está impresso na embalagem. Isto é orientação ' +
        'geral sobre rótulos, não avaliação nutricional individualizada. Ana Luísa Rocha, CRN 25100401.</p>' +
      '</div>' +
    '</div>';
  }

  /* ---------- histórico ----------
     Fica no próprio aparelho. Quem não tem conta não deveria precisar de
     uma para lembrar do que já leu, e guardar isso no servidor por
     dispositivo criaria um histórico sem dono — que é justamente o tipo
     de dado que não se deve guardar. */

  function guardarNoHistorico(a) {
    var h = ler(CHAVE_HIST, []);
    if (!Array.isArray(h)) h = [];
    h.unshift({
      produto: a.produto, marca: a.marca, veredito: a.veredito,
      criado_em: a.criado_em, dados: a
    });
    gravar(CHAVE_HIST, h.slice(0, MAX_HIST));
    pintarHistorico();
  }

  // A lição de abertura só ocupa a tela enquanto ela está vazia. Assim que
  // existe resultado ou histórico, ela sai — a partir daí é ruído.
  function esconderIsca() {
    var i = $("[data-isca]");
    if (i) i.hidden = true;
  }

  function pintarHistorico() {
    var h = ler(CHAVE_HIST, []);
    var caixa = $("[data-historico]");
    if (!Array.isArray(h) || !h.length) { caixa.hidden = true; return; }
    esconderIsca();
    caixa.hidden = false;
    $("[data-historico-lista]").innerHTML = h.map(function (x, i) {
      return '<button class="hist hist--' + esc(x.veredito || "atencao") + '" type="button" data-hist="' + i + '">' +
        '<span class="hist__p"></span><span>' +
        '<strong class="hist__t">' + esc(x.produto || "Produto") + '</strong>' +
        '<span class="hist__d">' + esc([x.marca, dataBR(x.criado_em)].filter(Boolean).join(" · ")) + '</span>' +
        '</span></button>';
    }).join("");
  }

  $("[data-historico-lista]").addEventListener("click", function (e) {
    var b = e.target.closest("[data-hist]");
    if (!b) return;
    var h = ler(CHAVE_HIST, []);
    var x = h[Number(b.getAttribute("data-hist"))];
    if (!x || !x.dados) return;
    $("[data-resultado]").innerHTML = resultadoHTML({ analise: x.dados, falta: [] });
    $("[data-resultado]").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- conta ----------
     Entrar é OPCIONAL e serve para uma coisa só: paciente da Ana lê mais
     rótulos por dia. Por isso a tela não empurra cadastro — quem não tem
     conta não é convidado a criar uma, é convidado a conhecer a consulta. */

  function sessaoAtual() {
    if (!window.NutriDBReady) return Promise.resolve(null);
    return window.NutriDBReady
      .then(function (c) { return c.auth.getSession(); })
      .then(function (r) { return (r.data && r.data.session && r.data.session.access_token) || null; })
      .catch(function () { return null; });
  }

  function pintarConta() {
    var chip = $("[data-conta-chip]");
    var box = $("[data-conta-box]");

    if (!window.NutriDBReady) {
      chip.textContent = "Entrar";
      box.innerHTML = '<div class="cartao"><p>Não consegui falar com o servidor agora. ' +
        'A leitura de rótulo continua funcionando.</p></div>';
      return;
    }

    window.NutriDBReady.then(function (c) {
      return c.auth.getUser();
    }).then(function (r) {
      var u = r && r.data && r.data.user;
      if (u) {
        chip.textContent = "Sair";
        box.innerHTML = '<div class="cartao">' +
          '<h2 class="sec">Você está dentro 🌸</h2>' +
          '<p>' + esc(u.email || "") + '</p>' +
          '<p>Se você é paciente da Ana, o seu limite diário já está liberado.</p>' +
          '<button class="btn btn--linha btn--peq" type="button" data-sair>Sair da conta</button>' +
          '</div>';
        return;
      }
      chip.textContent = "Entrar";
      box.innerHTML = '<div class="cartao">' +
        '<h2 class="sec">Já é paciente da Ana?</h2>' +
        '<p>Entre com a mesma conta da plataforma e leia mais rótulos por dia, sem limite de visitante.</p>' +
        '<form data-login>' +
          '<label class="campo"><span>E-mail</span>' +
            '<input type="email" name="email" autocomplete="email" required></label>' +
          '<label class="campo"><span>Senha</span>' +
            '<input type="password" name="senha" autocomplete="current-password" required></label>' +
          '<button class="btn btn--go btn--peq" type="submit">Entrar</button>' +
          '<p class="msg" data-msg hidden></p>' +
        '</form>' +
        '<p class="rodape-nota">Não tem conta? Não precisa: o app funciona sem entrar. ' +
        '<a href="../entrar.html">Esqueci minha senha</a></p>' +
        '</div>';
    }).catch(function () {
      chip.textContent = "Entrar";
    });
  }

  document.addEventListener("submit", function (e) {
    var f = e.target.closest("[data-login]");
    if (!f) return;
    e.preventDefault();
    var msg = f.querySelector("[data-msg]");
    var btn = f.querySelector("button[type=submit]");
    msg.hidden = true;
    btn.disabled = true;
    btn.textContent = "Entrando…";

    window.NutriDBReady.then(function (c) {
      return c.auth.signInWithPassword({
        email: f.email.value.trim(),
        password: f.senha.value
      });
    }).then(function (r) {
      if (r.error) throw r.error;
      pintarConta();
      irPara("ler");
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = "Entrar";
      msg.hidden = false;
      msg.className = "msg msg--erro";
      msg.textContent = /invalid login credentials/i.test((err && err.message) || "")
        ? "E-mail ou senha incorretos."
        : "Não consegui entrar agora. Tente de novo.";
    });
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest("[data-sair]")) return;
    window.NutriDBReady.then(function (c) { return c.auth.signOut(); })
      .then(pintarConta)
      .catch(pintarConta);
  });

  /* ---------- instalação (PWA) ---------- */

  var promptInstalar = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    promptInstalar = e;
    var b = $("[data-instalar]");
    if (b) b.hidden = false;
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest("[data-instalar]") || !promptInstalar) return;
    promptInstalar.prompt();
    promptInstalar = null;
    $("[data-instalar]").hidden = true;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* sem offline, tudo bem */ });
    });
  }

  /* ---------- início ---------- */
  [0, 1, 2].forEach(pintarSlot);
  pintarHistorico();
  pintarConta();
})();
