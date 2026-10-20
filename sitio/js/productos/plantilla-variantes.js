// PLANTILLA: producto con opciones (cada opción con su precio). Copia este archivo y cámbialo.
(window.CATALOGO = window.CATALOGO || []).push({
  "id": "producto-nuevo",                // corto, sin espacios ni tildes; igual a la carpeta de fotos
  "tipo": "variantes",
  "etiquetaVariante": "Tamaño",          // cómo se llama la opción en la ficha (Tamaño, Color, Ancho...)
  "nombre": "Producto nuevo",
  "detalle": "Descripción corta para la tarjeta",
  "variantes": [
    { "id": "pequeno", "nombre": "Pequeño", "peso": 50 },   // peso en gramos (el precio va en js/precios.js)
    { "id": "grande", "nombre": "Grande", "peso": 80 }
  ],
  "descripcion": "Descripción larga que se ve al abrir el producto."
});
