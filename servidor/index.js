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
      return json({ ok: true, secretos: Object.fromEntries(nombres.map((n) => [n, Boolean(env[n])])) });
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "No encontrado" }, 404);
    return env.ASSETS.fetch(request);
  },
};
