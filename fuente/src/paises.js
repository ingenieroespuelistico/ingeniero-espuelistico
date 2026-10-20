// Países, indicativos y validación de celulares (libphonenumber-js, metadatos "min").
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, validatePhoneNumberLength, Metadata } from "libphonenumber-js/min";

const PRINCIPALES = ["CO", "CR", "EC", "PA", "PE", "VE", "US", "CA"];
const nombres = new Intl.DisplayNames(["es"], { type: "region" });
const nombre = (iso) => { try { return nombres.of(iso); } catch (e) { return iso; } };
const indicativo = (iso) => "+" + getCountryCallingCode(iso);

function todos() {
  return getCountries().map((iso) => ({ iso, nombre: nombre(iso), indicativo: indicativo(iso) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
function longitudes(iso) {
  try { const m = new Metadata(); m.selectNumberingPlan(iso); return m.numberingPlan.possibleLengths(); } catch (e) { return []; }
}
// Reglas exactas de celular para los países principales: dígitos y cómo empieza
const CELULARES = {
  CO: { digitos: 10, empieza: "3" }, CR: { digitos: 8, empieza: "5678" }, EC: { digitos: 9, empieza: "9" },
  PA: { digitos: 8, empieza: "6" }, PE: { digitos: 9, empieza: "9" }, VE: { digitos: 10, empieza: "4" },
  US: { digitos: 10 }, CA: { digitos: 10 },
};
// Devuelve { ok, numeroE164, mensaje }
function validar(numero, iso) {
  let limpio = String(numero || "").replace(/[^\d]/g, "");
  if (!limpio) return { ok: false, mensaje: "Escribe tu número de celular." };
  const regla = CELULARES[iso];
  if (regla) {
    if (iso === "EC" && limpio.length === 10 && limpio[0] === "0") limpio = limpio.slice(1); // 09... → 9...
    if (iso === "VE" && limpio.length === 11 && limpio[0] === "0") limpio = limpio.slice(1); // 04... → 4...
    if (limpio.length !== regla.digitos) return { ok: false, mensaje: `El celular de ${nombre(iso)} debe tener ${regla.digitos} dígitos (sin el indicativo ${indicativo(iso)}). Escribiste ${limpio.length}.` };
    if (regla.empieza && !regla.empieza.includes(limpio[0])) return { ok: false, mensaje: `Los celulares de ${nombre(iso)} empiezan por ${regla.empieza.split("").join(", ")}. Revisa el número.` };
    return { ok: true, numeroE164: indicativo(iso) + limpio, mensaje: "" };
  }
  const largos = longitudes(iso);
  const texto = largos.length ? (largos.length === 1 ? `${largos[0]} dígitos` : `entre ${Math.min(...largos)} y ${Math.max(...largos)} dígitos`) : "";
  const problema = validatePhoneNumberLength(limpio, iso);
  if (problema === "TOO_SHORT" || problema === "TOO_LONG" || problema === "INVALID_LENGTH") {
    return { ok: false, mensaje: `El número de ${nombre(iso)} debe tener ${texto} (sin el indicativo). Tiene ${limpio.length}.` };
  }
  const tel = parsePhoneNumberFromString(limpio, iso);
  if (!tel || !tel.isValid()) return { ok: false, mensaje: `Revisa el número: no parece un celular válido de ${nombre(iso)}.` };
  return { ok: true, numeroE164: tel.number, mensaje: "" };
}

// Llena un <select> de país con los principales + "Otro país…" y un segundo <select> con todos.
function prepararSelector(principal, todosSelect, alCambiar) {
  const lista = todos();
  principal.innerHTML = PRINCIPALES.map((iso) => `<option value="${iso}">${nombre(iso)}</option>`).join("") + `<option value="OTRO">Otro país…</option>`;
  todosSelect.innerHTML = `<option value="">Elige tu país</option>` + lista.filter((p) => !PRINCIPALES.includes(p.iso))
    .map((p) => `<option value="${p.iso}">${p.nombre} (${p.indicativo})</option>`).join("");
  const contenedor = todosSelect.closest("[data-otro-pais]") || todosSelect;
  const actual = () => (principal.value === "OTRO" ? todosSelect.value : principal.value);
  const avisar = () => { contenedor.hidden = principal.value !== "OTRO"; alCambiar(actual()); };
  principal.addEventListener("change", avisar);
  todosSelect.addEventListener("change", avisar);
  avisar();
  return { actual };
}

// Ciudades: se cargan bajo demanda desde js/lugares/XX.js (funciona también sin servidor)
const cargados = {};
function cargarLugares(iso) {
  window.LUGARES = window.LUGARES || {};
  if (window.LUGARES[iso]) return Promise.resolve(window.LUGARES[iso]);
  if (cargados[iso]) return cargados[iso];
  return (cargados[iso] = new Promise((ok) => {
    const s = document.createElement("script");
    s.src = `js/lugares/${iso}.js`;
    s.onload = () => ok(window.LUGARES[iso] || null);
    s.onerror = () => ok(null);
    document.head.appendChild(s);
  }));
}

window.Paises = { PRINCIPALES, nombre, indicativo, todos, validar, prepararSelector, cargarLugares, longitudes };
