import { iniciarEspuela } from "./escena.js";
const lienzo = document.getElementById("lienzo-espuela");
const visor = document.getElementById("visor-espuela");
const rotulos = document.getElementById("rotulos-espuela");
const leyenda = document.getElementById("leyenda-espuela");
if (lienzo && visor) iniciarEspuela({ lienzo, visor, rotulos, leyenda });
