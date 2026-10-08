/**
 * Cupones del sorteo listos para imprimir (solo administradores).
 * Hoja carta, 24 cupones por hoja (3 × 8), líneas punteadas para recortar.
 * Cada urna empieza en una hoja nueva; los del viaje llevan una banda negra.
 */
import { llamar, sesion } from './api.js';
import { $, h, svgEl } from './dom.js';
import { fechaCorta, fechaHora } from './formato.js';

const POR_HOJA = 24;
let datos = null;

function cedulaConPuntos(c) {
  return String(c).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function avion() {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'avion' });
  svg.append(svgEl('path', { d: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z' }));
  return svg;
}

function boleto(c, urna) {
  const viaje = urna.tipo === 'austral';
  return h('div', { class: 'boleto' + (viaje ? ' boleto--viaje' : '') },
    viaje
      ? h('div', { class: 'boleto__banda' }, avion(), h('span', {}, 'VIAJE TODO INCLUIDO'), h('span', { class: 'boleto__marca' }, 'PROSEIN'))
      : h('div', { class: 'boleto__cab' }, h('span', { class: 'boleto__marca' }, 'PROSEIN'), h('span', {}, `COPA · URNA ${urna.nombre.toUpperCase()}`)),
    h('div', { class: 'boleto__codigo' }, c.codigo),
    h('div', { class: 'boleto__nombre' }, c.vendedor),
    h('div', { class: 'boleto__dato' }, `C.I. ${cedulaConPuntos(c.cedula)}${c.sucursal ? ' · ' + c.sucursal : ''}`),
    h('div', { class: 'boleto__dato boleto__dato--pie' }, `Fact. ${c.factura} · ${fechaCorta(c.dia_venta)} · N° ${c.n}`));
}

function hojasDeUrna(urna, provisional) {
  const paginas = Math.max(1, Math.ceil(urna.cupones.length / POR_HOJA));
  const hojas = [];
  for (let p = 0; p < paginas; p++) {
    const lote = urna.cupones.slice(p * POR_HOJA, (p + 1) * POR_HOJA);
    const desde = lote[0];
    const hasta = lote[lote.length - 1];
    hojas.push(h('section', { class: 'hoja' + (urna.tipo === 'austral' ? ' hoja--viaje' : ''), 'aria-label': `${urna.nombre}, hoja ${p + 1} de ${paginas}` },
      h('div', { class: 'hoja__cab' },
        h('strong', {}, `Urna ${urna.nombre}`),
        h('span', {}, lote.length ? `${desde.codigo} a ${hasta.codigo}` : 'sin cupones'),
        h('span', {}, `Hoja ${p + 1} de ${paginas}`),
        provisional ? h('span', { class: 'hoja__provisional' }, 'PROVISIONAL') : null),
      h('div', { class: 'rejilla' }, lote.map((c) => boleto(c, urna)))));
  }
  return hojas;
}

function pintar() {
  const elegida = $('#urna').value;
  const urnas = datos.urnas.filter((u) => elegida === 'todas' || u.id === elegida);
  const conCupones = urnas.filter((u) => u.cupones.length);
  const total = conCupones.reduce((t, u) => t + u.cupones.length, 0);
  const hojas = conCupones.reduce((t, u) => t + Math.ceil(u.cupones.length / POR_HOJA), 0);
  $('#resumen').textContent = total
    ? `${total} cupones en ${hojas} ${hojas === 1 ? 'hoja' : 'hojas'} · generados el ${fechaHora(datos.generado)}`
    : 'No hay cupones en esta urna todavía.';
  $('#imprimir').disabled = !total;
  $('#hojas').replaceChildren(...conCupones.flatMap((u) => hojasDeUrna(u, datos.provisional)));
  document.title = `Cupones ${elegida === 'todas' ? 'del sorteo' : urnas[0] ? urnas[0].nombre : ''} · Copa Prosein`;
}

function mostrarAviso(texto, conEnlace) {
  const aviso = $('#aviso');
  aviso.hidden = false;
  aviso.replaceChildren(texto, conEnlace ? h('a', { href: './' }, ' Ir al portal') : '');
}

async function iniciar() {
  const s = sesion.leer();
  if (!s) {
    $('#resumen').textContent = '';
    mostrarAviso('Ingresa al portal con tu cuenta de administrador y vuelve a abrir esta página.', true);
    return;
  }
  const r = await llamar('adminCupones', { urna: 'todas' }, { timeout: 60000 });
  if (!r.ok) {
    $('#resumen').textContent = '';
    mostrarAviso(r.message || 'No pudimos cargar los cupones.', r.code === 'AUTH' || r.code === 'FORBIDDEN');
    return;
  }
  datos = r.data;
  const select = $('#urna');
  select.replaceChildren(
    h('option', { value: 'todas' }, 'Todas las urnas'),
    ...datos.urnas.map((u) => h('option', { value: u.id }, `${u.tipo === 'austral' ? u.nombre : 'Urna ' + u.nombre} (${u.cupones.length})`)));
  const pedida = new URLSearchParams(location.search).get('urna');
  if (pedida && datos.urnas.some((u) => u.id === pedida)) select.value = pedida;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('urna', select.value);
    history.replaceState(null, '', url);
    pintar();
  });
  if (datos.provisional) {
    mostrarAviso('Provisional: el concurso no ha llegado al corte final, así que las categorías todavía pueden cambiar. Las hojas impresas dirán PROVISIONAL.');
  }
  $('#imprimir').addEventListener('click', () => window.print());
  pintar();
}

iniciar();
