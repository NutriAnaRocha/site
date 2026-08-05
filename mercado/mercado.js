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
  var CHAVE_CODIGO = "mercado.codigo";
  var MAX_HIST = 20;

  /* Pacote de leituras. O app é grátis com limite diário; quem quer ler
     mais compra um pacote que não vence. Não é assinatura — ninguém no
     corredor do mercado quer assinar nada, e cobrança recorrente pediria
     cadastro, cartão guardado e tela de cancelamento para um produto de
     R$ 9,90. Ver mercado-creditos/index.ts. */
  var CREDITOS = "https://btsqrpxzlkmucrfvsytl.supabase.co/functions/v1/mercado-creditos";
  var LINK_COMPRA = "https://checkout.infinitepay.io/analuisarocha?lenc=G-sAQIyUqJ2vCr3_79QkJfkgHet5QQJ6WfuvO6ACVWBt8T7P0zMNxIsKgrYwyEtCOejBjw_qhsskpfuXDBbuF4nJlRnU_Vb8c7pddHltncR6cjqf8RDP9IwF0yo-ksZhf-mH-Ueq8z95B-hxtV1AqQ2yHASt6xCmEOIx4ZtiDzGEzkoNuyE-malfPHSk0NmHyLwYJ904_R8VBmelJrJ1Vta2csmsxrnWNp8L4jk.v1.4afce9393915732d";
  var PACOTE_LEITURAS = 50;
  var PACOTE_PRECO = "R$ 9,90";

  /* Socorro de quem perdeu o código. Não existe recuperação automática de
     propósito: a única coisa que a compradora tem na mão depois de perder
     o código é o comprovante do pagamento, e conferir comprovante é
     trabalho de gente. Uma tela que devolvesse o código a quem digitasse
     um e-mail entregaria as leituras de qualquer uma para qualquer uma. */
  var WHATS_ANA = "5521994094557";
  function linkSocorro() {
    var msg = "Oi Ana! Comprei o pacote de leituras do app No mercado com a Nutri Ana " +
      "e perdi meu código. Vou te mandar o comprovante do pagamento (com a data e o valor) " +
      "para você achar meu código. 🌸";
    return "https://wa.me/" + WHATS_ANA + "?text=" + encodeURIComponent(msg);
  }

  /* ---------- A troca da nutri ----------
     As alternativas da Open Food Facts respondem "que MARCA eu levo".
     Isto responde outra pergunta, que é a que a Ana faz no consultório:
     "e se eu não levar isso?". São trocas por COMIDA, não por produto de
     prateleira — por isso o texto é escrito por ela e fica fixo, como a
     explicação de diet/light na edge function. Frase de nutricionista
     não se deixa na mão do modelo: aqui tem o CRN dela na tela.

     Indexado por categoria_tag, que já vem gravada em cada análise — o
     histórico antigo também passa a mostrar a troca, sem migration.
     Só aparece quando o veredito NÃO é "boa": quem escolheu bem não
     precisa de sermão. */
  var TROCA_DA_NUTRI = {
    hams: {
      texto: "Em vez do embutido, o ideal é ovo cozido, sardinha ou frango desfiado. " +
             "São proteína de verdade, sem o sódio e os conservantes do presunto.",
      dica: "O ovo mexido fica ótimo feito só com um pouquinho de água ou um fiozinho de azeite."
    },
    sausages: {
      texto: "Em vez do embutido, o ideal é ovo cozido, sardinha ou frango desfiado. " +
             "São proteína de verdade, sem o sódio e os conservantes da salsicha.",
      dica: "O ovo mexido fica ótimo feito só com um pouquinho de água ou um fiozinho de azeite."
    },
    biscuits: {
      texto: "Se for levar biscoito, prefira os de arroz, de polvilho ou de aveia — " +
             "lista curta e sem recheio."
    },
    breads: {
      texto: "Prefira o pão integral de verdade: a farinha integral tem que estar " +
             "no COMEÇO da lista de ingredientes, não no fim."
    }
  };

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
    // O comparador se repinta ao entrar: entre uma visita e outra a pessoa
    // pode ter lido mais um rótulo, e a lista precisa refletir isso.
    if (tela === "comparar" && typeof pintarComparacao === "function") {
      pintarCmpSlots();
      pintarComparacao();
    }
    if (tela === "lista" && typeof pintarLista === "function") pintarLista();
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

  /* acao: "entrar" (paciente da Ana lê mais), "comprar" (pacote de
     leituras) ou nada. Quem bateu o limite precisa de uma saída na
     mesma tela — mandar a pessoa procurar sozinha o que fazer depois
     de um "não" é o jeito mais rápido de perdê-la. */
  function mostrarErro(msg, acao) {
    var extra = "";
    if (acao === "entrar") {
      extra = '<button class="btn btn--linha btn--peq" type="button" data-ir="conta">Entrar na minha conta</button>';
    } else if (acao === "comprar") {
      extra = '<a class="btn btn--go btn--peq" href="' + LINK_COMPRA + '" target="_blank" rel="noopener">' +
              'Comprar ' + PACOTE_LEITURAS + ' leituras — ' + PACOTE_PRECO + '</a>' +
              '<button class="btn btn--linha btn--peq" type="button" data-ir="conta">Entrar ou usar um código</button>';
    }
    $("[data-resultado]").innerHTML =
      '<div class="erro"><p>' + esc(msg) + '</p>' + extra + '</div>';
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
      var corpo = { fotos: envio, dispositivo: dispositivo };
      // O código só diz QUAL pacote é; quem confere o saldo é o servidor.
      var cod = codigoGuardado();
      if (cod) corpo.codigo = cod;
      return fetch(FUNCAO, {
        method: "POST",
        headers: h,
        body: JSON.stringify(corpo)
      });
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (res) {
      ocupado = false;
      atualizarBotao();
      var b = res.body || {};

      // Créditos acabaram, ou o código não existe: a saída é comprar (ou
      // corrigir o código na tela de conta).
      if (res.status === 402 || b.error === "codigo_invalido") {
        if (b.error === "codigo_invalido") esquecerCodigo();
        mostrarErro(b.detail || "Não consegui usar o seu pacote de leituras.", "comprar");
        pintarCreditos();
        return;
      }
      if (res.status === 429) {
        // Quem já pagou e bateu o teto diário do código não recebe oferta
        // de compra: ela já comprou, o que falta é o dia virar.
        var acao = b.error === "limite_codigo_dia" ? null
          : (b.liberado === true ? null : "comprar");
        mostrarErro(b.detail || "Você chegou ao limite de hoje.", acao);
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
      guardarNoHistorico(b.analise, b.tabela);
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

    // Pagante e visitante contam coisas diferentes: um tem leituras que
    // sobraram do pacote (não vencem), o outro tem leituras do dia (que
    // voltam amanhã). Dizer "hoje" para quem comprou daria a impressão
    // de que o pacote expira à meia-noite.
    if (b.pagante) {
      el.textContent = b.restam > 0
        ? "Restam " + b.restam + (b.restam === 1 ? " leitura" : " leituras") + " no seu pacote."
        : "Essa foi a última leitura do seu pacote. 🌸";
      pintarCreditos();
      return;
    }
    el.textContent = b.restam > 0
      ? "Você ainda pode ler " + b.restam + (b.restam === 1 ? " rótulo hoje" : " rótulos hoje") + "."
      : "Foi a sua última leitura de hoje. Amanhã o app abre de novo. 🌸";
  }

  /* ---------- pacote de leituras ----------
     O código é a identidade mínima de quem comprou. Ele mora no
     localStorage como qualquer outra coisa do app, mas com uma
     diferença importante: se sumir, a pessoa PERDEU DINHEIRO. Por isso
     ele aparece escrito na tela de conta, para ela poder anotar, e
     pode ser digitado de novo em qualquer aparelho. */

  function codigoGuardado() {
    var c = ler(CHAVE_CODIGO, null);
    return typeof c === "string" && c.length >= 6 ? c : null;
  }
  function guardarCodigo(c) { gravar(CHAVE_CODIGO, String(c).toUpperCase()); }
  function esquecerCodigo() {
    try { localStorage.removeItem(CHAVE_CODIGO); } catch (e) { /* modo privado */ }
  }

  function chamarCreditos(corpo) {
    return fetch(CREDITOS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": ANON,
                 "Authorization": "Bearer " + ANON },
      body: JSON.stringify(corpo)
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j || {} }; });
    });
  }

  /* Volta do checkout: a InfinitePay devolve a pessoa aqui com os dados
     do pagamento na URL. Não confiamos neles — quem confere é o
     servidor, contra a API deles. É idempotente: recarregar a página
     dez vezes devolve o mesmo código, não dez pacotes. */
  function resgatarDaURL() {
    var q = new URLSearchParams(window.location.search);
    var nsu = q.get("transaction_nsu");
    var slug = q.get("slug");
    if (!nsu || !slug) return;

    // Tira os dados de pagamento da barra de endereço: recarregar não
    // deve reprocessar, e ninguém precisa compartilhar isso sem querer.
    try {
      window.history.replaceState({}, "", window.location.pathname);
    } catch (e) { /* navegador antigo */ }

    irPara("conta");
    var box = $("[data-creditos-box]");
    if (box) box.innerHTML = '<div class="cartao carregando"><div class="carregando__p"></div>' +
      '<p class="carregando__t">Confirmando seu pagamento…</p></div>';

    chamarCreditos({
      acao: "resgatar",
      transaction_nsu: nsu,
      slug: slug,
      order_nsu: q.get("order_nsu") || ""
    }).then(function (res) {
      if (res.body.ok && res.body.codigo) {
        guardarCodigo(res.body.codigo);
        pintarCreditos({ novo: true, recibo: q.get("receipt_url") || "" });
        return;
      }
      // Pagou e algo deu errado: a mensagem tem que dizer o que fazer,
      // e o recibo é a prova que ela tem na mão.
      if (box) {
        box.innerHTML = '<div class="cartao"><h2 class="sec">Quase lá</h2>' +
          '<p>' + esc(res.body.detail || "Não consegui confirmar o pagamento agora.") + '</p>' +
          (q.get("receipt_url")
            ? '<p><a href="' + esc(q.get("receipt_url")) + '" target="_blank" rel="noopener">Ver meu recibo</a></p>'
            : '') +
          '<button class="btn btn--linha btn--peq" type="button" data-tentar-resgate>Tentar de novo</button>' +
          '</div>';
        var bt = box.querySelector("[data-tentar-resgate]");
        if (bt) bt.addEventListener("click", function () {
          window.location.search = "?transaction_nsu=" + encodeURIComponent(nsu) +
            "&slug=" + encodeURIComponent(slug) +
            "&order_nsu=" + encodeURIComponent(q.get("order_nsu") || "");
        });
      }
    }).catch(function () {
      if (box) box.innerHTML = '<div class="cartao"><p>Sem conexão para confirmar o pagamento. ' +
        'Abra o app de novo daqui a pouco — seu pagamento está guardado. 🌸</p></div>';
    });
  }

  function pintarCreditos(opcoes) {
    var box = $("[data-creditos-box]");
    if (!box) return;
    var op = opcoes || {};
    var cod = codigoGuardado();

    if (!cod) {
      box.innerHTML = '<div class="cartao">' +
        '<h2 class="sec">Precisa ler mais rótulos?</h2>' +
        '<p>O app é gratuito com limite diário. Se você faz uma compra grande de uma vez, ' +
        'dá para levar um pacote de <strong>' + PACOTE_LEITURAS + ' leituras</strong> por ' +
        PACOTE_PRECO + ' — elas <strong>não vencem</strong> e você usa quando quiser.</p>' +
        '<ol class="passos">' +
          '<li>Você paga por Pix ou cartão, na página segura da InfinitePay.</li>' +
          '<li>Depois de alguns segundos, a página do pagamento mostra um botão para ' +
            '<strong>voltar para o app</strong>. <strong>Toque nele e não feche a aba antes</strong> ' +
            '— é essa volta que traz o seu código.</li>' +
          '<li>De volta ao app, ele carrega um pouquinho e mostra o seu código — algo como ' +
            '<span class="credito-exemplo">R7QK-3M9F</span>.</li>' +
          '<li><strong>Guarde esse código.</strong> Tem um botão na tela para você mandar ' +
            'para o seu WhatsApp ou salvar nas suas notas.</li>' +
          '<li>É ele que libera as leituras. Se você trocar de celular ou limpar o navegador, ' +
            'digita o código de novo aqui e as suas leituras voltam — elas ficam guardadas ' +
            'comigo, não no aparelho.</li>' +
        '</ol>' +
        '<a class="btn btn--go" href="' + LINK_COMPRA + '" target="_blank" rel="noopener">' +
        'Comprar ' + PACOTE_LEITURAS + ' leituras — ' + PACOTE_PRECO + '</a>' +
        '<form data-codigo-form>' +
          '<label class="campo"><span>Já comprou? Digite seu código</span>' +
            '<input name="codigo" placeholder="XXXX-XXXX" autocapitalize="characters" ' +
            'autocomplete="off" spellcheck="false" maxlength="16" required></label>' +
          '<button class="btn btn--linha btn--peq" type="submit">Usar este código</button>' +
          '<p class="msg" data-msg-codigo hidden></p>' +
        '</form>' +
        '<p class="socorro"><a href="' + linkSocorro() + '" target="_blank" rel="noopener">' +
        'Comprou e perdeu o código?</a></p>' +
        '</div>';
      return;
    }

    box.innerHTML = '<div class="cartao">' +
      (op.novo ? '<h2 class="sec">Pagamento confirmado 🌸</h2>' : '<h2 class="sec">Seu pacote de leituras</h2>') +
      '<p class="credito-codigo" data-codigo-mostra>' + esc(cod) + '</p>' +
      '<p class="credito-saldo" data-saldo>Conferindo o saldo…</p>' +
      (op.novo
        ? '<p><strong>Anote esse código.</strong> É ele que devolve as suas leituras se você ' +
          'trocar de celular ou limpar o navegador.</p>'
        : '<p>Guarde esse código: é ele que devolve as suas leituras em outro aparelho.</p>') +
      (op.recibo ? '<p><a href="' + esc(op.recibo) + '" target="_blank" rel="noopener">Ver o recibo</a></p>' : '') +
      '<button class="btn btn--go btn--peq" type="button" data-guardar-codigo>' +
      (temCompartilhar() ? 'Guardar meu código' : 'Copiar meu código') + '</button>' +
      '<p class="msg" data-msg-guardar hidden></p>' +
      '<button class="btn btn--linha btn--peq" type="button" data-trocar-codigo>Usar outro código</button>' +
      '<p class="socorro"><a href="' + linkSocorro() + '" target="_blank" rel="noopener">' +
      'Perdeu um código de outra compra?</a></p>' +
      '</div>';

    chamarCreditos({ acao: "saldo", codigo: cod }).then(function (res) {
      var el = box.querySelector("[data-saldo]");
      if (!el) return;
      if (res.body.ok) {
        el.textContent = res.body.restam > 0
          ? "Restam " + res.body.restam + " de " + res.body.total + " leituras."
          : "Suas leituras acabaram. Você pode comprar outro pacote quando quiser.";
        if (!res.body.restam) {
          el.insertAdjacentHTML("afterend",
            '<a class="btn btn--go btn--peq" href="' + LINK_COMPRA + '" target="_blank" rel="noopener">' +
            'Comprar mais ' + PACOTE_LEITURAS + ' leituras</a>');
        }
      } else {
        el.textContent = "Não encontrei esse código.";
      }
    }).catch(function () {
      var el = box.querySelector("[data-saldo]");
      if (el) el.textContent = "Não consegui conferir o saldo agora.";
    });
  }

  document.addEventListener("submit", function (e) {
    var f = e.target.closest("[data-codigo-form]");
    if (!f) return;
    e.preventDefault();
    var msg = f.querySelector("[data-msg-codigo]");
    var cod = f.codigo.value.trim().toUpperCase();
    msg.hidden = true;

    chamarCreditos({ acao: "saldo", codigo: cod }).then(function (res) {
      if (res.body.ok) {
        guardarCodigo(cod);
        pintarCreditos();
        return;
      }
      msg.hidden = false;
      msg.className = "msg msg--erro";
      msg.textContent = "Não encontrei esse código. Confira as letras — ele tem o formato XXXX-XXXX.";
    }).catch(function () {
      msg.hidden = false;
      msg.className = "msg msg--erro";
      msg.textContent = "Sem conexão para conferir agora.";
    });
  });

  /* Guardar o código fora do navegador. O saldo vive no servidor, então o
     código é a única coisa que a pessoa precisa não perder: no celular
     abrimos o compartilhar do sistema (ela manda pro próprio WhatsApp ou
     salva nas notas); no desktop, cópia para a área de transferência. */
  function temCompartilhar() {
    return typeof navigator !== "undefined" && typeof navigator.share === "function";
  }

  function copiarTexto(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt);
    }
    // Safari antigo / contexto sem clipboard API
    return new Promise(function (ok, falha) {
      try {
        var ta = document.createElement("textarea");
        ta.value = txt;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var deu = document.execCommand("copy");
        document.body.removeChild(ta);
        deu ? ok() : falha();
      } catch (err) { falha(err); }
    });
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest("[data-guardar-codigo]")) return;
    var cod = codigoGuardado();
    if (!cod) return;
    var msg = $("[data-msg-guardar]");
    var texto = "Meu código de leituras do app No mercado com a Nutri Ana: " + cod +
      "\nUse em " + location.origin + location.pathname;

    function aviso(txt, erro) {
      if (!msg) return;
      msg.hidden = false;
      msg.className = "msg" + (erro ? " msg--erro" : " msg--ok");
      msg.textContent = txt;
    }

    if (temCompartilhar()) {
      navigator.share({ title: "Meu código de leituras", text: texto })
        .then(function () { aviso("Pronto — guarde essa mensagem."); })
        .catch(function () { /* ela cancelou; nada a dizer */ });
      return;
    }
    copiarTexto(texto)
      .then(function () { aviso("Código copiado. Cole onde não se perca."); })
      .catch(function () { aviso("Não consegui copiar — anote o código acima.", true); });
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest("[data-trocar-codigo]")) return;
    esquecerCodigo();
    pintarCreditos();
  });

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

  /* A comida de verdade, pela TACO.
     Só compara o nutriente que EXISTE nos dois lados: célula vazia da TACO
     quer dizer "não analisado", e mostrar isso como zero seria o mesmo erro
     que o app já corrigiu no ranking da Open Food Facts. */
  function referenciaHTML(t) {
    var r = t && t.referencia;
    if (!r || !r.por_100g) return "";
    var p = (t && t.por_100g) || {};

    var campos = [
      ["kcal", "kcal", "kcal", ""],
      ["Açúcar", "acucar_g", null, "g"],       // a TACO não tem açúcar em campo próprio
      ["Gord. sat.", "sat_g", "sat_g", "g"],
      ["Sódio", "sodio_mg", "sodio_mg", "mg"],
      ["Fibra", "fibra_g", "fibra_g", "g"]
    ].filter(function (c) {
      return c[2] && p[c[1]] != null && r.por_100g[c[2]] != null;
    });
    if (!campos.length) return "";

    return '<div class="bloco"><p class="bloco__t">A comida de verdade</p>' +
      '<p class="tacos__intro">O mesmo peso, 100 g, de <strong>' + esc(r.nome) + '</strong>:</p>' +
      // nome inteiro no cabecalho: cortar na virgula transformava
      // "Pao, trigo, frances" em "Pao", que nao diz com o que se compara
      '<table class="tacos"><thead><tr><th></th><th>Este produto</th><th>' +
        esc(r.nome) + '</th></tr></thead><tbody>' +
      campos.map(function (c) {
        return '<tr><th>' + esc(c[0]) + '</th>' +
          '<td>' + esc(p[c[1]]) + esc(c[3]) + '</td>' +
          '<td>' + esc(r.por_100g[c[2]]) + esc(c[3]) + '</td></tr>';
      }).join("") +
      '</tbody></table>' +
      '<p class="nums__nota">Coluna da direita: ' + esc(r.fonte) + '. É tabela de alimento ' +
      'de verdade — não tem marca, e por isso serve de régua, não de sugestão de compra.</p></div>';
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

    /* Troca por comida (ver TROCA_DA_NUTRI). Fora do "boa" de propósito. */
    var t = a.veredito !== "boa" ? TROCA_DA_NUTRI[a.categoria_tag] : null;
    var troca = t
      ? '<div class="bloco troca"><p class="bloco__t">A dica da Ana</p>' +
        '<p class="troca__t">' + esc(t.texto) + '</p>' +
        (t.dica ? '<p class="troca__d">🌸 ' + esc(t.dica) + '</p>' : '') +
        '</div>'
      : '';

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
        referenciaHTML(a.tabela) +

        /* O que está bom vem ANTES do que pesa contra. A pessoa está
           decidindo uma compra, não sendo avaliada — começar pela cobrança
           faz ela fechar o app. */
        (destaques ? '<div class="bloco"><p class="bloco__t">A favor</p><ul class="lista lista--bom">' + destaques + '</ul></div>' : '') +
        (alertas ? '<div class="bloco"><p class="bloco__t">Contra</p><ul class="lista lista--ruim">' + alertas + '</ul></div>' : '') +

        (ingr ? '<div class="bloco"><p class="bloco__t">O que esses nomes querem dizer</p>' + ingr + '</div>' : '') +

        troca +

        (alts
          ? '<div class="bloco"><p class="bloco__t">Se quiser trocar, olhe estas</p>' + alts + '</div>'
          : (b.sem_alternativa
              ? '<div class="bloco"><p class="bloco__t">E as alternativas?</p><p class="alt__pq">' +
                esc(b.sem_alternativa) + '</p></div>'
              : '')) +

        /* Botar na lista sai daqui de dentro porque é aqui que a decisão é
           tomada. Aparece em qualquer veredito: se ela vai levar mesmo assim,
           é melhor que leve com a tarja do que sem. */
        '<button class="btn btn--linha btn--peq" type="button" data-lista-add ' +
          'data-nome="' + esc(a.produto || "Produto") + '" ' +
          'data-marca="' + esc(a.marca || "") + '" ' +
          'data-veredito="' + esc(a.veredito || "") + '">Botar na lista de mercado</button>' +

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

  function guardarNoHistorico(a, tabela) {
    var h = ler(CHAVE_HIST, []);
    if (!Array.isArray(h)) h = [];
    h.unshift({
      produto: a.produto, marca: a.marca, veredito: a.veredito,
      criado_em: a.criado_em, dados: a,
      // A tabela por 100 g fica gravada junto: sem ela, reabrir uma leitura
      // antiga perdia os números, e o comparador não teria o que comparar.
      tabela: tabela || null
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
    $("[data-resultado]").innerHTML = resultadoHTML({ analise: x.dados, tabela: x.tabela, falta: [] });
    $("[data-resultado]").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- comparador ----------
     Duas leituras que já estão no aparelho, lado a lado, por 100 g. Não
     chama servidor e não debita crédito: os números já foram pagos quando
     cada rótulo foi lido, e cobrar de novo para somar 1 e 1 seria cobrar
     por conta de chegar.

     Só entra no comparador quem tem tabela por 100 g gravada — leitura
     antiga (antes desta versão) e leitura sem foto da tabela não têm
     número, e comparar sem número é chute. */

  var NUTRI = [
    { rot: "Calorias",      campo: "kcal",     un: " kcal", melhor: "menor" },
    { rot: "Açúcar",        campo: "acucar_g", un: " g",    melhor: "menor" },
    { rot: "Gord. saturada", campo: "sat_g",   un: " g",    melhor: "menor" },
    { rot: "Sódio",         campo: "sodio_mg", un: " mg",   melhor: "menor" },
    { rot: "Fibra",         campo: "fibra_g",  un: " g",    melhor: "maior" }
  ];

  // Diferença menor que 5% é ruído: rótulo é declarado com arredondamento e
  // a própria lei aceita margem. Abaixo disso a resposta honesta é "igual".
  var MARGEM = 0.05;

  /* Cada lado é um objeto já normalizado — de onde ele veio deixa de
     importar depois da escolha:
       { nome, marca, veredito, fonte: "leitura"|"taco", por_100g } */
  var cmpEscolha = [null, null];
  var cmpAlvo = 0;                 // qual slot a folha está preenchendo
  var cmpBuscaT = null;            // timer do "digitou e parou"

  function num(v) {
    if (v == null || v === "") return null;
    var n = parseFloat(String(v).replace(",", "."));
    return isNaN(n) ? null : n;
  }

  function fmt(n) {
    var s = (Math.round(n * 10) / 10).toFixed(1).replace(".", ",");
    return s.replace(",0", "");
  }

  function cmpHistorico() {
    var h = ler(CHAVE_HIST, []);
    if (!Array.isArray(h)) return [];
    return h.map(function (x, i) { return { i: i, x: x }; })
      .filter(function (e) { return e.x && e.x.tabela && e.x.tabela.por_100g; });
  }

  // De leitura guardada para o formato do comparador.
  function daLeitura(x) {
    return {
      nome: x.produto || "Produto", marca: x.marca || "",
      veredito: x.veredito || "atencao", fonte: "leitura",
      por_100g: x.tabela.por_100g
    };
  }

  /* Da TACO. A TACO não tem campo de açúcar (a 4ª edição não analisou açúcar
     separado do carboidrato total), então essa linha simplesmente não entra
     na comparação — inventar zero ali seria dizer que a comida de verdade
     não tem açúcar nenhum. */
  function daTaco(t) {
    return {
      nome: t.nome, marca: "TACO · referência",
      veredito: null, fonte: "taco",
      por_100g: { kcal: t.kcal, sat_g: t.sat_g, sodio_mg: t.sodio_mg, fibra_g: t.fibra }
    };
  }

  function pintarCmpSlots() {
    [0, 1].forEach(function (s) {
      var el = document.querySelector('[data-cmp="' + s + '"]');
      if (!el) return;
      var x = cmpEscolha[s];
      el.classList.toggle("tem", !!x);
      el.innerHTML = x
        ? '<strong class="cmp-slot__t">' + esc(x.nome) + '</strong>' +
          '<span class="cmp-slot__m">' + esc(x.marca) + '</span>' +
          '<span class="cmp-slot__tr">trocar</span>'
        : '<span class="cmp-slot__mais">+</span>' +
          '<span class="cmp-slot__m">Produto ' + (s + 1) + '</span>';
    });
  }

  function cmpLinhas(ta, tb) {
    var pa = ta.por_100g || {}, pb = tb.por_100g || {};
    return NUTRI.map(function (n) {
      var a = num(pa[n.campo]), b = num(pb[n.campo]);
      if (a == null || b == null) return null;
      var maior = Math.max(Math.abs(a), Math.abs(b));
      var ganha = 0;   // 0 = empate, 1 = produto 1, 2 = produto 2
      if (maior > 0 && Math.abs(a - b) / maior >= MARGEM) {
        if (n.melhor === "menor") ganha = a < b ? 1 : 2;
        else ganha = a > b ? 1 : 2;
      }
      return { n: n, a: a, b: b, ganha: ganha };
    }).filter(Boolean);
  }

  /* O fecho é aritmética declarada, não opinião clínica: diz quantos itens
     cada um ganhou e manda olhar a lista de ingredientes, que é onde mora o
     que a tabela não conta. Frase de nutricionista neste app é sempre fixa. */
  function cmpFecho(linhas, xa, xb) {
    var a = 0, b = 0;
    linhas.forEach(function (l) { if (l.ganha === 1) a++; else if (l.ganha === 2) b++; });
    var total = linhas.length;

    /* Item da TACO num dos lados não é sugestão de compra: ele é a RÉGUA.
       E cuidado com a palavra "alimento": a TACO tem biscoito recheado e
       macarrão instantâneo também. Dizer "do outro lado está a comida de
       verdade" seria mentira em boa parte das buscas — a frase fala em
       referência, que é o que a TACO de fato é. */
    if (xa.fonte === "taco" || xb.fonte === "taco") {
      var alim = xa.fonte === "taco" ? xa : xb;
      var prod = xa.fonte === "taco" ? xb : xa;
      var pAlim = xa.fonte === "taco" ? 1 : 2;
      var venceProd = (pAlim === 1 ? b : a) > (pAlim === 1 ? a : b);
      return "Do outro lado não está uma marca concorrente: é " + alim.nome +
        ", pela TACO — a tabela oficial brasileira, que mede o alimento sem marca. " +
        (venceProd
          ? "Em número, " + prod.nome + " até leva vantagem em alguns itens. Isso é bom sinal, " +
            "mas não decide sozinho: a TACO não mostra lista de ingredientes nem aditivo."
          : "É essa a distância entre " + prod.nome + " e a referência.");
    }

    if (a === b) {
      return "Pelos números, os dois se equivalem — ganham e perdem nos mesmos itens. " +
        "Aqui quem decide é a lista de ingredientes: prefira a mais curta e com nome de comida.";
    }
    var vence = a > b ? xa.nome : xb.nome;
    var q = Math.max(a, b);
    return "Pelos números, " + vence + " leva vantagem: ganha em " + q + " de " + total +
      " itens comparados. Ainda assim, olhe a lista de ingredientes dos dois — a tabela não " +
      "mostra açúcar dividido em vários nomes nem fila de aditivos.";
  }

  function pintarComparacao() {
    var caixa = $("[data-cmp-res]");
    if (!caixa) return;

    if (!cmpHistorico().length && !cmpEscolha[0] && !cmpEscolha[1]) {
      caixa.innerHTML = '<div class="cartao cartao--convite">' +
        '<h2 class="sec">Leia um rótulo primeiro</h2>' +
        '<p>O comparador usa os números das suas próprias leituras. Depois de ler um rótulo, ' +
        'você compara com outro que já leu — ou com a referência da tabela TACO.</p>' +
        '<button class="btn btn--linha btn--peq" type="button" data-ir="ler">Ler um rótulo</button></div>';
      return;
    }
    if (!cmpEscolha[0] || !cmpEscolha[1]) { caixa.innerHTML = ""; return; }

    var xa = cmpEscolha[0], xb = cmpEscolha[1];
    var linhas = cmpLinhas(xa, xb);

    /* Com a TACO de um dos lados o ✓ sai de cena: ali não há disputa de
       prateleira, e um ✓ verde no alimento (ou pior, no produto) leria como
       "leve este". A coluna da TACO é régua, não sugestão de compra. */
    var regua = xa.fonte === "taco" || xb.fonte === "taco";
    var fecho = linhas.length ? cmpFecho(linhas, xa, xb) : "";
    if (regua) linhas.forEach(function (l) { l.ganha = 0; });

    if (!linhas.length) {
      caixa.innerHTML = '<div class="cartao"><p>Esses dois não têm nenhum nutriente em comum na ' +
        'tabela lida — não dá para comparar sem inventar número.</p></div>';
      return;
    }

    caixa.innerHTML = '<div class="cartao">' +
      '<div class="bloco"><p class="bloco__t">Por 100 g</p>' +
      '<table class="cmp"><thead><tr>' +
        '<th></th>' +
        '<th class="cmp--' + esc(xa.veredito || "regua") + '">' + esc(xa.nome) + '</th>' +
        '<th class="cmp--' + esc(xb.veredito || "regua") + '">' + esc(xb.nome) + '</th>' +
      '</tr></thead><tbody>' +
      linhas.map(function (l) {
        return '<tr><th>' + esc(l.n.rot) + '</th>' +
          '<td class="' + (l.ganha === 1 ? "vence" : "") + '">' + fmt(l.a) + esc(l.n.un) +
            (l.ganha === 1 ? ' <span class="cmp__ok">✓</span>' : '') + '</td>' +
          '<td class="' + (l.ganha === 2 ? "vence" : "") + '">' + fmt(l.b) + esc(l.n.un) +
            (l.ganha === 2 ? ' <span class="cmp__ok">✓</span>' : '') + '</td></tr>';
      }).join("") +
      '</tbody></table>' +
      '<p class="nums__nota">' +
      (regua
        ? 'A TACO — Tabela Brasileira de Composição de Alimentos, 4ª ed. (NEPA/Unicamp) — não ' +
          'analisou o açúcar separado do carboidrato, por isso essa linha fica de fora. Aqui não ' +
          'há vencedor marcado: a TACO entra como régua, não como sugestão de compra.'
        : 'O ✓ marca quem está melhor naquele item: menos calorias, açúcar, gordura saturada e ' +
          'sódio; mais fibra. Diferença abaixo de 5% conta como empate, porque o rótulo já é ' +
          'declarado com arredondamento.') +
      '</p></div>' +
      '<div class="bloco troca"><p class="bloco__t">A leitura da Ana</p>' +
      '<p class="troca__t">' + esc(fecho) + '</p></div>' +
      '</div>';
  }

  function pintarCmpLeituras() {
    var lista = $("[data-cmp-lista]");
    var outro = cmpEscolha[cmpAlvo === 0 ? 1 : 0];
    var disp = cmpHistorico().filter(function (e) {
      return !(outro && outro.fonte === "leitura" && outro.nome === (e.x.produto || "Produto") &&
               outro.marca === (e.x.marca || ""));
    });

    lista.innerHTML = disp.length
      ? disp.map(function (e) {
          return '<button class="hist hist--' + esc(e.x.veredito || "atencao") + '" type="button" ' +
            'data-cmp-pick="' + e.i + '">' +
            '<span class="hist__p"></span><span>' +
            '<strong class="hist__t">' + esc(e.x.produto || "Produto") + '</strong>' +
            '<span class="hist__d">' + esc([e.x.marca, dataBR(e.x.criado_em)].filter(Boolean).join(" · ")) + '</span>' +
            '</span></button>';
        }).join("")
      : '<p class="dica">Nenhuma outra leitura com tabela nutricional guardada. ' +
        'Use a busca acima para comparar com o alimento de verdade.</p>';
  }

  /* Busca na TACO. A tabela é pública (leitura liberada para todos), então a
     consulta sai direto daqui — sem edge function no meio, sem crédito, e
     falha silenciosa vira recado, porque no mercado o sinal cai mesmo. */
  function buscarTaco(termo) {
    var lista = $("[data-cmp-lista]");
    if (!window.NutriDBReady) {
      lista.innerHTML = '<p class="dica">Sem conexão com a base agora. Suas leituras continuam ' +
        'disponíveis — apague a busca para vê-las.</p>';
      return;
    }
    lista.innerHTML = '<p class="dica">Procurando…</p>';
    window.NutriDBReady.then(function (c) {
      return c.from("taco_alimentos")
        .select("id,nome,grupo,kcal,fibra,sodio_mg,sat_g")
        .ilike("busca", "%" + termo.toLowerCase() + "%")
        .order("nome")
        .limit(15);
    }).then(function (r) {
      if (r.error) throw r.error;
      var itens = r.data || [];
      if (!itens.length) {
        lista.innerHTML = '<p class="dica">Não achei esse alimento na TACO. Tente o nome mais ' +
          'simples: "arroz", "feijão", "pão".</p>';
        return;
      }
      cmpTaco = itens;
      lista.innerHTML = itens.map(function (t, i) {
        return '<button class="hist hist--taco" type="button" data-cmp-taco="' + i + '">' +
          '<span class="hist__p"></span><span>' +
          '<strong class="hist__t">' + esc(t.nome) + '</strong>' +
          '<span class="hist__d">' + esc(t.grupo) + ' · TACO</span>' +
          '</span></button>';
      }).join("");
    }).catch(function () {
      lista.innerHTML = '<p class="dica">Não consegui buscar agora — o sinal aqui pode estar ruim. ' +
        'Apague a busca para ver as suas leituras.</p>';
    });
  }

  var cmpTaco = [];   // resultado da última busca, para o clique achar de novo

  function abrirCmpFolha(slot) {
    cmpAlvo = slot;
    var busca = $("[data-cmp-busca]");
    if (busca) busca.value = "";
    pintarCmpLeituras();
    $("[data-cmp-folha]").hidden = false;
    document.body.classList.add("travado");
  }

  function fecharCmpFolha() {
    $("[data-cmp-folha]").hidden = true;
    document.body.classList.remove("travado");
  }

  function escolherNoCmp(item) {
    cmpEscolha[cmpAlvo] = item;
    fecharCmpFolha();
    pintarCmpSlots();
    pintarComparacao();
  }

  // "Digitou e parou": buscar a cada tecla castigaria justamente quem está
  // com sinal ruim no corredor do mercado.
  var campoBusca = $("[data-cmp-busca]");
  if (campoBusca) {
    campoBusca.addEventListener("input", function () {
      var termo = campoBusca.value.trim();
      clearTimeout(cmpBuscaT);
      if (termo.length < 3) { pintarCmpLeituras(); return; }
      cmpBuscaT = setTimeout(function () { buscarTaco(termo); }, 350);
    });
  }

  document.addEventListener("click", function (e) {
    var slot = e.target.closest("[data-cmp]");
    if (slot) { abrirCmpFolha(Number(slot.getAttribute("data-cmp"))); return; }

    var pick = e.target.closest("[data-cmp-pick]");
    if (pick) {
      var h = ler(CHAVE_HIST, []);
      var x = h[Number(pick.getAttribute("data-cmp-pick"))];
      if (x && x.tabela) escolherNoCmp(daLeitura(x));
      return;
    }

    var pt = e.target.closest("[data-cmp-taco]");
    if (pt) {
      var t = cmpTaco[Number(pt.getAttribute("data-cmp-taco"))];
      if (t) escolherNoCmp(daTaco(t));
      return;
    }

    if (e.target.closest("[data-cmp-fechar]")) fecharCmpFolha();
  });

  /* ---------- lista de mercado ----------
     No aparelho, como o histórico: quem anota o que falta comprar não deveria
     precisar de conta para isso, e a lista tem que abrir com o sinal caindo no
     corredor.

     O que ela tem a mais que um papel é a TARJA: item trazido de uma leitura
     guarda o veredito daquele rótulo, então na hora de pegar na prateleira a
     pessoa vê de novo o que o rótulo dizia. Item digitado à mão não tem tarja
     nenhuma — o app não sabe nada sobre ele e não vai fingir que sabe.

     Não existe "compras finalizadas": o app não tem como saber o que de fato
     foi para o carrinho, e essa tela viveria vazia. */

  var CHAVE_LISTA = "mercado.lista";

  function lerLista() {
    var l = ler(CHAVE_LISTA, []);
    return Array.isArray(l) ? l : [];
  }

  function gravarLista(l) { gravar(CHAVE_LISTA, l); pintarLista(); }

  function mesmoItem(x, nome, marca) {
    return (x.nome || "").toLowerCase() === String(nome || "").toLowerCase().trim() &&
           (x.marca || "").toLowerCase() === String(marca || "").toLowerCase().trim();
  }

  function recadoLista(txt) {
    var m = $("[data-lista-msg]");
    if (!m) return;
    m.hidden = false;
    m.className = "msg";
    m.textContent = txt;
    clearTimeout(recadoLista.t);
    recadoLista.t = setTimeout(function () { m.hidden = true; }, 3000);
  }

  /* Devolve false quando o item já estava lá e pendente — quem chamou avisa em
     vez de deixar a mesma coisa duas vezes na lista. */
  function addItem(nome, marca, veredito) {
    nome = String(nome || "").trim();
    if (!nome) return false;
    var l = lerLista();
    var j = -1;
    l.forEach(function (x, i) { if (mesmoItem(x, nome, marca)) j = i; });
    if (j >= 0) {
      if (!l[j].feito) return false;
      // Já estava, mas marcado como comprado: pedir de novo é dizer que
      // precisa outra vez — volta para os pendentes.
      l[j].feito = false;
      gravarLista(l);
      return true;
    }
    l.push({
      id: uuid(), nome: nome, marca: String(marca || "").trim(),
      veredito: veredito || null, feito: false, criado_em: new Date().toISOString()
    });
    gravarLista(l);
    return true;
  }

  function itemHTML(x) {
    return '<div class="item' + (x.veredito ? " item--" + esc(x.veredito) : "") +
        (x.feito ? " is-feito" : "") + '">' +
      '<button class="item__ok" type="button" data-lista-ok="' + esc(x.id) + '" ' +
        'aria-pressed="' + (x.feito ? "true" : "false") + '" ' +
        'aria-label="' + (x.feito ? "Tirar do carrinho" : "Marcar como pego") + '">' +
        (x.feito ? "✓" : "") + '</button>' +
      '<span class="item__c"><strong class="item__t">' + esc(x.nome) + '</strong>' +
        (x.marca ? '<span class="item__d">' + esc(x.marca) + '</span>' : '') + '</span>' +
      '<button class="item__x" type="button" data-lista-x="' + esc(x.id) + '" ' +
        'aria-label="Tirar da lista">×</button>' +
      '</div>';
  }

  function pintarLista() {
    var caixa = $("[data-lista-res]");
    if (!caixa) return;

    var l = lerLista();
    if (!l.length) {
      caixa.innerHTML = '<div class="cartao cartao--convite">' +
        '<h2 class="sec">Sua lista está vazia</h2>' +
        '<p>Escreva aí em cima o que falta comprar — ou traga um produto de um rótulo que você ' +
        'já leu, para levar o veredito junto até a prateleira.</p>' +
        '<button class="btn btn--linha btn--peq" type="button" data-ir="ler">Ler um rótulo</button>' +
        '</div>';
      return;
    }

    var falta = l.filter(function (x) { return !x.feito; });
    var feitos = l.filter(function (x) { return x.feito; });

    caixa.innerHTML =
      '<p class="lista-cont">' + feitos.length + ' de ' + l.length + ' já no carrinho</p>' +
      (falta.length
        ? falta.map(itemHTML).join("")
        : '<p class="dica">Tudo o que você anotou já está no carrinho. 🌸</p>') +
      (feitos.length
        ? '<p class="sec sec--peq">Já no carrinho</p>' + feitos.map(itemHTML).join("") +
          '<button class="btn btn--linha btn--peq" type="button" data-lista-limpar>' +
          'Tirar os comprados da lista</button>'
        : '');
  }

  /* A folha lista TODAS as leituras guardadas — diferente do comparador, aqui
     não é preciso ter tabela por 100 g: não há número para contar, só o nome
     do produto e a tarja. */
  function pintarListaHist() {
    var caixa = $("[data-lista-hist]");
    if (!caixa) return;
    var h = ler(CHAVE_HIST, []);
    if (!Array.isArray(h) || !h.length) {
      caixa.innerHTML = '<p class="dica">Você ainda não leu nenhum rótulo. Assim que ler, ' +
        'os produtos aparecem aqui para entrar na lista com um toque.</p>';
      return;
    }
    caixa.innerHTML = h.map(function (x, i) {
      return '<button class="hist hist--' + esc(x.veredito || "atencao") + '" type="button" ' +
        'data-lista-pick="' + i + '">' +
        '<span class="hist__p"></span><span>' +
        '<strong class="hist__t">' + esc(x.produto || "Produto") + '</strong>' +
        '<span class="hist__d">' + esc([x.marca, dataBR(x.criado_em)].filter(Boolean).join(" · ")) + '</span>' +
        '</span></button>';
    }).join("");
  }

  function abrirListaFolha() {
    pintarListaHist();
    $("[data-lista-folha]").hidden = false;
    document.body.classList.add("travado");
  }
  function fecharListaFolha() {
    $("[data-lista-folha]").hidden = true;
    document.body.classList.remove("travado");
  }

  var formLista = $("[data-lista-form]");
  if (formLista) {
    formLista.addEventListener("submit", function (e) {
      e.preventDefault();
      var campo = $("[data-lista-campo]");
      var nome = campo.value;
      if (!nome.trim()) return;
      if (!addItem(nome, "", null)) recadoLista("“" + nome.trim() + "” já está na sua lista.");
      campo.value = "";
      campo.focus();
    });
  }

  document.addEventListener("click", function (e) {
    var ok = e.target.closest("[data-lista-ok]");
    if (ok) {
      var id = ok.getAttribute("data-lista-ok");
      var l = lerLista();
      l.forEach(function (x) { if (x.id === id) x.feito = !x.feito; });
      gravarLista(l);
      return;
    }

    var rem = e.target.closest("[data-lista-x]");
    if (rem) {
      var idr = rem.getAttribute("data-lista-x");
      gravarLista(lerLista().filter(function (x) { return x.id !== idr; }));
      return;
    }

    if (e.target.closest("[data-lista-limpar]")) {
      gravarLista(lerLista().filter(function (x) { return !x.feito; }));
      return;
    }

    if (e.target.closest("[data-lista-abrir]")) { abrirListaFolha(); return; }
    if (e.target.closest("[data-lista-fechar]")) { fecharListaFolha(); return; }

    var pick = e.target.closest("[data-lista-pick]");
    if (pick) {
      var h = ler(CHAVE_HIST, []);
      var x = h[Number(pick.getAttribute("data-lista-pick"))];
      if (x) {
        var novo = addItem(x.produto || "Produto", x.marca || "", x.veredito || null);
        fecharListaFolha();
        if (!novo) recadoLista("Esse produto já está na sua lista.");
      }
      return;
    }

    /* Botão que sai dentro do resultado da leitura. Vale para qualquer
       veredito, inclusive "eu deixaria na prateleira": a decisão é dela, e a
       tarja vermelha vai junto para o corredor. */
    var add = e.target.closest("[data-lista-add]");
    if (add) {
      var entrou = addItem(add.getAttribute("data-nome"), add.getAttribute("data-marca"),
                           add.getAttribute("data-veredito"));
      add.disabled = true;
      add.textContent = entrou ? "Na sua lista ✓" : "Já estava na lista ✓";
      return;
    }
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

  /* No iPhone não existe `beforeinstallprompt`: a Apple não deixa site nenhum
     oferecer instalação, só o menu Compartilhar do Safari resolve. Como
     ninguém adivinha isso, o passo a passo aparece na tela principal — mas só
     para quem está no iOS, fora do app já instalado, e some quando a pessoa
     fecha ou instala. */
  (function conviteIOS() {
    var el = $("[data-ios-instalar]");
    if (!el) return;

    var ua = navigator.userAgent || "";
    // iPad com iPadOS 13+ se anuncia como Mac; o toque é o que o denuncia.
    var ehIOS = /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    // `standalone` é a bandeira do próprio iOS; o media query cobre o resto.
    var jaInstalado = navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

    var CHAVE = "mercado_convite_ios";
    if (!ehIOS || jaInstalado || localStorage.getItem(CHAVE) === "fechado") return;

    el.hidden = false;
    el.querySelector("[data-ios-fechar]").addEventListener("click", function () {
      el.hidden = true;
      try { localStorage.setItem(CHAVE, "fechado"); } catch (e) { /* modo privado */ }
    });
  }());

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
  pintarCmpSlots();
  pintarComparacao();
  pintarLista();
  pintarConta();
  pintarCreditos();
  resgatarDaURL();
})();
