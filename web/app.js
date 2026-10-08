/**
 * Copa Prosein · portal del vendedor.
 * Punto de entrada: decide entre la pantalla de acceso y el panel.
 */
import { llamar, sesion, recuerdo } from './js/api.js';
import { $, h, avisar, prepararDialogo } from './js/dom.js';
import { fechaCorta, fechaHora } from './js/formato.js';
import { iniciarAcceso, mostrarAcceso } from './js/acceso.js';
import { iniciarVenta, abrirVenta } from './js/venta.js';
import { mostrarImpresora, mensajeMarcador } from './js/ticket.js';
import {
  pintarCabecera, pintarResumen, pintarEsqueleto, pintarErrorCarga, pintarAccion,
  pintarCupones, pintarVentas, pintarRanking, pintarReglas,
} from './js/panel.js';

let datos = null;
let visor = null;

function claveVistos() {
  const s = sesion.leer();
  return 'vistos:' + (s && s.cedula ? s.cedula : 'anon');
}

function nombreTicket(usuario) {
  return `${usuario.nombre.split(' ')[0]} ${usuario.apellido.split(' ')[0]}`;
}

/** Datos de un ticket a partir del cupón y de la venta que lo completó. */
function datosTicket(cupon, registro, d, acumulado, falta) {
  return {
    n: cupon.n,
    factura: cupon.factura,
    fechaHora: registro ? fechaHora(registro.fecha_carga) : fechaCorta(cupon.dia_venta),
    vendedor: nombreTicket(d.usuario),
    cedula: d.usuario.cedula_mask,
    monto: registro ? registro.monto : null,
    acumulado,
    falta,
  };
}

async function cargarPanel({ silencioso = false } = {}) {
  if (!silencioso) pintarEsqueleto();
  const r = await llamar('getDashboard');
  if (!r.ok) {
    if (r.code === 'AUTH') return; // el evento sesion:vencida ya llevó al acceso
    if (silencioso && datos) { avisar(r.message, { tipo: 'error' }); return; }
    pintarErrorCarga(r.message, () => cargarPanel());
    return;
  }
  datos = r.data;
  document.title = `${datos.concurso.nombre} · ${datos.usuario.nombre.split(' ')[0]}`;
  const vistos = recuerdo.leer(claveVistos());
  pintarCabecera(datos);
  pintarResumen(datos);
  pintarAccion(datos);
  pintarCupones(datos, { nuevosDesde: typeof vistos === 'number' ? vistos : Infinity });
  pintarVentas(datos, { verFoto });
  pintarRanking(datos);
  pintarReglas(datos);
  revisarCuponesNuevos(vistos);
}

/**
 * Si desde la última visita aparecieron cupones (p. ej. el coordinador aprobó
 * facturas, o se cargó una venta desde otro teléfono), se imprimen al entrar.
 */
function revisarCuponesNuevos(vistos) {
  const total = datos.resumen.cupones;
  if (typeof vistos !== 'number' || total < vistos) {
    recuerdo.guardar(claveVistos(), total);
    return;
  }
  if (total === vistos) return;
  recuerdo.guardar(claveVistos(), total);
  const nuevos = datos.cupones.slice(vistos);
  const porFactura = Object.fromEntries(datos.registros.map((x) => [x.numero_factura, x]));
  const M = datos.concurso.monto_por_cupon;
  const r = datos.resumen;
  mostrarImpresora({
    titulo: nuevos.length === 1 ? 'Tienes un cupón nuevo' : `Tienes ${nuevos.length} cupones nuevos`,
    tickets: nuevos.map((c) => datosTicket(c, porFactura[c.factura], datos, r.total, r.falta_para_proximo)),
    cuponesAntes: vistos,
    cuponesDespues: total,
    progresoAntes: 0,
    progresoDespues: r.sobrante / M,
    mensaje: mensajeMarcador({ nuevos: nuevos.length, falta: r.falta_para_proximo }),
  }).then(() => pintarCupones(datos, { nuevosDesde: vistos }));
}

async function alRegistrar(res) {
  const d = datos;
  const M = res.monto_por_cupon;
  recuerdo.guardar(claveVistos(), res.cupones_despues);
  if (res.pendiente_aprobacion) {
    await mostrarImpresora({
      modo: 'pendiente',
      titulo: 'Venta recibida, pendiente de aprobación',
      subtitulo: 'El coordinador revisará la foto. Cuando la apruebe, tu cupón se imprime aquí.',
      tickets: [],
      cuponesAntes: res.cupones_antes,
      cuponesDespues: res.cupones_despues,
      progresoAntes: res.sobrante_antes / M,
      progresoDespues: res.sobrante_antes / M,
      mensaje: [`Factura ${res.registro.numero_factura} · en revisión.`],
    });
  } else if (res.cupones_nuevos > 0) {
    const tickets = res.nuevos_cupones.map((c) => datosTicket(
      c,
      c.factura === res.registro.numero_factura ? res.registro : (d.registros.find((x) => x.numero_factura === c.factura) || null),
      d, res.acumulado, res.falta_para_proximo,
    ));
    await mostrarImpresora({
      titulo: res.cupones_nuevos === 1 ? 'Cupón nuevo' : `${res.cupones_nuevos} cupones nuevos`,
      tickets,
      cuponesAntes: res.cupones_antes,
      cuponesDespues: res.cupones_despues,
      progresoAntes: res.sobrante_antes / M,
      progresoDespues: res.sobrante / M,
      mensaje: mensajeMarcador({ nuevos: res.cupones_nuevos, falta: res.falta_para_proximo }),
    });
  } else {
    await mostrarImpresora({
      modo: 'sobrio',
      titulo: 'Venta registrada',
      subtitulo: `Factura ${res.registro.numero_factura}`,
      tickets: [],
      cuponesAntes: res.cupones_antes,
      cuponesDespues: res.cupones_despues,
      progresoAntes: res.sobrante_antes / M,
      progresoDespues: res.sobrante / M,
      mensaje: mensajeMarcador({ nuevos: 0, falta: res.falta_para_proximo }),
    });
  }
  const antes = d.resumen.cupones;
  await cargarPanel({ silencioso: true });
  if (datos) pintarCupones(datos, { nuevosDesde: antes });
}

async function verFoto(venta) {
  const dlg = $('#dlg-foto');
  if (!visor) visor = prepararDialogo(dlg);
  $('#visor-titulo').textContent = `Factura ${venta.numero_factura}`;
  const caja = $('#visor-imagen');
  caja.replaceChildren(h('span', { class: 'girador', style: { color: 'var(--tinta-2)' }, 'aria-label': 'Cargando foto' }));
  visor.abrir();
  const r = await llamar('getPhoto', { id: venta.id });
  if (!dlg.open) return;
  if (!r.ok) {
    caja.replaceChildren(h('p', { class: 'vacio' }, r.message));
    return;
  }
  caja.replaceChildren(h('img', { src: r.data.foto, alt: `Foto de la factura ${venta.numero_factura}` }));
}

function mostrarPanel() {
  $('#vista-acceso').hidden = true;
  $('#vista-panel').hidden = false;
  window.scrollTo(0, 0);
  cargarPanel();
}

function iniciarMenuUsuario() {
  const boton = $('#btn-avatar');
  const caja = $('#menu-usuario');
  const abrir = (si) => {
    caja.toggleAttribute('data-cerrado', !si);
    boton.setAttribute('aria-expanded', String(si));
  };
  boton.addEventListener('click', (e) => { e.stopPropagation(); abrir(caja.hasAttribute('data-cerrado')); });
  document.addEventListener('click', (e) => { if (!caja.contains(e.target)) abrir(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });
  $('#btn-salir').addEventListener('click', async () => {
    abrir(false);
    const s = sesion.leer();
    sesion.borrar();
    datos = null;
    mostrarAcceso();
    if (s) llamar('logout', { token: s.token });
  });
}

function iniciar() {
  iniciarAcceso({ entrar: mostrarPanel });
  iniciarVenta({ alRegistrar });
  iniciarMenuUsuario();
  $('#btn-registrar').addEventListener('click', () => { if (datos) abrirVenta(datos); });

  window.addEventListener('sesion:vencida', (e) => {
    datos = null;
    ['#dlg-venta', '#dlg-impresora', '#dlg-foto'].forEach((s) => { const d = $(s); if (d.open) d.close(); });
    mostrarAcceso(e.detail || 'Tu sesión venció. Ingresa de nuevo.');
  });

  // Al volver a la pestaña después de un rato, refrescamos el panel.
  let oculto = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { oculto = Date.now(); return; }
    if (datos && Date.now() - oculto > 60000 && !document.querySelector('dialog[open]')) cargarPanel({ silencioso: true });
  });

  if (sesion.leer()) mostrarPanel();
  else mostrarAcceso();
}

iniciar();
