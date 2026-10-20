// PLANTILLA: espuela nueva. Copia este archivo, cámbiale el nombre y los datos.
(window.CATALOGO = window.CATALOGO || []).push({
  "id": "espuela-nueva",                 // corto, sin espacios ni tildes; igual a la carpeta de fotos
  "tipo": "espuela",                     // usa la tabla de precios por cantidad
  "nombre": "Espuela nueva",
  "detalle": "Descripción corta para la tarjeta",
  "medidas": [35, 38, 40],               // en líneas (mm)
  "precios": {                           // precio por par EN BOLSA (caja +300, granel −200)
    "minorista": 4000,                   // 1 a 119 pares
    "mayorista": 3700,                   // 120 a 499
    "distribuidor": 3350,                // 500 a 1.199
    "gran_distribuidor": 3100            // 1.200 o más
  },
  "pesoPar": 4.5,                        // gramos por par (para calcular el envío)
  "color": "#F2B705",                    // color del dibujo mientras no haya foto
  "descripcion": "Descripción larga que se ve al abrir el producto.",
  "dureza": "Extrema"
});
