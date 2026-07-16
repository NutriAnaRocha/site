/* ============================================================
   CONTA — login da biblioteca do site institucional.
   Autentica no MESMO Supabase do NutriPlat (ver supabase-client.js),
   então a conta é uma só; o que muda aqui é só a casca (a marca da Ana).

   Cobre 3 fluxos na mesma página:
     1. Entrar            -> signInWithPassword
     2. Esqueci a senha   -> resetPasswordForEmail (volta pra cá)
     3. Criar senha       -> retorno de link com #access_token no hash,
                             type=invite (comprador novo) ou type=recovery.

   Portado de Plataforma/prototipo/assets/js/app.js (o fluxo lá é o mesmo).
   Requer supabase-client.js incluído ANTES deste arquivo.
   ============================================================ */
(function () {
  "use strict";

  var DESTINO_PADRAO = "biblioteca.html";

  var stepEntrar = document.querySelector('[data-step="entrar"]');
  var stepSenha  = document.querySelector('[data-step="senha"]');
  var loginForm  = document.getElementById("login-form");
  var senhaForm  = document.getElementById("senha-form");
  var err        = document.querySelector("[data-err]");
  var err2       = document.querySelector("[data-err2]");
  var submit     = document.querySelector("[data-submit]");
  var submit2    = document.querySelector("[data-submit2]");

  /* ---------- utilidades de UI ---------- */
  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg; el.hidden = false;
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

  // Mensagens de erro em português — espelha translateAuthError() do app.js:59.
  function traduzErro(e) {
    var m = (e && e.message) || "";
    if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/email not confirmed/i.test(m)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
    if (/password should be at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
    if (/different from the old|should be different|same_password/i.test(m)) return "A nova senha precisa ser diferente da anterior.";
    if (/email.*invalid|invalid.*email/i.test(m)) return "E-mail inválido.";
    if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Espere um minutinho e tente de novo.";
    if (/offline|carregar supabase/i.test(m)) return "Sem conexão com o servidor. Verifique sua internet.";
    return m || "Não foi possível entrar. Tente novamente.";
  }

  /* ---------- destino após autenticar ----------
     ?next=pagina.html tem prioridade (ex.: veio de "acessar minha biblioteca").
     A regex só aceita um .html do mesmo diretório — guarda contra open redirect.
     Copiada de app.js:137-139. */
  function irParaDestino() {
    var next = new URLSearchParams(location.search).get("next");
    if (next && /^[a-z0-9-]+\.html$/i.test(next)) { window.location.href = next; return; }
    window.location.href = DESTINO_PADRAO;
  }

  function mostrarPasso(qual) {
    if (stepEntrar) stepEntrar.hidden = qual !== "entrar";
    if (stepSenha)  stepSenha.hidden  = qual !== "senha";
  }

  /* ---------- 1. Entrar ---------- */
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearErr(err);
      var email = document.getElementById("email").value.trim();
      var senha = document.getElementById("senha").value;
      if (!email || !senha) { showErr(err, "Preencha e-mail e senha."); return; }

      setBusy(submit, true, "Entrando…");
      window.NutriDBReady.then(function (c) {
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

  /* ---------- 2. Esqueci minha senha ---------- */
  var linkEsqueci = document.getElementById("link-esqueci");
  if (linkEsqueci) {
    linkEsqueci.addEventListener("click", function (e) {
      e.preventDefault();
      clearErr(err);
      var email = document.getElementById("email").value.trim();
      if (!email) { showErr(err, "Digite seu e-mail acima para receber o link de redefinição."); return; }
      window.NutriDBReady.then(function (c) {
        // O link volta para ESTA página; o hash é tratado lá embaixo.
        return c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      }).then(function (res) {
        if (res && res.error) throw res.error;
        showErr(err, "Pronto! Enviamos um link de redefinição para o seu e-mail. 🌸");
      }).catch(function (e2) { showErr(err, traduzErro(e2)); });
    });
  }

  /* ---------- 3. Criar senha (retorno do link de convite/recuperação) ---------- */
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
      window.NutriDBReady.then(function (c) {
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
  // type=invite é o comprador novo (convidado pelo webhook do pagamento);
  // type=recovery é quem clicou em "esqueci minha senha". Os dois caem no
  // mesmo passo: definir a senha e entrar.
  if ((hp.type === "invite" || hp.type === "recovery") && hp.access_token) {
    var convite = hp.type === "invite";
    window.NutriDBReady.then(function (c) {
      return c.auth.setSession({ access_token: hp.access_token, refresh_token: hp.refresh_token });
    }).then(function (res) {
      if (res.error) throw res.error;
      var tit = document.querySelector("[data-senha-titulo]");
      var sub = document.querySelector("[data-senha-sub]");
      if (convite) {
        if (tit) tit.textContent = "Bem-vinda! Crie a sua senha 🎉";
        if (sub) sub.textContent = "Sua compra foi confirmada. Escolha uma senha para acessar a sua biblioteca sempre que quiser.";
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
    // Sem link no hash: se já houver sessão ativa, não faz sentido pedir login de novo.
    window.NutriDBReady.then(function (c) {
      return c.auth.getSession();
    }).then(function (r) {
      if (r.data && r.data.session) irParaDestino();
    }).catch(function () { /* sem conexão: deixa o formulário à mostra */ });
  }
})();
