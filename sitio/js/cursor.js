// Cursor-gallo (solo con mouse). Sus estilos se cargan aparte para no frenar la apertura en celulares.
(function () {
  if (!window.matchMedia || !window.matchMedia("(pointer: fine)").matches) return;
  var l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "css/cursor.css?v=11";
  document.head.appendChild(l);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // El gallo salta un instante cada vez que haces clic
  var html = document.documentElement, t;
  document.addEventListener("pointerdown", function () {
    html.classList.add("cursor-salto");
    clearTimeout(t);
    t = setTimeout(function () { html.classList.remove("cursor-salto"); }, 260);
  });
})();
