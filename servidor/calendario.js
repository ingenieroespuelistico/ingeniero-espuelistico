// Google Calendar con una cuenta de servicio (sin pedirle al dueño que inicie sesión cada semana).
// Secreto GOOGLE_CUENTA_SERVICIO = el archivo JSON completo de la clave de la cuenta de servicio.
// El calendario del dueño se comparte con el correo de esa cuenta ("Hacer cambios en los eventos").
// Variable opcional GOOGLE_CALENDARIO = id del calendario (normalmente el correo de Gmail del dueño).

const fetchT = (recurso, opciones = {}, ms = 8000) => fetch(recurso, { ...opciones, signal: AbortSignal.timeout(ms) });
const b64url = (datos) => {
  const bytes = typeof datos === "string" ? new TextEncoder().encode(datos) : new Uint8Array(datos);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function cuentaServicio(env) {
  if (!env.GOOGLE_CUENTA_SERVICIO) return null;
  try {
    const c = JSON.parse(String(env.GOOGLE_CUENTA_SERVICIO).trim());
    return c.client_email && c.private_key ? c : null;
  } catch { return null; }
}
export const calendarioId = (env, correoNegocio) => String(env.GOOGLE_CALENDARIO || correoNegocio || "").trim();

let guardado = null; // { token, vence, correo }
async function tokenGoogle(env) {
  const c = cuentaServicio(env);
  if (!c) throw new Error("Falta GOOGLE_CUENTA_SERVICIO");
  if (guardado && guardado.correo === c.client_email && guardado.vence > Date.now() + 60000) return guardado.token;
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const datos = b64url(JSON.stringify({ iss: c.client_email, scope: "https://www.googleapis.com/auth/calendar", aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600 }));
  const pem = c.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (x) => x.charCodeAt(0));
  const llave = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const firma = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", llave, new TextEncoder().encode(`${cabecera}.${datos}`)));
  const r = await fetchT("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${cabecera}.${datos}.${firma}`,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google no dio acceso (${r.status} ${d.error || ""} ${d.error_description || ""})`);
  guardado = { token: d.access_token, vence: Date.now() + (Number(d.expires_in) || 3600) * 1000, correo: c.client_email };
  return d.access_token;
}

// Intervalos ocupados del calendario entre dos fechas (ISO)
export async function ocupado(env, calendario, desde, hasta) {
  const r = await fetchT("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST", headers: { Authorization: `Bearer ${await tokenGoogle(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: desde, timeMax: hasta, timeZone: "America/Bogota", items: [{ id: calendario }] }),
  });
  const d = await r.json().catch(() => ({}));
  const cal = d.calendars && d.calendars[calendario];
  if (!r.ok || !cal) throw new Error(`freeBusy ${r.status} ${JSON.stringify(d.error || "").slice(0, 200)}`);
  if (cal.errors && cal.errors.length) throw new Error(`Calendario no compartido o no encontrado (${cal.errors.map((e) => e.reason).join(", ")})`);
  return (cal.busy || []).map((b) => ({ inicio: b.start, fin: b.end }));
}

export async function crearEvento(env, calendario, { inicio, fin, titulo, descripcion }) {
  const r = await fetchT(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendario)}/events`, {
    method: "POST", headers: { Authorization: `Bearer ${await tokenGoogle(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: titulo, description: descripcion,
      start: { dateTime: inicio, timeZone: "America/Bogota" }, end: { dateTime: fin, timeZone: "America/Bogota" },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
      colorId: "10",
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Evento ${r.status} ${JSON.stringify(d.error || "").slice(0, 200)}`);
  return { id: d.id, enlace: d.htmlLink };
}
