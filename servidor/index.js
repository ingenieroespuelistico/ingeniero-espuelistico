// Servidor de la tienda (Cloudflare Worker). Atiende solo las direcciones /api/...
// Los secretos (tokens) se guardan en Cloudflare: Worker → Settings → Variables and Secrets. Nunca en este archivo.
//
//   POST /api/cotizar      → flete en Colombia con Envia (la transportadora más barata de la lista)
//   POST /api/pedido       → valida el pedido, recalcula precios y crea el pago en Mercado Pago
//   POST /api/mp-webhook   → aviso de Mercado Pago cuando cambia un pago → mensaje a Telegram
//   GET  /api/estado       → estado de un pago (para la página de "gracias")
//   GET  /api/salud        → revisa que los secretos estén guardados

import { Tienda } from "./catalogo.generado.js";

const VERSION = "2026-10-22.1";
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
      if (ruta === "/api/estado" && request.method === "GET") return await estadoPago(url, env);
      if (ruta === "/api/cotizar" || ruta === "/api/pedido") {
        if (request.method !== "POST") return error("Método no permitido", 405);
        if (!mismoOrigen(request, url)) return error("Origen no permitido", 403);
        if (!(await dentroDelLimite(request, env, ruta))) return error("Demasiadas solicitudes. Espera un minuto e intenta de nuevo.", 429);
        const cuerpo = await leerJSON(request);
        if (!cuerpo) return error("Solicitud inválida");
        if (ruta === "/api/cotizar") return await cotizar(cuerpo, env, ctx);
        return await crearPedido(cuerpo, url, env, ctx);
      }
      if (ruta.startsWith("/api/")) return error("No encontrado", 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error("Error en", ruta, e && e.stack || e);
      return error("Tuvimos un problema. Intenta de nuevo o escríbenos por WhatsApp.", 500);
    }
  },
};

/* ---------------- Utilidades ---------------- */
function mismoOrigen(request, url) {
  const o = request.headers.get("Origin");
  return !o || o === url.origin;
}
async function leerJSON(request) {
  const texto = await request.text();
  if (texto.length > 20000) return null;
  try { return JSON.parse(texto); } catch { return null; }
}
async function dentroDelLimite(request, env, ruta) {
  if (!env.LIMITE) return true;
  const ip = request.headers.get("CF-Connecting-IP") || "x";
  try { const { success } = await env.LIMITE.limit({ key: `${ruta}:${ip}` }); return success; } catch { return true; }
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
    const r = await fetch("https://api.envia.com/locate", {
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

async function fleteColombia({ lineas, departamento, ciudad, destinatario }, env) {
  const dane = await codigoDANE(departamento, ciudad);
  if (!dane) return { ok: false, error: "No encontramos tu municipio en la transportadora. Escríbenos por WhatsApp y te cotizamos." };
  const gramos = C.pesoGramos(lineas);
  const valor = C.subtotal(lineas);
  const caja = cajaPara(gramos);
  const kg = Math.max(0.1, Math.ceil(gramos / 100) / 10);
  const clave = `flete:${dane.city}:${kg}:${caja.largo}x${caja.ancho}x${caja.alto}:${Math.ceil(valor / 50000)}`;
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
    const consultas = cfg.transportadoras.map(async (carrier) => {
      try {
        const r = await fetch("https://api.envia.com/ship/rate/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ENVIA_TOKEN}` },
          body: JSON.stringify({ origin: ORIGEN, destination: destino, packages: [paquete], shipment: { type: 1, carrier }, settings: { currency: "COP" } }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.data)) { console.log("Envia sin tarifa", carrier, r.status, JSON.stringify(d).slice(0, 300)); return []; }
        return d.data.filter((t) => Number(t.totalPrice) > 0).map((t) => ({
          transportadora: t.carrierDescription || t.carrier || carrier, servicio: t.serviceDescription || t.service || "",
          precio: Number(t.totalPrice), dias: t.deliveryEstimate || "", carrier: t.carrier || carrier, service: t.service || "",
        }));
      } catch (e) { console.log("Envia error", carrier, String(e)); return []; }
    });
    const tarifas = (await Promise.all(consultas)).flat().sort((a, b) => a.precio - b.precio);
    return tarifas[0] || null;
  });

  if (!mejor) return { ok: false, error: "No pudimos cotizar el envío a tu municipio. Escríbenos por WhatsApp y te lo cotizamos." };
  const paso = cfg.redondearA || 1;
  const cobro = Math.ceil((mejor.precio + (cfg.recargo || 0)) / paso) * paso;
  return {
    ok: true, valor: cobro, transportadora: mejor.transportadora, servicio: mejor.servicio, dias: mejor.dias,
    municipio: dane.nombre, dane: dane.city, pesoKg: kg, carrier: mejor.carrier, service: mejor.service,
  };
}

async function cotizar(cuerpo, env) {
  const lineas = lineasLimpias(cuerpo.pedido);
  if (!lineas) return error("El pedido no es válido. Recarga la página e intenta de nuevo.");
  const r = await fleteColombia({ lineas, departamento: texto(cuerpo.departamento, 80), ciudad: texto(cuerpo.ciudad, 80) }, env);
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

async function crearPedido(cuerpo, url, env) {
  const lineas = lineasLimpias(cuerpo.pedido);
  if (!lineas) return error("El pedido no es válido. Recarga la página e intenta de nuevo.");
  const c = cuerpo.cliente || {};
  const cliente = {
    nombre: texto(c.nombre, 80), documento: texto(c.documento, 20).replace(/[^0-9A-Za-z-]/g, ""),
    celular: texto(c.celular, 20).replace(/[^\d+]/g, ""), departamento: texto(c.departamento, 80),
    ciudad: texto(c.ciudad, 80), direccion: texto(c.direccion, 150),
  };
  if (!cliente.nombre || !cliente.documento || cliente.celular.length < 10 || !cliente.departamento || !cliente.ciudad || !cliente.direccion) {
    return error("Faltan datos de envío. Revisa nombre, documento, celular, municipio y dirección.");
  }
  if (cuerpo.acepto !== true) return error("Debes autorizar el tratamiento de tus datos.");
  const contraentrega = cuerpo.pago === "contraentrega";
  const subtotal = Math.round(C.subtotal(lineas));
  if (contraentrega && subtotal < Tienda.CONTRAENTREGA_MINIMO) return error(`La contraentrega es para pedidos desde ${pesos(Tienda.CONTRAENTREGA_MINIMO)}.`);

  const envio = await fleteColombia({ lineas, departamento: cliente.departamento, ciudad: cliente.ciudad, destinatario: cliente }, env);
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

  const resumen = lineas.map((l) => { const d = C.describirLinea(l); return `${d.nombre}: ${d.detalle} = ${pesos(C.precioLinea(l, lineas).total)}`; });
  const ahora = new Date();
  const preferencia = {
    items,
    payer: {
      name: cliente.nombre,
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
      regalo: regalo ? `${regalo.pares} pares de patapioja sintética` : "",
    },
  };

  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "X-Idempotency-Key": id },
    body: JSON.stringify(preferencia),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.init_point) {
    console.error("Mercado Pago no creó la preferencia", r.status, JSON.stringify(d).slice(0, 500));
    return error("No pudimos abrir el pago en este momento. Intenta de nuevo o escríbenos por WhatsApp.", 502);
  }
  return json({ ok: true, pedido: id, total, envio: { valor: envio.valor, transportadora: envio.transportadora }, url: d.init_point });
}

/* ---------------- Mercado Pago: avisos (webhook) ---------------- */
async function firmaValida(request, url, env, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return true; // sin clave: igual verificamos el pago consultando a Mercado Pago
  const firma = request.headers.get("x-signature");
  const reqId = request.headers.get("x-request-id");
  if (!firma) return url.searchParams.has("topic"); // los avisos IPN antiguos no traen firma
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
  ctx.waitUntil(procesarPago(id, env));
  return json({ ok: true });
}

async function consultarPago(id, env) {
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  return r.ok ? r.json() : null;
}

async function procesarPago(id, env) {
  const p = await consultarPago(id, env);
  if (!p || !["approved", "pending", "in_process"].includes(p.status)) return;
  // No repetir el mismo aviso
  const marca = new Request(`https://cache.interno/aviso/${id}/${p.status}`);
  if (await caches.default.match(marca)) return;
  await caches.default.put(marca, new Response("1", { headers: { "Cache-Control": "max-age=604800" } }));

  const m = p.metadata || {};
  const aprobado = p.status === "approved";
  const medio = { pse: "PSE", efecty: "Efecty", account_money: "Dinero en Mercado Pago" }[p.payment_method_id] || p.payment_type_id || p.payment_method_id || "";
  const lineas = [
    aprobado ? "✅ <b>PAGO APROBADO</b>" : "⏳ <b>PAGO PENDIENTE</b> (aún no ha pagado; por ejemplo Efecty sin pagar)",
    `Pedido: <b>${esc(m.pedido || p.external_reference)}</b>${p.live_mode === false ? " · PRUEBA" : ""}`,
    `Pagado: <b>${pesos(p.transaction_amount)}</b> por ${esc(medio)}`,
    m.tipo === "contraentrega" ? `💵 <b>CONTRAENTREGA</b>: cobrar ${pesos(m.cobrar_al_recibir)} al entregar (el envío ya está pagado)` : "",
    "",
    `<b>Productos</b>\n${esc(String(m.productos || "").split(" | ").map((x) => "• " + x).join("\n"))}`,
    m.regalo ? `🎁 Regalo: ${esc(m.regalo)}` : "",
    `🚚 Envío: ${esc(m.envio)} (${pesos(m.envio_valor || 0)}, ${esc(m.envio_peso_kg)} kg)`,
    "",
    `<b>Cliente</b>: ${esc(m.cliente_nombre)} · CC ${esc(m.cliente_documento)}`,
    `📱 ${esc(m.cliente_celular)}`,
    `📍 ${esc(m.destino)}`,
    `Pago Mercado Pago #${esc(p.id)}`,
  ].filter((x) => x !== "").join("\n");
  await telegram(env, lineas);
}

async function telegram(env, mensaje) {
  const token = String(env.TELEGRAM_TOKEN || "").trim().replace(/^bot/i, "");
  if (!token || !env.TELEGRAM_CHAT_ID) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: mensaje, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) console.error("Telegram", r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

/* ---------------- Estado del pago (página de gracias) ---------------- */
async function estadoPago(url, env) {
  const id = url.searchParams.get("pago") || "";
  const ref = url.searchParams.get("pedido") || "";
  if (!/^\d{1,20}$/.test(id)) return error("Pago no válido");
  const p = await consultarPago(id, env);
  if (!p || p.external_reference !== ref) return error("No encontramos ese pago", 404);
  return json({ ok: true, estado: p.status, pedido: p.external_reference, total: p.transaction_amount, medio: p.payment_method_id, contraentrega: (p.metadata || {}).tipo === "contraentrega" });
}

/* ---------------- Salud ---------------- */
async function salud(url, env) {
  const nombres = ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "ENVIA_TOKEN", "TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID"];
  const respuesta = { ok: true, version: VERSION, productos: Tienda.PRODUCTOS.length, secretos: Object.fromEntries(nombres.map((n) => [n, Boolean(env[n])])) };
  if (url.searchParams.get("revisar") === "1") respuesta.conexiones = await revisarConexiones(env);
  return json(respuesta);
}

async function revisarConexiones(env) {
  const probar = async (fn) => { try { return await fn(); } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120) }; } };
  const [mercadoPago, telegramOk, envia] = await Promise.all([
    probar(async () => {
      const r = await fetch("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
      const d = await r.json();
      return { ok: r.ok, pais: d.site_id, cuentaDePrueba: Array.isArray(d.tags) ? d.tags.includes("test_user") : undefined };
    }),
    probar(async () => {
      const t = String(env.TELEGRAM_TOKEN || "").trim().replace(/^bot/i, "");
      const r = await fetch(`https://api.telegram.org/bot${t}/getMe`);
      const d = await r.json();
      return { ok: Boolean(d.ok), bot: d.result && d.result.username, error: d.ok ? undefined : d.description };
    }),
    probar(async () => {
      const r = await fetch("https://queries.envia.com/carrier?country_code=CO", { headers: { Authorization: `Bearer ${env.ENVIA_TOKEN}` } });
      return { ok: r.ok, estado: r.status };
    }),
  ]);
  return { mercadoPago, telegram: telegramOk, envia };
}
