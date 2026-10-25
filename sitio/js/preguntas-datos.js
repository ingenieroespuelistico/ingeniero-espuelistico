// Preguntas frecuentes. Para agregar una, copia un bloque { pregunta, respuesta } y cambia el texto.
const PREGUNTAS = [
  {
    pregunta: "¿Qué significan las \"líneas\" de una espuela?",
    respuesta: "Las líneas son milímetros, medidos desde la base del casquillo hasta la punta de la espiga. En Costa Rica y otros países se usan pulgadas: 35 líneas son 1.4, 38 son 1.5, 40 son 1.6 y 42 o 43 son 1.7.",
  },
  {
    pregunta: "¿Qué diferencia hay entre una espuela con casquillo metálico y una enteriza?",
    respuesta: "La de casquillo metálico tiene dos piezas: el casquillo torneado en metal y la espiga (acrílica o negra reforzada). La enteriza es de una sola pieza: casquillo y espiga moldeados juntos en material sintético, sin metal.",
  },
  {
    pregunta: "¿Cómo funciona el precio por cantidad?",
    respuesta: "El precio por par baja según el total de pares de espuela de tu pedido, aunque mezcles referencias y medidas: minorista hasta 119 pares, mayorista de 120 a 499, distribuidor de 500 a 1.199 y gran distribuidor desde 1.200. Las patapiojas tienen su propia tabla y no se suman con las espuelas.",
  },
  {
    pregunta: "¿Las espuelas vienen selladas?",
    respuesta: `En bolsa y en caja vienen forradas con un plástico removible, listas para el uso. A granel van sin plástico ni empaque y cuestan $${Math.abs(AJUSTE_EMPAQUE.granel).toLocaleString("es-CO")} pesos menos por par.`,
  },
  {
    pregunta: "¿Cuándo despachan mi pedido?",
    respuesta: "De lunes a viernes, si pagas antes de las 4:00 p.m. sale el mismo día; los sábados, si pagas antes de las 10:00 a.m. Los pedidos desde 300 pares salen en 1 a 3 días hábiles. Domingos y festivos no hay despacho. El tiempo de entrega de la transportadora depende de tu ciudad.",
  },
  {
    pregunta: "¿Hacen envíos contraentrega?",
    respuesta: `Sí, en Colombia, para pedidos desde $${CONTRAENTREGA_MINIMO.toLocaleString("es-CO")} pesos. Pagas el envío por anticipado y el valor de los productos al recibir.`,
  },
  {
    pregunta: "¿Cómo puedo pagar?",
    respuesta: "En Colombia, en línea con PSE, tarjeta o Efecty a través de Mercado Pago, o contraentrega. Desde otros países, por PayPal o Western Union.",
  },
  {
    pregunta: "¿Envían a otros países?",
    respuesta: `Sí. Enviamos con DHL Express a Ecuador, Perú y demás países: la tienda calcula el valor exacto con tu ciudad antes de pagar, y pagas con PayPal en dólares. A Panamá y Costa Rica también puedes elegir nuestro envío propio: USD ${ENVIO_INTERNACIONAL_USD.base} hasta 1 kg más USD ${ENVIO_INTERNACIONAL_USD.porMedioKiloExtra} por cada medio kilo adicional, puerta a puerta. Con DHL, los impuestos de aduana de tu país, si aplican, los paga quien recibe. No enviamos a Estados Unidos (incluidos Puerto Rico y sus demás territorios) ni a Canadá, porque sus leyes restringen la importación de estos productos.`,
  },
  {
    pregunta: "¿Dan algún regalo?",
    respuesta: "Sí, patapioja sintética según los pares de espuela de tu pedido: 6 pares desde 50, 12 desde 100, 18 desde 200, 36 desde 500 y 50 pares desde 1.000.",
  },
  {
    pregunta: "¿Puedo devolver o cambiar un producto?",
    respuesta: "Sí. Tienes 5 días hábiles desde la entrega para retractarte, con el producto sin usar y en su empaque, y te devolvemos el dinero en máximo 15 días. Si un producto llega con defecto de fábrica, avísanos dentro de los 15 días siguientes a la entrega y te lo cambiamos o te devolvemos el dinero, con el envío a nuestro cargo. Si el error fue nuestro (medida o referencia equivocada), también pagamos los envíos. Lee la política completa en Cambios, devoluciones y garantía.",
    enlace: { texto: "Ver política de cambios y devoluciones", url: "devoluciones.html" },
  },
  {
    pregunta: "¿Puedo visitar el taller?",
    respuesta: "Sí, estamos en Ibagué. Escríbenos por WhatsApp para acordar la cita. También podemos encontrarnos en un punto de la ciudad.",
  },
];
