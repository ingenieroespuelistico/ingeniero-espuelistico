// El cursor-gallo salta un instante cada vez que haces clic.
(function () {
  if (!window.matchMedia || !window.matchMedia("(pointer: fine)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var html = document.documentElement, t;
  document.addEventListener("pointerdown", function () {
    html.classList.add("cursor-salto");
    clearTimeout(t);
    t = setTimeout(function () { html.classList.remove("cursor-salto"); }, 260);
  });
})();
