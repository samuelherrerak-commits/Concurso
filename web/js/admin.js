/**
 * Vista del administrador: auditar todo (solo lectura) e imprimir los cupones del sorteo.
 * Las aprobaciones y los rechazos se siguen haciendo en la hoja Registros.
 */
import { llamar, sesion } from './api.js';
import { $, $$, h, icono, avisar } from './dom.js';
import { dinero, decimal, fechaCorta, fechaHora, rango, plural, iniciales, momento, fechaConDia, enCaracas, conPunto } from './formato.js';
import { textoRonda, textoCorte } from './panel.js';

const VISTAS = ['resumen', 'vendedores', 'ventas', 'rondas', 'sorteo'];
const POR_PAGINA = 150;

let vista = 'resumen';
let cache = {};
let verFotoCb = null;
let turno = 0;
let rondaElegida = 0;
const filtrosVendedores = { q: '', grupo: '', meta: '' };
const filtrosVentas = { q: '', estado: '', ronda: '', grupo: '', limite: POR_PAGINA };

export function iniciarAdmin() {
  const botones = $$('#admin-pestanas [data-vista]');
  botones.forEach((b, i) => {
    b.addEventListener('click', () => irA(b.dataset.vista));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const otro = botones[(i + (e.key === 'ArrowRight' ? 1 : botones.length - 1)) % botones.length];
      otro.focus();
      irA(otro.dataset.vista);
    });
  });
}

export function mostrarAdmin({ verFoto }) {
  verFotoCb = verFoto;
  cache = {};
  const s = sesion.leer();
  const u = (s && s.usuario) || { nombre: '', apellido: '' };
  $('#saludo-titulo').textContent = u.nombre ? `Hola, ${u.nombre.split(' ')[0]}` : 'Administración';
  $('#saludo-semana').textContent = 'Auditoría de La bolsa de los deseos';
  $('#saludo-corte').textContent = '';
  $('#avatar-iniciales').textContent = iniciales(u.nombre, u.apellido).toUpperCase() || 'AD';
  $('#menu-nombre').textContent = `${u.nombre || ''} ${u.apellido || ''}`.trim() || 'Administrador';
  $('#menu-cedula').textContent = 'Administrador · solo lectura';
  document.title = 'La bolsa de los deseos · Administración';
  irA(VISTAS.includes(vista) ? vista : 'resumen');
}

export function salirAdmin() {
  cache = {};
  turno++;
  vista = 'resumen';
  rondaElegida = 0;
  $('#admin-vista').replaceChildren();
}

// ---------- Datos ----------

async function obtener(clave, accion, params = {}) {
  if (cache[clave]) return cache[clave];
  const r = await llamar(accion, params, { timeout: 45000 });
  if (!r.ok) throw r;
  cache[clave] = r.data;
  if (clave === 'resumen') pintarCabecera(r.data.concurso);
  return r.data;
}

function pintarCabecera(c) {
  $('#saludo-semana').textContent = textoRonda(c);
  $('#saludo-corte').textContent = textoCorte(c);
}

async function irA(nombre, { recargar = false } = {}) {
  vista = nombre;
  $$('#admin-pestanas [data-vista]').forEach((b) => {
    const si = b.dataset.vista === nombre;
    b.setAttribute('aria-selected', String(si));
    b.tabIndex = si ? 0 : -1;
    if (si) b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
  const caja = $('#admin-vista');
  const mio = ++turno;
  if (recargar) {
    if (nombre === 'rondas') Object.keys(cache).filter((k) => k.startsWith('ronda:')).forEach((k) => delete cache[k]);
    delete cache[nombre === 'rondas' || nombre === 'sorteo' ? 'resumen' : nombre];
  }
  caja.replaceChildren(h('div', { class: 'admin__cargando' }, h('span', { class: 'girador', 'aria-hidden': 'true' }), 'Cargando…'));
  try {
    const nodos = await construir(nombre);
    if (mio !== turno) return;
    caja.replaceChildren(...[].concat(nodos).filter(Boolean));
  } catch (err) {
    if (err instanceof Error) console.error(err);
    if (mio !== turno || (err && err.code === 'AUTH')) return;
    caja.replaceChildren(h('div', { class: 'superficie error-carga' },
      h('p', {}, (err && err.message) || 'No pudimos cargar esta sección.'),
      h('button', { type: 'button', class: 'btn btn--secundario', onclick: () => irA(nombre, { recargar: true }) }, icono('recargar'), 'Reintentar')));
  }
}

async function construir(nombre) {
  if (nombre === 'vendedores') return vistaVendedores(await obtener('vendedores', 'adminVendedores'), await obtener('resumen', 'adminResumen'));
  if (nombre === 'ventas') return vistaVentas(await obtener('ventas', 'adminVentas'));
  if (nombre === 'rondas') return vistaRondas(await obtener('resumen', 'adminResumen'));
  if (nombre === 'sorteo') return vistaSorteo(await obtener('resumen', 'adminResumen'));
  return vistaResumen(await obtener('resumen', 'adminResumen'));
}

// ---------- Piezas ----------

function cabeza(titulo, extra = []) {
  return h('div', { class: 'admin__cabeza' },
    h('h2', {}, titulo),
    h('div', { class: 'admin__acciones' }, extra,
      h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: () => irA(vista, { recargar: true }) }, icono('recargar'), 'Actualizar')));
}

function dato(etiqueta, valor, sub) {
  return h('div', { class: 'cifra' }, h('dt', {}, etiqueta), h('dd', {}, h('strong', {}, valor), sub ? h('span', {}, sub) : null));
}

function tabla(columnas, filas, { clase = '' } = {}) {
  return h('div', { class: 'tabla-caja' },
    h('table', { class: 'tabla ' + clase },
      h('thead', {}, h('tr', {}, columnas.map((c) => h('th', { class: c.num ? 'num' : '' }, c.t)))),
      h('tbody', {}, filas)));
}

const celda = (contenido, num = false) => h('td', { class: num ? 'num' : '' }, contenido);

function chipEstado(estado) {
  return h('span', { class: `chip chip--${estado}` }, estado);
}

function chipMeta(v) {
  if (!v.meta) return h('span', { class: 'texto-tenue' }, 'sin meta');
  return h('span', { class: 'chip ' + (v.cumple ? 'chip--Aprobada' : 'chip--Pendiente') }, `${Math.floor(v.avance * 100)} %`);
}

function opciones(lista, elegida, todos) {
  return [h('option', { value: '' }, todos), ...lista.map((o) => {
    const [valor, texto] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: String(valor), selected: String(valor) === String(elegida) }, texto);
  })];
}

function selector(etiqueta, lista, elegida, todos, alCambiar) {
  return h('label', { class: 'filtro' }, h('span', { class: 'sr-only' }, etiqueta),
    h('span', { class: 'selector selector--chico' },
      h('select', { class: 'entrada entrada--chica', onchange: (e) => alCambiar(e.target.value) }, opciones(lista, elegida, todos)),
      icono('abajo')));
}

function buscador(etiqueta, valor, alEscribir) {
  let reloj = 0;
  return h('label', { class: 'filtro filtro--buscar' }, h('span', { class: 'sr-only' }, etiqueta), icono('buscar'),
    h('input', {
      class: 'entrada entrada--chica', type: 'search', value: valor, placeholder: etiqueta, autocomplete: 'off',
      oninput: (e) => { clearTimeout(reloj); const v = e.target.value; reloj = setTimeout(() => alEscribir(v), 180); },
    }));
}

const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- CSV ----------

function textoCsv(v) {
  if (typeof v === 'number') return String(v).replace('.', ',');
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // que Excel no lo tome como fórmula
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function descargarCsv(nombre, filas) {
  const texto = filas.map((f) => f.map(textoCsv).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: nombre, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  avisar(`Descargado: ${nombre}`);
}

const botonCsv = (alTocar) => h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: alTocar }, icono('descargar'), 'CSV');

// ---------- Resumen ----------

// ---------- Resumen ----------

function vistaResumen(d) {
  const t = d.totales;
  const c = d.concurso;
  const s = c.ronda_actual;
  const enJuego = s.estado === 'en_curso' || s.estado === 'en_corte' || s.estado === 'proxima';
  const ronda = h('div', { class: 'superficie admin__semana' },
    h('div', {}, h('strong', {}, textoRonda(c)), enJuego ? h('span', {}, textoCorte(c)) : null),
    h('span', { class: 'chip ' + (c.concurso_abierto ? 'chip--Aprobada' : 'chip--Rechazada') }, c.concurso_abierto ? 'Carga abierta' : 'Carga cerrada'));

  const cifras = h('dl', { class: 'superficie cifras cifras--8' },
    dato('Vendedores', String(t.vendedores_registrados), `${t.vendedores_con_ventas} con ventas`),
    dato('Facturas', String(t.ventas), `${t.pendientes} pend. · ${t.rechazadas} rech.`),
    dato('Vendido', dinero(t.monto, { compacto: true }), c.contar_solo_aprobadas ? 'solo aprobadas' : 'sin rechazadas'),
    dato('Cupones', String(t.cupones), 'acumulados'),
    dato(`Cumplen ${decimal(c.porcentaje_meta_final)} % de la meta`, String(t.cumplen_meta), `de ${t.vendedores_con_ventas} con ventas`),
    dato('Cupones Gran Final', String(t.cupones_final), `1 cada ${c.cupones_por_cupon_final} cupones`),
    dato('Austral', `${decimal(t.m2)} m²`, 'vendidos'),
    dato('Cupones del viaje', String(t.cupones_austral), `1 cada ${decimal(c.m2_por_cupon_austral)} m²`));

  const canales = h('section', { class: 'admin__bloque' },
    h('h3', {}, 'Tiendas y canales'),
    h('p', { class: 'admin__nota' }, 'El valor del cupón y la meta de cada tienda y canal se cambian en la hoja Canales. Sin meta, el vendedor entra al Gran Sorteo Final con cada ', String(c.cupones_por_cupon_final), ' cupones.'),
    tabla(
      [{ t: 'Tienda o canal' }, { t: 'Valor cupón', num: true }, { t: 'Meta', num: true }, { t: 'Vendedores', num: true }, { t: 'Facturas', num: true }, { t: 'Vendido', num: true }, { t: 'Cupones', num: true }, { t: `Cumplen ${decimal(c.porcentaje_meta_final)} %`, num: true }, { t: 'Cupones final', num: true }],
      d.canales.map((x) => h('tr', {},
        celda([h('strong', {}, x.nombre), x.canal && x.canal !== 'Tienda' ? null : h('small', {}, x.canal ? 'Tienda' : 'sin canal')]),
        celda(x.monto_por_cupon ? dinero(x.monto_por_cupon, { compacto: true }) : '—', true),
        celda(x.meta ? dinero(x.meta, { compacto: true }) : h('span', { class: 'texto-tenue' }, 'sin meta'), true),
        celda(String(x.vendedores), true), celda(String(x.ventas), true),
        celda(dinero(x.monto, { compacto: true }), true), celda(String(x.cupones), true),
        celda(`${x.cumplen} de ${x.con_ventas}`, true), celda(String(x.cupones_final), true))),
      { clase: 'tabla--canales' }));

  return [
    cabeza('Resumen'),
    ronda,
    cifras,
    canales,
    h('p', { class: 'admin__nota admin__nota--pie' }, 'Este panel es de solo lectura. Para aprobar o rechazar facturas, cambia la columna estado en la hoja Registros; las reglas se cambian en Configuracion, las fechas en Rondas y los valores y metas en Canales.'),
  ];
}

// ---------- Vendedores ----------

function vistaVendedores(d, resumen) {
  const f = filtrosVendedores;
  const c = resumen.concurso;
  const contenedor = h('div', {});
  const grupos = [...new Set([...d.grupos, ...d.vendedores.map((v) => v.grupo)])];

  const filtrar = () => d.vendedores.filter((v) => {
    if (f.grupo && v.grupo !== f.grupo) return false;
    if (f.meta === 'si' && !v.cumple) return false;
    if (f.meta === 'no' && v.cumple) return false;
    if (f.q && !normal(`${v.nombre} ${v.cedula} ${v.telefono}`).includes(normal(f.q))) return false;
    return true;
  });

  const pintar = () => {
    const lista = filtrar();
    contenedor.replaceChildren(
      h('p', { class: 'admin__conteo' }, `${plural(lista.length, 'vendedor', 'vendedores')} · ${plural(lista.reduce((t, v) => t + v.cupones, 0), 'cupón', 'cupones')} · ${lista.reduce((t, v) => t + v.cupones_final, 0)} para el Gran Sorteo Final`),
      lista.length ? tabla(
        [{ t: 'Vendedor' }, { t: 'Tienda o canal' }, { t: 'Cupones', num: true }, { t: 'En la ronda', num: true }, { t: 'Vendido', num: true }, { t: 'Meta' }, { t: 'Gran Final', num: true }, { t: 'Austral', num: true }, { t: 'Viaje', num: true }, { t: 'Facturas', num: true }],
        lista.map((v) => h('tr', {},
          celda([h('strong', {}, v.nombre), h('small', {}, `C.I. ${v.cedula}${v.telefono ? ' · ' + v.telefono : ''}`), v.estado !== 'activo' ? h('small', { class: 'texto-error' }, v.estado) : null]),
          celda([v.grupo === 'Sin canal' ? h('span', { class: 'texto-error' }, 'Sin canal') : v.grupo, h('small', {}, `cupón de ${dinero(v.monto_por_cupon, { compacto: true })}`)]),
          celda(String(v.cupones), true),
          celda(String(v.cupones_ronda), true),
          celda(dinero(v.total, { compacto: true }), true),
          celda([chipMeta(v), v.meta ? h('small', {}, `de ${dinero(v.meta, { compacto: true })}`) : null]),
          celda(String(v.cupones_final), true),
          celda(v.m2 ? `${decimal(v.m2)} m²` : '—', true),
          celda(v.cupones_austral ? [String(v.cupones_austral), v.participa_viaje ? null : h('small', {}, 'no entra')] : '—', true),
          celda([String(v.ventas), v.pendientes || v.rechazadas ? h('small', {}, [v.pendientes ? `${v.pendientes} pend.` : '', v.rechazadas ? `${v.rechazadas} rech.` : ''].filter(Boolean).join(' · ')) : null], true))),
        { clase: 'tabla--vendedores' })
        : h('div', { class: 'superficie vacio' }, h('strong', {}, 'Nadie coincide con el filtro'), 'Cambia la búsqueda, la tienda o la meta.'));
  };

  const exportar = () => descargarCsv('vendedores-copa-prosein.csv', [
    ['Cédula', 'Nombre', 'Teléfono', 'Canal', 'Tienda o canal', 'Estado', 'Valor cupón', 'Cupones', 'Cupones ronda actual', 'Total vendido', 'Meta', '% de la meta', 'Cumple', 'Cupones Gran Final', 'm² Austral', 'Cupones viaje', 'Entra al viaje', 'Facturas', 'Pendientes', 'Rechazadas'],
    ...filtrar().map((v) => [v.cedula, v.nombre, v.telefono, v.canal, v.grupo, v.estado, v.monto_por_cupon, v.cupones, v.cupones_ronda, v.total, v.meta || '', v.meta ? Math.round(v.avance * 1000) / 10 : '', v.cumple ? 'SI' : 'NO', v.cupones_final, v.m2, v.cupones_austral, v.participa_viaje ? 'SI' : 'NO', v.ventas, v.pendientes, v.rechazadas]),
  ]);

  pintar();
  return [
    cabeza('Vendedores', [botonCsv(exportar)]),
    h('div', { class: 'filtros' },
      buscador('Buscar nombre, cédula o teléfono', f.q, (v) => { f.q = v; pintar(); }),
      selector('Tienda o canal', grupos, f.grupo, 'Todas las tiendas y canales', (v) => { f.grupo = v; pintar(); }),
      selector('Meta', [['si', `Cumplen el ${decimal(c.porcentaje_meta_final)} %`], ['no', 'No cumplen todavía']], f.meta, 'Meta: todos', (v) => { f.meta = v; pintar(); })),
    contenedor,
  ];
}

// ---------- Ventas ----------

function vistaVentas(d) {
  const f = filtrosVentas;
  const contenedor = h('div', {});
  const rondas = d.rondas.map((r) => [r.numero, r.nombre]);
  const nombreRonda = (n) => (d.rondas[n - 1] || {}).nombre || '—';

  const filtrar = () => d.ventas.filter((v) => {
    if (f.estado && v.estado !== f.estado) return false;
    if (f.ronda && String(v.ronda) !== f.ronda) return false;
    if (f.grupo && v.grupo !== f.grupo) return false;
    if (f.q && !normal(`${v.numero_factura} ${v.vendedor} ${v.cedula}`).includes(normal(f.q))) return false;
    return true;
  });

  const pintar = () => {
    const lista = filtrar();
    const visibles = lista.slice(0, f.limite);
    const suma = lista.reduce((t, v) => t + (v.cuenta ? v.monto : 0), 0);
    contenedor.replaceChildren(
      h('p', { class: 'admin__conteo' }, `${plural(lista.length, 'factura', 'facturas')} · ${dinero(suma, { compacto: true })} cuentan para cupones`),
      lista.length ? tabla(
        [{ t: 'Venta' }, { t: 'Factura' }, { t: 'Vendedor' }, { t: 'Ronda' }, { t: 'Monto', num: true }, { t: 'Austral', num: true }, { t: 'Estado' }, { t: '' }],
        visibles.map((v) => h('tr', { class: v.cuenta ? '' : 'fila--no-cuenta' },
          celda([fechaCorta(v.dia_venta), h('small', {}, `cargada ${fechaHora(v.fecha_carga)}`)]),
          celda([h('strong', {}, v.numero_factura), v.nota_admin ? h('small', { class: 'texto-error' }, v.nota_admin) : null]),
          celda([v.vendedor, h('small', {}, `C.I. ${v.cedula} · ${v.grupo}`)]),
          celda(nombreRonda(v.ronda)),
          celda(dinero(v.monto), true),
          celda(v.vendio_austral ? `${decimal(v.m2_austral)} m²` : '—', true),
          celda(chipEstado(v.estado)),
          celda(v.tiene_foto ? h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: () => verFotoCb && verFotoCb(v) }, 'Foto') : null, true))),
        { clase: 'tabla--ventas' })
        : h('div', { class: 'superficie vacio' }, h('strong', {}, 'No hay facturas con ese filtro'), 'Cambia la búsqueda, el estado o la ronda.'),
      lista.length > visibles.length
        ? h('button', { type: 'button', class: 'btn btn--secundario btn--bloque admin__mas', onclick: () => { f.limite += POR_PAGINA; pintar(); } }, `Mostrar ${Math.min(POR_PAGINA, lista.length - visibles.length)} más (de ${lista.length - visibles.length})`)
        : null);
  };

  const cambiar = (clave) => (v) => { f[clave] = v; f.limite = POR_PAGINA; pintar(); };
  const exportar = () => descargarCsv('ventas-copa-prosein.csv', [
    ['ID', 'Día de venta', 'Cargada', 'Factura', 'Cédula', 'Vendedor', 'Tienda o canal', 'Ronda', 'Monto', 'Austral', 'm² Austral', 'Estado', 'Cuenta', 'Nota'],
    ...filtrar().map((v) => [v.id, fechaCorta(v.dia_venta), fechaHora(v.fecha_carga), v.numero_factura, v.cedula, v.vendedor, v.grupo, nombreRonda(v.ronda), v.monto, v.vendio_austral ? 'SI' : 'NO', v.m2_austral, v.estado, v.cuenta ? 'SI' : 'NO', v.nota_admin || '']),
  ]);

  pintar();
  return [
    cabeza('Ventas', [botonCsv(exportar)]),
    h('div', { class: 'filtros' },
      buscador('Buscar factura, vendedor o cédula', f.q, cambiar('q')),
      selector('Estado', ['Pendiente', 'Aprobada', 'Rechazada'], f.estado, 'Todos los estados', cambiar('estado')),
      selector('Ronda', rondas, f.ronda, 'Todas las rondas', cambiar('ronda')),
      selector('Tienda o canal', [...d.grupos, 'Sin canal'], f.grupo, 'Todas las tiendas y canales', cambiar('grupo'))),
    contenedor,
  ];
}

// ---------- Rondas ----------

const ESTADO_RONDA = { cerrada: ['Cerrada', 'chip--Aprobada'], en_juego: ['En juego', 'chip--Pendiente'], pendiente: ['Por empezar', 'chip--neutro'] };

function horaCorta(ms) {
  const c = enCaracas(ms);
  return `${fechaCorta(c.iso).slice(0, 5)} ${c.hora}`;
}

function vistaRondas(resumen) {
  const rondas = resumen.rondas;
  if (!rondaElegida) {
    const enJuego = rondas.find((p) => p.estado === 'en_juego');
    const cerradas = rondas.filter((p) => p.estado === 'cerrada');
    rondaElegida = (enJuego && enJuego.numero) || (cerradas.length ? cerradas[cerradas.length - 1].numero : 1);
  }
  const detalle = h('section', { class: 'admin__bloque', id: 'admin-ronda' });

  const elegir = async (n) => {
    rondaElegida = n;
    $$('.tabla--semanas tbody tr').forEach((tr) => tr.toggleAttribute('data-elegida', Number(tr.dataset.ronda) === n));
    detalle.replaceChildren(h('div', { class: 'admin__cargando' }, h('span', { class: 'girador', 'aria-hidden': 'true' }), 'Cargando…'));
    try {
      const d = await obtener('ronda:' + n, 'adminRonda', { ronda: n });
      if (rondaElegida === n) detalle.replaceChildren(...detalleRonda(d).filter(Boolean));
    } catch (err) {
      if (rondaElegida === n) detalle.replaceChildren(h('p', { class: 'superficie vacio' }, (err && err.message) || 'No pudimos cargar la ronda.'));
    }
  };

  const filas = rondas.map((p) => {
    const [texto, clase] = ESTADO_RONDA[p.estado] || ESTADO_RONDA.pendiente;
    return h('tr', { dataset: { ronda: String(p.numero) }, 'data-elegida': p.numero === rondaElegida },
      celda(h('strong', {}, p.nombre)),
      celda(rango(p.inicio, p.fin)),
      celda(horaCorta(p.corte)),
      celda(p.con_sorteo ? fechaConDia(p.sorteo) : h('span', { class: 'texto-tenue' }, 'sin sorteo')),
      celda(h('span', { class: 'chip ' + clase }, texto)),
      celda(String(p.participantes), true),
      celda(String(p.cupones), true),
      celda(h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: () => elegir(p.numero) }, 'Ver'), true));
  });

  setTimeout(() => elegir(rondaElegida), 0);
  return [
    cabeza('Rondas'),
    h('p', { class: 'admin__nota' }, 'Las fechas salen de la hoja Rondas. A cada sorteo entran los cupones completados en su ronda; lo que sobra en $ pasa a la siguiente. La Ñapa no tiene sorteo.'),
    tabla([{ t: 'Ronda' }, { t: 'Ventas del' }, { t: 'Corte' }, { t: 'Sorteo' }, { t: 'Estado' }, { t: 'Vendedores', num: true }, { t: 'Cupones', num: true }, { t: '' }], filas, { clase: 'tabla--semanas' }),
    detalle,
  ];
}

function detalleRonda(d) {
  const exportar = () => descargarCsv(`${d.nombre.toLowerCase().replace(/\s+/g, '-')}.csv`, [
    ['Puesto', 'Cédula', 'Vendedor', 'Tienda o canal', 'Cupones de la ronda', 'Vendido en la ronda'],
    ...d.lista.map((x) => [x.pos, x.cedula, x.nombre, x.grupo, x.cupones, x.monto]),
  ]);
  const cupones = d.lista.reduce((t, x) => t + x.cupones, 0);
  return [
    h('div', { class: 'admin__cabeza admin__cabeza--sub' },
      h('h3', {}, `${d.nombre} · ${rango(d.inicio, d.fin)}`),
      h('div', { class: 'admin__acciones' }, d.lista.length ? botonCsv(exportar) : null)),
    h('p', { class: 'admin__nota' }, [
      d.cerrada ? conPunto(`Cerró el ${momento(d.corte)}`) : `Provisional hasta el corte (${momento(d.corte)}).`,
      d.con_sorteo ? ` ${plural(cupones, 'cupón', 'cupones')} de ${plural(d.lista.length, 'vendedor', 'vendedores')} para el sorteo del ${conPunto(fechaConDia(d.sorteo))}` : ' Sin sorteo: estos cupones suman para el Gran Sorteo Final.',
    ].join('')),
    d.lista.length
      ? tabla([{ t: '#' }, { t: 'Vendedor' }, { t: 'Tienda o canal' }, { t: 'Cupones', num: true }, { t: 'Vendido', num: true }],
        d.lista.map((x) => h('tr', {},
          celda(h('span', { class: 'puesto__pos' }, String(x.pos))),
          celda([h('strong', {}, x.nombre), h('small', {}, `C.I. ${x.cedula}`)]),
          celda(x.grupo),
          celda(String(x.cupones), true),
          celda(dinero(x.monto, { compacto: true }), true))),
        { clase: 'tabla--ganadores' })
      : h('div', { class: 'superficie vacio' }, h('strong', {}, 'Nadie completó cupones en esta ronda'), 'Cuando alguien complete uno, aparece aquí.'),
  ];
}

// ---------- Sorteos ----------

function vistaSorteo(resumen) {
  const c = resumen.concurso;
  const ahora = Date.now();
  const total = resumen.bolsas.reduce((t, b) => t + b.cupones, 0);
  const enlace = (bolsa, texto, clase) => h('a', { class: 'btn ' + clase, href: `cupones.html?bolsa=${bolsa}`, target: '_blank', rel: 'noopener' }, icono('imprimir'), texto);
  const sub = (b) => {
    if (b.tipo === 'final') return `1 cupón cada ${c.cupones_por_cupon_final}, con el ${decimal(c.porcentaje_meta_final)} % de la meta`;
    if (b.tipo === 'austral') return `1 cupón cada ${decimal(c.m2_por_cupon_austral)} m² de Austral`;
    return 'cupones completados en la ronda';
  };

  return [
    cabeza(c.nombre_sorteo, [enlace('todas', 'Imprimir todos', 'btn--primario btn--chico')]),
    h('div', { class: 'urnas urnas--5' }, resumen.bolsas.map((b) => h('article', { class: 'superficie urna' + (b.tipo === 'austral' ? ' urna--viaje' : b.tipo === 'final' ? ' urna--final' : '') },
      h('div', { class: 'urna__cab' },
        h('strong', {}, b.tipo === 'austral' ? [icono('avion'), b.nombre] : b.nombre),
        h('span', {}, b.fecha ? fechaConDia(b.fecha) : '')),
      h('p', { class: 'urna__cifra' }, h('strong', {}, String(b.cupones)), b.cupones === 1 ? ' cupón' : ' cupones'),
      h('p', { class: 'urna__sub' }, `${plural(b.vendedores, 'vendedor', 'vendedores')} · ${sub(b)}`),
      b.corte > ahora ? h('p', { class: 'urna__sub urna__provisional' }, `Provisional · corte ${horaCorta(b.corte)}`) : null,
      b.cupones ? enlace(b.id, 'Imprimir cupones', 'btn--secundario btn--chico') : h('p', { class: 'urna__sub' }, 'Sin cupones todavía.')))),
    h('section', { class: 'admin__bloque' },
      h('h3', {}, 'Cómo armar cada bolsa'),
      h('ol', { class: 'admin__pasos superficie' },
        h('li', {}, `Imprime después del corte de cada ronda, en papel carta y a escala 100 % (${plural(total, 'cupón', 'cupones')} hoy, 24 por hoja). Cada sorteo empieza en una hoja nueva.`),
        h('li', {}, 'Recorta por las líneas punteadas, dobla cada cupón y ponlo en la bolsa de su sorteo.'),
        h('li', {}, 'Los cupones del Gran Sorteo Final llevan una banda roja y los del viaje una banda negra, para no mezclarlos.'),
        h('li', {}, 'Al sacar un cupón, verifica su código (por ejemplo R1-0007) en la hoja Ranking → “Cupones para sorteo”, o en Vendedores.'))),
  ];
}
