// Arma servidor/catalogo.generado.js juntando los mismos archivos de precios y productos que usa la página.
// Se ejecuta solo en cada publicación (ver "build" en wrangler.jsonc). No edites el archivo generado.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sitio = join(raiz, "sitio");
const html = readFileSync(join(sitio, "index.html"), "utf8");
// Los productos que están en index.html (en su orden), y los archivos de precios y cálculo
const scripts = [...html.matchAll(/<script src="(js\/[^"?]+)(?:\?[^"]*)?"><\/script>/g)].map((m) => m[1]);
const necesarios = scripts.filter((s) => s.startsWith("js/productos/") || ["js/precios.js", "js/datos.js", "js/calculo.js"].includes(s));
for (const f of ["js/precios.js", "js/datos.js", "js/calculo.js"]) if (!necesarios.includes(f)) throw new Error(`Falta ${f} en index.html`);

const partes = necesarios.map((f) => `// ----- ${f} -----\n${readFileSync(join(sitio, f), "utf8")}`);
const salida = `// ARCHIVO GENERADO por servidor/generar-catalogo.mjs — no lo edites; edita sitio/js/...
/* eslint-disable */
const window = {};
${partes.join("\n")}
export const Tienda = {
  PRODUCTOS, PRECIOS, AJUSTE_EMPAQUE, CONTRAENTREGA_MINIMO, ENVIO_INTERNACIONAL_USD, ENVIO_NACIONAL,
  NIVELES, PRESENTACIONES, REGALOS, PULGADAS, NEGOCIO, Calculo: window.Calculo,
};
`;
writeFileSync(join(raiz, "servidor", "catalogo.generado.js"), salida);
console.log(`catalogo.generado.js listo: ${necesarios.length} archivos`);
