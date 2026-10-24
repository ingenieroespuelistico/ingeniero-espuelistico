// Contenido de las páginas de guías y compra por mayor (para Google y asistentes de IA).
// Los precios, medidas, pesos y regalos salen de los mismos datos de la tienda: si cambias un precio en
// sitio/js/precios.js, estas páginas se actualizan solas en la siguiente publicación.
// Lenguaje neutral a propósito: hablamos de productos, medidas, materiales y compras, no de la actividad.

export function paginasSEO(T, h) {
  const { esc, pesos, urlProducto } = h;
  const C = T.Calculo, N = T.NEGOCIO;
  const prod = (id) => T.PRODUCTOS.find((p) => p.id === id);
  const enlace = (id, texto) => { const p = prod(id); return p && !p.sinPrecio ? `<a href="${urlProducto(p)}">${esc(texto || p.nombre)}</a>` : esc(texto || id); };
  const miles = (n) => Number(n).toLocaleString("es-CO");
  const espuelas = T.PRODUCTOS.filter((p) => p.tipo === "espuela" && !p.sinPrecio);
  const niveles = T.NIVELES;
  const rango = (i) => (niveles[i + 1] ? `${miles(niveles[i].desde)} a ${miles(niveles[i + 1].desde - 1)} pares` : `${miles(niveles[i].desde)} pares o más`);
  const wa = (texto) => `https://wa.me/${N.whatsapp}?text=${encodeURIComponent(texto)}`;
  const aj = T.AJUSTE_EMPAQUE;
  const I = T.ENVIO_INTERNACIONAL_USD;
  const sinEnvio = Object.values(N.paisesSinEnvio || {});
  const nombrePais = (iso) => { try { return new Intl.DisplayNames(["es"], { type: "region" }).of(iso); } catch { return iso; } };
  const conTarifa = (I.paisesConTarifa || []).map(nombrePais);

  // Ejemplo de pedido por mayor calculado con la misma fórmula de la tienda
  const ej = [{ producto: "acrilica", cantidad: 300, medida: 40, presentacion: "bolsa" }, { producto: "negra-casquillo", cantidad: 200, medida: 38, presentacion: "bolsa" }];
  const ejNivel = C.nivelPara(C.paresEspuela(ej)), ejTotal = C.subtotal(ej), ejRegalo = C.regaloPara(C.paresEspuela(ej)), ejKg = C.pesoGramos(ej) / 1000;
  const tablaNiveles = `<table class="pp-tabla pp-tabla--ancha"><caption>Precio por par en bolsa, según el total de pares de espuela del pedido</caption>
    <thead><tr><th scope="col">Nivel</th>${espuelas.map((p) => `<th scope="col">${esc(p.nombre.replace("Espuela ", ""))}</th>`).join("")}</tr></thead>
    <tbody>${niveles.map((n, i) => `<tr><th scope="row">${esc(n.nombre)}<small>${rango(i)}</small></th>${espuelas.map((p) => `<td>${pesos(p.precios[n.id])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const tablaRegalos = `<table class="pp-tabla"><caption>Patapioja sintética de regalo según los pares de espuela del pedido</caption>
    <thead><tr><th scope="col">Pares de espuela</th><th scope="col">Regalo</th></tr></thead>
    <tbody>${T.REGALOS.map((r) => `<tr><th scope="row">Desde ${miles(r.desde)}</th><td>${r.pares} pares de patapioja</td></tr>`).join("")}</tbody></table>`;

  // Medidas: equivalencia exacta y la que se usa en el comercio
  const todasMedidas = [...new Set(espuelas.flatMap((p) => p.medidas))].sort((a, b) => a - b);
  const tablaMedidas = `<table class="pp-tabla pp-tabla--ancha"><caption>Equivalencias de medida de espuelas</caption>
    <thead><tr><th scope="col">Líneas</th><th scope="col">Milímetros</th><th scope="col">Centímetros</th><th scope="col">Pulgadas exactas</th><th scope="col">Como se pide en pulgadas</th></tr></thead>
    <tbody>${todasMedidas.map((m) => `<tr><th scope="row">${m} líneas</th><td>${m} mm</td><td>${(m / 10).toFixed(1).replace(".", ",")} cm</td><td>${(m / 25.4).toFixed(2)}"</td><td>${T.PULGADAS[m]}"</td></tr>`).join("")}</tbody></table>`;
  const tablaMedidasPorRef = `<table class="pp-tabla"><caption>Medidas que fabricamos en cada referencia</caption>
    <thead><tr><th scope="col">Referencia</th><th scope="col">Medidas</th><th scope="col">Peso por par</th></tr></thead>
    <tbody>${espuelas.map((p) => `<tr><th scope="row">${enlace(p.id)}</th><td>${p.medidas.map((m) => `${m} (${T.PULGADAS[m]}")`).join(", ")}</td><td>${String(p.pesoPar).replace(".", ",")} g</td></tr>`).join("")}</tbody></table>`;

  const ac = prod("acrilica"), nc = prod("negra-casquillo"), be = prod("blanca-enteriza"), ne = prod("negra-enteriza");
  const tablaComparar = `<table class="pp-tabla pp-tabla--comparar pp-tabla--ancha"><caption>Comparación de las cuatro espuelas</caption>
    <thead><tr><th scope="col"></th>${[ac, nc, be, ne].map((p) => `<th scope="col">${enlace(p.id, p.nombre.replace("Espuela ", ""))}</th>`).join("")}</tr></thead>
    <tbody>
      <tr><th scope="row">Construcción</th><td>Dos piezas</td><td>Dos piezas</td><td>Una pieza</td><td>Una pieza</td></tr>
      <tr><th scope="row">Casquillo</th><td>Metálico torneado</td><td>Metálico torneado</td><td>Moldeado con la espiga</td><td>Moldeado con la espiga</td></tr>
      <tr><th scope="row">Espiga</th><td>Acrílico amarillo translúcido</td><td>Material reforzado negro</td><td>Sintético blanco</td><td>Reforzado negro</td></tr>
      <tr><th scope="row">Medidas (líneas)</th>${[ac, nc, be, ne].map((p) => `<td>${p.medidas.join(", ")}</td>`).join("")}</tr>
      <tr><th scope="row">Peso por par</th>${[ac, nc, be, ne].map((p) => `<td>${String(p.pesoPar).replace(".", ",")} g</td>`).join("")}</tr>
      <tr><th scope="row">Precio detal (par)</th>${[ac, nc, be, ne].map((p) => `<td>${pesos(p.precios[niveles[0].id])}</td>`).join("")}</tr>
      <tr><th scope="row">Desde ${miles(niveles[3].desde)} pares</th>${[ac, nc, be, ne].map((p) => `<td>${pesos(p.precios[niveles[3].id])}</td>`).join("")}</tr>
    </tbody></table>`;

  const patapioja = prod("patapioja"), metalica = prod("metalica"), cera = prod("cera"), esparadrapo = prod("esparadrapo");
  const tramos = patapioja.tramos;

  const comunes = {
    despacho: `De lunes a viernes, si pagas antes de las 4:00 p.m. el pedido sale el mismo día; los sábados, antes de las 10:00 a.m. Los pedidos desde 300 pares salen en 1 a 3 días hábiles.`,
  };

  return [
    /* ------------------------------------------------------------------ */
    {
      ruta: "/espuelas-por-mayor", tipo: "landing",
      titulo: "Espuelas para gallos por mayor | Ingeniero Espuelístico",
      descripcion: `Espuelas para gallos por mayor directo de fábrica en Ibagué: ${pesos(ac.precios.mayorista)} el par desde ${niveles[1].desde} pares y ${pesos(ac.precios.gran_distribuidor)} desde ${miles(niveles[3].desde)}. Mezcla referencias y medidas.`,
      h1: "Espuelas para gallos por mayor, directo de fábrica",
      miga: "Por mayor",
      cuerpo: `
  <p class="guia__entrada">Vendemos espuelas para gallos por mayor directamente desde nuestro taller en Ibagué, sin intermediarios. El precio por par baja según el <strong>total de pares de espuela de tu pedido</strong>, aunque mezcles referencias y medidas: ${pesos(ac.precios.minorista)} al detal, ${pesos(ac.precios.mayorista)} desde ${niveles[1].desde} pares, ${pesos(ac.precios.distribuidor)} desde ${niveles[2].desde} y ${pesos(ac.precios.gran_distribuidor)} desde ${miles(niveles[3].desde)} pares (espuela con casquillo metálico, en bolsa).</p>
  <div class="pp-acciones">
    <a class="boton boton--azul" href="/#catalogo">Armar mi pedido en la tienda</a>
    <a class="boton boton--verde-borde" href="${wa("Hola, quiero cotizar espuelas por mayor")}" target="_blank" rel="noopener">Cotizar por WhatsApp</a>
  </div>

  <section class="pp-seccion"><h2>Precios por mayor de cada referencia</h2>
    ${tablaNiveles}
    <p class="pp-nota">En caja suma ${pesos(aj.caja)} por par; a granel (sin plástico ni empaque) resta ${pesos(Math.abs(aj.granel))} por par. Precios en pesos colombianos; no somos responsables de IVA.</p>
  </section>

  <section class="pp-seccion"><h2>Cómo se calcula el precio por mayor</h2>
    <p>Sumamos todos los pares de espuela del pedido, sin importar la referencia ni la medida, y a ese total le aplicamos el nivel de precio. Así, si una referencia sola no alcanza el mínimo, la mezcla sí puede alcanzarlo.</p>
    <p><strong>Ejemplo:</strong> 300 pares de ${enlace("acrilica", "espuela acrílica")} en 40 líneas y 200 pares de ${enlace("negra-casquillo", "espuela negra reforzada")} en 38 líneas suman 500 pares. El pedido queda en el nivel <strong>${esc(ejNivel.nombre)}</strong>: ${pesos(ejTotal / 500)} el par, ${pesos(ejTotal)} en total${ejRegalo ? `, y te regalamos ${ejRegalo.pares} pares de patapioja sintética` : ""}. El paquete pesa unos ${ejKg.toFixed(1).replace(".", ",")} kg.</p>
    <p>Las patapiojas tienen su propia tabla por cantidad y no se suman con las espuelas.</p>
  </section>

  <section class="pp-seccion"><h2>Regalo por volumen</h2>${tablaRegalos}</section>

  <section class="pp-seccion"><h2>Presentaciones</h2>
    <ul>${T.PRESENTACIONES.map((x) => `<li><strong>${esc(x.nombre)}:</strong> ${esc(x.nota.toLowerCase())}${x.ajuste ? ` (${x.ajuste > 0 ? "suma" : "resta"} ${pesos(Math.abs(x.ajuste))} por par)` : ""}.</li>`).join("")}</ul>
    <p>Para reventa en mostrador, la presentación en caja se ve mejor; para quien arma sus propios empaques, a granel es la más económica.</p>
  </section>

  <section class="pp-seccion"><h2>Despacho, envío y pago</h2>
    <ul>
      <li><strong>Despacho:</strong> ${comunes.despacho}</li>
      <li><strong>Envío en Colombia:</strong> con Interrapidísimo. La tienda calcula el valor exacto según tu municipio y el peso del paquete antes de pagar.</li>
      <li><strong>Pago:</strong> PSE, tarjeta o Efecty con Mercado Pago, o contraentrega desde ${pesos(T.CONTRAENTREGA_MINIMO)} (pagas el envío en línea y los productos al recibir). Para pedidos por WhatsApp también recibimos transferencia.</li>
      <li><strong>Otros países:</strong> ${conTarifa.length ? `a ${conTarifa.join(" y ")} el envío cuesta USD ${I.base} hasta 1 kg y USD ${I.porMedioKiloExtra} por cada medio kilo adicional; ` : ""}a Ecuador, ${esc(I.ecuador)}; a otros países te cotizamos por WhatsApp. Pagas con PayPal o Western Union. Más detalles en <a href="/envios-internacionales">envíos internacionales</a>.</li>
    </ul>
  </section>`,
      preguntas: [
        { pregunta: "¿Cuál es el pedido mínimo para precio por mayor?", respuesta: `El precio mayorista empieza en ${niveles[1].desde} pares de espuela en total; el de distribuidor, en ${niveles[2].desde}; y el de gran distribuidor, en ${miles(niveles[3].desde)}. Puedes comprar desde 1 par al precio de detal.` },
        { pregunta: "¿Puedo mezclar referencias y medidas para llegar al precio por mayor?", respuesta: "Sí. Se suman todos los pares de espuela del pedido, sin importar la referencia, la medida ni la presentación." },
        { pregunta: "¿Cuánto tarda un pedido grande?", respuesta: comunes.despacho },
        { pregunta: "¿Entregan factura?", respuesta: "Somos persona natural no responsable de IVA y no estamos obligados a facturar. Te damos el resumen del pedido y el comprobante de pago; si eres comerciante, puedes soportar la compra con el documento soporte de adquisiciones a no obligados a facturar." },
        { pregunta: "¿Venden por mayor a otros países?", respuesta: `Sí. Despachamos a Ecuador, Perú, Panamá y otros países. No enviamos a ${sinEnvio.length ? "Estados Unidos, sus territorios ni Canadá" : "países con restricciones"} por restricciones de importación.` },
        { pregunta: "¿Puedo visitar el taller?", respuesta: "Sí, estamos en Ibagué, Tolima. Escríbenos por WhatsApp para acordar la cita." },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      ruta: "/guias/medidas-de-espuelas", tipo: "guia",
      titulo: "Medidas de espuelas para gallos: líneas y pulgadas",
      descripcion: `Una línea es un milímetro: 40 líneas son 40 mm, o 1.6" en pulgadas. Tabla de equivalencias de ${todasMedidas[0]} a ${todasMedidas[todasMedidas.length - 1]} líneas y cómo medir una espuela.`,
      h1: "Medidas de espuelas para gallos: líneas, milímetros y pulgadas",
      miga: "Medidas de espuelas",
      cuerpo: `
  <p class="guia__entrada">En Colombia la medida de una espuela se da en <strong>líneas</strong>, y <strong>una línea es un milímetro</strong>. Una espuela de 40 líneas mide 40 mm desde la base del casquillo hasta la punta de la espiga. En los países donde se pide en pulgadas, esa misma espuela se conoce como de 1.6".</p>

  <section class="pp-seccion"><h2>Tabla de equivalencias</h2>
    ${tablaMedidas}
    <p class="pp-nota">La columna "como se pide en pulgadas" es la medida comercial, redondeada al décimo. Por eso 42 y 43 líneas se conocen las dos como 1.7".</p>
  </section>

  <section class="pp-seccion"><h2>Cómo medir una espuela</h2>
    <ol>
      <li>Usa una regla o, mejor, un calibrador (pie de rey) en milímetros.</li>
      <li>Apoya el cero en la base del casquillo, donde la espuela se asienta.</li>
      <li>Mide en línea recta hasta la punta de la espiga. Ese número de milímetros es la medida en líneas.</li>
      <li>Si la quieres en pulgadas, divide los milímetros entre 25,4 o búscala en la tabla.</li>
    </ol>
    <p>Si ya tienes una espuela que te gusta, la forma más segura de acertar es medirla y pedir la misma medida.</p>
  </section>

  <section class="pp-seccion"><h2>Medidas que fabricamos</h2>${tablaMedidasPorRef}</section>

  <section class="pp-seccion"><h2>Errores comunes al pedir</h2>
    <ul>
      <li><strong>Confundir líneas con pulgadas.</strong> "40" en líneas no tiene nada que ver con "1.4" en pulgadas: 1.4" equivale a 35 líneas.</li>
      <li><strong>Medir solo la espiga.</strong> La medida incluye el casquillo: va desde su base hasta la punta.</li>
      <li><strong>Pedir 1.7" sin aclarar.</strong> Puede ser 42 o 43 líneas. Dinos cuál necesitas.</li>
    </ul>
  </section>`,
      preguntas: [
        { pregunta: "¿Una línea es un milímetro?", respuesta: "Sí. En espuelas, la medida en líneas es la longitud en milímetros desde la base del casquillo hasta la punta de la espiga." },
        { pregunta: "¿Cuántas pulgadas son 40 líneas?", respuesta: `40 líneas son 40 mm, es decir 1,57 pulgadas exactas. En el comercio se pide como ${T.PULGADAS[40]}".` },
        { pregunta: "¿42 y 43 líneas son la misma medida en pulgadas?", respuesta: `En el comercio las dos se conocen como ${T.PULGADAS[42]}", pero son distintas: 42 mm (1,65") y 43 mm (1,69").` },
        { pregunta: "¿En qué medidas vienen las espuelas enterizas?", respuesta: `La ${be.nombre.toLowerCase()} en ${be.medidas.join(", ")} líneas y la ${ne.nombre.toLowerCase()} en ${ne.medidas.join(", ")} líneas.` },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      ruta: "/guias/espuela-con-casquillo-o-enteriza", tipo: "guia",
      titulo: "Espuela con casquillo o enteriza: diferencias",
      descripcion: `Con casquillo: dos piezas, ${String(ac.pesoPar).replace(".", ",")} g el par. Enteriza: una sola pieza, ${String(be.pesoPar).replace(".", ",")} g. Compara materiales, medidas y precios de las 4 espuelas.`,
      h1: "Espuela con casquillo metálico o enteriza: diferencias y cuál elegir",
      miga: "Casquillo o enteriza",
      cuerpo: `
  <p class="guia__entrada">La diferencia está en cómo está hecha. La <strong>espuela con casquillo metálico</strong> tiene dos piezas: un casquillo de metal torneado y una espiga de acrílico o de material reforzado. La <strong>espuela enteriza</strong> es de una sola pieza: casquillo y espiga moldeados juntos en material sintético, sin metal. Por eso la enteriza pesa casi la mitad y cuesta un poco menos.</p>

  <section class="pp-seccion"><h2>Comparación</h2>${tablaComparar}</section>

  <section class="pp-seccion"><h2>Espuelas con casquillo metálico</h2>
    <p>Fabricamos el casquillo en metal torneado en nuestro taller y le montamos la espiga. Hay dos opciones de espiga:</p>
    <ul>
      <li>${enlace("acrilica")}: acrílico amarillo translúcido. ${esc(ac.medidas.length)} medidas: ${ac.medidas.join(", ")} líneas.</li>
      <li>${enlace("negra-casquillo")}: material reforzado negro, con el mismo casquillo. ${nc.medidas.join(", ")} líneas.</li>
    </ul>
    <p>Las dos cuestan lo mismo y entran en la misma tabla de precios por cantidad.</p>
  </section>

  <section class="pp-seccion"><h2>Espuelas enterizas</h2>
    <ul>
      <li>${enlace("blanca-enteriza")}: sintética blanca de una pieza, en ${be.medidas.join(", ")} líneas.</li>
      <li>${enlace("negra-enteriza")}: reforzada negra de una pieza, en ${ne.medidas.join(", ")} líneas.</li>
    </ul>
    <p>Pesan ${String(be.pesoPar).replace(".", ",")} g el par frente a ${String(ac.pesoPar).replace(".", ",")} g de las de casquillo, y cuestan ${pesos(ac.precios.minorista - be.precios.minorista)} menos por par al detal.</p>
  </section>

  <section class="pp-seccion"><h2>¿Cuál elegir?</h2>
    <ul>
      <li>Si prefieres el casquillo de metal, elige ${enlace("acrilica", "acrílica")} o ${enlace("negra-casquillo", "negra reforzada")}: hay más medidas para escoger (de ${ac.medidas[0]} a ${ac.medidas[ac.medidas.length - 1]} líneas).</li>
      <li>Si buscas una espuela más liviana y económica, elige una enteriza, teniendo en cuenta que viene en menos medidas.</li>
      <li>Entre acrílica y negra reforzada, la diferencia es el material y el color de la espiga; el precio y el casquillo son iguales.</li>
    </ul>
    <p>Todas se venden en bolsa, en caja o a granel, y se suman para el precio por mayor (<a href="/espuelas-por-mayor">ver precios por mayor</a>).</p>
  </section>`,
      preguntas: [
        { pregunta: "¿Qué es una espuela enteriza?", respuesta: "Es una espuela de una sola pieza: el casquillo y la espiga están moldeados juntos en material sintético, sin casquillo metálico." },
        { pregunta: "¿Cuánto pesa una espuela con casquillo metálico?", respuesta: `El par pesa unos ${String(ac.pesoPar).replace(".", ",")} g; el par de enterizas, unos ${String(be.pesoPar).replace(".", ",")} g.` },
        { pregunta: "¿La acrílica y la negra reforzada cuestan lo mismo?", respuesta: `Sí: ${pesos(ac.precios.minorista)} el par al detal y bajan igual con la cantidad.` },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      ruta: "/accesorios-para-gallos", tipo: "landing",
      titulo: "Accesorios para gallos: patapioja, cera y esparadrapo",
      descripcion: `Patapioja sintética desde ${pesos(tramos[tramos.length - 1].precio)} el par por cantidad, patapioja metálica, cera amarilla en barra y esparadrapo. Fábrica en Ibagué con envíos a toda Colombia.`,
      h1: "Accesorios para gallos: patapioja, cera y esparadrapo",
      miga: "Accesorios",
      cuerpo: `
  <p class="guia__entrada">Además de espuelas, fabricamos patapioja sintética, patapioja metálica y cera amarilla en barra, y vendemos esparadrapo en varios anchos. Todo sale de Ibagué con envío a toda Colombia, y se puede comprar por unidad o por docena.</p>

  <section class="pp-seccion"><h2>${enlace("patapioja")}</h2>
    <p>${esc(patapioja.detalle)}. ${esc(patapioja.descripcion)}</p>
    <table class="pp-tabla"><caption>Precio por par según la cantidad</caption><thead><tr><th scope="col">Cantidad</th><th scope="col">Precio por par</th></tr></thead>
    <tbody>${tramos.map((x, i) => `<tr><th scope="row">${miles(x.desde)}${tramos[i + 1] ? ` a ${miles(tramos[i + 1].desde - 1)}` : " o más"} pares</th><td>${pesos(x.precio)}</td></tr>`).join("")}</tbody></table>
    <p>Con tus espuelas te regalamos patapioja sintética desde ${T.REGALOS[0].desde} pares de espuela.</p>
  </section>

  <section class="pp-seccion"><h2>${enlace("metalica")}</h2>
    <p>${esc(metalica.descripcion)}</p>
    <ul>${metalica.variantes.map((v) => `<li><strong>${esc(v.nombre)}:</strong> ${pesos(v.unidad)} el par, ${pesos(v.docena)} la docena.</li>`).join("")}</ul>
  </section>

  <section class="pp-seccion"><h2>${enlace("cera")}</h2>
    <p>${esc(cera.descripcion)}</p>
    <ul>${cera.variantes.map((v) => `<li><strong>${esc(v.nombre)} (${v.peso} g):</strong> ${pesos(v.unidad)} la barra, ${pesos(v.docena)} la docena.</li>`).join("")}</ul>
  </section>

  <section class="pp-seccion"><h2>${enlace("esparadrapo")}</h2>
    <p>${esc(esparadrapo.descripcion)}</p>
    <ul>${esparadrapo.variantes.map((v) => `<li><strong>${esc(v.nombre)}:</strong> ${pesos(v.precio)}${v.nota ? ` (${esc(v.nota)})` : ""}.</li>`).join("")}</ul>
  </section>`,
      preguntas: [
        { pregunta: "¿Qué otros nombres tiene la patapioja?", respuesta: "También se le dice patera, zapatola o parrilla." },
        { pregunta: "¿Cuál patapioja sintética es más resistente a la temperatura?", respuesta: "La negra. La amarilla es acrílica translúcida y más vistosa." },
        { pregunta: "¿Venden cera y patapioja por docena?", respuesta: "Sí. La cera y la patapioja metálica se venden por unidad o por docena; la patapioja sintética baja de precio por cantidad." },
      ],
    },

    /* ------------------------------------------------------------------ */
    {
      ruta: "/envios-internacionales", tipo: "landing",
      titulo: "Espuelas para gallos con envío internacional",
      descripcion: `Espuelas para gallos y accesorios desde Colombia${conTarifa.length ? ` a ${conTarifa.join(", ")}` : ""}, Ecuador, Perú y otros países, a precio de fábrica. Pago con PayPal o Western Union.`,
      h1: "Espuelas para gallos con envío internacional",
      miga: "Envíos internacionales",
      cuerpo: `
  <p class="guia__entrada">Despachamos espuelas y accesorios desde nuestro taller en Ibagué, Colombia, a otros países, con los mismos precios de fábrica y descuentos por cantidad. Puedes ver los precios en tu moneda en la tienda; el cobro se hace en dólares con PayPal o por Western Union.</p>

  <section class="pp-seccion"><h2>Costo del envío por país</h2>
    <ul>
      ${conTarifa.length ? `<li><strong>${conTarifa.join(" y ")}:</strong> USD ${I.base} hasta 1 kg, más USD ${I.porMedioKiloExtra} por cada medio kilo adicional, puerta a puerta. Por ejemplo, 24 pares de espuela con casquillo pesan unos ${(C.pesoGramos([{ producto: "acrilica", cantidad: 24, medida: 40, presentacion: "bolsa" }]) / 1000).toFixed(2).replace(".", ",")} kg y pagan la tarifa base.</li>` : ""}
      <li><strong>Ecuador:</strong> ${esc(I.ecuador)}.</li>
      <li><strong>Perú y otros países:</strong> te cotizamos por WhatsApp según el peso del pedido.</li>
    </ul>
    ${sinEnvio.length ? `<p class="documento__resumen"><strong>No enviamos</strong> a Estados Unidos (incluidos Puerto Rico y sus demás territorios) ni a Canadá, porque sus leyes prohíben o restringen la importación de estos productos.</p>` : ""}
  </section>

  <section class="pp-seccion"><h2>Cómo comprar desde otro país</h2>
    <ol>
      <li>Arma tu pedido en la <a href="/#catalogo">tienda</a> y elige tu país en los datos de envío.</li>
      <li>Si tu país tiene tarifa fija, pagas con PayPal ahí mismo cuando esté disponible; si no, te enviamos por WhatsApp el total con el envío y el enlace de pago.</li>
      <li>Despachamos y te enviamos el número de guía para seguir el paquete.</li>
    </ol>
  </section>

  <section class="pp-seccion"><h2>Medidas en pulgadas</h2>
    <p>En Colombia medimos en líneas (milímetros). Si en tu país se pide en pulgadas: 35 líneas son ${T.PULGADAS[35]}", 38 son ${T.PULGADAS[38]}", 40 son ${T.PULGADAS[40]}" y 42 o 43 son ${T.PULGADAS[42]}". Ver la <a href="/guias/medidas-de-espuelas">tabla completa de medidas</a>.</p>
  </section>

  <section class="pp-seccion"><h2>Aduanas e impuestos</h2>
    <p>Los aranceles, impuestos y trámites de importación del país de destino los paga quien compra. Antes de pagar, verifica que tu país permita importar estos productos.</p>
  </section>`,
      preguntas: [
        { pregunta: "¿Cómo pago desde otro país?", respuesta: "Con PayPal (en dólares) o por Western Union. Te enviamos el total con el envío incluido." },
        { pregunta: "¿Puedo ver los precios en mi moneda?", respuesta: "Sí. En la tienda eliges tu país y ves los precios aproximados en tu moneda con la tasa del día. El cobro se hace en pesos colombianos o en dólares." },
        { pregunta: "¿Envían a Estados Unidos o Puerto Rico?", respuesta: "No. Las leyes de Estados Unidos, que también aplican en Puerto Rico y sus demás territorios, y las de Canadá prohíben o restringen la importación de estos productos." },
      ],
    },
  ];
}
