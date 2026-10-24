// Galerías: fotos del taller, reseñas de clientes y preguntas frecuentes.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const escapar = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Fotos del taller: fotos/taller/1.jpg, 2.jpg ... ---------- */
  const probar = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(src); im.onerror = () => ok(null); im.src = src; });
  async function buscarFotos(carpeta, max = 12) {
    const nombre = carpeta.split("/").pop();
    if (window.FOTOS) return window.FOTOS[nombre] || [];
    const lista = [];
    for (let n = 1; n <= max; n++) {
      let f = null;
      for (const e of ["jpg", "png", "webp"]) { f = await probar(`${carpeta}/${n}.${e}`); if (f) break; }
      if (!f) break;
      lista.push(f);
    }
    return lista;
  }

  async function iniciarCarrusel(raiz, carpeta, descripcion) {
    if (!raiz) return;
    const fotos = await buscarFotos(carpeta);
    if (!fotos.length) { raiz.hidden = true; return; } // sin fotos no se muestra el carrusel
    const marco = $(".carrusel__marco", raiz), puntos = $(".carrusel__puntos", raiz);
    marco.innerHTML = `<div class="carrusel__pista">${fotos.map((f, i) =>
      `<img src="${f}" alt="${escapar(descripcion)} ${i + 1} de ${fotos.length}" ${i ? 'loading="lazy"' : ""} draggable="false">`).join("")}</div>`;
    const pista = $(".carrusel__pista", marco);
    let i = 0, temporizador = null;
    const ir = (n) => {
      i = (n + fotos.length) % fotos.length;
      pista.style.transform = `translateX(${-i * 100}%)`;
      $$("button", puntos).forEach((b, k) => b.setAttribute("aria-current", k === i ? "true" : "false"));
    };
    if (fotos.length > 1) {
      puntos.innerHTML = fotos.map((_, k) => `<button type="button" aria-label="Ver foto ${k + 1}"></button>`).join("");
      $$("button", puntos).forEach((b, k) => b.addEventListener("click", () => { ir(k); reiniciar(); }));
      $$(".carrusel__flecha", raiz).forEach((b) => { b.hidden = false; });
      $(".carrusel__flecha--izq", raiz).addEventListener("click", () => { ir(i - 1); reiniciar(); });
      $(".carrusel__flecha--der", raiz).addEventListener("click", () => { ir(i + 1); reiniciar(); });
      let x0 = null;
      marco.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
      marco.addEventListener("pointerup", (e) => {
        if (x0 === null) return;
        const dx = e.clientX - x0; x0 = null;
        if (Math.abs(dx) > 40) { ir(i + (dx < 0 ? 1 : -1)); reiniciar(); }
      });
      const parar = () => { clearInterval(temporizador); temporizador = null; };
      const reiniciar = () => { parar(); if (!reducido) temporizador = setInterval(() => { if (!document.hidden) ir(i + 1); }, 5000); };
      raiz.addEventListener("mouseenter", parar);
      raiz.addEventListener("mouseleave", reiniciar);
      raiz.addEventListener("focusin", parar);
      reiniciar();
    }
    ir(0);
  }
  iniciarCarrusel($("#carrusel-taller"), "fotos/taller", "Taller de Ingeniero Espuelístico, foto");

  /* ---------- Reseñas: resenas/lista.js ---------- */
  const resenas = (typeof RESENAS !== "undefined" ? RESENAS : []).filter((r) => r && r.archivo && ["foto", "audio", "video"].includes(r.tipo));
  const lista = $("#lista-resenas");
  const pie = (r) => (r.cliente || r.texto) ? `<p class="resena__pie">${r.cliente ? `<strong>${escapar(r.cliente)}</strong>` : ""}${r.texto ? `<span>${escapar(r.texto)}</span>` : ""}</p>` : "";
  const ruta = (r) => `resenas/${encodeURIComponent(r.archivo)}`;

  if (lista) {
    if (!resenas.length) {
      // Sin reseñas reales todavía: se oculta la sección y su enlace del menú
      const seccion = document.getElementById("resenas");
      if (seccion) seccion.hidden = true;
      document.querySelectorAll('a[href="#resenas"]').forEach((enlace) => { enlace.hidden = true; });
    } else {
      lista.innerHTML = resenas.map((r, k) => {
        if (r.tipo === "audio") return `
          <article class="resena resena--audio flotante">
            <div class="resena__onda" aria-hidden="true">${"<i></i>".repeat(18)}</div>
            <audio controls preload="none" src="${ruta(r)}"></audio>
            ${pie(r)}
          </article>`;
        if (r.tipo === "video") return `
          <article class="resena resena--video flotante">
            <button class="resena__abrir" type="button" data-medio="${k}" aria-label="Ver video${r.cliente ? " de " + escapar(r.cliente) : ""}">
              <video src="${ruta(r)}#t=0.5" preload="metadata" muted playsinline></video>
              <span class="resena__play" aria-hidden="true"></span>
            </button>
            ${pie(r)}
          </article>`;
        return `
          <article class="resena resena--foto flotante">
            <button class="resena__abrir" type="button" data-medio="${k}" aria-label="Ver captura${r.cliente ? " de " + escapar(r.cliente) : ""}">
              <img src="${ruta(r)}" alt="" loading="lazy">
            </button>
            ${pie(r)}
          </article>`;
      }).join("");
    }
  }

  // Visor grande para fotos y videos
  const visor = $("#visor-medios");
  const navegables = resenas.map((r, k) => ({ ...r, k })).filter((r) => r.tipo !== "audio");
  let actual = 0, focoPrevio = null;
  function mostrar(pos) {
    if (!navegables.length) return;
    actual = (pos + navegables.length) % navegables.length;
    const r = navegables[actual];
    $("#visor-medios-contenido").innerHTML = r.tipo === "video"
      ? `<video src="${ruta(r)}" controls autoplay playsinline></video>`
      : `<img src="${ruta(r)}" alt="Captura de cliente${r.cliente ? ": " + escapar(r.cliente) : ""}">`;
    $("#visor-medios-texto").innerHTML = pie(r);
    $$("#medio-anterior, #medio-siguiente").forEach((b) => { b.hidden = navegables.length < 2; });
  }
  function abrir(k) {
    focoPrevio = document.activeElement;
    visor.hidden = false;
    document.body.classList.add("con-ficha");
    mostrar(navegables.findIndex((r) => r.k === k));
    $(".ficha__cerrar", visor).focus();
  }
  function cerrar() {
    $("#visor-medios-contenido").innerHTML = ""; // detiene el video
    visor.hidden = true;
    document.body.classList.remove("con-ficha");
    if (focoPrevio) focoPrevio.focus();
  }
  if (visor) {
    $$("[data-medio]").forEach((b) => b.addEventListener("click", () => abrir(Number(b.dataset.medio))));
    $$("[data-cerrar-medio]", visor).forEach((b) => b.addEventListener("click", cerrar));
    $("#medio-anterior").addEventListener("click", () => mostrar(actual - 1));
    $("#medio-siguiente").addEventListener("click", () => mostrar(actual + 1));
    document.addEventListener("keydown", (e) => {
      if (visor.hidden) return;
      if (e.key === "Escape") cerrar();
      if (e.key === "ArrowLeft") mostrar(actual - 1);
      if (e.key === "ArrowRight") mostrar(actual + 1);
    });
  }
  // Un solo audio a la vez
  document.addEventListener("play", (e) => {
    if (e.target.tagName !== "AUDIO") return;
    $$("audio").forEach((a) => { if (a !== e.target) a.pause(); });
  }, true);

  /* ---------- Preguntas frecuentes ---------- */
  const cajaPreguntas = $("#lista-preguntas");
  if (cajaPreguntas && typeof PREGUNTAS !== "undefined") {
    cajaPreguntas.innerHTML = PREGUNTAS.map((p) => `
      <details class="pregunta flotante">
        <summary>${escapar(p.pregunta)}</summary>
        <p>${escapar(p.respuesta)}${p.enlace ? ` <a href="${escapar(p.enlace.url)}">${escapar(p.enlace.texto)}</a>` : ""}</p>
      </details>`).join("");
  }
})();
