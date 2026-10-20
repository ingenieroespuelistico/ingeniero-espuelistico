// Moneda en la que el cliente ve los precios.
// La moneda base es SIEMPRE el peso colombiano: los precios se escriben en COP (js/precios.js) y el cobro se hace en COP
// (o en USD por PayPal). Las demás monedas son una referencia que se calcula con la tasa de cambio del día,
// consultada en ExchangeRate-API (gratis, se actualiza una vez al día). Si la consulta falla, se usan TASAS_RESPALDO.
const MONEDAS_PAIS = {
  CO: { moneda: "COP", pais: "Colombia", locale: "es-CO" },
  CR: { moneda: "CRC", pais: "Costa Rica", locale: "es-CR" },
  EC: { moneda: "USD", pais: "Ecuador", locale: "es-EC" },
  PA: { moneda: "USD", pais: "Panamá", locale: "es-PA" },
  PE: { moneda: "PEN", pais: "Perú", locale: "es-PE" },
  VE: { moneda: "USD", pais: "Venezuela", locale: "es-VE" },
  US: { moneda: "USD", pais: "Estados Unidos", locale: "en-US" },
  CA: { moneda: "CAD", pais: "Canadá", locale: "en-CA" },
};

(() => {
  "use strict";
  let pais = "CO";
  try { const g = localStorage.getItem("ie-moneda"); if (g && MONEDAS_PAIS[g]) pais = g; } catch (e) {}
  const decimales = { COP: 0, CRC: 0, USD: 2, PEN: 2, CAD: 2 };
  const cache = {};
  function formato(m, locale) {
    const k = m + locale;
    return cache[k] || (cache[k] = new Intl.NumberFormat(locale, { style: "currency", currency: m, minimumFractionDigits: decimales[m], maximumFractionDigits: decimales[m] }));
  }
  // Tasas: respaldo → guardadas en este navegador (menos de 12 h) → consulta del día
  const TASAS = { fecha: TASAS_RESPALDO.fecha, porDolar: { ...TASAS_RESPALDO.porDolar }, enVivo: false };
  const CLAVE = "ie-tasas", VIGENCIA = 12 * 3600 * 1000;
  const fechaCorta = (d) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric" }).format(d);
  function aplicar(rates, cuando) {
    const nuevas = {};
    for (const m of Object.keys(TASAS.porDolar)) { const v = Number(rates[m]); if (!(v > 0)) return false; nuevas[m] = v; }
    // Si la tasa del peso se aleja más de 30 % del respaldo, la descartamos (dato dañado)
    if (Math.abs(nuevas.COP / TASAS_RESPALDO.porDolar.COP - 1) > 0.3) return false;
    Object.assign(TASAS.porDolar, nuevas);
    TASAS.fecha = fechaCorta(new Date(cuando)); TASAS.enVivo = true;
    return true;
  }
  try { const g = JSON.parse(localStorage.getItem(CLAVE) || "null"); if (g && Date.now() - g.guardado < VIGENCIA) aplicar(g.rates, g.cuando); } catch (e) {}
  function consultarTasas() {
    if (TASAS.enVivo || !window.fetch) return;
    const ctrl = window.AbortController ? new AbortController() : null;
    const t = setTimeout(() => ctrl && ctrl.abort(), 6000);
    fetch("https://open.er-api.com/v6/latest/USD", { signal: ctrl ? ctrl.signal : undefined, credentials: "omit", referrerPolicy: "no-referrer" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (j.result !== "success" || !j.rates) return;
        const cuando = (j.time_last_update_unix || Date.now() / 1000) * 1000;
        if (!aplicar(j.rates, cuando)) return;
        try { localStorage.setItem(CLAVE, JSON.stringify({ rates: j.rates, cuando, guardado: Date.now() })); } catch (e) {}
        marcar();
        if (MONEDAS_PAIS[pais].moneda !== "COP") document.dispatchEvent(new CustomEvent("moneda:cambio", { detail: { pais, moneda: MONEDAS_PAIS[pais].moneda } }));
      })
      .catch(() => {})
      .finally(() => clearTimeout(t));
  }
  const pesosCOP = (n) => "$" + Math.round(n).toLocaleString("es-CO");
  function convertir(cop, moneda) { return (cop / TASAS.porDolar.COP) * TASAS.porDolar[moneda]; }
  function formatear(cop) {
    const c = MONEDAS_PAIS[pais];
    if (c.moneda === "COP") return pesosCOP(cop);
    const n = convertir(cop, c.moneda);
    return "≈ " + formato(c.moneda, c.locale).format(c.moneda === "CRC" ? Math.round(n) : n);
  }
  function cambiar(nuevo) {
    if (!MONEDAS_PAIS[nuevo] || nuevo === pais) return;
    pais = nuevo;
    try { localStorage.setItem("ie-moneda", pais); } catch (e) {}
    marcar();
    document.dispatchEvent(new CustomEvent("moneda:cambio", { detail: { pais, moneda: MONEDAS_PAIS[pais].moneda } }));
    if (MONEDAS_PAIS[pais].moneda !== "COP") consultarTasas();
  }
  function marcar() {
    document.querySelectorAll("[data-moneda-pais]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.monedaPais === pais ? "true" : "false"));
    document.querySelectorAll("[data-moneda-actual]").forEach((el) => {
      const c = MONEDAS_PAIS[pais];
      if (c.moneda === "COP") { el.textContent = "Precios en pesos colombianos (COP), nuestra moneda base."; return; }
      const usd = TASAS.porDolar.COP.toLocaleString("es-CO", { maximumFractionDigits: 0 });
      el.innerHTML = `Precios aproximados en ${c.moneda} para ${c.pais}, calculados desde el precio en pesos colombianos con la tasa del ${TASAS.fecha} (1 USD ≈ ${usd} COP). `
        + `El cobro se hace en pesos colombianos o en dólares, según tu forma de pago, y el valor final puede variar un poco con la tasa del día del pago.`
        + (TASAS.enVivo ? ` <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Tasas: ExchangeRate-API</a>.` : "");
    });
  }
  window.Moneda = {
    tasas: () => ({ ...TASAS, porDolar: { ...TASAS.porDolar } }),
    formatear, pesosCOP, cambiar, marcar,
    pais: () => pais, moneda: () => MONEDAS_PAIS[pais].moneda, esCOP: () => MONEDAS_PAIS[pais].moneda === "COP",
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-moneda-pais]");
    if (b) cambiar(b.dataset.monedaPais);
  });
  // Solo se consulta la tasa si el visitante elige una moneda distinta al peso (así no hay llamadas de más)
  document.addEventListener("DOMContentLoaded", () => { marcar(); if (MONEDAS_PAIS[pais].moneda !== "COP") consultarTasas(); });
})();
