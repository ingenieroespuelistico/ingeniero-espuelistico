// App de pedidos (para el celular del dueño): las páginas están en sitio/admin/ y los datos en /api/admin/*.
// Entrada con la clave ADMIN_CLAVE (secreto en Cloudflare). La sesión dura 30 días en ese celular.
// Notas de voz: Workers AI (enlace "AI") pasa el audio a texto y lo convierte en acciones; nada se aplica sin confirmar.

import { ETAPAS, leerPedido, leerCliente, guardarPedido, registrarCliente, dinero } from "./pedidos.js";
import { listarPQR, leerPQR, actualizarPQR, TIPOS_PQR, ESTADOS_PQR } from "./pqr.js";

const COOKIE = "ie_admin";
const DURACION = 30 * 86400;
const MODELO_VOZ = "@cf/openai/whisper-large-v3-turbo";
const MODELO_TEXTO = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const ETAPAS_MANUALES = ["por_pagar", "por_despachar", "despachado", "entregado", "cancelado"];

const enc = new TextEncoder();
async function hmac(clave, texto) {
  const k = await crypto.subtle.importKey("raw", enc.encode(clave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(texto)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const iguales = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const firmaSesion = (env, exp) => hmac(`${env.ADMIN_CLAVE}:sesion-admin`, String(exp));

async function sesionValida(request, env) {
  if (!env.ADMIN_CLAVE) return false;
  const c = (request.headers.get("Cookie") || "").split(/;\s*/).find((x) => x.startsWith(COOKIE + "="));
  if (!c) return false;
  const [exp, firma] = c.slice(COOKIE.length + 1).split(".");
  if (!exp || !firma || !(Number(exp) > Date.now() / 1000)) return false;
  return iguales(firma, await firmaSesion(env, exp));
}

const ahoraISO = () => new Date().toISOString();
const limpio = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const numero = (v, max = 1e10) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null; };
function celularE164(v) {
  let d = String(v || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return "+" + d.slice(1).replace(/\D/g, "");
  if (d.length === 10 && d[0] === "3") return "+57" + d;
  if (d.length === 12 && d.startsWith("57")) return "+" + d;
  return "+" + d;
}

async function listar(env, prefijo, maximo = 5000) {
  const lista = [];
  let cursor;
  do {
    const r = await env.PEDIDOS.list({ prefix: prefijo, cursor, limit: 1000 });
    lista.push(...r.keys);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && lista.length < maximo);
  return lista;
}
const resumenes = async (env) => (await listar(env, "pedido:")).map((k) => ({ id: k.name.slice(7), ...(k.metadata || {}) })).sort((a, b) => String(b.f).localeCompare(String(a.f)));

/* ---------------- Entrada ---------------- */
export async function atenderAdmin(request, url, env, h) {
  const ruta = url.pathname.slice("/api/admin/".length);
  if (!env.PEDIDOS) return h.error("Falta conectar la base de pedidos (KV).", 503);
  if (request.method === "POST" && !h.mismoOrigen(request, url)) return h.error("Origen no permitido", 403);
  if (ruta === "entrar") return entrar(request, env, h);
  if (ruta === "salir") return new Response(JSON.stringify({ ok: true }), { headers: { ...h.CABECERAS, "Set-Cookie": `${COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict` } });
  if (!(await sesionValida(request, env))) return h.error("Tu sesión venció. Entra de nuevo.", 401);

  const get = request.method === "GET", post = request.method === "POST";
  if (get && ruta === "inicio") {
    const pqrs = await listarPQR(env);
    return h.json({ ok: true, etapas: ETAPAS, pedidos: await resumenes(env), hoy: ahoraISO(), pqrAbiertas: pqrs.filter((q) => q.e === "recibida" || q.e === "en_tramite").length });
  }
  if (get && ruta === "pqrs") return h.json({ ok: true, tipos: TIPOS_PQR, estados: ESTADOS_PQR, pqrs: await listarPQR(env) });
  if (get && ruta === "pqr") {
    const q = await leerPQR(env, url.searchParams.get("r"));
    return q ? h.json({ ok: true, pqr: q, tipos: TIPOS_PQR, estados: ESTADOS_PQR }) : h.error("No encontramos esa PQR", 404);
  }
  if (post && ruta === "pqr") {
    const b = await h.leerJSON(request);
    if (!b) return h.error("Solicitud inválida");
    const r = await actualizarPQR(env, b.radicado, b);
    return r.ok ? h.json(r) : h.error(r.error, r.estado || 400);
  }
  if (get && ruta === "pedido") {
    const p = await leerPedido(env, limpio(url.searchParams.get("id"), 30));
    if (!p) return h.error("No encontramos ese pedido", 404);
    const c = p.cliente && p.cliente.celular ? await leerCliente(env, p.cliente.celular) : null;
    return h.json({ ok: true, pedido: p, cliente: c });
  }
  if (get && ruta === "clientes") {
    const lista = (await listar(env, "cliente:")).map((k) => ({ celular: k.name.slice(8), ...(k.metadata || {}) })).sort((a, b) => String(b.u).localeCompare(String(a.u)));
    return h.json({ ok: true, clientes: lista });
  }
  if (get && ruta === "cliente") {
    const cel = celularE164(url.searchParams.get("cel"));
    const c = await leerCliente(env, cel);
    const pedidos = (await resumenes(env)).filter((p) => p.c === cel);
    if (!c && !pedidos.length) return h.error("No encontramos ese cliente", 404);
    return h.json({ ok: true, cliente: c || { celular: cel, nombre: pedidos[0].n }, pedidos });
  }
  if (post && ruta === "pedido") {
    const b = await h.leerJSON(request);
    if (!b) return h.error("Solicitud inválida");
    const r = await actualizarPedido(env, limpio(b.id, 30), b.cambios || {});
    return r.ok ? h.json(r) : h.error(r.error, r.estado || 400);
  }
  if (post && ruta === "nuevo") {
    const b = await h.leerJSON(request);
    if (!b) return h.error("Solicitud inválida");
    const r = await nuevoPedido(env, b, h.idPedido);
    return r.ok ? h.json(r) : h.error(r.error);
  }
  if (post && ruta === "cliente") {
    const b = await h.leerJSON(request);
    const cel = celularE164(b && b.celular);
    const c = await leerCliente(env, cel);
    if (!c) return h.error("No encontramos ese cliente", 404);
    const nota = limpio(b.nota, 500);
    if (nota) c.notas = [...(c.notas || []), { fecha: ahoraISO(), texto: nota }].slice(-100);
    await env.PEDIDOS.put(`cliente:${cel}`, JSON.stringify(c), { metadata: { n: String(c.nombre || "").slice(0, 40), ci: String(c.ciudad || "").slice(0, 30), u: c.ultima, co: c.compras, t: c.comprado } });
    return h.json({ ok: true, cliente: c });
  }
  if (post && ruta === "voz") return voz(request, env, h);
  if (post && ruta === "aplicar") {
    const b = await h.leerJSON(request);
    if (!b || !Array.isArray(b.acciones) || b.acciones.length > 20) return h.error("Solicitud inválida");
    const resultados = [];
    for (const a of b.acciones) resultados.push(await aplicarAccion(env, a, h.idPedido));
    return h.json({ ok: true, resultados });
  }
  return h.error("No encontrado", 404);
}

async function entrar(request, env, h) {
  if (request.method !== "POST") return h.error("Método no permitido", 405);
  if (!env.ADMIN_CLAVE) return h.error("Falta guardar la clave ADMIN_CLAVE en Cloudflare.", 503);
  const ip = request.headers.get("CF-Connecting-IP") || "x";
  const clave = `intentos:${ip}`;
  const n = Number(await env.PEDIDOS.get(clave)) || 0;
  if (n >= 8) return h.error("Demasiados intentos fallidos. Espera una hora.", 429);
  const b = await h.leerJSON(request);
  const escrita = String((b && b.clave) || "");
  const ok = iguales(await hmac("comparar", escrita), await hmac("comparar", String(env.ADMIN_CLAVE).trim()));
  if (!ok) {
    await env.PEDIDOS.put(clave, String(n + 1), { expirationTtl: 3600 });
    if (n + 1 === 5) await h.telegram(env, `⚠️ 5 intentos fallidos de entrar a la app de pedidos (país: ${(request.cf && request.cf.country) || "?"}).`);
    return h.error("Clave incorrecta", 401);
  }
  if (n) await env.PEDIDOS.delete(clave);
  const exp = Math.floor(Date.now() / 1000) + DURACION;
  await h.telegram(env, `🔐 Se abrió la app de pedidos en un dispositivo (país: ${(request.cf && request.cf.country) || "?"}). Si no fuiste tú, cambia ADMIN_CLAVE en Cloudflare.`, true);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...h.CABECERAS, "Set-Cookie": `${COOKIE}=${exp}.${await firmaSesion(env, exp)}; Path=/api/admin; Max-Age=${DURACION}; HttpOnly; Secure; SameSite=Strict` },
  });
}

/* ---------------- Cambios a un pedido ---------------- */
async function actualizarPedido(env, id, cambios) {
  const p = await leerPedido(env, id);
  if (!p) return { ok: false, error: "No encontramos ese pedido", estado: 404 };
  const notas = [];
  const antes = p.etapa;
  if (cambios.pago && typeof cambios.pago === "object") {
    const monto = numero(cambios.pago.monto, 1e10);
    const medio = limpio(cambios.pago.medio, 40) || "transferencia";
    p.pagos = Array.isArray(p.pagos) ? p.pagos : [];
    p.pagos.push({ id: `manual-${Date.now()}`, estado: "approved", medio, monto: monto ?? p.total, fecha: ahoraISO(), manual: true });
    p.pagadoEn = p.pagadoEn || ahoraISO();
    notas.push(`Pago registrado a mano: ${monto != null ? dinero(p, monto) : "valor del pedido"} por ${medio}`);
    if (p.etapa === "por_pagar" || p.etapa === "vencido") p.etapa = "por_despachar";
  }
  if (cambios.etapa !== undefined) {
    if (!ETAPAS_MANUALES.includes(cambios.etapa)) return { ok: false, error: "Etapa no válida" };
    p.etapa = cambios.etapa;
    if (p.etapa === "despachado") p.despachadoEn = p.despachadoEn || ahoraISO();
    if (p.etapa === "entregado") p.entregadoEn = p.entregadoEn || ahoraISO();
    if (["por_despachar", "despachado", "entregado"].includes(p.etapa)) p.pagadoEn = p.pagadoEn || ahoraISO();
  }
  if (cambios.guia !== undefined) {
    p.guia = limpio(cambios.guia, 60).replace(/[^\w-]/g, "");
    if (p.guia) notas.push(`Guía ${p.guia}`);
  }
  if (cambios.transportadoraGuia !== undefined) p.transportadoraGuia = limpio(cambios.transportadoraGuia, 40);
  if (cambios.costo !== undefined) {
    const c = cambios.costo === null || cambios.costo === "" ? null : numero(cambios.costo, 1e10);
    if (cambios.costo !== null && cambios.costo !== "" && c === null) return { ok: false, error: "Costo no válido" };
    p.costo = c;
    notas.push(c == null ? "Costo borrado" : `Costo del pedido: ${dinero({}, c)}`);
  }
  if (cambios.proveedoresPagados !== undefined) {
    p.proveedoresPagados = Boolean(cambios.proveedoresPagados);
    notas.push(p.proveedoresPagados ? "Proveedores pagados" : "Proveedores pendientes por pagar");
  }
  if (cambios.nota) {
    const t = limpio(cambios.nota, 500);
    if (t) { p.notas = [...(p.notas || []), { fecha: ahoraISO(), texto: t }].slice(-100); notas.push(`Nota: ${t}`); }
  }
  if (antes !== p.etapa) notas.unshift(`${ETAPAS[antes] || antes || "—"} → ${ETAPAS[p.etapa]}`);
  if (!notas.length) return { ok: true, pedido: p };
  p.historial = [...(p.historial || []), { fecha: ahoraISO(), texto: notas.join(" · ") + " (app)" }].slice(-200);
  await guardarPedido(env, p);
  // Si quedó pagado, se suma a la ficha del cliente (una sola vez por pedido)
  if (["por_despachar", "despachado", "entregado"].includes(p.etapa)) await registrarCliente(env, p);
  return { ok: true, pedido: p };
}

async function nuevoPedido(env, b, idPedido) {
  const c = b.cliente || {};
  const cliente = {
    nombre: limpio(c.nombre, 80), celular: celularE164(c.celular), ciudad: limpio(c.ciudad, 80),
    departamento: limpio(c.departamento, 80), direccion: limpio(c.direccion, 150), pais: limpio(c.pais, 2).toUpperCase() || "CO",
  };
  if (!cliente.nombre) return { ok: false, error: "Escribe el nombre del cliente." };
  const total = numero(b.total, 1e10);
  if (total === null || (total <= 0 && !b.permitirSinValor)) return { ok: false, error: "Escribe el valor total del pedido." };
  const envio = numero(b.envio, 1e9) || 0;
  const productos = String(b.productos || "").split(/\n|;/).map((x) => limpio(x, 200)).filter(Boolean).slice(0, 40);
  if (!productos.length) return { ok: false, error: "Escribe qué productos lleva." };
  const etapa = ETAPAS_MANUALES.includes(b.etapa) ? b.etapa : "por_pagar";
  const ahora = ahoraISO();
  const p = {
    id: idPedido(), fecha: ahora, canal: limpio(b.canal, 20) || "whatsapp", etapa, tipo: "manual",
    total, valorPedido: total, subtotal: Math.max(0, total - envio), envio: { valor: envio, detalle: limpio(b.envioDetalle, 80) },
    productos, cliente: { ...cliente, destino: [cliente.direccion, cliente.ciudad, cliente.departamento].filter(Boolean).join(", ") },
    costo: b.costo === undefined || b.costo === "" ? null : numero(b.costo, 1e10),
    proveedoresPagados: Boolean(b.proveedoresPagados), pagos: [], notas: [],
    historial: [{ fecha: ahora, texto: `Pedido creado a mano en la app (${limpio(b.canal, 20) || "whatsapp"})` }],
  };
  if (etapa !== "por_pagar" && etapa !== "cancelado") {
    p.pagadoEn = ahora;
    p.pagos.push({ id: `manual-${Date.now()}`, estado: "approved", medio: limpio(b.medio, 40) || "transferencia", monto: total, fecha: ahora, manual: true });
  }
  if (b.nota) p.notas.push({ fecha: ahora, texto: limpio(b.nota, 500) });
  await guardarPedido(env, p);
  if (p.pagadoEn && cliente.celular) await registrarCliente(env, p);
  return { ok: true, pedido: p };
}

/* ---------------- Notas de voz ---------------- */
function aBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const corto = (id) => String(id).slice(-6);
const fechaCorta = (iso) => { try { return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" }).format(new Date(iso)); } catch { return ""; } };

// Pedidos que el dueño puede estar nombrando: los que no han terminado y los de los últimos 60 días
async function candidatos(env) {
  const limite = Date.now() - 60 * 86400 * 1000;
  return (await resumenes(env)).filter((p) => p.e !== "vencido" && (["por_despachar", "despachado", "por_pagar"].includes(p.e) || Date.parse(p.f) > limite)).slice(0, 120);
}

async function voz(request, env, h) {
  if (!env.AI) return h.error("Falta activar Workers AI (enlace AI) en el Worker.", 503);
  let texto = "";
  const tipo = request.headers.get("Content-Type") || "";
  const lista = await candidatos(env);
  if (tipo.startsWith("audio/") || tipo === "application/octet-stream") {
    const largo = Number(request.headers.get("Content-Length") || 0);
    if (largo > 8 * 1024 * 1024) return h.error("El audio es muy largo (máximo unos 3 minutos).", 413);
    const audio = await request.arrayBuffer();
    if (audio.byteLength > 8 * 1024 * 1024) return h.error("El audio es muy largo (máximo unos 3 minutos).", 413);
    if (audio.byteLength < 800) return h.error("No se escuchó nada. Mantén presionado el botón mientras hablas.");
    const nombres = [...new Set(lista.map((p) => p.n).filter(Boolean))].slice(0, 40).join(", ");
    try {
      const r = await env.AI.run(MODELO_VOZ, {
        audio: aBase64(audio), language: "es", vad_filter: true,
        initial_prompt: `Pedidos de espuelas para gallos. Despachado, entregado, guía, Interrapidísimo, proveedores, costo, pares. Clientes: ${nombres}`.slice(0, 800),
      });
      texto = String((r && r.text) || "").trim();
    } catch (e) {
      console.error("whisper", e && e.message);
      return h.error("No pude pasar el audio a texto. Intenta de nuevo o escríbelo.", 502);
    }
    if (!texto) return h.error("No entendí el audio. Intenta de nuevo hablando cerca del celular.");
  } else {
    const b = await h.leerJSON(request);
    texto = limpio(b && b.texto, 2000);
    if (!texto) return h.error("Escribe o dicta qué pasó con los pedidos.");
  }
  const r = await interpretar(env, texto, lista);
  return h.json({ ok: true, texto, ...r });
}

const ESQUEMA = {
  type: "object",
  properties: {
    acciones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["cambiar_etapa", "registrar_costo", "proveedores_pagados", "registrar_pago", "nota", "nuevo_pedido"] },
          pedido: { type: "string" }, etapa: { type: "string" }, guia: { type: "string" },
          costo: { type: "number" }, monto: { type: "number" }, medio: { type: "string" }, texto: { type: "string" },
          cliente: { type: "string" }, celular: { type: "string" }, ciudad: { type: "string" }, productos: { type: "string" }, total: { type: "number" },
        },
        required: ["tipo"],
      },
    },
    dudas: { type: "string" },
  },
  required: ["acciones"],
};

function instrucciones(lista) {
  const hoy = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const filas = lista.map((p) => `${p.id} | ${p.n || "sin nombre"} | ${p.ci || ""} | ${ETAPAS[p.e] || p.e} | ${p.m === "USD" ? "USD " + p.t : "$" + Math.round(p.v || p.t || 0).toLocaleString("es-CO")} | ${fechaCorta(p.f)}${p.co != null ? " | costo registrado" : ""}${p.pv ? " | proveedores pagados" : ""}`).join("\n");
  return `Eres el asistente de la app de pedidos de Ingeniero Espuelístico, un taller en Colombia que fabrica espuelas para gallos y accesorios.
El dueño te dicta notas de voz (ya pasadas a texto, pueden tener errores de transcripción) para actualizar sus pedidos. Conviértelas en acciones. Hoy es ${hoy}.

PEDIDOS (código | cliente | ciudad | etapa | valor | fecha):
${filas || "(no hay pedidos)"}

REGLAS
1. En "pedido" pon SIEMPRE el código exacto de la lista (IE-...). Reconoce el pedido por el nombre del cliente (aunque esté mal escrito o solo diga el nombre o el apellido), la ciudad, el valor o los últimos caracteres del código.
2. Si un nombre coincide con varios pedidos y no se puede saber cuál es (por ejemplo, dos pedidos abiertos de Juan), NO adivines: no generes esa acción y explícalo en "dudas". Si uno solo de esos pedidos está en la etapa que tiene sentido (por ejemplo, para "despachado" solo uno está "Por despachar"), usa ese.
3. Etapas: "ya se despachó / ya salió / ya lo mandé / ya se envió" → cambiar_etapa con etapa "despachado". "Ya llegó / ya lo recibió / entregado" → etapa "entregado". "Cancelado / no lo quiso" → etapa "cancelado". Si dice un número de guía, ponlo en "guia" (solo letras y números).
4. "Ya pagó / consignó / transfirió / mandó la plata" → registrar_pago (con "monto" si dice cuánto y "medio" si dice cómo: transferencia, Nequi, Daviplata, efectivo, Bancolombia...).
5. "Ya se les pagó a los proveedores / ya pagué los materiales" → proveedores_pagados.
6. "Ese pedido costó X / me costó X / el costo fue X / gasté X en ese pedido" → registrar_costo con "costo".
7. Montos en pesos colombianos como número entero: "80 mil" = 80000; "1 millón 200" o "un millón doscientos mil" = 1200000; "un palo" = 1000000; "50 lucas" = 50000; "4 mil 500" = 4500.
8. Si dicta un pedido nuevo (dice "nuevo pedido" o el cliente no está en la lista y describe productos), usa nuevo_pedido con cliente, celular (si lo dice), ciudad, productos (texto tal cual) y total.
9. Cualquier otro dato útil sobre un pedido (por ejemplo "dice que lo recoge el lunes") → tipo "nota" con "texto".
10. Una frase puede tener varias acciones y puede hablar de varios pedidos. No inventes nada que no haya dicho.
Responde solo con el JSON.`;
}

async function interpretar(env, texto, lista) {
  let datos = null;
  try {
    const r = await env.AI.run(MODELO_TEXTO, {
      messages: [{ role: "system", content: instrucciones(lista) }, { role: "user", content: texto }],
      response_format: { type: "json_schema", json_schema: ESQUEMA },
      max_tokens: 900, temperature: 0.1,
    });
    datos = typeof r.response === "string" ? JSON.parse(r.response) : r.response;
  } catch (e) {
    console.error("interpretar", e && e.message);
    return { acciones: [], dudas: "No pude entender la instrucción. Intenta decirlo de otra forma, por ejemplo: «el pedido de Juan Pérez ya fue despachado, guía 123»." };
  }
  const porId = Object.fromEntries(lista.map((p) => [p.id, p]));
  const acciones = [];
  const dudas = [];
  if (datos && datos.dudas) dudas.push(limpio(datos.dudas, 400));
  for (const a of (datos && Array.isArray(datos.acciones) ? datos.acciones : []).slice(0, 15)) {
    const v = validarAccion(a, porId, lista);
    if (v.ok) acciones.push(v.accion); else if (v.duda) dudas.push(v.duda);
  }
  return { acciones, dudas: dudas.filter(Boolean).join(" ") };
}

function validarAccion(a, porId, lista) {
  if (!a || typeof a !== "object") return { ok: false };
  const tipo = a.tipo;
  if (tipo === "nuevo_pedido") {
    const total = numero(a.total);
    const accion = { tipo, cliente: limpio(a.cliente, 80), celular: limpio(a.celular, 20), ciudad: limpio(a.ciudad, 60), productos: limpio(a.productos, 500), total };
    if (!accion.cliente || !accion.productos) return { ok: false, duda: "Para crear un pedido nuevo necesito al menos el cliente y los productos." };
    accion.descripcion = `Nuevo pedido de ${accion.cliente}${accion.ciudad ? " (" + accion.ciudad + ")" : ""}: ${accion.productos}${total ? " · " + dinero({}, total) : " · sin valor (agrégalo después)"}`;
    return { ok: true, accion };
  }
  let id = limpio(a.pedido, 30).toUpperCase();
  if (!porId[id]) { const m = lista.filter((p) => p.id.endsWith(id.slice(-6)) && id.length >= 4); id = m.length === 1 ? m[0].id : ""; }
  const p = porId[id];
  if (!p) return { ok: false, duda: `No identifiqué a qué pedido te refieres${a.cliente ? " (" + limpio(a.cliente, 60) + ")" : ""}.` };
  const quien = `${p.n || "Cliente"}${p.ci ? " (" + p.ci + ")" : ""} · ${corto(p.id)}`;
  const accion = { tipo, pedido: p.id };
  if (tipo === "cambiar_etapa") {
    if (!ETAPAS_MANUALES.includes(a.etapa)) return { ok: false, duda: `No entendí a qué estado pasar el pedido de ${quien}.` };
    accion.etapa = a.etapa;
    accion.guia = limpio(a.guia, 60).replace(/[^\w-]/g, "") || undefined;
    if (p.e === a.etapa && !accion.guia) return { ok: false, duda: `El pedido de ${quien} ya estaba en «${ETAPAS[p.e]}».` };
    accion.descripcion = p.e === a.etapa ? `${quien}: guía ${accion.guia}` : `${quien}: ${ETAPAS[p.e] || p.e} → ${ETAPAS[a.etapa]}${accion.guia ? ", guía " + accion.guia : ""}`;
  } else if (tipo === "registrar_costo") {
    const c = numero(a.costo);
    if (!c) return { ok: false, duda: `No entendí el costo del pedido de ${quien}.` };
    accion.costo = c;
    accion.descripcion = `${quien}: costo ${dinero({}, c)}${p.s ? ` → ganancia ${dinero({}, (p.s || 0) - c)}` : ""}`;
  } else if (tipo === "proveedores_pagados") {
    accion.descripcion = `${quien}: proveedores pagados`;
  } else if (tipo === "registrar_pago") {
    accion.monto = numero(a.monto) || undefined;
    accion.medio = limpio(a.medio, 40) || undefined;
    accion.descripcion = `${quien}: pago recibido${accion.monto ? " de " + dinero({}, accion.monto) : ""}${accion.medio ? " por " + accion.medio : ""}`;
  } else if (tipo === "nota") {
    accion.texto = limpio(a.texto, 500);
    if (!accion.texto) return { ok: false };
    accion.descripcion = `${quien}: nota «${accion.texto}»`;
  } else return { ok: false };
  return { ok: true, accion };
}

async function aplicarAccion(env, a, idPedido) {
  if (!a || typeof a !== "object") return { ok: false, error: "Acción no válida" };
  if (a.tipo === "nuevo_pedido") {
    return nuevoPedido(env, { cliente: { nombre: a.cliente, celular: a.celular, ciudad: a.ciudad }, productos: a.productos, total: a.total || 0, permitirSinValor: true, canal: "voz", etapa: "por_pagar" }, idPedido)
      .then((r) => (r.ok ? { ok: true, pedido: r.pedido.id } : r));
  }
  const cambios = {
    cambiar_etapa: { etapa: a.etapa, ...(a.guia ? { guia: a.guia } : {}) },
    registrar_costo: { costo: a.costo },
    proveedores_pagados: { proveedoresPagados: true },
    registrar_pago: { pago: { monto: a.monto, medio: a.medio } },
    nota: { nota: a.texto },
  }[a.tipo];
  if (!cambios) return { ok: false, error: "Acción no válida" };
  const r = await actualizarPedido(env, limpio(a.pedido, 30), cambios);
  return r.ok ? { ok: true, pedido: a.pedido } : { ok: false, error: r.error };
}

/* ---------------- Resumen de la mañana (Telegram) ---------------- */
export async function resumenDiario(env, avisar, sitio) {
  if (!env.PEDIDOS) return;
  const lista = await resumenes(env);
  const de = (e) => lista.filter((p) => p.e === e);
  const porDespachar = de("por_despachar"), despachados = de("despachado");
  const sinCosto = lista.filter((p) => ["despachado", "entregado"].includes(p.e) && p.co == null);
  const proveedores = lista.filter((p) => ["por_despachar", "despachado", "entregado"].includes(p.e) && !p.pv);
  if (!porDespachar.length && !despachados.length && !sinCosto.length && !proveedores.length) return;
  const linea = (p) => `• ${p.n || "Cliente"}${p.ci ? " (" + p.ci + ")" : ""} · ${p.m === "USD" ? "USD " + p.t : "$" + Math.round(p.v || 0).toLocaleString("es-CO")}`;
  const mensaje = [
    "☀️ <b>Buenos días. Así van los pedidos:</b>",
    porDespachar.length ? `\n📦 <b>Por despachar: ${porDespachar.length}</b>\n${porDespachar.slice(0, 10).map(linea).join("\n")}` : null,
    despachados.length ? `\n🚚 Despachados sin confirmar entrega: ${despachados.length}` : null,
    proveedores.length ? `💸 Proveedores por pagar: ${proveedores.length} pedidos` : null,
    sinCosto.length ? `🧾 Sin costo registrado: ${sinCosto.length} pedidos` : null,
    `\n👉 <a href="${sitio}/admin/">Abrir la app de pedidos</a>`,
  ].filter((x) => x !== null).join("\n");
  await avisar(mensaje, false);
}
