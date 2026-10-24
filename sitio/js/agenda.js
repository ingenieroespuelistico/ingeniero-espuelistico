// Agenda de llamadas: el cliente elige día y hora dentro del horario de atención (hora de Colombia).
// Horario, duración y festivos: AGENDA en js/datos.js.
// Si Google Calendar está conectado en el servidor, las horas ocupadas no se ofrecen y la cita queda en el calendario.
// Si no, la solicitud sale por WhatsApp como antes.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const form = $("#formulario-agenda");
  if (!form || typeof AGENDA === "undefined") return;
  const C = window.Calculo;

  const OFFSET = -5 * 60; // Colombia, sin horario de verano
  const ahoraColombia = () => new Date(Date.now() + (OFFSET + new Date().getTimezoneOffset()) * 60000);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const nombreDia = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short" });
  const fechaLarga = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const mayus = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const hhmm = (m) => { const h = Math.floor(m / 60), mi = m % 60, ap = h < 12 ? "a.m." : "p.m."; return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${ap}`; };

  // País e indicativo (principales primero; "Otro país…" despliega todos)
  const ubic = window.Ubicacion.conectar({
    pais: $("#agenda-pais"), paisOtro: $("#agenda-pais-otro"), indicativo: $("#agenda-indicativo"), celular: $("#agenda-celular"),
    alCambiar: () => pintarHoraLocal(),
  });

  // Productos de interés
  if (typeof PRODUCTOS !== "undefined") {
    $("#agenda-productos").innerHTML = PRODUCTOS.map((p) =>
      `<label class="chip"><input type="checkbox" name="productos" value="${p.nombre}"><span>${p.nombre}</span></label>`).join("");
  }

  // Horas ocupadas en Google Calendar (si está conectado)
  let calendario = { activo: false, ocupado: [] };
  const libre = (dia, m) => {
    const ini = C.instanteColombia(ymd(dia), m), fin = ini + AGENDA.duracionMinutos * 60000;
    return !calendario.ocupado.some((o) => ini < Date.parse(o.fin) && fin > Date.parse(o.inicio));
  };
  function horasDe(dia) {
    const ahora = ahoraColombia(), hoy = ymd(ahora) === ymd(dia);
    const minimo = hoy ? ahora.getHours() * 60 + ahora.getMinutes() + AGENDA.anticipacionMinutos : 0;
    return C.horasAgenda(ymd(dia)).filter((m) => m >= minimo && libre(dia, m));
  }

  let dias = [];
  function pintarDias() {
    const elegido = new FormData(form).get("dia");
    dias = [];
    const hoy = ahoraColombia();
    for (let n = 0; dias.length < AGENDA.diasAMostrar && n < 30; n++) {
      const dia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n);
      if (horasDe(dia).length) dias.push(dia);
    }
    const marcar = dias.some((d) => ymd(d) === elegido) ? elegido : dias[0] && ymd(dias[0]);
    $("#agenda-dias").innerHTML = dias.map((d) =>
      `<label class="chip"><input type="radio" name="dia" value="${ymd(d)}" ${ymd(d) === marcar ? "checked" : ""}><span>${mayus(nombreDia.format(d))}</span></label>`).join("");
    pintarHoras();
  }
  function pintarHoras() {
    const v = new FormData(form).get("dia");
    const previa = $("#agenda-hora").value;
    const dia = dias.find((d) => ymd(d) === v) || dias[0];
    const horas = dia ? horasDe(dia) : [];
    const grupo = (titulo, lista) => lista.length ? `<optgroup label="${titulo}">${lista.map((m) => `<option value="${m}">${hhmm(m)}</option>`).join("")}</optgroup>` : "";
    $("#agenda-hora").innerHTML = horas.length
      ? `<option value="">Elige la hora</option>` + grupo("Mañana", horas.filter((m) => m < 12 * 60)) + grupo("Tarde", horas.filter((m) => m >= 12 * 60))
      : `<option value="">No hay horas disponibles este día</option>`;
    if (previa && horas.includes(Number(previa))) $("#agenda-hora").value = previa;
    pintarHoraLocal();
  }
  // Si el visitante no está en Colombia, mostramos la equivalencia en su hora
  function pintarHoraLocal() {
    const difMin = -new Date().getTimezoneOffset() - OFFSET;
    $("#agenda-hora-local").textContent = difMin ? `(hora de Colombia; en tu zona son ${difMin > 0 ? "+" : "−"}${Math.abs(difMin / 60)} h)` : "(hora de Colombia)";
  }
  $("#agenda-dias").addEventListener("change", pintarHoras);
  pintarDias();

  async function consultarCalendario() {
    try {
      const r = await fetch("/api/agenda", { cache: "no-store" });
      const d = await r.json();
      if (d && d.ok && d.activo) {
        calendario = { activo: true, ocupado: Array.isArray(d.ocupado) ? d.ocupado : [] };
        $("#agenda-aviso").textContent = "La cita queda apartada en nuestro calendario y te llamamos a esa hora.";
        pintarDias();
      }
    } catch (e) { /* sin calendario: se agenda por WhatsApp */ }
  }
  // Se consulta cuando el cliente llega a la agenda (no al abrir la página)
  const seccion = document.getElementById("agendar");
  if (seccion && "IntersectionObserver" in window) {
    const obs = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { obs.disconnect(); consultarCalendario(); } }, { rootMargin: "300px" });
    obs.observe(seccion);
  } else consultarCalendario();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = $("#agenda-error");
    const d = new FormData(form);
    const nombre = (d.get("nombre") || "").trim();
    if (!nombre) { error.textContent = "Escribe tu nombre."; $("#agenda-nombre").focus(); return; }
    if (!ubic.iso()) { error.textContent = "Elige tu país."; $("#agenda-pais-otro").focus(); return; }
    const cel = ubic.celular();
    if (!cel.ok) { error.textContent = cel.mensaje; $("#agenda-celular").focus(); return; }
    if (!d.get("hora")) { error.textContent = "Elige la hora de la llamada."; $("#agenda-hora").focus(); return; }
    if (!d.get("acepto")) { error.textContent = "Para agendar, autoriza el tratamiento de tus datos."; $("#agenda-acepto").focus(); return; }
    error.textContent = "";
    const dia = dias.find((x) => ymd(x) === d.get("dia"));
    const hora = Number(d.get("hora"));
    const productos = d.getAll("productos");
    const cuando = `${fechaLarga.format(dia)} a las ${hhmm(hora)}`;
    const texto = [
      "Hola, quiero agendar una llamada:",
      `Nombre: ${nombre}`, `País: ${ubic.paisNombre()}`, `Celular: ${cel.numeroE164}`,
      `Día: ${fechaLarga.format(dia)}`, `Hora (Colombia): ${hhmm(hora)}`,
      `Productos de interés: ${productos.length ? productos.join(", ") : "por definir"}`,
      d.get("nota") ? `Comentario: ${d.get("nota")}` : "",
    ].filter(Boolean).join("\n");
    const url = `https://wa.me/${typeof NEGOCIO !== "undefined" ? NEGOCIO.whatsapp : "573019580737"}?text=${encodeURIComponent(texto)}`;
    const porWhatsApp = () => {
      window.open(url, "_blank", "noopener");
      $("#agenda-aviso").textContent = `Listo. Envía el mensaje de WhatsApp que se abrió y te confirmamos la llamada del ${cuando}.`;
    };
    window.Medicion && Medicion.evento("Schedule", {});
    if (!calendario.activo) { porWhatsApp(); return; }

    const boton = form.querySelector("button[type=submit]");
    const textoBoton = boton.textContent;
    boton.disabled = true; boton.textContent = "Agendando…";
    try {
      const r = await fetch("/api/agenda", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, pais: ubic.paisNombre(), celular: cel.numeroE164, dia: ymd(dia), hora, productos, nota: d.get("nota") || "", acepto: true }),
      });
      const res = await r.json().catch(() => ({}));
      if (r.status === 409) {
        error.textContent = res.error || "Esa hora se acaba de ocupar. Elige otra.";
        if (Array.isArray(res.ocupado)) { calendario.ocupado = res.ocupado; pintarDias(); }
        return;
      }
      if (!res.ok) throw new Error(res.error || "No pudimos agendar");
      const cambiar = `https://wa.me/${NEGOCIO.whatsapp}?text=${encodeURIComponent(`Hola, soy ${nombre}. Agendé una llamada para el ${cuando} y necesito cambiarla.`)}`;
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      $("#agenda-aviso").innerHTML = `✅ <strong>¡Listo! Te llamamos el ${esc(cuando)} (hora de Colombia)</strong> al ${esc(cel.numeroE164)}. Si necesitas cambiarla, <a href="${cambiar}" target="_blank" rel="noopener">escríbenos por WhatsApp</a>.`;
      calendario.ocupado.push({ inicio: new Date(C.instanteColombia(ymd(dia), hora)).toISOString(), fin: new Date(C.instanteColombia(ymd(dia), hora + AGENDA.duracionMinutos)).toISOString() });
      pintarDias();
    } catch (err) {
      error.textContent = `${err.message}. Te dejamos el mensaje listo por WhatsApp.`;
      porWhatsApp();
    } finally {
      boton.disabled = false; boton.textContent = textoBoton;
    }
  });
})();
