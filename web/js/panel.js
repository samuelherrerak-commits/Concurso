/** Render del panel del vendedor: resumen, cupones, viaje, ventas, ranking y reglas. */
import { $, $$, h, icono } from './dom.js';
import {
  dinero, decimal, fechaCorta, fechaLarga, fechaMedia, diaMes, rango, plural, iniciales, ordinal,
  diaSemana, fechaConDia, momento, enCaracas, conPunto,
} from './formato.js';
import { crearMini } from './ticket.js';

let pestanaRanking = 'semana';
let ultimoRanking = null;

const nombreCategoria = (c, id) => (c.categorias[id - 1] || {}).nombre || '';

/** "Oro" o "Oro y Plata": las categorías que entran al sorteo del viaje. */
export function categoriasViaje(c) {
  const nombres = c.categorias.slice(0, c.viaje_hasta_categoria).map((x) => x.nombre);
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0];
}

// ---------- Cabecera ----------

export function pintarCabecera(datos) {
  const { usuario, concurso } = datos;
  const primerNombre = usuario.nombre.split(' ')[0];
  $('#saludo-titulo').textContent = `Hola, ${primerNombre}`;
  $('#saludo-semana').textContent = textoSemana(concurso);
  $('#saludo-corte').textContent = textoCorte(concurso);
  $('#avatar-iniciales').textContent = iniciales(usuario.nombre, usuario.apellido).toUpperCase();
  $('#menu-nombre').textContent = `${usuario.nombre} ${usuario.apellido}`;
  $('#menu-cedula').textContent = `C.I. ${usuario.cedula_mask}` + (usuario.sucursal ? ` · ${usuario.sucursal}` : '');
}

export function textoSemana(c) {
  const s = c.semana_actual;
  if (!s || s.estado === 'antes') return `La Copa arranca el ${fechaConDia(c.fecha_inicio)}`;
  if (s.estado === 'terminado') return c.fecha_sorteo ? `La Copa terminó · sorteo el ${fechaLarga(c.fecha_sorteo)}` : 'La Copa terminó · sorteo por anunciar';
  return `Semana ${s.numero} de ${s.total} · ${rango(s.inicio, s.fin)}`;
}

export function textoCorte(c) {
  const s = c.semana_actual;
  if (!s || s.estado === 'antes' || s.estado === 'terminado') return '';
  const corte = enCaracas(s.corte);
  if (corte.iso === c.hoy) return `Corte hoy a las ${corte.hora}`;
  return `Corte: ${momento(s.corte)}`;
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
  const cat = r.categoria;
  const lineas = [
    renglon('TOTAL VENDIDO', dinero(r.total)),
    renglon('AUSTRAL (m²)', `${decimal(r.m2)} m²`, 'renglon--austral'),
    renglon('CUPONES VIAJE', String(r.austral.cupones), 'renglon--austral'),
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

  const categoria = [renglon('CATEGORÍA', cat.id ? cat.nombre + (cat.provisional ? ' · hoy' : '') : '—', 'renglon--categoria')];
  if (!cat.id) categoria.push(h('p', { class: 'resumen__nota' }, `Con tu primer cupón entras a ${nombreCategoria(c, 3)}.`));
  else if (cat.para_subir) categoria.push(h('p', { class: 'resumen__nota' }, `Te ${cat.para_subir.cupones === 1 ? 'falta 1 cupón' : `faltan ${cat.para_subir.cupones} cupones`} para ${cat.para_subir.categoria}.`));

  caja.replaceChildren(
    h('div', { class: 'resumen__titulo' }, h('span', { id: 'resumen-titulo' }, 'Tus cupones'), icono('ticket')),
    h('div', { class: 'resumen__cupones' },
      h('span', { class: 'resumen__numero', id: 'resumen-numero' }, String(r.cupones)),
      h('span', { class: 'resumen__unidad' }, r.cupones === 1 ? 'cupón para el sorteo' : 'cupones para el sorteo')),
    h('dl', { class: 'resumen__categoria' }, categoria),
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
  const s = c.semana_actual;
  const boton = $('#btn-registrar');
  const nota = $('#accion-nota');
  let motivo = '';
  if (!c.concurso_abierto) motivo = 'La carga de ventas está cerrada.';
  else if (s.estado === 'antes') motivo = conPunto(`Podrás registrar ventas desde el ${fechaConDia(c.fecha_inicio)}`);
  else if (!c.dia_max_carga) motivo = s.estado === 'terminado' ? 'La Copa terminó: ya no se cargan ventas.' : 'No hay días abiertos para cargar ventas.';
  boton.disabled = !!motivo;
  nota.hidden = !motivo;
  nota.textContent = motivo;
}

// ---------- Mis cupones y viaje ----------

export function pintarCupones(datos, { nuevosDesde = Infinity, alAbrir } = {}) {
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
  caja.replaceChildren(
    h('div', { class: 'cupones', 'aria-label': 'Mis cupones. Toca uno para verlo o descargarlo.' },
      lista.map((c) => crearMini({ n: c.n, dia: diaMes(c.dia_venta), factura: c.factura, nuevo: c.n > nuevosDesde, alTocar: () => alAbrir && alAbrir(c, 'normal') }))),
    h('p', { class: 'cupones__ayuda' }, 'Toca un cupón para verlo o descargarlo.'));
}

export function pintarViaje(datos, { nuevosDesde = Infinity, alAbrir } = {}) {
  const { resumen: r, concurso: c } = datos;
  const a = r.austral;
  const caja = $('#viaje');
  const cupones = (datos.cupones_austral || []).slice().reverse();
  $('#viaje-cuenta').textContent = a.cupones ? plural(a.cupones, 'cupón', 'cupones') : '';
  const quien = categoriasViaje(c);
  const estado = a.participa
    ? h('p', { class: 'viaje__estado viaje__estado--si' }, icono('check'), `Hoy estás en ${r.categoria.nombre}: tus cupones del viaje entran al sorteo.`)
    : h('p', { class: 'viaje__estado' }, `Para entrar al sorteo del viaje necesitas estar en ${quien} al cierre.`, r.categoria.id ? ` Hoy estás en ${r.categoria.nombre}.` : '');

  caja.replaceChildren(
    h('div', { class: 'viaje__cuerpo' },
      h('div', { class: 'progreso progreso--austral' },
        h('div', { class: 'progreso__cab' }, h('span', {}, 'Próximo cupón del viaje'), h('span', {}, `${decimal(a.sobrante)} de ${decimal(a.m2_por_cupon)} m²`)),
        h('div', { class: 'progreso__barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(a.m2_por_cupon), 'aria-valuenow': String(a.sobrante), 'aria-label': 'Avance hacia el próximo cupón del viaje' },
          h('div', { class: 'progreso__relleno', style: { transform: `scaleX(${Math.min(1, a.progreso)})` } })),
        h('p', { class: 'progreso__pie' }, 'Te faltan ', h('strong', {}, `${decimal(a.falta)} m²`), ' de Austral. Cada ', `${decimal(a.m2_por_cupon)} m²`, ' es 1 cupón.')),
      estado),
    cupones.length
      ? h('div', { class: 'cupones cupones--viaje', 'aria-label': 'Cupones del viaje' },
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
    const nota = h('p', { class: 'ranking__nota' },
      `Semana ${s.numero}, del ${rango(s.inicio, s.fin)} Corte: ${momento(s.corte)} · premios el ${conPunto(fechaConDia(s.entrega) + (c.texto_entrega ? ' ' + c.texto_entrega : ''))} Ganan los ${s.premios} que más cupones completen.`);
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
    const nota = h('p', { class: 'ranking__nota' }, `Cada ${decimal(c.m2_por_cupon_austral)} m² de Austral es 1 cupón para el sorteo del viaje todo incluido para dos. Participa${c.viaje_hasta_categoria > 1 ? 'n' : ''} ${categoriasViaje(c)}.`);
    if (!a.top.length) return [nota, h('div', { class: 'vacio' }, h('strong', {}, 'Todavía no hay ventas de Austral'), 'La primera venta pone a alguien en camino al viaje.')];
    return [nota, h('ol', { class: 'ranking__lista' }, a.top.map((x, i) => puesto(x, h('span', {}, `${decimal(x.m2)} m² `, h('small', {}, `· ${plural(x.cupones, 'cupón', 'cupones')}`)), 'puesto--austral' + (i === 0 ? ' puesto--lider' : '')))), piePosicion(a, 'registra una venta Austral')];
  }
  const g = r.general;
  const nota = h('p', { class: 'ranking__nota' }, c.fecha_sorteo ? `Cada cupón es una participación en el sorteo final del ${fechaLarga(c.fecha_sorteo)}.` : 'Cada cupón es una participación en el sorteo final de tu categoría.');
  if (!g.top.length) return [nota, h('div', { class: 'vacio' }, h('strong', {}, 'Todavía no hay ventas registradas'), 'Sé el primero en la tabla.')];
  return [nota, h('ol', { class: 'ranking__lista' }, g.top.map((x) => puesto(x, plural(x.cupones, 'cupón', 'cupones')))), piePosicion(g, 'registra tu primera venta')];
}

// ---------- Reglas ----------

function textoCategorias(c) {
  const [a, b, d] = c.categorias.map((x) => x.nombre);
  if (c.categorias_modo === 'cupones') {
    return `${a}: ${c.categoria_1_min_cupones} cupones o más; ${b}: de ${c.categoria_2_min_cupones} a ${c.categoria_1_min_cupones - 1}; ${d}: de 1 a ${c.categoria_2_min_cupones - 1}`;
  }
  return `${a}: el ${decimal(c.categoria_1_porcentaje)} % con más cupones; ${b}: el ${decimal(c.categoria_2_porcentaje)} % siguiente; ${d}: el resto`;
}

export function pintarReglas(datos) {
  const c = datos.concurso;
  const M = dinero(c.monto_por_cupon, { compacto: true });
  const fuerte = (t) => h('strong', {}, t);
  const p1 = c.periodos[0];
  const corte1 = enCaracas(p1.corte);
  const premios = c.categorias.map((x) => `${x.premios} en ${x.nombre}`).join(', ');
  const items = [
    ['Cada ', fuerte(`${M} en ventas`), ' te da ', fuerte('1 cupón'), '. Lo que sobra no se pierde: se suma a tus próximas ventas.'],
    ['Cada semana va del ', fuerte(diaSemana(p1.inicio)), ' al ', fuerte(diaSemana(p1.fin)), '. El corte es el ', fuerte(`${diaSemana(corte1.iso)} a las ${corte1.hora}`), ' y los premios se entregan el ', fuerte(diaSemana(p1.entrega)), c.texto_entrega ? ` ${c.texto_entrega}` : '', '.',
      c.bloquear_semanas_cerradas ? ' Después del corte ya no se cargan ventas de esa semana.' : ''],
    ['Cada semana, los ', fuerte(`${c.premios_semanales} vendedores que más cupones completen`), ' ganan un premio. Lo que te sobre de una semana cuenta para la siguiente.'],
    ['Al corte final, quienes tengan cupones quedan en 3 categorías: ', fuerte(textoCategorias(c)), '. Si hay empate en el límite, se sube a la categoría mayor.'],
    ['En el sorteo final cada categoría sortea sus premios entre sus propios cupones: ', fuerte(premios), '.'],
    ['Cada ', fuerte(`${decimal(c.m2_por_cupon_austral)} m² de Austral`), ' te dan 1 cupón para el sorteo del ', fuerte('viaje todo incluido para dos'), `. Solo participa${c.viaje_hasta_categoria > 1 ? 'n' : ''} ${categoriasViaje(c)}.`],
    ['Registra cada factura con su foto. Una factura solo se registra una vez, y el coordinador puede rechazar las que no se lean bien.'],
  ];
  if (c.contar_solo_aprobadas) items.push(['Tus cupones cuentan cuando el coordinador aprueba la factura.']);
  if (c.fecha_sorteo) items.push(['El sorteo final es el ', fuerte(conPunto(fechaConDia(c.fecha_sorteo)))]);
  $('#reglas-lista').replaceChildren(...items.map((partes) => h('li', {}, partes)));
}
