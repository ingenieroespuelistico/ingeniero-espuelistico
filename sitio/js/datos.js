// Datos del negocio. Los PRECIOS no van aquí: se cambian en js/precios.js.
const NEGOCIO = {
  marca: "Ingeniero Espuelístico",
  whatsapp: "573019580737",
  telefonoVisible: "+57 301 958 0737",
  horario: "Lun a vie 8:00 a.m. – 7:00 p.m. · Sáb 8:00 a.m. – 2:00 p.m.",
  tiktok: "https://www.tiktok.com/@ingeniero_espuelistico",
  facebook: "https://www.facebook.com/share/1Ff8Y8L43E/",
  contraentregaMinimo: CONTRAENTREGA_MINIMO,
  correo: "ingenieroespuelistico@gmail.com",
  // Dirección pública de la página. Cuando compres el dominio, cámbiala aquí (por ejemplo "https://ingenieroespuelistico.com")
  sitio: "https://ingeniero-espuelistico.ingenieroespuelistico.workers.dev",
  direccion: { calle: "Transversal 11 Sur # 13-65, casa 28", ciudad: "Ibagué", departamento: "Tolima", pais: "CO" },
  // Clave pública de Cloudflare Turnstile (protección contra robots). Vacío = desactivado.
  turnstile: "",
};

// Niveles de precio de espuelas: se calculan con el total de pares de espuela del pedido.
const NIVELES = [
  { id: "minorista", nombre: "Minorista", desde: 1 },
  { id: "mayorista", nombre: "Mayorista", desde: 120 },
  { id: "distribuidor", nombre: "Distribuidor", desde: 500 },
  { id: "gran_distribuidor", nombre: "Gran distribuidor", desde: 1200 },
];

const PRESENTACIONES = [
  { id: "bolsa", nombre: "En bolsa", ajuste: AJUSTE_EMPAQUE.bolsa, nota: "Forrada con plástico removible" },
  { id: "caja", nombre: "En caja", ajuste: AJUSTE_EMPAQUE.caja, nota: "Forrada con plástico removible" },
  { id: "granel", nombre: "A granel", ajuste: AJUSTE_EMPAQUE.granel, nota: "Sin plástico ni empaque" },
];

const PULGADAS = { 30: "1.2", 35: "1.4", 38: "1.5", 40: "1.6", 42: "1.7", 43: "1.7" };

// Regalo en pares de patapioja sintética según pares de espuela
const REGALOS = [
  { desde: 50, pares: 6 },
  { desde: 100, pares: 12 },
  { desde: 200, pares: 18 },
  { desde: 500, pares: 36 },
  { desde: 1000, pares: 50 },
];

// Los productos están en js/productos/ (un archivo por producto, en el orden de su número).
const PRODUCTOS = window.CATALOGO || [];

const ENVIOS_INTERNACIONALES = {
  "Panamá": { tipo: "formula" },
  "Costa Rica": { tipo: "formula" },
  "Ecuador": { tipo: "rango", texto: ENVIO_INTERNACIONAL_USD.ecuador },
};

// Descripción y dureza de cada producto (vienen dentro de cada archivo de js/productos/).
const FICHAS = Object.fromEntries(PRODUCTOS.map((p) => [p.id, { descripcion: p.descripcion || "", dureza: p.dureza || "—" }]));
