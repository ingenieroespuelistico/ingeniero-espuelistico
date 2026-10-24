// =====================================================================================
//  PALABRAS DE BÚSQUEDA — otras formas en que los clientes llaman a cada producto.
//
//  • Escribe en minúscula; las tildes, mayúsculas y plurales no importan ("acrílicas" = "acrilica").
//  • Separa con comas. Puedes poner frases de varias palabras: "una pieza".
//  • Si agregas un producto nuevo, agrega aquí una línea con su mismo "id".
// =====================================================================================

// Palabras de cada producto (pesan mucho en la búsqueda)
const SINONIMOS = {
  "acrilica":        ["mona", "amarilla", "transparente", "translucida", "acrilico", "cristal", "casquillo", "casquillo metalico"],
  "negra-casquillo": ["negra", "reforzada", "casquillo", "casquillo metalico"],
  "blanca-enteriza": ["blanca", "sintetica", "plastica", "plastico", "enteriza", "entera", "una pieza"],
  "negra-enteriza":  ["negra", "enteriza", "entera", "una pieza"],
  "patapioja":       ["patera", "zapatola", "parrilla", "pata", "patapioja sintetica"],
  "metalica":        ["patapioja metalica", "patera metalica", "metal", "acero", "pequena", "realce"],
  "cera":            ["silicona", "melcocha", "pegante", "pega", "pegamento", "cera amarilla", "barra", "gruesa", "delgada"],
  "esparadrapo":     ["cinta", "tape", "rollo", "venda", "cinta medica"],
};

// Palabras de cada TIPO de producto (pesan menos: sirven para que salgan todos los de ese tipo)
const SINONIMOS_TIPO = {
  "espuela":       ["espuela", "sintetica", "plastica", "gruesa", "delgada", "pua", "gallo"],
  "patapioja":     ["patapioja", "accesorio"],
  "unidad-docena": ["accesorio", "docena"],
  "variantes":     ["accesorio"],
};
