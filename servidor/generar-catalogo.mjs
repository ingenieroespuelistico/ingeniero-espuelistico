// Arma servidor/catalogo.generado.js juntando los mismos archivos de precios y productos que usa la página.
// Se ejecuta solo en cada publicación (ver "build" en wrangler.jsonc). No edites el archivo generado.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sitio = join(raiz, "sitio");
// 1) Los productos se toman de la carpeta js/productos/ (archivos "N-nombre.js", en orden de número)
//    y se escriben solos en index.html. Para quitar un producto, borra o renombra su archivo (por ejemplo "_3-x.js").
const archivosProductos = readdirSync(join(sitio, "js", "productos"))
  .filter((f) => /^\d+-[a-z0-9-]+\.js$/i.test(f))
  .sort((a, b) => parseInt(a) - parseInt(b));
if (!archivosProductos.length) throw new Error("No hay productos en sitio/js/productos/");
let html = readFileSync(join(sitio, "index.html"), "utf8");
const reProductos = /(<!-- productos:inicio[^>]*-->\n)[\s\S]*?(<!-- productos:fin -->)/;
if (!reProductos.test(html)) throw new Error("Falta la marca <!-- productos:inicio --> en index.html");
html = html.replace(reProductos, (_, a, b) => a + archivosProductos.map((f) => `<script src="js/productos/${f}?v=15" defer></script>\n`).join("") + b);
writeFileSync(join(sitio, "index.html"), html);
// Los productos que están en index.html (en su orden), y los archivos de precios y cálculo
const scripts = [...html.matchAll(/<script src="(js\/[^"?]+)(?:\?[^"]*)?"[^>]*><\/script>/g)].map((m) => m[1]);
const BASE = ["js/precios.js", "js/datos.js", "js/calculo.js", "js/preguntas-datos.js"];
const necesarios = scripts.filter((s) => s.startsWith("js/productos/") || BASE.includes(s));
for (const f of BASE) if (!necesarios.includes(f)) throw new Error(`Falta ${f} en index.html`);

const partes = necesarios.map((f) => `// ----- ${f} -----\n${readFileSync(join(sitio, f), "utf8")}`);
const salida = `// ARCHIVO GENERADO por servidor/generar-catalogo.mjs — no lo edites; edita sitio/js/...
/* eslint-disable */
const window = {};
${partes.join("\n")}
export const Tienda = {
  PRODUCTOS, PRECIOS, AJUSTE_EMPAQUE, CONTRAENTREGA_MINIMO, ENVIO_INTERNACIONAL_USD, ENVIO_NACIONAL,
  NIVELES, PRESENTACIONES, REGALOS, PULGADAS, NEGOCIO, PREGUNTAS, PAYPAL, TASAS_RESPALDO, AGENDA, Calculo: window.Calculo,
};
`;
writeFileSync(join(raiz, "servidor", "catalogo.generado.js"), salida);
// 2) Revisión de precios: si algo está mal escrito, la publicación se detiene y sigue en línea la versión anterior
const { Tienda: T } = await import(`./catalogo.generado.js?t=${Date.now()}`);
const fallas = [];
const revisar = (v, donde) => { if (!Number.isFinite(v) || v < 100 || v > 5000000) fallas.push(`${donde} = ${v} (¿escribiste el precio con punto? Escribe 4000, no 4.000)`); };
const bajaOIgual = (lista, donde) => { for (let i = 1; i < lista.length; i++) if (lista[i] > lista[i - 1]) fallas.push(`${donde}: el precio sube en vez de bajar con la cantidad (${lista.join(" → ")})`); };
for (const p of T.PRODUCTOS) {
  if (p.sinPrecio) { fallas.push(`${p.id}: no tiene precio en js/precios.js`); continue; }
  if (p.tipo === "espuela") { const v = T.NIVELES.map((n) => p.precios[n.id]); v.forEach((x, i) => revisar(x, `${p.id} → ${T.NIVELES[i].id}`)); bajaOIgual(v, p.id); }
  else if (p.tipo === "patapioja") { p.tramos.forEach((t) => revisar(t.precio, `${p.id} desde ${t.desde}`)); bajaOIgual(p.tramos.map((t) => t.precio), p.id); }
  else for (const v of p.variantes || []) {
    if (p.tipo === "unidad-docena") { revisar(v.unidad, `${p.id} → ${v.id} (unidad)`); revisar(v.docena, `${p.id} → ${v.id} (docena)`); if (v.docena < v.unidad) fallas.push(`${p.id} → ${v.id}: la docena vale menos que una unidad`); }
    else revisar(v.precio, `${p.id} → ${v.id}`);
  }
}
for (const [k, v] of Object.entries(T.AJUSTE_EMPAQUE)) if (!Number.isFinite(v) || Math.abs(v) > 100000) fallas.push(`AJUSTE_EMPAQUE.${k} = ${v}`);
if (!(T.CONTRAENTREGA_MINIMO > 0)) fallas.push(`CONTRAENTREGA_MINIMO = ${T.CONTRAENTREGA_MINIMO}`);
if (fallas.length) { console.error("PRECIOS CON ERRORES, NO SE PUBLICA:\n- " + fallas.join("\n- ")); process.exit(1); }
console.log(`catalogo.generado.js listo: ${necesarios.length} archivos, ${T.PRODUCTOS.length} productos, precios revisados`);
