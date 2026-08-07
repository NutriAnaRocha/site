/* ============================================================
   CONTA — entrar, cadastrar e recuperar senha da biblioteca de Nutri Ana Luísa Rocha.

   Quatro fluxos na mesma página:
     1. Entrar          -> signInWithPassword
     2. Criar conta     -> signUp (a pessoa se cadastra sozinha; o acesso aos
                           materiais pagos continua sendo liberado à mão no painel)
     3. Esqueci a senha -> resetPasswordForEmail (o link volta para cá)
     4. Criar senha     -> retorno do link com #access_token no hash
                           (type=invite ou type=recovery)

   Requer supabase-client.js incluído ANTES deste arquivo.
   ============================================================ */
(function () {
  "use strict";

  var DESTINO_PADRAO = "biblioteca";
  var PAINEL = "painel";
  var PAPEL_DONA = "nutri";
  /* Destinos por papel. Vazio no caso normal: leitora vai para a biblioteca e
     a dona para o painel. Só existe quando o site convive com uma plataforma
     externa que tem áreas próprias. */
  var ROTAS = {
  "paciente": "https://nutrianarocha.github.io/Plataforma/prototipo/portal-paciente.html",
  "nutri": "https://nutrianarocha.github.io/Plataforma/prototipo/dashboard.html"
};
  /* Cascas alternativas da mesma tela (?de=chave): mesma autenticação, outro
     texto — quem vem de "área do paciente" não deve ler "e-books adquiridos". */
  var CASCAS = {
  "paciente": {
    "titulo_pagina": "Minha área de acompanhamento — Nutri Ana Luísa Rocha",
    "eyebrow": "Minha área",
    "sub": "Entre com o seu e-mail para ver a sua anamnese, o seu plano alimentar e o diário do prato.",
    "botao": "Entrar na minha área →",
    "rodape_html": "Ainda não tem acesso? A Ana cria o seu depois da primeira consulta — <a href=\"index.html#acompanhamento\">saiba como funciona →</a>"
  }
};

  var stepEntrar   = document.querySelector('[data-step="entrar"]');
  var stepCadastro = document.querySelector('[data-step="cadastro"]');
  var stepSenha    = document.querySelector('[data-step="senha"]');
  var loginForm    = document.getElementById("login-form");
  var cadastroForm = document.getElementById("cadastro-form");
  var senhaForm    = document.getElementById("senha-form");
  var err          = document.querySelector("[data-err]");
  var errC         = document.querySelector("[data-err-cadastro]");
  var err2         = document.querySelector("[data-err2]");
  var submit       = document.querySelector("[data-submit]");
  var submitC      = document.querySelector("[data-submit-cadastro]");
  var submit2      = document.querySelector("[data-submit2]");

  /* ---------- utilidades de UI ---------- */
  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }
  function clearErr(el) { if (el) { el.textContent = ""; el.hidden = true; } }

  function setBusy(btn, busy, textoOcupado) {
    if (!btn) return;
    if (busy) {
      btn.dataset.txt = btn.dataset.txt || btn.textContent;
      btn.classList.add("is-loading");
      btn.textContent = textoOcupado || "Entrando…";
    } else {
      btn.classList.remove("is-loading");
      if (btn.dataset.txt) btn.textContent = btn.dataset.txt;
    }
  }

  // O supabase-js responde em inglês; a leitora não tem que ler isso.
  function traduzErro(e) {
    var m = (e && e.message) || "";
    if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/email not confirmed/i.test(m)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
    if (/user already registered|already been registered/i.test(m)) return "Já existe uma conta com esse e-mail. Entre por aqui ou use \"Esqueci minha senha\".";
    if (/password should be at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
    if (/different from the old|should be different|same_password/i.test(m)) return "A nova senha precisa ser diferente da anterior.";
    if (/email.*invalid|invalid.*email/i.test(m)) return "E-mail inválido.";
    if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Espere um minutinho e tente de novo.";
    if (/offline|carregar supabase/i.test(m)) return "Sem conexão com o servidor. Verifique sua internet.";
    return m || "Não foi possível continuar. Tente novamente.";
  }

  /* ---------- destino após autenticar ----------
     ?next=pagina tem prioridade (veio de "acessar minha biblioteca").
     A regex só aceita um nome simples do mesmo diretório, sem extensão nem
     barra — guarda contra open redirect.
     A consulta ao perfil é best-effort: qualquer falha cai na biblioteca. */
  function irParaDestino() {
    var next = new URLSearchParams(location.search).get("next");
    if (next && /^[a-z0-9-]+$/i.test(next)) { window.location.href = next; return; }

    window.SiteDBReady.then(function (c) {
      return c.from("profiles").select("tipo").maybeSingle();
    }).then(function (res) {
      var tipo = (res && res.data && res.data.tipo) || "";
      if (ROTAS[tipo]) { window.location.href = ROTAS[tipo]; return; }
      window.location.href = tipo === PAPEL_DONA ? PAINEL : DESTINO_PADRAO;
    }).catch(function () {
      window.location.href = DESTINO_PADRAO;
    });
  }

  /* ---------- casca conforme a origem (?de=chave) ---------- */
  var de = new URLSearchParams(location.search).get("de");
  if (de && CASCAS[de]) {
    var casca   = CASCAS[de];
    var eyebrow = document.querySelector("[data-entrar-eyebrow]");
    var sub     = document.querySelector("[data-entrar-sub]");
    var rodape  = document.querySelector("[data-entrar-rodape]");
    if (casca.titulo_pagina) document.title = casca.titulo_pagina;
    if (eyebrow && casca.eyebrow) eyebrow.textContent = casca.eyebrow;
    if (sub && casca.sub) sub.textContent = casca.sub;
    if (submit && casca.botao) submit.textContent = casca.botao;
    if (rodape && casca.rodape_html) rodape.innerHTML = casca.rodape_html;
  }

  function mostrarPasso(qual) {
    if (stepEntrar)   stepEntrar.hidden   = qual !== "entrar";
    if (stepCadastro) stepCadastro.hidden = qual !== "cadastro";
    if (stepSenha)    stepSenha.hidden    = qual !== "senha";
  }

  document.addEventListener("click", function (e) {
    var alvo = e.target.closest("[data-ir-passo]");
    if (!alvo) return;
    e.preventDefault();
    clearErr(err); clearErr(errC);
    mostrarPasso(alvo.getAttribute("data-ir-passo"));
  });

  /* ---------- 1. Entrar ---------- */
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearErr(err);
      var email = document.getElementById("email").value.trim();
      var senha = document.getElementById("senha").value;
      if (!email || !senha) { showErr(err, "Preencha e-mail e senha."); return; }

      setBusy(submit, true, "Entrando…");
      window.SiteDBReady.then(function (c) {
        return c.auth.signInWithPassword({ email: email, password: senha });
      }).then(function (res) {
        if (res.error) throw res.error;
        irParaDestino();
      }).catch(function (e2) {
        setBusy(submit, false);
        showErr(err, traduzErro(e2));
      });
    });
  }

  /* ---------- 2. Criar conta ----------
     Cadastrar não dá acesso a material nenhum: quem entra novo vê só o que é
     gratuito. O resto é liberado à mão no painel. */
  if (cadastroForm) {
    cadastroForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearErr(errC);
      var nome  = document.getElementById("c-nome").value.trim();
      var email = document.getElementById("c-email").value.trim();
      var senha = document.getElementById("c-senha").value;
      if (!nome)  { showErr(errC, "Diga como você quer ser chamada."); return; }
      if (!email) { showErr(errC, "Preencha o seu e-mail."); return; }
      if (senha.length < 6) { showErr(errC, "A senha precisa ter pelo menos 6 caracteres."); return; }

      setBusy(submitC, true, "Criando…");
      window.SiteDBReady.then(function (c) {
        return c.auth.signUp({
          email: email,
          password: senha,
          options: { data: { nome: nome }, emailRedirectTo: location.origin + location.pathname }
        });
      }).then(function (res) {
        if (res.error) throw res.error;
        // Com "Confirm email" desligado no projeto, o signUp já devolve sessão
        // e a pessoa entra direto. Com a confirmação ligada, não devolve.
        if (res.data && res.data.session) { irParaDestino(); return; }
        setBusy(submitC, false);
        showErr(errC, "Conta criada! Confirme o seu e-mail pelo link que enviamos e depois entre por aqui. 🌸");
      }).catch(function (e2) {
        setBusy(submitC, false);
        showErr(errC, traduzErro(e2));
      });
    });
  }

  /* ---------- 3. Esqueci minha senha ---------- */
  var linkEsqueci = document.getElementById("link-esqueci");
  if (linkEsqueci) {
    linkEsqueci.addEventListener("click", function (e) {
      e.preventDefault();
      clearErr(err);
      var email = document.getElementById("email").value.trim();
      if (!email) { showErr(err, "Digite seu e-mail acima para receber o link de redefinição."); return; }
      window.SiteDBReady.then(function (c) {
        // O link volta para ESTA página; o hash é tratado lá embaixo.
        return c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      }).then(function (res) {
        if (res && res.error) throw res.error;
        // O Supabase não revela se o e-mail tem conta (e não manda nada se não
        // tiver). Sem essa ressalva, quem ainda não se cadastrou fica esperando
        // um e-mail que nunca vem.
        showErr(err, "Se já existe uma conta com esse e-mail, o link de redefinição chega em instantes — confira também o spam. Se ainda não tem conta, crie a sua em \"Criar a minha conta\". 🌸");
      }).catch(function (e2) { showErr(err, traduzErro(e2)); });
    });
  }

  /* ---------- 4. Criar senha (retorno do link) ---------- */
  function parseHash() {
    var out = {};
    (location.hash.replace(/^#/, "")).split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
  }

  if (senhaForm) {
    senhaForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearErr(err2);
      var s1 = document.getElementById("senha1").value;
      var s2 = document.getElementById("senha2").value;
      if (s1.length < 6) { showErr(err2, "A senha precisa ter pelo menos 6 caracteres."); return; }
      if (s1 !== s2) { showErr(err2, "As senhas não conferem."); return; }

      setBusy(submit2, true, "Salvando…");
      window.SiteDBReady.then(function (c) {
        return c.auth.updateUser({ password: s1 });
      }).then(function (res) {
        if (res.error) throw res.error;
        history.replaceState(null, "", location.pathname + location.search); // tira o token do hash
        irParaDestino();
      }).catch(function (e2) {
        setBusy(submit2, false);
        showErr(err2, traduzErro(e2));
      });
    });
  }

  var hp = parseHash();
  if ((hp.type === "invite" || hp.type === "recovery") && hp.access_token) {
    var convite = hp.type === "invite";
    window.SiteDBReady.then(function (c) {
      return c.auth.setSession({ access_token: hp.access_token, refresh_token: hp.refresh_token });
    }).then(function (res) {
      if (res.error) throw res.error;
      var tit = document.querySelector("[data-senha-titulo]");
      var sub = document.querySelector("[data-senha-sub]");
      if (convite) {
        if (tit) tit.textContent = "Bem-vinda! Crie a sua senha 🎉";
        if (sub) sub.textContent = "Escolha uma senha para acessar a sua biblioteca sempre que quiser.";
      } else {
        if (tit) tit.textContent = "Defina uma nova senha 🌸";
        if (sub) sub.textContent = "Escolha uma nova senha para a sua conta.";
      }
      mostrarPasso("senha");
      document.getElementById("senha1").focus();
    }).catch(function () {
      mostrarPasso("entrar");
      showErr(err, "Esse link é inválido ou expirou. Peça um novo em \"Esqueci minha senha\".");
    });
  } else if (hp.error || hp.error_description) {
    showErr(err, "Esse link é inválido ou expirou. Peça um novo em \"Esqueci minha senha\".");
  } else {
    // Sem link no hash: se já houver sessão ativa, não faz sentido pedir login.
    window.SiteDBReady.then(function (c) {
      return c.auth.getSession();
    }).then(function (r) {
      if (r.data && r.data.session) irParaDestino();
    }).catch(function () { /* sem conexão: deixa o formulário à mostra */ });
  }
})();
