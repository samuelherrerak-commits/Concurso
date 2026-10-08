/**
 * Copa Prosein · portal del vendedor (y vista de auditoría del administrador).
 * Punto de entrada: decide entre la pantalla de acceso, el panel y la administración.
 */
import { llamar, sesion, recuerdo } from './js/api.js';
import { $, h, avisar, prepararDialogo, mostrarErrores, cargando } from './js/dom.js';
import { dinero, fechaHora } from './js/formato.js';
import { iniciarAcceso, mostrarAcceso, llenarSucursales } from './js/acceso.js';
import { iniciarVenta, abrirVenta } from './js/venta.js';
import { mostrarImpresora, mensajeMarcador, mensajeViaje } from './js/ticket.js';
import { verCupon } from './js/cupon.js';
import { iniciarAdmin, mostrarAdmin, salirAdmin } from './js/admin.js';
import {
  pintarCabecera, pintarResumen, pintarEsqueleto, pintarErrorCarga, pintarAccion,
  pintarCupones, pintarViaje, pintarVentas, pintarRanking, pintarReglas, categoriasViaje,
} from './js/panel.js';

let datos = null;
let visor = null;
let dlgSucursal = null;
let despuesDeSucursal = null;
let sucursalPedida = false;

const cedulaSesion = () => { const s = sesion.leer(); return s && s.cedula ? s.cedula : 'anon'; };
const claveVistos = () => 'vistos:' + cedulaSesion();
const claveVistosViaje = () => 'vistos-viaje:' + cedulaSesion();

function nombreTicket(usuario) {
  return `${usuario.nombre.split(' ')[0]} ${usuario.apellido.split(' ')[0]}`;
}

/** Datos del ticket de un cupón (los mismos al imprimirlo, al verlo y al descargarlo). */
function datosTicket(c, d) {
  return {
    n: c.n,
    factura: c.factura,
    fechaHora: fechaHora(c.fecha_carga),
    vendedor: nombreTicket(d.usuario),
    cedula: d.usuario.cedula_mask,
    monto: c.monto,
    acumulado: c.acumulado,
    falta: c.falta,
  };
}

function datosTicketViaje(c, d) {
  return {
    tipo: 'austral',
    n: c.n,
    factura: c.factura,
    fechaHora: fechaHora(c.fecha_carga),
    vendedor: nombreTicket(d.usuario),
    cedula: d.usuario.cedula_mask,
    m2: c.m2,
    m2Acumulado: c.m2_acumulado,
    m2Falta: c.m2_falta,
  };
}

function abrirCupon(c, tipo) {
  if (!datos) return;
  verCupon(tipo === 'austral' ? datosTicketViaje(c, datos) : datosTicket(c, datos));
}

function pintarTodo({ nuevosDesde = Infinity, nuevosViajeDesde = Infinity } = {}) {
  pintarCabecera(datos);
  pintarResumen(datos);
  pintarAccion(datos);
  pintarCupones(datos, { nuevosDesde, alAbrir: abrirCupon });
  pintarViaje(datos, { nuevosDesde: nuevosViajeDesde, alAbrir: abrirCupon });
  pintarVentas(datos, { verFoto });
  pintarRanking(datos);
  pintarReglas(datos);
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
  if (r.data.usuario.rol === 'admin') { entrarAdmin(); return; }
  datos = r.data;
  document.title = `${datos.concurso.nombre} · ${datos.usuario.nombre.split(' ')[0]}`;
  const vistos = recuerdo.leer(claveVistos());
  const vistosViaje = recuerdo.leer(claveVistosViaje());
  pintarTodo({
    nuevosDesde: typeof vistos === 'number' ? vistos : Infinity,
    nuevosViajeDesde: typeof vistosViaje === 'number' ? vistosViaje : Infinity,
  });
  if (datos.usuario.necesita_sucursal && !sucursalPedida) {
    sucursalPedida = true;
    pedirSucursal();
    return;
  }
  revisarCuponesNuevos(vistos, vistosViaje);
}

/**
 * Si desde la última visita aparecieron cupones (p. ej. el coordinador aprobó
 * facturas, o se cargó una venta desde otro teléfono), se imprimen al entrar.
 */
async function revisarCuponesNuevos(vistos, vistosViaje) {
  const d = datos;
  const r = d.resumen;
  const total = r.cupones;
  const totalViaje = r.austral.cupones;
  const hayNuevos = typeof vistos === 'number' && total > vistos;
  const hayNuevosViaje = typeof vistosViaje === 'number' && totalViaje > vistosViaje;
  recuerdo.guardar(claveVistos(), total);
  recuerdo.guardar(claveVistosViaje(), totalViaje);

  if (hayNuevos) {
    const nuevos = d.cupones.slice(vistos);
    await mostrarImpresora({
      titulo: nuevos.length === 1 ? 'Tienes un cupón nuevo' : `Tienes ${nuevos.length} cupones nuevos`,
      tickets: nuevos.map((c) => datosTicket(c, d)),
      cuponesAntes: vistos,
      cuponesDespues: total,
      progresoAntes: 0,
      progresoDespues: r.progreso,
      mensaje: mensajeMarcador({ nuevos: nuevos.length, falta: r.falta_para_proximo }),
    });
  }
  if (hayNuevosViaje) {
    const nuevos = d.cupones_austral.slice(vistosViaje);
    await mostrarImpresora({
      variante: 'austral',
      etiqueta: 'Cupones del viaje',
      titulo: nuevos.length === 1 ? 'Tienes un cupón nuevo para el viaje' : `Tienes ${nuevos.length} cupones nuevos para el viaje`,
      tickets: nuevos.map((c) => datosTicketViaje(c, d)),
      cuponesAntes: vistosViaje,
      cuponesDespues: totalViaje,
      progresoAntes: 0,
      progresoDespues: r.austral.progreso,
      mensaje: mensajeViaje({ nuevos: nuevos.length, falta: r.austral.falta, participa: r.austral.participa, categoria: categoriasViaje(d.concurso) }),
    });
  }
  if ((hayNuevos || hayNuevosViaje) && datos === d) {
    pintarCupones(d, { nuevosDesde: hayNuevos ? vistos : Infinity, alAbrir: abrirCupon });
    pintarViaje(d, { nuevosDesde: hayNuevosViaje ? vistosViaje : Infinity, alAbrir: abrirCupon });
  }
}

async function alRegistrar(res) {
  const d = datos;
  const M = res.monto_por_cupon;
  const MA = res.m2_por_cupon;
  recuerdo.guardar(claveVistos(), res.cupones_despues);
  recuerdo.guardar(claveVistosViaje(), res.austral_despues);

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
  } else {
    if (res.cupones_nuevos > 0) {
      await mostrarImpresora({
        titulo: res.cupones_nuevos === 1 ? 'Cupón nuevo' : `${res.cupones_nuevos} cupones nuevos`,
        tickets: res.nuevos_cupones.map((c) => datosTicket(c, d)),
        cuponesAntes: res.cupones_antes,
        cuponesDespues: res.cupones_despues,
        progresoAntes: res.sobrante_antes / M,
        progresoDespues: res.sobrante / M,
        mensaje: mensajeMarcador({ nuevos: res.cupones_nuevos, falta: res.falta_para_proximo }),
      });
    } else if (!(res.austral_nuevos > 0)) {
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
    // Segunda pasada: los cupones del viaje (Austral) salen en papel azul.
    if (res.austral_nuevos > 0) {
      const mensaje = mensajeViaje({ nuevos: res.austral_nuevos, falta: res.m2_falta, participa: d.resumen.austral.participa, categoria: categoriasViaje(d.concurso) });
      if (!(res.cupones_nuevos > 0)) mensaje.push(h('br'), 'Y te faltan ', h('strong', {}, dinero(res.falta_para_proximo, { compacto: true })), ' en ventas para tu próximo cupón.');
      await mostrarImpresora({
        variante: 'austral',
        etiqueta: 'Cupones del viaje',
        titulo: res.austral_nuevos === 1 ? 'Cupón nuevo para el viaje' : `${res.austral_nuevos} cupones nuevos para el viaje`,
        tickets: res.nuevos_cupones_austral.map((c) => datosTicketViaje(c, d)),
        cuponesAntes: res.austral_antes,
        cuponesDespues: res.austral_despues,
        progresoAntes: res.m2_sobrante_antes / MA,
        progresoDespues: res.m2_sobrante / MA,
        mensaje,
      });
    }
  }
  const antes = d.resumen.cupones;
  const antesViaje = d.resumen.austral.cupones;
  await cargarPanel({ silencioso: true });
  if (datos) {
    pintarCupones(datos, { nuevosDesde: antes, alAbrir: abrirCupon });
    pintarViaje(datos, { nuevosDesde: antesViaje, alAbrir: abrirCupon });
  }
}

// ---------- Tienda obligatoria ----------

function pedirSucursal(luego) {
  despuesDeSucursal = luego || null;
  const dlg = $('#dlg-sucursal');
  if (!dlgSucursal) {
    dlgSucursal = prepararDialogo(dlg, { cerrarConFondo: false });
    $('#form-sucursal').addEventListener('submit', guardarSucursal);
  }
  const form = $('#form-sucursal');
  if (datos) llenarSucursales(datos.concurso.sucursales);
  mostrarErrores(form, {});
  dlgSucursal.abrir();
  setTimeout(() => form.elements.sucursal.focus({ preventScroll: true }), 80);
}

async function guardarSucursal(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const sucursal = form.elements.sucursal.value;
  if (!sucursal) { mostrarErrores(form, { sucursal: 'Elige la tienda Prosein donde trabajas.' }); return; }
  const boton = form.querySelector('[type="submit"]');
  cargando(boton, true, 'Guardando…');
  const r = await llamar('setSucursal', { sucursal });
  cargando(boton, false, 'Guardar tienda');
  if (!r.ok) {
    if (r.code === 'AUTH') return;
    if (r.campo) mostrarErrores(form, { [r.campo]: r.message });
    else mostrarErrores(form, {}, r.message);
    return;
  }
  const s = sesion.leer();
  if (s) sesion.guardar({ ...s, usuario: { ...s.usuario, ...r.data.usuario } });
  if (datos) {
    datos.usuario = r.data.usuario;
    pintarCabecera(datos);
  }
  dlgSucursal.cerrar('ok');
  avisar(`Listo: tu tienda es ${r.data.usuario.sucursal}.`);
  const luego = despuesDeSucursal;
  despuesDeSucursal = null;
  if (luego) setTimeout(luego, 320);
}

function registrarVenta() {
  if (!datos) return;
  if (datos.usuario.necesita_sucursal) { pedirSucursal(() => abrirVenta(datos)); return; }
  abrirVenta(datos);
}

// ---------- Foto ----------

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

// ---------- Vistas ----------

function entrarAdmin() {
  datos = null;
  $('#panel').hidden = true;
  $('#admin').hidden = false;
  $('#barra-rol').hidden = false;
  mostrarAdmin({ verFoto });
}

function mostrarPanel() {
  $('#vista-acceso').hidden = true;
  $('#vista-panel').hidden = false;
  window.scrollTo(0, 0);
  const s = sesion.leer();
  if (s && s.usuario && s.usuario.rol === 'admin') { entrarAdmin(); return; }
  $('#admin').hidden = true;
  $('#barra-rol').hidden = true;
  $('#panel').hidden = false;
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
    sucursalPedida = false;
    salirAdmin();
    mostrarAcceso();
    if (s) llamar('logout', { token: s.token });
  });
}

function iniciar() {
  iniciarAcceso({ entrar: mostrarPanel });
  iniciarVenta({ alRegistrar, alNecesitarSucursal: () => pedirSucursal(() => abrirVenta(datos)) });
  iniciarAdmin();
  iniciarMenuUsuario();
  $('#btn-registrar').addEventListener('click', registrarVenta);

  window.addEventListener('sesion:vencida', (e) => {
    datos = null;
    sucursalPedida = false;
    salirAdmin();
    ['#dlg-venta', '#dlg-impresora', '#dlg-foto', '#dlg-cupon', '#dlg-sucursal'].forEach((s) => { const d = $(s); if (d.open) d.close(); });
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
