// Página de regreso desde Mercado Pago o PayPal: confirma el estado del pago con el servidor (no con la dirección).
// Si el pago todavía se está procesando (PSE, por ejemplo), vuelve a preguntar varias veces.
(async () => {
  "use strict";
  const q = new URLSearchParams(location.search);
  const limpio = (v) => (v && v !== "null" ? v : "");
  let ultimo = {};
  try { ultimo = JSON.parse(sessionStorage.getItem("ie-ultimo-pedido") || "{}"); } catch (e) {}
  const pago = limpio(q.get("payment_id")) || limpio(q.get("collection_id"));
  const orden = limpio(q.get("merchant_order_id"));
  const pedido = limpio(q.get("external_reference")) || ultimo.pedido || "";
  const $ = (id) => document.getElementById(id);
  const pintar = (icono, titulo, texto) => { $("gracias-icono").textContent = icono; $("gracias-titulo").textContent = titulo; $("gracias-texto").textContent = texto; };
  const pesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  if (pedido) {
    $("gracias-pedido").textContent = `Pedido ${pedido}`;
    $("gracias-wa").href = `https://wa.me/573019580737?text=${encodeURIComponent("Hola, les escribo por mi pedido " + pedido)}`;
  }
  // ----- Regreso desde PayPal -----
  const pp = q.get("pp");
  if (pp === "cancelado") {
    pintar("ℹ️", "Cancelaste el pago en PayPal", "No se hizo ningún cobro. Tu pedido sigue en el carrito de la tienda: puedes intentarlo de nuevo o escribirnos por WhatsApp.");
    return;
  }
  if (pp === "1") {
    const ordenPP = limpio(q.get("token"));
    if (!/^[A-Z0-9]{8,40}$/.test(ordenPP)) { pintar("ℹ️", "No se completó el pago", "Si ya pagaste en PayPal, escríbenos con tu número de pedido y lo confirmamos."); return; }
    pintar("⏳", "Confirmando tu pago con PayPal…", "No cierres esta página; tarda unos segundos.");
    let d = null;
    for (let intento = 0; intento < 3 && !(d && d.ok); intento++) {
      try {
        const r = await fetch("/api/paypal/capturar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orden: ordenPP, pedido }) });
        d = await r.json();
        if (r.status === 404) break;
      } catch (e) { d = null; }
      if (!(d && d.ok)) await espera(2500);
    }
    const usd = (n) => "USD " + Number(n || 0).toFixed(2);
    if (d && d.ok && d.estado === "approved") {
      pintar("✅", "¡Pago recibido y verificado!", `PayPal confirmó tu pago de ${usd(d.total)}. Preparamos tu envío internacional y te escribimos por WhatsApp con la guía. PayPal también te envió el comprobante a tu correo.`);
      document.body.classList.add("gracias--ok");
      try { localStorage.removeItem("ie-pedido"); sessionStorage.removeItem("ie-ultimo-pedido"); } catch (e) {}
      const ya = `ie-compra-${d.pedido}`;
      let contada = false;
      try { contada = localStorage.getItem(ya) === "1"; localStorage.setItem(ya, "1"); } catch (e) {}
      if (!contada && window.Medicion) Medicion.evento("Purchase", { value: Number(d.total), currency: "USD" });
    } else if (d && d.ok && d.estado === "sin_pagar") {
      pintar("ℹ️", "No se completó el pago", "PayPal no registra la aprobación del pago y no se hizo ningún cobro. Tu pedido sigue en el carrito: puedes intentarlo de nuevo o escribirnos.");
    } else if (d && d.ok && d.estado === "pending") {
      pintar("⏳", "Tu pago está en revisión", "PayPal está revisando el pago. En cuanto lo apruebe te escribimos por WhatsApp; no tienes que pagar de nuevo.");
    } else if (d && d.ok) {
      pintar("❌", "El pago no se aprobó", "PayPal no aprobó el pago y no se hizo ningún cobro. Puedes intentarlo con otra tarjeta o escribirnos.");
    } else {
      pintar("⏳", "Estamos confirmando tu pago", "Si ya aprobaste el pago en PayPal, lo confirmamos en pocos minutos y te escribimos por WhatsApp. Si quieres, escríbenos con tu número de pedido.");
    }
    return;
  }

  if (!/^\d+$/.test(pago) && !/^\d+$/.test(orden)) {
    pintar("ℹ️", "No se completó el pago", "Si cerraste la ventana de Mercado Pago antes de pagar, tu pedido sigue guardado en la tienda y puedes intentarlo de nuevo. Si ya pagaste, escríbenos con tu número de pedido y lo confirmamos.");
    return;
  }

  const consultar = async () => {
    const p = new URLSearchParams({ pago, orden, pedido });
    const r = await fetch(`/api/estado?${p}`, { cache: "no-store" });
    return r.json();
  };
  let d = null, fallos = 0;
  for (let intento = 0; intento < 16; intento++) {
    try { d = await consultar(); } catch (e) { d = null; }
    if (d && d.ok && (d.estado === "approved" || d.estado === "rejected" || d.estado === "cancelled")) break;
    if (d && d.ok) pintar("⏳", "Confirmando tu pago…", "Mercado Pago está confirmando tu pago con el banco. No cierres esta página; tarda unos segundos.");
    else if (++fallos >= 5) break;
    await espera(intento < 6 ? 3000 : 6000);
  }

  if (d && d.ok && d.estado === "approved") {
    pintar("✅", "¡Pago recibido y verificado!", d.contraentrega
      ? `Mercado Pago confirmó el pago del envío (${pesos(d.total)}). Los productos los pagas al recibir. Te escribimos por WhatsApp con la guía de envío. Mercado Pago también te envió el comprobante a tu correo.`
      : `Mercado Pago confirmó tu pago de ${pesos(d.total)}. Despachamos el mismo día si pagaste antes de las 4:00 p.m. (sábados antes de las 10:00 a.m.). Te escribimos por WhatsApp con la guía. Mercado Pago también te envió el comprobante a tu correo.`);
    document.body.classList.add("gracias--ok");
    try { localStorage.removeItem("ie-pedido"); sessionStorage.removeItem("ie-ultimo-pedido"); } catch (e) {}
    // Acuse de recibo: resumen del pedido para guardar o imprimir
    if (d.resumen && d.resumen.productos && d.resumen.productos.length) {
      const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      const r = d.resumen, caja = $("gracias-resumen");
      caja.innerHTML = `<h2>Resumen de tu pedido</h2><ul>${r.productos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${r.regalo ? `<p>🎁 Regalo: ${esc(r.regalo)}</p>` : ""}
        ${r.envio ? `<p>Envío${r.ciudad ? " a " + esc(r.ciudad) : ""}: ${pesos(r.envio.valor)}${r.envio.transportadora ? " · " + esc(r.envio.transportadora) : ""}${r.envio.dias ? " · " + esc(r.envio.dias) : ""}</p>` : ""}
        <p><strong>Pagado: ${pesos(d.total)}</strong>${d.contraentrega ? ` · <strong>Pagas al recibir: ${pesos(r.cobrarAlRecibir)}</strong>` : ""}</p>
        <p class="gracias__nota">Esta página es la confirmación de tu compra: guárdala o toma una captura. <a href="#" id="imprimir">Imprimir o guardar en PDF</a></p>`;
      caja.hidden = false;
      const imp = document.getElementById("imprimir");
      if (imp) imp.addEventListener("click", (e) => { e.preventDefault(); print(); });
    }
    const ya = `ie-compra-${d.pedido}`;
    let contada = false;
    try { contada = localStorage.getItem(ya) === "1"; localStorage.setItem(ya, "1"); } catch (e) {}
    if (!contada && window.Medicion) Medicion.evento("Purchase", { value: Math.round(d.total) });
  } else if (d && d.ok && (d.estado === "pending" || d.estado === "in_process" || d.estado === "authorized")) {
    pintar("⏳", "Tu pago está en proceso", d.medio === "efecty"
      ? "Paga el código de Efecty antes de que venza. Cuando Mercado Pago nos confirme, despachamos y te escribimos por WhatsApp."
      : "Mercado Pago todavía está confirmando tu pago con el banco. En cuanto se apruebe te escribimos por WhatsApp; no tienes que pagar de nuevo.");
  } else if (d && d.ok) {
    pintar("❌", "El pago no se aprobó", "No se hizo ningún cobro. Tu pedido sigue en la tienda: puedes intentarlo con otro medio de pago o escribirnos.");
  } else {
    pintar("⏳", "Estamos confirmando tu pago", "Si ya pagaste, tu dinero está seguro con Mercado Pago y te confirmamos por WhatsApp en minutos. Si quieres, escríbenos con tu número de pedido.");
  }
})();
