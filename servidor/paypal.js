// PayPal (Orders v2): pagos desde otros países, en dólares.
// Secretos en Cloudflare: PAYPAL_CLIENT_ID y PAYPAL_SECRET. Variable PAYPAL_MODO: "sandbox" (pruebas) o "live".
//
// Flujo: la página pide crear la orden → el cliente aprueba en PayPal → vuelve a /gracias.html?pp=1&token=ORDEN
// → la página pide capturar (cobrar) la orden → el servidor confirma con PayPal y avisa por Telegram.

const fetchT = (recurso, opciones = {}, ms = 10000) => fetch(recurso, { ...opciones, signal: AbortSignal.timeout(ms) });
export const baseApi = (env) => (String(env.PAYPAL_MODO || "sandbox").trim().toLowerCase() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
export const paypalListo = (env) => Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);

let tokenGuardado = null; // { valor, vence, base }
async function token(env) {
  const base = baseApi(env);
  if (tokenGuardado && tokenGuardado.base === base && tokenGuardado.vence > Date.now() + 60000) return tokenGuardado.valor;
  const credenciales = btoa(`${String(env.PAYPAL_CLIENT_ID).trim()}:${String(env.PAYPAL_SECRET).trim()}`);
  const r = await fetchT(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credenciales}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`PayPal no dio acceso (${r.status} ${d.error || ""})`);
  tokenGuardado = { valor: d.access_token, vence: Date.now() + (Number(d.expires_in) || 3000) * 1000, base };
  return d.access_token;
}

async function llamar(env, metodo, ruta, cuerpo, extra = {}) {
  const r = await fetchT(`${baseApi(env)}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${await token(env)}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, estado: r.status, d };
}

const usd = (centavos) => (centavos / 100).toFixed(2);
const corto = (t, n) => String(t || "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);

// lineas: [{ nombre, centavos }], envioCentavos, cliente: { nombre, direccion, ciudad, region, pais }
export async function crearOrden(env, { id, lineas, envioCentavos, cliente, origen }) {
  const itemTotal = lineas.reduce((s, l) => s + l.centavos, 0);
  const total = itemTotal + envioCentavos;
  const unidad = {
    reference_id: id, custom_id: id, invoice_id: id,
    description: corto(`Pedido ${id} - Ingeniero Espuelistico`, 127),
    soft_descriptor: "INGESPUELISTICO",
    amount: {
      currency_code: "USD", value: usd(total),
      breakdown: { item_total: { currency_code: "USD", value: usd(itemTotal) }, shipping: { currency_code: "USD", value: usd(envioCentavos) } },
    },
    items: lineas.map((l, i) => ({ name: corto(l.nombre, 127), sku: corto(`${id}-${i + 1}`, 127), quantity: "1", category: "PHYSICAL_GOODS", unit_amount: { currency_code: "USD", value: usd(l.centavos) } })),
  };
  const contexto = (envio) => ({
    brand_name: "Ingeniero Espuelistico", shipping_preference: envio ? "SET_PROVIDED_ADDRESS" : "NO_SHIPPING", user_action: "PAY_NOW",
    return_url: `${origen}/gracias.html?pp=1&pedido=${encodeURIComponent(id)}`,
    cancel_url: `${origen}/gracias.html?pp=cancelado&pedido=${encodeURIComponent(id)}`,
  });
  const conEnvio = {
    ...unidad,
    shipping: {
      type: "SHIPPING", name: { full_name: corto(cliente.nombre, 300) },
      address: { address_line_1: corto(cliente.direccion, 300), admin_area_2: corto(cliente.ciudad, 120), admin_area_1: corto(cliente.region, 300), ...(cliente.postal ? { postal_code: corto(cliente.postal, 60) } : {}), country_code: cliente.pais },
    },
  };
  let r = await llamar(env, "POST", "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [conEnvio], payment_source: { paypal: { experience_context: contexto(true) } } }, { "PayPal-Request-Id": `crear-${id}` });
  // Si PayPal no acepta la dirección tal como viene, se crea sin dirección (la tenemos guardada en el pedido)
  if (!r.ok && r.estado === 422) {
    console.log("PayPal rechazó la dirección, se reintenta sin envío", JSON.stringify(r.d).slice(0, 300));
    r = await llamar(env, "POST", "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [unidad], payment_source: { paypal: { experience_context: contexto(false) } } }, { "PayPal-Request-Id": `crear2-${id}` });
  }
  if (!r.ok) { console.error("PayPal crear orden", r.estado, JSON.stringify(r.d).slice(0, 500)); return null; }
  const enlace = (r.d.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
  return enlace ? { orden: r.d.id, url: enlace.href, totalCentavos: total } : null;
}

// Prueba de conexión (para la app de pedidos): pide un token y dice en qué modo está
export async function probarPaypal(env) {
  if (!paypalListo(env)) return { ok: false, error: "Faltan PAYPAL_CLIENT_ID o PAYPAL_SECRET" };
  tokenGuardado = null;
  await token(env);
  return { ok: true, modo: baseApi(env).includes("sandbox") ? "sandbox (pruebas)" : "live (real)" };
}

export const consultarOrden = (env, orden) => llamar(env, "GET", `/v2/checkout/orders/${orden}`);

// Cobra una orden aprobada. Devuelve { ok, orden, captura, estado, pedido, monto } o { ok:false }
export async function capturarOrden(env, orden) {
  let r = await llamar(env, "POST", `/v2/checkout/orders/${orden}/capture`, {}, { "PayPal-Request-Id": `cobrar-${orden}` });
  // Ya estaba cobrada (o no se pudo por otra razón): se consulta cómo quedó
  if (!r.ok) {
    const problema = (r.d.details && r.d.details[0] && r.d.details[0].issue) || r.d.name || "";
    if (r.estado === 422 || r.estado === 409) r = await consultarOrden(env, orden);
    if (!r.ok) return { ok: false, problema: problema || `PayPal ${r.estado}` };
    r.problema = problema;
  }
  const u = (r.d.purchase_units || [])[0] || {};
  const c = ((u.payments && u.payments.captures) || [])[0];
  return {
    ok: true, orden: r.d.id, estadoOrden: r.d.status, problema: r.problema || "",
    pedido: u.custom_id || u.reference_id || "",
    captura: c ? c.id : "", estado: c ? c.status : r.d.status, monto: c ? Number(c.amount.value) : Number(u.amount && u.amount.value),
    pagador: r.d.payer ? { correo: r.d.payer.email_address || "", nombre: [r.d.payer.name && r.d.payer.name.given_name, r.d.payer.name && r.d.payer.name.surname].filter(Boolean).join(" ") } : null,
  };
}

// Estados de PayPal → estados tipo Mercado Pago (los que entiende la base de pedidos)
export const ESTADO_PAYPAL = { COMPLETED: "approved", PENDING: "pending", DECLINED: "rejected", FAILED: "rejected", REFUNDED: "refunded", PARTIALLY_REFUNDED: "approved", VOIDED: "cancelled" };
