// Buscador de productos (cabecera) y ayuda rápida con las preguntas frecuentes (botón "¿Tienes dudas?").
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const normal = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const escapar = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const palabras = (t) => normal(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 1);
  const productos = typeof PRODUCTOS !== "undefined" ? PRODUCTOS : [];
  const preguntas = typeof PREGUNTAS !== "undefined" ? PREGUNTAS : [];

  // Texto en el que se busca cada producto
  const indice = productos.map((p) => ({
    p,
    texto: normal([p.nombre, p.detalle, p.descripcion, (p.otros_nombres || []).join(" "),
      (p.medidas || []).map((m) => `${m} lineas ${m}mm`).join(" "),
      (p.variantes || []).map((v) => v.nombre).join(" "), (p.colores || []).map((c) => c.nombre).join(" "), p.tipo].join(" ")),
  }));
  function buscarProductos(consulta) {
    const ws = palabras(consulta);
    if (!ws.length) return [];
    return indice.map((x) => ({ ...x, puntos: ws.reduce((s, w) => s + (x.texto.includes(w) ? (normal(x.p.nombre).includes(w) ? 3 : 1) : 0), 0) }))
      .filter((x) => x.puntos > 0).sort((a, b) => b.puntos - a.puntos).slice(0, 6).map((x) => x.p);
  }
  function buscarPreguntas(consulta, max = 4) {
    const ws = palabras(consulta).filter((w) => !["que", "como", "cual", "para", "por", "los", "las", "del", "una", "uno"].includes(w));
    if (!ws.length) return [];
    return preguntas.map((q) => {
      const tq = normal(q.pregunta), tr = normal(q.respuesta);
      return { q, puntos: ws.reduce((s, w) => s + (tq.includes(w) ? 3 : 0) + (tr.includes(w) ? 1 : 0), 0) };
    }).filter((x) => x.puntos > 0).sort((a, b) => b.puntos - a.puntos).slice(0, max).map((x) => x.q);
  }

  /* ---------- Buscador de la cabecera ---------- */
  const form = $("#buscador"), entrada = $("#buscador-texto"), caja = $("#buscador-resultados");
  if (form) {
    let activo = -1;
    const cerrar = () => { caja.hidden = true; entrada.setAttribute("aria-expanded", "false"); activo = -1; };
    function pintar() {
      const q = entrada.value.trim();
      if (!q) return cerrar();
      const ps = buscarProductos(q), qs = buscarPreguntas(q, 2);
      caja.innerHTML = (ps.length ? ps.map((p) => `<button type="button" role="option" class="resultado" data-producto="${p.id}">
          <strong>${escapar(p.nombre)}</strong><span>${escapar(p.detalle)}</span></button>`).join("") : `<p class="resultado resultado--vacio">No encontramos productos con "${escapar(q)}".</p>`)
        + qs.map((x) => `<button type="button" role="option" class="resultado resultado--pregunta" data-pregunta="${escapar(x.pregunta)}"><strong>${escapar(x.pregunta)}</strong><span>Pregunta frecuente</span></button>`).join("");
      caja.hidden = false;
      entrada.setAttribute("aria-expanded", "true");
      $$("[data-producto]", caja).forEach((b) => b.addEventListener("click", () => { cerrar(); entrada.value = ""; window.IE && window.IE.abrirFicha(b.dataset.producto); }));
      $$("[data-pregunta]", caja).forEach((b) => b.addEventListener("click", () => { cerrar(); abrirPregunta(b.dataset.pregunta); }));
    }
    entrada.addEventListener("input", pintar);
    entrada.addEventListener("keydown", (e) => {
      const ops = $$(".resultado[data-producto], .resultado[data-pregunta]", caja);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!ops.length) return;
        activo = (activo + (e.key === "ArrowDown" ? 1 : -1) + ops.length) % ops.length;
        ops.forEach((o, k) => o.classList.toggle("activo", k === activo));
      } else if (e.key === "Escape") cerrar();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const ops = $$(".resultado[data-producto], .resultado[data-pregunta]", caja);
      (ops[activo] || ops[0])?.click();
    });
    document.addEventListener("click", (e) => { if (!form.contains(e.target)) cerrar(); });
  }

  function abrirPregunta(texto) {
    const d = $$(".pregunta").find((el) => el.querySelector("summary").textContent === texto);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- Ayuda rápida ---------- */
  const boton = $("#ayuda-boton"), panel = $("#ayuda-panel");
  if (!boton || !panel) return;
  const rapidas = ["¿Cuándo despachan mi pedido?", "¿Hacen envíos contraentrega?", "¿Cómo funciona el precio por cantidad?", "¿Qué significan las \"líneas\" de una espuela?"];
  const pintarRespuestas = (lista, titulo) => {
    $("#ayuda-respuestas").innerHTML = (titulo ? `<p class="ayuda-panel__titulo">${titulo}</p>` : "") + lista.map((q) => `
      <details class="ayuda-respuesta"><summary>${escapar(q.pregunta)}</summary><p>${escapar(q.respuesta)}</p></details>`).join("");
  };
  const iniciales = () => pintarRespuestas(preguntas.filter((q) => rapidas.includes(q.pregunta)), "Lo que más nos preguntan");
  function abrir(si) {
    panel.hidden = !si;
    boton.setAttribute("aria-expanded", si ? "true" : "false");
    if (si) { iniciales(); $("#ayuda-texto").focus(); }
  }
  boton.addEventListener("click", () => abrir(panel.hidden));
  $("#ayuda-cerrar").addEventListener("click", () => { abrir(false); boton.focus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) abrir(false); });
  $("#ayuda-texto").addEventListener("input", (e) => {
    const q = e.target.value.trim();
    if (!q) return iniciales();
    const r = buscarPreguntas(q);
    const ps = buscarProductos(q).slice(0, 3);
    pintarRespuestas(r, r.length ? "" : "No encontramos esa respuesta. Escríbenos y te respondemos.");
    if (ps.length) {
      $("#ayuda-respuestas").insertAdjacentHTML("beforeend", `<p class="ayuda-panel__titulo">Productos relacionados</p>` +
        ps.map((p) => `<button type="button" class="resultado" data-producto="${p.id}"><strong>${escapar(p.nombre)}</strong><span>${escapar(p.detalle)}</span></button>`).join(""));
      $$("#ayuda-respuestas [data-producto]").forEach((b) => b.addEventListener("click", () => { abrir(false); window.IE && window.IE.abrirFicha(b.dataset.producto); }));
    }
    const wa = $("#ayuda-wa");
    if (typeof NEGOCIO !== "undefined") wa.href = `https://wa.me/${NEGOCIO.whatsapp}?text=${encodeURIComponent("Hola, tengo una pregunta: " + q)}`;
  });

  // El botón aparece cuando el cliente llega al catálogo y se queda visible desde ahí
  const catalogo = document.getElementById("catalogo");
  if ("IntersectionObserver" in window && catalogo) {
    new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) boton.hidden = false; }, { rootMargin: "0px 0px -30% 0px" }).observe(catalogo);
  } else boton.hidden = false;
})();
