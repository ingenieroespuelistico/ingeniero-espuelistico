// =====================================================================================
//  PRECIOS DE LA TIENDA — este es el ÚNICO archivo que tienes que editar para cambiar precios.
//
//  • Todos los valores están en PESOS COLOMBIANOS (COP), sin puntos ni signo $: 4000, no $4.000.
//  • Los dólares, colones, soles, etc. NO se escriben aquí: la página los calcula sola
//    con la tasa de cambio del día (ver TASAS_RESPALDO al final).
//  • Para decimales usa punto: 1333.33
//  • Después de guardar, recarga la página (Ctrl + F5) y revisa el catálogo y la tabla de precios.
//  • Si algo se ve en blanco o dice "Sin precio", revisa que no se haya borrado una coma o una llave.
// =====================================================================================

const PRECIOS = {

  /* ---------- ESPUELAS: precio por par EN BOLSA según el total de pares del pedido ---------- */
  //                 1 a 119 pares   120 a 499          500 a 1.199          1.200 o más
  "acrilica":        { minorista: 4000, mayorista: 3700, distribuidor: 3350, gran_distribuidor: 3100 }, // Espuela acrílica amarilla
  "negra-casquillo": { minorista: 4000, mayorista: 3700, distribuidor: 3350, gran_distribuidor: 3100 }, // Espuela negra reforzada
  "blanca-enteriza": { minorista: 3800, mayorista: 3600, distribuidor: 3300, gran_distribuidor: 3000 }, // Espuela blanca enteriza
  "negra-enteriza":  { minorista: 3800, mayorista: 3600, distribuidor: 3300, gran_distribuidor: 3000 }, // Espuela negra enteriza

  /* ---------- PATAPIOJA SINTÉTICA: precio por PAR desde cierta cantidad de pares ---------- */
  "patapioja": [
    { desde: 1,   precio: 2000 },
    { desde: 12,  precio: 1500 },     // docena a 18.000
    { desde: 72,  precio: 1333.33 },  // desde 6 docenas, la docena a 16.000
    { desde: 100, precio: 1300 },
  ],

  /* ---------- PRODUCTOS POR UNIDAD O POR DOCENA ---------- */
  "cera": {                           // Cera amarilla en barra (precio por barra y por docena de barras)
    delgada: { unidad: 6500, docena: 50000 },
    gruesa:  { unidad: 8000, docena: 60000 },
  },
  "metalica": {                       // Patapioja metálica (precio por par y por docena de pares)
    estandar: { unidad: 4500, docena: 35000 },
    torneo:   { unidad: 4500, docena: 35000 },   // se muestra como "Pequeña" (el nombre interno sigue siendo torneo)
    realce:   { unidad: 6000, docena: 45000 },
  },

  /* ---------- PRODUCTOS CON UN PRECIO POR OPCIÓN ---------- */
  "esparadrapo": {                    // rollos de 10 yardas
    "1": 16000,                       // 1 pulgada
    "2": 28000,                       // 2 pulgadas
    "3": 35000,                       // 3 pulgadas
    "4": 44000,                       // 4 pulgadas
    "tubo": 95000,                    // tubo surtido de 12 pulgadas
  },
};

/* ---------- AJUSTES DE EMPAQUE para espuelas (se suman o restan al precio en bolsa) ---------- */
const AJUSTE_EMPAQUE = { bolsa: 0, caja: 300, granel: -200 };

/* ---------- CONTRAENTREGA: compra mínima en pesos para habilitarla ---------- */
const CONTRAENTREGA_MINIMO = 45000;

/* ---------- ENVÍO INTERNACIONAL (esta parte sí va en DÓLARES) ---------- */
// Panamá y Costa Rica: base + valor por cada medio kilo adicional después del primer kilo.
// paisesConTarifa: países donde se usa esa fórmula (códigos de 2 letras). A esos se les puede cobrar por PayPal
// directamente en la página; a los demás se les cotiza por WhatsApp.
const ENVIO_INTERNACIONAL_USD = { base: 25, porMedioKiloExtra: 6, ecuador: "USD 40 a 50", paisesConTarifa: ["PA", "CR"] };

/* ---------- PAYPAL (pagos desde otros países, se cobra en DÓLARES) ---------- */
// activo: true cuando ya estén guardadas las claves de PayPal en Cloudflare (PAYPAL_CLIENT_ID y PAYPAL_SECRET).
// Los precios en pesos se pasan a dólares con la tasa del día.
// recargoPorcentaje: porcentaje que se suma al precio en dólares para cubrir la comisión de PayPal y el cambio
// de moneda (por ejemplo 5). 0 = no se suma nada.
const PAYPAL = { activo: false, recargoPorcentaje: 0 };

/* ---------- ENVÍO EN COLOMBIA (cotización automática con Envia) ---------- */
// Siempre se cotiza con UNA transportadora (la del convenio de pago en casa). Si el cliente elige contraentrega,
// la cotización incluye el costo del recaudo, así que el envío sale más caro.
// Servicios de Interrapidísimo en Envia: "ground_small" = Mensajería a domicilio, "mensajeria_do" = Domicilio - Oficina.
const ENVIO_NACIONAL = {
  transportadora: "interRapidisimo",
  servicio: "ground_small",
  redondearA: 1000,      // el flete se redondea hacia arriba a este múltiplo (1000 → $12.340 queda en $13.000)
  recargo: 0,            // pesos que se suman a cada envío (por ejemplo, costo de la caja). 0 = nada
  // Caja que se usa según el peso del pedido (gramos). Medidas en centímetros.
  cajas: [
    { hastaGramos: 1000, largo: 20, ancho: 15, alto: 10 },
    { hastaGramos: 5000, largo: 30, ancho: 25, alto: 20 },
    { hastaGramos: 1000000, largo: 40, ancho: 30, alto: 30 },
  ],
};

/* ---------- TASAS DE CAMBIO DE RESPALDO ---------- */
// La página consulta la tasa del día automáticamente. Estas solo se usan si esa consulta falla
// (sin internet, o el servicio caído). Unidades de cada moneda por 1 dólar. No hace falta tocarlas
// seguido; si quieres, actualízalas una vez al mes.
const TASAS_RESPALDO = {
  fecha: "20 de octubre de 2026",
  porDolar: { COP: 3156.32, USD: 1, CRC: 450.82, PEN: 3.437, CAD: 1.41 },
};

// ----- No edites de aquí para abajo: pasa los precios a cada producto del catálogo -----
(() => {
  for (const p of window.CATALOGO || []) {
    const v = PRECIOS[p.id];
    if (v === undefined) { p.sinPrecio = true; console.warn(`precios.js: falta el precio de "${p.id}"`); continue; }
    if (p.tipo === "espuela") p.precios = v;
    else if (p.tipo === "patapioja") p.tramos = v;
    else (p.variantes || []).forEach((x) => {
      const pr = v[x.id];
      if (pr === undefined) { console.warn(`precios.js: falta el precio de "${p.id}" → "${x.id}"`); return; }
      if (typeof pr === "object") Object.assign(x, pr); else x.precio = pr;
    });
  }
})();
