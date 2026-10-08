/**
 * Vista del administrador: auditar todo (solo lectura) e imprimir los cupones del sorteo.
 * Las aprobaciones y los rechazos se siguen haciendo en la hoja Registros.
 */
import { llamar, sesion } from './api.js';
import { $, $$, h, icono, avisar } from './dom.js';
import { dinero, decimal, fechaCorta, fechaHora, rango, plural, iniciales, momento, fechaConDia, enCaracas, conPunto } from './formato.js';
import { textoSemana, textoCorte } from './panel.js';

const VISTAS = ['resumen', 'vendedores', 'ventas', 'semanas', 'sorteo'];
const POR_PAGINA = 150;

let vista = 'resumen';
let cache = {};
let verFotoCb = null;
let turno = 0;
let semanaElegida = 0;
const filtrosVendedores = { q: '', sucursal: '', categoria: '' };
const filtrosVentas = { q: '', estado: '', semana: '', sucursal: '', limite: POR_PAGINA };

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
  $('#saludo-semana').textContent = 'Auditoría de la Copa';
  $('#saludo-corte').textContent = '';
  $('#avatar-iniciales').textContent = iniciales(u.nombre, u.apellido).toUpperCase() || 'AD';
  $('#menu-nombre').textContent = `${u.nombre || ''} ${u.apellido || ''}`.trim() || 'Administrador';
  $('#menu-cedula').textContent = 'Administrador · solo lectura';
  document.title = 'Copa Prosein · Administración';
  irA(VISTAS.includes(vista) ? vista : 'resumen');
}

export function salirAdmin() {
  cache = {};
  turno++;
  vista = 'resumen';
  semanaElegida = 0;
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
  $('#saludo-semana').textContent = textoSemana(c);
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
    if (nombre === 'semanas') Object.keys(cache).filter((k) => k.startsWith('semana:')).forEach((k) => delete cache[k]);
    delete cache[nombre === 'semanas' || nombre === 'sorteo' ? 'resumen' : nombre];
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
  if (nombre === 'semanas') return vistaSemanas(await obtener('resumen', 'adminResumen'));
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

function chipCategoria(id, nombre) {
  if (!id) return h('span', { class: 'texto-tenue' }, '—');
  return h('span', { class: `chip chip--cat chip--cat${id}` }, nombre);
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

function textoReglaCategorias(c) {
  const [a, b, d] = c.categorias.map((x) => x.nombre);
  if (c.categorias_modo === 'cupones') return `${a}: ${c.categoria_1_min_cupones}+ cupones · ${b}: ${c.categoria_2_min_cupones}+ · ${d}: el resto con al menos 1.`;
  return `${a}: el ${decimal(c.categoria_1_porcentaje)} % con más cupones · ${b}: el ${decimal(c.categoria_2_porcentaje)} % siguiente · ${d}: el resto. Los empates en el límite suben.`;
}

function vistaResumen(d) {
  const t = d.totales;
  const c = d.concurso;
  const s = c.semana_actual;
  const enJuego = s.estado === 'en_curso' || s.estado === 'en_corte' || s.estado === 'proxima';
  const semana = h('div', { class: 'superficie admin__semana' },
    h('div', {}, h('strong', {}, textoSemana(c)), enJuego ? h('span', {}, `Corte: ${momento(s.corte)} · Premios: ${fechaConDia(s.entrega)}${c.texto_entrega ? ' ' + c.texto_entrega : ''}`) : null),
    h('span', { class: 'chip ' + (c.concurso_abierto ? 'chip--Aprobada' : 'chip--Rechazada') }, c.concurso_abierto ? 'Carga abierta' : 'Carga cerrada'));

  const cifras = h('dl', { class: 'superficie cifras' },
    dato('Vendedores', String(t.vendedores_registrados), `${t.vendedores_con_ventas} con ventas`),
    dato('Facturas', String(t.ventas), `${t.pendientes} pend. · ${t.rechazadas} rech.`),
    dato('Vendido', dinero(t.monto, { compacto: true }), c.contar_solo_aprobadas ? 'solo aprobadas' : 'sin rechazadas'),
    dato('Cupones', String(t.cupones), `1 cada ${dinero(c.monto_por_cupon, { compacto: true })}`),
    dato('Austral', `${decimal(t.m2)} m²`, 'vendidos'),
    dato('Cupones del viaje', String(t.cupones_austral), `1 cada ${decimal(c.m2_por_cupon_austral)} m²`));

  const categorias = h('section', { class: 'admin__bloque' },
    h('h3', {}, 'Categorías', s.estado !== 'terminado' ? h('span', { class: 'chip chip--Pendiente' }, 'provisional') : null),
    h('p', { class: 'admin__nota' }, textoReglaCategorias(c)),
    h('div', { class: 'categorias' }, d.categorias.map((x) => h('article', { class: `superficie categoria categoria--${x.id}` },
      h('div', { class: 'categoria__cab' }, h('strong', {}, x.nombre), x.viaje ? h('span', { class: 'chip chip--austral' }, icono('avion'), 'viaje') : null),
      h('dl', {},
        dato('Vendedores', String(x.vendedores)),
        dato('Cupones', String(x.cupones)),
        dato('Rango', x.vendedores ? (x.desde === x.hasta ? plural(x.hasta, 'cupón', 'cupones') : `${x.desde} a ${x.hasta} cupones`) : '—'),
        dato('Premios', String(x.premios)))))));

  const tiendas = h('section', { class: 'admin__bloque' },
    h('h3', {}, 'Por tienda'),
    tabla(
      [{ t: 'Tienda' }, { t: 'Vendedores', num: true }, { t: 'Facturas', num: true }, { t: 'Vendido', num: true }, { t: 'Cupones', num: true }, { t: 'Austral', num: true }],
      d.sucursales.map((x) => h('tr', {},
        celda(x.nombre), celda(String(x.vendedores), true), celda(String(x.ventas), true),
        celda(dinero(x.monto, { compacto: true }), true), celda(String(x.cupones), true), celda(`${decimal(x.m2)} m²`, true)))));

  return [
    cabeza('Resumen'),
    semana,
    cifras,
    categorias,
    tiendas,
    h('p', { class: 'admin__nota admin__nota--pie' }, 'Este panel es de solo lectura. Para aprobar o rechazar facturas, cambia la columna estado en la hoja Registros; las reglas y fechas se cambian en Configuracion y Periodos.'),
  ];
}

// ---------- Vendedores ----------

function vistaVendedores(d, resumen) {
  const f = filtrosVendedores;
  const contenedor = h('div', {});
  const sucursales = [...new Set([...resumen.concurso.sucursales, ...d.vendedores.map((v) => v.sucursal).filter(Boolean)])];

  const filtrar = () => d.vendedores.filter((v) => {
    if (f.sucursal && (v.sucursal || 'Sin tienda') !== f.sucursal) return false;
    if (f.categoria && String(v.categoria_id) !== f.categoria) return false;
    if (f.q) {
      const q = normal(f.q);
      if (!normal(`${v.nombre} ${v.cedula} ${v.telefono}`).includes(q)) return false;
    }
    return true;
  });

  const pintar = () => {
    const lista = filtrar();
    contenedor.replaceChildren(
      h('p', { class: 'admin__conteo' }, `${plural(lista.length, 'vendedor', 'vendedores')} · ${plural(lista.reduce((t, v) => t + v.cupones, 0), 'cupón', 'cupones')}`),
      lista.length ? tabla(
        [{ t: 'Vendedor' }, { t: 'Tienda' }, { t: 'Categoría' }, { t: 'Cupones', num: true }, { t: 'Vendido', num: true }, { t: 'Austral', num: true }, { t: 'Viaje', num: true }, { t: 'Facturas', num: true }],
        lista.map((v) => h('tr', {},
          celda([h('strong', {}, v.nombre), h('small', {}, `C.I. ${v.cedula}${v.telefono ? ' · ' + v.telefono : ''}`), v.estado !== 'activo' ? h('small', { class: 'texto-error' }, v.estado) : null]),
          celda(v.sucursal || h('span', { class: 'texto-error' }, 'Sin tienda')),
          celda(chipCategoria(v.categoria_id, v.categoria)),
          celda(String(v.cupones), true),
          celda(dinero(v.total, { compacto: true }), true),
          celda(v.m2 ? `${decimal(v.m2)} m²` : '—', true),
          celda(v.cupones_austral ? [String(v.cupones_austral), v.participa_viaje ? null : h('small', {}, 'no entra')] : '—', true),
          celda([String(v.ventas), v.pendientes || v.rechazadas ? h('small', {}, [v.pendientes ? `${v.pendientes} pend.` : '', v.rechazadas ? `${v.rechazadas} rech.` : ''].filter(Boolean).join(' · ')) : null], true))),
        { clase: 'tabla--vendedores' })
        : h('div', { class: 'superficie vacio' }, h('strong', {}, 'Nadie coincide con el filtro'), 'Cambia la búsqueda o la tienda.'));
  };

  const exportar = () => descargarCsv('vendedores-copa-prosein.csv', [
    ['Cédula', 'Nombre', 'Teléfono', 'Tienda', 'Estado', 'Categoría', 'Cupones', 'Total vendido', 'm² Austral', 'Cupones viaje', 'Entra al viaje', 'Facturas', 'Pendientes', 'Rechazadas'],
    ...filtrar().map((v) => [v.cedula, v.nombre, v.telefono, v.sucursal, v.estado, v.categoria, v.cupones, v.total, v.m2, v.cupones_austral, v.participa_viaje ? 'SI' : 'NO', v.ventas, v.pendientes, v.rechazadas]),
  ]);

  pintar();
  return [
    cabeza('Vendedores', [botonCsv(exportar)]),
    h('div', { class: 'filtros' },
      buscador('Buscar nombre, cédula o teléfono', f.q, (v) => { f.q = v; pintar(); }),
      selector('Tienda', [...sucursales, 'Sin tienda'], f.sucursal, 'Todas las tiendas', (v) => { f.sucursal = v; pintar(); }),
      selector('Categoría', d.categorias.map((c) => [c.id, c.nombre]), f.categoria, 'Todas las categorías', (v) => { f.categoria = v; pintar(); })),
    contenedor,
  ];
}

// ---------- Ventas ----------

function vistaVentas(d) {
  const f = filtrosVentas;
  const contenedor = h('div', {});
  const semanas = Array.from({ length: d.total_semanas }, (_, i) => [i + 1, `Semana ${i + 1}`]);

  const filtrar = () => d.ventas.filter((v) => {
    if (f.estado && v.estado !== f.estado) return false;
    if (f.semana && String(v.semana) !== f.semana) return false;
    if (f.sucursal && (v.sucursal || 'Sin tienda') !== f.sucursal) return false;
    if (f.q) {
      const q = normal(f.q);
      if (!normal(`${v.numero_factura} ${v.vendedor} ${v.cedula}`).includes(q)) return false;
    }
    return true;
  });

  const pintar = () => {
    const lista = filtrar();
    const visibles = lista.slice(0, f.limite);
    const suma = lista.reduce((t, v) => t + (v.cuenta ? v.monto : 0), 0);
    contenedor.replaceChildren(
      h('p', { class: 'admin__conteo' }, `${plural(lista.length, 'factura', 'facturas')} · ${dinero(suma, { compacto: true })} cuentan para cupones`),
      lista.length ? tabla(
        [{ t: 'Venta' }, { t: 'Factura' }, { t: 'Vendedor' }, { t: 'Semana', num: true }, { t: 'Monto', num: true }, { t: 'Austral', num: true }, { t: 'Estado' }, { t: '' }],
        visibles.map((v) => h('tr', { class: v.cuenta ? '' : 'fila--no-cuenta' },
          celda([fechaCorta(v.dia_venta), h('small', {}, `cargada ${fechaHora(v.fecha_carga)}`)]),
          celda([h('strong', {}, v.numero_factura), v.nota_admin ? h('small', { class: 'texto-error' }, v.nota_admin) : null]),
          celda([v.vendedor, h('small', {}, `C.I. ${v.cedula}${v.sucursal ? ' · ' + v.sucursal : ''}`)]),
          celda(v.semana ? String(v.semana) : '—', true),
          celda(dinero(v.monto), true),
          celda(v.vendio_austral ? `${decimal(v.m2_austral)} m²` : '—', true),
          celda(chipEstado(v.estado)),
          celda(v.tiene_foto ? h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: () => verFotoCb && verFotoCb(v) }, 'Foto') : null, true))),
        { clase: 'tabla--ventas' })
        : h('div', { class: 'superficie vacio' }, h('strong', {}, 'No hay facturas con ese filtro'), 'Cambia la búsqueda, el estado o la semana.'),
      lista.length > visibles.length
        ? h('button', { type: 'button', class: 'btn btn--secundario btn--bloque admin__mas', onclick: () => { f.limite += POR_PAGINA; pintar(); } }, `Mostrar ${Math.min(POR_PAGINA, lista.length - visibles.length)} más (de ${lista.length - visibles.length})`)
        : null);
  };

  const cambiar = (clave) => (v) => { f[clave] = v; f.limite = POR_PAGINA; pintar(); };
  const exportar = () => descargarCsv('ventas-copa-prosein.csv', [
    ['ID', 'Día de venta', 'Cargada', 'Factura', 'Cédula', 'Vendedor', 'Tienda', 'Semana', 'Monto', 'Austral', 'm² Austral', 'Estado', 'Cuenta', 'Nota'],
    ...filtrar().map((v) => [v.id, fechaCorta(v.dia_venta), fechaHora(v.fecha_carga), v.numero_factura, v.cedula, v.vendedor, v.sucursal, v.semana || '', v.monto, v.vendio_austral ? 'SI' : 'NO', v.m2_austral, v.estado, v.cuenta ? 'SI' : 'NO', v.nota_admin || '']),
  ]);

  pintar();
  return [
    cabeza('Ventas', [botonCsv(exportar)]),
    h('div', { class: 'filtros' },
      buscador('Buscar factura, vendedor o cédula', f.q, cambiar('q')),
      selector('Estado', ['Pendiente', 'Aprobada', 'Rechazada'], f.estado, 'Todos los estados', cambiar('estado')),
      selector('Semana', semanas, f.semana, 'Todas las semanas', cambiar('semana')),
      selector('Tienda', [...d.sucursales, 'Sin tienda'], f.sucursal, 'Todas las tiendas', cambiar('sucursal'))),
    contenedor,
  ];
}

// ---------- Semanas ----------

const ESTADO_SEMANA = { cerrada: ['Cerrada', 'chip--Aprobada'], en_juego: ['En juego', 'chip--Pendiente'], pendiente: ['Por empezar', 'chip--neutro'] };

function horaCorta(ms) {
  const c = enCaracas(ms);
  return `${fechaCorta(c.iso).slice(0, 5)} ${c.hora}`;
}

function vistaSemanas(resumen) {
  const periodos = resumen.periodos;
  if (!semanaElegida) {
    const cerradas = periodos.filter((p) => p.estado === 'cerrada');
    const enJuego = periodos.find((p) => p.estado === 'en_juego');
    semanaElegida = (enJuego && enJuego.numero) || (cerradas.length ? cerradas[cerradas.length - 1].numero : 1);
  }
  const detalle = h('section', { class: 'admin__bloque', id: 'admin-semana' });

  const elegir = async (n) => {
    semanaElegida = n;
    $$('.tabla--semanas tbody tr').forEach((tr) => tr.toggleAttribute('data-elegida', Number(tr.dataset.semana) === n));
    detalle.replaceChildren(h('div', { class: 'admin__cargando' }, h('span', { class: 'girador', 'aria-hidden': 'true' }), `Cargando semana ${n}…`));
    try {
      const d = await obtener('semana:' + n, 'adminSemana', { semana: n });
      if (semanaElegida === n) detalle.replaceChildren(...detalleSemana(d, resumen.concurso).filter(Boolean));
    } catch (err) {
      if (semanaElegida === n) detalle.replaceChildren(h('p', { class: 'superficie vacio' }, (err && err.message) || 'No pudimos cargar la semana.'));
    }
  };

  const filas = periodos.map((p) => {
    const [texto, clase] = ESTADO_SEMANA[p.estado] || ESTADO_SEMANA.pendiente;
    return h('tr', { dataset: { semana: String(p.numero) }, 'data-elegida': p.numero === semanaElegida },
      celda(h('strong', {}, `Semana ${p.numero}`)),
      celda(rango(p.inicio, p.fin)),
      celda(horaCorta(p.corte)),
      celda(fechaConDia(p.entrega)),
      celda(h('span', { class: 'chip ' + clase }, texto)),
      celda(String(p.participantes), true),
      celda(String(p.cupones), true),
      celda(h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: () => elegir(p.numero) }, 'Ganadores'), true));
  });

  setTimeout(() => elegir(semanaElegida), 0);
  return [
    cabeza('Semanas'),
    h('p', { class: 'admin__nota' }, 'Las fechas salen de la hoja Periodos. Cada semana cierra en su corte; los cupones que sobran pasan a la siguiente.'),
    tabla([{ t: 'Semana' }, { t: 'Ventas del' }, { t: 'Corte' }, { t: 'Premios' }, { t: 'Estado' }, { t: 'Vendedores', num: true }, { t: 'Cupones', num: true }, { t: '' }], filas, { clase: 'tabla--semanas' }),
    detalle,
  ];
}

function detalleSemana(d, c) {
  const exportar = () => descargarCsv(`ganadores-semana-${d.numero}.csv`, [
    ['Puesto', 'Cédula', 'Vendedor', 'Tienda', 'Cupones de la semana', 'Vendido en la semana', 'Premio'],
    ...d.lista.map((x) => [x.pos, x.cedula, x.nombre, x.sucursal, x.cupones, x.monto, x.premio ? 'SI' : '']),
  ]);
  const filas = [];
  d.lista.forEach((x, i) => {
    filas.push(h('tr', { class: x.premio ? 'fila--premio' : '' },
      celda(h('span', { class: 'puesto__pos' }, String(x.pos))),
      celda([h('strong', {}, x.nombre), h('small', {}, `C.I. ${x.cedula}`)]),
      celda(x.sucursal || '—'),
      celda(String(x.cupones), true),
      celda(dinero(x.monto, { compacto: true }), true),
      celda(x.premio ? h('span', { class: 'chip chip--premio' }, 'Premio') : null)));
    if (i === d.premios - 1 && d.lista.length > d.premios) filas.push(h('tr', { class: 'fila--corte', 'aria-hidden': 'true' }, h('td', { colspan: '6' }, 'zona de premio')));
  });
  return [
    h('div', { class: 'admin__cabeza admin__cabeza--sub' },
      h('h3', {}, `Semana ${d.numero} · ${rango(d.inicio, d.fin)}`),
      h('div', { class: 'admin__acciones' }, d.lista.length ? botonCsv(exportar) : null)),
    h('p', { class: 'admin__nota' }, d.cerrada
      ? `Cerró el ${momento(d.corte)} · premios el ${conPunto(fechaConDia(d.entrega) + (c.texto_entrega ? ' ' + c.texto_entrega : ''))} Ganan los ${d.premios} que más cupones completaron en la semana.`
      : `Provisional hasta el corte (${momento(d.corte)}). Ganan los ${d.premios} que más cupones completen en la semana.`),
    d.empate_en_corte ? h('p', { class: 'aviso' }, icono('alerta'), `Hay un empate exacto en el puesto ${d.premios}: revísalo antes de anunciar los ganadores.`) : null,
    d.lista.length
      ? tabla([{ t: '#' }, { t: 'Vendedor' }, { t: 'Tienda' }, { t: 'Cupones', num: true }, { t: 'Vendido', num: true }, { t: '' }], filas, { clase: 'tabla--ganadores' })
      : h('div', { class: 'superficie vacio' }, h('strong', {}, 'Nadie completó cupones esta semana'), 'Cuando alguien complete uno, aparece aquí.'),
  ];
}

// ---------- Sorteo ----------

function vistaSorteo(resumen) {
  const c = resumen.concurso;
  const s = c.semana_actual;
  const ultimo = c.periodos[c.periodos.length - 1];
  const provisional = s.estado !== 'terminado';
  const total = resumen.urnas.reduce((t, u) => t + u.cupones, 0);
  const enlace = (urna, texto, clase) => h('a', { class: 'btn ' + clase, href: `cupones.html?urna=${urna}`, target: '_blank', rel: 'noopener' }, icono('imprimir'), texto);

  return [
    cabeza('Sorteo final', [enlace('todas', 'Imprimir todos', 'btn--primario btn--chico')]),
    provisional
      ? h('p', { class: 'aviso aviso--info' }, icono('alerta'), `Las categorías y las urnas son provisionales hasta el corte final (${momento(ultimo.corte)}). Imprime los cupones después del corte para que no cambien.`)
      : null,
    h('div', { class: 'urnas' }, resumen.urnas.map((u) => h('article', { class: 'superficie urna' + (u.tipo === 'austral' ? ' urna--viaje' : '') },
      h('div', { class: 'urna__cab' },
        h('strong', {}, u.tipo === 'austral' ? [icono('avion'), u.nombre] : `Urna ${u.nombre}`),
        h('span', {}, plural(u.premios, 'premio', 'premios'))),
      h('p', { class: 'urna__cifra' }, h('strong', {}, String(u.cupones)), u.cupones === 1 ? ' cupón' : ' cupones'),
      h('p', { class: 'urna__sub' }, `${plural(u.vendedores, 'vendedor', 'vendedores')}${u.tipo === 'austral' ? ` · solo ${c.categorias.slice(0, c.viaje_hasta_categoria).map((x) => x.nombre).join(' y ')}` : ''}`),
      u.cupones ? enlace(u.id, 'Imprimir cupones', 'btn--secundario btn--chico') : h('p', { class: 'urna__sub' }, 'Sin cupones todavía.')))),
    h('section', { class: 'admin__bloque' },
      h('h3', {}, 'Cómo armar las urnas'),
      h('ol', { class: 'admin__pasos superficie' },
        h('li', {}, `Imprime en papel carta, a escala 100 % (${plural(total, 'cupón', 'cupones')}, 24 por hoja). Cada urna empieza en una hoja nueva.`),
        h('li', {}, 'Recorta por las líneas punteadas y dobla cada cupón por la mitad.'),
        h('li', {}, 'Cada categoría tiene su propia urna. Los cupones del viaje (banda negra) van en una urna aparte.'),
        h('li', {}, 'Al sacar un cupón, verifica su código (por ejemplo C1-0007) en la hoja Ranking → “Cupones para sorteo”, o aquí en Vendedores.'))),
  ];
}
