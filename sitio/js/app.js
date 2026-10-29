(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pesos = (n) => (window.Moneda ? Moneda.formatear(n) : "$" + Math.round(n).toLocaleString("es-CO"));
  const pesosCOP = (n) => "$" + Math.round(n).toLocaleString("es-CO");
  const prod = (id) => PRODUCTOS.find((p) => p.id === id);
  const medidaTexto = (mm) => `${mm} líneas - ${PULGADAS[mm]}`;

  /* ---------- Contacto ---------- */
  const enlaceWA = (texto) =>
    `https://wa.me/${NEGOCIO.whatsapp}?text=${encodeURIComponent(texto || "Hola, vengo de la página de Ingeniero Espuelístico")}`;
  $$("[data-wa]").forEach((a) => { a.href = enlaceWA(a.dataset.waTexto); a.target = "_blank"; a.rel = "noopener"; });
  $$("[data-tel]").forEach((a) => (a.href = "tel:+" + NEGOCIO.whatsapp));
  $$("[data-telefono]").forEach((el) => (el.textContent = NEGOCIO.telefonoVisible));
  $$("[data-horario]").forEach((el) => (el.textContent = NEGOCIO.horario));
  $$("[data-tiktok]").forEach((a) => { a.href = NEGOCIO.tiktok; a.target = "_blank"; a.rel = "noopener"; });
  $$("[data-facebook]").forEach((a) => { a.href = NEGOCIO.facebook; a.target = "_blank"; a.rel = "noopener"; });

  /* ---------- Pedido (estado) ---------- */
  let pedido = [];
  try { pedido = JSON.parse(localStorage.getItem("ie-pedido") || "[]"); } catch (e) { pedido = []; }
  const guardar = () => { try { localStorage.setItem("ie-pedido", JSON.stringify(pedido)); } catch (e) {} };

  // Los cálculos de precio están en js/calculo.js (los comparte con el servidor)
  const C = window.Calculo;
  // Si el carrito guardado tiene un producto, medida u opción que ya no existe, se descarta esa línea
  pedido = (Array.isArray(pedido) ? pedido : []).map((l) => { try { const x = C.limpiarLinea(l); return C.lineaValida(x) ? x : null; } catch (e) { return null; } }).filter(Boolean);
  guardar();
  const nivelPara = C.nivelPara, siguienteNivel = C.siguienteNivel, precioParPatapioja = C.precioParPatapioja, regaloPara = C.regaloPara;
  const paresEspuela = (lista = pedido) => C.paresEspuela(lista);
  const paresPatapioja = (lista = pedido) => C.paresPatapioja(lista);
  const precioLinea = (l, lista = pedido) => C.precioLinea(l, lista);
  const subtotal = (lista = pedido) => C.subtotal(lista);
  const pesoGramos = (lista = pedido) => C.pesoGramos(lista);
  const describirLinea = (l) => C.describirLinea(l);
  const textoPeso = (g) => g >= 1000 ? `${(g / 1000).toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg` : `${Math.round(g)} g`;

  function agregar(linea) {
    linea.cantidad = Math.min(C.MAX_CANTIDAD, Math.max(1, Math.floor(linea.cantidad) || 1));
    const igual = pedido.find((l) => ["producto", "medida", "presentacion", "color", "variante"].every((k) => l[k] === linea[k]));
    if (igual) igual.cantidad += linea.cantidad; else pedido.push(linea);
    guardar(); pintarPedido();
  }

  /* ---------- Sugerencias de compra ---------- */
  function sugerencias() {
    const lista = [];
    const total = subtotal();

    // Espuelas: cerca del siguiente nivel
    const pares = paresEspuela();
    const sig = siguienteNivel(pares);
    if (pares > 0 && sig && pares >= sig.desde * 0.8) {
      const falta = sig.desde - pares;
      const base = pedido.filter((l) => prod(l.producto).tipo === "espuela").sort((a, b) => b.cantidad - a.cantidad)[0];
      const simulado = pedido.map((l) => (l === base ? { ...l, cantidad: l.cantidad + falta } : l));
      const extra = subtotal(simulado) - total;
      const nuevoUnit = prod(base.producto).precios[sig.id];
      lista.push({
        texto: `Te faltan <strong>${falta} pares</strong> de espuela para el precio <strong>${sig.nombre}</strong>. Por ${pesos(extra)} más llevas ${sig.desde} pares y el par en bolsa te sale a ${pesos(nuevoUnit)}.`,
        boton: `Agregar ${falta} pares`, accion: () => { base.cantidad += falta; guardar(); pintarPedido(); },
      });
    }

    // Regalo cercano
    const sigRegalo = REGALOS.find((r) => r.desde > pares);
    if (pares > 0 && sigRegalo && pares >= sigRegalo.desde * 0.8 && !(sig && pares >= sig.desde * 0.8)) {
      lista.push({ texto: `Con ${sigRegalo.desde - pares} pares de espuela más, te regalamos ${sigRegalo.pares} pares de patapioja sintética.` });
    }

    // Patapioja sintética
    const pp = paresPatapioja();
    const metas = [[9, 12], [60, 72], [85, 100]];
    const meta = metas.find(([d, h]) => pp >= d && pp < h);
    if (meta) {
      const objetivo = meta[1];
      const linea = pedido.filter((l) => l.producto === "patapioja").sort((a, b) => b.cantidad - a.cantidad)[0];
      const simulado = pedido.map((l) => (l === linea ? { ...l, cantidad: l.cantidad + objetivo - pp } : l));
      const diferencia = subtotal(simulado) - total;
      const frase = diferencia <= 0 ? `y pagas ${pesos(-diferencia)} menos` : `por solo ${pesos(diferencia)} más`;
      lista.push({
        texto: `Lleva <strong>${objetivo} pares</strong> de patapioja en vez de ${pp} ${frase}.`,
        boton: `Cambiar a ${objetivo} pares`, accion: () => { linea.cantidad += objetivo - pp; guardar(); pintarPedido(); },
      });
    }

    // Cera y patapioja metálica: completar docena
    pedido.filter((l) => prod(l.producto).tipo === "unidad-docena").forEach((l) => {
      const v = prod(l.producto).variantes.find((x) => x.id === l.variante);
      const resto = l.cantidad % 12;
      if (resto && resto * v.unidad >= v.docena * 0.9) {
        const extra = v.docena - resto * v.unidad;
        const frase = extra <= 0 ? `y ahorras ${pesos(-extra)}` : `por ${pesos(extra)} más`;
        lista.push({
          texto: `${describirLinea(l).nombre}: completa la docena (${12 - resto} más) ${frase}.`,
          boton: "Completar docena", accion: () => { l.cantidad += 12 - resto; guardar(); pintarPedido(); },
        });
      }
    });

    // Esparadrapo: tubo surtido
    const sueltos = pedido.filter((l) => l.producto === "esparadrapo" && l.variante !== "tubo");
    const valorSueltos = sueltos.reduce((s, l) => s + precioLinea(l).total, 0);
    if (valorSueltos >= 60000) {
      const tubo = prod("esparadrapo").variantes.find((v) => v.id === "tubo");
      const cabe = { 1: 1, 2: 2, 3: 1, 4: 1 };
      const encaja = sueltos.every((l) => l.cantidad <= cabe[l.variante]);
      const diferencia = tubo.precio - valorSueltos;
      const frase = diferencia <= 0 ? `y ahorras ${pesos(-diferencia)}` : `por ${pesos(diferencia)} más`;
      lista.push({
        texto: `Lleva el <strong>tubo surtido de 12 pulgadas</strong> (${tubo.nota}) ${frase}.`,
        boton: encaja ? "Cambiar por el tubo" : "Agregar el tubo",
        accion: () => {
          if (encaja) pedido = pedido.filter((l) => !sueltos.includes(l));
          agregar({ producto: "esparadrapo", variante: "tubo", cantidad: 1 });
        },
      });
    }
    return lista;
  }

  /* ---------- Catálogo ---------- */
  function ilustracion(p) {
    if (p.tipo === "espuela") {
      const casquillo = p.id.includes("enteriza") ? "" :
        `<rect x="10" y="38" width="62" height="44" rx="8" fill="#B9C3CF" stroke="#142033" stroke-width="2"/>`;
      const inicio = p.id.includes("enteriza") ? 14 : 72;
      return `<svg viewBox="0 0 240 120" aria-hidden="true">${casquillo}
        <path d="M${inicio} 40 C 120 40, 170 48, 228 58 L 232 60 L 228 62 C 170 72, 120 80, ${inicio} 80 Z" fill="${p.color}" fill-opacity=".9" stroke="#142033" stroke-width="2"/></svg>`;
    }
    if (p.id === "patapioja" || p.id === "metalica") {
      const relleno = p.id === "metalica" ? "#B9C3CF" : "#F2B705";
      return `<svg viewBox="0 0 240 120" aria-hidden="true"><g fill="none" stroke="#142033" stroke-width="2">
        <rect x="60" y="20" width="120" height="80" rx="10" fill="${relleno}" fill-opacity=".85"/>
        <path d="M90 20v80M120 20v80M150 20v80M60 47h120M60 73h120"/></g></svg>`;
    }
    if (p.id === "cera") {
      return `<svg viewBox="0 0 240 120" aria-hidden="true"><rect x="30" y="44" width="180" height="32" rx="6" fill="#F2B705" stroke="#142033" stroke-width="2"/></svg>`;
    }
    return `<svg viewBox="0 0 240 120" aria-hidden="true"><ellipse cx="120" cy="60" rx="46" ry="46" fill="#fff" stroke="#142033" stroke-width="2"/><ellipse cx="120" cy="60" rx="16" ry="16" fill="#E6ECF3" stroke="#142033" stroke-width="2"/></svg>`;
  }

  function opciones(lista, valor, texto) {
    return lista.map((x) => `<option value="${valor(x)}">${texto(x)}</option>`).join("");
  }

  /* ---------- Fotos: se buscan solas en fotos/<producto>/1.jpg, 2.jpg, 3.jpg ... ---------- */
  const EXTENSIONES = ["jpg", "png", "webp"];
  const MAX_FOTOS = 12;
  const cacheFotos = {};
  const probar = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(src); im.onerror = () => ok(null); im.src = src; });
  async function buscarFoto(id, n) {
    if (window.FOTOS) return (window.FOTOS[id] || [])[n - 1] || null;
    for (const e of EXTENSIONES) { const r = await probar(`fotos/${id}/${n}.${e}`); if (r) return r; }
    return null;
  }
  async function fotosDe(id) {
    if (cacheFotos[id]) return cacheFotos[id];
    // Lista generada al publicar (js/fotos-lista.js): no hay que probar fotos que no existen
    if (window.FOTOS) return (cacheFotos[id] = window.FOTOS[id] || []);
    const lista = [];
    for (let n = 1; n <= MAX_FOTOS; n++) { const f = await buscarFoto(id, n); if (!f) break; lista.push(f); }
    return (cacheFotos[id] = lista);
  }

  const conDureza = (p) => p.tipo === "espuela" || p.id === "patapioja" || p.id === "metalica";
  const barraDureza = (p) => conDureza(p) ? `
    <div class="dureza" aria-label="Dureza: ${FICHAS[p.id].dureza}">
      <span class="dureza__nombre">Dureza</span>
      <span class="dureza__barra" aria-hidden="true">${"<i></i>".repeat(5)}</span>
      <strong>${FICHAS[p.id].dureza}</strong>
    </div>` : "";

  // Precio de detal (lo que paga quien compra poco) y, aparte, la mejor tarifa por mayor
  function precioDesde(p) {
    if (p.tipo === "espuela") {
      const may = NIVELES[1];
      return `<strong>${pesos(p.precios.minorista)}</strong> el par<small class="producto__mayor">Por mayor desde ${pesos(p.precios[may.id])} (${may.desde}+ pares)</small>`;
    }
    if (p.tipo === "patapioja") {
      const t = p.tramos, docena = t.find((x) => x.desde >= 12) || t[0];
      return `<strong>${pesos(t[0].precio)}</strong> el par<small class="producto__mayor">Docena a ${pesos(docena.precio * 12)} · baja con la cantidad</small>`;
    }
    if (p.tipo === "unidad-docena") {
      const u = p.unidad === "barra" ? "la barra" : "el par";
      return `<strong>${pesos(Math.min(...p.variantes.map((v) => v.unidad)))}</strong> ${u}<small class="producto__mayor">Docena desde ${pesos(Math.min(...p.variantes.map((v) => v.docena)))}</small>`;
    }
    return `Desde <strong>${pesos(Math.min(...p.variantes.map((v) => v.precio)))}</strong>`;
  }
  const slugProducto = (p) => p.slug || String(p.nombre).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function tarjeta(p) {
    return `
      <article class="producto flotante" data-producto="${p.id}">
        <div class="producto__foto">${ilustracion(p)}</div>
        <div class="producto__info">
          <h3>${p.nombre}</h3>
          <p class="producto__detalle">${p.detalle}</p>
          <p class="producto__precio">${precioDesde(p)}</p>
          ${conDureza(p) ? `<p class="producto__chip">Dureza ${FICHAS[p.id].dureza.toLowerCase()}</p>` : ""}
          <button class="producto__abrir" type="button" aria-label="Ver detalles de ${p.nombre}">Ver y comprar</button>
          <a class="producto__enlace" href="/productos/${slugProducto(p)}">Ficha completa del producto</a>
        </div>
      </article>`;
  }

  function pintarCatalogo() {
    $("#lista-productos").innerHTML = PRODUCTOS.map(tarjeta).join("");
    $$(".producto").forEach((card) => {
      const id = card.dataset.producto;
      buscarFoto(id, 1).then((f) => {
        if (f) $(".producto__foto", card).innerHTML = `<img src="${f}" alt="${prod(id).nombre}" loading="lazy" decoding="async" width="600" height="600">`;
      });
      card.addEventListener("click", (e) => { if (e.target.closest(".producto__enlace")) return; abrirFicha(id); });
    });
  }
  pintarCatalogo();

  /* ---------- Ficha de producto (pantalla grande) ---------- */
  const ficha = $("#ficha");
  let fichaFotos = [], fichaIndice = 0, fichaProducto = null, focoAntesFicha = null;

  function camposFicha(p) {
    if (p.tipo === "espuela") return `
      <label class="campo">Medida<select name="medida">${opciones(p.medidas, (m) => m, medidaTexto)}</select></label>
      <label class="campo">Presentación<select name="presentacion">${opciones(PRESENTACIONES, (x) => x.id, (x) => `${x.nombre}${x.ajuste ? ` (${x.ajuste > 0 ? "+" : "−"}${pesos(Math.abs(x.ajuste))})` : ""}`)}</select></label>
      <label class="campo campo--ancho">Cantidad de pares<input name="cantidad" type="number" min="1" max="20000" value="12" inputmode="numeric"></label>`;
    if (p.tipo === "patapioja") return `
      <label class="campo">Color<select name="color">${opciones(p.colores, (c) => c.id, (c) => `${c.nombre}: ${c.nota}`)}</select></label>
      <label class="campo">Cantidad de pares<input name="cantidad" type="number" min="1" max="20000" value="12" inputmode="numeric"></label>`;
    if (p.tipo === "unidad-docena") return `
      <label class="campo">Tipo<select name="variante">${opciones(p.variantes, (v) => v.id, (v) => v.nombre)}</select></label>
      <label class="campo">Cantidad (${p.unidad === "barra" ? "barras" : "pares"})<input name="cantidad" type="number" min="1" max="20000" value="12" inputmode="numeric"></label>`;
    return `
      <label class="campo campo--ancho">${p.etiquetaVariante || "Tipo"}<select name="variante">${opciones(p.variantes, (v) => v.id, (v) => `${v.nombre} · ${pesos(v.precio)}`)}</select></label>
      <label class="campo">Cantidad<input name="cantidad" type="number" min="1" max="20000" value="1" inputmode="numeric"></label>`;
  }

  function lineaDesdeFormulario(f, id) {
    const d = Object.fromEntries(new FormData(f));
    const linea = { producto: id, cantidad: Math.max(1, parseInt(d.cantidad, 10) || 1) };
    if (d.medida) linea.medida = Number(d.medida);
    if (d.presentacion) linea.presentacion = d.presentacion;
    if (d.color) linea.color = d.color;
    if (d.variante) linea.variante = d.variante;
    return linea;
  }

  // Precio en vivo: simula el pedido con lo que el cliente está escogiendo
  function actualizarPrecioFicha() {
    const f = $("#ficha-formulario"), p = fichaProducto;
    const linea = lineaDesdeFormulario(f, p.id);
    const simulado = [...pedido.map((l) => ({ ...l })), linea];
    const pr = precioLinea(linea, simulado);
    let nota = "";
    if (p.tipo === "espuela") {
      const pares = paresEspuela(simulado), nivel = nivelPara(pares), sig = siguienteNivel(pares);
      nota = `Precio <strong>${nivel.nombre}</strong> por ${pares} pares de espuela en tu pedido.` +
        (sig ? ` Desde ${sig.desde} pares pagas ${pesos(p.precios[sig.id])} el par en bolsa.` : "");
    } else if (p.tipo === "patapioja") {
      const pares = paresPatapioja(simulado), sig = prod("patapioja").tramos.find((t) => t.desde > pares);
      nota = sig ? `Desde ${sig.desde} pares, el par te sale a ${pesos(sig.precio)}.` : "Tienes el mejor precio por par.";
    } else if (p.tipo === "unidad-docena") {
      nota = "Cada 12 unidades se cobran a precio de docena.";
    }
    $("#ficha-precio").innerHTML = `${pr.unitario ? `<span class="ficha__unitario">${pesos(pr.unitario)} <small>c/u</small></span>` : ""}<span class="ficha__total">Total ${pesos(pr.total)}</span>`;
    $("#ficha-nota").innerHTML = nota;
  }

  function mostrarFoto(n) {
    if (!fichaFotos.length) return;
    fichaIndice = (n + fichaFotos.length) % fichaFotos.length;
    const img = $("#ficha-img");
    img.src = fichaFotos[fichaIndice];
    img.alt = `${fichaProducto.nombre}, foto ${fichaIndice + 1} de ${fichaFotos.length}`;
    $$(".ficha__miniaturas button").forEach((b, k) => b.setAttribute("aria-current", k === fichaIndice ? "true" : "false"));
    $("#ficha-contador").textContent = `${fichaIndice + 1} / ${fichaFotos.length}`;
  }

  async function abrirFicha(id) {
    const p = prod(id);
    fichaProducto = p; focoAntesFicha = document.activeElement;
    $("#ficha-titulo").textContent = p.nombre;
    $("#ficha-detalle").textContent = p.detalle;
    $("#ficha-descripcion").textContent = FICHAS[id].descripcion;
    window.Medicion && Medicion.evento("ViewContent", { content_ids: [id], content_name: p.nombre, content_type: "product" });
    $("#ficha-dureza").innerHTML = barraDureza(p);
    $("#ficha-campos").innerHTML = camposFicha(p);
    $("#ficha-agregado").textContent = "";
    $("#ficha-wa").href = enlaceWA(`Hola, tengo una pregunta sobre: ${p.nombre}`);
    const visor = $("#ficha-visor");
    visor.classList.add("cargando");
    $("#ficha-contador").textContent = "";
    $(".ficha__miniaturas").innerHTML = "";
    $$(".ficha__flecha").forEach((b) => (b.hidden = true));
    ficha.hidden = false;
    document.body.classList.add("con-ficha");
    $(".ficha__cerrar").focus();
    actualizarPrecioFicha();
    fichaFotos = await fotosDe(id);
    visor.classList.remove("cargando");
    visor.classList.toggle("sin-fotos", !fichaFotos.length);
    $("#ficha-ilustracion").innerHTML = fichaFotos.length ? "" : ilustracion(p) + `<small>Pronto subiremos fotos de este producto</small>`;
    $(".ficha__miniaturas").innerHTML = fichaFotos.length > 1 ? fichaFotos.map((f, k) => `<button type="button" aria-label="Ver foto ${k + 1}"><img src="${f}" alt=""></button>`).join("") : "";
    $$(".ficha__miniaturas button").forEach((b, k) => b.addEventListener("click", () => mostrarFoto(k)));
    $$(".ficha__flecha").forEach((b) => (b.hidden = fichaFotos.length < 2));
    mostrarFoto(0);
  }
  function cerrarFicha() {
    ficha.hidden = true;
    document.body.classList.remove("con-ficha");
    if (focoAntesFicha) focoAntesFicha.focus();
  }
  $$("[data-cerrar-ficha]").forEach((b) => b.addEventListener("click", cerrarFicha));
  $("#ficha-anterior").addEventListener("click", () => mostrarFoto(fichaIndice - 1));
  $("#ficha-siguiente").addEventListener("click", () => mostrarFoto(fichaIndice + 1));
  document.addEventListener("keydown", (e) => {
    if (ficha.hidden) return;
    if (e.key === "Escape") cerrarFicha();
    if (e.key === "ArrowLeft") mostrarFoto(fichaIndice - 1);
    if (e.key === "ArrowRight") mostrarFoto(fichaIndice + 1);
  });
  // Deslizar con el dedo o el mouse
  let xInicio = null;
  $("#ficha-visor").addEventListener("pointerdown", (e) => { xInicio = e.clientX; });
  $("#ficha-visor").addEventListener("pointerup", (e) => {
    if (xInicio === null) return;
    const dx = e.clientX - xInicio; xInicio = null;
    if (Math.abs(dx) > 40) mostrarFoto(fichaIndice + (dx < 0 ? 1 : -1));
  });
  $("#ficha-formulario").addEventListener("input", actualizarPrecioFicha);
  $("#ficha-formulario").addEventListener("change", actualizarPrecioFicha);
  $("#ficha-formulario").addEventListener("submit", (e) => {
    e.preventDefault();
    const nueva = lineaDesdeFormulario(e.target, fichaProducto.id);
    agregar(nueva);
    actualizarPrecioFicha();
    window.Medicion && Medicion.evento("AddToCart", { value: Math.round(precioLinea(nueva).total), content_ids: [fichaProducto.id], content_name: fichaProducto.nombre, content_type: "product" });
    const aviso = $("#ficha-agregado");
    aviso.innerHTML = `Agregado a tu pedido. <a href="#" data-ver>Ver pedido</a>`;
    $("[data-ver]", aviso).addEventListener("click", (ev) => { ev.preventDefault(); cerrarFicha(); abrirPanel(); });
  });

  /* ---------- Tabla de precios y regalos ---------- */
  const espuelas = PRODUCTOS.filter((p) => p.tipo === "espuela");
  const rango = (i) => (NIVELES[i + 1] ? `${NIVELES[i].desde} a ${NIVELES[i + 1].desde - 1} pares` : `${NIVELES[i].desde} pares o más`);
  function pintarTabla() {
    $("#tabla-precios").innerHTML = `
      <thead><tr><th>Referencia</th>${NIVELES.map((n, i) => `<th>${n.nombre}<small>${rango(i)}</small></th>`).join("")}</tr></thead>
      <tbody>${espuelas.map((p) => `<tr><td>${p.nombre}</td>${NIVELES.map((n) => `<td>${pesos(p.precios[n.id])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }
  pintarTabla();
  $("#texto-regalos").textContent = "Te regalamos patapioja sintética según los pares de espuela de tu pedido: " +
    REGALOS.map((r) => `${r.pares} pares desde ${r.desde.toLocaleString("es-CO")}`).join(", ") + ".";

  /* ---------- Panel del pedido ---------- */
  const panel = $("#panel-pedido");
  let ultimoFoco = null;
  function abrirPanel() { ultimoFoco = document.activeElement; panel.hidden = false; pintarPedido(); $(".panel__cerrar").focus(); document.body.style.overflow = "hidden"; document.dispatchEvent(new Event("ie:panel-abierto")); }
  function cerrarPanel() { panel.hidden = true; document.body.style.overflow = ""; if (ultimoFoco) ultimoFoco.focus(); }
  $$("#abrir-pedido, [data-abrir-carrito]").forEach((b) => b.addEventListener("click", abrirPanel));
  $$("[data-seguir-comprando]").forEach((b) => b.addEventListener("click", () => { cerrarPanel(); document.getElementById("catalogo").scrollIntoView({ behavior: "smooth" }); }));
  $$("[data-cerrar]", panel).forEach((b) => b.addEventListener("click", cerrarPanel));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) cerrarPanel(); });

  function envioTexto(pais) {
    if (pais === "Colombia") return { texto: "Enviamos con Interrapidísimo. El valor se calcula según tu municipio y el peso del paquete; con contraentrega incluye el costo del recaudo." };
    const regla = ENVIOS_INTERNACIONALES[pais];
    const kg = pesoGramos() / 1000;
    const elegido = envioElegido();
    if (elegido) return { texto: `Envío a ${pais}: ${elegido.nombre}, USD ${elegido.usd}${elegido.dias ? ` (${elegido.dias})` : ""}. Peso estimado ${kg.toFixed(2)} kg.`, usd: elegido.usd };
    const dhl = ENVIO_INTERNACIONAL_USD.dhl && ENVIO_INTERNACIONAL_USD.dhl.activo;
    if (C.tieneTarifaInternacional(isoPedido())) {
      const usd = C.envioInternacionalUSD(pedido);
      return { texto: `Envío a ${pais}: envío propio puerta a puerta por USD ${usd}${dhl ? " o DHL Express. Elige tu ciudad para ver el valor de DHL y escoge el que prefieras" : ""} (peso estimado ${kg.toFixed(2)} kg).`, usd };
    }
    if (dhl) return { texto: `Envío a ${pais} con DHL Express: elige tu ciudad y calculamos el valor exacto (peso estimado ${kg.toFixed(2)} kg).` };
    if (regla) return { texto: `Envío a ${pais}: ${regla.texto}. Te confirmamos el valor exacto por WhatsApp.` };
    return { texto: `Envío a ${pais}: te cotizamos por WhatsApp según el peso (aprox. ${kg.toFixed(2)} kg).` };
  }

  // Países a los que no se envía (ver NEGOCIO.paisesSinEnvio en datos.js)
  const paisSinEnvio = () => { const iso = ubicacionPedido ? ubicacionPedido.iso() : "CO"; return (NEGOCIO.paisesSinEnvio || {})[iso] || ""; };
  const AVISO_SIN_ENVIO = (n) => `No enviamos a ${n}. Las leyes de Estados Unidos (incluidos Puerto Rico y sus demás territorios) y de Canadá restringen la importación de espuelas y accesorios para gallos, así que no podemos despachar pedidos a esos destinos.`;
  const isoPedido = () => (ubicacionPedido ? ubicacionPedido.iso() : "CO");
  const paypalDirecto = () => typeof PAYPAL !== "undefined" && PAYPAL.activo && isoPedido() !== "CO" && !paisSinEnvio()
    && (C.tieneTarifaInternacional(isoPedido()) || Boolean(envioElegido()));
  function pintarPagos() {
    const pais = ubicacionPedido ? ubicacionPedido.paisNombre() : "Colombia";
    const caja = $("#opciones-pago");
    const sub = subtotal();
    const previo = (caja.querySelector("input[name=pago]:checked") || {}).value;
    const sinEnvio = paisSinEnvio();
    $("#carrito-wa").hidden = !pedido.length || Boolean(sinEnvio);
    $("#boton-confirmar").disabled = Boolean(sinEnvio);
    $("#fila-postal").hidden = pais === "Colombia" || Boolean(sinEnvio);
    if (pais === "Colombia" || sinEnvio) $("#opciones-envio").hidden = true;
    if (sinEnvio) {
      caja.innerHTML = `<legend>Envío no disponible</legend><p class="aviso-sin-envio" role="alert">${AVISO_SIN_ENVIO(sinEnvio)}</p>`;
      $("#nota-envio").textContent = "";
      $("#boton-confirmar-texto").textContent = "Envío no disponible a este país";
      $("#sello-pago").hidden = true;
      return;
    }
    if (pais === "Colombia") {
      const habilitada = sub >= NEGOCIO.contraentregaMinimo;
      caja.innerHTML = `<legend>¿Cómo quieres pagar?</legend>
        <label class="opcion"><input type="radio" name="pago" value="Pago en línea (PSE, tarjeta, Efecty)" checked> Pago en línea: PSE, tarjeta o Efecty</label>
        <label class="opcion" aria-disabled="${!habilitada}"><input type="radio" name="pago" value="Contraentrega" ${habilitada ? "" : "disabled"}> Contraentrega: pagas el envío en línea y los productos al recibir${habilitada ? "" : ` (desde ${pesos(NEGOCIO.contraentregaMinimo)})`}</label>`;
    } else {
      caja.innerHTML = `<legend>¿Cómo quieres pagar?</legend>
        <label class="opcion"><input type="radio" name="pago" value="PayPal" checked> PayPal${paypalDirecto() ? ": pagas aquí mismo en dólares, con tu cuenta PayPal o tarjeta" : " (te enviamos el enlace de pago por WhatsApp con el envío incluido)"}</label>
        <label class="opcion"><input type="radio" name="pago" value="Western Union"> Western Union (te enviamos los datos por WhatsApp)</label>`;
    }
    const elegir = caja.querySelector(`input[name=pago][value="${previo}"]:not([disabled])`);
    if (elegir) elegir.checked = true;
    $("#nota-envio").textContent = envioTexto(pais).texto;
    textoConfirmar();
  }
  // El botón dice a dónde lleva según la forma de pago
  function textoConfirmar() {
    const pago = ($("#opciones-pago input[name=pago]:checked") || {}).value || "";
    const pp = pago === "PayPal" && paypalDirecto();
    $("#boton-confirmar-texto").textContent = pago.startsWith("Pago en línea") ? "Confirmar pedido e ir a pago seguro"
      : pago === "Contraentrega" ? "Confirmar contraentrega y pagar el envío" : pp ? "Confirmar pedido e ir a PayPal" : `Enviar pedido por WhatsApp para pagar con ${pago}`;
    $("#sello-pago").hidden = !(pago.startsWith("Pago en línea") || pago === "Contraentrega" || pp);
    const sello = $("#sello-texto");
    if (sello) sello.textContent = pp ? "Pago protegido por PayPal · Tus datos de pago no pasan por nuestra página" : "Pago protegido por Mercado Pago · Tus datos de pago no pasan por nuestra página";
  }
  // Al cambiar la forma de pago se vuelve a cotizar: la contraentrega incluye el costo del recaudo
  $("#opciones-pago").addEventListener("change", () => { textoConfirmar(); actualizarEnvio(); });
  // País, indicativo, departamento y municipio del pedido
  const ubicacionPedido = window.Ubicacion ? window.Ubicacion.conectar({
    pais: $("#campo-pais"), paisOtro: $("#campo-pais-otro"), indicativo: $("#campo-indicativo"), celular: $("#campo-celular"),
    region: $("#campo-region"), regionLibre: $("#campo-region-libre"), ciudad: $("#campo-ciudad"), ciudadOtra: $("#campo-ciudad-otra"),
    alCambiar: () => { if (!panel.hidden) { pintarPagos(); actualizarEnvio(); } },
  }) : null;
  // En la lista de países del pedido se marcan los destinos a los que no enviamos
  function marcarPaisesSinEnvio() {
    $$("#campo-pais-otro option, #campo-pais option").forEach((o) => {
      if ((NEGOCIO.paisesSinEnvio || {})[o.value] && !o.dataset.sinEnvio) { o.dataset.sinEnvio = "1"; o.textContent += " · sin envío"; }
    });
  }
  marcarPaisesSinEnvio();
  document.addEventListener("ie:panel-abierto", marcarPaisesSinEnvio);
  // Al elegir departamento o municipio, se recalcula el envío
  ["#campo-region", "#campo-ciudad", "#campo-ciudad-otra", "#campo-region-libre", "#campo-postal"].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener("change", () => { if (!panel.hidden) setTimeout(actualizarEnvio, 0); });
  });

  function pintarPedido() {
    const sub = subtotal();
    const pares = paresEspuela();
    $("#resumen-barra").textContent = pedido.length ? `${pedido.length} ${pedido.length === 1 ? "producto" : "productos"} · ${pesos(sub)}` : "Tu pedido está vacío";
    $$("[data-contador-carrito]").forEach((el) => { el.textContent = pedido.length; el.hidden = !pedido.length; });
    if (panel.hidden) return;

    const cont = $("#lineas-pedido");
    if (!pedido.length) {
      cont.innerHTML = `<p class="vacio">Tu pedido está vacío. Agrega productos desde el catálogo o <a href="${enlaceWA()}" target="_blank" rel="noopener">pídelo por WhatsApp</a>.</p>`;
    } else {
      cont.innerHTML = pedido.map((l, i) => {
        const d = describirLinea(l), pr = precioLinea(l);
        return `<div class="linea"><span class="linea__nombre">${d.nombre}</span><span class="linea__total">${pesos(pr.total)}</span>
          <span class="linea__detalle">${[d.base, pr.unitario && prod(l.producto).tipo !== "variantes" ? `${pesos(pr.unitario)} c/u` : "", `<span class="linea__peso">${textoPeso(C.pesoGramos([l]) - 100)}</span>`].filter(Boolean).join(" · ")}</span>
          <div class="linea__acciones">
            <div class="cantidad" role="group" aria-label="Cantidad de ${d.nombre}">
              <button type="button" data-menos="${i}" aria-label="Quitar uno">−</button>
              <input type="number" min="1" inputmode="numeric" value="${l.cantidad}" data-cantidad="${i}" aria-label="Cantidad">
              <button type="button" data-mas="${i}" aria-label="Agregar uno">+</button>
            </div>
            <button class="linea__quitar" type="button" data-quitar="${i}" aria-label="Quitar ${d.nombre} del pedido">Quitar</button>
          </div></div>`;
      }).join("");
      const cambiar = (i, n) => {
        if (n <= 0) pedido.splice(i, 1);
        else pedido[i].cantidad = Math.min(C.MAX_CANTIDAD, n);
        if (n > C.MAX_CANTIDAD) $("#error-formulario").textContent = `Por la página se pueden pedir hasta ${C.MAX_CANTIDAD.toLocaleString("es-CO")} por producto. Para más, escríbenos por WhatsApp.`;
        guardar(); pintarPedido();
      };
      $$("[data-quitar]", cont).forEach((b) => b.addEventListener("click", () => cambiar(Number(b.dataset.quitar), 0)));
      $$("[data-menos]", cont).forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.menos); cambiar(i, pedido[i].cantidad - 1); }));
      $$("[data-mas]", cont).forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.mas); cambiar(i, pedido[i].cantidad + 1); }));
      $$("[data-cantidad]", cont).forEach((inp) => inp.addEventListener("change", () => cambiar(Number(inp.dataset.cantidad), Math.max(0, parseInt(inp.value, 10) || 0))));
    }

    const sug = sugerencias();
    const cajaSug = $("#sugerencias");
    cajaSug.innerHTML = sug.map((s, i) => `<div class="sugerencia"><p class="sugerencia__texto">${s.texto}</p>${s.boton ? `<button type="button" data-sug="${i}">${s.boton}</button>` : ""}</div>`).join("");
    $$("[data-sug]", cajaSug).forEach((b) => b.addEventListener("click", () => sug[Number(b.dataset.sug)].accion()));

    const regalo = regaloPara(pares);
    const nivel = pares ? nivelPara(pares) : null;
    $("#totales").innerHTML = `
      ${nivel ? `<div><span>Precio de espuela aplicado</span><strong>${nivel.nombre} (${pares} pares)</strong></div>` : ""}
      ${regalo ? `<div><span>Regalo</span><strong>${regalo.pares} pares de patapioja</strong></div>` : ""}
      <div class="total"><span>Subtotal productos</span><span>${pesos(sub)}</span></div>
      ${pedido.length ? `<div><span>Peso aproximado del paquete</span><span>${textoPeso(pesoGramos())}</span></div>` : ""}
      ${window.Moneda && !Moneda.esCOP() ? `<div class="totales__cop"><span>Se cobra en pesos colombianos</span><span>${pesosCOP(sub)} COP</span></div>` : ""}
      <div data-fila-envio><span>Envío</span><span data-envio aria-live="polite">—</span></div>
      <div class="total" data-fila-total hidden><span>Total a pagar</span><span data-total></span></div>`;
    pintarPagos();
    actualizarEnvio();
  }

  /* ---------- Envío en Colombia: cotización automática ---------- */
  let cotizacion = { clave: "", estado: "nada", datos: null };
  let temporizadorEnvio = null;
  const esColombia = () => !ubicacionPedido || ubicacionPedido.iso() === "CO";
  const pagoElegido = () => (($("#opciones-pago input[name=pago]:checked") || {}).value || "");
  const escapar = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const postalPedido = () => (($("#campo-postal") || {}).value || "").trim();
  const lineasClave = () => pedido.map((l) => [l.producto, l.cantidad, l.medida, l.presentacion, l.variante, l.color]);
  function claveEnvio() {
    const u = ubicacionPedido;
    if (!pedido.length || !u || !u.ciudad()) return "";
    if (esColombia()) return u.region() ? JSON.stringify(["CO", lineasClave(), u.region(), u.ciudad(), pagoElegido() === "Contraentrega"]) : "";
    if (!u.iso() || paisSinEnvio()) return "";
    return JSON.stringify([u.iso(), lineasClave(), u.region(), u.ciudad(), postalPedido()]);
  }
  // Envío internacional elegido por el cliente (de la última cotización): { id, nombre, usd, dias }
  let envioElegidoId = "";
  function envioElegido() {
    if (esColombia() || cotizacion.estado !== "listo" || cotizacion.clave !== claveEnvio()) return null;
    const ops = (cotizacion.datos && cotizacion.datos.opciones) || [];
    return ops.find((o) => o.id === envioElegidoId) || null;
  }
  function pintarOpcionesEnvio() {
    const caja = $("#opciones-envio");
    const ops = (cotizacion.datos && cotizacion.datos.opciones) || [];
    if (!ops.length) { caja.hidden = true; return; }
    if (!ops.some((o) => o.id === envioElegidoId)) envioElegidoId = ops.reduce((a, b) => (b.usd < a.usd ? b : a)).id;
    $("#lista-envios").innerHTML = ops.map((o) => `
      <label class="opcion opcion-envio"><input type="radio" name="envio" value="${escapar(o.id)}" ${o.id === envioElegidoId ? "checked" : ""}>
        <span class="opcion-envio__texto"><span>${escapar(o.nombre)}</span><small>${o.id === "dhl" ? `Con número de guía para rastrear${o.dias ? " · " + escapar(o.dias) : ""}` : "Lo coordinamos contigo por WhatsApp"}</small></span>
        <span class="opcion-envio__precio">USD ${escapar(o.usd)}</span></label>`).join("");
    const nota = $("#nota-impuestos");
    nota.hidden = !ops.some((o) => o.id === "dhl");
    nota.textContent = "Con DHL, los impuestos o trámites de aduana de tu país, si aplican, los paga quien recibe.";
    caja.hidden = false;
    $$("input[name=envio]", caja).forEach((r) => r.addEventListener("change", () => { envioElegidoId = r.value; pintarEnvio(); pintarPagos(); }));
  }
  function pintarEnvio() {
    const celda = $("[data-envio]"), filaTotal = $("[data-fila-total]");
    if (!celda) return;
    const contra = pagoElegido() === "Contraentrega";
    if (!esColombia()) {
      const caja = $("#opciones-envio");
      if (paisSinEnvio() || !pedido.length) { caja.hidden = true; celda.textContent = "—"; filaTotal.hidden = true; return; }
      if (cotizacion.estado === "cargando") { celda.textContent = "Calculando…"; filaTotal.hidden = true; return; }
      const o = envioElegido();
      if (o) {
        celda.innerHTML = `USD ${escapar(o.usd)} <small>${escapar(o.nombre)}${o.dias ? " · " + escapar(o.dias) : ""}</small>`;
        filaTotal.hidden = false;
        $("[data-total]").textContent = `${pesosCOP(subtotal())} COP + USD ${o.usd} de envío${paypalDirecto() ? " · PayPal te muestra el total exacto en dólares" : ""}`;
        return;
      }
      caja.hidden = true;
      filaTotal.hidden = true;
      if (cotizacion.estado === "error") { celda.textContent = cotizacion.datos; return; }
      celda.textContent = ENVIO_INTERNACIONAL_USD.dhl && ENVIO_INTERNACIONAL_USD.dhl.activo ? "Elige tu ciudad para calcularlo" : "Te lo cotizamos por WhatsApp";
      return;
    }
    if (cotizacion.estado === "cargando") { celda.textContent = "Calculando…"; filaTotal.hidden = true; return; }
    if (cotizacion.estado === "listo" && cotizacion.clave === claveEnvio()) {
      const d = cotizacion.datos;
      celda.innerHTML = `${pesos(d.valor)} <small>${escapar(d.transportadora)}${d.dias ? " · " + escapar(d.dias) : ""}${d.contraentrega ? " · incluye recaudo contraentrega" : ""}</small>`;
      filaTotal.hidden = false;
      $("[data-total]").textContent = contra ? `${pesos(d.valor)} ahora + ${pesos(subtotal())} al recibir` : pesos(subtotal() + d.valor);
      return;
    }
    if (cotizacion.estado === "error") { celda.textContent = cotizacion.datos; filaTotal.hidden = true; return; }
    celda.textContent = "Elige tu municipio para calcularlo";
    filaTotal.hidden = true;
  }
  function actualizarEnvio() {
    const clave = claveEnvio();
    if (!clave) { cotizacion = { clave: "", estado: "nada", datos: null }; pintarEnvio(); return; }
    if (clave === cotizacion.clave && cotizacion.estado !== "error") { pintarEnvio(); return; }
    cotizacion = { clave, estado: "cargando", datos: null };
    pintarEnvio();
    clearTimeout(temporizadorEnvio);
    temporizadorEnvio = setTimeout(async () => {
      try {
        const r = await fetch("/api/cotizar", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
          body: JSON.stringify(esColombia()
            ? { pedido, departamento: ubicacionPedido.region(), ciudad: ubicacionPedido.ciudad(), pago: pagoElegido() === "Contraentrega" ? "contraentrega" : "en_linea" }
            : { pedido, pais: isoPedido(), destino: { region: ubicacionPedido.region(), ciudad: ubicacionPedido.ciudad(), postal: postalPedido() } }),
        });
        const d = await r.json().catch(() => ({ ok: false, error: r.status === 429 ? "Muchas consultas seguidas. Espera un minuto." : "No pudimos calcular el envío." }));
        if (cotizacion.clave !== clave) return;
        cotizacion = d.ok ? { clave, estado: "listo", datos: d } : { clave, estado: "error", datos: d.error || "No pudimos calcular el envío." };
      } catch (e) {
        if (cotizacion.clave !== clave) return;
        cotizacion = { clave, estado: "error", datos: "No pudimos calcular el envío. Revisa tu conexión." };
      }
      if (!esColombia()) { pintarOpcionesEnvio(); pintarPagos(); }
      pintarEnvio();
    }, 400);
  }

  $("#formulario-pedido").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, error = $("#error-formulario");
    if (!pedido.length) { error.textContent = "Agrega al menos un producto para confirmar tu pedido."; return; }
    const fallar = (msg, campo) => { error.textContent = msg; if (campo) campo.focus(); };
    const faltan = $$("input[required]:not([type=checkbox])", f).filter((i) => !i.closest("[hidden]") && !i.value.trim());
    if (faltan.length) return fallar("Completa todos los datos de envío para confirmar.", faltan[0]);
    const u = ubicacionPedido;
    if (u && !u.iso()) return fallar("Elige tu país.", $("#campo-pais-otro"));
    if (paisSinEnvio()) return fallar(AVISO_SIN_ENVIO(paisSinEnvio()), $("#campo-pais-otro"));
    const cel = u ? u.celular() : { ok: true, numeroE164: $("#campo-celular").value };
    if (!cel.ok) return fallar(cel.mensaje, $("#campo-celular"));
    if (u && !u.region()) return fallar("Elige tu departamento, provincia o estado.", $("#campo-region"));
    if (u && !u.ciudad()) return fallar("Elige o escribe tu ciudad.", $("#campo-ciudad"));
    const correo = ($("#campo-correo") || {}).value ? $("#campo-correo").value.trim() : "";
    if (correo && !/^[^\s@<>"']{1,64}@[^\s@<>"']{1,180}\.[a-z]{2,}$/i.test(correo)) return fallar("Revisa tu correo (o déjalo vacío).", $("#campo-correo"));
    if (!$("#pedido-acepto").checked) return fallar("Para confirmar, autoriza el tratamiento de tus datos.", $("#pedido-acepto"));
    error.textContent = "";
    const d = Object.fromEntries(new FormData(f));
    const paisNombre = u ? u.paisNombre() : "Colombia";
    const pares = paresEspuela(), regalo = regaloPara(pares);
    const lineas = pedido.map((l) => { const x = describirLinea(l); return `• ${x.nombre}: ${x.detalle} = ${pesosCOP(precioLinea(l).total)}`; });
    const texto = [
      "Hola, quiero confirmar este pedido desde la página:",
      ...lineas,
      regalo ? `Regalo: ${regalo.pares} pares de patapioja sintética` : "",
      `Subtotal: ${pesosCOP(subtotal())} COP${window.Moneda && !Moneda.esCOP() ? ` (${Moneda.formatear(subtotal())})` : ""}`,
      `Pago: ${d.pago}`,
      envioTexto(paisNombre).texto,
      "",
      `Nombre: ${d.nombre}`, `Documento: ${d.documento}`, `Celular: ${cel.numeroE164}`, d.correo ? `Correo: ${d.correo.trim()}` : "",
      `País: ${paisNombre}`, `Región: ${u ? u.region() : ""}`, `Ciudad: ${u ? u.ciudad() : ""}`, `Dirección: ${d.direccion}`,
    ].filter(Boolean).join("\n");
    // En Colombia: pago en línea o contraentrega por Mercado Pago (el servidor recalcula precios y envío)
    if (esColombia() && ((d.pago || "").startsWith("Pago en línea") || d.pago === "Contraentrega")) {
      irAPagar(d, cel.numeroE164, texto);
      return;
    }
    // Otros países: PayPal directo, en dólares, con el envío elegido (propio en Panamá y Costa Rica, o DHL)
    if (!esColombia() && d.pago === "PayPal" && paypalDirecto()) {
      if (!envioElegido()) return fallar(cotizacion.estado === "cargando" ? "Estamos calculando el envío, espera un momento." : "Elige tu ciudad para calcular el envío.", $("#campo-ciudad"));
      irAPaypal(d, cel.numeroE164, texto);
      return;
    }
    window.Medicion && Medicion.evento("InitiateCheckout", { value: Math.round(subtotal()), num_items: pedido.length, content_ids: [...new Set(pedido.map((l) => l.producto))] });
    window.open(enlaceWA(texto), "_blank", "noopener");
  });

  /* ---------- Completar el pedido por WhatsApp (sin llenar el formulario) ---------- */
  // Manda el carrito armado y, si ya los escribió, el nombre y el destino. La venta se cierra por chat.
  function textoCarritoWA() {
    const f = $("#formulario-pedido"), u = ubicacionPedido;
    const valor = (n) => ((f.elements[n] || {}).value || "").trim();
    const pares = paresEspuela(), regalo = regaloPara(pares), sub = subtotal();
    const pais = u ? u.paisNombre() : "Colombia";
    const destino = [u ? u.ciudad() : "", u ? u.region() : "", pais].filter(Boolean).join(", ");
    return [
      "Hola, quiero completar este pedido por WhatsApp:",
      ...pedido.map((l) => { const x = describirLinea(l); return `• ${x.nombre}: ${x.detalle} = ${pesosCOP(precioLinea(l).total)}`; }),
      regalo ? `Regalo: ${regalo.pares} pares de patapioja sintética` : "",
      `Subtotal: ${pesosCOP(sub)} COP${window.Moneda && !Moneda.esCOP() ? ` (${Moneda.formatear(sub)})` : ""}`,
      `Envío a: ${destino}`,
      valor("nombre") ? `Nombre: ${valor("nombre")}` : "",
    ].filter(Boolean).join("\n");
  }
  $("#boton-carrito-wa").addEventListener("click", () => {
    if (!pedido.length) return;
    window.Medicion && Medicion.evento("Contact", { content_name: "WhatsApp desde el carrito", value: Math.round(subtotal()), num_items: pedido.length });
    window.open(enlaceWA(textoCarritoWA()), "_blank", "noopener");
  });

  /* ---------- Turnstile: comprobación anti-robots de Cloudflare (solo si está configurada en datos.js) ---------- */
  // Se prepara apenas se abre el pedido (por cualquier botón), se ve como una cajita "Verificando… / Éxito"
  // y, si falla, el cliente ve un mensaje claro.
  let turnstileId = null, turnstileListo = null, turnstileError = "";
  function prepararTurnstile() {
    if (!NEGOCIO.turnstile || turnstileListo) return turnstileListo;
    turnstileListo = new Promise((ok) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => {
        const caja = document.createElement("div");
        caja.id = "verificacion-robot";
        $("#boton-confirmar").before(caja);
        turnstileId = window.turnstile.render(caja, {
          sitekey: NEGOCIO.turnstile, appearance: "always", size: "flexible", language: "es",
          callback: () => { turnstileError = ""; },
          "error-callback": (codigo) => { turnstileError = String(codigo || "error"); console.warn("Turnstile", codigo); },
          "expired-callback": () => window.turnstile.reset(turnstileId),
        });
        ok();
      };
      s.onerror = () => { turnstileError = "no-cargo"; ok(); };
      document.head.appendChild(s);
    });
    return turnstileListo;
  }
  document.addEventListener("ie:panel-abierto", () => setTimeout(prepararTurnstile, 0));
  async function tokenTurnstile(etiqueta) {
    if (!NEGOCIO.turnstile) return "";
    await prepararTurnstile();
    if (turnstileError === "no-cargo" || !window.turnstile || turnstileId === null)
      throw new Error("No cargó la verificación de seguridad (puede ser un bloqueador de anuncios). Desactívalo para esta página o escríbenos por WhatsApp.");
    etiqueta.textContent = "Verificando que no eres un robot…";
    for (let i = 0; i < 80; i++) {
      const t = window.turnstile.getResponse(turnstileId);
      if (t) return t;
      if (turnstileError) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("No pudimos completar la verificación de seguridad. Si ves la casilla arriba del botón, márcala; si no, recarga la página.");
  }

  async function irAPagar(d, celular, textoWA) {
    const boton = $("#boton-confirmar"), etiqueta = $("#boton-confirmar-texto"), error = $("#error-formulario");
    const textoAntes = etiqueta.textContent;
    const contra = d.pago === "Contraentrega";
    // Total que el cliente tiene en pantalla: el servidor lo compara con el que va a cobrar
    const totalVisto = cotizacion.estado === "listo" && cotizacion.datos ? (contra ? cotizacion.datos.valor : Math.round(subtotal()) + cotizacion.datos.valor) : undefined;
    boton.disabled = true; etiqueta.textContent = "Abriendo el pago seguro…";
    try {
      const verificacion = await tokenTurnstile(etiqueta);
      etiqueta.textContent = "Abriendo el pago seguro…";
      let r;
      try {
        r = await fetch("/api/pedido", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined,
          body: JSON.stringify({
            verificacion, totalVisto,
            pedido, pago: contra ? "contraentrega" : "en_linea", acepto: $("#pedido-acepto").checked,
            cliente: { nombre: d.nombre, documento: d.documento, celular, correo: (d.correo || "").trim(), departamento: ubicacionPedido.region(), ciudad: ubicacionPedido.ciudad(), direccion: d.direccion },
          }),
        });
      } catch (e) { throw new Error("La conexión tardó demasiado."); }
      const res = await r.json().catch(() => ({ ok: false, error: r.status === 429 ? "Muchos intentos seguidos. Espera un minuto." : "No pudimos abrir el pago en este momento." }));
      if (r.status === 409 && res.cambio) {
        // El envío o un precio cambió: se actualiza en pantalla y el cliente confirma de nuevo
        if (res.envio && cotizacion.datos) { cotizacion.datos = { ...cotizacion.datos, valor: res.envio.valor }; pintarEnvio(); }
        throw new Error(res.error);
      }
      if (!res.ok || !res.url || !/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//.test(res.url)) throw new Error(res.error || "No pudimos abrir el pago.");
      try { sessionStorage.setItem("ie-ultimo-pedido", JSON.stringify({ pedido: res.pedido, total: res.total })); } catch (e) {}
      window.Medicion && Medicion.evento("InitiateCheckout", { value: res.total, num_items: pedido.length, content_ids: [...new Set(pedido.map((l) => l.producto))] });
      location.href = res.url;
    } catch (e) {
      error.innerHTML = `${escapar(e.message)} <a class="error__wa" href="${enlaceWA(textoWA)}" target="_blank" rel="noopener">Enviar este pedido por WhatsApp</a>`;
      // Un código de Turnstile sirve una sola vez: siempre se pide uno nuevo para el siguiente intento
      if (window.turnstile && turnstileId !== null) { turnstileError = ""; window.turnstile.reset(turnstileId); }
      boton.disabled = false; etiqueta.textContent = textoAntes;
    }
  }
  async function irAPaypal(d, celular, textoWA) {
    const boton = $("#boton-confirmar"), etiqueta = $("#boton-confirmar-texto"), error = $("#error-formulario");
    const textoAntes = etiqueta.textContent;
    boton.disabled = true; etiqueta.textContent = "Abriendo PayPal…";
    try {
      const verificacion = await tokenTurnstile(etiqueta);
      etiqueta.textContent = "Abriendo PayPal…";
      let r;
      try {
        r = await fetch("/api/paypal/crear", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined,
          body: JSON.stringify({
            verificacion, pedido, acepto: $("#pedido-acepto").checked,
            envio: (envioElegido() || {}).id, envioUSD: (envioElegido() || {}).usd,
            cliente: { nombre: d.nombre, documento: d.documento, celular, correo: (d.correo || "").trim(), pais: isoPedido(), region: ubicacionPedido.region(), ciudad: ubicacionPedido.ciudad(), postal: postalPedido(), direccion: d.direccion },
          }),
        });
      } catch (e) { throw new Error("La conexión tardó demasiado."); }
      const res = await r.json().catch(() => ({ ok: false, error: r.status === 429 ? "Muchos intentos seguidos. Espera un minuto." : "No pudimos abrir PayPal en este momento." }));
      // El valor del envío cambió desde que se mostró: se actualiza y el cliente confirma de nuevo
      if (res.cambio && Array.isArray(res.opciones) && cotizacion.datos) { cotizacion.datos.opciones = res.opciones; pintarOpcionesEnvio(); pintarEnvio(); }
      if (!res.ok || !res.url || !/^https:\/\/(www\.)?(sandbox\.)?paypal\.com\//.test(res.url)) throw new Error(res.error || "No pudimos abrir PayPal.");
      try { sessionStorage.setItem("ie-ultimo-pedido", JSON.stringify({ pedido: res.pedido, total: res.total, moneda: "USD" })); } catch (e) {}
      window.Medicion && Medicion.evento("InitiateCheckout", { value: res.total, currency: "USD", num_items: pedido.length, content_ids: [...new Set(pedido.map((l) => l.producto))] });
      location.href = res.url;
    } catch (e) {
      error.innerHTML = `${escapar(e.message)} <a class="error__wa" href="${enlaceWA(textoWA)}" target="_blank" rel="noopener">Enviar este pedido por WhatsApp</a>`;
      if (window.turnstile && turnstileId !== null) { turnstileError = ""; window.turnstile.reset(turnstileId); }
      boton.disabled = false; etiqueta.textContent = textoAntes;
    }
  }
  if (typeof PAYPAL !== "undefined" && PAYPAL.activo && $("#aviso-pago")) {
    $("#aviso-pago").textContent = "En Colombia pagas aquí mismo con Mercado Pago. Desde otros países pagas aquí mismo con PayPal, en dólares, con envío por DHL Express (en Panamá y Costa Rica también puedes elegir nuestro envío propio). Si prefieres Western Union, te enviamos los datos por WhatsApp.";
  }
  // Si el cliente vuelve con "Atrás" desde Mercado Pago, el botón no queda bloqueado
  addEventListener("pageshow", (e) => { if (e.persisted) { $("#boton-confirmar").disabled = Boolean(paisSinEnvio()); textoConfirmar(); } });

  pintarPedido();

  // Cambio de moneda: se vuelven a pintar todos los precios
  function pintarDatos() {
    const datos = {
      caja: pesos(AJUSTE_EMPAQUE.caja), granel: pesos(Math.abs(AJUSTE_EMPAQUE.granel)), contraentrega: pesosCOP(CONTRAENTREGA_MINIMO),
      "envio-base": `USD ${ENVIO_INTERNACIONAL_USD.base}`, "envio-extra": `USD ${ENVIO_INTERNACIONAL_USD.porMedioKiloExtra}`, "envio-ecuador": ENVIO_INTERNACIONAL_USD.ecuador,
    };
    $$("[data-dato]").forEach((el) => { if (datos[el.dataset.dato] !== undefined) el.textContent = datos[el.dataset.dato]; });
  }
  pintarDatos();
  document.addEventListener("moneda:cambio", () => {
    pintarDatos();
    pintarCatalogo();
    pintarTabla();
    pintarPedido();
    if (!ficha.hidden && fichaProducto) actualizarPrecioFicha();
  });

  // Para otros módulos (buscador, ayuda)
  window.IE = { abrirFicha, abrirPanel };

  // Si llegan desde la página de un producto (?producto=id), se abre su ficha
  try {
    const desde = new URLSearchParams(location.search).get("producto");
    if (desde && prod(desde)) setTimeout(() => abrirFicha(desde), 300);
  } catch (e) {}

})();
