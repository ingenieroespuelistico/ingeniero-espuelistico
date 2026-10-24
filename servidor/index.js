// Servidor de la tienda (Cloudflare Worker). Atiende solo las direcciones /api/...
// Los secretos (tokens) se guardan en Cloudflare: Worker → Settings → Variables and Secrets. Nunca en este archivo.
//
//   POST /api/cotizar      → flete en Colombia con Envia (la transportadora más barata de la lista)
//   POST /api/pedido       → valida el pedido, recalcula precios y crea el pago en Mercado Pago
//   POST /api/mp-webhook   → aviso de Mercado Pago cuando cambia un pago → mensaje a Telegram
//   GET  /api/estado       → estado de un pago (para la página de "gracias")
//   GET  /api/salud        → revisa que los secretos estén guardados
//   POST /api/paypal/crear     → pedido desde otro país: crea la orden de PayPal (en dólares)
//   POST /api/paypal/capturar  → cuando el cliente vuelve de PayPal: cobra la orden y avisa por Telegram
//   /api/admin/...         → datos de la app de pedidos (sitio/admin/), con clave ADMIN_CLAVE
//   GET  /api/agenda       → horas ocupadas en Google Calendar (si está conectado)
//   POST /api/pqr          → radica una petición, queja o reclamo (con número, fecha y hora); GET consulta su estado
//   POST /api/agenda       → agenda una llamada: evento en Google Calendar + aviso por Telegram
//   Tarea programada diaria (7:00 a. m. de Colombia) → resumen de pedidos por Telegram
//   Tarea programada (cada 20 min) → avisa por Telegram los carritos que quedaron sin pagar

import { Tienda } from "./catalogo.generado.js";
import { registrarPedidoWeb, registrarPago, revisarAbandonados, leerPedido } from "./pedidos.js";
import { paypalListo, crearOrden, capturarOrden, consultarOrden, ESTADO_PAYPAL } from "./paypal.js";
import { atenderAdmin, resumenDiario } from "./admin.js";
import { cuentaServicio, calendarioId, ocupado, crearEvento } from "./calendario.js";
import { enviarConfirmacion, correoValido } from "./correo.js";
import { crearPQR, consultarPQR } from "./pqr.js";

const VERSION = "2026-10-23.10";
const C = Tienda.Calculo;

const CABECERAS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
const json = (datos, estado = 200) => new Response(JSON.stringify(datos), { status: estado, headers: CABECERAS });
const error = (mensaje, estado = 400) => json({ ok: false, error: mensaje }, estado);

// Remitente: el taller (Ibagué, Tolima). DANE de Ibagué: 73001000
const ORIGEN = {
  name: "Ingeniero Espuelistico", company: "Ingeniero Espuelistico", email: "ingenieroespuelistico@gmail.com",
  phone: "3019580737", street: "Transversal 11 Sur", number: "13-65 casa 28", district: "",
  city: "73001000", state: "TO", country: "CO", postalCode: "73001000",
};

// Códigos de departamento de Envia
const DEPARTAMENTOS = {
  amazonas: "AM", antioquia: "AN", arauca: "AR", atlantico: "AT", bogota: "DC", "bogota dc": "DC", "bogota d c": "DC",
  bolivar: "BL", boyaca: "BY", caldas: "CL", caqueta: "CA", casanare: "CS", cauca: "CU", cesar: "CE", choco: "CH",
  cordoba: "CO", cundinamarca: "CN", guainia: "GU", guaviare: "GA", huila: "HU", "la guajira": "LG", magdalena: "MA",
  meta: "ME", narino: "NA", "norte de santander": "NS", putumayo: "PU", quindio: "QU", risaralda: "RI",
  "san andres y providencia": "SA", "archipielago de san andres providencia y santa catalina": "SA",
  santander: "SN", sucre: "SU", tolima: "TO", "valle del cauca": "VC", vaupes: "VA", vichada: "VI",
};
const normal = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
function codigoDepartamento(nombre) {
  const n = normal(nombre);
  if (DEPARTAMENTOS[n]) return DEPARTAMENTOS[n];
  if (n.includes("bogota")) return "DC";
  if (n.includes("san andres")) return "SA";
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ruta = url.pathname;
    try {
      if (ruta === "/api/salud") return salud(url, env);
      if (ruta === "/api/mp-webhook") return await webhookMercadoPago(request, url, env, ctx);
      if (ruta === "/api/estado" && request.method === "GET") {
        if (!(await dentroDelLimite(request, env, ruta))) return error("Demasiadas solicitudes", 429);
        return await estadoPago(url, env);
      }
      if (ruta === "/api/paypal/crear" || ruta === "/api/paypal/capturar") {
        if (request.method !== "POST") return error("Método no permitido", 405);
        if (!mismoOrigen(request, url)) return error("Origen no permitido", 403);
        if (!(await dentroDelLimite(request, env, ruta))) return error("Demasiadas solicitudes. Espera un minuto e intenta de nuevo.", 429);
        const cuerpo = await leerJSON(request);
        if (!cuerpo) return error("Solicitud inválida");
        if (ruta === "/api/paypal/crear") return await crearPedidoPaypal(cuerpo, url, env, request);
        return await capturarPaypal(cuerpo, env);
      }
      if (ruta === "/api/cotizar" || ruta === "/api/pedido") {
        if (request.method !== "POST") return error("Método no permitido", 405);
        if (!mismoOrigen(request, url)) return error("Origen no permitido", 403);
        if (!(await dentroDelLimite(request, env, ruta))) return error("Demasiadas solicitudes. Espera un minuto e intenta de nuevo.", 429);
        const cuerpo = await leerJSON(request);
        if (!cuerpo) return error("Solicitud inválida");
        if (ruta === "/api/cotizar") return await cotizar(cuerpo, env, ctx);
        return await crearPedido(cuerpo, url, env, request);
      }
      if (ruta === "/api/pqr") {
        if (!(await dentroDelLimite(request, env, ruta))) return error("Demasiadas solicitudes. Espera un minuto.", 429);
        let r;
        if (request.method === "GET") r = await consultarPQR(env, url.searchParams.get("radicado"), url.searchParams.get("documento"));
        else if (request.method === "POST") {
          if (!mismoOrigen(request, url)) return error("Origen no permitido", 403);
          const cuerpo = await leerJSON(request);
          if (!cuerpo) return error("Solicitud inválida");
          r = await crearPQR(env, cuerpo, request.headers.get("CF-Connecting-IP") || "x", Tienda.AGENDA.festivos, (m) => telegram(env, m));
        } else return error("Método no permitido", 405);
        return r.ok ? json(r) : error(r.error, r.estado || 400);
      }
      if (ruta === "/api/agenda") {
        if (!(await dentroDelLimite(request, env, ruta))) return error("Demasiadas solicitudes. Espera un minuto.", 429);
        if (request.method === "GET") return await agendaOcupado(env);
        if (request.method !== "POST") return error("Método no permitido", 405);
        if (!mismoOrigen(request, url)) return error("Origen no permitido", 403);
        const cuerpo = await leerJSON(request);
        if (!cuerpo) return error("Solicitud inválida");
        return await agendarLlamada(cuerpo, env, request);
      }
      if (ruta.startsWith("/api/admin/")) {
        if (!(await dentroDelLimite(request, env, "/api/admin"))) return error("Demasiadas solicitudes. Espera un minuto.", 429);
        return await atenderAdmin(request, url, env, { json, error, leerJSON, mismoOrigen, telegram, idPedido, CABECERAS });
      }
      if (ruta.startsWith("/api/")) return error("No encontrado", 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error("Error en", ruta, e && e.stack || e);
      return error("Tuvimos un problema. Intenta de nuevo o escríbenos por WhatsApp.", 500);
    }
  },
  // Tarea programada (ver "triggers" en wrangler.jsonc)
  async scheduled(evento, env, ctx) {
    if (evento.cron === "0 12 * * *") {
      ctx.waitUntil(resumenDiario(env, (m, sil) => telegram(env, m, sil), Tienda.NEGOCIO.sitio).catch((e) => console.error("resumenDiario", e && e.stack || e)));
      return;
    }
    ctx.waitUntil(revisarAbandonados(env, (mensaje, silencioso) => telegram(env, mensaje, silencioso), Date.now(), { rescatar: (p) => rescatarPaypal(env, p) })
      .then((r) => console.log("carritos abiertos", JSON.stringify(r)))
      .catch((e) => console.error("revisarAbandonados", e && e.stack || e)));
  },
};

/* ---------------- Utilidades ---------------- */
// Ninguna llamada externa puede dejar al cliente esperando para siempre
const fetchT = (recurso, opciones = {}, ms = 8000) => fetch(recurso, { ...opciones, signal: AbortSignal.timeout(ms) });
function mismoOrigen(request, url) {
  const o = request.headers.get("Origin");
  return !o || o === url.origin;
}
async function leerJSON(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 20000) return null;
  const texto = await request.text();
  if (texto.length > 20000) return null;
  try { return JSON.parse(texto); } catch { return null; }
}
async function dentroDelLimite(request, env, ruta) {
  const ip = request.headers.get("CF-Connecting-IP") || "x";
  try {
    if (env.LIMITE && !(await env.LIMITE.limit({ key: `${ruta}:${ip}` })).success) return false;
    // Tope total para toda la tienda (protege la cuota de Envia y Mercado Pago aunque usen muchas IP)
    if (env.LIMITE_GLOBAL && !(await env.LIMITE_GLOBAL.limit({ key: `global:${ruta}` })).success) return false;
  } catch { /* si el limitador falla, no se bloquea al cliente */ }
  return true;
}
const texto = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, max);
const pesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");
const esc = (t) => String(t ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function enCache(clave, segundos, crear) {
  const cache = caches.default;
  const req = new Request(`https://cache.interno/${encodeURIComponent(clave)}`);
  const previo = await cache.match(req);
  if (previo) return previo.json();
  const valor = await crear();
  if (valor) await cache.put(req, new Response(JSON.stringify(valor), { headers: { "Cache-Control": `max-age=${segundos}`, "Content-Type": "application/json" } }));
  return valor;
}

function lineasLimpias(lista) {
  if (!Array.isArray(lista) || !lista.length || lista.length > 60) return null;
  const limpias = lista.map(C.limpiarLinea);
  return limpias.every(C.lineaValida) ? limpias : null;
}

/* ---------------- Envia: cotización ---------------- */
async function codigoDANE(departamento, ciudad) {
  const state = codigoDepartamento(departamento);
  if (!state) return null;
  const nombreCiudad = String(ciudad).replace(/,?\s*d\.?\s*c\.?\s*$/i, "").trim();
  return enCache(`dane:${state}:${normal(nombreCiudad)}`, 30 * 86400, async () => {
    const r = await fetchT("https://api.envia.com/locate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: nombreCiudad, state, country: "CO" }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.city ? { city: d.city, state: d.state || state, nombre: d.name } : null;
  });
}

function cajaPara(gramos) {
  const cajas = Tienda.ENVIO_NACIONAL.cajas;
  return cajas.find((c) => gramos <= c.hastaGramos) || cajas[cajas.length - 1];
}

async function fleteColombia({ lineas, departamento, ciudad, destinatario, contraentrega }, env) {
  const dane = await codigoDANE(departamento, ciudad);
  if (!dane) return { ok: false, error: "No encontramos tu municipio en la transportadora. Escríbenos por WhatsApp y te cotizamos." };
  const gramos = C.pesoGramos(lineas);
  const valor = C.subtotal(lineas);
  const caja = cajaPara(gramos);
  const kg = Math.max(0.1, Math.ceil(gramos / 100) / 10);
  const clave = `flete2:${dane.city}:${kg}:${caja.largo}x${caja.ancho}x${caja.alto}:${contraentrega ? "cod" + Math.round(valor) : Math.ceil(valor / 50000)}`;
  const cfg = Tienda.ENVIO_NACIONAL;

  const mejor = await enCache(clave, 1800, async () => {
    const destino = {
      name: texto(destinatario && destinatario.nombre, 60) || "Cliente", phone: texto(destinatario && destinatario.celular, 20).replace(/\D/g, "").slice(-10) || "3000000000",
      street: texto(destinatario && destinatario.direccion, 100) || "Direccion", number: "", district: "",
      city: dane.city, state: dane.state, country: "CO", postalCode: dane.city,
    };
    const paquete = {
      type: "box", content: "Accesorios plasticos", amount: 1, name: "Caja", declaredValue: Math.max(10000, Math.round(valor)),
      lengthUnit: "CM", weightUnit: "KG", weight: kg, dimensions: { length: caja.largo, width: caja.ancho, height: caja.alto },
    };
    // Una sola transportadora (la del convenio). Con contraentrega se pide el servicio de recaudo por el valor de los productos.
    if (contraentrega) paquete.additionalServices = [{ service: "cash_on_delivery", data: { amount: Math.round(valor) } }];
    const r = await fetchT("https://api.envia.com/ship/rate/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ENVIA_TOKEN}` },
      body: JSON.stringify({ origin: ORIGEN, destination: destino, packages: [paquete], shipment: { type: 1, carrier: cfg.transportadora }, settings: { currency: "COP" } }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || !Array.isArray(d.data)) { console.log("Envia sin tarifa", r.status, JSON.stringify(d).slice(0, 300)); return null; }
    const t = d.data.find((x) => x.service === cfg.servicio) || d.data[0];
    if (!t || !(Number(t.totalPrice) > 0)) return null;
    const recaudo = contraentrega ? Number(t.cashOnDeliveryCommission || 0) : 0;
    return {
      transportadora: t.carrierDescription || "Interrapidísimo", servicio: t.serviceDescription || t.service || "",
      precio: Number(t.totalPrice) + recaudo, recaudo, dias: t.deliveryEstimate || "", carrier: t.carrier, service: t.service,
    };
  });

  if (!mejor) return { ok: false, error: "No pudimos cotizar el envío a tu municipio. Escríbenos por WhatsApp y te lo cotizamos." };
  const paso = cfg.redondearA || 1;
  const cobro = Math.ceil((mejor.precio + (cfg.recargo || 0)) / paso) * paso;
  return {
    ok: true, valor: cobro, transportadora: mejor.transportadora, servicio: mejor.servicio, dias: mejor.dias,
    contraentrega: Boolean(contraentrega), recaudo: mejor.recaudo || 0,
    municipio: dane.nombre, dane: dane.city, pesoKg: kg, carrier: mejor.carrier, service: mejor.service,
  };
}

async function cotizar(cuerpo, env) {
  const lineas = lineasLimpias(cuerpo.pedido);
  if (!lineas) return error("El pedido no es válido. Recarga la página e intenta de nuevo.");
  const contraentrega = cuerpo.pago === "contraentrega";
  const r = await fleteColombia({ lineas, departamento: texto(cuerpo.departamento, 80), ciudad: texto(cuerpo.ciudad, 80), contraentrega }, env);
  if (!r.ok) return json(r, 200);
  const { carrier, service, dane, ...publico } = r;
  return json(publico);
}

/* ---------------- Mercado Pago: crear el pago ---------------- */
function idPedido() {
  const f = new Date(Date.now() - 5 * 3600 * 1000); // hora de Colombia
  const d = `${f.getUTCFullYear()}${String(f.getUTCMonth() + 1).padStart(2, "0")}${String(f.getUTCDate()).padStart(2, "0")}`;
  const azar = crypto.getRandomValues(new Uint8Array(3));
  return `IE-${d}-${[...azar].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

async function crearPedido(cuerpo, url, env, request) {
  const lineas = lineasLimpias(cuerpo.pedido);
  if (!lineas) return error("El pedido no es válido. Recarga la página e intenta de nuevo.");
  const c = cuerpo.cliente || {};
  const cliente = {
    nombre: texto(c.nombre, 80), documento: texto(c.documento, 20).replace(/[^0-9A-Za-z-]/g, ""),
    celular: texto(c.celular, 20).replace(/[^\d+]/g, ""), departamento: texto(c.departamento, 80),
    ciudad: texto(c.ciudad, 80), direccion: texto(c.direccion, 150),
    correo: correoValido(texto(c.correo, 120)) ? texto(c.correo, 120).toLowerCase() : "",
  };
  if (!cliente.nombre || !cliente.documento || cliente.celular.length < 10 || !cliente.departamento || !cliente.ciudad || !cliente.direccion) {
    return error("Faltan datos de envío. Revisa nombre, documento, celular, municipio y dirección.");
  }
  if (cuerpo.acepto !== true) return error("Debes autorizar el tratamiento de tus datos.");
  const contraentrega = cuerpo.pago === "contraentrega";
  const subtotal = Math.round(C.subtotal(lineas));
  if (contraentrega && subtotal < Tienda.CONTRAENTREGA_MINIMO) return error(`La contraentrega es para pedidos desde ${pesos(Tienda.CONTRAENTREGA_MINIMO)}.`);
  if (!(await humanoVerificado(request, env, cuerpo.verificacion))) return error("No pudimos verificar que no eres un robot. Recarga la página e intenta de nuevo.", 403);

  const envio = await fleteColombia({ lineas, departamento: cliente.departamento, ciudad: cliente.ciudad, destinatario: cliente, contraentrega }, env);
  if (!envio.ok) return error(envio.error);

  const id = idPedido();
  const pares = C.paresEspuela(lineas);
  const regalo = C.regaloPara(pares);
  const items = [];
  if (!contraentrega) {
    lineas.forEach((l, i) => {
      const d = C.describirLinea(l);
      items.push({ id: `${l.producto}-${i + 1}`, title: `${d.nombre} (${d.detalle})`.slice(0, 250), quantity: 1, unit_price: Math.round(C.precioLinea(l, lineas).total), currency_id: "COP" });
    });
  }
  items.push({ id: "envio", title: `Envío ${envio.transportadora} a ${envio.municipio}${contraentrega ? " (contraentrega: los productos se pagan al recibir)" : ""}`.slice(0, 250), quantity: 1, unit_price: envio.valor, currency_id: "COP" });
  const total = items.reduce((s, x) => s + x.unit_price, 0);
  const visto = Number(cuerpo.totalVisto);
  if (Number.isFinite(visto) && visto > 0 && Math.round(visto) !== total) {
    return json({ ok: false, cambio: true, total, envio: { valor: envio.valor, transportadora: envio.transportadora, dias: envio.dias },
      error: `El total se actualizó a ${pesos(total)}${contraentrega ? " (envío)" : ""}. Revísalo y vuelve a confirmar.` }, 409);
  }

  const resumen = lineas.map((l) => { const d = C.describirLinea(l); return `${d.nombre}: ${d.detalle} = ${pesos(C.precioLinea(l, lineas).total)}`; });
  const ahora = new Date();
  const preferencia = {
    items,
    payer: {
      name: cliente.nombre,
      ...(cliente.correo ? { email: cliente.correo } : {}),
      phone: { area_code: "57", number: cliente.celular.replace(/^\+?57/, "") },
      identification: { type: "CC", number: cliente.documento },
      address: { street_name: cliente.direccion.slice(0, 100) },
    },
    back_urls: {
      success: `${url.origin}/gracias.html`, pending: `${url.origin}/gracias.html`, failure: `${url.origin}/gracias.html`,
    },
    auto_return: "approved",
    notification_url: `${url.origin}/api/mp-webhook?source_news=webhooks`,
    external_reference: id,
    statement_descriptor: "INGESPUELISTICO",
    expires: true,
    expiration_date_from: ahora.toISOString(),
    expiration_date_to: new Date(ahora.getTime() + 48 * 3600 * 1000).toISOString(),
    metadata: {
      pedido: id, tipo: contraentrega ? "contraentrega" : "pago_en_linea",
      cliente_nombre: cliente.nombre, cliente_documento: cliente.documento, cliente_celular: cliente.celular,
      destino: `${cliente.direccion}, ${cliente.ciudad} (${cliente.departamento})`,
      productos: resumen.join(" | ").slice(0, 1500),
      subtotal_productos: subtotal, cobrar_al_recibir: contraentrega ? subtotal : 0,
      envio: `${envio.transportadora} ${envio.servicio} ${envio.dias}`.trim(), envio_valor: envio.valor, envio_peso_kg: envio.pesoKg,
      envio_recaudo: envio.recaudo || 0,
      regalo: regalo ? `${regalo.pares} pares de patapioja sintética` : "",
    },
  };

  const r = await fetchT("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "X-Idempotency-Key": id },
    body: JSON.stringify(preferencia),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.init_point) {
    console.error("Mercado Pago no creó la preferencia", r.status, JSON.stringify(d).slice(0, 500));
    return error("No pudimos abrir el pago en este momento. Intenta de nuevo o escríbenos por WhatsApp.", 502);
  }
  if (env.PEDIDOS) {
    await registrarPedidoWeb(env, {
      id, fecha: ahora.toISOString(), canal: "web", etapa: "por_pagar", tipo: preferencia.metadata.tipo,
      total, valorPedido: subtotal + envio.valor, subtotal, cobrarAlRecibir: contraentrega ? subtotal : 0,
      lineas, productos: resumen, regalo: preferencia.metadata.regalo,
      envio: { valor: envio.valor, transportadora: envio.transportadora, servicio: envio.servicio, dias: envio.dias, pesoKg: envio.pesoKg, recaudo: envio.recaudo || 0 },
      cliente: { ...cliente, pais: "CO", destino: preferencia.metadata.destino },
      pagoUrl: d.init_point, pagoVence: preferencia.expiration_date_to,
      pagos: [], historial: [{ fecha: ahora.toISOString(), texto: "Pedido creado en la página; enviado a Mercado Pago" }],
    }).catch((e) => console.error("KV pedido", e && e.message));
  }
  return json({ ok: true, pedido: id, total, envio: { valor: envio.valor, transportadora: envio.transportadora }, url: d.init_point });
}

/* ---------------- Mercado Pago: avisos (webhook) ---------------- */
async function firmaValida(request, url, env, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return true; // sin clave: igual verificamos el pago consultando a Mercado Pago
  const firma = request.headers.get("x-signature");
  const reqId = request.headers.get("x-request-id");
  if (!firma) return false; // con clave configurada, todo aviso debe venir firmado
  const partes = Object.fromEntries(firma.split(",").map((p) => p.split("=").map((s) => s.trim())));
  if (!partes.ts || !partes.v1) return false;
  let manifiesto = "";
  if (dataId) manifiesto += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (reqId) manifiesto += `request-id:${reqId};`;
  manifiesto += `ts:${partes.ts};`;
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.MP_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(manifiesto)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== partes.v1.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return dif === 0;
}

async function webhookMercadoPago(request, url, env, ctx) {
  if (request.method !== "POST") return error("Método no permitido", 405);
  const cuerpo = (await leerJSON(request)) || {};
  const tipo = url.searchParams.get("type") || url.searchParams.get("topic") || cuerpo.type || cuerpo.topic;
  const id = String(url.searchParams.get("data.id") || url.searchParams.get("id") || (cuerpo.data && cuerpo.data.id) || "");
  if (tipo !== "payment" || !/^\d{1,20}$/.test(id)) return json({ ok: true, ignorado: true });
  if (!(await firmaValida(request, url, env, id))) return error("Firma inválida", 401);
  // Se procesa antes de responder: si algo falla, respondemos 500 y Mercado Pago vuelve a intentar
  const listo = await procesarPago(id, env).catch((e) => { console.error("procesarPago", e && e.stack || e); return false; });
  return listo ? json({ ok: true }) : error("Reintentar", 500);
}

async function consultarPago(id, env) {
  const r = await fetchT(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  return r.ok ? r.json() : null;
}

// Marcas de "ya avisado": en la base KV si existe (dura y es global); si no, en la caché (puede no existir en workers.dev)
async function yaAvisado(env, clave) {
  if (env.PEDIDOS) return Boolean(await env.PEDIDOS.get(clave));
  try { return Boolean(await caches.default.match(new Request(`https://cache.interno/${clave}`))); } catch { return false; }
}
async function marcarAvisado(env, clave) {
  if (env.PEDIDOS) return env.PEDIDOS.put(clave, "1", { expirationTtl: 30 * 86400 });
  try { await caches.default.put(new Request(`https://cache.interno/${clave}`), new Response("1", { headers: { "Cache-Control": "max-age=604800" } })); } catch {}
}

// Devuelve true si terminó (avisó o no había nada que avisar) y false si hay que reintentar
async function procesarPago(id, env) {
  const p = await consultarPago(id, env);
  if (!p) return false; // Mercado Pago no respondió: que reintente
  if (!/^IE-\d{8}-[0-9A-F]{6}$/.test(p.external_reference || "")) return true; // no es un pago de la tienda
  // Base de pedidos: guarda el pago en el pedido y en la ficha del cliente (si falla, Mercado Pago reintenta)
  const pedido = env.PEDIDOS ? await registrarPago(env, p) : null;
  // Correo de confirmación al cliente (si dejó su correo y el envío de correos está configurado; una sola vez)
  if (p.status === "approved" && pedido) await enviarConfirmacion(env, pedido, Tienda.NEGOCIO);
  const avisos = { approved: 1, pending: 1, in_process: 1, refunded: 1, charged_back: 1, cancelled: 1 };
  if (!avisos[p.status]) return true;
  if (p.status === "cancelled" && !(await yaAvisado(env, `aviso:${id}:pending`))) return true; // solo avisa cancelación de un pendiente avisado
  // No repetir el mismo aviso
  const clave = `aviso:${id}:${p.status}`;
  if (await yaAvisado(env, clave)) return true;

  const m = p.metadata || {};
  const aprobado = p.status === "approved";
  const medio = { pse: "PSE", efecty: "Efecty", account_money: "Dinero en Mercado Pago" }[p.payment_method_id] || p.payment_type_id || p.payment_method_id || "";
  const titulos = {
    approved: "✅ <b>PAGO APROBADO</b>", pending: "⏳ <b>PAGO PENDIENTE</b> (aún no ha pagado; por ejemplo Efecty sin pagar)",
    in_process: "⏳ <b>PAGO EN REVISIÓN</b> (Mercado Pago lo está revisando; no despaches todavía)",
    refunded: "↩️ <b>PAGO DEVUELTO</b> (no despaches; si ya despachaste, revisa con el cliente)",
    charged_back: "⚠️ <b>CONTRACARGO</b> (el cliente desconoció el pago ante el banco; revisa en Mercado Pago)",
    cancelled: "❌ <b>PAGO CANCELADO</b> (venció o se canceló; no despaches)",
  };
  const lineas = [
    titulos[p.status],
    `Pedido: <b>${esc(m.pedido || p.external_reference)}</b>${p.live_mode === false ? " · PRUEBA" : ""}`,
    `Pagado: <b>${pesos(p.transaction_amount)}</b> por ${esc(medio)}`,
    m.tipo === "contraentrega" ? `💵 <b>CONTRAENTREGA</b>: la transportadora cobra ${pesos(m.cobrar_al_recibir)} al entregar (el envío ya está pagado, incluye recaudo de ${pesos(m.envio_recaudo || 0)})` : null,
    "",
    `<b>Productos</b>\n${esc(String(m.productos || "").split(" | ").map((x) => "• " + x).join("\n"))}`,
    m.regalo ? `🎁 Regalo: ${esc(m.regalo)}` : null,
    `🚚 Envío: ${esc(m.envio)} (${pesos(m.envio_valor || 0)}, ${esc(m.envio_peso_kg)} kg)`,
    "",
    `<b>Cliente</b>: ${esc(m.cliente_nombre)} · CC ${esc(m.cliente_documento)}`,
    `📱 ${esc(m.cliente_celular)}`,
    `📍 ${esc(m.destino)}`,
    `Pago Mercado Pago #${esc(p.id)}`,
    "",
    aprobado ? `👉 Siguiente paso: genera la guía en Envia con ${esc(Tienda.ENVIO_NACIONAL.transportadora)}${m.tipo === "contraentrega" ? ` <b>con contraentrega por ${pesos(m.cobrar_al_recibir)}</b>` : ""}, despacha y envíale la guía al cliente por WhatsApp.` : null,
    aprobado && env.PEDIDOS ? `📲 <a href="${Tienda.NEGOCIO.sitio}/admin/#pedido=${encodeURIComponent(m.pedido || p.external_reference)}">Abrir en la app de pedidos</a>` : null,
  ].filter((x) => x !== null).join("\n");
  if (!(await telegram(env, lineas))) return false; // Telegram falló: que Mercado Pago reintente
  await marcarAvisado(env, clave);
  return true;
}

async function telegram(env, mensaje, silencioso = false) {
  const token = String(env.TELEGRAM_TOKEN || "").trim().replace(/^bot/i, "");
  if (!token || !env.TELEGRAM_CHAT_ID) return false;
  const r = await fetchT(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: mensaje, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: Boolean(silencioso) }),
  });
  if (!r.ok) console.error("Telegram", r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

/* ---------------- PayPal (otros países, en dólares) ---------------- */
// Tasa del dólar en pesos: se consulta y se guarda 6 horas. Si falla, se usa la de respaldo de precios.js.
async function tasaDolar(env) {
  const respaldo = Number(Tienda.TASAS_RESPALDO.porDolar.COP);
  const valida = (v) => Number.isFinite(v) && v > 0 && Math.abs(v / respaldo - 1) < 0.3;
  try {
    if (env.PEDIDOS) { const g = Number(await env.PEDIDOS.get("tasa:COP")); if (valida(g)) return g; }
    const r = await fetchT("https://open.er-api.com/v6/latest/USD", {}, 5000);
    const v = Number(((await r.json()) || {}).rates?.COP);
    if (valida(v)) { if (env.PEDIDOS) await env.PEDIDOS.put("tasa:COP", String(v), { expirationTtl: 6 * 3600 }); return v; }
  } catch (e) { console.log("tasa del dólar", e && e.message); }
  return respaldo;
}
const nombrePais = (iso) => { try { return new Intl.DisplayNames(["es"], { type: "region" }).of(iso); } catch { return iso; } };
const dolares = (n) => `USD ${Number(n || 0).toFixed(2)}`;

async function crearPedidoPaypal(cuerpo, url, env, request) {
  if (!Tienda.PAYPAL.activo || !paypalListo(env)) return error("El pago con PayPal todavía no está disponible. Escríbenos por WhatsApp.", 503);
  const lineas = lineasLimpias(cuerpo.pedido);
  if (!lineas) return error("El pedido no es válido. Recarga la página e intenta de nuevo.");
  const c = cuerpo.cliente || {};
  const cliente = {
    nombre: texto(c.nombre, 80), documento: texto(c.documento, 20).replace(/[^0-9A-Za-z-]/g, ""),
    celular: texto(c.celular, 20).replace(/[^\d+]/g, ""), pais: texto(c.pais, 2).toUpperCase(),
    departamento: texto(c.region, 80), ciudad: texto(c.ciudad, 80), direccion: texto(c.direccion, 150),
    correo: correoValido(texto(c.correo, 120)) ? texto(c.correo, 120).toLowerCase() : "",
  };
  if (!/^[A-Z]{2}$/.test(cliente.pais) || cliente.pais === "CO") return error("Elige tu país.");
  if ((Tienda.NEGOCIO.paisesSinEnvio || {})[cliente.pais]) return error("No enviamos a ese país por restricciones de importación.");
  if (!C.tieneTarifaInternacional(cliente.pais)) return error("Para tu país cotizamos el envío por WhatsApp.");
  if (!cliente.nombre || !cliente.documento || cliente.celular.length < 8 || !cliente.departamento || !cliente.ciudad || !cliente.direccion) {
    return error("Faltan datos de envío. Revisa nombre, documento, celular, región, ciudad y dirección.");
  }
  if (cuerpo.acepto !== true) return error("Debes autorizar el tratamiento de tus datos.");
  if (!(await humanoVerificado(request, env, cuerpo.verificacion))) return error("No pudimos verificar que no eres un robot. Recarga la página e intenta de nuevo.", 403);

  const tasa = await tasaDolar(env);
  const recargo = Math.max(0, Number(Tienda.PAYPAL.recargoPorcentaje) || 0);
  const subtotal = Math.round(C.subtotal(lineas));
  const items = lineas.map((l) => {
    const d = C.describirLinea(l), cop = C.precioLinea(l, lineas).total;
    return { nombre: `${d.nombre} (${d.detalle})`, centavos: Math.round((cop / tasa) * (1 + recargo / 100) * 100), cop };
  });
  const envioUSD = C.envioInternacionalUSD(lineas);
  const pesoKg = Math.round(C.pesoGramos(lineas) / 10) / 100;
  const id = idPedido();
  const orden = await crearOrden(env, { id, lineas: items, envioCentavos: Math.round(envioUSD * 100), cliente: { ...cliente, region: cliente.departamento }, origen: url.origin })
    .catch((e) => { console.error("PayPal", e && e.message); return null; });
  if (!orden) return error("No pudimos abrir PayPal en este momento. Intenta de nuevo o escríbenos por WhatsApp.", 502);
  const total = orden.totalCentavos / 100;
  const regalo = C.regaloPara(C.paresEspuela(lineas));
  if (env.PEDIDOS) {
    const ahora = new Date().toISOString();
    await registrarPedidoWeb(env, {
      id, fecha: ahora, canal: "web", etapa: "por_pagar", tipo: "paypal", metodo: "paypal", moneda: "USD",
      total, valorPedido: Math.round(subtotal + envioUSD * tasa), subtotal, tasa, recargoPorcentaje: recargo,
      lineas, productos: items.map((x) => `${x.nombre} = ${pesos(x.cop)} (${dolares(x.centavos / 100)})`), regalo: regalo ? `${regalo.pares} pares de patapioja sintética` : "",
      envio: { valor: envioUSD, moneda: "USD", detalle: `Internacional puerta a puerta a ${nombrePais(cliente.pais)}`, pesoKg },
      cliente: { ...cliente, destino: `${cliente.direccion}, ${cliente.ciudad}, ${cliente.departamento} (${nombrePais(cliente.pais)})` },
      paypalOrden: orden.orden, pagos: [], historial: [{ fecha: ahora, texto: `Pedido creado en la página; enviado a PayPal (orden ${orden.orden})` }],
    }).catch((e) => console.error("KV pedido PayPal", e && e.message));
  }
  return json({ ok: true, pedido: id, total, moneda: "USD", url: orden.url });
}

// Guarda el resultado de PayPal en la base y avisa por Telegram (una vez por estado)
async function registrarPagoPaypal(env, r) {
  // Sin cobro y sin aprobación del cliente: no hay pago que registrar (el pedido sigue por pagar)
  if (!r.captura && !["APPROVED", "COMPLETED"].includes(r.estadoOrden)) return "sin_pagar";
  const estado = ESTADO_PAYPAL[r.estado] || (r.estadoOrden === "APPROVED" ? "rejected" : "pending");
  const pagoMP = {
    id: r.captura || r.orden, status: estado, status_detail: r.problema || r.estado, payment_method_id: "paypal",
    transaction_amount: r.monto, external_reference: r.pedido, metadata: { pedido: r.pedido }, date_created: new Date().toISOString(),
    live_mode: String(env.PAYPAL_MODO || "").toLowerCase() === "live",
  };
  const p = env.PEDIDOS ? await registrarPago(env, pagoMP) : null;
  if (estado === "approved" && p) await enviarConfirmacion(env, p, Tienda.NEGOCIO);
  if (!["approved", "pending"].includes(estado)) return estado;
  const clave = `aviso:pp:${pagoMP.id}:${estado}`;
  if (await yaAvisado(env, clave)) return estado;
  const cl = (p && p.cliente) || {};
  const mensaje = [
    estado === "approved" ? "✅ <b>PAGO APROBADO · PAYPAL</b>" : "⏳ <b>PAGO PENDIENTE · PAYPAL</b> (PayPal lo está revisando; no despaches todavía)",
    `Pedido: <b>${esc(r.pedido)}</b>${pagoMP.live_mode ? "" : " · PRUEBA (sandbox)"}`,
    `Pagado: <b>${dolares(r.monto)}</b> por PayPal${p && p.tasa ? ` (≈ ${pesos(r.monto * p.tasa)} COP)` : ""}`,
    "",
    p ? `<b>Productos</b>\n${esc((p.productos || []).map((x) => "• " + x).join("\n"))}` : null,
    p && p.regalo ? `🎁 Regalo: ${esc(p.regalo)}` : null,
    p ? `🌎 Envío: ${esc(p.envio.detalle)} (${dolares(p.envio.valor)}, ${esc(p.envio.pesoKg)} kg)` : null,
    "",
    p ? `<b>Cliente</b>: ${esc(cl.nombre)} · Doc. ${esc(cl.documento)}` : null,
    p ? `📱 ${esc(cl.celular)}` : null,
    p ? `📍 ${esc(cl.destino)}` : null,
    r.pagador && r.pagador.correo ? `✉️ PayPal: ${esc(r.pagador.correo)}` : null,
    `Orden PayPal ${esc(r.orden)}${r.captura ? ` · cobro ${esc(r.captura)}` : ""}`,
    "",
    estado === "approved" ? "👉 Siguiente paso: despacha por envío internacional y envíale la guía al cliente por WhatsApp." : null,
  ].filter((x) => x !== null).join("\n");
  if (await telegram(env, mensaje)) await marcarAvisado(env, clave);
  return estado;
}

async function capturarPaypal(cuerpo, env) {
  if (!paypalListo(env)) return error("PayPal no está configurado.", 503);
  const orden = String(cuerpo.orden || "");
  if (!/^[A-Z0-9]{8,40}$/.test(orden)) return error("Orden no válida");
  const r = await capturarOrden(env, orden).catch((e) => { console.error("PayPal capturar", e && e.message); return { ok: false }; });
  if (!r.ok) return error("No pudimos confirmar el pago con PayPal. Si ya pagaste, escríbenos con tu número de pedido.", 502);
  if (!/^IE-\d{8}-[0-9A-F]{6}$/.test(r.pedido) || (cuerpo.pedido && cuerpo.pedido !== r.pedido)) return error("No encontramos ese pago", 404);
  const estado = await registrarPagoPaypal(env, r);
  return json({ ok: true, estado, pedido: r.pedido, total: r.monto, moneda: "USD" });
}

// Tarea programada: si el cliente aprobó en PayPal pero cerró la página antes de volver, se cobra aquí
async function rescatarPaypal(env, p) {
  if (p.metodo !== "paypal" || !p.paypalOrden || !paypalListo(env)) return false;
  const o = await consultarOrden(env, p.paypalOrden).catch(() => null);
  if (!o || !o.ok) return false;
  if (o.d.status === "APPROVED" || o.d.status === "COMPLETED") {
    const r = await capturarOrden(env, p.paypalOrden).catch(() => null);
    if (r && r.ok && r.pedido === p.id) { const e = await registrarPagoPaypal(env, r); return e === "approved" || e === "pending"; }
  }
  return false;
}

/* ---------------- Agenda de llamadas (Google Calendar) ---------------- */
let ocupadoGuardado = null; // { hasta, lista } — se guarda 1 minuto para no consultar a Google en cada visita
async function listaOcupado(env, forzar = false) {
  if (!forzar && ocupadoGuardado && ocupadoGuardado.hasta > Date.now()) return ocupadoGuardado.lista;
  const desde = new Date(), hasta = new Date(Date.now() + 32 * 86400000);
  const lista = await ocupado(env, calendarioId(env, Tienda.NEGOCIO.correo), desde.toISOString(), hasta.toISOString());
  ocupadoGuardado = { hasta: Date.now() + 60000, lista };
  return lista;
}
async function agendaOcupado(env) {
  if (!cuentaServicio(env)) return json({ ok: true, activo: false });
  try { return json({ ok: true, activo: true, ocupado: await listaOcupado(env) }); }
  catch (e) { console.error("Google Calendar", e && e.message); return json({ ok: true, activo: false }); }
}
async function agendarLlamada(c, env, request) {
  if (!cuentaServicio(env)) return error("La agenda en línea no está activa. Escríbenos por WhatsApp.", 503);
  const A = Tienda.AGENDA;
  const nombre = texto(c.nombre, 80), pais = texto(c.pais, 40), celular = texto(c.celular, 20).replace(/[^\d+]/g, "");
  const dia = String(c.dia || ""), hora = Number(c.hora);
  const productos = (Array.isArray(c.productos) ? c.productos : []).slice(0, 12).map((x) => texto(x, 60)).filter(Boolean);
  const nota = texto(c.nota, 200);
  if (!nombre || !/^\+\d{8,15}$/.test(celular)) return error("Revisa tu nombre y tu celular.");
  if (c.acepto !== true) return error("Para agendar, autoriza el tratamiento de tus datos.");
  if (!C.horasAgenda(dia).includes(hora)) return error("Esa hora no está dentro del horario de llamadas.");
  const inicio = C.instanteColombia(dia, hora), fin = inicio + A.duracionMinutos * 60000;
  if (inicio < Date.now() + (A.anticipacionMinutos - 5) * 60000 || inicio > Date.now() + 31 * 86400000) return error("Elige una hora más adelante.");
  // Freno contra abuso: pocas citas por celular y por conexión al día
  if (env.PEDIDOS) {
    const ip = request.headers.get("CF-Connecting-IP") || "x";
    const kc = `agenda:cel:${celular}`, ki = `agenda:ip:${ip}`;
    const [nc, ni] = await Promise.all([env.PEDIDOS.get(kc), env.PEDIDOS.get(ki)]).then((v) => v.map((x) => Number(x) || 0));
    if (nc >= 2 || ni >= 4) return error("Ya tienes llamadas agendadas. Si necesitas otra, escríbenos por WhatsApp.", 429);
    await Promise.all([env.PEDIDOS.put(kc, String(nc + 1), { expirationTtl: 86400 }), env.PEDIDOS.put(ki, String(ni + 1), { expirationTtl: 86400 })]);
  }
  let lista;
  try { lista = await listaOcupado(env, true); } catch (e) { console.error("Google Calendar", e && e.message); return error("No pudimos revisar la agenda en este momento.", 502); }
  if (lista.some((o) => inicio < Date.parse(o.fin) && fin > Date.parse(o.inicio))) return json({ ok: false, error: "Esa hora se acaba de ocupar. Elige otra.", ocupado: lista }, 409);
  const cuando = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(inicio));
  const wa = `https://wa.me/${celular.replace(/\D/g, "")}`;
  try {
    await crearEvento(env, calendarioId(env, Tienda.NEGOCIO.correo), {
      inicio: new Date(inicio).toISOString(), fin: new Date(fin).toISOString(),
      titulo: `📞 Llamar a ${nombre} (${pais || "?"})`,
      descripcion: [`Celular: ${celular}`, `WhatsApp: ${wa}`, `País: ${pais}`, `Productos de interés: ${productos.join(", ") || "por definir"}`, nota ? `Comentario: ${nota}` : "", "", "Agendada desde la página web."].filter((x) => x !== "").join("\n"),
    });
  } catch (e) { console.error("Google Calendar evento", e && e.message); return error("No pudimos guardar la cita en este momento.", 502); }
  ocupadoGuardado = null;
  await telegram(env, [
    "📞 <b>LLAMADA AGENDADA</b>",
    `🗓 ${esc(cuando)} (hora de Colombia)`,
    `<b>${esc(nombre)}</b> · ${esc(pais)}`,
    `📱 ${esc(celular)} · <a href="${esc(wa)}">WhatsApp</a>`,
    `Productos: ${esc(productos.join(", ") || "por definir")}`,
    nota ? `Comentario: ${esc(nota)}` : null,
  ].filter((x) => x !== null).join("\n"));
  return json({ ok: true, inicio: new Date(inicio).toISOString() });
}

/* ---------------- Estado del pago (página de gracias) ---------------- */
async function estadoPago(url, env) {
  let id = url.searchParams.get("pago") || "";
  const ref = url.searchParams.get("pedido") || "";
  const orden = url.searchParams.get("orden") || "";
  // Si Mercado Pago no devolvió el número de pago, se busca en la orden
  if (!/^\d{1,20}$/.test(id) && /^\d{1,20}$/.test(orden)) {
    const r = await fetchT(`https://api.mercadopago.com/merchant_orders/${orden}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
    const o = r.ok ? await r.json() : null;
    const pagos = (o && o.payments) || [];
    const elegido = pagos.find((x) => x.status === "approved") || pagos[pagos.length - 1];
    if (elegido) id = String(elegido.id);
  }
  if (!/^\d{1,20}$/.test(id)) return error("Pago no válido");
  const p = await consultarPago(id, env);
  if (!p) { console.log("estado: pago no encontrado", id); return error("No encontramos ese pago", 404); }
  const propio = /^IE-\d{8}-[0-9A-F]{6}$/.test(p.external_reference || "");
  if (!propio || (ref && ref !== p.external_reference)) { console.log("estado: referencia distinta", id, ref, p.external_reference); return error("No encontramos ese pago", 404); }
  const m = p.metadata || {};
  const base = { ok: true, estado: p.status, medio: p.payment_method_id, contraentrega: m.tipo === "contraentrega" };
  if (!ref) return json(base); // sin número de pedido no se muestran montos
  // Acuse de recibo: resumen del pedido (productos y envío, sin dirección ni documento)
  const ped = env.PEDIDOS ? await leerPedido(env, ref).catch(() => null) : null;
  const resumen = ped ? { productos: ped.productos || [], regalo: ped.regalo || "", envio: ped.envio ? { valor: ped.envio.valor, transportadora: ped.envio.transportadora || "", dias: ped.envio.dias || "" } : null, cobrarAlRecibir: ped.cobrarAlRecibir || 0, ciudad: (ped.cliente && ped.cliente.ciudad) || "" } : null;
  return json({ ...base, pedido: p.external_reference, total: p.transaction_amount, valorPedido: Number(m.subtotal_productos || 0) + Number(m.envio_valor || 0) || p.transaction_amount, resumen });
}

/* ---------------- Turnstile (protección contra robots) ---------------- */
async function humanoVerificado(request, env, token) {
  // Se exige solo si hay clave secreta Y la página tiene la clave pública activa (NEGOCIO.turnstile)
  if (!env.TURNSTILE_SECRET || !Tienda.NEGOCIO.turnstile) return true;
  if (!token || typeof token !== "string" || token.length > 2048) return false;
  const datos = new FormData();
  datos.append("secret", env.TURNSTILE_SECRET);
  datos.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) datos.append("remoteip", ip);
  const r = await fetchT("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: datos });
  const d = await r.json().catch(() => ({}));
  return Boolean(d.success);
}

/* ---------------- Salud ---------------- */
async function salud(url, env) {
  const nombres = ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "ENVIA_TOKEN", "TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID", "TURNSTILE_SECRET", "PAYPAL_CLIENT_ID", "PAYPAL_SECRET", "ADMIN_CLAVE", "GOOGLE_CUENTA_SERVICIO", "RESEND_API_KEY", "CORREO_REMITENTE"];
  // Sin la clave privada (SALUD_CLAVE) solo se muestra que está en línea
  if (!env.SALUD_CLAVE || url.searchParams.get("clave") !== env.SALUD_CLAVE) return json({ ok: true, version: VERSION });
  const respuesta = { ok: true, version: VERSION, productos: Tienda.PRODUCTOS.length, base: Boolean(env.PEDIDOS), secretos: Object.fromEntries(nombres.map((n) => [n, Boolean(env[n])])) };
  if (url.searchParams.get("revisar") === "1") respuesta.conexiones = await revisarConexiones(env);
  return json(respuesta);
}

async function revisarConexiones(env) {
  const probar = async (fn) => { try { return await fn(); } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120) }; } };
  const [mercadoPago, telegramOk, envia] = await Promise.all([
    probar(async () => {
      const r = await fetchT("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
      const d = await r.json();
      return { ok: r.ok, pais: d.site_id, cuentaDePrueba: Array.isArray(d.tags) ? d.tags.includes("test_user") : undefined };
    }),
    probar(async () => {
      const t = String(env.TELEGRAM_TOKEN || "").trim().replace(/^bot/i, "");
      const r = await fetchT(`https://api.telegram.org/bot${t}/getMe`);
      const d = await r.json();
      return { ok: Boolean(d.ok), bot: d.result && d.result.username, error: d.ok ? undefined : d.description };
    }),
    probar(async () => {
      const r = await fetchT("https://queries.envia.com/carrier?country_code=CO", { headers: { Authorization: `Bearer ${env.ENVIA_TOKEN}` } });
      return { ok: r.ok, estado: r.status };
    }),
  ]);
  return { mercadoPago, telegram: telegramOk, envia };
}
