// PLANTILLA: producto con opciones (cada opción con su precio). Copia este archivo y cámbialo.
(window.CATALOGO = window.CATALOGO || []).push({
  "id": "producto-nuevo",                // corto, sin espacios ni tildes; igual a la carpeta de fotos
  "tipo": "variantes",
  "etiquetaVariante": "Tamaño",          // cómo se llama la opción en la ficha (Tamaño, Color, Ancho...)
  "nombre": "Producto nuevo",
  "detalle": "Descripción corta para la tarjeta",
  "variantes": [
    { "id": "pequeno", "nombre": "Pequeño", "precio": 10000, "peso": 50 },   // peso en gramos
    { "id": "grande", "nombre": "Grande", "precio": 15000, "peso": 80 }
  ],
  "descripcion": "Descripción larga que se ve al abrir el producto."
});
