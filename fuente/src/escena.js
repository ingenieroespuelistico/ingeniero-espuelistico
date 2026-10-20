// Espuelas 3D de Ingeniero Espuelístico (v4).
// Medidas en mm (y = 0 en la base), tomadas de las fotos de referencia. Alto total 40 mm (la negra metálica, 35 mm).
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Vector2, Vector3,
  LatheGeometry, BufferGeometry, Float32BufferAttribute,
  MeshStandardMaterial, CanvasTexture, RepeatWrapping, DoubleSide,
  PMREMGenerator, DirectionalLight, AmbientLight, SRGBColorSpace,
  ACESFilmicToneMapping, QuadraticBezierCurve3, MathUtils,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const lerp = MathUtils.lerp;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const suave = (t) => t * t * (3 - 2 * t);

/* ---------- Geometrías ---------- */

function torno(perfil, lados = 64) {
  const g = new LatheGeometry(perfil.map(([r, y]) => new Vector2(r, y)), lados);
  g.computeVertexNormals();
  return g;
}

// Casquillo metálico (13 mm de alto): cono, hombro y cuello; la copa es el hueco interior.
const ALTO_CASQUILLO = 13;
function geometriaCasquillo() {
  const k = ALTO_CASQUILLO / 16;
  const ext = [[5.5, 0], [5.45, 2], [5.05, 6], [4.6, 10], [4.2, 11.8], [3.9, 12.4], [3.3, 12.9], [2.75, 13.2], [2.6, 13.6], [2.55, 15.9]];
  const copa = [[2.1, 16.0], [2.1, 13.2], [3.2, 11.0], [4.0, 8], [4.55, 3], [4.65, 0.2], [5.5, 0]];
  return torno([...ext, ...copa].map(([r, y]) => [r, y * k]));
}

// Cuerpo de la espuela enteriza (campana con nudo), de una sola pieza con la espiga.
const ALTO_CAMPANA = 19.5;
function geometriaCampana() {
  const ext = [[6.55, 0], [6.45, 2], [6.1, 5], [5.75, 7.5], [5.15, 10.9], [4.7, 12.6], [3.8, 14.3], [2.6, 15.2], [2.2, 15.7],
    [2.55, 16.2], [2.65, 17], [2.5, 17.8], [2.15, 18.8], [1.75, 19.5]];
  const copa = [[1.2, 19.4], [1.2, 15.6], [3.4, 13.4], [4.6, 10.5], [5.45, 6], [5.65, 0.2], [6.55, 0]];
  return torno([...ext, ...copa]);
}

// Espiga: una sola curva cóncava (Bézier cuadrática, sin inflexión) que se afina hasta la punta.
function geometriaEspiga({ desde, salida, alto, desvio, radioBase }) {
  const inicio = new Vector3(0, desde, 0);
  const control = new Vector3(0, alto * 0.78, 0);
  const punta = new Vector3(desvio, alto, 0);
  const curva = new QuadraticBezierCurve3(inicio, control, punta);
  const seg = 96, lados = 32;
  let tSalida = 0;
  for (let i = 0; i <= 200; i++) { if (curva.getPointAt(i / 200).y >= salida) { tSalida = i / 200; break; } }
  const radio = (t) => (t <= tSalida ? radioBase : radioBase * Math.pow(1 - (t - tSalida) / (1 - tSalida), 0.7) + 0.02);
  const pos = [], nor = [], idx = [];
  const marcos = curva.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, p = curva.getPointAt(t), r = radio(t);
    for (let j = 0; j <= lados; j++) {
      const a = (j / lados) * Math.PI * 2;
      const n = new Vector3().addScaledVector(marcos.normals[i], Math.cos(a)).addScaledVector(marcos.binormals[i], Math.sin(a)).normalize();
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < lados; j++) {
    const a = i * (lados + 1) + j, b = a + lados + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const base = pos.length / 3;
  pos.push(inicio.x, inicio.y, inicio.z); nor.push(0, -1, 0);
  for (let j = 0; j < lados; j++) idx.push(base, j, j + 1);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function texturaTorno() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const x = c.getContext("2d");
  for (let y = 0; y < 256; y++) {
    const v = 150 + Math.sin(y * 0.9) * 30 + (Math.random() - 0.5) * 70;
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(0, y, 4, 1);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/* ---------- Escena ---------- */
export function iniciarEspuela({ lienzo, visor, rotulos, leyenda }) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    lienzo.remove();
    document.documentElement.classList.add("sin-3d");
    return;
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;

  const escena = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const camara = new PerspectiveCamera(28, 1, 1, 1000);
  camara.position.set(0, 0, 160);
  escena.add(new AmbientLight(0xffffff, 0.35));
  const sol = new DirectionalLight(0xffffff, 1.6);
  sol.position.set(40, 80, 60);
  escena.add(sol);

  const lineas = texturaTorno();
  const metal = new MeshStandardMaterial({ color: 0x9ea6ae, metalness: 1, roughness: 0.4, bumpMap: lineas, bumpScale: 0.3, roughnessMap: lineas, side: DoubleSide });

  // Materiales de cada modelo: vienen como datos en js/modelos3d/*.js
  const cacheMat = {};
  function material(def) {
    const clave = JSON.stringify(def);
    if (cacheMat[clave]) return cacheMat[clave];
    const transparente = def.opacidad !== undefined && def.opacidad < 1;
    return (cacheMat[clave] = new MeshStandardMaterial({
      color: def.color, roughness: def.rugosidad ?? 0.35, metalness: def.metalico ?? 0,
      transparent: transparente, opacity: def.opacidad ?? 1,
      emissive: def.brillo ?? 0x000000, emissiveIntensity: def.brillo ? 0.3 : 0,
      envMapIntensity: def.reflejo ?? 1, side: DoubleSide,
    }));
  }

  function construir(d) {
    const g = new Group();
    const alto = d.alto || 40;
    if (d.tipo === "casquillo") {
      const casquillo = new Mesh(geometriaCasquillo(), metal);
      const espiga = new Mesh(geometriaEspiga({
        desde: ALTO_CASQUILLO - 2.5, salida: ALTO_CASQUILLO, alto,
        desvio: d.desvioPunta ?? 8.9 * (alto / 40), radioBase: d.grosorEspiga ?? 2.0,
      }), material(d.espiga));
      g.add(casquillo, espiga);
      g.position.y = -alto / 2;
      return {
        ...d, grupo: g, alto, desarmable: true, casquillo, espiga,
        anclas: {
          casquillo: { pieza: casquillo, punto: new Vector3(5.2, 5, 0) },
          copa: { pieza: casquillo, punto: new Vector3(-4.6, 0.5, 0) },
          espiga: { pieza: espiga, punto: new Vector3(3.2, alto * 0.75, 0) },
        },
      };
    }
    const mat = material(d.cuerpo);
    const cuerpo = new Mesh(geometriaCampana(), mat);
    const espiga = new Mesh(geometriaEspiga({
      desde: 17, salida: ALTO_CAMPANA, alto, desvio: d.desvioPunta ?? 8.1 * (alto / 40), radioBase: d.grosorEspiga ?? 1.65,
    }), mat);
    g.add(cuerpo, espiga);
    g.position.y = -alto / 2;
    return {
      ...d, grupo: g, alto, desarmable: false,
      anclas: {
        pieza: { pieza: cuerpo, punto: new Vector3(6.2, 7, 0) },
        copa: { pieza: cuerpo, punto: new Vector3(-5.6, 0.5, 0) },
        espiga: { pieza: espiga, punto: new Vector3(3.0, alto * 0.75, 0) },
      },
    };
  }

  const definiciones = (window.MODELOS_3D || []).filter((d) => d && (d.tipo === "casquillo" || d.tipo === "enteriza"));
  if (!definiciones.length) { lienzo.remove(); return; }
  const modelos = definiciones.map(construir);
  const pivote = new Group();
  const giro = new Group();
  pivote.add(giro);
  modelos.forEach((m, i) => { m.grupo.visible = i === 0; giro.add(m.grupo); });
  escena.add(pivote);

  // Duración de cada etapa (s)
  const DUR_CASQUILLO = 6.2, DUR_ENTERIZA = 4.6, CAMBIO = 0.7;
  const duraciones = modelos.map((m) => (m.desarmable ? DUR_CASQUILLO : DUR_ENTERIZA) + CAMBIO);
  const total = duraciones.reduce((a, b) => a + b, 0);

  function estado(s) {
    let t = s % total, i = 0;
    while (t >= duraciones[i]) { t -= duraciones[i]; i++; }
    const m = modelos[i], dur = duraciones[i] - CAMBIO;
    let despiece = 0, rotulo = 0, escala = 1;
    if (m.desarmable) {
      if (t >= 1.4 && t < 2.3) despiece = suave((t - 1.4) / 0.9);
      else if (t >= 2.3 && t < 4.2) despiece = 1;
      else if (t >= 4.2 && t < 5.1) despiece = 1 - suave((t - 4.2) / 0.9);
      rotulo = clamp((despiece - 0.5) / 0.5);
    } else {
      rotulo = clamp((t - 0.7) / 0.5) * clamp((dur - 0.4 - t) / 0.5);
    }
    // entrada y salida de cada referencia
    if (t < 0.35) escala = suave(t / 0.35);
    if (t > dur) escala = 1 - suave((t - dur) / CAMBIO);
    return { i, despiece, rotulo, escala: Math.max(0.001, escala) };
  }

  const reducido = window.matchMedia("(prefers-reduced-motion: reduce)");
  let ancho = 0, alto = 0, visible = !document.hidden, inicio = performance.now(), ultimoCuadro = 0, actual = -1;
  let rv = visor.getBoundingClientRect();
  const medir = () => { rv = visor.getBoundingClientRect(); };
  function redimensionar() {
    ancho = window.innerWidth; alto = window.innerHeight;
    renderer.setSize(ancho, alto, false);
    camara.aspect = ancho / alto;
    camara.updateProjectionMatrix();
    medir();
  }
  window.addEventListener("resize", redimensionar);
  window.addEventListener("scroll", medir, { passive: true });
  redimensionar();

  const alturaVisible = () => 2 * camara.position.z * Math.tan(MathUtils.degToRad(camara.fov / 2));
  function pantallaAMundo(x, y, d) {
    const h = alturaVisible(), w = h * camara.aspect;
    return d.set((x / ancho - 0.5) * w, (0.5 - y / alto) * h, 0);
  }
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; if (visible) requestAnimationFrame(bucle); });

  const elementos = {};
  if (rotulos) rotulos.querySelectorAll("[data-rotulo]").forEach((el) => { elementos[el.dataset.rotulo] = el; });

  const v = new Vector3(), cv = new Vector3(), cf = new Vector3();
  let opacidadPrevia = -1;
  function bucle(ahora) {
    if (!visible) return;
    requestAnimationFrame(bucle);
    const b = suave(clamp(1 - rv.bottom / (alto * 0.55))); // 0 = protagonista, 1 = fondo
    if (b > 0.98 && ahora - ultimoCuadro < 33) return;     // de fondo, ~30 cuadros por segundo
    ultimoCuadro = ahora;

    const s = (ahora - inicio) / 1000;
    const e = reducido.matches ? { i: 0, despiece: 0, rotulo: 0, escala: 1 } : estado(s);
    const m = modelos[e.i];
    if (e.i !== actual) {
      modelos.forEach((x, k) => { x.grupo.visible = k === e.i; });
      actual = e.i;
      if (leyenda) leyenda.innerHTML = `<strong>${m.nombre}</strong><span>${m.detalle}</span>`;
      if (rotulos) rotulos.dataset.modelo = m.desarmable ? "casquillo" : "enteriza";
    }
    const despiece = e.despiece * (1 - b);

    pantallaAMundo(rv.left + rv.width / 2, rv.top + rv.height / 2, cv);
    pantallaAMundo(ancho * 0.5, alto * 0.5, cf);
    const hVisor = (rv.height / alto) * alturaVisible();
    const escalaPortada = (hVisor * 0.86) / (40 + despiece * 18);
    const escalaFondo = (alturaVisible() * 0.9) / 40;
    pivote.position.lerpVectors(cv, cf, b);
    pivote.scale.setScalar(lerp(escalaPortada, escalaFondo, b));
    giro.scale.setScalar(e.escala);
    giro.rotation.y = (reducido.matches ? 0.6 : s * 0.35) + window.scrollY * 0.0012 + (1 - e.escala) * 2.5;
    pivote.rotation.x = lerp(0.06, 0.2, b);

    if (m.desarmable) {
      m.casquillo.position.y = -despiece * 8;
      m.espiga.position.y = despiece * 10;
    }

    const op = lerp(1, 0.4, b);
    if (Math.abs(op - opacidadPrevia) > 0.004) { lienzo.style.opacity = op.toFixed(3); opacidadPrevia = op; }

    if (rotulos) {
      const opRot = e.rotulo * (1 - b) * (e.escala > 0.95 ? 1 : 0);
      rotulos.style.opacity = opRot.toFixed(2);
      if (opRot > 0.01) {
        escena.updateMatrixWorld();
        for (const [n, a] of Object.entries(m.anclas)) {
          const el = elementos[n];
          if (!el) continue;
          v.copy(a.punto); a.pieza.localToWorld(v); v.project(camara);
          el.style.transform = `translate(${((v.x + 1) / 2) * ancho}px, ${((1 - v.y) / 2) * alto}px)`;
        }
      }
    }
    renderer.render(escena, camara);
  }
  requestAnimationFrame(bucle);
}
