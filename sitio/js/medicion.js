// Aviso de cookies y píxeles de publicidad (Meta y TikTok).
// Los píxeles SOLO se cargan si el visitante acepta. Si rechaza o no responde, no se carga nada de Meta ni de TikTok.
// Para apagar un píxel, deja su número vacío: "".
const PIXEL_META = "4635634140053926";
const PIXEL_TIKTOK = "DBDV8JBC77U4J2JQC9OG"; // TikTok Ads Manager → Herramientas → Eventos → Píxel web

(() => {
  "use strict";
  const CLAVE = "ie-cookies", VERSION = 1;
  let decision = null; // "si" | "no" | null
  try { const g = JSON.parse(localStorage.getItem(CLAVE) || "null"); if (g && g.v === VERSION) decision = g.decision; } catch (e) {}
  let cargado = false;
  const hayPixel = Boolean(PIXEL_META || PIXEL_TIKTOK);

  function cargarMeta() {
    // Código base de Meta, escrito sin scripts en línea (la página no permite código en línea por seguridad)
    const f = (window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); });
    if (!window._fbq) window._fbq = f;
    f.push = f; f.loaded = true; f.version = "2.0"; f.queue = [];
    const s = document.createElement("script");
    s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
    window.fbq("init", PIXEL_META);
    window.fbq("track", "PageView");
  }
  function cargarTikTok() {
    // Código base de TikTok (equivalente al oficial, sin scripts en línea)
    const metodos = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
    const ttq = (window.ttq = window.ttq || []);
    window.TiktokAnalyticsObject = "ttq";
    ttq.methods = metodos;
    ttq.setAndDefer = (o, m) => { o[m] = function () { o.push([m].concat(Array.prototype.slice.call(arguments, 0))); }; };
    metodos.forEach((m) => ttq.setAndDefer(ttq, m));
    ttq.instance = (id) => { const e = ttq._i[id] || []; metodos.forEach((m) => ttq.setAndDefer(e, m)); return e; };
    ttq.load = (id, opciones) => {
      const r = "https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._i = ttq._i || {}; ttq._i[id] = []; ttq._i[id]._u = r;
      ttq._t = ttq._t || {}; ttq._t[id] = +new Date();
      ttq._o = ttq._o || {}; ttq._o[id] = opciones || {};
      const s = document.createElement("script");
      s.async = true; s.src = `${r}?sdkid=${encodeURIComponent(id)}&lib=ttq`;
      document.head.appendChild(s);
    };
    ttq.load(PIXEL_TIKTOK);
    ttq.page();
  }
  function cargarPixel() {
    if (cargado || !hayPixel) return;
    cargado = true;
    if (PIXEL_META) cargarMeta();
    if (PIXEL_TIKTOK) cargarTikTok();
  }

  // Nombres de eventos en TikTok
  const TIKTOK = { ViewContent: "ViewContent", AddToCart: "AddToCart", InitiateCheckout: "InitiateCheckout", Purchase: "CompletePayment", Contact: "Contact", Schedule: "SubmitForm" };

  // Eventos de la tienda. Si no hay permiso, se descartan (no se guardan).
  function evento(nombre, datos) {
    if (decision !== "si" || !hayPixel) return;
    const d = Object.assign({ currency: "COP" }, datos || {});
    if (PIXEL_META && window.fbq) window.fbq("track", nombre, d);
    if (PIXEL_TIKTOK && window.ttq && TIKTOK[nombre]) {
      const t = { currency: d.currency };
      if (d.value !== undefined) t.value = d.value;
      if (d.content_ids) t.contents = d.content_ids.map((id) => ({ content_id: id, content_name: d.content_name || id }));
      window.ttq.track(TIKTOK[nombre], t);
    }
  }

  function guardar(d) {
    decision = d;
    try { localStorage.setItem(CLAVE, JSON.stringify({ v: VERSION, decision: d, fecha: new Date().toISOString() })); } catch (e) {}
    if (d === "si") cargarPixel();
    cerrarAviso();
    // Si ya se había cargado y ahora rechaza, se recarga la página para quitarlo
    if (d === "no" && cargado) location.reload();
  }

  let aviso = null;
  function mostrarAviso() {
    if (aviso) { aviso.hidden = false; return; }
    aviso = document.createElement("div");
    aviso.className = "aviso-medicion";
    aviso.setAttribute("role", "dialog");
    aviso.setAttribute("aria-live", "polite");
    aviso.setAttribute("aria-label", "Aviso de medición y privacidad");
    aviso.innerHTML = `
      <p><strong>¿Nos permites medir tu visita?</strong> Usamos ${PIXEL_TIKTOK ? "los píxeles de Meta (Facebook) y TikTok" : "el Pixel de Meta (Facebook)"} para saber qué anuncios te trajeron y mostrar
      publicidad útil. Tu pedido funciona igual si dices que no. <a href="privacidad.html#cookies">Más información sobre cookies</a></p>
      <div class="aviso-medicion__botones">
        <button type="button" class="boton aviso-medicion__no" data-eleccion="no">No, gracias</button>
        <button type="button" class="boton boton--azul" data-eleccion="si">Aceptar</button>
      </div>`;
    aviso.addEventListener("click", (e) => { const b = e.target.closest("[data-eleccion]"); if (b) guardar(b.dataset.eleccion); });
    document.body.appendChild(aviso);
  }
  function cerrarAviso() { if (aviso) aviso.hidden = true; }

  window.Medicion = { evento, abrirAviso: mostrarAviso, decision: () => decision };

  document.addEventListener("DOMContentLoaded", () => {
    if (decision === "si") cargarPixel();
    else if (decision === null && hayPixel) setTimeout(mostrarAviso, 1500);
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-abrir-cookies]")) { e.preventDefault(); mostrarAviso(); }
      // Contacto por WhatsApp
      const a = e.target.closest('a[href*="wa.me/"]');
      if (a) evento("Contact", { content_name: "WhatsApp" });
    });
  });
})();
