/**
 * Cupones de la Copa Navideña listos para imprimir (solo administradores).
 * Hoja carta, 24 cupones por hoja (3 × 8), líneas punteadas para recortar.
 * Cada sorteo empieza en una hoja nueva. Los del Gran Sorteo Final llevan una
 * banda roja; los cupones Austral (en la misma bolsa del final) una banda negra y los
 * de mejor vendedor una banda dorada.
 */
import { llamar, sesion } from './api.js';
import { $, h } from './dom.js';
import { fechaCorta, fechaHora } from './formato.js';

const POR_HOJA = 24;
let datos = null;

/** "AUSTRAL - PROSEIN": Austral en azul y Prosein en rojo. */
const marca = () => h('span', { class: 'boleto__marca' }, h('span', { class: 'boleto__austral' }, 'AUSTRAL'), ' - ', h('span', { class: 'boleto__prosein' }, 'PROSEIN'));

function cedulaConPuntos(c) {
  return String(c).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function cabecera(bolsa, c) {
  if (c.origen === 'austral') return h('div', { class: 'boleto__banda' }, h('span', {}, 'CUPÓN AUSTRAL'), marca());
  if (c.origen === 'mejor_vendedor') return h('div', { class: 'boleto__banda boleto__banda--mejor' }, h('span', {}, 'MEJOR VENDEDOR'), marca());
  if (bolsa.tipo === 'final') return h('div', { class: 'boleto__banda boleto__banda--final' }, h('span', {}, 'GRAN SORTEO FINAL'), marca());
  return h('div', { class: 'boleto__cab' }, marca(), h('span', {}, bolsa.nombre.toUpperCase()));
}

function pie(c, bolsa) {
  if (c.origen === 'austral') return `Fact. ${c.factura} · ${fechaCorta(c.dia_venta)} · Austral N° ${c.n}`;
  if (c.origen === 'mejor_vendedor') return `Mejor vendedor de su canal · ${c.ronda}`;
  if (bolsa.tipo === 'final') return `Cupón final ${c.n} de ${c.de} · ${fechaCorta(bolsa.fecha)}`;
  return `Fact. ${c.factura} · ${fechaCorta(c.dia_venta)} · N° ${c.n}`;
}

function boleto(c, bolsa) {
  const clase = c.origen === 'austral' ? ' boleto--viaje' : c.origen === 'mejor_vendedor' ? ' boleto--mejor' : bolsa.tipo === 'final' ? ' boleto--final' : '';
  return h('div', { class: 'boleto' + clase },
    cabecera(bolsa, c),
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
        h('strong', {}, `Copa Navideña · ${bolsa.nombre}${bolsa.fecha ? ' · sorteo ' + fechaCorta(bolsa.fecha) : ''}`),
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
    ? `Provisional: ${provisionales.join(', ')} todavía no ${provisionales.length === 1 ? 'ha cerrado' : 'han cerrado'}, así que los cupones pueden cambiar. Las hojas impresas dirán PROVISIONAL.`
    : '';
  document.title = `Cupones ${elegida === 'todas' ? 'de los sorteos' : bolsas[0] ? bolsas[0].nombre : ''} · Copa Navideña`;
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
