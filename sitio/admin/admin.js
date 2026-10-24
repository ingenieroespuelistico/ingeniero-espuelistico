// App de pedidos de Ingeniero Espuelístico (para el celular del dueño).
// Los datos vienen de /api/admin/* (protegido con la clave ADMIN_CLAVE). Nada de esto se ve en la tienda.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pesos = (n) => { const v = Math.round(Number(n) || 0); return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("es-CO"); };
  const valor = (p) => (p.m === "USD" ? `USD ${Number(p.t || 0).toFixed(2)}` : pesos(p.v || p.t));
  const dineroP = (p, n) => (p.moneda === "USD" ? `USD ${Number(n || 0).toFixed(2)}` : pesos(n));
  const zona = { timeZone: "America/Bogota" };
  const fecha = (iso, op = { day: "numeric", month: "short" }) => { try { return new Intl.DateTimeFormat("es-CO", { ...zona, ...op }).format(new Date(iso)); } catch (e) { return ""; } };
  const fechaHora = (iso) => fecha(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const mesDe = (iso) => fecha(iso, { year: "numeric", month: "2-digit" });
  const corto = (id) => String(id || "").slice(-6);
  const soloDigitos = (t) => String(t || "").replace(/\D/g, "");
  const PAGADOS = ["por_despachar", "despachado", "entregado"];

  let ETAPAS = {};
  let pedidos = [];
  let pqrAbiertas = 0;
  let clientes = null;

  /* ---------- Servidor ---------- */
  async function api(ruta, opciones = {}) {
    const r = await fetch(`/api/admin/${ruta}`, { credentials: "same-origin", cache: "no-store", ...opciones });
    const d = await r.json().catch(() => ({ ok: false, error: "Respuesta inválida del servidor" }));
    if (r.status === 401 && ruta !== "entrar") { mostrarEntrada(); throw new Error(d.error || "Entra de nuevo"); }
    if (!r.ok || !d.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }
  const enviar = (ruta, cuerpo) => api(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });

  let temporizadorAviso = null;
  function aviso(texto, ms = 2600) {
    const a = $("#aviso"); a.textContent = texto; a.hidden = false;
    clearTimeout(temporizadorAviso); temporizadorAviso = setTimeout(() => { a.hidden = true; }, ms);
  }

  /* ---------- Entrada ---------- */
  function mostrarEntrada() { $("#app").hidden = true; $("#entrada").hidden = false; setTimeout(() => $("#clave").focus(), 50); }
  $("#form-entrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = $("#form-entrar button"); boton.disabled = true; $("#error-entrar").textContent = "";
    try {
      await enviar("entrar", { clave: $("#clave").value });
      $("#clave").value = ""; $("#entrada").hidden = true;
      await iniciar();
    } catch (err) { $("#error-entrar").textContent = err.message; }
    boton.disabled = false;
  });

  async function cargar() {
    const d = await api("inicio");
    ETAPAS = d.etapas; pedidos = d.pedidos; pqrAbiertas = d.pqrAbiertas || 0;
  }
  async function iniciar() {
    try { await cargar(); } catch (e) { if ($("#entrada").hidden) aviso(e.message); return; }
    $("#app").hidden = false;
    pintar();
  }
  $("#recargar").addEventListener("click", async () => { try { await cargar(); clientes = null; pintar(); aviso("Actualizado"); } catch (e) { aviso(e.message); } });

  /* ---------- Rutas (#hoy, #pedidos, #pedido=ID, #clientes, #cliente=CEL, #nuevo) ---------- */
  function ruta() { const h = location.hash.slice(1); const [k, v] = h.split("="); return { k: k || "hoy", v: v ? decodeURIComponent(v) : "" }; }
  addEventListener("hashchange", () => { if (!$("#app").hidden) pintar(); });
  function pintar() {
    const { k, v } = ruta();
    const seccion = { pedido: "pedidos", cliente: "clientes", pqrs: "hoy", pqr: "hoy" }[k] || k;
    $$(".menu a").forEach((a) => { if (a.dataset.seccion === seccion) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    const vistas = { hoy: vistaHoy, pedidos: vistaPedidos, pedido: () => vistaPedido(v), clientes: vistaClientes, cliente: () => vistaCliente(v), nuevo: vistaNuevo, pqrs: vistaPQRs, pqr: () => vistaPQR(v) };
    (vistas[k] || vistaHoy)();
    scrollTo(0, 0);
  }
  const titulo = (t) => { $("#titulo").textContent = t; document.title = `${t} · Pedidos`; };
  const vista = (html) => { $("#vista").innerHTML = html; };

  /* ---------- Piezas ---------- */
  const etiqueta = (e) => `<span class="etiqueta e-${esc(e)}">${esc(ETAPAS[e] || e)}</span>`;
  function itemPedido(p) {
    const marcas = PAGADOS.includes(p.e) ? [
      p.g ? `<span class="etiqueta marca-ok">Guía</span>` : p.e !== "por_despachar" ? `<span class="etiqueta marca-falta">Sin guía</span>` : "",
      p.co != null ? `<span class="etiqueta marca-ok">Costo</span>` : `<span class="etiqueta marca-falta">Sin costo</span>`,
      p.pv ? `<span class="etiqueta marca-ok">Proveedores</span>` : `<span class="etiqueta marca-falta">Proveedores</span>`,
    ].join("") : "";
    return `<a class="item" href="#pedido=${encodeURIComponent(p.id)}">
      <span><span class="item__nombre">${esc(p.n || "Sin nombre")}</span><br><span class="item__dato">${esc(p.ci || "")}${p.ci ? " · " : ""}${fecha(p.f)} · ${esc(corto(p.id))}${p.ca && p.ca !== "web" ? " · " + esc(p.ca) : ""}</span></span>
      <span><span class="item__valor">${valor(p)}</span><br>${etiqueta(p.e)}</span>
      ${marcas ? `<span class="item__marcas">${marcas}</span>` : ""}
    </a>`;
  }
  const listaPedidos = (lista, vacio) => (lista.length ? `<div class="lista">${lista.map(itemPedido).join("")}</div>` : `<p class="vacio">${vacio}</p>`);

  /* ---------- Hoy ---------- */
  function vistaHoy() {
    titulo("Hoy");
    const de = (e) => pedidos.filter((p) => p.e === e);
    const porDespachar = de("por_despachar"), despachados = de("despachado");
    const hace3 = Date.now() - 3 * 86400000;
    const carritos = de("por_pagar").filter((p) => Date.parse(p.f) > hace3);
    const proveedores = pedidos.filter((p) => PAGADOS.includes(p.e) && !p.pv);
    const sinCosto = pedidos.filter((p) => ["despachado", "entregado"].includes(p.e) && p.co == null);
    const mes = mesDe(new Date().toISOString());
    const delMes = pedidos.filter((p) => PAGADOS.includes(p.e) && p.pa && mesDe(p.pa) === mes);
    const ventas = delMes.reduce((s, p) => s + (Number(p.v) || 0), 0);
    const conCosto = delMes.filter((p) => p.co != null);
    const ganancia = conCosto.reduce((s, p) => s + (Number(p.s) || 0) - (Number(p.co) || 0), 0);
    vista(`
      <div class="kpis">
        <a class="kpi ${porDespachar.length ? "kpi--alerta" : ""}" href="#pedidos=por_despachar"><strong>${porDespachar.length}</strong><span>Por despachar</span></a>
        <a class="kpi" href="#pedidos=despachado"><strong>${despachados.length}</strong><span>Despachados (confirmar entrega)</span></a>
        <a class="kpi" href="#pedidos=proveedores"><strong>${proveedores.length}</strong><span>Proveedores por pagar</span></a>
        <a class="kpi" href="#pedidos=sin_costo"><strong>${sinCosto.length}</strong><span>Sin costo registrado</span></a>
        <a class="kpi kpi--ancho ${pqrAbiertas ? "kpi--alerta" : ""}" href="#pqrs"><strong>${pqrAbiertas}</strong><span>Peticiones, quejas y reclamos por responder (máximo 15 días hábiles)</span></a>
      </div>
      <section class="tarjeta">
        <h2>${esc(fecha(new Date().toISOString(), { month: "long", year: "numeric" }))}</h2>
        <div class="mes">
          <div><b>${delMes.length}</b><small>pedidos pagados</small></div>
          <div><b>${pesos(ventas)}</b><small>vendido</small></div>
          <div><b>${conCosto.length ? pesos(ganancia) : "—"}</b><small>ganancia${conCosto.length < delMes.length ? ` (${conCosto.length} de ${delMes.length} con costo)` : ""}</small></div>
        </div>
      </section>
      <section class="tarjeta"><h2>📦 Por despachar</h2>${listaPedidos(porDespachar, "Nada pendiente por despachar.")}</section>
      ${despachados.length ? `<section class="tarjeta"><h2>🚚 Despachados</h2>${listaPedidos(despachados.slice(0, 15), "")}</section>` : ""}
      ${carritos.length ? `<section class="tarjeta"><h2>🛒 Sin pagar (últimos 3 días)</h2>${listaPedidos(carritos.slice(0, 15), "")}</section>` : ""}
    `);
  }

  /* ---------- Pedidos ---------- */
  const FILTROS = [["todos", "Todos"], ["por_despachar", "Por despachar"], ["despachado", "Despachados"], ["entregado", "Entregados"], ["por_pagar", "Por pagar"], ["proveedores", "Proveedores pendientes"], ["sin_costo", "Sin costo"], ["cerrados", "Cancelados/vencidos"]];
  let filtroTexto = "";
  function vistaPedidos() {
    const { v } = ruta();
    const filtro = FILTROS.some(([k]) => k === v) ? v : "todos";
    titulo("Pedidos");
    vista(`
      <div class="buscar"><input type="search" id="buscar-pedido" placeholder="Buscar por cliente, ciudad o código" value="${esc(filtroTexto)}" autocomplete="off"></div>
      <div class="filtros" role="group" aria-label="Filtrar">${FILTROS.map(([k, t]) => `<a class="filtro" href="#pedidos=${k}" aria-pressed="${k === filtro}">${t}</a>`).join("")}</div>
      <div id="lista-pedidos"></div>`);
    const pintarLista = () => {
      const q = filtroTexto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const lista = pedidos.filter((p) => {
        const pasa = filtro === "todos" ? true
          : filtro === "proveedores" ? PAGADOS.includes(p.e) && !p.pv
          : filtro === "sin_costo" ? ["despachado", "entregado"].includes(p.e) && p.co == null
          : filtro === "cerrados" ? ["vencido", "cancelado", "devuelto", "contracargo"].includes(p.e)
          : p.e === filtro;
        return pasa && (!q || norm(`${p.n} ${p.ci} ${p.id} ${p.c}`).includes(q));
      });
      $("#lista-pedidos").innerHTML = listaPedidos(lista.slice(0, 200), "No hay pedidos con ese filtro.");
    };
    $("#buscar-pedido").addEventListener("input", (e) => { filtroTexto = e.target.value; pintarLista(); });
    pintarLista();
  }

  /* ---------- Un pedido ---------- */
  async function vistaPedido(id) {
    titulo(`Pedido ${corto(id)}`);
    vista(`<p class="vacio">Cargando…</p>`);
    let d;
    try { d = await api(`pedido?id=${encodeURIComponent(id)}`); } catch (e) { vista(`<p class="vacio">${esc(e.message)}</p>`); return; }
    const p = d.pedido, c = p.cliente || {};
    const cel = soloDigitos(c.celular);
    const nombre1 = String(c.nombre || "").split(" ")[0];
    const textoGuia = p.guia ? `Hola ${nombre1}, tu pedido ${p.id} de Ingeniero Espuelístico ya fue despachado${p.transportadoraGuia || (p.envio && p.envio.transportadora) ? " por " + (p.transportadoraGuia || p.envio.transportadora) : ""}. Número de guía: ${p.guia}. ¡Gracias por tu compra!` : "";
    const ganancia = p.costo != null ? (Number(p.subtotal) || 0) - Number(p.costo) : null;
    const pagosHtml = (p.pagos || []).length ? `<ul class="linea-tiempo">${p.pagos.map((x) => `<li><b>${esc(x.estado)}</b> · ${dineroP(p, x.monto)} · ${esc(x.medio || "")}${x.manual ? " (a mano)" : ""}${x.prueba ? " · PRUEBA" : ""}<small>${fechaHora(x.fecha)} · ${esc(x.id)}${x.detalle && x.estado !== "approved" ? " · " + esc(x.detalle) : ""}</small></li>`).join("")}</ul>` : `<p class="vacio">Sin pagos registrados.</p>`;
    const botonesEtapa = {
      por_pagar: `<button class="btn btn--verde btn--ancho" data-accion="pago">Registrar pago recibido</button><button class="btn btn--borde" data-etapa="cancelado">Cancelar pedido</button><button class="btn btn--borde" data-etapa="por_despachar">Pasar a por despachar</button>`,
      vencido: `<button class="btn btn--verde btn--ancho" data-accion="pago">Registrar pago recibido</button>`,
      por_despachar: `<button class="btn btn--azul btn--ancho" data-accion="despachar">Marcar como despachado</button>`,
      despachado: `<button class="btn btn--verde btn--ancho" data-etapa="entregado">Marcar como entregado</button><button class="btn btn--borde btn--ancho" data-etapa="por_despachar">Volver a por despachar</button>`,
      entregado: `<button class="btn btn--borde btn--ancho" data-etapa="despachado">Volver a despachado</button>`,
      cancelado: `<button class="btn btn--borde btn--ancho" data-etapa="por_pagar">Reabrir pedido</button>`,
    }[p.etapa] || "";
    vista(`
      <section class="tarjeta cabeza">
        <div>${etiqueta(p.etapa)} ${p.canal && p.canal !== "web" ? `<span class="etiqueta">${esc(p.canal)}</span>` : ""} ${p.metodo === "paypal" ? `<span class="etiqueta">PayPal</span>` : ""} ${p.tipo === "contraentrega" ? `<span class="etiqueta">Contraentrega</span>` : ""}</div>
        <h2>${esc(c.nombre || "Sin nombre")}</h2>
        <small>${esc(p.id)} · ${fechaHora(p.fecha)}</small>
        <div class="acciones">${botonesEtapa}</div>
        <div id="zona-despacho" hidden class="formulario">
          <label>Número de guía<input id="campo-guia" inputmode="numeric" autocomplete="off" value="${esc(p.guia || "")}"></label>
          <label>Transportadora<input id="campo-transportadora" value="${esc(p.transportadoraGuia || (p.envio && p.envio.transportadora) || "Interrapidísimo")}"></label>
          <button class="btn btn--azul btn--ancho" data-accion="guardar-despacho">Guardar como despachado</button>
        </div>
        <div id="zona-pago" hidden class="formulario">
          <div class="dos"><label>Valor recibido<input id="campo-pago-monto" inputmode="numeric" value="${esc(p.total || "")}"></label>
          <label>Medio<select id="campo-pago-medio"><option>Transferencia</option><option>Nequi</option><option>Daviplata</option><option>Efectivo</option><option>Bancolombia</option><option>PayPal</option><option>Western Union</option></select></label></div>
          <button class="btn btn--verde btn--ancho" data-accion="guardar-pago">Guardar pago</button>
        </div>
        ${textoGuia ? `<a class="btn btn--wa btn--ancho" href="https://wa.me/${cel}?text=${encodeURIComponent(textoGuia)}" target="_blank" rel="noopener">Enviar la guía al cliente por WhatsApp</a>` : ""}
      </section>

      <section class="tarjeta">
        <h2>Cliente</h2>
        <dl class="filas">
          <div><dt>Celular</dt><dd>${esc(c.celular || "—")}</dd></div>
          ${c.documento ? `<div><dt>Documento</dt><dd>${esc(c.documento)}</dd></div>` : ""}
          <div><dt>Destino</dt><dd>${esc(c.destino || [c.direccion, c.ciudad, c.departamento].filter(Boolean).join(", ") || "—")}</dd></div>
          ${d.cliente ? `<div><dt>Compras</dt><dd><a href="#cliente=${encodeURIComponent(c.celular)}">${d.cliente.compras || 0} · ${pesos(d.cliente.comprado)}</a></dd></div>` : ""}
        </dl>
        ${cel ? `<div class="contacto"><a class="btn btn--wa btn--chico" href="https://wa.me/${cel}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn--borde btn--chico" href="tel:+${cel}">Llamar</a></div>` : ""}
      </section>

      <section class="tarjeta">
        <h2>Productos</h2>
        <ul class="productos">${(p.productos || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${p.regalo ? `<p>🎁 ${esc(p.regalo)}</p>` : ""}
        <dl class="filas">
          <div><dt>Productos</dt><dd>${pesos(p.subtotal)}</dd></div>
          ${p.envio ? `<div><dt>Envío${p.envio.detalle ? " · " + esc(p.envio.detalle) : p.envio.transportadora ? " · " + esc(p.envio.transportadora) : ""}</dt><dd>${p.envio.moneda === "USD" ? "USD " + Number(p.envio.valor || 0).toFixed(2) : pesos(p.envio.valor)}</dd></div>` : ""}
          ${p.tipo === "contraentrega" ? `<div><dt>Cobrar al entregar</dt><dd>${pesos(p.cobrarAlRecibir)}</dd></div>` : ""}
          <div><dt>Total cobrado en línea</dt><dd>${dineroP(p, p.total)}</dd></div>
          ${p.guia ? `<div><dt>Guía</dt><dd>${esc(p.guia)}</dd></div>` : ""}
        </dl>
      </section>

      <section class="tarjeta">
        <h2>Costos y ganancia</h2>
        <div class="fila-form"><label>Lo que te costó este pedido<input id="campo-costo" inputmode="numeric" placeholder="Ej: 180000" value="${p.costo != null ? esc(p.costo) : ""}"></label><button class="btn btn--azul" data-accion="guardar-costo">Guardar</button></div>
        <dl class="filas">${ganancia != null ? `<div><dt>Ganancia (productos − costo)</dt><dd class="${ganancia >= 0 ? "positivo" : "negativo"}">${pesos(ganancia)}</dd></div>` : `<div><dt>Ganancia</dt><dd>Registra el costo</dd></div>`}</dl>
        <label class="interruptor">Proveedores pagados<input type="checkbox" id="campo-proveedores" ${p.proveedoresPagados ? "checked" : ""}></label>
      </section>

      <section class="tarjeta"><h2>Pagos</h2>${pagosHtml}</section>

      <section class="tarjeta">
        <h2>Notas</h2>
        ${(p.notas || []).length ? `<ul class="linea-tiempo">${p.notas.slice().reverse().map((n) => `<li>${esc(n.texto)}<small>${fechaHora(n.fecha)}</small></li>`).join("")}</ul>` : ""}
        <div class="fila-form"><label>Nueva nota<input id="campo-nota" placeholder="Ej: lo recoge el lunes"></label><button class="btn btn--azul" data-accion="guardar-nota">Guardar</button></div>
      </section>

      <section class="tarjeta">
        <h2>Historial</h2>
        <ul class="linea-tiempo">${(p.historial || []).slice().reverse().map((x) => `<li>${esc(x.texto)}<small>${fechaHora(x.fecha)}</small></li>`).join("")}</ul>
      </section>
    `);
    const guardar = async (cambios, mensaje) => {
      try { await enviar("pedido", { id: p.id, cambios }); await cargar(); aviso(mensaje); vistaPedido(p.id); }
      catch (e) { aviso(e.message, 4000); }
    };
    $("#vista").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.etapa) return guardar({ etapa: b.dataset.etapa }, `Pedido: ${ETAPAS[b.dataset.etapa]}`);
      const a = b.dataset.accion;
      if (a === "despachar") { $("#zona-despacho").hidden = false; $("#campo-guia").focus(); }
      if (a === "pago") { $("#zona-pago").hidden = false; $("#campo-pago-monto").focus(); }
      if (a === "guardar-despacho") guardar({ etapa: "despachado", guia: $("#campo-guia").value, transportadoraGuia: $("#campo-transportadora").value }, "Marcado como despachado");
      if (a === "guardar-pago") guardar({ pago: { monto: soloDigitos($("#campo-pago-monto").value), medio: $("#campo-pago-medio").value } }, "Pago registrado");
      if (a === "guardar-costo") guardar({ costo: soloDigitos($("#campo-costo").value) }, "Costo guardado");
      if (a === "guardar-nota" && $("#campo-nota").value.trim()) guardar({ nota: $("#campo-nota").value }, "Nota guardada");
    };
    $("#campo-proveedores").onchange = (e) => guardar({ proveedoresPagados: e.target.checked }, e.target.checked ? "Proveedores pagados" : "Proveedores pendientes");
  }

  /* ---------- PQR (peticiones, quejas y reclamos) ---------- */
  async function vistaPQRs() {
    titulo("PQR");
    vista(`<p class="vacio">Cargando…</p>`);
    let d;
    try { d = await api("pqrs"); } catch (e) { vista(`<p class="vacio">${esc(e.message)}</p>`); return; }
    const vence = (q) => { const dias = Math.ceil((Date.parse(q.l) - Date.now()) / 86400000); return dias < 0 ? `<span class="etiqueta marca-falta">Vencida</span>` : dias <= 3 ? `<span class="etiqueta marca-falta">Vence en ${dias} d</span>` : `<span class="etiqueta">Vence ${fecha(q.l)}</span>`; };
    vista(d.pqrs.length ? `<div class="lista">${d.pqrs.map((q) => `<a class="item" href="#pqr=${encodeURIComponent(q.radicado)}">
      <span><span class="item__nombre">${esc(q.n || "Sin nombre")}</span><br><span class="item__dato">${esc(d.tipos[q.t] || q.t)} · ${esc(q.radicado)} · ${fecha(q.f)}</span></span>
      <span><span class="etiqueta ${q.e === "respondida" || q.e === "cerrada" ? "marca-ok" : ""}">${esc(d.estados[q.e] || q.e)}</span><br>${q.e === "recibida" || q.e === "en_tramite" ? vence(q) : ""}</span></a>`).join("")}</div>`
      : `<p class="vacio">No hay peticiones, quejas ni reclamos.</p>`);
  }
  async function vistaPQR(r) {
    titulo("PQR");
    vista(`<p class="vacio">Cargando…</p>`);
    let d;
    try { d = await api(`pqr?r=${encodeURIComponent(r)}`); } catch (e) { vista(`<p class="vacio">${esc(e.message)}</p>`); return; }
    const q = d.pqr, c = q.cliente || {}, cel = soloDigitos(c.celular);
    const textoWA = q.respuesta ? `Hola ${String(c.nombre || "").split(" ")[0]}, te escribimos de Ingeniero Espuelístico sobre tu solicitud ${q.radicado}:\n\n${q.respuesta}\n\nPuedes consultarla en ${location.origin}/pqr` : "";
    vista(`
      <section class="tarjeta cabeza">
        <div><span class="etiqueta">${esc(d.tipos[q.tipo] || q.tipo)}</span> <span class="etiqueta">${esc(d.estados[q.estado] || q.estado)}</span></div>
        <h2>${esc(c.nombre)}</h2>
        <small>${esc(q.radicado)} · radicada ${fechaHora(q.fecha)} · responder antes del ${fecha(q.limite, { day: "numeric", month: "long" })}</small>
        <dl class="filas">
          <div><dt>Documento</dt><dd>${esc(c.documento)}</dd></div>
          <div><dt>Celular</dt><dd>${esc(c.celular)}</dd></div>
          ${c.correo ? `<div><dt>Correo</dt><dd>${esc(c.correo)}</dd></div>` : ""}
          ${q.pedido ? `<div><dt>Pedido</dt><dd><a href="#pedido=${encodeURIComponent(q.pedido)}">${esc(q.pedido)}</a></dd></div>` : ""}
        </dl>
        <p class="transcrito">${esc(q.mensaje).replace(/\n/g, "<br>")}</p>
        ${cel ? `<div class="contacto"><a class="btn btn--wa btn--chico" href="https://wa.me/${cel}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn--borde btn--chico" href="tel:+${cel}">Llamar</a></div>` : ""}
      </section>
      <section class="tarjeta formulario">
        <h2>Respuesta</h2>
        <label>Estado<select id="pqr-estado">${Object.entries(d.estados).map(([k, t]) => `<option value="${k}" ${k === q.estado ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        <label>Respuesta al cliente (queda visible en /pqr con su radicado)<textarea id="pqr-respuesta" rows="6">${esc(q.respuesta || "")}</textarea></label>
        <button class="btn btn--azul btn--ancho" id="pqr-guardar">Guardar</button>
        ${textoWA && cel ? `<a class="btn btn--wa btn--ancho" href="https://wa.me/${cel}?text=${encodeURIComponent(textoWA)}" target="_blank" rel="noopener">Enviar la respuesta por WhatsApp</a>` : ""}
      </section>
      <section class="tarjeta"><h2>Historial</h2><ul class="linea-tiempo">${(q.historial || []).slice().reverse().map((x) => `<li>${esc(x.texto)}<small>${fechaHora(x.fecha)}</small></li>`).join("")}</ul></section>`);
    $("#pqr-guardar").onclick = async () => {
      try { await enviar("pqr", { radicado: q.radicado, estado: $("#pqr-estado").value, respuesta: $("#pqr-respuesta").value }); await cargar(); aviso("PQR actualizada"); vistaPQR(q.radicado); }
      catch (e) { aviso(e.message, 4000); }
    };
  }

  /* ---------- Clientes ---------- */
  let textoCliente = "";
  async function vistaClientes() {
    titulo("Clientes");
    if (!clientes) {
      vista(`<p class="vacio">Cargando…</p>`);
      try { clientes = (await api("clientes")).clientes; } catch (e) { vista(`<p class="vacio">${esc(e.message)}</p>`); return; }
    }
    vista(`<div class="buscar"><input type="search" id="buscar-cliente" placeholder="Buscar por nombre, ciudad o celular" value="${esc(textoCliente)}" autocomplete="off"></div><div id="lista-clientes"></div>`);
    const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const pintarLista = () => {
      const q = norm(textoCliente);
      const lista = clientes.filter((c) => !q || norm(`${c.n} ${c.ci} ${c.celular}`).includes(q));
      $("#lista-clientes").innerHTML = lista.length ? `<div class="lista">${lista.slice(0, 200).map((c) => `<a class="item" href="#cliente=${encodeURIComponent(c.celular)}">
        <span><span class="item__nombre">${esc(c.n || c.celular)}</span><br><span class="item__dato">${esc(c.ci || "")}${c.ci ? " · " : ""}última compra ${fecha(c.u)}</span></span>
        <span><span class="item__valor">${pesos(c.t)}</span><br><span class="etiqueta">${c.co || 0} ${c.co === 1 ? "compra" : "compras"}</span></span></a>`).join("")}</div>`
        : `<p class="vacio">${clientes.length ? "Ningún cliente coincide." : "Aún no hay clientes. Se crean solos con cada compra pagada."}</p>`;
    };
    $("#buscar-cliente").addEventListener("input", (e) => { textoCliente = e.target.value; pintarLista(); });
    pintarLista();
  }
  async function vistaCliente(cel) {
    titulo("Cliente");
    vista(`<p class="vacio">Cargando…</p>`);
    let d;
    try { d = await api(`cliente?cel=${encodeURIComponent(cel)}`); } catch (e) { vista(`<p class="vacio">${esc(e.message)}</p>`); return; }
    const c = d.cliente, num = soloDigitos(c.celular);
    titulo(c.nombre || "Cliente");
    vista(`
      <section class="tarjeta">
        <h2>${esc(c.nombre || c.celular)}</h2>
        <dl class="filas">
          <div><dt>Celular</dt><dd>${esc(c.celular)}</dd></div>
          ${c.documento ? `<div><dt>Documento</dt><dd>${esc(c.documento)}</dd></div>` : ""}
          <div><dt>Ciudad</dt><dd>${esc([c.ciudad, c.departamento].filter(Boolean).join(", ") || "—")}</dd></div>
          ${c.direccion ? `<div><dt>Dirección</dt><dd>${esc(c.direccion)}</dd></div>` : ""}
          <div><dt>Compras</dt><dd>${c.compras || 0} · ${pesos(c.comprado)}</dd></div>
          ${c.primera ? `<div><dt>Cliente desde</dt><dd>${fecha(c.primera, { day: "numeric", month: "short", year: "numeric" })}</dd></div>` : ""}
        </dl>
        <div class="contacto"><a class="btn btn--wa btn--chico" href="https://wa.me/${num}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn--borde btn--chico" href="tel:+${num}">Llamar</a></div>
      </section>
      <section class="tarjeta"><h2>Pedidos</h2>${listaPedidos(d.pedidos, "Sin pedidos.")}</section>
      <section class="tarjeta">
        <h2>Notas</h2>
        ${(c.notas || []).length ? `<ul class="linea-tiempo">${c.notas.slice().reverse().map((n) => `<li>${esc(n.texto)}<small>${fechaHora(n.fecha)}</small></li>`).join("")}</ul>` : ""}
        ${d.cliente && d.cliente.pedidos ? `<div class="fila-form"><label>Nueva nota<input id="nota-cliente" placeholder="Ej: compra cada mes, prefiere caja"></label><button class="btn btn--azul" id="guardar-nota-cliente">Guardar</button></div>` : `<p class="vacio">Las notas se habilitan cuando el cliente tenga una compra pagada.</p>`}
      </section>`);
    const b = $("#guardar-nota-cliente");
    if (b) b.onclick = async () => {
      const t = $("#nota-cliente").value.trim(); if (!t) return;
      try { await enviar("cliente", { celular: c.celular, nota: t }); aviso("Nota guardada"); vistaCliente(c.celular); } catch (e) { aviso(e.message, 4000); }
    };
  }

  /* ---------- Nuevo pedido (ventas por WhatsApp, en persona, etc.) ---------- */
  function vistaNuevo() {
    titulo("Nuevo pedido");
    vista(`
      <form class="tarjeta formulario" id="form-nuevo">
        <p class="ayuda">Para ventas por WhatsApp, llamadas o en el taller. Los pedidos de la página se crean solos.</p>
        <label>Cliente<input name="nombre" required autocomplete="off"></label>
        <div class="dos"><label>Celular<input name="celular" inputmode="tel" placeholder="3001234567"></label><label>Ciudad<input name="ciudad"></label></div>
        <label>Dirección (opcional)<input name="direccion"></label>
        <label>Productos (uno por línea)<textarea name="productos" rows="4" required placeholder="200 pares espuela acrílica 40 líneas&#10;1 docena cera gruesa"></textarea></label>
        <div class="dos"><label>Valor total<input name="total" inputmode="numeric" required placeholder="850000"></label><label>De eso, envío<input name="envio" inputmode="numeric" placeholder="0"></label></div>
        <div class="dos"><label>Estado<select name="etapa"><option value="por_pagar">Por pagar</option><option value="por_despachar">Pagado, por despachar</option><option value="despachado">Ya despachado</option><option value="entregado">Ya entregado</option></select></label>
        <label>Medio de pago<select name="medio"><option>Transferencia</option><option>Nequi</option><option>Daviplata</option><option>Efectivo</option><option>Bancolombia</option><option>PayPal</option><option>Western Union</option></select></label></div>
        <label>Costo del pedido (opcional)<input name="costo" inputmode="numeric" placeholder="Lo que te costó"></label>
        <label>Nota (opcional)<input name="nota"></label>
        <p class="error" id="error-nuevo" role="alert"></p>
        <button class="btn btn--azul btn--ancho" type="submit">Crear pedido</button>
      </form>`);
    $("#form-nuevo").onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const d = await enviar("nuevo", {
          cliente: { nombre: f.nombre, celular: f.celular, ciudad: f.ciudad, direccion: f.direccion },
          productos: f.productos, total: soloDigitos(f.total), envio: soloDigitos(f.envio), etapa: f.etapa, medio: f.medio,
          costo: soloDigitos(f.costo), nota: f.nota, canal: "whatsapp",
        });
        await cargar(); clientes = null; aviso("Pedido creado"); location.hash = `pedido=${encodeURIComponent(d.pedido.id)}`;
      } catch (err) { $("#error-nuevo").textContent = err.message; }
    };
  }

  /* ---------- Notas de voz ---------- */
  const hoja = $("#hoja-voz");
  let grabadora = null, partes = [], flujo = null, inicio = 0, reloj = null;
  function abrirVoz() { hoja.hidden = false; $("#voz-grabar").hidden = false; $("#voz-resultado").hidden = true; $("#voz-estado").textContent = "Toca el micrófono y habla. Toca otra vez para terminar."; }
  function cerrarVoz() { detener(true); hoja.hidden = true; }
  $("#boton-voz").addEventListener("click", abrirVoz);
  hoja.addEventListener("click", (e) => { if (e.target === hoja || e.target.closest("[data-cerrar-hoja]")) cerrarVoz(); });

  $("#voz-boton").addEventListener("click", () => (grabadora && grabadora.state === "recording" ? detener(false) : grabar()));
  async function grabar() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { $("#voz-estado").textContent = "Este navegador no permite grabar. Escríbelo abajo."; return; }
    try { flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { $("#voz-estado").textContent = "Necesito permiso para usar el micrófono. Revísalo en los ajustes del navegador."; return; }
    partes = [];
    const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    grabadora = new MediaRecorder(flujo, tipo ? { mimeType: tipo } : undefined);
    grabadora.ondataavailable = (e) => { if (e.data && e.data.size) partes.push(e.data); };
    grabadora.onstop = () => { flujo.getTracks().forEach((t) => t.stop()); if (!grabadora.cancelada) procesarAudio(new Blob(partes, { type: grabadora.mimeType || "audio/webm" })); };
    grabadora.start();
    inicio = Date.now();
    $("#voz-boton").classList.add("grabando");
    $("#voz-boton").setAttribute("aria-label", "Terminar de grabar");
    const tic = () => {
      const s = Math.floor((Date.now() - inicio) / 1000);
      $("#voz-estado").textContent = `Grabando… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · toca para terminar`;
      if (s >= 150) detener(false);
    };
    tic(); reloj = setInterval(tic, 500);
  }
  function detener(cancelar) {
    clearInterval(reloj);
    $("#voz-boton").classList.remove("grabando");
    $("#voz-boton").setAttribute("aria-label", "Empezar a grabar");
    if (grabadora && grabadora.state === "recording") { grabadora.cancelada = cancelar; grabadora.stop(); }
  }

  // Se convierte a WAV (16 kHz, mono): lo entiende el reconocedor de voz sin importar el celular
  async function aWav(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const datos = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close && ctx.close();
    const tasa = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(datos.duration * tasa), tasa);
    const fuente = off.createBufferSource(); fuente.buffer = datos; fuente.connect(off.destination); fuente.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const t = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    t(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); t(8, "WAVE"); t(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, tasa, true); v.setUint32(28, tasa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); t(36, "data"); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) { const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Blob([buf], { type: "audio/wav" });
  }

  async function procesarAudio(blob) {
    $("#voz-estado").textContent = "Escuchando lo que dijiste…";
    let cuerpo = blob;
    try { cuerpo = await aWav(blob); } catch (e) { /* si no se puede convertir, se envía tal cual */ }
    try {
      const r = await fetch("/api/admin/voz", { method: "POST", credentials: "same-origin", headers: { "Content-Type": cuerpo.type || "audio/webm" }, body: cuerpo });
      const d = await r.json().catch(() => ({ ok: false, error: "Respuesta inválida" }));
      if (r.status === 401) { cerrarVoz(); mostrarEntrada(); return; }
      if (!d.ok) throw new Error(d.error);
      mostrarPropuesta(d);
    } catch (e) { $("#voz-estado").textContent = e.message || "No se pudo procesar el audio."; }
  }
  $("#voz-enviar-texto").addEventListener("click", async () => {
    const texto = $("#voz-escrito").value.trim(); if (!texto) return;
    $("#voz-estado").textContent = "Interpretando…";
    try { mostrarPropuesta(await enviar("voz", { texto })); } catch (e) { $("#voz-estado").textContent = e.message; }
  });

  function mostrarPropuesta(d) {
    $("#voz-grabar").hidden = true;
    const caja = $("#voz-resultado"); caja.hidden = false;
    caja.innerHTML = `
      <p class="transcrito">«${esc(d.texto)}»</p>
      ${d.acciones.length ? `<p class="propuesta__titulo">Esto es lo que voy a hacer:</p>
        <div class="lista">${d.acciones.map((a, i) => `<label class="propuesta"><input type="checkbox" data-i="${i}" checked><span>${esc(a.descripcion)}</span></label>`).join("")}</div>
        <button class="btn btn--verde btn--ancho" id="aplicar">Confirmar y guardar</button>` : ""}
      ${d.dudas ? `<p class="dudas">${esc(d.dudas)}</p>` : ""}
      <button class="btn btn--borde btn--ancho" id="otra-nota">${d.acciones.length ? "Grabar de nuevo" : "Intentar de nuevo"}</button>`;
    $("#otra-nota").onclick = abrirVoz;
    const b = $("#aplicar");
    if (b) b.onclick = async () => {
      const elegidas = $$("input[data-i]", caja).filter((x) => x.checked).map((x) => d.acciones[Number(x.dataset.i)]);
      if (!elegidas.length) return;
      b.disabled = true; b.textContent = "Guardando…";
      try {
        const r = await enviar("aplicar", { acciones: elegidas });
        const malas = r.resultados.filter((x) => !x.ok);
        await cargar(); clientes = null;
        cerrarVoz();
        aviso(malas.length ? `Guardé ${r.resultados.length - malas.length}; ${malas.length} con error: ${malas[0].error}` : `Listo: ${r.resultados.length} ${r.resultados.length === 1 ? "cambio guardado" : "cambios guardados"}`, 4000);
        const unico = r.resultados.length === 1 && r.resultados[0].pedido;
        if (unico) location.hash = `pedido=${encodeURIComponent(unico)}`; else pintar();
      } catch (e) { b.disabled = false; b.textContent = "Confirmar y guardar"; aviso(e.message, 4000); }
    };
  }

  iniciar();
})();
