// Carga la espuela 3D sin frenar la apertura de la página.
// En celulares espera al primer toque o desplazamiento; en computador, a que la página termine de cargar.
// Mientras tanto se ve la foto de la espuela.
(() => {
  "use strict";
  const html = document.documentElement;
  let cargado = false;
  const eventos = ["pointerdown", "touchstart", "keydown", "scroll", "wheel", "mousemove"];
  function cargar() {
    if (cargado) return;
    cargado = true;
    eventos.forEach((e) => removeEventListener(e, cargar, { passive: true }));
    const s = document.createElement("script");
    s.src = "js/espuela3d.min.js?v=11";
    s.async = true;
    s.onload = () => setTimeout(() => html.classList.add("tres-d"), 300);
    document.body.appendChild(s);
  }
  eventos.forEach((e) => addEventListener(e, cargar, { passive: true }));
  if (matchMedia("(pointer: fine)").matches) {
    const despues = () => (window.requestIdleCallback ? requestIdleCallback(cargar, { timeout: 2500 }) : setTimeout(cargar, 1200));
    if (document.readyState === "complete") despues(); else addEventListener("load", despues);
  }
})();
