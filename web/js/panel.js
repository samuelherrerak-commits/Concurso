/** Render del panel del vendedor: resumen, cupones, tickets Austral, ventas, ranking y reglas. */
import { $, $$, h, icono } from './dom.js';
import {
  dinero, decimal, fechaCorta, fechaMedia, diaMes, rango, plural, iniciales, ordinal,
  fechaConDia, momento, enCaracas, conPunto,
} from './formato.js';
import { crearMini } from './ticket.js';

let pestanaRanking = 'ronda';
let ultimoRanking = null;

/** "lun. 9 de nov." → "lunes 9 de nov." para el sorteo de una ronda. */
const diaSorteo = (iso) => fechaConDia(iso);

// ---------- Cabecera ----------

export function pintarCabecera(datos) {
  const { usuario, concurso } = datos;
  const primerNombre = usuario.nombre.split(' ')[0];
  $('#saludo-titulo').textContent = `Hola, ${primerNombre}`;
  $('#saludo-semana').textContent = textoRonda(concurso);
  $('#saludo-corte').textContent = textoCorte(concurso);
  $('#avatar-iniciales').textContent = iniciales(usuario.nombre, usuario.apellido).toUpperCase();
  $('#menu-nombre').textContent = `${usuario.nombre} ${usuario.apellido}`;
  const donde = usuario.canal === 'Tienda' ? usuario.sucursal : usuario.canal_etiqueta;
  $('#menu-cedula').textContent = `C.I. ${usuario.cedula_mask}` + (donde ? ` · ${donde}` : '');
}

/** "Ronda 1 de 3 · 15 oct. al 5 de nov." o "La Ñapa · 11 al 19 de dic." */
export function textoRonda(c) {
  const s = c.ronda_actual;
  if (!s || s.estado === 'antes') return `${c.nombre_sorteo} arranca el ${fechaConDia(c.fecha_inicio)}`;
  if (s.estado === 'terminado') return `Gran Sorteo Final: ${fechaConDia(c.fecha_sorteo_final)}`;
  const nombre = s.con_sorteo ? `${s.nombre} de ${s.total_sorteos}` : s.nombre;
  return `${nombre} · ${rango(s.inicio, s.fin)}`;
}

export function textoCorte(c) {
  const s = c.ronda_actual;
  if (!s || s.estado === 'antes' || s.estado === 'terminado') return '';
  const corte = enCaracas(s.corte);
  const cuando = corte.iso === c.hoy ? `Corte hoy a las ${corte.hora}` : `Corte: ${momento(s.corte)}`;
  return s.con_sorteo ? `${cuando} · sorteo ${diaSorteo(s.sorteo)}` : `${cuando} · sin sorteo, suma para el final`;
}

// ---------- Resumen (el recibo de la cuenta) ----------

function renglon(etiqueta, valor, clase = '') {
  return h('div', { class: 'renglon ' + clase }, h('dt', {}, etiqueta), h('dd', {}, valor));
}

function barra(valor, max, etiqueta, { relleno, marca } = {}) {
  return h('div', { class: 'progreso__barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(valor), 'aria-label': etiqueta },
    h('div', { class: 'progreso__relleno', style: { transform: `scaleX(${Math.min(1, Math.max(0, relleno))})` } }),
    marca ? h('span', { class: 'progreso__marca', style: { left: `${Math.min(100, marca * 100)}%` }, 'aria-hidden': 'true' }) : null);
}

/** Bloque "Gran Sorteo Final": avance de la meta y cupones finales. */
function bloqueFinal(r, c) {
  const m = r.meta;
  const f = r.final;
  const pct = `${decimal(m.porcentaje_requerido)} %`;
  const lineas = [renglon('TICKETS GRAN FINAL', f.austral ? `${f.total} (${f.cupones} + ${f.austral} Austral)` : String(f.total), 'renglon--final')];
  let nota;
  if (m.definida) {
    lineas.push(h('div', { class: 'progreso progreso--meta' },
      h('div', { class: 'progreso__cab' }, h('span', {}, 'Tu meta'), h('span', {}, `${decimal(Math.floor(m.avance * 100))} % de ${dinero(m.meta, { compacto: true })}`)),
      barra(m.vendido, m.meta, 'Avance de tu meta', { relleno: m.avance, marca: m.porcentaje_requerido / 100 })));
  }
  if (!m.cumple) {
    nota = ['Para entrar necesitas vender el ', h('strong', {}, pct), ' de tu meta: te faltan ', h('strong', {}, dinero(m.falta, { compacto: true })), '.'];
    if (f.posibles) nota.push(` Ya tienes ${plural(f.posibles, 'cupón final esperando', 'cupones finales esperando')}.`);
  } else {
    nota = [m.definida ? '¡Ya cumples tu meta! ' : '', `Cada ${f.por_cada} cupones = 1 cupón final. Te `, h('strong', {}, f.faltan_para_proximo === 1 ? 'falta 1 cupón' : `faltan ${f.faltan_para_proximo} cupones`), ' para el próximo.'];
  }
  return [h('dl', {}, lineas), h('p', { class: 'resumen__nota' }, nota)];
}

export function pintarResumen(datos) {
  const { resumen: r, concurso: c } = datos;
  const caja = $('#resumen');
  caja.setAttribute('aria-busy', 'false');
  const M = r.monto_por_cupon;
  const ronda = r.ronda;
  const lineas = [
    renglon('TOTAL VENDIDO', dinero(r.total)),
    renglon('AUSTRAL (m²)', `${decimal(r.m2)} m²`, 'renglon--austral'),
    renglon('TICKETS AUSTRAL', String(r.austral.cupones), 'renglon--austral'),
  ];
  if (ronda.posicion && datos.ranking && datos.ranking.ronda) {
    lineas.push(renglon(`PUESTO ${ronda.nombre.toUpperCase()}`, `${ordinal(ronda.posicion)} de ${datos.ranking.ronda.participantes}`));
  }
  if (c.contar_solo_aprobadas && r.ventas_pendientes > 0) {
    lineas.push(renglon('EN REVISIÓN', `${dinero(r.monto_pendiente, { compacto: true })} · ${plural(r.ventas_pendientes, 'factura', 'facturas')}`));
  }

  const enRonda = [];
  if (ronda.numero) {
    enRonda.push(renglon(ronda.nombre.toUpperCase(), plural(ronda.cupones, 'cupón', 'cupones'), 'renglon--ronda'));
    enRonda.push(h('p', { class: 'resumen__nota' }, ronda.con_sorteo
      ? conPunto(`Entran a la bolsa del sorteo del ${diaSorteo(c.ronda_actual.sorteo)}`)
      : 'La Ñapa no tiene sorteo: tus cupones suman para el Gran Sorteo Final.'));
  }

  caja.replaceChildren(
    h('div', { class: 'resumen__titulo' }, h('span', { id: 'resumen-titulo' }, 'Tus cupones'), icono('ticket')),
    h('div', { class: 'resumen__cupones' },
      h('span', { class: 'resumen__numero', id: 'resumen-numero' }, String(r.cupones)),
      h('span', { class: 'resumen__unidad' }, r.cupones === 1 ? 'cupón acumulado' : 'cupones acumulados')),
    ...(enRonda.length ? [h('dl', { class: 'resumen__categoria' }, enRonda)] : []),
    h('hr', { class: 'corte' }),
    h('div', { class: 'progreso' },
      h('div', { class: 'progreso__cab' }, h('span', {}, 'Próximo cupón'), h('span', {}, `${dinero(r.sobrante, { compacto: true })} de ${dinero(M, { compacto: true })}`)),
      barra(r.sobrante, M, 'Avance hacia el próximo cupón', { relleno: r.progreso }),
      h('p', { class: 'progreso__pie' }, 'Te faltan ', h('strong', {}, dinero(r.falta_para_proximo, { compacto: true })), ' en ventas.')),
    h('hr', { class: 'corte' }),
    ...bloqueFinal(r, c),
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
  const minis = () => h('div', { class: 'cupones' }, [0, 1, 2].map(() => h('div', { class: 'esqueleto', style: { width: '112px', height: '104px', flex: 'none' } })));
  $('#cupones').replaceChildren(minis());
  $('#viaje').replaceChildren(h('div', { style: { padding: '16px', display: 'grid', gap: '12px' } }, barra('60%', 12), barra('100%', 10)));
  $('#ventas').replaceChildren(h('div', { style: { padding: '16px', display: 'grid', gap: '14px' } }, [0, 1, 2].map(() => barra('100%', 40))));
  ['#cupones-cuenta', '#ventas-cuenta', '#viaje-cuenta'].forEach((s) => { $(s).textContent = ''; });
}

export function pintarErrorCarga(mensaje, reintentar) {
  const caja = $('#resumen');
  caja.setAttribute('aria-busy', 'false');
  caja.replaceChildren(h('div', { class: 'error-carga' },
    h('p', {}, mensaje),
    h('button', { class: 'btn btn--secundario', type: 'button', onclick: reintentar }, icono('recargar'), 'Reintentar')));
  ['#cupones', '#viaje', '#ventas'].forEach((s) => $(s).replaceChildren());
}

// ---------- Acción principal ----------

export function pintarAccion(datos) {
  const c = datos.concurso;
  const s = c.ronda_actual;
  const boton = $('#btn-registrar');
  const nota = $('#accion-nota');
  let motivo = '';
  if (!c.concurso_abierto) motivo = 'La carga de ventas está cerrada.';
  else if (s.estado === 'antes') motivo = conPunto(`Podrás registrar ventas desde el ${fechaConDia(c.fecha_inicio)}`);
  else if (!c.dia_max_carga) motivo = s.estado === 'terminado' ? 'La campaña terminó: ya no se cargan ventas.' : 'No hay días abiertos para cargar ventas.';
  boton.disabled = !!motivo;
  nota.hidden = !motivo;
  nota.textContent = motivo;
}

// ---------- Mis cupones y tickets Austral ----------

/** Nombre corto de la ronda de un cupón para el mini ticket ("RONDA 1", "LA ÑAPA"). */
export function nombreRonda(c, numero) {
  const p = c.rondas[numero - 1];
  return p ? p.nombre.toUpperCase() : 'CUPÓN';
}

export function pintarCupones(datos, { nuevosDesde = Infinity, alAbrir } = {}) {
  const lista = datos.cupones.slice().reverse();
  const total = datos.cupones.length;
  $('#cupones-cuenta').textContent = total ? plural(total, 'cupón', 'cupones') : '';
  const caja = $('#cupones');
  if (!total) {
    caja.replaceChildren(h('div', { class: 'cupones__vacio' },
      h('div', { class: 'mini sombra-papel', 'aria-hidden': 'true' }, h('div', { class: 'papel' }, h('div', { class: 'mini__titulo' }, 'CUPÓN'), h('div', { class: 'mini__n' }, 'N° 01'))),
      h('p', {}, 'Tu primer cupón se imprime cuando llegues a ', h('strong', {}, dinero(datos.resumen.monto_por_cupon, { compacto: true })), ' en ventas.')));
    return;
  }
  caja.replaceChildren(
    h('div', { class: 'cupones', 'aria-label': 'Mis cupones. Toca uno para verlo o descargarlo.' },
      lista.map((c) => crearMini({ n: c.n, titulo: nombreRonda(datos.concurso, c.ronda), dia: diaMes(c.dia_venta), factura: c.factura, nuevo: c.n > nuevosDesde, alTocar: () => alAbrir && alAbrir(c, 'normal') }))),
    h('p', { class: 'cupones__ayuda' }, 'Toca un cupón para verlo o descargarlo.'));
}

export function pintarViaje(datos, { nuevosDesde = Infinity, alAbrir } = {}) {
  const { resumen: r, concurso: c } = datos;
  const a = r.austral;
  const caja = $('#viaje');
  const cupones = (datos.cupones_austral || []).slice().reverse();
  $('#viaje-cuenta').textContent = a.cupones ? plural(a.cupones, 'ticket', 'tickets') : '';
  const estado = a.participa
    ? h('p', { class: 'viaje__estado viaje__estado--si' }, icono('check'), conPunto(`Son tickets adicionales para el Gran Sorteo Final del ${fechaConDia(c.fecha_sorteo_final)}`))
    : h('p', { class: 'viaje__estado' }, `Son tickets adicionales para el Gran Sorteo Final: entran cuando llegues al ${decimal(r.meta.porcentaje_requerido)} % de tu meta.`);

  caja.replaceChildren(
    h('div', { class: 'viaje__cuerpo' },
      h('div', { class: 'progreso progreso--austral' },
        h('div', { class: 'progreso__cab' }, h('span', {}, 'Próximo ticket Austral'), h('span', {}, `${decimal(a.sobrante)} de ${decimal(a.m2_por_cupon)} m²`)),
        h('div', { class: 'progreso__barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(a.m2_por_cupon), 'aria-valuenow': String(a.sobrante), 'aria-label': 'Avance hacia el próximo ticket Austral' },
          h('div', { class: 'progreso__relleno', style: { transform: `scaleX(${Math.min(1, a.progreso)})` } })),
        h('p', { class: 'progreso__pie' }, 'Te faltan ', h('strong', {}, `${decimal(a.falta)} m²`), ' de Austral. Cada ', `${decimal(a.m2_por_cupon)} m²`, ' es 1 ticket.')),
      estado),
    cupones.length
      ? h('div', { class: 'cupones cupones--viaje', 'aria-label': 'Tickets Austral' },
        cupones.map((x) => crearMini({ n: x.n, dia: diaMes(x.dia_venta), factura: x.factura, tipo: 'austral', nuevo: x.n > nuevosDesde, alTocar: () => alAbrir && alAbrir(x, 'austral') })))
      : null);
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
  const rondaBtn = pestanas.find((b) => b.dataset.ranking === 'ronda');
  rondaBtn.hidden = !datos.ranking.ronda;
  if (datos.ranking.ronda) rondaBtn.textContent = datos.ranking.ronda.nombre;
  if (!datos.ranking.ronda && pestanaRanking === 'ronda') pestanaRanking = 'general';
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
  if (tipo === 'ronda' && r.ronda) {
    const s = r.ronda;
    const nota = h('p', { class: 'ranking__nota' }, s.con_sorteo
      ? `${s.nombre}, del ${rango(s.inicio, s.fin)} Corte: ${momento(s.corte)} · cada cupón que completes en la ronda entra a la bolsa del sorteo del ${conPunto(fechaConDia(s.sorteo))}`
      : `${s.nombre}, del ${rango(s.inicio, s.fin)} No tiene sorteo: los cupones suman para el Gran Sorteo Final.`);
    if (!s.top.length) return [nota, h('div', { class: 'vacio' }, h('strong', {}, 'Nadie ha completado cupones en esta ronda'), 'El primero en llegar se pone a la cabeza.')];
    return [nota, h('ol', { class: 'ranking__lista' }, s.top.map((x) => puesto(x, plural(x.cupones, 'cupón', 'cupones')))), piePosicion(s, 'completa un cupón en esta ronda')];
  }
  if (tipo === 'austral') {
    const a = r.austral;
    const nota = h('p', { class: 'ranking__nota' }, `Cada ${decimal(c.m2_por_cupon_austral)} m² de Austral es 1 ticket adicional para el Gran Sorteo Final.`);
    if (!a.top.length) return [nota, h('div', { class: 'vacio' }, h('strong', {}, 'Todavía no hay ventas de Austral'), 'La primera venta suma el primer ticket.')];
    return [nota, h('ol', { class: 'ranking__lista' }, a.top.map((x, i) => puesto(x, h('span', {}, `${decimal(x.m2)} m² `, h('small', {}, `· ${plural(x.cupones, 'cupón', 'cupones')}`)), 'puesto--austral' + (i === 0 ? ' puesto--lider' : '')))), piePosicion(a, 'registra una venta Austral')];
  }
  const g = r.general;
  const nota = h('p', { class: 'ranking__nota' }, `Cupones acumulados en toda la campaña. Cada ${c.cupones_por_cupon_final} son 1 cupón para el Gran Sorteo Final del ${conPunto(fechaConDia(c.fecha_sorteo_final))}`);
  if (!g.top.length) return [nota, h('div', { class: 'vacio' }, h('strong', {}, 'Todavía no hay ventas registradas'), 'Sé el primero en la tabla.')];
  return [nota, h('ol', { class: 'ranking__lista' }, g.top.map((x) => puesto(x, plural(x.cupones, 'cupón', 'cupones')))), piePosicion(g, 'registra tu primera venta')];
}

// ---------- Reglas ----------

export function pintarReglas(datos) {
  const c = datos.concurso;
  const r = datos.resumen;
  const M = dinero(r.monto_por_cupon, { compacto: true });
  const fuerte = (t) => h('strong', {}, t);
  const sorteos = c.rondas.filter((p) => p.con_sorteo);
  const sinSorteo = c.rondas.filter((p) => !p.con_sorteo);
  const corte = enCaracas(c.rondas[0].corte);
  const items = [
    ['Cada ', fuerte(`${M} en ventas`), ` te da `, fuerte('1 cupón'), ` (es el valor del cupón ${datos.usuario.canal === 'Tienda' ? 'de tu tienda' : 'de tu canal'}). Lo que sobra no se pierde: se suma a tus próximas ventas.`],
    [`${c.nombre_sorteo} tiene ${sorteos.length} rondas con sorteo: `, ...sorteos.flatMap((p, i) => [i ? (i === sorteos.length - 1 ? ' y ' : ', ') : '', fuerte(p.nombre), ` (${rango(p.inicio, p.fin).replace(/\.$/, '')}, sorteo el ${fechaConDia(p.sorteo)})`]), '. A cada sorteo entran los cupones que completes en esa ronda.'],
    sinSorteo.length ? [...sinSorteo.flatMap((p) => [fuerte(p.nombre), ` (${rango(p.inicio, p.fin).replace(/\.$/, '')})`]), ' no tiene sorteo: es para seguir sumando cupones para el final.'] : null,
    ['Cada ronda cierra el día siguiente a su último día, a las ', fuerte(corte.hora), '.', c.bloquear_rondas_cerradas ? ' Después del corte ya no se cargan ventas de esa ronda.' : ''],
    ['Gran Sorteo Final, ', fuerte(fechaConDia(c.fecha_sorteo_final)), `: cada `, fuerte(`${c.cupones_por_cupon_final} cupones`), ' acumulados en toda la campaña son 1 cupón final, si vendiste al menos el ', fuerte(`${decimal(c.porcentaje_meta_final)} % de tu meta`), '.'],
    ['Cada ', fuerte(`${decimal(c.m2_por_cupon_austral)} m² de Austral`), ' te dan 1 ', fuerte('ticket adicional para el Gran Sorteo Final'), c.austral_requiere_meta ? `, que cuenta si llegas al ${decimal(c.porcentaje_meta_final)} % de tu meta.` : '.'],
    ['Registra cada factura con su foto. Una factura solo se registra una vez, y el coordinador puede rechazar las que no se lean bien.'],
  ].filter(Boolean);
  if (c.contar_solo_aprobadas) items.push(['Tus cupones cuentan cuando el coordinador aprueba la factura.']);
  $('#reglas-lista').replaceChildren(...items.map((partes) => h('li', {}, partes)));
}
