// Cálculo de precios, pesos y regalos del pedido.
// Lo usan la página (para mostrar precios) y el servidor (para cobrar). Así el precio que se cobra
// siempre es el mismo que se muestra y nadie puede cambiarlo desde su navegador.
(function (global) {
  "use strict";
  const g = global;
  const prod = (id) => PRODUCTOS.find((p) => p.id === id);
  const MAX_CANTIDAD = 20000; // por línea del pedido

  const nivelPara = (pares) => [...NIVELES].reverse().find((n) => pares >= n.desde) || NIVELES[0];
  const siguienteNivel = (pares) => NIVELES.find((n) => n.desde > pares);
  const paresEspuela = (lista) => lista.filter((l) => prod(l.producto).tipo === "espuela").reduce((s, l) => s + l.cantidad, 0);
  const paresPatapioja = (lista) => lista.filter((l) => l.producto === "patapioja").reduce((s, l) => s + l.cantidad, 0);
  const precioParPatapioja = (pares) => [...prod("patapioja").tramos].reverse().find((t) => pares >= t.desde).precio;

  function precioLinea(l, lista) {
    const p = prod(l.producto);
    if (p.tipo === "espuela") {
      const nivel = nivelPara(paresEspuela(lista));
      const ajuste = PRESENTACIONES.find((x) => x.id === l.presentacion).ajuste;
      const unitario = p.precios[nivel.id] + ajuste;
      return { unitario, total: unitario * l.cantidad };
    }
    if (p.tipo === "patapioja") {
      const unitario = precioParPatapioja(paresPatapioja(lista));
      return { unitario, total: Math.round(unitario * l.cantidad) };
    }
    if (p.tipo === "unidad-docena") {
      const v = p.variantes.find((x) => x.id === l.variante);
      const total = Math.floor(l.cantidad / 12) * v.docena + (l.cantidad % 12) * v.unidad;
      return { unitario: null, total };
    }
    const v = p.variantes.find((x) => x.id === l.variante);
    return { unitario: v.precio, total: v.precio * l.cantidad };
  }
  const subtotal = (lista) => lista.reduce((s, l) => s + precioLinea(l, lista).total, 0);

  function pesoGramos(lista) {
    let gr = 100; // empaque
    lista.forEach((l) => {
      const p = prod(l.producto);
      if (p.tipo === "espuela") gr += l.cantidad * (p.pesoPar + (l.presentacion === "caja" ? 1 : 0));
      else if (p.tipo === "patapioja") gr += l.cantidad * p.pesoPar;
      else gr += l.cantidad * p.variantes.find((x) => x.id === l.variante).peso;
    });
    return gr;
  }

  const regaloPara = (pares) => [...REGALOS].reverse().find((r) => pares >= r.desde);

  // Envío internacional en dólares (solo países con tarifa fija; los demás se cotizan por WhatsApp)
  const tieneTarifaInternacional = (iso) => (ENVIO_INTERNACIONAL_USD.paisesConTarifa || []).includes(iso);
  function envioInternacionalUSD(lista) {
    const kg = pesoGramos(lista) / 1000;
    return ENVIO_INTERNACIONAL_USD.base + ENVIO_INTERNACIONAL_USD.porMedioKiloExtra * Math.ceil(Math.max(0, kg - 1) / 0.5);
  }

  function describirLinea(l) {
    const p = prod(l.producto);
    let nombre, base, unidad;
    if (p.tipo === "espuela") {
      const pres = PRESENTACIONES.find((x) => x.id === l.presentacion).nombre.toLowerCase();
      nombre = p.nombre; base = `${l.medida} líneas - ${PULGADAS[l.medida]} · ${pres}`; unidad = "pares";
    } else if (p.tipo === "patapioja") {
      nombre = `${p.nombre} ${p.colores.find((x) => x.id === l.color).nombre.toLowerCase()}`; base = ""; unidad = "pares";
    } else {
      const v = p.variantes.find((x) => x.id === l.variante);
      if (p.tipo === "unidad-docena") { nombre = `${p.nombre} ${v.nombre.toLowerCase()}`; unidad = p.unidad === "barra" ? "barras" : "pares"; }
      else { nombre = `${p.nombre} ${v.nombre}`; unidad = l.cantidad === 1 ? "unidad" : "unidades"; }
      base = "";
    }
    const cant = `${l.cantidad} ${unidad}`;
    return { nombre, base, detalle: base ? `${base} · ${cant}` : cant };
  }

  // Revisa que una línea del pedido sea válida (lo usa el servidor antes de cobrar)
  function lineaValida(l) {
    if (!l || typeof l !== "object") return false;
    const p = prod(l.producto);
    if (!p || p.sinPrecio) return false;
    if (!Number.isInteger(l.cantidad) || l.cantidad < 1 || l.cantidad > MAX_CANTIDAD) return false;
    let ok;
    if (p.tipo === "espuela") ok = p.medidas.includes(l.medida) && PRESENTACIONES.some((x) => x.id === l.presentacion);
    else if (p.tipo === "patapioja") ok = p.colores.some((x) => x.id === l.color);
    else ok = (p.variantes || []).some((x) => x.id === l.variante);
    if (!ok) return false;
    try { const t = precioLinea(l, [l]).total; return Number.isFinite(t) && t > 0; } catch (e) { return false; }
  }
  // Deja solo los campos conocidos de una línea
  function limpiarLinea(l) {
    if (!l || typeof l !== "object") return {};
    const p = prod(l && l.producto);
    const base = { producto: String(l.producto), cantidad: Math.floor(Number(l.cantidad)) };
    if (!p) return base;
    if (p.tipo === "espuela") return { ...base, medida: Number(l.medida), presentacion: String(l.presentacion) };
    if (p.tipo === "patapioja") return { ...base, color: String(l.color) };
    return { ...base, variante: String(l.variante) };
  }

  g.Calculo = {
    prod, MAX_CANTIDAD, nivelPara, siguienteNivel, paresEspuela, paresPatapioja, precioParPatapioja,
    precioLinea, subtotal, pesoGramos, regaloPara, describirLinea, lineaValida, limpiarLinea,
    tieneTarifaInternacional, envioInternacionalUSD,
  };
})(typeof window !== "undefined" ? window : globalThis);
