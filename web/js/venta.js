/** Formulario "Registrar venta" (hoja inferior en móvil, diálogo en escritorio). */
import { CONFIG } from '../config.js';
import { llamar } from './api.js';
import { $, $$, prepararDialogo, mostrarErrores, cargando, avisar } from './dom.js';
import { dinero, parsearDecimal, pesoArchivo, plural, fechaCorta, fechaConDia, decimal } from './formato.js';
import { comprimirImagen } from './imagen.js';

let contexto = null;
let foto = null;
let enviando = false;
let dialogo = null;
let alRegistrarCb = null;
let alNecesitarSucursalCb = null;
let limpio = true;
/** Paso de revisión: los datos se muestran para validarlos antes de enviar. */
let revisando = false;

export function iniciarVenta({ alRegistrar, alNecesitarSucursal }) {
  alRegistrarCb = alRegistrar;
  alNecesitarSucursalCb = alNecesitarSucursal;
  const dlg = $('#dlg-venta');
  const form = $('#form-venta');
  // Mientras se envía no se puede cerrar (Escape, fondo o la X).
  dialogo = prepararDialogo(dlg, { cerrarConFondo: true, puedeCerrar: (motivo) => !enviando || motivo === 'ok' });

  form.elements.monto.addEventListener('input', actualizarAyudaMonto);
  form.elements.numero_factura.addEventListener('input', (e) => {
    const t = e.target;
    const pos = t.selectionStart;
    t.value = t.value.toUpperCase();
    t.setSelectionRange(pos, pos);
  });

  const austral = $('#v-austral');
  austral.addEventListener('change', () => {
    const abierto = austral.checked;
    $('#v-austral-bloque').toggleAttribute('data-abierto', abierto);
    const m2 = form.elements.m2_austral;
    m2.disabled = !abierto;
    m2.required = abierto;
    if (abierto) setTimeout(() => m2.focus({ preventScroll: true }), 120);
    else limpiarError(form, 'm2_austral');
  });

  $$('[data-foto]', form).forEach((input) => input.addEventListener('change', () => elegirFoto(input)));
  form.addEventListener('input', () => { limpio = false; });
  form.addEventListener('submit', enviar);
  $('#v-corregir').addEventListener('click', () => mostrarRevision(false));
}

export function abrirVenta(datos) {
  contexto = datos;
  const form = $('#form-venta');
  const c = datos.concurso;
  // Solo días de semanas que no han cerrado su corte (lo decide el servidor).
  const dia = form.elements.dia_venta;
  dia.min = c.dia_min_carga;
  dia.max = c.dia_max_carga;
  if (limpio || !dia.value || dia.value < dia.min || dia.value > dia.max) dia.value = c.dia_max_carga;
  mostrarErrores(form, {});
  mostrarRevision(false);
  actualizarAyudaMonto();
  dialogo.abrir();
}

function reiniciar() {
  const form = $('#form-venta');
  form.reset();
  foto = null;
  $('#v-foto-previa').hidden = true;
  $('#v-foto-vacio').hidden = false;
  $('#v-foto-miniatura').replaceChildren();
  $('#v-austral-bloque').removeAttribute('data-abierto');
  form.elements.m2_austral.disabled = true;
  limpio = true;
  mostrarRevision(false);
  mostrarErrores(form, {});
}

/** Muestra (o esconde) el resumen de la venta para validarlo antes de registrarla. */
function mostrarRevision(activa, valores) {
  revisando = activa;
  $('#v-campos').hidden = activa;
  $('#v-revision').hidden = !activa;
  $('#v-corregir').hidden = !activa;
  $('#v-enviar').querySelector('[data-texto]').textContent = activa ? 'Sí, los datos están bien' : 'Registrar venta';
  if (!activa) return;
  const dato = (titulo, valor) => {
    const fila = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = titulo;
    dd.textContent = valor;
    fila.append(dt, dd);
    return fila;
  };
  $('#v-revision-lista').replaceChildren(
    dato('Día de la venta', fechaConDia(valores.dia_venta)),
    dato('N° de factura', valores.numero_factura),
    dato('Monto', dinero(valores.monto)),
    dato('Austral', valores.vendio_austral ? `${decimal(valores.m2_austral)} m²` : 'No'),
  );
  const img = new Image();
  img.alt = 'Foto de la factura';
  img.src = foto.dataUrl;
  $('#v-revision-foto').replaceChildren(img);
  const caja = $('#v-revision');
  caja.focus({ preventScroll: true });
  caja.scrollIntoView({ block: 'start' });
}

function limpiarError(form, campo) {
  const p = form.querySelector(`[data-error="${campo}"]`);
  if (p) p.textContent = '';
  const control = campo === 'foto' ? $('#v-foto') : form.elements[campo];
  if (control) control.removeAttribute('aria-invalid');
}

function actualizarAyudaMonto() {
  const ayuda = $('#v-monto-ayuda');
  const monto = parsearDecimal($('#form-venta').elements.monto.value);
  if (!contexto || !(monto > 0)) { ayuda.textContent = ''; return; }
  const M = contexto.resumen.monto_por_cupon;
  const sobrante = contexto.resumen.sobrante;
  const completa = Math.floor((sobrante + monto) / M);
  const falta = M - ((sobrante + monto) % M);
  ayuda.replaceChildren(`${dinero(monto)} · `);
  if (contexto.concurso.contar_solo_aprobadas) {
    ayuda.append(completa > 0 ? `completará ${plural(completa, 'cupón', 'cupones')} cuando aprueben la factura` : `quedarás a ${dinero(falta, { compacto: true })} de tu próximo cupón`);
  } else if (completa > 0) {
    const fuerte = document.createElement('strong');
    fuerte.textContent = `completas ${plural(completa, 'cupón', 'cupones')}`;
    ayuda.append('con esta venta ', fuerte);
  } else {
    ayuda.append(`te faltarán ${dinero(falta, { compacto: true })} para tu próximo cupón`);
  }
}

async function elegirFoto(input) {
  const archivo = input.files && input.files[0];
  input.value = '';
  if (!archivo) return;
  const form = $('#form-venta');
  limpiarError(form, 'foto');
  const boton = $('#v-enviar');
  cargando(boton, true, 'Preparando foto…');
  try {
    foto = await comprimirImagen(archivo, { ladoMax: CONFIG.FOTO_LADO_MAX, calidad: CONFIG.FOTO_CALIDAD });
    const img = new Image();
    img.alt = 'Vista previa de la factura';
    img.src = foto.dataUrl;
    $('#v-foto-miniatura').replaceChildren(img);
    $('#v-foto-peso').textContent = `${foto.ancho} × ${foto.alto} px · ${pesoArchivo(foto.bytes)}`;
    $('#v-foto-vacio').hidden = true;
    $('#v-foto-previa').hidden = false;
  } catch (err) {
    foto = null;
    mostrarErrores(form, { foto: err.message || 'No pudimos leer esa foto.' });
  } finally {
    cargando(boton, false, 'Registrar venta');
  }
}

function validar(form) {
  const e = {};
  const c = contexto.concurso;
  const dia = form.elements.dia_venta.value;
  if (!dia) e.dia_venta = 'Elige el día de la venta.';
  else if (dia > c.dia_max_carga) e.dia_venta = dia > c.hoy ? 'La fecha no puede ser futura.' : `La Copa terminó el ${fechaCorta(c.fecha_fin)}.`;
  else if (dia < c.fecha_inicio) e.dia_venta = `La Copa empezó el ${fechaCorta(c.fecha_inicio)}.`;
  else if (dia < c.dia_min_carga) e.dia_venta = `Esa semana ya cerró. Puedes cargar ventas desde el ${fechaCorta(c.dia_min_carga)}.`;

  const factura = form.elements.numero_factura.value.trim();
  if (!factura) e.numero_factura = 'Escribe el número de factura.';
  else if (!/^[A-Za-z0-9][A-Za-z0-9 .\/-]{0,29}$/.test(factura)) e.numero_factura = 'Usa solo letras, números y guiones.';

  const monto = parsearDecimal(form.elements.monto.value);
  if (!(monto > 0)) e.monto = 'Escribe el monto de la venta.';

  if (!foto) e.foto = 'Agrega la foto de la factura.';

  const austral = $('#v-austral').checked;
  const m2 = parsearDecimal(form.elements.m2_austral.value);
  if (austral && !(m2 > 0)) e.m2_austral = 'Escribe cuántos m² de Austral vendiste.';

  return { errores: e, valores: { dia_venta: dia, numero_factura: factura.toUpperCase(), monto, vendio_austral: austral, m2_austral: austral ? m2 : 0 } };
}

async function enviar(ev) {
  ev.preventDefault();
  if (enviando) return;
  const form = $('#form-venta');
  const { errores, valores } = validar(form);
  if (Object.keys(errores).length) {
    mostrarErrores(form, errores);
    if (errores.foto && Object.keys(errores).length === 1) $('#v-foto').scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  mostrarErrores(form, {});
  // Doble chequeo: primero se muestran los datos para validarlos con la factura.
  if (!revisando) {
    mostrarRevision(true, valores);
    return;
  }
  enviando = true;
  const boton = $('#v-enviar');
  cargando(boton, true, 'Subiendo foto…');
  const lento = setTimeout(() => cargando(boton, true, 'Registrando… (casi listo)'), 6000);
  const r = await llamar('addSale', { ...valores, foto: foto.dataUrl }, { timeout: 90000 });
  clearTimeout(lento);
  enviando = false;
  cargando(boton, false, revisando ? 'Sí, los datos están bien' : 'Registrar venta');

  if (!r.ok) {
    if (r.code === 'AUTH') { dialogo.cerrar(); return; }
    if (r.code === 'NEED_CANAL' && alNecesitarSucursalCb) {
      // Los datos de la venta se quedan en el formulario para enviarla después.
      dialogo.cerrar('ok');
      alNecesitarSucursalCb();
      return;
    }
    if (r.campo) mostrarRevision(false);
    if (r.campo) mostrarErrores(form, { [r.campo]: r.message });
    else mostrarErrores(form, {}, r.message);
    if (r.code === 'NETWORK' || r.code === 'TIMEOUT') avisar('Tu venta no se envió. Tus datos siguen aquí: intenta de nuevo.', { tipo: 'error' });
    return;
  }
  dialogo.cerrar('ok');
  reiniciar();
  if (alRegistrarCb) alRegistrarCb(r.data);
}
