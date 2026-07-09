/* =========================================================
   Nutri Ana Luísa Rocha — configuração e interações
   ========================================================= */

/* ===== EDITE AQUI ===== */
const CONFIG = {
  WHATS: "5521994094557",
  INSTA: "https://www.instagram.com/nutrianaluisarocha",
  EMAIL: "nutrianalrocha@gmail.com",
  LOCAL: "",   // link do Google Maps do consultório (opcional; some se vazio)
};

/* Mensagens pré-preenchidas de cada ação (WhatsApp) */
const MSG = {
  agendar:  "Olá, Ana! Gostaria de agendar uma consulta 🌸",
  presencial:"Olá, Ana! Quero agendar uma consulta presencial 🌸",
  online:   "Olá, Ana! Quero agendar uma consulta online 🌸",
  acompanhamento:"Olá, Ana! Tenho interesse no acompanhamento nutricional 🌸",
  vip:      (nome) => `Oi, Ana! ${nome ? nome + ", " : ""}quero entrar na Comunidade VIP e receber os conteúdos gratuitos 🌸`,
  ebook:    (titulo) => `Olá, Ana! Tenho interesse no e-book "${titulo}" 🌸`,
  comprar:  (titulo) => `Olá, Ana! Quero desbloquear o e-book "${titulo}". Como faço o pagamento? 🌸`,
  assinar:  "Olá, Ana! Quero assinar o plano mensal de e-books e receber os novos lançamentos 🌸",
  contato:  "Olá, Ana! Vim pelo seu site e gostaria de falar com você 🌸",
};

/* Quando você criar o checkout na Kiwify/Hotmart, cole os links aqui.
   Se o link existir, o botão de compra usa ele; se ficar "", cai no WhatsApp. */
const CHECKOUT = {
  "Guia Completo das Canetas": "",   // ex.: "https://pay.kiwify.com.br/xxxxxxx"
  "Plano Mensal de E-books":   "",
};

/* Biblioteca de e-books (Plataforma Nutri): onde o cliente que JÁ comprou
   faz login e lê. Cole aqui a URL da tela de login da plataforma quando
   publicá-la. Enquanto vazio, os links "Acessar minha biblioteca" somem. */
const PLATAFORMA_URL = "https://nutrianarocha.github.io/Plataforma/prototipo/biblioteca.html";

const wa = (msg) => `https://wa.me/${CONFIG.WHATS}?text=${encodeURIComponent(msg)}`;

document.addEventListener("DOMContentLoaded", () => {

  /* ---- Preenche links de WhatsApp por data-attribute ----
     Uso no HTML: <a data-wa="agendar"> ou <a data-wa="ebook" data-titulo="..."> */
  document.querySelectorAll("[data-wa]").forEach(el => {
    const key = el.getAttribute("data-wa");
    const titulo = el.getAttribute("data-titulo") || "";

    // Compra/assinatura: se houver link de checkout cadastrado, usa ele; senão, WhatsApp.
    if ((key === "comprar" || key === "assinar") && CHECKOUT[titulo]) {
      el.href = CHECKOUT[titulo];
      el.target = "_blank"; el.rel = "noopener";
      return;
    }

    let text;
    if (key === "vip")        text = MSG.vip("");
    else if (key === "ebook") text = MSG.ebook(titulo);
    else if (key === "comprar") text = MSG.comprar(titulo);
    else text = MSG[key] || MSG.contato;
    el.href = wa(text);
    el.target = "_blank";
    el.rel = "noopener";
  });

  /* ---- Biblioteca de e-books (login da plataforma p/ quem já comprou) ----
     Uso: <a data-biblioteca>Acessar minha biblioteca</a>.
     Se PLATAFORMA_URL estiver vazio, o link é removido. */
  document.querySelectorAll("[data-biblioteca]").forEach(el => {
    if (PLATAFORMA_URL) { el.href = PLATAFORMA_URL; el.target = "_blank"; el.rel = "noopener"; }
    else { el.remove(); }
  });

  /* ---- Links diretos (Instagram / e-mail / localização) ---- */
  document.querySelectorAll("[data-insta]").forEach(el => { el.href = CONFIG.INSTA; el.target="_blank"; el.rel="noopener"; });
  document.querySelectorAll("[data-email]").forEach(el => { el.href = "mailto:" + CONFIG.EMAIL; });
  document.querySelectorAll("[data-local]").forEach(el => {
    if (CONFIG.LOCAL) { el.href = CONFIG.LOCAL; el.target="_blank"; el.rel="noopener"; }
    else { el.style.display = "none"; }
  });

  /* ---- Formulário VIP: nome (opcional) monta a mensagem ---- */
  const vipForm = document.getElementById("vip-form");
  if (vipForm) {
    const send = () => {
      const nome = (document.getElementById("vip-nome")?.value || "").trim();
      window.open(wa(MSG.vip(nome)), "_blank", "noopener");
    };
    vipForm.addEventListener("submit", (e) => { e.preventDefault(); send(); });
  }

  /* ---- Nav: fundo ao rolar ---- */
  const nav = document.querySelector(".nav");
  const onScroll = () => {
    if (window.scrollY > 40) nav.classList.add("nav-scrolled");
    else nav.classList.remove("nav-scrolled");
  };
  if (nav) { onScroll(); window.addEventListener("scroll", onScroll, { passive:true }); }

  /* ---- Menu mobile (hambúrguer) ---- */
  const toggle = document.querySelector(".nav-toggle");
  const links  = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
      links.classList.remove("open");
      toggle.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }));
  }

  /* ---- Reveal ao rolar (respeita prefers-reduced-motion) ---- */
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveals = document.querySelectorAll(".reveal");
  if (prefersReduced || !("IntersectionObserver" in window)) {
    reveals.forEach(el => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold:0.14, rootMargin:"0px 0px -40px 0px" });
    reveals.forEach(el => io.observe(el));
  }

  /* ---- Ano no rodapé ---- */
  document.querySelectorAll("[data-year]").forEach(el => el.textContent = new Date().getFullYear());
});
