/** Render del panel del vendedor: resumen, cupones, ventas, ranking y reglas. */
import { $, $$, h, icono } from './dom.js';
import { dinero, decimal, fechaCorta, fechaLarga, fechaMedia, diaMes, rango, plural, iniciales, ordinal } from './formato.js';
import { crearMini } from './ticket.js';

let pestanaRanking = 'semana';
let ultimoRanking = null;

// ---------- Cabecera ----------

export function pintarCabecera(datos) {
  const { usuario, concurso } = datos;
  const primerNombre = usuario.nombre.split(' ')[0];
  $('#saludo-titulo').textContent = `Hola, ${primerNombre}`;
  $('#saludo-semana').textContent = textoSemana(concurso);
  $('#avatar-iniciales').textContent = iniciales(usuario.nombre, usuario.apellido).toUpperCase();
  $('#menu-nombre').textContent = `${usuario.nombre} ${usuario.apellido}`;
  $('#menu-cedula').textContent = `C.I. ${usuario.cedula_mask}` + (usuario.sucursal ? ` · ${usuario.sucursal}` : '');
}

function textoSemana(c) {
  const s = c.semana_actual;
  if (!s || s.estado === 'antes') return `La Copa arranca el ${fechaLarga(c.fecha_inicio)}`;
  if (s.estado === 'terminado') return c.fecha_sorteo ? `La Copa terminó · sorteo el ${fechaLarga(c.fecha_sorteo)}` : 'La Copa terminó';
  return `Semana ${s.numero} de ${s.total} · ${rango(s.inicio, s.fin)}`;
}

// ---------- Resumen (el recibo de la cuenta) ----------

function renglon(etiqueta, valor, clase = '') {
  return h('div', { class: 'renglon ' + clase }, h('dt', {}, etiqueta), h('dd', {}, valor));
}

export function pintarResumen(datos) {
  const { resumen: r, concurso: c } = datos;
  const caja = $('#resumen');
  caja.setAttribute('aria-busy', 'false');
  const M = c.monto_por_cupon;
  const lineas = [
    renglon('TOTAL VENDIDO', dinero(r.total)),
    renglon('AUSTRAL (m²)', `${decimal(r.m2)} m²`, 'renglon--austral'),
  ];
  if (r.semana && r.semana.numero) {
    lineas.push(renglon('ESTA SEMANA', `${plural(r.semana.cupones, 'cupón', 'cupones')} · ${dinero(r.semana.monto, { compacto: true })}`));
    if (r.semana.posicion && datos.ranking && datos.ranking.semana) {
      lineas.push(renglon('PUESTO SEMANAL', `${ordinal(r.semana.posicion)} de ${datos.ranking.semana.participantes}`));
    }
  }
  if (c.contar_solo_aprobadas && r.ventas_pendientes > 0) {
    lineas.push(renglon('EN REVISIÓN', `${dinero(r.monto_pendiente, { compacto: true })} · ${plural(r.ventas_pendientes, 'factura', 'facturas')}`));
  }

  caja.replaceChildren(
    h('div', { class: 'resumen__titulo' }, h('span', { id: 'resumen-titulo' }, 'Tus cupones'), icono('ticket')),
    h('div', { class: 'resumen__cupones' },
      h('span', { class: 'resumen__numero', id: 'resumen-numero' }, String(r.cupones)),
      h('span', { class: 'resumen__unidad' }, r.cupones === 1 ? 'cupón para el sorteo' : 'cupones para el sorteo')),
    h('hr', { class: 'corte' }),
    h('div', { class: 'progreso' },
      h('div', { class: 'progreso__cab' }, h('span', {}, 'Próximo cupón'), h('span', {}, `${dinero(r.sobrante, { compacto: true })} de ${dinero(M, { compacto: true })}`)),
      h('div', { class: 'progreso__barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(M), 'aria-valuenow': String(r.sobrante), 'aria-label': 'Avance hacia el próximo cupón' },
        h('div', { class: 'progreso__relleno', style: { transform: `scaleX(${Math.min(1, r.progreso)})` } })),
      h('p', { class: 'progreso__pie' }, 'Te faltan ', h('strong', {}, dinero(r.falta_para_proximo, { compacto: true })), ' en ventas.')),
    h('hr', { class: 'corte' }),
    h('dl', {}, lineas));
}

export function pintarEsqueleto() {
  const caja = $('#resumen');
  caja.setAttribute('aria-busy', 'true');
  const barra = (w, alto = 14, extra = {}) => h('div', { class: 'esqueleto', style: { width: w, height: alto + 'px', ...extra } });
  caja.replaceChildren(
    barra('40%', 12),
    barra('30%', 56, { marginTop: '12px' }),
    h('hr', { class: 'corte' }),
    barra('100%', 10, { marginTop: '8px' }),
    barra('55%', 12, { marginTop: '10px' }),
    h('hr', { class: 'corte' }),
    barra('100%', 12, { marginTop: '6px' }),
    barra('100%', 12, { marginTop: '12px' }),
    barra('100%', 12, { marginTop: '12px' }));
  $('#cupones').replaceChildren(h('div', { class: 'cupones' }, [0, 1, 2].map(() => h('div', { class: 'esqueleto', style: { width: '112px', height: '104px', flex: 'none' } }))));
  $('#ventas').replaceChildren(h('div', { style: { padding: '16px', display: 'grid', gap: '14px' } }, [0, 1, 2].map(() => barra('100%', 40))));
  $('#cupones-cuenta').textContent = '';
  $('#ventas-cuenta').textContent = '';
}

export function pintarErrorCarga(mensaje, reintentar) {
  const caja = $('#resumen');
  caja.setAttribute('aria-busy', 'false');
  caja.replaceChildren(h('div', { class: 'error-carga' },
    h('p', {}, mensaje),
    h('button', { class: 'btn btn--secundario', type: 'button', onclick: reintentar }, icono('recargar'), 'Reintentar')));
  $('#cupones').replaceChildren();
  $('#ventas').replaceChildren();
}

// ---------- Acción principal ----------

export function pintarAccion(datos) {
  const c = datos.concurso;
  const boton = $('#btn-registrar');
  const nota = $('#accion-nota');
  let motivo = '';
  if (!c.concurso_abierto) motivo = 'La carga de ventas está cerrada.';
  else if (c.hoy < c.fecha_inicio) motivo = `Podrás registrar ventas desde el ${fechaLarga(c.fecha_inicio)}.`;
  boton.disabled = !!motivo;
  nota.hidden = !motivo;
  nota.textContent = motivo;
}

// ---------- Mis cupones ----------

export function pintarCupones(datos, { nuevosDesde = Infinity } = {}) {
  const lista = datos.cupones.slice().reverse();
  const total = datos.cupones.length;
  $('#cupones-cuenta').textContent = total ? plural(total, 'cupón', 'cupones') : '';
  const caja = $('#cupones');
  if (!total) {
    caja.replaceChildren(h('div', { class: 'cupones__vacio' },
      h('div', { class: 'mini sombra-papel', 'aria-hidden': 'true' }, h('div', { class: 'papel' }, h('div', { class: 'mini__titulo' }, 'CUPÓN'), h('div', { class: 'mini__n' }, 'N° 01'))),
      h('p', {}, 'Tu primer cupón se imprime cuando llegues a ', h('strong', {}, dinero(datos.concurso.monto_por_cupon, { compacto: true })), ' en ventas.')));
    return;
  }
  caja.replaceChildren(h('div', { class: 'cupones', role: 'list', 'aria-label': 'Mis cupones' },
    lista.map((c) => crearMini({ n: c.n, dia: diaMes(c.dia_venta), factura: c.factura, nuevo: c.n > nuevosDesde }))));
}

// ---------- Mis ventas ----------

function chipEstado(estado) {
  return h('span', { class: `chip chip--${estado}` }, estado === 'Aprobada' ? 'Aprobada' : estado === 'Rechazada' ? 'Rechazada' : 'Pendiente');
}

function chipAustral(m2) {
  return h('span', { class: 'chip chip--austral' }, `Austral ${decimal(m2)} m²`);
}

export function pintarVentas(datos, { verFoto }) {
  const ventas = datos.registros;
  $('#ventas-cuenta').textContent = ventas.length ? plural(ventas.length, 'factura', 'facturas') : '';
  const caja = $('#ventas');
  if (!ventas.length) {
    caja.replaceChildren(h('div', { class: 'vacio' }, h('strong', {}, 'Todavía no has registrado ventas'), 'Toca “Registrar venta” y sube la foto de tu primera factura.'));
    return;
  }
  const botonFoto = (v) => (v.tiene_foto
    ? h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: () => verFoto(v) }, 'Ver foto')
    : null);

  const lista = h('ul', { class: 'ventas' }, ventas.map((v) => h('li', { class: 'venta' },
    h('div', {}, h('div', { class: 'venta__factura' }, `Factura ${v.numero_factura}`), h('div', { class: 'venta__fecha' }, fechaMedia(v.dia_venta))),
    h('div', { class: 'venta__monto' }, dinero(v.monto)),
    h('div', { class: 'venta__chips' }, chipEstado(v.estado), v.vendio_austral ? chipAustral(v.m2_austral) : null),
    h('div', { class: 'venta__accion' }, botonFoto(v)),
    v.estado === 'Rechazada' && v.nota_admin ? h('p', { class: 'venta__nota' }, `Motivo: ${v.nota_admin}`) : null)));

  const tabla = h('table', { class: 'ventas-tabla' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Factura'), h('th', {}, 'Estado'), h('th', {}, 'Austral'), h('th', { class: 'num' }, 'Monto'), h('th', {}, h('span', { class: 'sr-only' }, 'Foto')))),
    h('tbody', {}, ventas.map((v) => h('tr', {},
      h('td', {}, fechaCorta(v.dia_venta)),
      h('td', {}, v.numero_factura, v.estado === 'Rechazada' && v.nota_admin ? h('span', { class: 'nota' }, v.nota_admin) : null),
      h('td', {}, chipEstado(v.estado)),
      h('td', {}, v.vendio_austral ? `${decimal(v.m2_austral)} m²` : '—'),
      h('td', { class: 'num' }, dinero(v.monto)),
      h('td', { class: 'num' }, botonFoto(v))))));

  caja.replaceChildren(lista, tabla);
}

// ---------- Ranking ----------

export function pintarRanking(datos) {
  const seccion = $('#seccion-ranking');
  if (!datos.ranking) { seccion.hidden = true; return; }
  seccion.hidden = false;
  ultimoRanking = datos;
  const pestanas = $$('#pestanas-ranking [data-ranking]');
  const semanaBtn = pestanas.find((b) => b.dataset.ranking === 'semana');
  semanaBtn.hidden = !datos.ranking.semana;
  if (!datos.ranking.semana && pestanaRanking === 'semana') pestanaRanking = 'general';
  pestanas.forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.ranking === pestanaRanking));
    b.onclick = () => { pestanaRanking = b.dataset.ranking; pintarRanking(ultimoRanking); };
  });
  $('#ranking').replaceChildren(...contenidoRanking(datos, pestanaRanking).filter(Boolean));
}

function puesto(item, valor, clases = '') {
  return h('li', { class: `puesto ${clases} ${item.es_tu ? 'puesto--tu' : ''}` },
    h('span', { class: 'puesto__pos' }, String(item.pos)),
    h('span', { class: 'puesto__nombre' }, item.nombre),
    h('span', { class: 'puesto__valor' }, valor));
}

function piePosicion(bloque, unidad) {
  if (!bloque.participantes) return null;
  if (bloque.mi_posicion && bloque.mi_posicion <= bloque.top.length) return null;
  return h('p', { class: 'ranking__yo' }, bloque.mi_posicion
    ? ['Vas de ', h('strong', {}, ordinal(bloque.mi_posicion)), ` de ${bloque.participantes}.`]
    : `Aún no apareces: ${unidad}.`);
}

function contenidoRanking(datos, tipo) {
  const r = datos.ranking;
  const c = datos.concurso;
  if (tipo === 'semana' && r.semana) {
    const s = r.semana;
    const nota = h('p', { class: 'ranking__nota' }, `Semana ${s.numero}, del ${rango(s.inicio, s.fin).replace(/\.$/, '')}. Los ${s.premios} que más cupones completen ganan premio.`);
    if (!s.top.length) return [nota, h('div', { class: 'vacio' }, h('strong', {}, 'Nadie ha completado cupones esta semana'), 'El primero en llegar se pone a la cabeza.')];
    const items = [];
    s.top.forEach((x, i) => {
      items.push(puesto(x, h('span', {}, plural(x.cupones, 'cupón', 'cupones')), i < s.premios ? 'puesto--premio' : ''));
      if (i === s.premios - 1 && s.top.length > s.premios) items.push(h('li', { class: 'ranking__corte', 'aria-hidden': 'true' }, 'zona de premio'));
    });
    return [nota, h('ol', { class: 'ranking__lista' }, items), piePosicion(s, 'completa un cupón esta semana')];
  }
  if (tipo === 'austral') {
    const a = r.austral;
    const nota = h('p', { class: 'ranking__nota' }, 'Quien más m² de Austral venda en todo el concurso gana el viaje todo incluido para dos.');
    if (!a.top.length) return [nota, h('div', { class: 'vacio' }, h('strong', {}, 'Todavía no hay ventas de Austral'), 'La primera venta pone a alguien en camino al viaje.')];
    return [nota, h('ol', { class: 'ranking__lista' }, a.top.map((x, i) => puesto(x, `${decimal(x.m2)} m²`, 'puesto--austral' + (i === 0 ? ' puesto--lider' : '')))), piePosicion(a, 'registra una venta Austral')];
  }
  const g = r.general;
  const nota = h('p', { class: 'ranking__nota' }, c.fecha_sorteo ? `Cada cupón es una participación en el sorteo final del ${fechaLarga(c.fecha_sorteo)}.` : 'Cada cupón es una participación en el sorteo final.');
  if (!g.top.length) return [nota, h('div', { class: 'vacio' }, h('strong', {}, 'Todavía no hay ventas registradas'), 'Sé el primero en la tabla.')];
  return [nota, h('ol', { class: 'ranking__lista' }, g.top.map((x) => puesto(x, plural(x.cupones, 'cupón', 'cupones')))), piePosicion(g, 'registra tu primera venta')];
}

// ---------- Reglas ----------

export function pintarReglas(datos) {
  const c = datos.concurso;
  const M = dinero(c.monto_por_cupon, { compacto: true });
  const fuerte = (t) => h('strong', {}, t);
  const items = [
    ['Cada ', fuerte(`${M} en ventas`), ' te da ', fuerte('1 cupón'), ' para el sorteo final. Lo que sobra no se pierde: se suma a tus próximas ventas.'],
    ['Cada semana, los ', fuerte(`${c.premios_semanales} vendedores que más cupones completen`), ' ganan un premio. Lo que te sobre de una semana cuenta para la siguiente.'],
    ['El ', fuerte('viaje todo incluido para dos'), ' es para quien venda más ', fuerte('m² de mercancía Austral'), ' en todo el concurso.'],
    ['Registra cada factura con su foto. Una factura solo se registra una vez, y el coordinador puede rechazar las que no se lean bien.'],
  ];
  if (c.contar_solo_aprobadas) items.push(['Tus cupones cuentan cuando el coordinador aprueba la factura.']);
  if (c.fecha_sorteo) items.push(['El sorteo final es el ', fuerte(fechaLarga(c.fecha_sorteo)), '.']);
  $('#reglas-lista').replaceChildren(...items.map((partes) => h('li', {}, partes)));
}
