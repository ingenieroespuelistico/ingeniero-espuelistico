// Menú para celular: botón de tres líneas que abre y cierra las secciones.
(() => {
  "use strict";
  const boton = document.getElementById("menu-boton");
  const menu = document.getElementById("menu-principal");
  if (!boton || !menu) return;
  const abrir = (si) => {
    boton.setAttribute("aria-expanded", si ? "true" : "false");
    boton.setAttribute("aria-label", si ? "Cerrar menú" : "Abrir menú");
    document.documentElement.classList.toggle("menu-abierto", si);
  };
  boton.addEventListener("click", () => abrir(boton.getAttribute("aria-expanded") !== "true"));
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) abrir(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") abrir(false); });
  window.matchMedia("(min-width: 961px)").addEventListener("change", (e) => { if (e.matches) abrir(false); });
})();
