// Genera, a partir de los mismos datos de la tienda (sitio/js/...):
//   • sitio/productos/<producto>.html   una página por producto, para Google (SEO)
//   • sitio/js/fotos-lista.js           lista de fotos (la página ya no "adivina" fotos que no existen)
//   • sitio/sitemap.xml, robots.txt, llms.txt
//   • datos estructurados (JSON-LD), enlace canónico y enlaces a productos dentro de sitio/index.html
// Se ejecuta solo en cada publicación (ver "build" en wrangler.jsonc). No edites los archivos generados.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Tienda } from "./catalogo.generado.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sitio = join(raiz, "sitio");
const N = Tienda.NEGOCIO;
const URL_BASE = String(N.sitio || "").replace(/\/+$/, "");
const C = Tienda.Calculo;
const hoy = new Date().toISOString().slice(0, 10);
import { execSync } from "node:child_process";
// Fecha del último cambio real de cada página (según GitHub); si no se puede saber, la de hoy
function fechaDe(...rutas) {
  try {
    const f = execSync(`git log -1 --format=%cs -- ${rutas.map((r) => JSON.stringify(r)).join(" ")}`, { cwd: raiz, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return f || hoy;
  } catch { return hoy; }
}

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const pesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");
const slug = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const urlProducto = (p) => `/productos/${p.slug || slug(p.nombre)}`;
const absoluta = (ruta) => URL_BASE + (ruta.startsWith("/") ? ruta : "/" + ruta);

/* ---------- 1. Fotos ---------- */
const FOTOS = {};
const dirFotos = join(sitio, "fotos");
for (const carpeta of readdirSync(dirFotos)) {
  const d = join(dirFotos, carpeta);
  if (!statSync(d).isDirectory()) continue;
  const archivos = readdirSync(d).filter((f) => /^\d+\.(jpe?g|png|webp)$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  // Solo números seguidos (1, 2, 3...), como funcionaba antes
  const lista = [];
  for (let n = 1; ; n++) { const f = archivos.find((x) => parseInt(x) === n); if (!f) break; lista.push(`fotos/${carpeta}/${f}`); }
  if (lista.length) FOTOS[carpeta] = lista;
}
writeFileSync(join(sitio, "js", "fotos-lista.js"),
  `// ARCHIVO GENERADO al publicar: lista de fotos que hay en la carpeta fotos/. No lo edites.\nwindow.FOTOS = ${JSON.stringify(FOTOS, null, 1)};\n`);

/* ---------- 2. Precios para mostrar ---------- */
// Precio de detal: lo que paga quien compra poco (es el que se muestra y el que va a Google)
function precioDetal(p) {
  if (p.tipo === "espuela") return p.precios[Tienda.NIVELES[0].id];
  if (p.tipo === "patapioja") return p.tramos[0].precio;
  if (p.tipo === "unidad-docena") return Math.min(...p.variantes.map((v) => v.unidad));
  return Math.min(...p.variantes.map((v) => v.precio));
}
function textoMayor(p) {
  if (p.tipo === "espuela") { const m = Tienda.NIVELES[1]; return `por mayor desde ${pesos(p.precios[m.id])} (${m.desde}+ pares)`; }
  if (p.tipo === "patapioja") { const t = p.tramos.find((x) => x.desde >= 12) || p.tramos[0]; return `docena a ${pesos(t.precio * 12)}`; }
  if (p.tipo === "unidad-docena") return `docena desde ${pesos(Math.min(...p.variantes.map((v) => v.docena)))}`;
  return "";
}
const propio = (p) => p.tipo !== "variantes"; // el esparadrapo es de reventa
function rangoPrecio(p) {
  if (p.tipo === "espuela") {
    const valores = Object.values(p.precios), ajustes = Object.values(Tienda.AJUSTE_EMPAQUE);
    return [Math.min(...valores) + Math.min(...ajustes), Math.max(...valores) + Math.max(...ajustes)];
  }
  if (p.tipo === "patapioja") { const v = p.tramos.map((t) => t.precio); return [Math.min(...v), Math.max(...v)]; }
  if (p.tipo === "unidad-docena") return [Math.min(...p.variantes.map((v) => v.docena / 12)), Math.max(...p.variantes.map((v) => v.unidad))];
  const v = p.variantes.map((x) => x.precio); return [Math.min(...v), Math.max(...v)];
}
const unidadDe = (p) => (p.tipo === "espuela" || p.tipo === "patapioja" || p.unidad === "par" ? "el par" : p.unidad === "barra" ? "la barra" : "");
function nivelesTexto(i) {
  const n = Tienda.NIVELES, sig = n[i + 1];
  return sig ? `${n[i].desde.toLocaleString("es-CO")} a ${(sig.desde - 1).toLocaleString("es-CO")} pares` : `${n[i].desde.toLocaleString("es-CO")} pares o más`;
}
function tablaPrecios(p) {
  if (p.tipo === "espuela") {
    const filas = Tienda.NIVELES.map((n, i) => `<tr><th scope="row">${esc(n.nombre)}<small>${nivelesTexto(i)}</small></th><td>${pesos(p.precios[n.id])}</td></tr>`).join("");
    const aj = Tienda.AJUSTE_EMPAQUE;
    return `<table class="pp-tabla"><caption>Precio por par en bolsa, según el total de pares de espuela del pedido (puedes mezclar referencias)</caption>
      <thead><tr><th scope="col">Nivel</th><th scope="col">Precio por par</th></tr></thead><tbody>${filas}</tbody></table>
      <p class="pp-nota">En caja suma ${pesos(aj.caja)} por par. A granel resta ${pesos(Math.abs(aj.granel))} por par.</p>`;
  }
  if (p.tipo === "patapioja") {
    const t = p.tramos;
    const filas = t.map((x, i) => `<tr><th scope="row">${x.desde.toLocaleString("es-CO")}${t[i + 1] ? ` a ${(t[i + 1].desde - 1).toLocaleString("es-CO")}` : " o más"} pares</th><td>${pesos(x.precio)}</td></tr>`).join("");
    return `<table class="pp-tabla"><caption>Precio por par según la cantidad</caption><thead><tr><th scope="col">Cantidad</th><th scope="col">Precio por par</th></tr></thead><tbody>${filas}</tbody></table>`;
  }
  if (p.tipo === "unidad-docena") {
    const u = p.unidad === "barra" ? "barra" : "par";
    const filas = p.variantes.map((v) => `<tr><th scope="row">${esc(v.nombre)}</th><td>${pesos(v.unidad)}</td><td>${pesos(v.docena)}</td></tr>`).join("");
    return `<table class="pp-tabla"><caption>Precio por ${u} y por docena</caption><thead><tr><th scope="col">Opción</th><th scope="col">Por ${u}</th><th scope="col">Docena</th></tr></thead><tbody>${filas}</tbody></table>`;
  }
  const filas = p.variantes.map((v) => `<tr><th scope="row">${esc(v.nombre)}${v.nota ? `<small>${esc(v.nota)}</small>` : ""}</th><td>${pesos(v.precio)}</td></tr>`).join("");
  return `<table class="pp-tabla"><caption>${esc(p.etiquetaVariante || "Opciones")} y precio</caption><thead><tr><th scope="col">${esc(p.etiquetaVariante || "Opción")}</th><th scope="col">Precio</th></tr></thead><tbody>${filas}</tbody></table>`;
}
function datosTecnicos(p) {
  const filas = [];
  if (p.medidas) filas.push(["Medidas", p.medidas.map((m) => `${m} líneas (${Tienda.PULGADAS[m]}")`).join(", ")]);
  if (p.colores) filas.push(["Colores", p.colores.map((c) => `${c.nombre} (${c.nota})`).join(", ")]);
  if (p.pesoPar) filas.push(["Peso aproximado", `${String(p.pesoPar).replace(".", ",")} g por par`]);
  if (p.variantes && p.tipo !== "patapioja") filas.push(["Peso aproximado", p.variantes.map((v) => `${esc(v.nombre)}: ${v.peso} g`).join(" · ")]);
  if (p.dureza && p.dureza !== "—") filas.push(["Dureza", p.dureza]);
  if (p.tipo === "espuela") filas.push(["Presentación", Tienda.PRESENTACIONES.map((x) => `${x.nombre.toLowerCase()} (${x.nota.toLowerCase()})`).join(", ")]);
  filas.push([propio(p) ? "Fabricación" : "Origen", propio(p) ? "Taller propio en Ibagué, Colombia" : "Producto seleccionado por nosotros (no es de fabricación propia)"]);
  return `<dl class="pp-datos">${filas.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${b}</dd></div>`).join("")}</dl>`;
}

/* ---------- 3. Partes comunes ---------- */
const FUENTE = `<link rel="preload" href="/fuentes/archivo.woff2" as="font" type="font/woff2" crossorigin>`;
const CABECERA = `<header class="cabecera">
  <div class="contenedor cabecera__fila">
    <a class="marca" href="/"><span class="marca__nombre">Ingeniero<br>Espuelístico</span></a>
    <nav class="pp-nav" aria-label="Principal"><a href="/#catalogo">Catálogo</a><a href="/#precios">Precios</a><a href="/#preguntas">Preguntas</a></nav>
  </div>
</header>`;
function enlacesProductos(actual) {
  return Tienda.PRODUCTOS.filter((p) => !p.sinPrecio).map((p) => p.id === actual ? "" :
    `<li><a href="${urlProducto(p)}">${esc(p.nombre)}</a></li>`).join("");
}
const CREDITO = `<p class="pie__credito">Página hecha por <strong>DSCH Marketing</strong> en convenio con Ingeniero Espuelístico. Si desea que impulsemos su negocio, escriba al Ingeniero Espuelístico y con gusto lo redirigirán a nosotros.</p>`;
function pie() {
  return `<footer class="pie">
  <div class="contenedor pie__rejilla">
    <div>
      <p class="pie__marca">Ingeniero Espuelístico</p>
      <p>Fábrica de espuelas para gallos en ${esc(N.direccion.ciudad)}, ${esc(N.direccion.departamento)}, Colombia.</p>
      <p><a href="https://wa.me/${N.whatsapp}" target="_blank" rel="noopener">WhatsApp ${esc(N.telefonoVisible)}</a></p>
    </div>
    <div><p class="pie__titulo">Productos</p><ul class="pie__lista">${enlacesProductos()}</ul></div>
    <div>
      <p><a href="/devoluciones">Cambios y devoluciones</a></p>
      <p><a href="/terminos">Términos y condiciones</a></p>
      <p><a href="/privacidad">Privacidad y cookies</a></p>
    </div>
  </div>
  <div class="contenedor">${CREDITO}</div>
</footer>`;
}

/* ---------- 4. Página de cada producto ---------- */
const directorio = join(sitio, "productos");
if (existsSync(directorio)) rmSync(directorio, { recursive: true });
mkdirSync(directorio);
const PREGUNTAS_PRODUCTO = Tienda.PREGUNTAS.filter((q) => /líneas|precio por cantidad|envíos contraentrega|despachan|otros países/i.test(q.pregunta)).slice(0, 4);

const productos = Tienda.PRODUCTOS.filter((p) => !p.sinPrecio);
for (const p of productos) {
  const ruta = urlProducto(p);
  const fotos = FOTOS[p.id] || [];
  const [bajo, alto] = rangoPrecio(p);
  const detal = precioDetal(p), mayor = textoMayor(p);
  const tituloSEO = p.tipo === "espuela" ? `${p.nombre} para gallo` : p.nombre;
  const titulo = (`${tituloSEO} | Ingeniero Espuelístico`.length <= 60 ? `${tituloSEO} | Ingeniero Espuelístico` : `${tituloSEO} | Ing. Espuelístico`);
  const u = unidadDe(p) ? " " + unidadDe(p) : "";
  const detalle = p.detalle.charAt(0).toLowerCase() + p.detalle.slice(1).replace(/\.$/, "");
  const descripcion = `${p.nombre}, ${detalle}. ${pesos(detal)}${u}${mayor ? `; ${mayor}` : ""}. ${propio(p) ? "Fábrica en Ibagué" : "Desde Ibagué"}, envíos a toda Colombia.`.replace(/\s+/g, " ");
  const imagenes = fotos.map((f) => absoluta("/" + f));
  const datosProducto = {
    "@context": "https://schema.org", "@type": "Product",
    name: p.nombre, description: p.descripcion, sku: p.id, category: p.tipo === "espuela" ? "Espuelas para gallos" : "Accesorios para gallos",
    ...(propio(p) ? { brand: { "@type": "Brand", name: "Ingeniero Espuelístico" } } : {}),
    ...(imagenes.length ? { image: imagenes } : {}),
    offers: {
      "@type": "Offer", priceCurrency: "COP", price: Math.round(detal), itemCondition: "https://schema.org/NewCondition",
      availability: "https://schema.org/InStock", url: absoluta(ruta),
      seller: { "@type": "Organization", name: "Ingeniero Espuelístico" },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy", applicableCountry: "CO", returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 5, returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
      },
      shippingDetails: {
        "@type": "OfferShippingDetails", shippingDestination: { "@type": "DefinedRegion", addressCountry: "CO" },
        deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" }, transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 5, unitCode: "DAY" } },
      },
    },
  };
  const migas = {
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: absoluta("/") },
      { "@type": "ListItem", position: 2, name: "Catálogo", item: absoluta("/#catalogo") },
      { "@type": "ListItem", position: 3, name: p.nombre, item: absoluta(ruta) },
    ],
  };
  const galeria = fotos.length
    ? `<div class="pp-galeria">${fotos.map((f, i) => `<img src="/${f}" alt="${esc(p.nombre)}, foto ${i + 1} de ${fotos.length}" width="600" height="600" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>`).join("")}</div>`
    : `<div class="pp-galeria pp-galeria--vacia"><p>¿Quieres ver fotos o un video de este producto? Te los enviamos por WhatsApp.</p></div>`;
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="only light">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${absoluta(ruta)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(tituloSEO)} · Ingeniero Espuelístico">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${absoluta(ruta)}">
${imagenes[0] ? `<meta property="og:image" content="${imagenes[0]}">` : ""}
<meta property="og:locale" content="es_CO">
<link rel="icon" href="/icono.svg" type="image/svg+xml">
${FUENTE}
<link rel="stylesheet" href="/css/estilos.css?v=13">
<link rel="stylesheet" href="/css/secciones.css?v=13">
${ld(datosProducto)}
${ld(migas)}
</head>
<body class="pagina-producto">
${CABECERA}
<main class="contenedor pp">
  <nav class="pp-migas" aria-label="Ruta"><a href="/">Inicio</a> › <a href="/#catalogo">Catálogo</a> › <span aria-current="page">${esc(p.nombre)}</span></nav>
  <div class="pp-rejilla">
    ${galeria}
    <div class="pp-info">
      <h1>${esc(tituloSEO)}</h1>
      <p class="pp-detalle">${esc(p.detalle)}</p>
      <p class="pp-desde"><strong>${pesos(detal)}</strong>${u}${mayor ? `<small>${esc(mayor.charAt(0).toUpperCase() + mayor.slice(1))}</small>` : ""}</p>
      <div class="pp-acciones">
        <a class="boton boton--azul" href="/?producto=${encodeURIComponent(p.id)}#catalogo">Comprar en la tienda</a>
        <a class="boton boton--verde-borde" href="https://wa.me/${N.whatsapp}?text=${encodeURIComponent(`Hola, quiero información de: ${p.nombre}`)}" target="_blank" rel="noopener">Preguntar por WhatsApp</a>
      </div>
      <p class="pp-confianza">Pago seguro con Mercado Pago (PSE, tarjeta, Efecty) o contraentrega en Colombia · Despacho el mismo día si pagas antes de las 4:00 p.m.</p>
    </div>
  </div>

  <section class="pp-seccion"><h2>Descripción</h2><p>${esc(p.descripcion)}</p>${datosTecnicos(p)}</section>
  <section class="pp-seccion"><h2>Precios</h2>${tablaPrecios(p)}</section>
  <section class="pp-seccion"><h2>Envíos y pagos</h2>
    <p>Enviamos desde Ibagué a toda Colombia con Interrapidísimo; el valor se calcula en la tienda según tu municipio y el peso del paquete. También exportamos a Ecuador, Perú, Panamá, Costa Rica y otros países (no enviamos a Estados Unidos, sus territorios ni Canadá, por restricciones de importación).</p>
  </section>
  ${PREGUNTAS_PRODUCTO.length ? `<section class="pp-seccion"><h2>Preguntas frecuentes</h2>${PREGUNTAS_PRODUCTO.map((q) => `<details class="pregunta"><summary>${esc(q.pregunta)}</summary><p>${esc(q.respuesta)}</p></details>`).join("")}</section>` : ""}
  <section class="pp-seccion"><h2>Otros productos</h2><ul class="pp-relacionados">${enlacesProductos(p.id)}</ul></section>
</main>
${pie()}
<script src="/js/medicion.js?v=13" defer></script>
</body>
</html>
`;
  writeFileSync(join(directorio, `${(p.slug || slug(p.nombre))}.html`), html);
}

/* ---------- 5. index.html: datos estructurados, canónico y enlaces ---------- */
const DIAS = { "Lun a vie": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "Sáb": ["Saturday"] };
const tienda = {
  "@context": "https://schema.org", "@type": "Store", "@id": absoluta("/#tienda"),
  name: "Ingeniero Espuelístico", url: absoluta("/"),
  description: "Fábrica de espuelas para gallos (acrílicas, negras reforzadas y enterizas), patapiojas sintéticas y metálicas, cera y esparadrapo. Venta al detal y por mayor desde Ibagué, Colombia, con envíos nacionales y exportación.",
  telephone: N.telefonoVisible.replace(/\s/g, ""), email: N.correo,
  image: (FOTOS.acrilica || []).map((f) => absoluta("/" + f)).slice(0, 1).concat(absoluta("/icono-512.png")),
  logo: absoluta("/icono-512.png"),
  address: { "@type": "PostalAddress", streetAddress: N.direccion.calle, addressLocality: N.direccion.ciudad, addressRegion: N.direccion.departamento, addressCountry: N.direccion.pais },
  openingHoursSpecification: [
    { "@type": "OpeningHoursSpecification", dayOfWeek: DIAS["Lun a vie"], opens: "08:00", closes: "19:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: DIAS["Sáb"], opens: "08:00", closes: "14:00" },
  ],
  areaServed: ["Colombia", "Ecuador", "Perú", "Panamá", "Costa Rica"].map((n) => ({ "@type": "Country", name: n })),
  sameAs: [N.tiktok, N.facebook].filter(Boolean),
  priceRange: "$",
  hasMerchantReturnPolicy: {
    "@type": "MerchantReturnPolicy", applicableCountry: "CO", returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: 5, returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
  },
  currenciesAccepted: "COP",
  paymentAccepted: "PSE, tarjeta de crédito, tarjeta débito, Efecty, contraentrega, PayPal, Western Union",
  hasOfferCatalog: {
    "@type": "OfferCatalog", name: "Catálogo",
    itemListElement: productos.map((p) => ({ "@type": "Offer", url: absoluta(urlProducto(p)), itemOffered: { "@type": "Product", name: p.nombre } })),
  },
};
const web = { "@context": "https://schema.org", "@type": "WebSite", name: "Ingeniero Espuelístico", url: absoluta("/"), inLanguage: "es-CO" };
const faq = {
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: Tienda.PREGUNTAS.map((q) => ({ "@type": "Question", name: q.pregunta, acceptedAnswer: { "@type": "Answer", text: q.respuesta } })),
};
const rutaIndex = join(sitio, "index.html");
let index = readFileSync(rutaIndex, "utf8");
const reemplazar = (marca, contenido) => {
  const re = new RegExp(`(<!-- ${marca}:inicio -->)[\\s\\S]*?(<!-- ${marca}:fin -->)`);
  if (!re.test(index)) throw new Error(`Falta la marca ${marca} en index.html`);
  index = index.replace(re, (_, inicio, fin) => `${inicio}\n${contenido}\n${fin}`); // función: evita que "$2" de un precio se tome como patrón
};
reemplazar("seo", [
  `<link rel="canonical" href="${absoluta("/")}">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:title" content="Ingeniero Espuelístico · Espuelas para gallos de fábrica">`,
  `<meta property="og:description" content="Fábrica de espuelas para gallos en Ibagué, Colombia. Precios por mayor y detal, envíos a toda Colombia y exportación.">`,
  `<meta property="og:url" content="${absoluta("/")}">`,
  FOTOS.acrilica ? `<meta property="og:image" content="${absoluta("/" + FOTOS.acrilica[0])}">` : "",
  `<meta property="og:locale" content="es_CO">`,
  ld(tienda), ld(web), ld(faq),
].filter(Boolean).join("\n"));
reemplazar("enlaces-productos", `<ul class="pie__lista">${enlacesProductos()}</ul>`);
reemplazar("catalogo", productos.map((p) => {
  const f = (FOTOS[p.id] || [])[0], u = unidadDe(p), m = textoMayor(p);
  return `<article class="producto flotante" data-producto="${p.id}">
  <div class="producto__foto">${f ? `<img src="${f}" alt="${esc(p.nombre)}" loading="lazy" decoding="async" width="600" height="600">` : ""}</div>
  <div class="producto__info"><h3>${esc(p.nombre)}</h3><p class="producto__detalle">${esc(p.detalle)}</p>
  <p class="producto__precio"><strong>${pesos(precioDetal(p))}</strong>${u ? " " + u : ""}${m ? `<small class="producto__mayor">${esc(m.charAt(0).toUpperCase() + m.slice(1))}</small>` : ""}</p>
  <a class="producto__enlace" href="${urlProducto(p)}">Ficha completa del producto</a></div>
</article>`;
}).join("\n"));
writeFileSync(rutaIndex, index);

/* ---------- 5b. Canónico de las páginas legales (siguen la dirección de NEGOCIO.sitio) ---------- */
for (const n of ["privacidad", "terminos", "devoluciones"]) {
  const r = join(sitio, `${n}.html`);
  writeFileSync(r, readFileSync(r, "utf8").replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${absoluta("/" + n)}">`));
}

/* ---------- 6. sitemap.xml, robots.txt, llms.txt ---------- */
const paginas = ["/", ...productos.map(urlProducto), "/devoluciones", "/terminos", "/privacidad"];
const fechaPagina = { "/": fechaDe("sitio/index.html", "sitio/js/precios.js"), "/devoluciones": fechaDe("sitio/devoluciones.html"), "/terminos": fechaDe("sitio/terminos.html"), "/privacidad": fechaDe("sitio/privacidad.html") };
for (const p of productos) fechaPagina[urlProducto(p)] = fechaDe("sitio/js/precios.js", "sitio/js/productos", `sitio/fotos/${p.id}`);
writeFileSync(join(sitio, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paginas.map((r) => `  <url><loc>${absoluta(r)}</loc><lastmod>${fechaPagina[r] || hoy}</lastmod></url>`).join("\n")}
</urlset>
`);
writeFileSync(join(sitio, "robots.txt"), `User-agent: *
Allow: /
Disallow: /api/
Disallow: /gracias
Disallow: /admin/

Sitemap: ${absoluta("/sitemap.xml")}
`);
writeFileSync(join(sitio, "llms.txt"), `# Ingeniero Espuelístico

> Fábrica de espuelas para gallos y accesorios en Ibagué, Tolima, Colombia. Más de 25 años de tradición familiar. Venta al detal y por mayor, envíos a toda Colombia y exportación a Ecuador, Perú, Panamá y Costa Rica. No se envía a Estados Unidos, sus territorios ni Canadá.

- Tienda: ${absoluta("/")}
- WhatsApp: ${N.telefonoVisible}
- Horario: ${N.horario}
- Pagos: Mercado Pago (PSE, tarjeta, Efecty), contraentrega en Colombia; PayPal o Western Union desde el exterior.

## Productos
${productos.map((p) => { const u = unidadDe(p); const m = textoMayor(p); return `- [${p.nombre}](${absoluta(urlProducto(p))}): ${p.detalle.replace(/\.$/, "")}. ${pesos(precioDetal(p))}${u ? " " + u : ""} al detal${m ? `; ${m}` : ""}.`; }).join("\n")}

## Precios de espuelas por cantidad (precio por par en bolsa; se suman todas las referencias del pedido)
${Tienda.NIVELES.map((n, i) => `- ${n.nombre}: desde ${n.desde} pares`).join("\n")}
- En caja: ${pesos(Tienda.AJUSTE_EMPAQUE.caja)} más por par. A granel: ${pesos(Math.abs(Tienda.AJUSTE_EMPAQUE.granel))} menos por par.

## Envíos
- Colombia: con Interrapidísimo; el valor se calcula en la tienda según municipio y peso. Contraentrega desde ${pesos(Tienda.CONTRAENTREGA_MINIMO)} (el envío se paga por adelantado).
- Despacho el mismo día si se paga antes de las 4:00 p.m. (sábados antes de las 10:00 a.m.).

## Políticas
- [Cambios y devoluciones](${absoluta("/devoluciones")})
- [Términos y condiciones](${absoluta("/terminos")})
- [Privacidad](${absoluta("/privacidad")})
`);
console.log(`Páginas generadas: ${productos.length} productos, ${Object.keys(FOTOS).length} carpetas con fotos, sitemap con ${paginas.length} direcciones.`);
