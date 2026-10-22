// Servidor de la tienda (Cloudflare Worker). Atiende solo las direcciones /api/...
// Los secretos (tokens) se guardan en Cloudflare: Worker → Settings → Variables and Secrets. Nunca en este archivo.

const SEGURIDAD = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
const json = (datos, estado = 200) => new Response(JSON.stringify(datos), { status: estado, headers: SEGURIDAD });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Revisión rápida: dice si cada secreto está guardado (nunca muestra su valor)
    if (url.pathname === "/api/salud") {
      const nombres = ["MP_ACCESS_TOKEN", "ENVIA_TOKEN", "TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID"];
      const respuesta = { ok: true, secretos: Object.fromEntries(nombres.map((n) => [n, Boolean(env[n])])) };
      // Con ?revisar=1 prueba que cada token funcione (sin mostrar datos sensibles)
      if (url.searchParams.get("revisar") === "1") respuesta.conexiones = await revisarConexiones(env);
      return json(respuesta);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "No encontrado" }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function revisarConexiones(env) {
  const probar = async (fn) => { try { return await fn(); } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120) }; } };
  const [mercadoPago, telegram, envia] = await Promise.all([
    probar(async () => {
      const r = await fetch("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
      const d = await r.json();
      return { ok: r.ok, pais: d.site_id, cuentaDePrueba: Array.isArray(d.tags) ? d.tags.includes("test_user") : undefined, estado: r.ok ? undefined : r.status };
    }),
    probar(async () => {
      const t = String(env.TELEGRAM_TOKEN || "").trim().replace(/^bot/i, "");
      const r = await fetch(`https://api.telegram.org/bot${t}/getMe`);
      const d = await r.json();
      // Pistas del formato sin mostrar el token: debe ser "números:letras" (ej. 123456789:AAH...)
      const forma = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t) ? "correcta" : `incorrecta (largo ${t.length}, ${t.includes(":") ? "tiene" : "NO tiene"} dos puntos)`;
      return { ok: Boolean(d.ok), bot: d.result && d.result.username, error: d.ok ? undefined : d.description, formaDelToken: forma };
    }),
    probar(async () => {
      const r = await fetch("https://queries.envia.com/carrier?country_code=CO", { headers: { Authorization: `Bearer ${env.ENVIA_TOKEN}` } });
      const d = await r.json();
      const lista = (d.data || d || []);
      return { ok: r.ok, estado: r.status, transportadoras: Array.isArray(lista) ? [...new Set(lista.map((c) => c.name || c.description))].slice(0, 30) : undefined };
    }),
  ]);
  return { mercadoPago, telegram, envia };
}
