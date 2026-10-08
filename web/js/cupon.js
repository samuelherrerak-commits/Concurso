/**
 * Ver un cupón otra vez (sin la animación de la impresora) y descargarlo como imagen.
 * La imagen se dibuja en un <canvas> con las mismas filas que el ticket en pantalla.
 */
import { $, h, icono, prepararDialogo, avisar, cargando } from './dom.js';
import { crearTicket, contenidoTicket, barras } from './ticket.js';

const ESCALA = 3; // nitidez de la imagen (3× el tamaño en pantalla)
const ANCHO = 280;
const RELLENO = 20;
const MARGEN = 28;
const DIENTE = 12;
const COLORES = {
  fondo: '#EFEDE8',
  papel: '#FFFDF6',
  tinta: '#2A2926',
  tinta2: '#6B6860',
  linea: '#C9C4B8',
  rojo: '#DF1630',
  azul: '#0B5CD5',
};
const ALTO = { marca: 28, sub: 18, corte: 17, fila: 17.4, sello: 70, barras: 46, gracias: 26 };

let dialogo = null;
let actual = null;

// ---------- Imagen ----------

async function cargarFuentes() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([
      document.fonts.load('400 12px "Chivo Mono"'),
      document.fonts.load('700 12px "Chivo Mono"'),
      document.fonts.load('800 20px Archivo', 'PROSEIN'),
    ]);
  } catch { /* se dibuja con la fuente de respaldo */ }
}

function recortar(ctx, texto, max) {
  if (ctx.measureText(texto).width <= max) return texto;
  let t = texto;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

function espaciado(ctx, texto, x, y, espacio, alinear = 'center') {
  const anchos = [...texto].map((c) => ctx.measureText(c).width);
  const total = anchos.reduce((a, b) => a + b, 0) + espacio * (texto.length - 1);
  let pos = alinear === 'center' ? x - total / 2 : x;
  const antes = ctx.textAlign;
  ctx.textAlign = 'left';
  [...texto].forEach((c, i) => { ctx.fillText(c, pos, y); pos += anchos[i] + espacio; });
  ctx.textAlign = antes;
}

function caminoPapel(ctx, x, y, w, alto) {
  const dientes = Math.round(w / DIENTE);
  const paso = w / dientes;
  const medio = DIENTE / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + medio);
  for (let i = 0; i < dientes; i++) {
    ctx.lineTo(x + i * paso + paso / 2, y);
    ctx.lineTo(x + (i + 1) * paso, y + medio);
  }
  ctx.lineTo(x + w, y + alto - medio);
  for (let i = dientes; i > 0; i--) {
    ctx.lineTo(x + i * paso - paso / 2, y + alto);
    ctx.lineTo(x + (i - 1) * paso, y + alto - medio);
  }
  ctx.closePath();
}

function rectRedondeado(ctx, x, y, w, alto, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + alto, r);
  ctx.arcTo(x + w, y + alto, x, y + alto, r);
  ctx.arcTo(x, y + alto, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Dibuja el ticket y devuelve un PNG (Blob). */
export async function imagenTicket(d) {
  await cargarFuentes();
  const filas = contenidoTicket(d);
  const tinta = d.tipo === 'austral' ? COLORES.azul : COLORES.rojo;
  const altoPapel = RELLENO + filas.reduce((t, f) => t + ALTO[f.t], 0) + RELLENO + DIENTE / 2;
  const lienzo = document.createElement('canvas');
  lienzo.width = (ANCHO + MARGEN * 2) * ESCALA;
  lienzo.height = (altoPapel + MARGEN * 2) * ESCALA;
  const ctx = lienzo.getContext('2d');
  ctx.scale(ESCALA, ESCALA);
  ctx.fillStyle = COLORES.fondo;
  ctx.fillRect(0, 0, ANCHO + MARGEN * 2, altoPapel + MARGEN * 2);

  // Papel con sombra suave y bordes dentados
  ctx.save();
  ctx.shadowColor = 'rgba(20, 22, 24, 0.16)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  caminoPapel(ctx, MARGEN, MARGEN, ANCHO, altoPapel);
  ctx.fillStyle = COLORES.papel;
  ctx.fill();
  ctx.restore();

  const x0 = MARGEN + RELLENO;
  const x1 = MARGEN + ANCHO - RELLENO;
  const xc = MARGEN + ANCHO / 2;
  let y = MARGEN + RELLENO;
  ctx.textBaseline = 'middle';

  filas.forEach((f) => {
    const alto = ALTO[f.t];
    const medio = y + alto / 2;
    if (f.t === 'marca') {
      ctx.fillStyle = COLORES.tinta;
      ctx.font = '800 20px Archivo, "Arial Black", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.texto, xc, medio);
    } else if (f.t === 'sub') {
      ctx.fillStyle = d.tipo === 'austral' ? COLORES.azul : COLORES.tinta2;
      ctx.font = '400 11px "Chivo Mono", monospace';
      espaciado(ctx, f.texto, xc, medio, 2);
    } else if (f.t === 'corte') {
      ctx.save();
      ctx.strokeStyle = COLORES.linea;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, medio);
      ctx.lineTo(x1, medio);
      ctx.stroke();
      ctx.restore();
    } else if (f.t === 'fila') {
      ctx.font = '400 12px "Chivo Mono", monospace';
      ctx.fillStyle = COLORES.tinta2;
      ctx.textAlign = 'left';
      ctx.fillText(f.a, x0, medio);
      const anchoEtiqueta = ctx.measureText(f.a).width;
      ctx.fillStyle = COLORES.tinta;
      ctx.textAlign = 'right';
      ctx.fillText(recortar(ctx, String(f.b), x1 - x0 - anchoEtiqueta - 12), x1, medio);
    } else if (f.t === 'sello') {
      ctx.save();
      ctx.translate(xc, medio);
      ctx.rotate(-7 * Math.PI / 180);
      ctx.font = '700 26px "Chivo Mono", monospace';
      const ancho = Math.max(ctx.measureText(f.abajo).width, 90) + 32;
      const altoSello = 54;
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = tinta;
      ctx.lineWidth = 1.2;
      rectRedondeado(ctx, -ancho / 2, -altoSello / 2, ancho, altoSello, 10);
      ctx.stroke();
      rectRedondeado(ctx, -ancho / 2 + 2.6, -altoSello / 2 + 2.6, ancho - 5.2, altoSello - 5.2, 8);
      ctx.stroke();
      ctx.fillStyle = tinta;
      ctx.textAlign = 'center';
      ctx.font = '700 10px "Chivo Mono", monospace';
      espaciado(ctx, f.arriba, 0, -11, 2);
      ctx.font = '700 26px "Chivo Mono", monospace';
      ctx.fillText(f.abajo, 0, 9);
      ctx.restore();
    } else if (f.t === 'barras') {
      ctx.fillStyle = COLORES.tinta;
      const ancho = 196;
      const ox = xc - ancho / 2;
      barras(f.semilla).forEach(([pos, w]) => ctx.fillRect(ox + (pos / 200) * ancho, y + 6, (w / 200) * ancho, 30));
      ctx.fillStyle = COLORES.tinta2;
      ctx.font = '400 10px "Chivo Mono", monospace';
      espaciado(ctx, f.codigo, xc, y + 42, 3);
    } else if (f.t === 'gracias') {
      ctx.fillStyle = COLORES.tinta;
      ctx.font = '700 12px "Chivo Mono", monospace';
      espaciado(ctx, f.texto, xc, medio + 2, 0.8);
    }
    y += alto;
  });

  return new Promise((resolve, reject) => lienzo.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen.'))), 'image/png'));
}

function nombreArchivo(d) {
  return `${d.tipo === 'austral' ? 'cupon-viaje' : 'cupon'}-copa-prosein-${String(d.n).padStart(2, '0')}.png`;
}

export async function descargarTicket(d) {
  const blob = await imagenTicket(d);
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombreArchivo(d), style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function compartirTicket(d) {
  const blob = await imagenTicket(d);
  const archivo = new File([blob], nombreArchivo(d), { type: 'image/png' });
  await navigator.share({ files: [archivo], title: d.tipo === 'austral' ? 'Mi cupón del viaje · Copa Prosein' : 'Mi cupón · Copa Prosein' });
}

function puedeCompartir() {
  try {
    const prueba = new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' });
    return !!(navigator.canShare && navigator.canShare({ files: [prueba] }));
  } catch {
    return false;
  }
}

// ---------- Visor ----------

function preparar() {
  if (dialogo) return dialogo;
  const dlg = $('#dlg-cupon');
  dialogo = prepararDialogo(dlg);
  $('#cupon-escena').addEventListener('click', (e) => { if (e.target.id === 'cupon-escena') dialogo.cerrar('fondo'); });
  $('#cupon-descargar').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    cargando(boton, true, 'Preparando imagen…');
    try {
      await descargarTicket(actual);
      avisar('Listo: el cupón se descargó como imagen.');
    } catch {
      avisar('No pudimos crear la imagen. Intenta de nuevo.', { tipo: 'error' });
    } finally {
      cargando(boton, false, 'Descargar imagen');
    }
  });
  const compartir = $('#cupon-compartir');
  compartir.hidden = !puedeCompartir();
  compartir.addEventListener('click', async () => {
    try {
      await compartirTicket(actual);
    } catch (err) {
      if (!err || err.name !== 'AbortError') avisar('No se pudo compartir. Usa “Descargar imagen”.', { tipo: 'error' });
    }
  });
  return dialogo;
}

/** Abre el ticket de un cupón ya ganado, sin animación de impresión. */
export function verCupon(d) {
  const ctl = preparar();
  actual = d;
  $('#cupon-titulo').textContent = d.tipo === 'austral' ? `Cupón del viaje N° ${d.n}` : `Cupón N° ${d.n}`;
  $('#cupon-ticket').replaceChildren(crearTicket(d));
  $('#cupon-nota').replaceChildren(d.tipo === 'austral'
    ? h('span', {}, icono('ticket'), 'Este cupón entra a la urna del viaje si estás en la categoría que participa al cierre.')
    : h('span', {}, icono('ticket'), 'Cada cupón es una participación en el sorteo final de tu categoría.'));
  ctl.abrir();
}
