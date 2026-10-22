// Aviso de cookies y Pixel de Meta.
// El Pixel SOLO se carga si el visitante acepta. Si rechaza o no responde, no se carga nada de Meta.
// Para cambiar de Pixel, cambia el número aquí. Para apagarlo del todo, deja PIXEL_META = "".
const PIXEL_META = "4635634140053926";

(() => {
  "use strict";
  const CLAVE = "ie-cookies", VERSION = 1;
  let decision = null; // "si" | "no" | null
  try { const g = JSON.parse(localStorage.getItem(CLAVE) || "null"); if (g && g.v === VERSION) decision = g.decision; } catch (e) {}
  let cargado = false;
  const cola = [];

  function cargarPixel() {
    if (cargado || !PIXEL_META) return;
    cargado = true;
    // Código base de Meta, escrito sin scripts en línea (la página no permite código en línea por seguridad)
    const f = (window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); });
    if (!window._fbq) window._fbq = f;
    f.push = f; f.loaded = true; f.version = "2.0"; f.queue = [];
    const s = document.createElement("script");
    s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
    window.fbq("init", PIXEL_META);
    window.fbq("track", "PageView");
    while (cola.length) window.fbq.apply(null, cola.shift());
  }

  // Eventos de la tienda. Si no hay permiso, se descartan (no se guardan).
  function evento(nombre, datos) {
    if (decision !== "si" || !PIXEL_META) return;
    const args = ["track", nombre, Object.assign({ currency: "COP" }, datos || {})];
    if (window.fbq && cargado) window.fbq.apply(null, args); else cola.push(args);
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
    aviso.className = "aviso-cookies";
    aviso.setAttribute("role", "dialog");
    aviso.setAttribute("aria-live", "polite");
    aviso.setAttribute("aria-label", "Aviso de cookies");
    aviso.innerHTML = `
      <p><strong>¿Nos permites medir tu visita?</strong> Usamos el Pixel de Meta (Facebook) para saber qué anuncios te trajeron y mostrar
      publicidad útil. Tu pedido funciona igual si dices que no. <a href="privacidad.html#cookies">Más información</a></p>
      <div class="aviso-cookies__botones">
        <button type="button" class="boton aviso-cookies__no" data-cookies="no">No, gracias</button>
        <button type="button" class="boton boton--azul" data-cookies="si">Aceptar</button>
      </div>`;
    aviso.addEventListener("click", (e) => { const b = e.target.closest("[data-cookies]"); if (b) guardar(b.dataset.cookies); });
    document.body.appendChild(aviso);
  }
  function cerrarAviso() { if (aviso) aviso.hidden = true; }

  window.Medicion = { evento, abrirAviso: mostrarAviso, decision: () => decision };

  document.addEventListener("DOMContentLoaded", () => {
    if (decision === "si") cargarPixel();
    else if (decision === null && PIXEL_META) setTimeout(mostrarAviso, 1500);
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-abrir-cookies]")) { e.preventDefault(); mostrarAviso(); }
      // Contacto por WhatsApp
      const a = e.target.closest('a[href*="wa.me/"]');
      if (a) evento("Contact", { content_name: "WhatsApp" });
    });
  });
})();
