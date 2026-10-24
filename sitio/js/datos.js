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
  titular: "Brayner Alexander Jiménez Muñoz",   // persona natural responsable de la tienda (sale en los correos y páginas legales)
  documentoTitular: "C.C. 1.104.938.233",
  // Dirección pública de la página. Cuando compres el dominio, cámbiala aquí (por ejemplo "https://ingenieroespuelistico.com")
  sitio: "https://ingeniero-espuelistico.ingenieroespuelistico.workers.dev",
  direccion: { calle: "Transversal 11 Sur # 13-65, casa 28", ciudad: "Ibagué", departamento: "Tolima", pais: "CO" },
  // Clave pública de Cloudflare Turnstile (protección contra robots). Vacío = desactivado.
  turnstile: "0x4AAAAAAFjO18VrFJBssEiL",
  // Países a los que NO se envía (sus leyes prohíben o restringen importar espuelas y accesorios para gallos).
  // Si el cliente elige uno de estos en el pedido, se le muestra el aviso y no se deja confirmar.
  paisesSinEnvio: { US: "Estados Unidos", PR: "Puerto Rico", GU: "Guam", VI: "Islas Vírgenes de EE. UU.", AS: "Samoa Americana", MP: "Islas Marianas del Norte", UM: "Islas menores de EE. UU.", CA: "Canadá" },
};

// Agenda de llamadas (hora de Colombia). Domingos y festivos no se agenda.
// Si conectas Google Calendar, cada llamada ocupa "duracionMinutos" en tu calendario y las horas ocupadas no se ofrecen.
const AGENDA = {
  duracionMinutos: 15,              // cada llamada (también es el intervalo entre horas disponibles)
  anticipacionMinutos: 60,          // no se puede agendar para dentro de menos tiempo que esto
  diasAMostrar: 10,
  lunesAViernes: ["08:00", "15:00"],
  sabado: ["08:00", "14:00"],
  descanso: ["12:00", "13:30"],     // no se agenda en este rato
  // Festivos de Colombia (actualizar cada año)
  festivos: [
    "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18", "2026-06-08",
    "2026-06-15", "2026-06-29", "2026-07-13", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02",
    "2026-11-16", "2026-12-08", "2026-12-25",
    "2027-01-01", "2027-01-11", "2027-03-22", "2027-03-25", "2027-03-26", "2027-05-01", "2027-05-10", "2027-05-31",
    "2027-06-07", "2027-07-05", "2027-07-12", "2027-07-20", "2027-08-07", "2027-08-16", "2027-10-18", "2027-11-01",
    "2027-11-15", "2027-12-08", "2027-12-25",
  ],
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
