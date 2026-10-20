// Entrada: el gallo se para, salta y aparece la marca. Una sola vez por visita; se omite con "menos movimiento".
(function () {
  var html = document.documentElement;
  var reducido = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var visto = false;
  try { visto = sessionStorage.getItem("ie-intro") === "1"; } catch (e) {}
  if (reducido || visto) { html.classList.add("sin-intro"); return; }
  html.classList.add("con-intro");
  try { sessionStorage.setItem("ie-intro", "1"); } catch (e) {}
  function terminar() {
    html.classList.add("intro-fin");
    setTimeout(function () { var el = document.getElementById("intro"); if (el) el.remove(); html.classList.remove("con-intro"); }, 600);
  }
  var t = setTimeout(terminar, 2500);
  document.addEventListener("DOMContentLoaded", function () {
    var el = document.getElementById("intro");
    if (el) el.addEventListener("click", function () { clearTimeout(t); terminar(); });
  });
})();
