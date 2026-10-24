# Ingeniero Espuelístico · tienda web

Página de venta de espuelas, patapiojas, cera y esparadrapo, fabricados en Ibagué (Colombia).

## Carpetas
- `sitio/` — la página que se publica (HTML, CSS, JS, fotos). Se abre con doble clic en `sitio/index.html`.
  - `sitio/js/productos/` — un archivo por producto (ver `LEEME.txt`).
  - `sitio/js/modelos3d/` — un archivo por espuela del recorrido 3D.
  - `sitio/fotos/<producto>/` — fotos del catálogo (`1.jpg`, `2.jpg`…). `sitio/fotos/taller/` — fotos del taller.
  - `sitio/resenas/` — reseñas de clientes y `lista.js`.
  - `sitio/js/lugares/` — departamentos, provincias y ciudades por país.
- `fuente/` — código fuente de `espuela3d.min.js` y `paises.min.js`. Para recompilar: `cd fuente && npm install && npm run build`.

## Publicación
Cloudflare (Worker con archivos estáticos, ver `wrangler.jsonc`) publica la carpeta `sitio/` y el servidor `servidor/index.js`. Las cabeceras de seguridad están en `sitio/_headers`.
