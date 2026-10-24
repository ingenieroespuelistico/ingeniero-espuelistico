// Agenda de llamadas: el cliente elige día y hora dentro del horario de atención (hora de Colombia).
// Por ahora la solicitud sale por WhatsApp. Más adelante se podrá crear el evento en Google Calendar desde el servidor (Cloudflare).
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const form = $("#formulario-agenda");
  if (!form) return;

  // Festivos de Colombia (actualizar cada año). Domingos y festivos no se agenda.
  const FESTIVOS = new Set([
    "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18", "2026-06-08",
    "2026-06-15", "2026-06-29", "2026-07-13", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02",
    "2026-11-16", "2026-12-08", "2026-12-25",
    "2027-01-01", "2027-01-11", "2027-03-22", "2027-03-25", "2027-03-26", "2027-05-01", "2027-05-10", "2027-05-31",
    "2027-06-07", "2027-07-05", "2027-07-12", "2027-07-20", "2027-08-07", "2027-08-16", "2027-10-18", "2027-11-01",
    "2027-11-15", "2027-12-08", "2027-12-25",
  ]);
  const DIAS_A_MOSTRAR = 10, INTERVALO_MIN = 5, ANTICIPACION_MIN = 60;
  // Horario de llamadas (minutos desde medianoche): de 8:00 a.m. a 3:00 p.m. (sábados hasta las 2:00 p.m.),
  // con descanso de 12:00 m. a 1:30 p.m.
  const DESCANSO = [12 * 60, 13 * 60 + 30];

  // Fechas en hora de Colombia (UTC−5, sin horario de verano)
  const OFFSET = -5 * 60;
  const ahoraColombia = () => new Date(Date.now() + (OFFSET + new Date().getTimezoneOffset()) * 60000);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const horario = (d) => { const w = d.getDay(); return w === 0 ? null : w === 6 ? [8 * 60, 14 * 60] : [8 * 60, 15 * 60]; };
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

  // Días disponibles
  const dias = [];
  for (let d = ahoraColombia(), n = 0; dias.length < DIAS_A_MOSTRAR && n < 30; n++) {
    const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    if (horario(dia) && !FESTIVOS.has(ymd(dia)) && horasDe(dia).length) dias.push(dia);
  }
  function horasDe(dia) {
    const h = horario(dia); if (!h) return [];
    const ahora = ahoraColombia(), hoy = ymd(ahora) === ymd(dia);
    const minimo = hoy ? ahora.getHours() * 60 + ahora.getMinutes() + ANTICIPACION_MIN : 0;
    const lista = [];
    for (let m = h[0]; m <= h[1] - INTERVALO_MIN; m += INTERVALO_MIN) if (m >= minimo && !(m >= DESCANSO[0] && m < DESCANSO[1])) lista.push(m);
    return lista;
  }
  $("#agenda-dias").innerHTML = dias.map((d, i) =>
    `<label class="chip"><input type="radio" name="dia" value="${ymd(d)}" ${i === 0 ? "checked" : ""}><span>${mayus(nombreDia.format(d))}</span></label>`).join("");

  function pintarHoras() {
    const v = new FormData(form).get("dia");
    const dia = dias.find((d) => ymd(d) === v) || dias[0];
    const horas = dia ? horasDe(dia) : [];
    const grupo = (titulo, lista) => lista.length ? `<optgroup label="${titulo}">${lista.map((m) => `<option value="${m}">${hhmm(m)}</option>`).join("")}</optgroup>` : "";
    $("#agenda-hora").innerHTML = horas.length
      ? `<option value="">Elige la hora</option>` + grupo("Mañana", horas.filter((m) => m < 12 * 60)) + grupo("Tarde", horas.filter((m) => m >= 12 * 60))
      : `<option value="">No hay horas disponibles este día</option>`;
    pintarHoraLocal();
  }
  // Si el visitante no está en Colombia, mostramos la equivalencia en su hora
  function pintarHoraLocal() {
    const difMin = -new Date().getTimezoneOffset() - OFFSET;
    $("#agenda-hora-local").textContent = difMin ? `(hora de Colombia; en tu zona son ${difMin > 0 ? "+" : "−"}${Math.abs(difMin / 60)} h)` : "(hora de Colombia)";
  }
  $("#agenda-dias").addEventListener("change", pintarHoras);
  pintarHoras();

  form.addEventListener("submit", (e) => {
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
    const productos = d.getAll("productos");
    const texto = [
      "Hola, quiero agendar una llamada:",
      `Nombre: ${nombre}`,
      `País: ${ubic.paisNombre()}`,
      `Celular: ${cel.numeroE164}`,
      `Día: ${fechaLarga.format(dia)}`,
      `Hora (Colombia): ${hhmm(Number(d.get("hora")))}`,
      `Productos de interés: ${productos.length ? productos.join(", ") : "por definir"}`,
      d.get("nota") ? `Comentario: ${d.get("nota")}` : "",
    ].filter(Boolean).join("\n");
    const url = `https://wa.me/${typeof NEGOCIO !== "undefined" ? NEGOCIO.whatsapp : "573019580737"}?text=${encodeURIComponent(texto)}`;
    window.Medicion && Medicion.evento("Schedule", {});
    window.open(url, "_blank", "noopener");
    $("#agenda-aviso").textContent = `Listo. Envía el mensaje de WhatsApp que se abrió y te confirmamos la llamada del ${fechaLarga.format(dia)} a las ${hhmm(Number(d.get("hora")))}.`;
  });
})();
