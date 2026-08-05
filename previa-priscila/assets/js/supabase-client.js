/* ============================================================
   SUPABASE CLIENT (sem build) — carrega a UMD do supabase-js pela CDN e expõe:
     window.SiteDB       -> client já criado (quando pronto)
     window.SiteDBReady  -> Promise que resolve com o client
   Inclua ANTES dos scripts que usam o banco (conta.js, biblioteca.js, painel.js).

   O projeto Supabase é exclusivo deste site: as leitoras cadastradas aqui não
   existem em nenhum outro projeto. É o isolamento que o contrato pede.
   ============================================================ */
(function () {
  "use strict";

  var SUPABASE_URL = "";
  var SUPABASE_ANON_KEY = "";
  var CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

  window.SiteDBReady = new Promise(function (resolve, reject) {
    function make() {
      try {
        window.SiteDB = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
        resolve(window.SiteDB);
      } catch (e) { reject(e); }
    }
    if (window.supabase && window.supabase.createClient) { make(); return; }
    var s = document.createElement("script");
    s.src = CDN;
    s.onload = make;
    s.onerror = function () { reject(new Error("Falha ao carregar supabase-js (offline?)")); };
    document.head.appendChild(s);
  });
})();
