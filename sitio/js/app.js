(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");
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

  const nivelPara = (pares) => [...NIVELES].reverse().find((n) => pares >= n.desde) || NIVELES[0];
  const siguienteNivel = (pares) => NIVELES.find((n) => n.desde > pares);
  const paresEspuela = (lista = pedido) => lista.filter((l) => prod(l.producto).tipo === "espuela").reduce((s, l) => s + l.cantidad, 0);
  const paresPatapioja = (lista = pedido) => lista.filter((l) => l.producto === "patapioja").reduce((s, l) => s + l.cantidad, 0);
  const precioParPatapioja = (pares) => [...prod("patapioja").tramos].reverse().find((t) => pares >= t.desde).precio;

  function precioLinea(l, lista = pedido) {
    const p = prod(l.producto);
    if (p.tipo === "espuela") {
      const nivel = nivelPara(paresEspuela(lista));
      const ajuste = PRESENTACIONES.find((x) => x.id === l.presentacion).ajuste;
      const unitario = p.precios[nivel.id] + ajuste;
      return { unitario, total: unitario * l.cantidad };
    }
    if (p.tipo === "patapioja") {
      const unitario = precioParPatapioja(paresPatapioja(lista));
      return { unitario, total: Math.round(unitario * l.cantidad) };
    }
    if (p.tipo === "unidad-docena") {
      const v = p.variantes.find((x) => x.id === l.variante);
      const total = Math.floor(l.cantidad / 12) * v.docena + (l.cantidad % 12) * v.unidad;
      return { unitario: null, total };
    }
    const v = p.variantes.find((x) => x.id === l.variante);
    return { unitario: v.precio, total: v.precio * l.cantidad };
  }
  const subtotal = (lista = pedido) => lista.reduce((s, l) => s + precioLinea(l, lista).total, 0);

  function pesoGramos() {
    let g = 100; // empaque
    pedido.forEach((l) => {
      const p = prod(l.producto);
      if (p.tipo === "espuela") g += l.cantidad * (p.pesoPar + (l.presentacion === "caja" ? 1 : 0));
      else if (p.tipo === "patapioja") g += l.cantidad * p.pesoPar;
      else g += l.cantidad * p.variantes.find((x) => x.id === l.variante).peso;
    });
    return g;
  }

  const regaloPara = (pares) => [...REGALOS].reverse().find((r) => pares >= r.desde);

  function describirLinea(l) {
    const p = prod(l.producto);
    if (p.tipo === "espuela") {
      const pres = PRESENTACIONES.find((x) => x.id === l.presentacion).nombre.toLowerCase();
      return { nombre: p.nombre, detalle: `${medidaTexto(l.medida)} · ${pres} · ${l.cantidad} pares` };
    }
    if (p.tipo === "patapioja") {
      const c = p.colores.find((x) => x.id === l.color).nombre;
      return { nombre: `${p.nombre} ${c.toLowerCase()}`, detalle: `${l.cantidad} pares` };
    }
    const v = p.variantes.find((x) => x.id === l.variante);
    if (p.tipo === "unidad-docena") {
      const plural = p.unidad === "barra" ? "barras" : "pares";
      return { nombre: `${p.nombre} ${v.nombre.toLowerCase()}`, detalle: `${l.cantidad} ${plural}` };
    }
    return { nombre: `${p.nombre} ${v.nombre}`, detalle: `${l.cantidad} ${l.cantidad === 1 ? "unidad" : "unidades"}` };
  }

  function agregar(linea) {
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
    for (const e of EXTENSIONES) { const r = await probar(`fotos/${id}/${n}.${e}`); if (r) return r; }
    return null;
  }
  async function fotosDe(id) {
    if (cacheFotos[id]) return cacheFotos[id];
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

  function precioDesde(p) {
    if (p.tipo === "espuela") return `Desde <strong>${pesos(p.precios.gran_distribuidor - 200)}</strong> el par`;
    if (p.tipo === "patapioja") return `Desde <strong>${pesos(1300)}</strong> el par`;
    if (p.tipo === "unidad-docena") return `Desde <strong>${pesos(Math.min(...p.variantes.map((v) => v.docena / 12)))}</strong> ${p.unidad === "barra" ? "la barra" : "el par"} por docena`;
    return `Desde <strong>${pesos(Math.min(...p.variantes.map((v) => v.precio)))}</strong>`;
  }

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
        </div>
      </article>`;
  }

  $("#lista-productos").innerHTML = PRODUCTOS.map(tarjeta).join("");
  $$(".producto").forEach((card) => {
    const id = card.dataset.producto;
    buscarFoto(id, 1).then((f) => {
      if (f) $(".producto__foto", card).innerHTML = `<img src="${f}" alt="${prod(id).nombre}" loading="lazy" decoding="async" width="600" height="600">`;
    });
    card.addEventListener("click", () => abrirFicha(id));
  });

  /* ---------- Ficha de producto (pantalla grande) ---------- */
  const ficha = $("#ficha");
  let fichaFotos = [], fichaIndice = 0, fichaProducto = null, focoAntesFicha = null;

  function camposFicha(p) {
    if (p.tipo === "espuela") return `
      <label class="campo">Medida<select name="medida">${opciones(p.medidas, (m) => m, medidaTexto)}</select></label>
      <label class="campo">Presentación<select name="presentacion">${opciones(PRESENTACIONES, (x) => x.id, (x) => `${x.nombre}${x.ajuste ? ` (${x.ajuste > 0 ? "+" : "−"}${pesos(Math.abs(x.ajuste))})` : ""}`)}</select></label>
      <label class="campo campo--ancho">Cantidad de pares<input name="cantidad" type="number" min="1" value="12" inputmode="numeric"></label>`;
    if (p.tipo === "patapioja") return `
      <label class="campo">Color<select name="color">${opciones(p.colores, (c) => c.id, (c) => `${c.nombre}: ${c.nota}`)}</select></label>
      <label class="campo">Cantidad de pares<input name="cantidad" type="number" min="1" value="12" inputmode="numeric"></label>`;
    if (p.tipo === "unidad-docena") return `
      <label class="campo">Tipo<select name="variante">${opciones(p.variantes, (v) => v.id, (v) => v.nombre)}</select></label>
      <label class="campo">Cantidad (${p.unidad === "barra" ? "barras" : "pares"})<input name="cantidad" type="number" min="1" value="12" inputmode="numeric"></label>`;
    return `
      <label class="campo campo--ancho">${p.etiquetaVariante || "Tipo"}<select name="variante">${opciones(p.variantes, (v) => v.id, (v) => `${v.nombre} · ${pesos(v.precio)}`)}</select></label>
      <label class="campo">Cantidad<input name="cantidad" type="number" min="1" value="1" inputmode="numeric"></label>`;
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
    agregar(lineaDesdeFormulario(e.target, fichaProducto.id));
    actualizarPrecioFicha();
    const aviso = $("#ficha-agregado");
    aviso.innerHTML = `Agregado a tu pedido. <a href="#" data-ver>Ver pedido</a>`;
    $("[data-ver]", aviso).addEventListener("click", (ev) => { ev.preventDefault(); cerrarFicha(); abrirPanel(); });
  });

  /* ---------- Tabla de precios y regalos ---------- */
  const espuelas = PRODUCTOS.filter((p) => p.tipo === "espuela");
  const rango = (i) => (NIVELES[i + 1] ? `${NIVELES[i].desde} a ${NIVELES[i + 1].desde - 1} pares` : `${NIVELES[i].desde} pares o más`);
  $("#tabla-precios").innerHTML = `
    <thead><tr><th>Referencia</th>${NIVELES.map((n, i) => `<th>${n.nombre}<small>${rango(i)}</small></th>`).join("")}</tr></thead>
    <tbody>${espuelas.map((p) => `<tr><td>${p.nombre}</td>${NIVELES.map((n) => `<td>${pesos(p.precios[n.id])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $("#texto-regalos").textContent = "Te regalamos patapioja sintética según los pares de espuela de tu pedido: " +
    REGALOS.map((r) => `${r.pares} pares desde ${r.desde.toLocaleString("es-CO")}`).join(", ") + ".";

  /* ---------- Panel del pedido ---------- */
  const panel = $("#panel-pedido");
  let ultimoFoco = null;
  function abrirPanel() { ultimoFoco = document.activeElement; panel.hidden = false; pintarPedido(); $(".panel__cerrar").focus(); document.body.style.overflow = "hidden"; }
  function cerrarPanel() { panel.hidden = true; document.body.style.overflow = ""; if (ultimoFoco) ultimoFoco.focus(); }
  $("#abrir-pedido").addEventListener("click", abrirPanel);
  $$("[data-cerrar]", panel).forEach((b) => b.addEventListener("click", cerrarPanel));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) cerrarPanel(); });

  function envioTexto(pais) {
    if (pais === "Colombia") return { texto: "El costo del envío depende de tu ciudad. Te lo confirmamos por WhatsApp antes de pagar." };
    const regla = ENVIOS_INTERNACIONALES[pais];
    const kg = pesoGramos() / 1000;
    if (regla && regla.tipo === "formula") {
      const usd = 25 + 6 * Math.ceil(Math.max(0, kg - 1) / 0.5);
      return { texto: `Envío puerta a puerta a ${pais}: aprox. USD ${usd} (peso estimado ${kg.toFixed(2)} kg).`, usd };
    }
    if (regla) return { texto: `Envío a ${pais}: ${regla.texto}. Te confirmamos el valor exacto por WhatsApp.` };
    return { texto: `Envío a ${pais}: te cotizamos por WhatsApp según el peso (aprox. ${kg.toFixed(2)} kg).` };
  }

  function pintarPagos() {
    const pais = ubicacionPedido ? ubicacionPedido.paisNombre() : "Colombia";
    const caja = $("#opciones-pago");
    const sub = subtotal();
    if (pais === "Colombia") {
      const habilitada = sub >= NEGOCIO.contraentregaMinimo;
      caja.innerHTML = `<legend>¿Cómo quieres pagar?</legend>
        <label class="opcion"><input type="radio" name="pago" value="Pago en línea (PSE, tarjeta, Efecty)" checked> Pago en línea: PSE, tarjeta o Efecty</label>
        <label class="opcion" aria-disabled="${!habilitada}"><input type="radio" name="pago" value="Contraentrega" ${habilitada ? "" : "disabled"}> Contraentrega: pagas el envío en línea y los productos al recibir${habilitada ? "" : ` (desde ${pesos(NEGOCIO.contraentregaMinimo)})`}</label>`;
    } else {
      caja.innerHTML = `<legend>¿Cómo quieres pagar?</legend>
        <label class="opcion"><input type="radio" name="pago" value="PayPal" checked> PayPal</label>
        <label class="opcion"><input type="radio" name="pago" value="Western Union"> Western Union</label>`;
    }
    $("#nota-envio").textContent = envioTexto(pais).texto;
  }
  // País, indicativo, departamento y municipio del pedido
  const ubicacionPedido = window.Ubicacion ? window.Ubicacion.conectar({
    pais: $("#campo-pais"), paisOtro: $("#campo-pais-otro"), indicativo: $("#campo-indicativo"), celular: $("#campo-celular"),
    region: $("#campo-region"), regionLibre: $("#campo-region-libre"), ciudad: $("#campo-ciudad"), ciudadOtra: $("#campo-ciudad-otra"),
    alCambiar: () => { if (!panel.hidden) pintarPagos(); },
  }) : null;

  function pintarPedido() {
    const sub = subtotal();
    const pares = paresEspuela();
    $("#resumen-barra").textContent = pedido.length ? `${pedido.length} ${pedido.length === 1 ? "producto" : "productos"} · ${pesos(sub)}` : "Tu pedido está vacío";
    if (panel.hidden) return;

    const cont = $("#lineas-pedido");
    if (!pedido.length) {
      cont.innerHTML = `<p class="vacio">Tu pedido está vacío. Agrega productos desde el catálogo o <a href="${enlaceWA()}" target="_blank" rel="noopener">pídelo por WhatsApp</a>.</p>`;
    } else {
      cont.innerHTML = pedido.map((l, i) => {
        const d = describirLinea(l), pr = precioLinea(l);
        return `<div class="linea"><span class="linea__nombre">${d.nombre}</span><span class="linea__total">${pesos(pr.total)}</span>
          <span class="linea__detalle">${d.detalle}${pr.unitario && prod(l.producto).tipo !== "variantes" ? ` · ${pesos(pr.unitario)} c/u` : ""}</span>
          <button class="linea__quitar" type="button" data-quitar="${i}">Quitar</button></div>`;
      }).join("");
      $$("[data-quitar]", cont).forEach((b) => b.addEventListener("click", () => { pedido.splice(Number(b.dataset.quitar), 1); guardar(); pintarPedido(); }));
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
      <div><span>Envío</span><span>Se confirma antes de pagar</span></div>`;
    pintarPagos();
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
    const cel = u ? u.celular() : { ok: true, numeroE164: $("#campo-celular").value };
    if (!cel.ok) return fallar(cel.mensaje, $("#campo-celular"));
    if (u && !u.region()) return fallar("Elige tu departamento, provincia o estado.", $("#campo-region"));
    if (u && !u.ciudad()) return fallar("Elige o escribe tu ciudad.", $("#campo-ciudad"));
    if (!$("#pedido-acepto").checked) return fallar("Para confirmar, autoriza el tratamiento de tus datos.", $("#pedido-acepto"));
    error.textContent = "";
    const d = Object.fromEntries(new FormData(f));
    const paisNombre = u ? u.paisNombre() : "Colombia";
    const pares = paresEspuela(), regalo = regaloPara(pares);
    const lineas = pedido.map((l) => { const x = describirLinea(l); return `• ${x.nombre}: ${x.detalle} = ${pesos(precioLinea(l).total)}`; });
    const texto = [
      "Hola, quiero confirmar este pedido desde la página:",
      ...lineas,
      regalo ? `Regalo: ${regalo.pares} pares de patapioja sintética` : "",
      `Subtotal: ${pesos(subtotal())}`,
      `Pago: ${d.pago}`,
      envioTexto(paisNombre).texto,
      "",
      `Nombre: ${d.nombre}`, `Documento: ${d.documento}`, `Celular: ${cel.numeroE164}`,
      `País: ${paisNombre}`, `Región: ${u ? u.region() : ""}`, `Ciudad: ${u ? u.ciudad() : ""}`, `Dirección: ${d.direccion}`,
    ].filter(Boolean).join("\n");
    window.open(enlaceWA(texto), "_blank", "noopener");
  });

  pintarPedido();

})();
