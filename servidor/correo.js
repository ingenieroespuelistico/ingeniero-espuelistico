// Correo de confirmación al cliente (Resend). Se activa cuando existan:
//   RESEND_API_KEY (secreto) y CORREO_REMITENTE (por ejemplo "Ingeniero Espuelístico <pedidos@tudominio.com>").
// El dominio del remitente debe estar verificado en Resend; con un correo de Gmail no se puede (llegaría a spam).

const fetchT = (recurso, opciones = {}, ms = 8000) => fetch(recurso, { ...opciones, signal: AbortSignal.timeout(ms) });
export const correoListo = (env) => Boolean(env.RESEND_API_KEY && env.CORREO_REMITENTE);
export const correoValido = (c) => /^[^\s@<>"']{1,64}@[^\s@<>"']{1,180}\.[a-z]{2,}$/i.test(String(c || ""));

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const dinero = (p, n) => (p.moneda === "USD" ? `USD ${Number(n || 0).toFixed(2)}` : pesos(n));

function contenido(p, N) {
  const c = p.cliente || {};
  const nombre = String(c.nombre || "").split(" ")[0] || "";
  const contra = p.tipo === "contraentrega";
  const intro = contra
    ? `Recibimos el pago del envío (${dinero(p, p.total)}). Los productos (${pesos(p.cobrarAlRecibir)}) los pagas en efectivo cuando te llegue el paquete.`
    : `Recibimos tu pago de ${dinero(p, p.total)}. Ya estamos preparando tu pedido.`;
  const pasos = p.metodo === "paypal"
    ? "Preparamos tu envío internacional y te escribimos por WhatsApp con el número de guía."
    : "Despachamos el mismo día si el pago entró antes de las 4:00 p. m. (sábados antes de las 10:00 a. m.). Te enviamos el número de guía por WhatsApp para que sigas tu paquete.";
  const sitio = N.sitio;
  const wa = `https://wa.me/${N.whatsapp}?text=${encodeURIComponent(`Hola, les escribo por mi pedido ${p.id}`)}`;
  const legal = `${N.titular || "Brayner Alexander Jiménez Muñoz"} · ${N.documentoTitular || "C.C. 1.104.938.233"} · ${N.direccion.calle}, ${N.direccion.ciudad}, ${N.direccion.departamento}, Colombia · ${N.telefonoVisible} · ${N.correo}`;
  const filas = (p.productos || []).map((x) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E6ECF3;font-size:14px;color:#142033">${esc(x)}</td></tr>`).join("");
  const envio = p.envio ? `${p.envio.moneda === "USD" ? "USD " + Number(p.envio.valor || 0).toFixed(2) : pesos(p.envio.valor)}${p.envio.detalle ? " · " + p.envio.detalle : p.envio.transportadora ? " · " + p.envio.transportadora : ""}` : "";
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;color:#142033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#142033;padding:18px 22px;color:#ffffff;font-size:18px;font-weight:bold">Ingeniero Espuelístico</td></tr>
<tr><td style="padding:22px">
<p style="margin:0 0 6px;font-size:20px;font-weight:bold">¡Gracias${nombre ? ", " + esc(nombre) : ""}!</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#4A5568">${esc(intro)}</p>
<p style="margin:0 0 4px;font-size:13px;color:#4A5568">Pedido</p>
<p style="margin:0 0 16px;font-size:16px;font-weight:bold">${esc(p.id)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
${p.regalo ? `<p style="margin:12px 0 0;font-size:14px">🎁 Regalo: ${esc(p.regalo)}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;font-size:14px">
${envio ? `<tr><td style="padding:3px 0;color:#4A5568">Envío</td><td align="right" style="padding:3px 0">${esc(envio)}</td></tr>` : ""}
<tr><td style="padding:3px 0;color:#4A5568">${contra ? "Pagado en línea (envío)" : "Total pagado"}</td><td align="right" style="padding:3px 0;font-weight:bold">${esc(dinero(p, p.total))}</td></tr>
${contra ? `<tr><td style="padding:3px 0;color:#4A5568">Pagas al recibir</td><td align="right" style="padding:3px 0;font-weight:bold">${esc(pesos(p.cobrarAlRecibir))}</td></tr>` : ""}
</table>
<p style="margin:16px 0 4px;font-size:13px;color:#4A5568">Lo enviamos a</p>
<p style="margin:0 0 16px;font-size:14px">${esc(c.nombre)}<br>${esc(c.destino || [c.direccion, c.ciudad, c.departamento].filter(Boolean).join(", "))}<br>${esc(c.celular)}</p>
<p style="margin:0 0 18px;font-size:14px;line-height:1.5;background:#E8EFFC;border-radius:10px;padding:12px 14px">${esc(pasos)}</p>
<a href="${esc(wa)}" style="display:inline-block;background:#1FA855;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px;font-size:14px">Escríbenos por WhatsApp</a>
</td></tr>
<tr><td style="padding:16px 22px;background:#F4F6F9;font-size:12px;line-height:1.5;color:#4A5568">
Tienes derecho de retracto dentro de los 5 días hábiles siguientes a la entrega, en los términos de nuestra
<a href="${sitio}/devoluciones" style="color:#1E4FBF">política de cambios y devoluciones</a>.
<a href="${sitio}/terminos" style="color:#1E4FBF">Términos y condiciones</a> · <a href="${sitio}/privacidad" style="color:#1E4FBF">Privacidad</a><br>
${esc(legal)}<br>
Recibes este correo porque hiciste un pedido en nuestra tienda.
</td></tr></table></td></tr></table></body></html>`;
  const texto = [
    `¡Gracias${nombre ? ", " + nombre : ""}!`, intro, "", `Pedido: ${p.id}`, ...(p.productos || []).map((x) => "• " + x),
    p.regalo ? `Regalo: ${p.regalo}` : "", envio ? `Envío: ${envio}` : "", `${contra ? "Pagado en línea (envío)" : "Total pagado"}: ${dinero(p, p.total)}`,
    contra ? `Pagas al recibir: ${pesos(p.cobrarAlRecibir)}` : "", "", `Lo enviamos a: ${c.destino || ""}`, "", pasos, "", `WhatsApp: ${wa}`, "",
    `Derecho de retracto y devoluciones: ${sitio}/devoluciones`, legal,
  ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  return { html, texto, asunto: `Confirmamos tu pedido ${p.id} · Ingeniero Espuelístico` };
}

// Envía la confirmación una sola vez por pedido. Nunca lanza error (si falla, solo queda en el registro).
export async function enviarConfirmacion(env, p, N) {
  try {
    const para = p && p.cliente && p.cliente.correo;
    if (!correoListo(env) || !correoValido(para) || !env.PEDIDOS) return false;
    const marca = `correo:${p.id}`;
    if (await env.PEDIDOS.get(marca)) return false;
    const { html, texto, asunto } = contenido(p, N);
    const r = await fetchT("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `confirmacion-${p.id}` },
      body: JSON.stringify({ from: env.CORREO_REMITENTE, to: [para], reply_to: N.correo, subject: asunto, html, text: texto }),
    });
    if (!r.ok) { console.error("Resend", r.status, (await r.text()).slice(0, 300)); return false; }
    await env.PEDIDOS.put(marca, "1", { expirationTtl: 90 * 86400 });
    return true;
  } catch (e) { console.error("correo", e && e.message); return false; }
}
export const _contenido = contenido; // para pruebas
