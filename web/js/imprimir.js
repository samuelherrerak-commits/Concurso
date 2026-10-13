/**
 * Cupones de La bolsa de los deseos listos para imprimir (solo administradores).
 * Hoja carta, 24 cupones por hoja (3 × 8), líneas punteadas para recortar.
 * Cada sorteo empieza en una hoja nueva. Los del Gran Sorteo Final llevan una
 * banda roja y los del viaje una banda negra, para no mezclarlos.
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

function cabecera(bolsa) {
  if (bolsa.tipo === 'austral') return h('div', { class: 'boleto__banda' }, avion(), h('span', {}, 'VIAJE TODO INCLUIDO'), h('span', { class: 'boleto__marca' }, 'PROSEIN'));
  if (bolsa.tipo === 'final') return h('div', { class: 'boleto__banda boleto__banda--final' }, h('span', {}, 'GRAN SORTEO FINAL'), h('span', { class: 'boleto__marca' }, 'PROSEIN'));
  return h('div', { class: 'boleto__cab' }, h('span', { class: 'boleto__marca' }, 'PROSEIN'), h('span', {}, bolsa.nombre.toUpperCase()));
}

function pie(c, bolsa) {
  if (bolsa.tipo === 'final') return `Cupón final ${c.n} de ${c.de} · ${fechaCorta(bolsa.fecha)}`;
  return `Fact. ${c.factura} · ${fechaCorta(c.dia_venta)} · N° ${c.n}`;
}

function boleto(c, bolsa) {
  const clase = bolsa.tipo === 'austral' ? ' boleto--viaje' : bolsa.tipo === 'final' ? ' boleto--final' : '';
  return h('div', { class: 'boleto' + clase },
    cabecera(bolsa),
    h('div', { class: 'boleto__codigo' }, c.codigo),
    h('div', { class: 'boleto__nombre' }, c.vendedor),
    h('div', { class: 'boleto__dato' }, `C.I. ${cedulaConPuntos(c.cedula)}${c.sucursal ? ' · ' + c.sucursal : ''}`),
    h('div', { class: 'boleto__dato boleto__dato--pie' }, pie(c, bolsa)));
}

function hojasDeBolsa(bolsa) {
  const paginas = Math.max(1, Math.ceil(bolsa.cupones.length / POR_HOJA));
  const hojas = [];
  for (let p = 0; p < paginas; p++) {
    const lote = bolsa.cupones.slice(p * POR_HOJA, (p + 1) * POR_HOJA);
    hojas.push(h('section', { class: 'hoja', 'aria-label': `${bolsa.nombre}, hoja ${p + 1} de ${paginas}` },
      h('div', { class: 'hoja__cab' },
        h('strong', {}, `${datos.sorteo} · ${bolsa.nombre}${bolsa.fecha ? ' · sorteo ' + fechaCorta(bolsa.fecha) : ''}`),
        h('span', {}, lote.length ? `${lote[0].codigo} a ${lote[lote.length - 1].codigo}` : 'sin cupones'),
        h('span', {}, `Hoja ${p + 1} de ${paginas}`),
        bolsa.provisional ? h('span', { class: 'hoja__provisional' }, 'PROVISIONAL') : null),
      h('div', { class: 'rejilla' }, lote.map((c) => boleto(c, bolsa)))));
  }
  return hojas;
}

function pintar() {
  const elegida = $('#urna').value;
  const bolsas = datos.bolsas.filter((b) => elegida === 'todas' || b.id === elegida);
  const conCupones = bolsas.filter((b) => b.cupones.length);
  const total = conCupones.reduce((t, b) => t + b.cupones.length, 0);
  const hojas = conCupones.reduce((t, b) => t + Math.ceil(b.cupones.length / POR_HOJA), 0);
  $('#resumen').textContent = total
    ? `${total} cupones en ${hojas} ${hojas === 1 ? 'hoja' : 'hojas'} · generados el ${fechaHora(datos.generado)}`
    : 'No hay cupones en este sorteo todavía.';
  $('#imprimir').disabled = !total;
  $('#hojas').replaceChildren(...conCupones.flatMap(hojasDeBolsa));
  const provisionales = bolsas.filter((b) => b.provisional && b.cupones.length).map((b) => b.nombre);
  const aviso = $('#aviso');
  aviso.hidden = !provisionales.length;
  aviso.textContent = provisionales.length
    ? `Provisional: ${provisionales.join(', ')} todavía no ${provisionales.length === 1 ? 'llega a su corte' : 'llegan a su corte'}, así que los cupones pueden cambiar. Las hojas impresas dirán PROVISIONAL.`
    : '';
  document.title = `Cupones ${elegida === 'todas' ? 'de los sorteos' : bolsas[0] ? bolsas[0].nombre : ''} · La bolsa de los deseos`;
}

function mostrarAviso(texto, conEnlace) {
  const aviso = $('#aviso');
  aviso.hidden = false;
  aviso.replaceChildren(texto, conEnlace ? h('a', { href: './' }, ' Ir al portal') : '');
}

async function iniciar() {
  if (!sesion.leer()) {
    $('#resumen').textContent = '';
    mostrarAviso('Ingresa al portal con tu cuenta de administrador y vuelve a abrir esta página.', true);
    return;
  }
  const r = await llamar('adminCupones', { bolsa: 'todas' }, { timeout: 60000 });
  if (!r.ok) {
    $('#resumen').textContent = '';
    mostrarAviso(r.message || 'No pudimos cargar los cupones.', r.code === 'AUTH' || r.code === 'FORBIDDEN');
    return;
  }
  datos = r.data;
  const select = $('#urna');
  select.replaceChildren(
    h('option', { value: 'todas' }, 'Todos los sorteos'),
    ...datos.bolsas.map((b) => h('option', { value: b.id }, `${b.nombre} (${b.cupones.length})`)));
  const pedida = new URLSearchParams(location.search).get('bolsa');
  if (pedida && datos.bolsas.some((b) => b.id === pedida)) select.value = pedida;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('bolsa', select.value);
    history.replaceState(null, '', url);
    pintar();
  });
  $('#imprimir').addEventListener('click', () => window.print());
  pintar();
}

iniciar();
