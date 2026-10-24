// Peticiones, quejas y reclamos (Ley 1480, art. 50 lit. g, modificado por la Ley 2439 de 2024):
// cada solicitud recibe un número de radicado con fecha y hora, y se puede consultar su estado.
//   pqr:<radicado> → la solicitud (JSON). Metadatos cortos para listarlas en la app de pedidos.

export const TIPOS_PQR = {
  peticion: "Petición", queja: "Queja", reclamo: "Reclamo", garantia: "Garantía", retracto: "Retracto",
  reversion: "Reversión del pago", datos: "Datos personales", sugerencia: "Sugerencia",
};
export const ESTADOS_PQR = { recibida: "Recibida", en_tramite: "En trámite", respondida: "Respondida", cerrada: "Cerrada" };
const PLAZO_DIAS_HABILES = 15;

const limpio = (v, max) => String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f<>]/g, " ").trim().slice(0, max);
const ymdColombia = (ms) => new Date(ms - 5 * 3600000).toISOString().slice(0, 10);

// Fecha límite: suma días hábiles (sin sábados, domingos ni festivos de Colombia)
export function sumarDiasHabiles(desdeMs, dias, festivos = []) {
  let ms = desdeMs, n = 0;
  while (n < dias) {
    ms += 86400000;
    const ymd = ymdColombia(ms), dia = new Date(ms - 5 * 3600000).getUTCDay();
    if (dia !== 0 && dia !== 6 && !festivos.includes(ymd)) n++;
  }
  return ymd2iso(ymdColombia(ms));
}
const ymd2iso = (ymd) => `${ymd}T23:59:00-05:00`;

function radicado() {
  const hoy = ymdColombia(Date.now()).replace(/-/g, "");
  const azar = [...crypto.getRandomValues(new Uint8Array(2))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `PQR-${hoy}-${azar}`;
}
const metadatos = (q) => ({ e: q.estado, f: q.fecha, t: q.tipo, n: String(q.cliente.nombre || "").slice(0, 40), l: q.limite });

export async function crearPQR(env, cuerpo, ip, festivos, avisar) {
  const tipo = TIPOS_PQR[cuerpo.tipo] ? cuerpo.tipo : "";
  const cliente = {
    nombre: limpio(cuerpo.nombre, 80), documento: limpio(cuerpo.documento, 20).replace(/[^0-9A-Za-z-]/g, ""),
    celular: limpio(cuerpo.celular, 20).replace(/[^\d+]/g, ""), correo: /^[^\s@<>]{1,64}@[^\s@<>]{1,180}\.[a-z]{2,}$/i.test(limpio(cuerpo.correo, 120)) ? limpio(cuerpo.correo, 120).toLowerCase() : "",
  };
  const pedido = limpio(cuerpo.pedido, 30).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const mensaje = limpio(cuerpo.mensaje, 2000);
  if (!tipo) return { ok: false, error: "Elige el tipo de solicitud." };
  if (!cliente.nombre || !cliente.documento || cliente.celular.length < 8) return { ok: false, error: "Revisa tu nombre, documento y celular." };
  if (mensaje.length < 10) return { ok: false, error: "Cuéntanos con más detalle qué pasó." };
  if (cuerpo.acepto !== true) return { ok: false, error: "Para radicar, autoriza el tratamiento de tus datos." };
  if (!env.PEDIDOS) return { ok: false, error: "No pudimos radicar en este momento. Escríbenos por WhatsApp.", estado: 503 };
  // Freno contra abuso: máximo 5 solicitudes al día por conexión
  const kIp = `pqr:ip:${ip}`;
  const n = Number(await env.PEDIDOS.get(kIp)) || 0;
  if (n >= 5) return { ok: false, error: "Ya radicaste varias solicitudes hoy. Si necesitas algo más, escríbenos por WhatsApp.", estado: 429 };
  await env.PEDIDOS.put(kIp, String(n + 1), { expirationTtl: 86400 });

  const ahora = Date.now();
  const q = {
    radicado: radicado(), fecha: new Date(ahora).toISOString(), tipo, cliente, pedido, mensaje,
    estado: "recibida", limite: sumarDiasHabiles(ahora, PLAZO_DIAS_HABILES, festivos),
    historial: [{ fecha: new Date(ahora).toISOString(), texto: "Solicitud radicada en la página" }],
  };
  await env.PEDIDOS.put(`pqr:${q.radicado}`, JSON.stringify(q), { metadata: metadatos(q) });
  await avisar([
    `📮 <b>NUEVA PQR · ${TIPOS_PQR[tipo].toUpperCase()}</b>`,
    `Radicado: <b>${q.radicado}</b> · responder antes del ${q.limite.slice(0, 10)}`,
    `<b>${esc(cliente.nombre)}</b> · Doc. ${esc(cliente.documento)} · 📱 ${esc(cliente.celular)}${cliente.correo ? " · ✉️ " + esc(cliente.correo) : ""}`,
    pedido ? `Pedido: ${esc(pedido)}` : null,
    "", esc(mensaje),
  ].filter((x) => x !== null).join("\n"));
  return { ok: true, radicado: q.radicado, fecha: q.fecha, limite: q.limite };
}
const esc = (t) => String(t ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export async function consultarPQR(env, radicadoTexto, documento) {
  const r = limpio(radicadoTexto, 20).toUpperCase();
  if (!/^PQR-\d{8}-[0-9A-F]{4}$/.test(r) || !env.PEDIDOS) return { ok: false, error: "Revisa el número de radicado.", estado: 400 };
  const q = JSON.parse((await env.PEDIDOS.get(`pqr:${r}`)) || "null");
  const doc = limpio(documento, 20).replace(/[^0-9A-Za-z-]/g, "");
  if (!q || !doc || q.cliente.documento !== doc) return { ok: false, error: "No encontramos un radicado con ese número y documento.", estado: 404 };
  return { ok: true, radicado: q.radicado, tipo: q.tipo, estado: q.estado, fecha: q.fecha, limite: q.limite, respuesta: q.respuesta || "", respondida: q.respondida || null };
}

// Para la app de pedidos
export async function listarPQR(env) {
  const lista = [];
  let cursor;
  do {
    const r = await env.PEDIDOS.list({ prefix: "pqr:PQR-", cursor, limit: 1000 });
    lista.push(...r.keys.map((k) => ({ radicado: k.name.slice(4), ...(k.metadata || {}) })));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return lista.sort((a, b) => String(b.f).localeCompare(String(a.f)));
}
export async function leerPQR(env, r) { return JSON.parse((await env.PEDIDOS.get(`pqr:${limpio(r, 20)}`)) || "null"); }
export async function actualizarPQR(env, r, cambios) {
  const q = await leerPQR(env, r);
  if (!q) return { ok: false, error: "No encontramos esa PQR", estado: 404 };
  const notas = [];
  if (cambios.estado && ESTADOS_PQR[cambios.estado] && cambios.estado !== q.estado) { q.estado = cambios.estado; notas.push(`Estado: ${ESTADOS_PQR[q.estado]}`); }
  if (typeof cambios.respuesta === "string" && cambios.respuesta.trim()) {
    q.respuesta = limpio(cambios.respuesta, 3000);
    q.respondida = new Date().toISOString();
    if (q.estado === "recibida" || q.estado === "en_tramite") q.estado = "respondida";
    notas.push("Respuesta registrada");
  }
  if (!notas.length) return { ok: true, pqr: q };
  q.historial = [...(q.historial || []), { fecha: new Date().toISOString(), texto: notas.join(" · ") + " (app)" }];
  await env.PEDIDOS.put(`pqr:${q.radicado}`, JSON.stringify(q), { metadata: metadatos(q) });
  return { ok: true, pqr: q };
}
