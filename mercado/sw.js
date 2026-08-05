/* =========================================================
   Service worker do app "No mercado com a Nutri Ana".

   O que ele resolve: sinal de celular dentro de supermercado é
   ruim — laje, freezer, corredor no subsolo. Sem cache, o app
   simplesmente não abriria no exato lugar onde é usado.

   Estratégia: os arquivos do app ficam em cache e são servidos
   dali primeiro (a casca abre instantânea, mesmo sem rede). A
   ANÁLISE em si continua exigindo internet — e é isso mesmo: a
   leitura do rótulo é feita no servidor.

   NÃO intercepta nada da Supabase nem requisição que não seja GET:
   respostas de API e de autenticação em cache dariam resultado
   velho, que num app de rótulo é pior que erro de rede.

   Ao mudar qualquer arquivo do app, incremente CACHE.
   ========================================================= */
var CACHE = "mercado-v5";

var ARQUIVOS = [
  "./",
  "index.html",
  "mercado.css",
  "mercado.js",
  "manifest.webmanifest",
  "icones/icon-192.png",
  "icones/icon-512.png",
  "../assets/img/monograma.png",
  "../assets/fonts/Merienda.ttf"
];

self.addEventListener("install", function (e) {
  // addAll falha inteiro se um arquivo faltar; aqui cada um é opcional
  // para uma fonte ausente não impedir a instalação do app todo.
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ARQUIVOS.map(function (u) {
        return c.add(u).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        return n === CACHE ? null : caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.hostname.indexOf("supabase.co") !== -1) return;   // API e login: sempre ao vivo
  if (url.origin !== self.location.origin) return;          // fontes do Google etc.

  // Navegação: rede primeiro (para pegar versão nova), cache como rede de
  // segurança quando o sinal cai no meio do mercado.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match("index.html").then(function (r) { return r || caches.match("./"); });
      })
    );
    return;
  }

  // Estáticos: cache primeiro, é o que faz abrir instantâneo.
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (resp) {
        if (resp && resp.ok) {
          var copia = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return resp;
      });
    })
  );
});
