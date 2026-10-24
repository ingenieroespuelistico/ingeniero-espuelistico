// Formulario de PQR: radica la solicitud (con número, fecha y hora) y consulta su estado.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fecha = (iso, conHora) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric", ...(conHora ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(iso));
  const ESTADOS = { recibida: "Recibida", en_tramite: "En trámite", respondida: "Respondida", cerrada: "Cerrada" };

  function celularE164(v) {
    const d = String(v || "").replace(/[^\d+]/g, "");
    if (d.startsWith("+")) return "+" + d.slice(1).replace(/\D/g, "");
    if (d.length === 10 && d[0] === "3") return "+57" + d;
    return d ? "+" + d : "";
  }

  $("#form-pqr").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const error = $("#pqr-error");
    const falta = !f.tipo ? "Elige el tipo de solicitud." : !f.nombre.trim() ? "Escribe tu nombre." : !f.documento.trim() ? "Escribe tu documento."
      : celularE164(f.celular).length < 9 ? "Escribe tu celular." : f.mensaje.trim().length < 10 ? "Cuéntanos con más detalle qué pasó." : !f.acepto ? "Para radicar, autoriza el tratamiento de tus datos." : "";
    if (falta) { error.textContent = falta; return; }
    error.textContent = "";
    const boton = $("#pqr-enviar"); boton.disabled = true; boton.textContent = "Radicando…";
    try {
      const r = await fetch("/api/pqr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, celular: celularE164(f.celular), acepto: true }) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) throw new Error(d.error || "No pudimos radicar tu solicitud");
      e.target.hidden = true;
      const caja = $("#pqr-resultado");
      caja.hidden = false;
      caja.innerHTML = `<p class="pqr__numero">Radicado <strong>${esc(d.radicado)}</strong></p>
        <p>Recibimos tu solicitud el <strong>${esc(fecha(d.fecha, true))}</strong> (hora de Colombia). Te respondemos a más tardar el <strong>${esc(fecha(d.limite))}</strong>.</p>
        <p>Guarda este número para consultar el estado aquí mismo. Si tienes fotos o videos, envíalos por <a href="https://wa.me/573019580737?text=${encodeURIComponent("Hola, envío soportes de mi radicado " + d.radicado)}" target="_blank" rel="noopener">WhatsApp</a> con el número de radicado.</p>`;
      $("#consulta-radicado").value = d.radicado; $("#consulta-documento").value = f.documento;
    } catch (err) { error.textContent = `${err.message}. También puedes escribirnos por WhatsApp al +57 301 958 0737.`; }
    boton.disabled = false; boton.textContent = "Radicar solicitud";
  });

  $("#form-consulta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const error = $("#consulta-error"), caja = $("#consulta-resultado");
    if (!f.radicado.trim() || !f.documento.trim()) { error.textContent = "Escribe el radicado y el documento."; return; }
    error.textContent = ""; caja.hidden = true;
    try {
      const r = await fetch(`/api/pqr?${new URLSearchParams({ radicado: f.radicado.trim().toUpperCase(), documento: f.documento.trim() })}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) throw new Error(d.error || "No encontramos ese radicado");
      caja.hidden = false;
      caja.innerHTML = `<p class="pqr__numero">Radicado <strong>${esc(d.radicado)}</strong> · ${esc(ESTADOS[d.estado] || d.estado)}</p>
        <p>Radicado el ${esc(fecha(d.fecha, true))} · respuesta a más tardar el ${esc(fecha(d.limite))}.</p>
        ${d.respuesta ? `<p><strong>Respuesta (${esc(fecha(d.respondida, true))}):</strong><br>${esc(d.respuesta).replace(/\n/g, "<br>")}</p>` : "<p>Todavía no hay respuesta. Te avisaremos por WhatsApp o correo.</p>"}`;
    } catch (err) { error.textContent = err.message; }
  });
})();
