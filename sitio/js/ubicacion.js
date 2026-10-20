// Conecta los campos de país, indicativo, región y ciudad de un formulario.
// País: los principales primero y "Otro país…" despliega la lista completa.
// Región y ciudad: listas desplegables según el país (si no hay lista, se escribe a mano).
(() => {
  "use strict";
  const opciones = (lista) => lista.map((t) => `<option>${t.replace(/</g, "&lt;")}</option>`).join("");
  const OTRA = "__otra__";

  function conectar(c) {
    const P = window.Paises;
    let lugares = null;

    function pintarCiudades() {
      if (!c.ciudad) return;
      const reg = lugares && lugares.regiones.find((r) => r.nombre === c.region.value);
      const ciudades = reg ? reg.ciudades : [];
      const libre = !lugares || lugares.ciudadLibre || !ciudades.length;
      c.ciudad.closest("label").hidden = libre;
      c.ciudad.innerHTML = `<option value="">Elige ${lugares ? lugares.etiquetaCiudad.toLowerCase() : "ciudad"}</option>` + opciones(ciudades) + `<option value="${OTRA}">Otro (escríbelo)</option>`;
      mostrarOtra(libre);
    }
    function mostrarOtra(forzar) {
      if (!c.ciudadOtra) return;
      const ver = forzar || c.ciudad.value === OTRA;
      c.ciudadOtra.closest("label").hidden = !ver;
      c.ciudadOtra.required = ver;
    }

    async function alCambiarPais(iso) {
      if (c.indicativo) c.indicativo.textContent = iso ? P.indicativo(iso) : "+";
      if (c.celular) c.celular.setCustomValidity("");
      if (c.region) {
        lugares = iso ? await P.cargarLugares(iso) : null;
        const etiqueta = c.region.closest("label").querySelector("[data-etiqueta]");
        if (etiqueta) etiqueta.textContent = lugares ? lugares.etiquetaRegion : "Región o estado";
        const etqCiudad = c.ciudad && c.ciudad.closest("label").querySelector("[data-etiqueta]");
        if (etqCiudad) etqCiudad.textContent = lugares ? lugares.etiquetaCiudad : "Ciudad";
        if (lugares) {
          c.region.innerHTML = `<option value="">Elige ${lugares.etiquetaRegion.toLowerCase()}</option>` + opciones(lugares.regiones.map((r) => r.nombre));
          c.region.closest("label").hidden = false;
          if (c.regionLibre) { c.regionLibre.closest("label").hidden = true; c.regionLibre.required = false; }
        } else {
          c.region.closest("label").hidden = true;
          if (c.regionLibre) { c.regionLibre.closest("label").hidden = false; c.regionLibre.required = true; }
        }
        pintarCiudades();
      }
      if (c.alCambiar) c.alCambiar(iso);
    }

    const selector = P.prepararSelector(c.pais, c.paisOtro, alCambiarPais);
    if (c.region) c.region.addEventListener("change", pintarCiudades);
    if (c.ciudad) c.ciudad.addEventListener("change", () => mostrarOtra(false));

    return {
      iso: () => selector.actual(),
      paisNombre: () => (selector.actual() ? P.nombre(selector.actual()) : ""),
      region: () => (c.region && !c.region.closest("label").hidden ? c.region.value : (c.regionLibre ? c.regionLibre.value.trim() : "")),
      ciudad: () => {
        if (!c.ciudad) return "";
        const usarOtra = c.ciudad.closest("label").hidden || c.ciudad.value === OTRA;
        return usarOtra ? (c.ciudadOtra ? c.ciudadOtra.value.trim() : "") : c.ciudad.value;
      },
      // Devuelve el número completo (+57...) o null, y deja el mensaje en el campo
      celular: () => {
        const iso = selector.actual();
        if (!iso) return { ok: false, mensaje: "Elige tu país." };
        return P.validar(c.celular.value, iso);
      },
    };
  }
  window.Ubicacion = { conectar };
})();
