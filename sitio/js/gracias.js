// Página de regreso desde Mercado Pago: confirma el estado del pago con el servidor (no con la dirección).
(async () => {
  "use strict";
  const q = new URLSearchParams(location.search);
  const pago = q.get("payment_id") || q.get("collection_id") || "";
  const pedido = q.get("external_reference") || "";
  const $ = (id) => document.getElementById(id);
  const pintar = (icono, titulo, texto) => { $("gracias-icono").textContent = icono; $("gracias-titulo").textContent = titulo; $("gracias-texto").textContent = texto; };
  const pesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");
  if (pedido) {
    $("gracias-pedido").textContent = `Pedido ${pedido}`;
    $("gracias-wa").href = `https://wa.me/573019580737?text=${encodeURIComponent("Hola, les escribo por mi pedido " + pedido)}`;
  }
  if (!/^\d+$/.test(pago)) {
    pintar("ℹ️", "No se completó el pago", "Si cerraste la ventana de Mercado Pago, tu pedido sigue guardado en la tienda y puedes intentarlo de nuevo.");
    return;
  }
  try {
    const r = await fetch(`/api/estado?pago=${encodeURIComponent(pago)}&pedido=${encodeURIComponent(pedido)}`);
    const d = await r.json();
    if (!d.ok) throw new Error();
    if (d.estado === "approved") {
      pintar("✅", "¡Pago recibido!", d.contraentrega
        ? `Pagaste el envío (${pesos(d.total)}). Los productos los pagas al recibir. Te escribimos por WhatsApp con la guía de envío.`
        : `Recibimos ${pesos(d.total)}. Despachamos el mismo día si pagaste antes de las 4:00 p.m. (sábados antes de las 10:00 a.m.). Te escribimos por WhatsApp con la guía.`);
      try { localStorage.removeItem("ie-pedido"); } catch (e) {}
      const ya = `ie-compra-${pago}`;
      let contada = false;
      try { contada = sessionStorage.getItem(ya) === "1"; sessionStorage.setItem(ya, "1"); } catch (e) {}
      if (!contada && window.Medicion) Medicion.evento("Purchase", { value: Math.round(d.total) });
    } else if (d.estado === "pending" || d.estado === "in_process") {
      pintar("⏳", "Tu pago está pendiente", d.medio === "efecty"
        ? "Paga el código de Efecty antes de que venza. Cuando Mercado Pago nos confirme, despachamos y te escribimos."
        : "Mercado Pago está confirmando tu pago. Te avisamos por WhatsApp apenas se apruebe.");
    } else {
      pintar("❌", "El pago no se aprobó", "No se hizo ningún cobro. Tu pedido sigue en la tienda: puedes intentarlo con otro medio de pago o escribirnos.");
    }
  } catch (e) {
    pintar("ℹ️", "No pudimos confirmar el pago aquí", "Si pagaste, te escribiremos por WhatsApp para confirmar. También puedes escribirnos con tu número de pedido.");
  }
})();
