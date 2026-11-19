// Agente de WhatsApp (pasada 1). Recibe los avisos (webhooks) de Zernio en POST /api/whatsapp.
//
// CÓMO FUNCIONA
//   1. El webhook verifica la firma de Zernio, descarta avisos repetidos y entrega el evento a la
//      "memoria" de esa conversación (un Durable Object: uno por chat).
//   2. Cada mensaje del cliente reinicia una alarma de unos segundos: así se juntan los mensajes
//      seguidos y se responde una sola vez. Nunca salen dos respuestas a la vez en el mismo chat.
//   3. Al sonar la alarma: lee el historial en Zernio, transcribe audios, consulta al modelo
//      (que cotiza con las mismas funciones de la tienda) y responde por Zernio.
//   4. Si Alexander escribe en el chat (desde el celular o el inbox), el agente se calla 12 horas.
//
// INTERRUPTOR (Cloudflare → Worker → Settings → Variables and Secrets):
//   AGENTE_ACTIVO          "no" o vacío = apagado · "prueba" = solo responde a AGENTE_NUMEROS_PRUEBA · "si" = encendido
//   AGENTE_NUMEROS_PRUEBA  números con indicativo, separados por coma (ej. 573001234567)
//   AGENTE_EXCLUIDOS       ids de conversación de Zernio donde nunca responde, separados por coma
// SECRETOS: ZERNIO_API_KEY, ZERNIO_WEBHOOK_SECRET, ANTHROPIC_API_KEY, PAGO_NEQUI (texto con los datos de Nequi)
// OPCIONALES: ANTHROPIC_MODEL (por defecto MODELO_DEFECTO), ZERNIO_ACCOUNT_ID (si el aviso no trae la cuenta)
//
// DIAGNÓSTICO: https://ingenieroespuelistico.com/api/whatsapp/diagnostico?clave=<SALUD_CLAVE o ADMIN_CLAVE>
//   muestra la configuración (sin valores secretos) y las últimas 60 decisiones del agente.
//   Con &revisar=1 además prueba en vivo las claves de Anthropic y de Zernio.
//   Con &liberarPrueba=1 desbloquea los chats de los números de prueba (para volver a probar después de
//   responder tú desde el celular). Con &liberar=<id de conversación> desbloquea un chat cualquiera.

import { CONOCIMIENTO } from "./agente-conocimiento.js";

const ZERNIO = "https://zernio.com/api/v1";
const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const MODELO_DEFECTO = "claude-sonnet-5-5";
const MODELO_VOZ = "@cf/openai/whisper-large-v3-turbo";
const MODELO_VOZ_NOVA = "@cf/deepgram/nova-3";      // recibe el tipo de archivo: entiende notas de voz OGG/Opus
const MODELO_VOZ_RESPALDO = "@cf/openai/whisper";    // último intento
const ESPERA_MS = 7000;             // espera para juntar mensajes seguidos del cliente
const HUMANO_HORAS = 12;            // tras escribir Alexander (o tras ceder), el agente calla
const MAX_RONDAS = 4;               // vueltas de herramientas por respuesta
const MAX_FOTOS = 4;
const FOTOS_DIAS = 30;              // una foto ya enviada en el chat no se repite durante este tiempo (salvo que el cliente la pida)
const MAX_RESPUESTAS_HORA = 20;     // freno de gasto por chat
const HISTORIAL = 30;               // mensajes de contexto
const DIA = 86400;
const AUTOMATICO_MS = 4000;          // un mensaje del celular que sale antes de esto tras el cliente es automático (bienvenida/ausencia)

let H = null; // herramientas de la tienda (Tienda, fleteColombia, fleteDHL, tasaDolar, telegram), las conecta index.js
export function conectarAgente(herramientas) { H = herramientas; }

/* ---------------- utilidades ---------------- */
const ok = (t = "ok", s = 200) => new Response(t, { status: s });
const digitos = (s) => String(s || "").replace(/\D/g, "");
// Listas separadas por coma, punto y coma o salto de línea (los números pueden llevar espacios, guiones o +)
const lista = (v) => String(v || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textoDe = (m) => String((m && (m.text ?? m.message)) || "").trim();
const tiempoDe = (m) => Date.parse((m && (m.sentAt || m.createdAt)) || "") || 0;
const fuenteDe = (m) => (m && (m.source || (m.metadata || {}).source)) || "";
const pesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const horaCO = (ms) => new Date(ms - 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
// Mensajes automáticos o vacíos (bienvenida, ausencia, no soportados) no cuentan como "Alexander escribió"
const esAutomatico = (m) => !textoDe(m) && !(m.attachments || []).length || /^\[unsupported message\]$/i.test(textoDe(m));

export function modoAgente(env) {
  const m = String(env.AGENTE_ACTIVO || "").trim().toLowerCase();
  return m === "si" || m === "sí" ? "si" : m === "prueba" ? "prueba" : "no";
}

function enHorario(ms) {
  const d = new Date(ms - 5 * 3600e3), dia = d.getUTCDay(), h = d.getUTCHours();
  return (dia >= 1 && dia <= 5 && h >= 8 && h < 19) || (dia === 6 && h >= 8 && h < 14);
}

const PREFIJOS = [
  ["1809", "DO", "República Dominicana"], ["1829", "DO", "República Dominicana"], ["1849", "DO", "República Dominicana"],
  ["1787", "PR", "Puerto Rico"], ["1939", "PR", "Puerto Rico"],
  ["593", "EC", "Ecuador"], ["507", "PA", "Panamá"], ["506", "CR", "Costa Rica"], ["502", "GT", "Guatemala"], ["503", "SV", "El Salvador"],
  ["504", "HN", "Honduras"], ["505", "NI", "Nicaragua"], ["591", "BO", "Bolivia"], ["595", "PY", "Paraguay"], ["598", "UY", "Uruguay"],
  ["57", "CO", "Colombia"], ["58", "VE", "Venezuela"], ["51", "PE", "Perú"], ["52", "MX", "México"], ["53", "CU", "Cuba"],
  ["54", "AR", "Argentina"], ["55", "BR", "Brasil"], ["56", "CL", "Chile"], ["34", "ES", "España"],
  ["1", "", "+1: Estados Unidos, Canadá u otro país del Caribe (pregunta cuál)"],
];
export function paisPorNumero(tel) {
  const d = digitos(tel);
  const p = PREFIJOS.find(([pre]) => d.startsWith(pre));
  return p ? { iso: p[1], nombre: p[2] } : { iso: "", nombre: "desconocido" };
}

// En WhatsApp, sender.phoneNumber puede venir vacío (migración de Meta a BSUID, o usuarios con nombre de
// usuario). Entonces el número viene en sender.id (sin "+"), o solo hay un businessScopedUserId.
function idsRemitente(m, conv) {
  const s = (m && m.sender) || {};
  return [s.phoneNumber, s.id, s.businessScopedUserId, s.parentBusinessScopedUserId, (conv || {}).participantId]
    .filter(Boolean).map((x) => String(x).trim());
}
export function telefonoDe(m, conv) {
  const s = (m && m.sender) || {};
  for (const v of [s.phoneNumber, s.id, (conv || {}).participantId]) {
    const t = String(v || "").trim();
    if (/^\+?\d{7,15}$/.test(t.replace(/[\s-]/g, ""))) return digitos(t);
  }
  return "";
}
function esDePrueba(env, m, conv) {
  const ids = idsRemitente(m, conv), idsDig = ids.map(digitos).filter((d) => d.length >= 7);
  return lista(env.AGENTE_NUMEROS_PRUEBA).some((x) => ids.includes(x) || (digitos(x).length >= 7 && idsDig.includes(digitos(x))));
}
const enmascarar = (v) => { const s = String(v || ""); return s.length > 8 ? s.slice(0, 5) + "…" + s.slice(-3) : s ? "…" + s.slice(-2) : "(vacío)"; };

// Registro de diagnóstico: últimas decisiones del agente, sin texto de los mensajes
async function anotar(env, datos) {
  try {
    if (!env.CONVERSACIONES_WA) return;
    const d = env.CONVERSACIONES_WA.get(env.CONVERSACIONES_WA.idFromName("__diagnostico__"));
    await d.fetch("https://agente/diag/anotar", { method: "POST", body: JSON.stringify({ hora: horaCO(Date.now()), ...datos }) });
  } catch (e) { console.error("diagnóstico", e && e.message); }
  console.log("agente", JSON.stringify(datos));
}
const resumenEv = (ev) => { const m = (ev && ev.message) || {}, c = (ev && ev.conversation) || {};
  return { evento: ev && ev.event, chat: String(m.conversationId || c.id || "").slice(-6), de: enmascarar(telefonoDe(m, c) || (m.sender || {}).id) }; };

async function firmaValida(cuerpo, firma, secreto) {
  if (!firma || !secreto) return false;
  const enc = new TextEncoder();
  const clave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", clave, enc.encode(cuerpo)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const f = String(firma).trim().toLowerCase().replace(/^sha256=/, "");
  if (f.length !== hex.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ f.charCodeAt(i);
  return dif === 0;
}

function aBase64(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------------- 1. Webhook de Zernio ---------------- */
export async function atenderWhatsApp(request, env) {
  if (request.method !== "POST") return ok();
  if (!env.ZERNIO_WEBHOOK_SECRET) { await anotar(env, { decision: "rechazado: falta el secreto ZERNIO_WEBHOOK_SECRET en Cloudflare" }); return ok("Falta ZERNIO_WEBHOOK_SECRET", 503); }
  const crudo = await request.text();
  const firma = request.headers.get("X-Zernio-Signature") || request.headers.get("X-Late-Signature") || "";
  if (!(await firmaValida(crudo, firma, env.ZERNIO_WEBHOOK_SECRET))) {
    await anotar(env, { decision: firma ? "rechazado: la firma no coincide (el secret del webhook en Zernio es distinto al de Cloudflare)" : "rechazado: el aviso llegó sin firma (falta el secret en el webhook de Zernio)" });
    return ok("Firma inválida", 401);
  }
  let ev;
  try { ev = JSON.parse(crudo); } catch { return ok("JSON inválido", 400); }
  if (!ev || (ev.event !== "message.received" && ev.event !== "message.sent")) { await anotar(env, { evento: ev && ev.event, decision: "ignorado: tipo de evento que el agente no usa" }); return ok(); }
  if (modoAgente(env) === "no") return ok(); // apagado: no hace nada
  const m = ev.message || {};
  if (m.platform && m.platform !== "whatsapp") return ok();
  const cid = m.conversationId || (ev.conversation || {}).id;
  if (!cid || !env.CONVERSACIONES_WA) { await anotar(env, { ...resumenEv(ev), decision: "ignorado: el aviso no trae conversación" }); return ok(); }
  const chat = env.CONVERSACIONES_WA.get(env.CONVERSACIONES_WA.idFromName(cid));
  await chat.fetch("https://agente/evento", { method: "POST", body: crudo });
  return ok();
}

/* ---------------- 2. Memoria de cada conversación ---------------- */
export class ConversacionWA {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const ruta = new URL(request.url).pathname, s = this.state.storage;
    if (ruta === "/diag/anotar") {
      const l = (await s.get("diag")) || [];
      l.push(await request.json().catch(() => ({})));
      await s.put("diag", l.slice(-60));
      return ok();
    }
    if (ruta === "/diag/leer") return new Response(JSON.stringify(((await s.get("diag")) || []).slice().reverse()), { headers: { "content-type": "application/json" } });
    if (ruta === "/diag/probar-envio") { // lo pide el diagnóstico con revisar=1: cotiza aquí adentro, igual que cuando atiende un chat
      const registro = [], ctx = { registro };
      const prueba = async (nombre, inp) => { try { return await ejecutar(nombre, inp, this.env, ctx); } catch (e) { registro.push(`${nombre}: ERROR ${String((e && e.message) || e).slice(0, 160)}`); return { ok: false }; } };
      const col = await prueba("cotizar_envio_colombia", { lineas: [], municipio: "Medellín", departamento: "Antioquia" });
      const int = await prueba("cotizar_envio_internacional", { lineas: [], pais: "EC", ciudad: "Quito", region: "Pichincha" });
      return new Response(JSON.stringify({
        colombia: col.ok ? `funciona: ${pesos(col.valor_envio_cop)} a Medellín (pedido mínimo)` : "falla",
        dhl: int.dhl && int.dhl.usd ? `funciona: USD ${int.dhl.usd} a Quito (pedido mínimo)` : "falla",
        detalle: registro,
      }), { headers: { "content-type": "application/json" } });
    }
    if (ruta === "/liberar") { // lo pide el diagnóstico (con clave): el agente vuelve a responder en este chat
      await s.delete("humanoHasta"); await s.delete("pendiente"); await s.deleteAlarm();
      await s.put("ignorarHumanoAntes", Date.now());
      return ok();
    }
    const ev = await request.json().catch(() => null);
    if (!ev) return ok();
    if (ev.id) { // Zernio puede repetir un aviso: se procesa una sola vez (sin gastar escrituras de KV)
      const vistos = (await s.get("eventos")) || [];
      if (vistos.includes(ev.id)) { await anotar(this.env, { ...resumenEv(ev), decision: "ignorado: aviso repetido" }); return ok(); }
      await s.put("eventos", [...vistos, ev.id].slice(-200));
    }
    if (ev.event === "message.sent") await this.saliente(ev);
    else if (ev.event === "message.received") await this.entrante(ev);
    return ok();
  }

  // Un mensaje salió del número del negocio: ¿lo mandó el agente o Alexander?
  async saliente(ev) {
    const m = ev.message || {}, s = this.state.storage;
    if (esAutomatico(m)) return;
    const mios = (await s.get("mios")) || [];
    if ([m.platformMessageId, m.id].filter(Boolean).some((id) => mios.includes(id))) return;
    if (m.sentVia === "api" && ((await s.get("enviandoHasta")) || 0) > Date.now()) return; // es del agente (aviso adelantado)
    const ultEnt = (await s.get("ultimoEntrante")) || 0, tSal = tiempoDe(m) || Date.now();
    if (ultEnt && tSal >= ultEnt && tSal - ultEnt <= AUTOMATICO_MS) {
      return anotar(this.env, { ...resumenEv(ev), decision: `ignorado: parece mensaje automático de la app (salió ${Math.round((tSal - ultEnt) / 1000)} s después del cliente)` });
    }
    await anotar(this.env, { ...resumenEv(ev), decision: `Alexander escribió (${fuenteDe(m) || m.sentVia || "origen desconocido"}): el agente calla ${HUMANO_HORAS} h en este chat` });
    await s.put("humanoHasta", Date.now() + HUMANO_HORAS * 3600e3);
    await s.delete("pendiente");
    await s.deleteAlarm();
  }

  async entrante(ev) {
    const env = this.env, md = modoAgente(env);
    if (md === "no") return;
    const m = ev.message || {}, conv = ev.conversation || {};
    const cid = m.conversationId || conv.id;
    const s = this.state.storage;
    await s.put("ultimoEntrante", tiempoDe(m) || Date.now());
    if (lista(env.AGENTE_EXCLUIDOS).includes(cid)) return anotar(env, { ...resumenEv(ev), decision: "ignorado: conversación excluida" });
    const marca = md === "prueba" ? { prueba: true, cid } : {};
    if (md === "prueba" && !esDePrueba(env, m, conv)) {
      return anotar(env, { ...resumenEv(ev), decision: "modo prueba: no es un número de prueba", idsRecibidos: idsRemitente(m, conv).map(enmascarar) });
    }
    const hasta = (await s.get("humanoHasta")) || 0;
    if (hasta > Date.now()) return anotar(env, { ...resumenEv(ev), ...marca, decision: `en manos de Alexander hasta las ${horaCO(hasta).slice(11)}: el agente no responde aquí todavía` });
    await s.put("pendiente", ev);
    await s.setAlarm(Date.now() + ESPERA_MS); // cada mensaje nuevo corre la alarma: se responde una vez
    await anotar(env, { ...resumenEv(ev), ...marca, decision: `recibido: responde en ~${ESPERA_MS / 1000} s si no llegan más mensajes` });
  }

  async alarm() {
    const s = this.state.storage, ev = await s.get("pendiente");
    if (!ev) return;
    await s.delete("pendiente");
    try { await atender(ev, this.env, s); }
    catch (e) { // nunca se reintenta (evita mensajes dobles): se avisa a Alexander
      console.error("agente", e && (e.stack || e.message));
      await anotar(this.env, { ...resumenEv(ev), decision: "ERROR: " + String((e && e.message) || e).slice(0, 300) });
      await avisarTelegram(this.env, ev, "⚠️ <b>El agente no pudo responder</b>, respóndele tú", String((e && e.message) || e).slice(0, 200)).catch(() => {});
    }
  }
}

/* ---------------- 3. Responder ---------------- */
async function atender(ev, env, s) {
  if (!H) throw new Error("El agente no está conectado al servidor");
  if (!env.ZERNIO_API_KEY || !env.ANTHROPIC_API_KEY) throw new Error("Faltan ZERNIO_API_KEY o ANTHROPIC_API_KEY");
  if (((await s.get("humanoHasta")) || 0) > Date.now()) return;
  const m = ev.message || {}, conv = ev.conversation || {};
  const cid = m.conversationId || conv.id;
  const cuenta = (ev.account || {}).accountId || env.ZERNIO_ACCOUNT_ID || (ev.account || {}).id;
  const tel = telefonoDe(m, conv);
  const nombre = (m.sender || {}).name || conv.participantName || "";
  const pais = paisPorNumero(tel);

  // Freno de gasto
  const hora = Math.floor(Date.now() / 3600e3), cont = (await s.get("contador")) || {};
  const n = cont.hora === hora ? cont.n : 0;
  if (n >= MAX_RESPUESTAS_HORA) {
    await s.put("humanoHasta", Date.now() + HUMANO_HORAS * 3600e3);
    await anotar(env, { ...resumenEv(ev), decision: "freno: demasiadas respuestas en una hora, pasa a Alexander" });
    return avisarTelegram(env, ev, "🛑 <b>Freno del agente</b>: muchas respuestas en una hora en este chat, atiéndelo tú", "");
  }

  // Historial (de Zernio) + el mensaje actual si aún no aparece
  const hist = await leerHistorial(env, cid, cuenta);
  const tEste = tiempoDe(m) || Date.parse(ev.timestamp) || Date.now();
  if (!hist.some((x) => x.direction === "incoming" && Math.abs(tiempoDe(x) - tEste) < 3000)) {
    hist.push({ direction: "incoming", message: textoDe(m), attachments: m.attachments || [], sentAt: m.sentAt || ev.timestamp });
  }
  hist.sort((a, b) => tiempoDe(a) - tiempoDe(b));

  // ¿Alguien ya respondió después de este mensaje? ¿Alexander escribió en las últimas horas?
  const mios = (await s.get("mios")) || [];
  const delAgente = (x) => mios.includes(x.id) || x.sentVia === "api";
  const ignorarAntes = (await s.get("ignorarHumanoAntes")) || 0;
  const marca = modoAgente(env) === "prueba" ? { prueba: true, cid } : {};
  const salientesReales = hist.filter((x) => x.direction === "outgoing" && !esAutomatico(x) && !esRespuestaAutomatica(x, hist));
  if (salientesReales.some((x) => tiempoDe(x) > tEste)) return anotar(env, { ...resumenEv(ev), ...marca, decision: "no responde: ya se respondió después de ese mensaje" });
  const bloqueo = salientesReales.filter((x) => !delAgente(x) && tiempoDe(x) > ignorarAntes && Date.now() - tiempoDe(x) < HUMANO_HORAS * 3600e3).pop();
  if (bloqueo) {
    await s.put("humanoHasta", Date.now() + HUMANO_HORAS * 3600e3);
    return anotar(env, { ...resumenEv(ev), ...marca, decision: `no responde: Alexander escribió en este chat en las últimas ${HUMANO_HORAS} h`,
      mensajeQueBloquea: { hora: horaCO(tiempoDe(bloqueo)), origen: fuenteDe(bloqueo) || bloqueo.sentVia || "desconocido" } });
  }

  // Audios del último turno del cliente
  const herramientas = []; // lo que se anota en el diagnóstico (sin texto de los mensajes)
  const idxSal = hist.map((x) => x.direction).lastIndexOf("outgoing");
  const turno = hist.slice(idxSal + 1).filter((x) => x.direction === "incoming");
  let audiosFallidos = 0, transcritos = 0;
  // El aviso de Zernio puede traer el audio más completo (con su id) que el historial: se combinan
  const audioAviso = (m.attachments || []).find(esAudio);
  const xEste = audioAviso && turno.find((x) => Math.abs(tiempoDe(x) - tEste) < 3000);
  if (xEste) {
    const h = (xEste.attachments || []).find(esAudio);
    if (!h) xEste.attachments = [...(xEste.attachments || []), audioAviso];
    else if (!((h.payload || {}).id) && (audioAviso.payload || {}).id) Object.assign(h, { payload: { ...(h.payload || {}), ...audioAviso.payload }, url: h.url || audioAviso.url });
  }
  for (const x of turno) {
    const a = (x.attachments || []).find(esAudio);
    if (!a) {
      if ((x.attachments || []).length) herramientas.push(`adjunto: ${(x.attachments || []).map(describirAdjunto).join("; ")}`);
      continue;
    }
    if (transcritos >= 3) continue;
    const r = await transcribir(env, a, cuenta).catch((e) => ({ texto: "", detalle: "error: " + String((e && e.message) || e).slice(0, 120) }));
    herramientas.push(`audio (${describirAdjunto(a)}): ${r.detalle}`);
    if (r.texto) { x.transcripcion = r.texto; transcritos++; } else { x.audioFallido = true; audiosFallidos++; }
  }

  // Si un audio no se pudo escuchar, no se le pregunta al modelo: se le pasa el chat a Alexander de una vez
  if (audiosFallidos) {
    const textoCesion = `Mi amigo, no logré escuchar su audio. Ya le paso su mensaje a Alexander para que lo atienda${enHorario(Date.now()) ? " personalmente" : " en el horario de atención"}.`;
    await s.put("enviandoHasta", Date.now() + 120e3);
    const mid = await enviarZernio(env, cid, cuenta, { message: textoCesion });
    await s.put("mios", [...mios, mid].filter(Boolean).slice(-60));
    await s.put("contador", { hora, n: n + 1 });
    await s.put("humanoHasta", Date.now() + HUMANO_HORAS * 3600e3);
    await avisarTelegram(env, ev, "🎙️ <b>Audio que el agente no pudo escuchar</b>, atiéndelo tú", "audio sin transcribir", "", textoCesion);
    return anotar(env, { ...resumenEv(ev), ...marca, decision: "cedió a Alexander: audio que no se pudo escuchar", herramientas: herramientas.slice(0, 8) });
  }

  // Consulta al modelo
  const ahora = Date.now();
  const campana = ((m.metadata || {}).ad || {}).campaignName || (conv.adAttribution || {}).campaignName || "";
  const previo = hist.some((x) => tiempoDe(x) < ahora - 2 * DIA * 1000);
  const fotosYa = Object.fromEntries(Object.entries((await s.get("fotosEnviadas")) || {}).filter(([, t]) => ahora - t < FOTOS_DIAS * DIA * 1000));
  const nombreProd = (id) => (H.Tienda.PRODUCTOS.find((p) => p.id === id) || {}).nombre || id;
  const fotosTexto = Object.entries(fotosYa).map(([id, t]) => `${nombreProd(id)} (id ${id}, ${horaCO(t)})`).join("; ");
  const sistema = `${CONOCIMIENTO}

DATOS DE LA TIENDA (hoy)
${datosTienda(env)}
Hora actual en Colombia: ${horaCO(ahora)} (${enHorario(ahora) ? "dentro" : "FUERA"} del horario de atención).`;
  const pedido = `CLIENTE
- Nombre en WhatsApp: ${nombre || "(desconocido)"}
- País por el número: ${pais.nombre}
- ¿Ya había escrito antes?: ${previo ? "sí, tiene historial con el negocio" : "no, parece cliente nuevo"}
- Fotos ya enviadas en este chat: ${fotosTexto || "ninguna"}
${campana ? `- Llegó por el anuncio: ${campana}\n` : ""}${audiosFallidos ? `- OJO: ${audiosFallidos} audio(s) del cliente no se pudieron transcribir.\n` : ""}
HISTORIAL (lo más antiguo arriba; NEGOCIO incluye mensajes de Alexander y del asistente)
${hist.slice(-HISTORIAL).map(lineaHistorial).join("\n")}

Responde al último turno del cliente. Usa las herramientas para cualquier precio o envío y termina SIEMPRE con la herramienta responder.`;

  const decision = await pensar(env, sistema, pedido, { pais: pais.iso, registro: herramientas });

  // Enviar
  const texto = String(decision.mensaje || "").trim().slice(0, 1500);
  // Fotos: no se repiten las ya enviadas en este chat, salvo que el cliente las pida de nuevo (reenviar_fotos)
  const pedidas = [...new Set((decision.fotos || []).filter((id) => H.Tienda.PRODUCTOS.some((p) => p.id === id)))];
  const fotos = (decision.reenviar_fotos ? pedidas : pedidas.filter((id) => !fotosYa[id])).slice(0, MAX_FOTOS);
  const enviados = [];
  if (texto || fotos.length) await s.put("enviandoHasta", Date.now() + 120e3);
  if (texto) enviados.push(await enviarZernio(env, cid, cuenta, { message: texto }));
  for (const id of fotos) {
    const mid = await enviarZernio(env, cid, cuenta, { attachmentUrl: `${H.Tienda.NEGOCIO.sitio}/fotos/${id}/1.jpg`, attachmentType: "image" }).catch(() => null);
    if (mid !== null) fotosYa[id] = Date.now();
    enviados.push(mid || "");
  }
  if (fotos.length) await s.put("fotosEnviadas", fotosYa);
  await s.put("mios", [...mios, ...enviados.filter(Boolean)].slice(-60));
  await s.put("contador", { hora, n: n + 1 });

  // Ceder / avisar
  if (decision.ceder) {
    await s.put("humanoHasta", Date.now() + HUMANO_HORAS * 3600e3);
    await avisarTelegram(env, ev, "🤝 <b>Te paso un cliente de WhatsApp</b>", decision.motivo_cesion, decision.resumen, texto);
  } else if (decision.avisar) {
    await avisarTelegram(env, ev, "👀 <b>Pendiente de este cliente</b> (el agente sigue atendiendo)", decision.motivo_aviso, decision.resumen, texto);
  }

  await anotar(env, { ...resumenEv(ev), decision: `respondió (${enviados.filter(Boolean).length} mensaje(s))${decision.ceder ? ", cedió a Alexander: " + (decision.motivo_cesion || "") : ""}${decision.avisar ? ", avisó a Alexander" : ""}`,
    ...(herramientas.length ? { herramientas: herramientas.slice(0, 8) } : {}) });

  // CRM mínimo, en la memoria del chat (no gasta escrituras de KV)
  {
    const antes = (await s.get("perfil")) || {};
    await s.put("perfil", ({
      ...antes, nombre: nombre || antes.nombre, telefono: tel, pais: pais.iso || antes.pais, conversacion: cid,
      primerContacto: antes.primerContacto || new Date(tiempoDe(hist[0]) || ahora).toISOString(), ultimoContacto: new Date(ahora).toISOString(),
      anuncio: campana || antes.anuncio || "", resumen: decision.resumen || antes.resumen || "",
      cesiones: (antes.cesiones || 0) + (decision.ceder ? 1 : 0), respuestasAgente: (antes.respuestasAgente || 0) + 1,
    }));
  }
}

// ¿Salió del celular apenas unos segundos después del mensaje del cliente? Entonces lo mandó la app sola.
function esRespuestaAutomatica(x, hist) {
  const t = tiempoDe(x); let prev = 0;
  for (const y of hist) { const ty = tiempoDe(y); if (y.direction === "incoming" && ty <= t && ty > prev) prev = ty; }
  return Boolean(prev) && t - prev <= AUTOMATICO_MS;
}

function lineaHistorial(x) {
  const quien = x.direction === "incoming" ? "CLIENTE" : "NEGOCIO";
  const adj = (x.attachments || []).map((a) => (esAudio(a)
    ? (x.transcripcion ? `[AUDIO transcrito: "${x.transcripcion}"]` : x.direction === "incoming" ? "[AUDIO del cliente]" : "[AUDIO]")
    : x.direction === "outgoing" && a.type === "image" ? "[FOTO enviada]"
    : `[${String(a.type || "adjunto").toUpperCase()} que no puedes ver]`)).join(" ");
  const t = textoDe(x).replace(/^\[unsupported message\]$/i, "[mensaje no soportado]");
  return `[${horaCO(tiempoDe(x))}] ${quien}: ${[adj, t].filter(Boolean).join(" ").slice(0, 600)}`;
}

async function leerHistorial(env, cid, cuenta) {
  const u = `${ZERNIO}/inbox/conversations/${encodeURIComponent(cid)}/messages?accountId=${encodeURIComponent(cuenta || "")}&limit=${HISTORIAL + 10}&sortOrder=desc`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${env.ZERNIO_API_KEY}` }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("Zernio historial " + r.status);
  const d = await r.json();
  return (d.messages || d.data || []).filter((x) => !x.isDeleted).reverse();
}

async function enviarZernio(env, cid, cuenta, cuerpo) {
  const r = await fetch(`${ZERNIO}/inbox/conversations/${encodeURIComponent(cid)}/messages`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ZERNIO_API_KEY}` },
    body: JSON.stringify({ accountId: cuenta, ...cuerpo }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) throw new Error(`Zernio envío ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  return (d.data || {}).messageId || "";
}

// ¿Es una nota de voz o un audio? WhatsApp y Zernio pueden marcarlo como audio, voice o ptt, o solo con el tipo de archivo
function esAudio(a) {
  if (!a) return false;
  const p = a.payload || {};
  const tipo = String(a.type || "").toLowerCase(), mime = String(a.mimeType || a.mime_type || p.mimeType || p.mime_type || "").toLowerCase();
  return ["audio", "voice", "ptt"].includes(tipo) || mime.startsWith("audio/") || Boolean(p.voice) || /\.(ogg|oga|opus|mp3|m4a|aac|amr|wav)(\?|$)/i.test(String(a.url || ""));
}
// Para el diagnóstico: tipo y formato del adjunto, sin enlaces ni contenido
function describirAdjunto(a) {
  const p = (a && a.payload) || {};
  const formato = (a && (a.mimeType || a.mime_type)) || p.mimeType || p.mime_type;
  const u = urlAbsoluta((a && a.url) || p.url || p.link);
  return [`tipo=${String((a && a.type) || "?").slice(0, 20)}`, formato ? `formato=${String(formato).slice(0, 30)}` : "", p.id ? "con id" : "sin id",
    u ? `url=${formaUrl(u)}` : (a && a.url) ? `url rara="${String(a.url).slice(0, 40)}"` : "sin url",
    `campos=${Object.keys(a || {}).join(",").slice(0, 80)}${Object.keys(p).length ? ` payload=${Object.keys(p).join(",").slice(0, 60)}` : ""}`].filter(Boolean).join(" ");
}
// Enlaces de Zernio: pueden venir completos, sin "https:" o como ruta (/api/v1/...). Se completan para poder abrirlos.
function urlAbsoluta(u) {
  const t = String(u || "").trim();
  if (!t || /^(data|blob|javascript|file):/i.test(t)) return "";
  let completa;
  if (/^https?:\/\//i.test(t)) completa = t;
  else if (t.startsWith("//")) completa = "https:" + t;
  else if (t.startsWith("/v1/")) completa = "https://zernio.com/api" + t;
  else if (t.startsWith("/")) completa = "https://zernio.com" + t;
  else if (/^api\//i.test(t)) completa = "https://zernio.com/" + t;
  else if (/^v1\//i.test(t)) completa = "https://zernio.com/api/" + t;
  else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(t)) completa = "https://" + t;
  else return "";
  try { return new URL(completa).toString(); } catch { return ""; }
}
// Para el diagnóstico: sitio y ruta del enlace, sin parámetros ni identificadores largos
function formaUrl(u) {
  try { const x = new URL(u); return (x.hostname + x.pathname).replace(/[A-Za-z0-9_=-]{12,}/g, "…").slice(0, 70); } catch { return "?"; }
}

// Descarga el audio como dice Zernio (GET /whatsapp/media/{id}?accountId, con la clave) y lo pasa a texto.
// La clave de Zernio solo se manda a zernio.com, nunca a otro sitio.
async function transcribir(env, a, cuenta) {
  if (!env.AI) return { texto: "", detalle: "falta el enlace AI (Workers AI) en el Worker" };
  const clave = { Authorization: `Bearer ${env.ZERNIO_API_KEY}` };
  const p = a.payload || {};
  const esZernio = (u) => { try { const h = new URL(u).hostname; return h === "zernio.com" || h.endsWith(".zernio.com"); } catch { return false; } };
  const enlaces = [...new Set([a.url, p.url, p.link].map(urlAbsoluta).filter(Boolean))];
  // El id del archivo también puede venir dentro del enlace (/whatsapp/media/{id} o ?mediaId=)
  const idsEnlace = enlaces.map((u) => { try { const x = new URL(u); return (x.pathname.match(/\/whatsapp\/media\/([^/?#]+)/) || [])[1] || x.searchParams.get("mediaId") || x.searchParams.get("media_id") || ""; } catch { return ""; } });
  const ids = [...new Set([p.id, p.mediaId, p.media_id, a.mediaId, a.media_id, a.id, ...idsEnlace].filter((x) => x && /^[\w.:=%-]{4,300}$/.test(String(x))).map((x) => decodeURIComponent(String(x))))];
  const intentos = [];
  if (cuenta) for (const id of ids) intentos.push({ nombre: "media", url: `${ZERNIO}/whatsapp/media/${encodeURIComponent(id)}?accountId=${encodeURIComponent(cuenta)}`, headers: clave });
  for (const u of enlaces) intentos.push({ nombre: `url(${formaUrl(u)})`, url: u, headers: esZernio(u) ? clave : {} });
  if (!intentos.length) return { texto: "", detalle: "el adjunto no trae id ni url" };
  const notas = [];
  let buf = null, formato = "";
  for (let k = 0; k < intentos.length && k < 8; k++) {
    const i = intentos[k];
    const r = await fetch(i.url, { headers: i.headers, signal: AbortSignal.timeout(20000) })
      .catch((e) => ({ ok: false, status: /timeout|abort/i.test(String((e && e.name) || "")) ? "tiempo agotado" : "error " + String((e && e.message) || e).slice(0, 80) }));
    const ct = (r.headers && r.headers.get("content-type")) || "";
    if (r.ok && /json/i.test(ct)) { // algunas respuestas traen un enlace en vez del audio: se sigue ese enlace
      const j = await r.json().catch(() => null);
      const sig = j && [j.url, j.downloadUrl, j.download_url, (j.data || {}).url].map(urlAbsoluta).find(Boolean);
      notas.push(`${i.nombre} 200 json${sig ? " con enlace" : " sin audio"}`);
      if (sig) intentos.push({ nombre: "enlace", url: sig, headers: esZernio(sig) ? clave : {} });
      continue;
    }
    notas.push(`${i.nombre} ${r.status}`);
    if (r.ok) { buf = await r.arrayBuffer(); formato = ct; break; }
  }
  if (!buf) return { texto: "", detalle: `no se pudo descargar (${notas.join(", ")})` };
  const kb = Math.round(buf.byteLength / 1024), firma = firmaAudio(buf);
  const datos = `${notas.join(", ")}, ${kb} KB, ${formato || "formato ?"}, firma ${firma || "?"}`;
  if (buf.byteLength < 500 || buf.byteLength > 8 * 1024 * 1024) return { texto: "", detalle: `descargado (${datos}) pero el tamaño no sirve` };
  const tipo = /^audio\//i.test(formato) ? formato.split(";")[0] : TIPO_POR_FIRMA[firma] || String(a.mimeType || p.mimeType || "audio/ogg").split(";")[0];
  const b64 = aBase64(buf), fallos = [];
  const listo = (texto, con) => ({ texto: String(texto || "").trim().slice(0, 1000), detalle: `transcrito con ${con} (${datos})${fallos.length ? "; antes: " + fallos.join("; ") : ""}` });
  // 1) Whisper turbo. 2) Deepgram Nova-3, que recibe el tipo de archivo (sirve para notas de voz OGG/Opus). 3) Whisper clásico.
  try {
    const out = await env.AI.run(MODELO_VOZ, { audio: b64, language: "es", vad_filter: true,
      initial_prompt: "Cliente preguntando por espuelas para gallos, patapiojas, líneas, pares, docenas, envío, Interrapidísimo, contraentrega, Nequi." });
    if (String((out && out.text) || "").trim()) return listo(out.text, "Whisper turbo");
    fallos.push("turbo no entendió nada");
  } catch (e) { fallos.push("turbo falló: " + String((e && e.message) || e).slice(0, 100)); }
  for (const extra of [{ language: "es" }, {}]) {
    try {
      const out = await env.AI.run(MODELO_VOZ_NOVA, { audio: { body: b64, contentType: tipo }, ...extra });
      const alt = ((((out || {}).results || {}).channels || [])[0] || {}).alternatives || [];
      const texto = (alt[0] || {}).transcript || "";
      if (String(texto).trim()) return listo(texto, `Nova-3 (${tipo})`);
      fallos.push("nova no entendió nada"); break;
    } catch (e) { fallos.push(`nova${extra.language ? "" : " sin idioma"} falló: ` + String((e && e.message) || e).slice(0, 100)); }
  }
  if (buf.byteLength <= 4 * 1024 * 1024) {
    try {
      const out = await env.AI.run(MODELO_VOZ_RESPALDO, { audio: [...new Uint8Array(buf)] });
      if (String((out && out.text) || "").trim()) return listo(out.text, "Whisper clásico");
      fallos.push("respaldo no entendió nada");
    } catch (e) { fallos.push("respaldo falló: " + String((e && e.message) || e).slice(0, 100)); }
  }
  return { texto: "", detalle: `descargado (${datos}) pero no se pudo pasar a texto: ${fallos.join("; ")}` };
}

// Los primeros bytes dicen el formato real del archivo
const TIPO_POR_FIRMA = { OggS: "audio/ogg", RIFF: "audio/wav", ID3: "audio/mpeg", MP3: "audio/mpeg", ftyp: "audio/mp4", WebM: "audio/webm", fLaC: "audio/flac", AMR: "audio/amr" };
function firmaAudio(buf) {
  const b = new Uint8Array(buf.slice(0, 12)), txt = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (txt(0, 4) === "OggS") return "OggS";
  if (txt(0, 4) === "RIFF") return "RIFF";
  if (txt(0, 3) === "ID3") return "ID3";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "MP3";
  if (txt(4, 4) === "ftyp") return "ftyp";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "WebM";
  if (txt(0, 4) === "fLaC") return "fLaC";
  if (txt(0, 5) === "#!AMR") return "AMR";
  if (b[0] === 0x7b || b[0] === 0x3c) return "texto (no es audio)";
  return "";
}

async function avisarTelegram(env, ev, titulo, motivo, resumen, respuesta) {
  if (!H || !H.telegram) return;
  const m = ev.message || {}, tel = telefonoDe(m, ev.conversation);
  const nombre = (m.sender || {}).name || (ev.conversation || {}).participantName || "Cliente";
  const partes = [titulo, `<b>Cliente:</b> ${esc(nombre)}${tel ? ` (+${tel})` : ""}`];
  if (motivo) partes.push(`<b>Motivo:</b> ${esc(motivo)}`);
  if (resumen) partes.push(`<b>Resumen:</b> ${esc(resumen)}`);
  const ultimo = textoDe(m);
  if (ultimo) partes.push(`<b>Último mensaje:</b> “${esc(ultimo.slice(0, 300))}”`);
  if (respuesta) partes.push(`<b>El agente respondió:</b> “${esc(respuesta.slice(0, 300))}”`);
  if (tel) partes.push(`https://wa.me/${tel}`);
  await H.telegram(env, partes.join("\n"));
}

/* ---------------- 4. Datos de la tienda para el modelo ---------------- */
function datosTienda(env) {
  const T = H.Tienda, N = T.NEGOCIO, I = T.ENVIO_INTERNACIONAL_USD, aj = T.AJUSTE_EMPAQUE;
  const l = [`Tienda en línea: ${N.sitio}`, `Horario de atención: ${N.horario}`, "Productos (id → descripción | precios en pesos colombianos):"];
  const desc = (p) => (p.descripcion ? ` Descripción: ${p.descripcion}` : "");
  for (const p of T.PRODUCTOS) {
    if (p.tipo === "espuela") l.push(`- ${p.id} → ${p.nombre}${p.detalle ? ` (${p.detalle})` : ""}; medidas en líneas: ${p.medidas.join(", ")}; dureza: ${p.dureza || "—"}; precio por par (bolsa / caja): ${T.NIVELES.map((n) => `${n.nombre} ${pesos(p.precios[n.id] + aj.bolsa)} / ${pesos(p.precios[n.id] + aj.caja)}`).join(", ")}.${desc(p)}`);
    else if (p.tipo === "patapioja") l.push(`- ${p.id} → ${p.nombre}; colores: ${p.colores.map((c) => c.id).join(", ")}; precio por par: ${p.tramos.map((t) => `desde ${t.desde} pares ${pesos(t.precio)}`).join(", ")}.${desc(p)}`);
    else l.push(`- ${p.id} → ${p.nombre}; variantes: ${(p.variantes || []).map((v) => `${v.id} = ${v.nombre} ${v.precio != null ? pesos(v.precio) : `${pesos(v.unidad)} c/u o ${pesos(v.docena)} la docena`}`).join("; ")}.${desc(p)}`);
  }
  l.push(`Presentaciones de espuela: ${(T.PRESENTACIONES || []).map((x) => `${x.nombre.toLowerCase()} (${x.nota.toLowerCase()}${x.ajuste ? `; ${x.ajuste > 0 ? "+" : "−"}${pesos(Math.abs(x.ajuste))} por par frente a bolsa` : ""})`).join(", ")}.`);
  l.push(`Niveles de espuela según el total de pares: ${T.NIVELES.map((n) => `${n.nombre} desde ${n.desde}`).join(", ")}.`);
  if (T.MINIMO_PARES) l.push(`Pedido mínimo: ${T.MINIMO_PARES.espuela} pares de espuela o ${T.MINIMO_PARES.patapioja} pares de patapioja sintética.`);
  l.push(`Regalo opción A (pares de patapioja sintética según pares de espuela): ${T.REGALOS.map((r) => `${r.pares} desde ${r.desde}`).join(", ")}. Opción B: 1 par de espuela por cada 25 pares de espuela. Una u otra, nunca ambas.`);
  l.push(`Contraentrega (solo Colombia) desde ${pesos(T.CONTRAENTREGA_MINIMO)}; el envío se paga por anticipado.`);
  if (T.CUOTAS_SIN_INTERES > 1) l.push(`Pago en línea con tarjeta: hasta ${T.CUOTAS_SIN_INTERES} cuotas sin interés.`);
  l.push(`Envío propio internacional (estimado máximo): USD ${I.base} hasta 1 kg + USD ${I.porMedioKiloExtra} por cada medio kilo adicional, a: ${(I.paisesConTarifa || []).join(", ")}. Demás países: DHL.`);
  l.push(`NO se envía a: ${Object.values(N.paisesSinEnvio || {}).join(", ")}.`);
  l.push(`Nequi del negocio: ${env.PAGO_NEQUI ? String(env.PAGO_NEQUI).slice(0, 200) : "(no configurado: si piden Nequi, cede)"}`);
  l.push(`Fotos que puedes enviar (ids para el campo fotos): ${T.PRODUCTOS.map((p) => p.id).join(", ")}.`);
  // Preguntas frecuentes de la tienda, como apoyo. Las de regalos y pagos se omiten: las reglas del agente las cubren mejor.
  const faq = (T.PREGUNTAS || []).filter((q) => !/regalo|pagar/i.test(q.pregunta));
  if (faq.length) {
    l.push("Preguntas frecuentes de la tienda (información de apoyo; si algo choca con las reglas de arriba, mandan las reglas):");
    for (const q of faq) l.push(`- ${q.pregunta} ${q.respuesta}`);
  }
  return l.join("\n");
}

/* ---------------- 5. Modelo + herramientas ---------------- */
const LINEAS = {
  type: "array", description: "Productos del pedido",
  items: {
    type: "object", required: ["producto", "cantidad"],
    properties: {
      producto: { type: "string", description: "id del producto (ver DATOS DE LA TIENDA)" },
      cantidad: { type: "integer", description: "Pares, unidades o barras" },
      medida: { type: "integer", description: "Solo espuelas: líneas" },
      presentacion: { type: "string", enum: ["bolsa", "caja", "granel"], description: "Solo espuelas; por defecto bolsa" },
      color: { type: "string", description: "Solo patapioja sintética" },
      variante: { type: "string", description: "Cera, esparadrapo, patapioja metálica: id de la variante" },
    },
  },
};
const HERRAMIENTAS = [
  { name: "cotizar_productos", description: "Calcula precios, total, nivel, mínimo y regalos de un pedido con los precios reales de la tienda. Úsala siempre antes de dar un total.",
    input_schema: { type: "object", required: ["lineas"], properties: { lineas: LINEAS } } },
  { name: "cotizar_envio_colombia", description: "Valor del envío con Interrapidísimo a un municipio de Colombia. Necesita municipio y departamento. Si el cliente aún no define el pedido, manda lineas vacío: se cotiza un pedido mínimo y lo dices como valor \"desde\".",
    input_schema: { type: "object", required: ["municipio", "departamento"], properties: {
      lineas: LINEAS, municipio: { type: "string" }, departamento: { type: "string", description: "Nombre oficial completo, ej. Valle del Cauca, Norte de Santander, La Guajira, Bogotá D.C." },
      contraentrega: { type: "boolean", description: "true si el cliente paga los productos al recibir" },
      recoger_en_oficina: { type: "boolean", description: "true solo si no quiere entrega a domicilio o la zona solo tiene oficina" } } } },
  { name: "cotizar_envio_internacional", description: "Envío fuera de Colombia: envío propio (si aplica) y DHL según la ciudad. Si el cliente aún no define el pedido, manda lineas vacío: se cotiza un pedido mínimo.",
    input_schema: { type: "object", required: ["pais"], properties: {
      lineas: LINEAS, pais: { type: "string", description: "Código ISO de 2 letras, ej. PA, CR, VE, EC, PE, MX" },
      ciudad: { type: "string" }, region: { type: "string", description: "Provincia, departamento o estado" }, postal: { type: "string" } } } },
  { name: "responder", description: "Respuesta final para el cliente. Llámala siempre al terminar.",
    input_schema: { type: "object", required: ["mensaje", "ceder", "avisar", "resumen"], properties: {
      mensaje: { type: "string", description: "Un solo mensaje de WhatsApp para el cliente: máximo 8 líneas cortas; opciones y precios en lista con \"- \"" },
      fotos: { type: "array", items: { type: "string" }, description: "ids de productos cuya foto enviar después del mensaje (máximo 4). No incluyas las ya enviadas en este chat" },
      reenviar_fotos: { type: "boolean", description: "true solo si el cliente pide ver otra vez fotos que ya se le enviaron" },
      ceder: { type: "boolean" }, motivo_cesion: { type: "string" },
      avisar: { type: "boolean" }, motivo_aviso: { type: "string" },
      resumen: { type: "string", description: "Una línea para Alexander: qué quiere el cliente y en qué va" } } } },
];

async function llamarModelo(env, sistema, mensajes, eleccion) {
  const r = await fetch(ANTHROPIC, {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || MODELO_DEFECTO, max_tokens: 1500, system: sistema, messages: mensajes, tools: HERRAMIENTAS, tool_choice: eleccion }),
  });
  if (!r.ok) throw new Error(`Modelo ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function pensar(env, sistema, pedido, ctx) {
  const mensajes = [{ role: "user", content: pedido }];
  for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
    const ultima = ronda === MAX_RONDAS - 1;
    const res = await llamarModelo(env, sistema, mensajes, ultima ? { type: "tool", name: "responder" } : { type: "any" });
    const usos = (res.content || []).filter((b) => b.type === "tool_use");
    const fin = usos.find((u) => u.name === "responder");
    if (fin) return fin.input || {};
    if (!usos.length) throw new Error("El modelo no usó herramientas");
    mensajes.push({ role: "assistant", content: res.content });
    const resultados = [];
    for (const u of usos) {
      let salida;
      try { salida = await ejecutar(u.name, u.input || {}, env, ctx); }
      catch (e) {
        salida = { ok: false, error: "Falla temporal de la herramienta. Dile al cliente que Alexander le confirma ese dato y marca avisar = true." };
        if (ctx.registro) ctx.registro.push(`${u.name}: ERROR ${String((e && e.message) || e).slice(0, 160)}`);
      }
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(salida) });
    }
    mensajes.push({ role: "user", content: resultados });
  }
  throw new Error("El modelo no terminó la respuesta");
}

const ALIAS_DEPTO = { valle: "Valle del Cauca", "el valle": "Valle del Cauca", guajira: "La Guajira", "norte santander": "Norte de Santander", bogota: "Bogotá D.C.", "bogotá": "Bogotá D.C.", "san andres": "San Andrés" };

function opcionesDe(p) {
  const T = H.Tienda;
  if (!p) return { productos_validos: T.PRODUCTOS.map((x) => x.id) };
  if (p.tipo === "espuela") return { medidas: p.medidas, presentaciones: ["bolsa", "caja", "granel"] };
  if (p.tipo === "patapioja") return { colores: p.colores.map((c) => c.id) };
  return { variantes: (p.variantes || []).map((v) => v.id) };
}

function lineasDesde(entrada) {
  const C = H.Tienda.Calculo, limpias = [], errores = [];
  for (const l of (Array.isArray(entrada) ? entrada : []).slice(0, 30)) {
    const x = C.limpiarLinea({ ...l, presentacion: (l && l.presentacion) || "bolsa" });
    const p = C.prod(x.producto);
    if (p && C.lineaValida(x)) limpias.push(x);
    else errores.push({ linea: l, opciones: opcionesDe(p) });
  }
  return { limpias, errores };
}

// Para cotizar un envío basta el peso aproximado: si faltan medida, color o cantidad se completan, y sin productos se usa el pedido mínimo
function completarParaEnvio(entrada) {
  const T = H.Tienda, out = [];
  const minEsp = (T.MINIMO_PARES && T.MINIMO_PARES.espuela) || 12, minPata = (T.MINIMO_PARES && T.MINIMO_PARES.patapioja) || 12;
  let completado = false;
  for (const l of (Array.isArray(entrada) ? entrada : []).slice(0, 30)) {
    const p = T.PRODUCTOS.find((x) => x.id === (l && l.producto));
    if (!p) continue;
    const x = { ...l };
    if (!(Math.floor(Number(x.cantidad)) >= 1)) { x.cantidad = p.tipo === "espuela" ? minEsp : p.tipo === "patapioja" ? minPata : 1; completado = true; }
    if (p.tipo === "espuela") {
      if (!p.medidas.includes(Number(x.medida))) { x.medida = p.medidas.includes(40) ? 40 : p.medidas[0]; completado = true; }
      if (!(T.PRESENTACIONES || []).some((y) => y.id === x.presentacion)) x.presentacion = "bolsa";
    } else if (p.tipo === "patapioja") { if (!p.colores.some((c) => c.id === x.color)) x.color = p.colores[0].id; }
    else if (!(p.variantes || []).some((v) => v.id === x.variante)) { x.variante = (p.variantes || [{}])[0].id; completado = true; }
    out.push(x);
  }
  if (!out.length) {
    const e = T.PRODUCTOS.find((p) => p.tipo === "espuela");
    return { lineas: [{ producto: e.id, cantidad: minEsp, medida: e.medidas.includes(40) ? 40 : e.medidas[0], presentacion: "bolsa" }], supuesto: `un pedido mínimo de ${minEsp} pares de espuela` };
  }
  return { lineas: out, supuesto: completado ? "faltaban datos del pedido y se completaron para estimar el peso" : "" };
}

export async function ejecutar(nombre, inp, env, ctx = {}) {
  const T = H.Tienda, C = T.Calculo;
  const reg = (txt) => { if (ctx.registro) ctx.registro.push(`${nombre}: ${txt}`); };
  const esEnvio = nombre === "cotizar_envio_colombia" || nombre === "cotizar_envio_internacional";
  const base = esEnvio ? completarParaEnvio(inp.lineas) : { lineas: inp.lineas, supuesto: "" };
  const estimado = base.supuesto ? { estimado: `Valor estimado con ${base.supuesto}: dilo como "desde" y aclara que el valor final depende del pedido.` } : {};
  const { limpias, errores } = lineasDesde(base.lineas);
  if (errores.length) { reg("productos con datos inválidos"); return { ok: false, error: "Hay productos con datos inválidos: corrige o pregúntale al cliente", errores }; }
  if (!limpias.length) { reg("sin productos"); return { ok: false, error: "No hay productos en el pedido" }; }

  if (nombre === "cotizar_productos") {
    const pares = C.paresEspuela(limpias), subtotal = Math.round(C.subtotal(limpias));
    const sig = pares ? C.siguienteNivel(pares) : null, regaloA = pares ? C.regaloPara(pares) : null;
    const sigRegalo = T.REGALOS.find((r) => r.desde > pares);
    // Para dar siempre los dos precios: la misma cotización con todas las espuelas en bolsa y en caja (no cambia el nivel)
    const esEsp = (l) => (C.prod(l.producto) || {}).tipo === "espuela";
    const en = (pres) => limpias.map((l) => (esEsp(l) ? { ...l, presentacion: pres } : l));
    const res = {
      ok: true,
      lineas: limpias.map((l) => {
        const pr = C.precioLinea(l, limpias), d = C.describirLinea(l);
        const x = { producto: d.nombre, detalle: d.detalle, unitario_cop: pr.unitario, total_cop: pr.total };
        if (esEsp(l)) { x.precio_par_bolsa_cop = C.precioLinea({ ...l, presentacion: "bolsa" }, limpias).unitario; x.precio_par_caja_cop = C.precioLinea({ ...l, presentacion: "caja" }, limpias).unitario; }
        return x;
      }),
      subtotal_cop: subtotal, pares_espuela: pares, pares_patapioja: C.paresPatapioja(limpias),
      ...(pares ? { subtotal_todo_en_bolsa_cop: Math.round(C.subtotal(en("bolsa"))), subtotal_todo_en_caja_cop: Math.round(C.subtotal(en("caja"))) } : {}),
      nivel: pares ? C.nivelPara(pares).nombre : null,
      siguiente_nivel: sig ? { nombre: sig.nombre, desde: sig.desde, faltan_pares: sig.desde - pares } : null,
      falta_minimo: C.faltaMinimo ? C.faltaMinimo(limpias) || null : null,
      regalo: pares ? { opcion_A_pares_patapioja: regaloA ? regaloA.pares : 0, opcion_B_pares_espuela: Math.floor(pares / 25), nota: "El cliente elige una opción, nunca ambas" } : null,
      siguiente_regalo_A: sigRegalo ? { desde: sigRegalo.desde, pares_patapioja: sigRegalo.pares, faltan_pares: sigRegalo.desde - pares } : null,
      contraentrega_disponible: subtotal >= T.CONTRAENTREGA_MINIMO, peso_gramos: C.pesoGramos(limpias),
    };
    if (ctx.pais && ctx.pais !== "CO" && H.tasaDolar) { const tasa = await H.tasaDolar(env); res.subtotal_usd_aprox = Math.round((subtotal / tasa) * 100) / 100; }
    reg(`ok (${pares} pares de espuela)`);
    return res;
  }

  if (nombre === "cotizar_envio_colombia") {
    if (!inp.municipio || !inp.departamento) { reg("falta municipio o departamento"); return { ok: false, error: "Falta el municipio o el departamento: pregúntaselo al cliente" }; }
    const subtotal = C.subtotal(limpias);
    if (inp.contraentrega && subtotal < T.CONTRAENTREGA_MINIMO) { reg("contraentrega por debajo del mínimo"); return { ok: false, error: `La contraentrega es desde ${pesos(T.CONTRAENTREGA_MINIMO)}; este pedido suma ${pesos(subtotal)}.` }; }
    const oficina = Boolean(inp.recoger_en_oficina);
    const depto = ALIAS_DEPTO[String(inp.departamento).trim().toLowerCase()] || String(inp.departamento);
    const r = await H.fleteColombia({ lineas: limpias, departamento: depto, ciudad: String(inp.municipio), destinatario: {}, contraentrega: Boolean(inp.contraentrega), servicio: oficina ? "mensajeria_do" : undefined }, env);
    if (!r.ok) {
      reg(`FALLA (${r.causa || "desconocida"}) en ${String(inp.municipio).slice(0, 40)}, ${depto.slice(0, 40)}${r.detalle ? " · " + r.detalle : ""}`);
      if (r.causa === "departamento") return { ok: false, error: `No reconozco el departamento "${inp.departamento}". Pregúntale al cliente su departamento (por ejemplo Valle del Cauca, Cundinamarca, Antioquia).` };
      if (r.causa === "municipio") return { ok: false, error: `La transportadora no encontró "${inp.municipio}" en ${depto}. Confirma con el cliente cómo se escribe su municipio. Si vuelve a fallar, dile que Alexander le confirma el envío y marca avisar = true.` };
      return { ok: false, error: "La transportadora no devolvió una tarifa. NO inventes un valor: dile al cliente que Alexander le confirma el valor del envío y marca avisar = true." };
    }
    reg(`ok ${pesos(r.valor)}${base.supuesto ? " (estimado)" : ""}`);
    return { ok: true, valor_envio_cop: r.valor, municipio: r.municipio, transportadora: r.transportadora, servicio: r.servicio, contraentrega: r.contraentrega,
      ...(oficina ? { recoger_en_oficina_disponible: r.service === "mensajeria_do" } : {}), ...estimado, nota: "No prometas fecha de entrega." };
  }

  if (nombre === "cotizar_envio_internacional") {
    const pais = String(inp.pais || "").toUpperCase().slice(0, 2);
    if ((T.NEGOCIO.paisesSinEnvio || {})[pais]) { reg(`sin envío a ${pais}`); return { ok: false, sin_envio: true, error: "No se envía a ese país por restricciones de importación." }; }
    if (pais === "CO") return { ok: false, error: "Para Colombia usa cotizar_envio_colombia" };
    const res = { ok: true, pais, impuestos: "Con DHL, los impuestos de aduana del país de destino los paga quien recibe.", ...estimado };
    if (C.tieneTarifaInternacional(pais)) { res.envio_propio_usd = C.envioInternacionalUSD(limpias); res.envio_propio_nota = "Estimado máximo: si sale menor, se devuelve la diferencia o se abona para más producto."; }
    if (inp.ciudad && H.fleteDHL) {
      const d = await H.fleteDHL(limpias, { pais, region: String(inp.region || ""), ciudad: String(inp.ciudad), postal: String(inp.postal || "") }, env).catch((e) => ({ ok: false, error: String(e.message || e) }));
      res.dhl = d.ok ? { usd: d.usd, servicio: d.servicio } : { error: d.error, que_hacer: res.envio_propio_usd ? "Ofrece el envío propio." : "NO inventes un valor: dile al cliente que Alexander le confirma el envío y marca avisar = true." };
      reg(d.ok ? `DHL ok USD ${d.usd} (${pais})` : `DHL FALLA (${pais}, ${String(inp.ciudad).slice(0, 40)}) · ${String(d.error || "").slice(0, 120)}${d.detalle ? " · " + String(d.detalle).slice(0, 160) : ""}`);
    } else res.dhl = { error: "Para cotizar DHL falta la ciudad (y el código postal si el país lo usa)." };
    if (!inp.ciudad) reg(`sin ciudad (${pais})${res.envio_propio_usd ? `, envío propio USD ${res.envio_propio_usd}` : ""}`);
    return res;
  }
  return { ok: false, error: "Herramienta desconocida" };
}

/* ---------------- 6. Diagnóstico ---------------- */
export async function diagnosticoWhatsApp(request, env) {
  const url = new URL(request.url), clave = url.searchParams.get("clave") || "";
  const valida = [env.SALUD_CLAVE, env.ADMIN_CLAVE].filter(Boolean).includes(clave);
  if (!valida) return new Response(JSON.stringify({ error: "Agrega ?clave= con tu SALUD_CLAVE o ADMIN_CLAVE" }), { status: 401, headers: { "content-type": "application/json" } });
  const r = {
    modo: modoAgente(env),
    modelo: env.ANTHROPIC_MODEL || MODELO_DEFECTO,
    configurado: { ZERNIO_WEBHOOK_SECRET: Boolean(env.ZERNIO_WEBHOOK_SECRET), ZERNIO_API_KEY: Boolean(env.ZERNIO_API_KEY), ANTHROPIC_API_KEY: Boolean(env.ANTHROPIC_API_KEY),
      PAGO_NEQUI: Boolean(env.PAGO_NEQUI), ENVIA_TOKEN: Boolean(env.ENVIA_TOKEN), memoria_por_chat: Boolean(env.CONVERSACIONES_WA), transcripcion_audios: Boolean(env.AI), telegram: Boolean(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT_ID) },
    numerosDePrueba: lista(env.AGENTE_NUMEROS_PRUEBA).map(enmascarar),
    excluidos: lista(env.AGENTE_EXCLUIDOS).length,
  };
  if (url.searchParams.get("revisar") === "1") {
    r.pruebaEnVivo = {};
    try {
      const a = await fetch(ANTHROPIC, { method: "POST", signal: AbortSignal.timeout(20000),
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: r.modelo, max_tokens: 5, messages: [{ role: "user", content: "Di: ok" }] }) });
      r.pruebaEnVivo.anthropic = a.ok ? "funciona" : `falla ${a.status}: ${(await a.text()).slice(0, 300)}`;
    } catch (e) { r.pruebaEnVivo.anthropic = "falla: " + String(e.message || e); }
    try {
      const z = await fetch(`${ZERNIO}/inbox/conversations?limit=1`, { headers: { Authorization: `Bearer ${env.ZERNIO_API_KEY || ""}` }, signal: AbortSignal.timeout(15000) });
      r.pruebaEnVivo.zernio = z.ok ? "funciona" : `falla ${z.status}: ${(await z.text()).slice(0, 200)}`;
    } catch (e) { r.pruebaEnVivo.zernio = "falla: " + String(e.message || e); }
    if (env.CONVERSACIONES_WA) {
      try { r.pruebaEnVivo.envio = await (await env.CONVERSACIONES_WA.get(env.CONVERSACIONES_WA.idFromName("__diagnostico__")).fetch("https://agente/diag/probar-envio")).json(); }
      catch (e) { r.pruebaEnVivo.envio = "falla: " + String(e.message || e); }
    }
  }
  if (env.CONVERSACIONES_WA) {
    const d = env.CONVERSACIONES_WA.get(env.CONVERSACIONES_WA.idFromName("__diagnostico__"));
    const leer = async () => (await d.fetch("https://agente/diag/leer")).json().catch(() => []);
    let decisiones = await leer();
    const liberar = new Set();
    if (url.searchParams.get("liberarPrueba") === "1") for (const e of decisiones) if (e.prueba && e.cid) liberar.add(e.cid);
    if (url.searchParams.get("liberar")) liberar.add(url.searchParams.get("liberar"));
    if (liberar.size) {
      for (const cid of liberar) {
        await env.CONVERSACIONES_WA.get(env.CONVERSACIONES_WA.idFromName(cid)).fetch("https://agente/liberar", { method: "POST" });
        await anotar(env, { chat: cid.slice(-6), decision: "liberado: el agente vuelve a responder en este chat" });
      }
      r.liberados = liberar.size;
      decisiones = await leer();
    }
    r.ultimasDecisiones = decisiones.map(({ cid, prueba, ...resto }) => (prueba ? { ...resto, prueba: true } : resto));
  }
  return new Response(JSON.stringify(r, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
