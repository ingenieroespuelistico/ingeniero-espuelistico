// Datos del negocio y catálogo. Para cambiar un precio, edita solo este archivo.
const NEGOCIO = {
  marca: "Ingeniero Espuelístico",
  whatsapp: "573019580737",
  telefonoVisible: "+57 301 958 0737",
  horario: "Lun a vie 8:00 a.m. – 7:00 p.m. · Sáb 8:00 a.m. – 2:00 p.m.",
  tiktok: "https://www.tiktok.com/@ingeniero_espuelistico",
  facebook: "https://www.facebook.com/share/1Ff8Y8L43E/",
  contraentregaMinimo: 45000,
  correo: "ingenieroespuelistico@gmail.com",
};

// Niveles de precio de espuelas: se calculan con el total de pares de espuela del pedido.
const NIVELES = [
  { id: "minorista", nombre: "Minorista", desde: 1 },
  { id: "mayorista", nombre: "Mayorista", desde: 120 },
  { id: "distribuidor", nombre: "Distribuidor", desde: 500 },
  { id: "gran_distribuidor", nombre: "Gran distribuidor", desde: 1200 },
];

const PRESENTACIONES = [
  { id: "bolsa", nombre: "En bolsa", ajuste: 0, nota: "Forrada con plástico removible" },
  { id: "caja", nombre: "En caja", ajuste: 300, nota: "Forrada con plástico removible" },
  { id: "granel", nombre: "A granel", ajuste: -200, nota: "Sin plástico ni empaque" },
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
  "Ecuador": { tipo: "rango", texto: "USD 40 a 50" },
};

// Descripción y dureza de cada producto (vienen dentro de cada archivo de js/productos/).
const FICHAS = Object.fromEntries(PRODUCTOS.map((p) => [p.id, { descripcion: p.descripcion || "", dureza: p.dureza || "—" }]));
