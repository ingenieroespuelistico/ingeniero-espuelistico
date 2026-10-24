// Base de pedidos y clientes de la tienda (Cloudflare KV, enlace PEDIDOS = espacio "ie_pedidos").
//
//   pedido:<id>     → el pedido completo (JSON). Los "metadatos" llevan un resumen corto para listar sin abrir cada uno.
//   abierto:<id>    → pedido creado en la página y todavía sin pagar. Vive 3 días. La tarea programada lo revisa
//                     y, si pasó 1 hora sin pago, avisa por Telegram para recuperar el carrito.
//   cliente:<cel>   → datos del cliente y su historial de compras (celular en formato +57...).
//   aviso:<pago>:<estado> → marca para no repetir el mismo aviso de Telegram.

const DIA = 86400;
const MINUTO = 60 * 1000;

// Etapas del pedido (las usa también el panel de administración)
export const ETAPAS = {
  por_pagar: "Por pagar",
  por_despachar: "Por despachar",
  despachado: "Despachado",
  entregado: "Entregado",
  vencido: "Sin pago (venció)",
  devuelto: "Pago devuelto",
  contracargo: "Contracargo",
  cancelado: "Cancelado",
};

// Recuperación de carritos: cuánto esperar antes de avisar y hasta cuándo vale la pena (el enlace de pago vence a las 48 h)
export const RECUPERACION = { esperarMinutos: 60, maximoHoras: 40 };

const leer = async (env, clave) => { const t = await env.PEDIDOS.get(clave); return t ? JSON.parse(t) : null; };
export const leerPedido = (env, id) => leer(env, `pedido:${id}`);
export const leerCliente = (env, cel) => leer(env, `cliente:${cel}`);
const ahoraISO = () => new Date().toISOString();

// Resumen corto que va en los metadatos de la clave (máximo 1024 bytes)
function resumenPedido(p) {
  return {
    e: p.etapa, f: p.fecha, t: p.total || 0, v: p.valorPedido || 0,
    n: String((p.cliente && p.cliente.nombre) || "").slice(0, 40),
    c: (p.cliente && p.cliente.celular) || "",
    ci: String((p.cliente && p.cliente.ciudad) || "").slice(0, 30),
    ca: p.canal || "web",
    s: Math.round(Number(p.subtotal) || 0),            // valor de los productos en pesos (para calcular ganancia)
    co: p.costo == null ? null : Math.round(Number(p.costo) || 0), // lo que le costó al taller
    pv: p.proveedoresPagados ? 1 : 0,
    m: p.moneda === "USD" ? "USD" : undefined,
    pa: p.pagadoEn || undefined,
    g: p.guia ? 1 : 0,
  };
}

export async function guardarPedido(env, p) {
  const opciones = { metadata: resumenPedido(p) };
  // Los pedidos que nunca se pagaron se borran solos a los 120 días; los pagados se guardan siempre
  if (p.etapa === "por_pagar" || p.etapa === "vencido") opciones.expirationTtl = 120 * DIA;
  await env.PEDIDOS.put(`pedido:${p.id}`, JSON.stringify(p), opciones);
}

// Pedido recién creado en la página (antes de pagar)
export async function registrarPedidoWeb(env, p) {
  await guardarPedido(env, p);
  await env.PEDIDOS.put(`abierto:${p.id}`, "1", { expirationTtl: 3 * DIA, metadata: { f: p.fecha, c: p.cliente.celular } });
}

// Si el pedido no está en la base (por ejemplo, se creó antes de conectarla), se arma con los datos del pago
function pedidoDesdePago(pago) {
  const m = pago.metadata || {};
  const valor = Number(m.subtotal_productos || 0) + Number(m.envio_valor || 0);
  return {
    id: m.pedido || pago.external_reference, fecha: pago.date_created || ahoraISO(), canal: "web", etapa: "por_pagar",
    tipo: m.tipo || "pago_en_linea", total: pago.transaction_amount, valorPedido: valor || pago.transaction_amount,
    subtotal: Number(m.subtotal_productos || 0), cobrarAlRecibir: Number(m.cobrar_al_recibir || 0),
    envio: { valor: Number(m.envio_valor || 0), detalle: m.envio || "", pesoKg: m.envio_peso_kg, recaudo: Number(m.envio_recaudo || 0) },
    productos: String(m.productos || "").split(" | ").filter(Boolean), regalo: m.regalo || "",
    cliente: { nombre: m.cliente_nombre || "", documento: m.cliente_documento || "", celular: m.cliente_celular || "", destino: m.destino || "" },
    pagos: [], historial: [{ fecha: ahoraISO(), texto: "Pedido reconstruido desde Mercado Pago" }],
  };
}

// Cómo cambia la etapa del pedido según el estado del pago en Mercado Pago
function etapaTrasPago(actual, estadoPago) {
  if (estadoPago === "approved") return ["por_pagar", "vencido", undefined].includes(actual) ? "por_despachar" : actual;
  if (estadoPago === "cancelled") return actual === "por_pagar" ? "vencido" : actual;
  if (estadoPago === "refunded") return "devuelto";
  if (estadoPago === "charged_back") return "contracargo";
  return actual || "por_pagar"; // pending, in_process, rejected: sigue por pagar
}

// Guarda en el pedido lo que dice Mercado Pago. Devuelve el pedido actualizado.
export async function registrarPago(env, pago) {
  const m = pago.metadata || {};
  const id = m.pedido || pago.external_reference;
  const p = (await leerPedido(env, id)) || pedidoDesdePago(pago);
  p.pagos = Array.isArray(p.pagos) ? p.pagos : [];
  const registro = {
    id: String(pago.id), estado: pago.status, detalle: pago.status_detail || "", medio: pago.payment_method_id || "",
    monto: pago.transaction_amount, fecha: pago.date_last_updated || pago.date_created || ahoraISO(), prueba: pago.live_mode === false || undefined,
  };
  const i = p.pagos.findIndex((x) => x.id === registro.id);
  const igual = i >= 0 && p.pagos[i].estado === registro.estado;
  if (i >= 0) p.pagos[i] = registro; else p.pagos.push(registro);
  const antes = p.etapa;
  p.etapa = etapaTrasPago(p.etapa, pago.status);
  if (!igual || antes !== p.etapa) {
    p.historial = Array.isArray(p.historial) ? p.historial : [];
    p.historial.push({ fecha: ahoraISO(), texto: `Mercado Pago: pago ${registro.id} ${pago.status}${antes !== p.etapa ? ` → ${ETAPAS[p.etapa] || p.etapa}` : ""}` });
    if (pago.status === "approved" && !p.pagadoEn) p.pagadoEn = registro.fecha;
    await guardarPedido(env, p);
  }
  // Si ya pagó (o dejó un pago en trámite, como Efecty), deja de ser un carrito abandonado
  if (["approved", "pending", "in_process"].includes(pago.status)) await env.PEDIDOS.delete(`abierto:${id}`);
  if (pago.status === "approved") await registrarCliente(env, p);
  return p;
}

// Ficha del cliente: se crea o actualiza con cada compra pagada
export async function registrarCliente(env, p) {
  const c0 = p.cliente || {};
  const cel = c0.celular;
  if (!cel) return null;
  const clave = `cliente:${cel}`;
  const c = (await leer(env, clave)) || { celular: cel, alta: p.fecha, pedidos: [], compras: 0, comprado: 0, notas: [] };
  if (c.pedidos.includes(p.id)) return c; // esta compra ya se contó
  for (const k of ["nombre", "documento", "departamento", "ciudad", "direccion", "destino", "pais", "correo"]) if (c0[k]) c[k] = c0[k];
  c.pedidos.unshift(p.id);
  c.pedidos = c.pedidos.slice(0, 300);
  c.compras = (c.compras || 0) + 1;
  c.comprado = (c.comprado || 0) + Number(p.valorPedido || p.total || 0);
  c.ultima = p.pagadoEn || p.fecha;
  c.primera = c.primera || c.ultima;
  await env.PEDIDOS.put(clave, JSON.stringify(c), {
    metadata: { n: String(c.nombre || "").slice(0, 40), ci: String(c.ciudad || "").slice(0, 30), u: c.ultima, co: c.compras, t: c.comprado },
  });
  return c;
}

/* ---------------- Recuperación de carritos abandonados ---------------- */
const MOTIVOS_RECHAZO = {
  cc_rejected_insufficient_amount: "fondos insuficientes",
  cc_rejected_bad_filled_security_code: "código de seguridad errado",
  cc_rejected_bad_filled_date: "fecha de vencimiento errada",
  cc_rejected_bad_filled_other: "datos de la tarjeta errados",
  cc_rejected_call_for_authorize: "el banco pide autorizar el pago",
  cc_rejected_card_disabled: "tarjeta no activada",
  cc_rejected_high_risk: "rechazado por seguridad de Mercado Pago",
  cc_rejected_max_attempts: "demasiados intentos",
  cc_rejected_duplicated_payment: "pago duplicado",
  cc_rejected_other_reason: "el banco lo rechazó",
  rejected_by_bank: "el banco lo rechazó",
};
const hace = (ms) => { const min = Math.round(ms / MINUTO); return min < 90 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`; };
const pesos = (n) => { const v = Math.round(Number(n) || 0); return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("es-CO"); };
// Valor del pedido en su moneda (los de PayPal van en dólares)
export const dinero = (p, n = p.total) => (p && p.moneda === "USD" ? `USD ${Number(n || 0).toFixed(2)}` : pesos(n));
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Hora de Colombia (UTC-5): de 9 p. m. a 7 a. m. los avisos llegan sin sonido
export const esDeNoche = (fecha = new Date()) => { const h = (fecha.getUTCHours() + 19) % 24; return h >= 21 || h < 7; };

function mensajeRecuperacion(p, edadMs) {
  const nombre = String((p.cliente && p.cliente.nombre) || "").split(" ")[0] || "";
  const vence = p.pagoVence ? new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", hour: "numeric", minute: "2-digit" }).format(new Date(p.pagoVence)) : "";
  const paraCliente = [
    `Hola${nombre ? " " + nombre : ""}, te escribimos de Ingeniero Espuelístico.`,
    `Vimos que tu pedido ${p.id} por ${dinero(p)} quedó sin pagar. ¿Tuviste algún inconveniente con el pago?`,
    p.pagoUrl ? `Si quieres terminarlo, este es tu enlace de pago seguro de Mercado Pago${vence ? ` (vale hasta el ${vence})` : ""}: ${p.pagoUrl}` : "",
    p.metodo === "paypal" ? "Si quieres, te enviamos un enlace nuevo de PayPal para terminarlo." : "",
    "Si prefieres otra forma de pago, dinos y te ayudamos.",
  ].filter(Boolean).join("\n\n");
  const cel = String((p.cliente && p.cliente.celular) || "").replace(/\D/g, "");
  const enlace = `https://wa.me/${cel}?text=${encodeURIComponent(paraCliente)}`;
  const rechazado = (p.pagos || []).filter((x) => x.estado === "rejected").pop();
  return [
    `🛒 <b>CARRITO SIN PAGAR</b> (lo dejó hace ${hace(edadMs)})`,
    `Pedido: <b>${esc(p.id)}</b> · ${p.tipo === "contraentrega" ? "contraentrega (iba a pagar el envío)" : p.metodo === "paypal" ? "PayPal (dólares)" : "pago en línea"}`,
    `Total que iba a pagar: <b>${dinero(p)}</b>${p.tipo === "contraentrega" ? ` (y ${pesos(p.cobrarAlRecibir)} al recibir)` : ""}`,
    rechazado ? `⚠️ Intentó pagar y ${p.metodo === "paypal" ? "PayPal" : "Mercado Pago"} lo rechazó: ${esc(MOTIVOS_RECHAZO[rechazado.detalle] || rechazado.detalle || "sin detalle")}` : null,
    "",
    `<b>Productos</b>\n${esc((p.productos || []).map((x) => "• " + x).join("\n"))}`,
    "",
    `<b>Cliente</b>: ${esc(p.cliente && p.cliente.nombre)} · ${esc(p.cliente && p.cliente.celular)}`,
    `📍 ${esc((p.cliente && (p.cliente.destino || p.cliente.ciudad)) || "")}`,
    "",
    cel ? `👉 <a href="${esc(enlace)}">Escribirle por WhatsApp</a> (el mensaje ya va escrito, revísalo antes de enviar)` : null,
    cel ? "⏰ Ley 2300: escríbele solo lun–vie 7 a. m.–7 p. m. o sáb 8 a. m.–3 p. m. (no domingos ni festivos), y una sola vez." : null,
  ].filter((x) => x !== null).join("\n");
}

// Revisa los carritos abiertos. avisar(mensaje, silencioso) debe devolver true si el aviso salió.
// opciones.rescatar(pedido): para PayPal, revisa si el cliente aprobó y no volvió a la página (y lo cobra); true = resuelto.
export async function revisarAbandonados(env, avisar, ahora = Date.now(), opciones = {}) {
  if (!env.PEDIDOS) return { revisados: 0, avisados: 0 };
  const lista = [];
  let cursor;
  do {
    const r = await env.PEDIDOS.list({ prefix: "abierto:", cursor, limit: 1000 });
    lista.push(...r.keys);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);

  // Si un mismo cliente dejó varios pedidos, solo se avisa el más reciente
  const masReciente = {};
  for (const k of lista) {
    const cel = (k.metadata && k.metadata.c) || k.name;
    const f = Date.parse((k.metadata && k.metadata.f) || 0) || 0;
    if (!masReciente[cel] || f > masReciente[cel].f) masReciente[cel] = { f, name: k.name };
  }
  let avisados = 0;
  const silencioso = esDeNoche(new Date(ahora));
  for (const k of lista) {
    const id = k.name.slice("abierto:".length);
    const f = Date.parse((k.metadata && k.metadata.f) || 0) || 0;
    const edad = ahora - f;
    const cel = (k.metadata && k.metadata.c) || k.name;
    const borrar = () => env.PEDIDOS.delete(k.name);
    if (edad < 15 * MINUTO) continue; // todavía puede estar pagando
    let p = null;
    // PayPal: si ya aprobó pero no volvió a la página, se cobra sin esperar la hora
    if (opciones.rescatar && edad < RECUPERACION.maximoHoras * 3600 * 1000) {
      p = await leerPedido(env, id);
      if (p && p.metodo === "paypal" && p.etapa === "por_pagar" && (await opciones.rescatar(p).catch(() => false))) { await borrar(); continue; }
    }
    if (edad < RECUPERACION.esperarMinutos * MINUTO) continue;
    if (edad > RECUPERACION.maximoHoras * 3600 * 1000 || masReciente[cel].name !== k.name) { await borrar(); continue; }
    p = p || (await leerPedido(env, id));
    if (!p || p.etapa !== "por_pagar" || (p.pagos || []).some((x) => ["approved", "pending", "in_process"].includes(x.estado))) { await borrar(); continue; }
    // ¿Compró después por otro pedido?
    const c = cel ? await leerCliente(env, cel) : null;
    if (c && c.ultima && Date.parse(c.ultima) > f) { await borrar(); continue; }
    if (!(await avisar(mensajeRecuperacion(p, edad), silencioso))) continue; // se reintenta en la próxima vuelta
    p.recuperacion = { avisado: new Date(ahora).toISOString() };
    p.historial = Array.isArray(p.historial) ? p.historial : [];
    p.historial.push({ fecha: new Date(ahora).toISOString(), texto: "Aviso de carrito sin pagar enviado por Telegram" });
    await guardarPedido(env, p);
    await borrar();
    avisados++;
  }
  return { revisados: lista.length, avisados };
}
