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

  // ----- Motor de búsqueda: tolera tildes, plurales, masculino/femenino, palabras a medio escribir y un error de letra -----
  const VACIAS = new Set(["de", "la", "el", "los", "las", "para", "con", "en", "y", "del", "por", "un", "una", "que", "al", "o", "mi", "me", "quiero", "busco", "hay", "tienen"]);
  const raiz = (w) => { let r = w; if (r.length > 3 && r.endsWith("es") && !/[aeiou]es$/.test(r) && r.length > 5) r = r.slice(0, -2); else if (r.length > 3 && r.endsWith("s")) r = r.slice(0, -1); if (r.length > 4 && /[ao]$/.test(r)) r = r.slice(0, -1); return r; };
  const fichas = (t) => normal(t).split(/[^a-z0-9ñ]+/).filter(Boolean);
  function casiIgual(a, b) { // distancia de edición ≤ 1
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, dif = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++dif > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return dif + (a.length - i) + (b.length - j) <= 1;
  }
  // Qué tan bien coincide una palabra buscada con una palabra del producto (0 = nada)
  function coincide(q, w) {
    if (q === w) return 1;
    const rq = raiz(q), rw = raiz(w);
    if (rq === rw) return 1;
    if (q.length >= 3 && w.startsWith(q)) return 0.8;          // palabra a medio escribir: "espu" → espuela
    if (rq.length >= 5 && rw.length >= 5 && casiIgual(rq, rw)) return 0.6; // un error: "esparadapo"
    return 0;
  }
  const sinonimos = typeof SINONIMOS !== "undefined" ? SINONIMOS : {};
  const sinonimosTipo = typeof SINONIMOS_TIPO !== "undefined" ? SINONIMOS_TIPO : {};
  const pulgadas = typeof PULGADAS !== "undefined" ? PULGADAS : {};
  const indice = productos.map((p) => ({
    p,
    campos: [
      { peso: 4, palabras: fichas(p.nombre) },
      { peso: 3, palabras: fichas((sinonimos[p.id] || []).join(" ") + " " + (p.otros_nombres || []).join(" ")) },
      { peso: 2, palabras: fichas([p.detalle, (p.medidas || []).map((m) => `${m} lineas ${m}mm ${String(pulgadas[m] || "").replace(".", "")}`).join(" "),
        (p.variantes || []).map((v) => v.nombre).join(" "), (p.colores || []).map((c) => c.nombre).join(" ")].join(" ")) },
      { peso: 1, palabras: fichas([p.descripcion, (sinonimosTipo[p.tipo] || []).join(" ")].join(" ")) },
    ],
  }));
  function buscarProductos(consulta, max = 8) {
    const ws = fichas(consulta).filter((w) => !VACIAS.has(w) && (w.length > 1 || /\d/.test(w)));
    if (!ws.length) return [];
    const puntuados = indice.map((x) => {
      let total = 0, encontradas = 0;
      for (const q of ws) {
        let mejor = 0;
        for (const c of x.campos) for (const w of c.palabras) { const m = coincide(q, w) * c.peso; if (m > mejor) mejor = m; }
        if (mejor) { total += mejor; encontradas++; }
      }
      return { p: x.p, total, todas: encontradas === ws.length };
    }).filter((x) => x.total > 0);
    // Si algún producto tiene TODAS las palabras buscadas, mostramos solo esos
    const lista = puntuados.some((x) => x.todas) ? puntuados.filter((x) => x.todas) : puntuados;
    return lista.sort((a, b) => b.total - a.total).slice(0, max).map((x) => x.p);
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
