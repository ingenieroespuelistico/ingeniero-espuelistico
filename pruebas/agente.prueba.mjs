// Pruebas del agente de WhatsApp, sin internet: simula Zernio, el modelo, Envia y Telegram.
// Uso: node pruebas/agente.prueba.mjs   (desde la raíz del repo, después de node servidor/generar-catalogo.mjs)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const worker = await import("../servidor/index.js");
const { ConversacionWA } = worker;
const { ejecutar, paisPorNumero } = await import("../servidor/agente.js");

/* ---------- simulaciones ---------- */
let llamadas = [], guion = [], historial = [], nEnv = 0;
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, op = {}) => {
  url = String(url && url.url ? url.url : url);
  const metodo = (op.method || "GET").toUpperCase();
  llamadas.push({ url, metodo, cuerpo: op.body ? String(op.body) : null, cabeceras: op.headers || {} });
  if (url.startsWith("https://zernio.com/api/v1/inbox/conversations/") && metodo === "GET") return J({ messages: [...historial].reverse(), pagination: { hasMore: false } });
  if (url.startsWith("https://zernio.com/api/v1/inbox/conversations/") && metodo === "POST") return J({ success: true, data: { messageId: "wamid.AG" + (++nEnv), conversationId: "conv1" } });
  if (url.startsWith("https://api.anthropic.com/")) { const r = guion.shift(); return r ? (r.estado ? J(r.cuerpo, r.estado) : J(r)) : J({ error: "sin guion" }, 500); }
  if (url.startsWith("https://api.telegram.org/")) return J({ ok: true });
  if (url === "https://api.envia.com/locate") return J({ city: "05001000", state: "AN", name: "Medellín" });
  if (url === "https://api.envia.com/ship/rate/") return J({ data: [
    { service: "ground_small", totalPrice: 15200, carrierDescription: "Interrapidísimo", serviceDescription: "Mensajería a domicilio", carrier: "interRapidisimo" },
    { service: "mensajeria_do", totalPrice: 11800, carrierDescription: "Interrapidísimo", serviceDescription: "Domicilio - Oficina", carrier: "interRapidisimo" }] });
  if (url.startsWith("https://open.er-api.com/")) return J({ rates: { COP: 4000 } });
  if (url.startsWith("https://media.prueba/")) return new Response(new Uint8Array(4000));
  return J({ error: "no simulado: " + url }, 404);
};
const kv = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, _m: m }; };
const almacen = () => { const m = new Map(); const a = { alarma: null }; return {
  get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined), put: async (k, v) => { m.set(k, structuredClone(v)); },
  delete: async (k) => m.delete(k), setAlarm: async (t) => { a.alarma = t; }, deleteAlarm: async () => { a.alarma = null; }, _m: m, _a: a }; };
const espacioDO = (env) => { const inst = new Map(); return {
  idFromName: (n) => n,
  get: (id) => { if (!inst.has(id)) { const st = almacen(); inst.set(id, { obj: new ConversacionWA({ storage: st }, env), st }); }
    const { obj } = inst.get(id); return { fetch: (u, op) => obj.fetch(new Request(u, op)) }; },
  _inst: inst }; };

const SECRETO = "secreto-prueba", TEL = "573001112233", CID = "conv1";
function nuevoEnv(extra = {}) {
  const env = { ZERNIO_WEBHOOK_SECRET: SECRETO, ZERNIO_API_KEY: "sk_prueba", ANTHROPIC_API_KEY: "ak_prueba", AGENTE_ACTIVO: "si",
    PAGO_NEQUI: "Nequi 300 000 0000 a nombre de Ingeniero Espuelístico", TELEGRAM_TOKEN: "t", TELEGRAM_CHAT_ID: "1", ENVIA_TOKEN: "e",
    PEDIDOS: kv(), AI: { run: async () => ({ text: "quiero 24 pares de las amarillas de 40" }) }, ...extra };
  env.CONVERSACIONES_WA = espacioDO(env);
  return env;
}
const ctx = { waitUntil: () => {} };
let nEv = 0;
const evento = (tipo, m) => ({ id: "ev" + (++nEv), event: tipo, timestamp: new Date().toISOString(),
  message: { conversationId: CID, platform: "whatsapp", sentAt: new Date().toISOString(), ...m },
  conversation: { id: CID, participantName: "Pedro Gallero" }, account: { accountId: "cuenta1" } });
async function webhook(env, ev, firma) {
  const cuerpo = JSON.stringify(ev);
  const f = firma ?? createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  return worker.default.fetch(new Request("https://ingenieroespuelistico.com/api/whatsapp", { method: "POST", body: cuerpo, headers: { "X-Zernio-Signature": f } }), env, ctx);
}
const chat = (env) => env.CONVERSACIONES_WA._inst.get(CID);
const reiniciar = () => { llamadas = []; guion = []; historial = []; nEnv = 0; };
const usoHerramienta = (id, name, input) => ({ content: [{ type: "tool_use", id, name, input }] });
const responder = (input) => usoHerramienta("tfin", "responder", { ceder: false, avisar: false, resumen: "", ...input });
const envios = () => llamadas.filter((l) => l.url.includes("zernio.com") && l.metodo === "POST").map((l) => JSON.parse(l.cuerpo));
const alModelo = () => llamadas.filter((l) => l.url.startsWith("https://api.anthropic.com/")).map((l) => JSON.parse(l.cuerpo));
const telegrams = () => llamadas.filter((l) => l.url.includes("api.telegram.org")).map((l) => JSON.parse(l.cuerpo).text);

let pasaron = 0;
async function prueba(nombre, fn) { reiniciar(); await fn(); pasaron++; console.log("✔", nombre); }

/* ---------- pruebas ---------- */
await prueba("firma inválida → 401; sin secreto → 503", async () => {
  assert.equal((await webhook(nuevoEnv(), evento("message.received", { text: "hola" }), "malo")).status, 401);
  assert.equal((await webhook(nuevoEnv({ ZERNIO_WEBHOOK_SECRET: "" }), evento("message.received", { text: "hola" }))).status, 503);
});

await prueba("apagado: responde 200 y no hace nada", async () => {
  const env = nuevoEnv({ AGENTE_ACTIVO: "" });
  assert.equal((await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } }))).status, 200);
  assert.equal(env.CONVERSACIONES_WA._inst.size, 0);
});

await prueba("modo prueba: ignora a otros números y atiende el de prueba", async () => {
  const env = nuevoEnv({ AGENTE_ACTIVO: "prueba", AGENTE_NUMEROS_PRUEBA: "57 300 999 8888" });
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } }));
  assert.equal(chat(env).st._a.alarma, null);
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+573009998888" } }));
  assert.ok(chat(env).st._a.alarma > Date.now());
});

await prueba("modo prueba: reconoce el número aunque Zernio no mande phoneNumber", async () => {
  const env = nuevoEnv({ AGENTE_ACTIVO: "prueba", AGENTE_NUMEROS_PRUEBA: "+57 300-999-8888" });
  await webhook(env, evento("message.received", { text: "hola", sender: { id: "573009998888", phoneNumber: null } }));
  assert.ok(chat(env).st._a.alarma > Date.now(), "usa sender.id cuando phoneNumber viene vacío");
  const env2 = nuevoEnv({ AGENTE_ACTIVO: "prueba", AGENTE_NUMEROS_PRUEBA: "CO.123456789ABCDEF" });
  await webhook(env2, evento("message.received", { text: "hola", sender: { id: "CO.123456789ABCDEF", businessScopedUserId: "CO.123456789ABCDEF" } }));
  assert.ok(chat(env2).st._a.alarma > Date.now(), "también acepta el identificador de Meta (BSUID)");
});

await prueba("diagnóstico: pide clave y explica por qué no respondió", async () => {
  const env = nuevoEnv({ AGENTE_ACTIVO: "prueba", AGENTE_NUMEROS_PRUEBA: "573009998888", SALUD_CLAVE: "clave123" });
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } }));
  await webhook(env, evento("message.received", { text: "hola" }), "firma-mala");
  const sin = await worker.default.fetch(new Request("https://ingenieroespuelistico.com/api/whatsapp/diagnostico"), env, ctx);
  assert.equal(sin.status, 401);
  const r = await (await worker.default.fetch(new Request("https://ingenieroespuelistico.com/api/whatsapp/diagnostico?clave=clave123"), env, ctx)).json();
  assert.equal(r.modo, "prueba"); assert.equal(r.configurado.ANTHROPIC_API_KEY, true); assert.deepEqual(r.numerosDePrueba, ["57300…888"]);
  assert.match(r.ultimasDecisiones[0].decision, /firma no coincide/);
  assert.match(r.ultimasDecisiones[1].decision, /no es un número de prueba/);
  assert.deepEqual(r.ultimasDecisiones[1].idsRecibidos, ["+5730…233"]);
  assert.ok(!JSON.stringify(r).includes("hola"), "el diagnóstico no guarda el texto de los mensajes");
});

await prueba("liberar chats de prueba: después de responder tú, se puede volver a probar", async () => {
  const env = nuevoEnv({ AGENTE_ACTIVO: "prueba", AGENTE_NUMEROS_PRUEBA: TEL, SALUD_CLAVE: "c1" });
  historial = [
    { id: "a1", direction: "outgoing", message: "hola, prueba", sentAt: new Date(Date.now() - 3600e3).toISOString(), metadata: { source: "whatsapp_business_app" } },
    { id: "a2", direction: "incoming", message: "precio?", sentAt: new Date(Date.now() - 1000).toISOString() }];
  await webhook(env, evento("message.received", { text: "precio?", sender: { phoneNumber: "+" + TEL }, sentAt: historial[1].sentAt }));
  await chat(env).obj.alarm();
  assert.equal(envios().length, 0, "bloqueado por el mensaje tuyo de hace una hora");
  let r = await (await worker.default.fetch(new Request("https://ingenieroespuelistico.com/api/whatsapp/diagnostico?clave=c1"), env, ctx)).json();
  assert.ok(r.ultimasDecisiones.some((e) => e.mensajeQueBloquea && e.mensajeQueBloquea.origen === "whatsapp_business_app"));
  assert.ok(r.ultimasDecisiones.every((e) => !("cid" in e)), "el diagnóstico no muestra el id completo del chat");
  r = await (await worker.default.fetch(new Request("https://ingenieroespuelistico.com/api/whatsapp/diagnostico?clave=c1&liberarPrueba=1"), env, ctx)).json();
  assert.equal(r.liberados, 1);
  historial.push({ id: "a3", direction: "incoming", message: "precio de las espuelas?", sentAt: new Date().toISOString() });
  guion = [responder({ mensaje: "Claro que sí mi amigo." })];
  await webhook(env, evento("message.received", { text: "precio de las espuelas?", sender: { phoneNumber: "+" + TEL }, sentAt: historial[2].sentAt }));
  await chat(env).obj.alarm();
  assert.equal(envios().length, 1, "después de liberar, responde");
});

await prueba("mensaje automático de la app (segundos después del cliente) no bloquea", async () => {
  const env = nuevoEnv();
  const t0 = Date.now() - 5000;
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL }, sentAt: new Date(t0).toISOString() }));
  await webhook(env, evento("message.sent", { id: "auto1", direction: "outgoing", text: "¡Hola! Gracias por escribirnos", source: "whatsapp_business_app", sentAt: new Date(t0 + 1500).toISOString() }));
  assert.equal(await chat(env).st.get("humanoHasta"), undefined, "por webhook");
  historial = [
    { id: "b1", direction: "incoming", message: "hola", sentAt: new Date(t0).toISOString() },
    { id: "b2", direction: "outgoing", message: "¡Hola! Gracias por escribirnos", sentAt: new Date(t0 + 1500).toISOString(), metadata: { source: "whatsapp_business_app" } },
    { id: "b3", direction: "incoming", message: "precio?", sentAt: new Date().toISOString() }];
  guion = [responder({ mensaje: "Con gusto mi amigo." })];
  await webhook(env, evento("message.received", { text: "precio?", sender: { phoneNumber: "+" + TEL }, sentAt: historial[2].sentAt }));
  await chat(env).obj.alarm();
  assert.equal(envios().length, 1, "por historial: la bienvenida automática no cuenta como Alexander");
});

await prueba("aviso repetido de Zernio se procesa una sola vez", async () => {
  const env = nuevoEnv(), ev = evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } });
  await webhook(env, ev); await chat(env).st.delete("pendiente");
  await webhook(env, ev);
  assert.equal(await chat(env).st.get("pendiente"), undefined);
});

await prueba("flujo completo: cotiza con precios reales, cotiza envío y responde con foto", async () => {
  const env = nuevoEnv();
  historial = [{ id: "w0", direction: "incoming", message: "Buenas, precio de 24 pares de las amarillas de 40 para Medellín", sentAt: new Date(Date.now() - 2000).toISOString(), attachments: [] }];
  const lineas = [{ producto: "acrilica", cantidad: 24, medida: 40, presentacion: "bolsa" }];
  guion = [
    usoHerramienta("t1", "cotizar_productos", { lineas }),
    usoHerramienta("t2", "cotizar_envio_colombia", { lineas, municipio: "Medellín", departamento: "Antioquia" }),
    responder({ mensaje: "Buenas noches mi amigo. Los 24 pares le salen en *$96.000* y el envío a Medellín $16.000.", fotos: ["acrilica", "inventado"], resumen: "24 pares acrílica 40 a Medellín" }),
  ];
  await webhook(env, evento("message.received", { text: historial[0].message, sender: { phoneNumber: "+" + TEL, name: "Pedro" }, sentAt: historial[0].sentAt }));
  await chat(env).obj.alarm();
  const m = alModelo();
  assert.equal(m.length, 3);
  assert.match(m[0].system, /DATOS DE LA TIENDA/);
  assert.match(m[0].system, /acrilica → Espuela acrílica amarilla.*Minorista \$4\.000/);
  assert.match(m[0].system, /Nequi 300 000 0000/);
  assert.match(m[0].messages[0].content, /País por el número: Colombia/);
  const r1 = JSON.parse(m[1].messages.at(-1).content[0].content);
  assert.equal(r1.subtotal_cop, 96000); assert.equal(r1.nivel, "Minorista"); assert.equal(r1.falta_minimo, null);
  const r2 = JSON.parse(m[2].messages.at(-1).content[0].content);
  assert.equal(r2.valor_envio_cop, 16000);
  const e = envios();
  assert.equal(e.length, 2, "texto + 1 foto (el id inventado se descarta)");
  assert.match(e[0].message, /\$96\.000/); assert.equal(e[0].accountId, "cuenta1");
  assert.equal(e[1].attachmentUrl, "https://ingenieroespuelistico.com/fotos/acrilica/1.jpg");
  assert.deepEqual(await chat(env).st.get("mios"), ["wamid.AG1", "wamid.AG2"]);
  const crm = await chat(env).st.get("perfil");
  assert.equal(crm.resumen, "24 pares acrílica 40 a Medellín"); assert.equal(crm.telefono, TEL);
  assert.equal(env.PEDIDOS._m.size, 0, "el agente no escribe en KV");
});

await prueba("los mensajes del propio agente no lo silencian", async () => {
  const env = nuevoEnv();
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } }));
  await chat(env).st.put("mios", ["wamid.AG9"]);
  await webhook(env, evento("message.sent", { id: "z1", platformMessageId: "wamid.AG9", direction: "outgoing", text: "Buenas", sentVia: "api" }));
  assert.equal(await chat(env).st.get("humanoHasta"), undefined);
});

await prueba("si Alexander escribe desde el celular, el agente se calla y cancela la respuesta pendiente", async () => {
  const env = nuevoEnv();
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL }, sentAt: new Date(Date.now() - 20000).toISOString() }));
  await webhook(env, evento("message.sent", { id: "z2", platformMessageId: "wamid.ALEX", direction: "outgoing", text: "Buenas tardes mi amigo", source: "whatsapp_business_app", sentAt: new Date(Date.now() - 5000).toISOString() }));
  const st = chat(env).st;
  assert.ok((await st.get("humanoHasta")) > Date.now());
  assert.equal(st._a.alarma, null);
  await webhook(env, evento("message.received", { text: "precio?", sender: { phoneNumber: "+" + TEL } }));
  assert.equal(await st.get("pendiente"), undefined);
});

await prueba("los mensajes automáticos (bienvenida, no soportados) no cuentan como Alexander", async () => {
  const env = nuevoEnv();
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } }));
  await webhook(env, evento("message.sent", { id: "z3", direction: "outgoing", text: "[Unsupported message]", source: "whatsapp_business_app" }));
  assert.equal(await chat(env).st.get("humanoHasta"), undefined);
});

await prueba("si Alexander respondió hace poco (aunque el agente estuviera apagado), no se mete", async () => {
  const env = nuevoEnv();
  historial = [
    { id: "w1", direction: "outgoing", message: "Le manejamos estas cuatro espuelas", sentAt: new Date(Date.now() - 3600e3).toISOString(), metadata: { source: "whatsapp_business_app" } },
    { id: "w2", direction: "incoming", message: "y el envío?", sentAt: new Date(Date.now() - 1000).toISOString() }];
  await webhook(env, evento("message.received", { text: "y el envío?", sender: { phoneNumber: "+" + TEL }, sentAt: historial[1].sentAt }));
  await chat(env).obj.alarm();
  assert.equal(alModelo().length, 0); assert.equal(envios().length, 0);
  assert.ok((await chat(env).st.get("humanoHasta")) > Date.now());
});

await prueba("conversación excluida: nunca responde", async () => {
  const env = nuevoEnv({ AGENTE_EXCLUIDOS: "otra, conv1 ,x" });
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } }));
  assert.equal(chat(env).st._a.alarma, null);
});

await prueba("mensajes seguidos del cliente: una sola respuesta", async () => {
  const env = nuevoEnv();
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } }));
  await webhook(env, evento("message.received", { text: "precio de las espuelas?", sender: { phoneNumber: "+" + TEL } }));
  assert.equal((await chat(env).st.get("pendiente")).message.text, "precio de las espuelas?");
});

await prueba("ceder: avisa por Telegram y el agente se calla", async () => {
  const env = nuevoEnv();
  historial = [{ id: "w3", direction: "incoming", message: "ya le pagué, le mando el comprobante", sentAt: new Date().toISOString() }];
  guion = [responder({ mensaje: "Recibido mi amigo, Alexander lo verifica y le confirma.", ceder: true, motivo_cesion: "verificar pago", resumen: "Dice que pagó" })];
  await webhook(env, evento("message.received", { text: historial[0].message, sender: { phoneNumber: "+" + TEL, name: "Pedro" }, sentAt: historial[0].sentAt }));
  await chat(env).obj.alarm();
  assert.equal(envios().length, 1);
  const t = telegrams();
  assert.equal(t.length, 1); assert.match(t[0], /Te paso un cliente/); assert.match(t[0], /verificar pago/); assert.match(t[0], /wa\.me\/573001112233/);
  assert.ok((await chat(env).st.get("humanoHasta")) > Date.now());
});

await prueba("si el modelo falla, no responde nada raro y avisa a Alexander", async () => {
  const env = nuevoEnv();
  historial = [{ id: "w4", direction: "incoming", message: "hola", sentAt: new Date().toISOString() }];
  guion = [{ estado: 500, cuerpo: { error: "caído" } }];
  await webhook(env, evento("message.received", { text: "hola", sender: { phoneNumber: "+" + TEL } }));
  await chat(env).obj.alarm();
  assert.equal(envios().length, 0);
  assert.match(telegrams()[0], /no pudo responder/);
});

await prueba("audio: se transcribe y el modelo recibe el texto", async () => {
  const env = nuevoEnv();
  historial = [{ id: "w5", direction: "incoming", message: "", attachments: [{ type: "audio", url: "https://media.prueba/a.ogg" }], sentAt: new Date().toISOString() }];
  guion = [responder({ mensaje: "Claro que sí mi amigo." })];
  await webhook(env, evento("message.received", { text: "", attachments: historial[0].attachments, sender: { phoneNumber: "+" + TEL }, sentAt: historial[0].sentAt }));
  await chat(env).obj.alarm();
  assert.match(alModelo()[0].messages[0].content, /AUDIO transcrito: "quiero 24 pares de las amarillas de 40"/);
});

await prueba("herramientas: mínimo, regalo, colores, oficina, internacional y EE. UU.", async () => {
  const env = nuevoEnv();
  const poco = await ejecutar("cotizar_productos", { lineas: [{ producto: "acrilica", cantidad: 5, medida: 40 }] }, env);
  assert.match(poco.falta_minimo, /mínimo de espuelas es de 12 pares/);
  const cien = await ejecutar("cotizar_productos", { lineas: [{ producto: "negra-casquillo", cantidad: 100, medida: 38, presentacion: "caja" }] }, env);
  assert.equal(cien.regalo.opcion_A_pares_patapioja, 12); assert.equal(cien.regalo.opcion_B_pares_espuela, 4);
  assert.equal(cien.subtotal_cop, 100 * (4000 + 300));
  const roja = await ejecutar("cotizar_productos", { lineas: [{ producto: "patapioja", cantidad: 12, color: "roja" }] }, env);
  assert.equal(roja.ok, true);
  const cafe = await ejecutar("cotizar_productos", { lineas: [{ producto: "patapioja", cantidad: 12, color: "cafe" }] }, env);
  assert.equal(cafe.ok, false); assert.deepEqual(cafe.errores[0].opciones.colores, ["negra", "amarilla", "roja", "blanca"]);
  const medidaMala = await ejecutar("cotizar_productos", { lineas: [{ producto: "blanca-enteriza", cantidad: 12, medida: 38 }] }, env);
  assert.equal(medidaMala.ok, false); assert.deepEqual(medidaMala.errores[0].opciones.medidas, [40]);
  const oficina = await ejecutar("cotizar_envio_colombia", { lineas: [{ producto: "acrilica", cantidad: 24, medida: 40 }], municipio: "Medellín", departamento: "Antioquia", recoger_en_oficina: true }, env);
  assert.equal(oficina.valor_envio_cop, 12000); assert.equal(oficina.recoger_en_oficina_disponible, true);
  const ce = await ejecutar("cotizar_envio_colombia", { lineas: [{ producto: "patapioja", cantidad: 12, color: "negra" }], municipio: "Cali", departamento: "Valle", contraentrega: true }, env);
  assert.equal(ce.ok, false); assert.match(ce.error, /contraentrega es desde \$45\.000/);
  const valle = await ejecutar("cotizar_envio_colombia", { lineas: [{ producto: "acrilica", cantidad: 12, medida: 40 }], municipio: "Cali", departamento: "Valle", contraentrega: true }, env);
  assert.equal(valle.ok, true, "'Valle' se entiende como Valle del Cauca; 12 pares ya alcanzan la contraentrega");
  const ve = await ejecutar("cotizar_envio_internacional", { lineas: [{ producto: "acrilica", cantidad: 24, medida: 40 }], pais: "VE" }, env);
  assert.equal(ve.envio_propio_usd, 25);
  const us = await ejecutar("cotizar_envio_internacional", { lineas: [{ producto: "acrilica", cantidad: 24, medida: 40 }], pais: "US" }, env);
  assert.equal(us.sin_envio, true);
  const usd = await ejecutar("cotizar_productos", { lineas: [{ producto: "acrilica", cantidad: 24, medida: 40 }] }, env, { pais: "PA" });
  assert.equal(usd.subtotal_usd_aprox, 24);
});

await prueba("precios en bolsa y en caja, forro y preguntas frecuentes llegan al modelo", async () => {
  const env = nuevoEnv();
  historial = [{ id: "p1", direction: "incoming", message: "que espuelas maneja", sentAt: new Date().toISOString() }];
  guion = [responder({ mensaje: "Le manejamos 4 espuelas:\n- *Acrílica amarilla*: bolsa $4.000 · caja $4.300" })];
  await webhook(env, evento("message.received", { text: historial[0].message, sender: { phoneNumber: "+" + TEL }, sentAt: historial[0].sentAt }));
  await chat(env).obj.alarm();
  const sis = alModelo()[0].system;
  assert.match(sis, /acrilica → .*precio por par \(bolsa \/ caja\): Minorista \$4\.000 \/ \$4\.300/);
  assert.match(sis, /En bolsa o en caja viene forrada con plástico removible/, "la descripción del producto dice que viene forrada");
  assert.match(sis, /en bolsa \(forrada con plástico removible\), en caja \(forrada con plástico removible; \+\$300/);
  assert.match(sis, /¿Las espuelas vienen selladas\?/);
  assert.ok(!/¿Dan algún regalo\?/.test(sis), "la pregunta frecuente del regalo (solo opción A) no se manda");
  const c = await ejecutar("cotizar_productos", { lineas: [{ producto: "acrilica", cantidad: 24, medida: 40 }, { producto: "patapioja", cantidad: 12, color: "negra" }] }, env);
  assert.equal(c.lineas[0].precio_par_bolsa_cop, 4000); assert.equal(c.lineas[0].precio_par_caja_cop, 4300);
  assert.equal(c.lineas[1].precio_par_bolsa_cop, undefined, "la patapioja no tiene presentación");
  assert.equal(c.subtotal_todo_en_caja_cop - c.subtotal_todo_en_bolsa_cop, 24 * 300);
  assert.equal(c.subtotal_cop, c.subtotal_todo_en_bolsa_cop);
});

await prueba("fotos: no repite las ya enviadas, salvo que el cliente las pida", async () => {
  const env = nuevoEnv();
  const t0 = Date.now() - 60000;
  historial = [{ id: "f1", direction: "incoming", message: "precio de la amarilla", sentAt: new Date(t0).toISOString() }];
  guion = [responder({ mensaje: "Claro mi amigo.", fotos: ["acrilica"] })];
  await webhook(env, evento("message.received", { text: historial[0].message, sender: { phoneNumber: "+" + TEL }, sentAt: historial[0].sentAt }));
  await chat(env).obj.alarm();
  assert.equal(envios().filter((e) => e.attachmentUrl).length, 1);

  // Segundo turno: el modelo vuelve a pedir la acrílica y agrega la negra → solo sale la negra
  llamadas = []; nEnv = 2;
  historial.push(
    { id: "f2", direction: "outgoing", message: "Claro mi amigo.", sentVia: "api", sentAt: new Date(t0 + 9000).toISOString() },
    { id: "f3", direction: "outgoing", message: "", attachments: [{ type: "image", url: "https://ingenieroespuelistico.com/fotos/acrilica/1.jpg" }], sentVia: "api", sentAt: new Date(t0 + 10000).toISOString() },
    { id: "f4", direction: "incoming", message: "y la negra?", sentAt: new Date().toISOString() });
  guion = [responder({ mensaje: "Esta es la negra.", fotos: ["acrilica", "negra-casquillo"] })];
  await webhook(env, evento("message.received", { text: "y la negra?", sender: { phoneNumber: "+" + TEL }, sentAt: historial[3].sentAt }));
  await chat(env).obj.alarm();
  const pedido = alModelo()[0].messages[0].content;
  assert.match(pedido, /Fotos ya enviadas en este chat: Espuela acrílica amarilla \(id acrilica/);
  assert.match(pedido, /NEGOCIO: \[FOTO enviada\]/);
  assert.deepEqual(envios().filter((e) => e.attachmentUrl).map((e) => e.attachmentUrl), ["https://ingenieroespuelistico.com/fotos/negra-casquillo/1.jpg"]);

  // Tercer turno: el cliente pide otra vez la foto → reenviar_fotos la deja pasar
  llamadas = [];
  historial.push({ id: "f5", direction: "incoming", message: "mándeme otra vez la foto de la amarilla", sentAt: new Date(Date.now() + 1000).toISOString() });
  guion = [responder({ mensaje: "Con gusto.", fotos: ["acrilica"], reenviar_fotos: true })];
  await webhook(env, evento("message.received", { text: historial.at(-1).message, sender: { phoneNumber: "+" + TEL }, sentAt: historial.at(-1).sentAt }));
  await chat(env).obj.alarm();
  assert.deepEqual(envios().filter((e) => e.attachmentUrl).map((e) => e.attachmentUrl), ["https://ingenieroespuelistico.com/fotos/acrilica/1.jpg"]);
});

await prueba("país por número", async () => {
  assert.equal(paisPorNumero("+593 99 123 4567").iso, "EC"); assert.equal(paisPorNumero("+58 412 1234567").iso, "VE");
  assert.equal(paisPorNumero("+1 787 555 0000").iso, "PR"); assert.equal(paisPorNumero("+1 305 555 0000").iso, "");
});

console.log(`\n${pasaron} pruebas pasaron`);
