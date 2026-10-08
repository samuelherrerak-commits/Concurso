/** Pantalla de acceso: ingresar, crear cuenta y crear nueva contraseña. */
import { llamar, sesion } from './api.js';
import { $, $$, mostrarErrores, cargando } from './dom.js';
import { fechaLarga } from './formato.js';

let alEntrar = null;

export function iniciarAcceso({ entrar }) {
  alEntrar = entrar;

  const tabs = $('#pestanas-acceso');
  $$('[role="tab"]', tabs).forEach((tab, i) => {
    tab.addEventListener('click', () => mostrarPestana(i));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const otro = i === 0 ? 1 : 0;
        mostrarPestana(otro);
        $$('[role="tab"]', tabs)[otro].focus();
      }
    });
  });

  $$('[data-ver-clave]').forEach((b) => b.addEventListener('click', () => {
    const input = b.parentElement.querySelector('input');
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(ver));
    b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
    b.querySelector('use').setAttribute('href', ver ? '#i-ojo-no' : '#i-ojo');
  }));

  $('#btn-olvido').addEventListener('click', () => {
    const nota = $('#nota-olvido');
    nota.hidden = !nota.hidden;
  });
  $('#btn-volver-ingresar').addEventListener('click', () => {
    $('#form-nueva-clave').hidden = true;
    $('#pestanas-acceso').hidden = false;
    mostrarPestana(0);
  });

  // Solo dígitos en la cédula (aceptamos que peguen "V-12.345.678").
  $$('input[name="cedula"]').forEach((input) => input.addEventListener('input', () => {
    const limpio = input.value.replace(/\D/g, '').slice(0, 9);
    if (limpio !== input.value) input.value = limpio;
  }));

  $('#form-ingresar').addEventListener('submit', ingresar);
  $('#form-registro').addEventListener('submit', registrar);
  $('#form-nueva-clave').addEventListener('submit', nuevaClave);

  cargarFechas();
}

export function mostrarAcceso(mensaje) {
  $('#vista-panel').hidden = true;
  $('#vista-acceso').hidden = false;
  window.scrollTo(0, 0);
  document.title = 'Copa Prosein · Ingresar';
  if (mensaje) mostrarErrores($('#form-ingresar'), {}, mensaje);
}

function mostrarPestana(i) {
  const tabs = $$('#pestanas-acceso [role="tab"]');
  $('#pestanas-acceso').dataset.activo = String(i);
  tabs.forEach((t, j) => {
    t.setAttribute('aria-selected', String(i === j));
    t.tabIndex = i === j ? 0 : -1;
  });
  $('#form-ingresar').hidden = i !== 0;
  $('#form-registro').hidden = i !== 1;
  $('#form-nueva-clave').hidden = true;
}

async function cargarFechas() {
  const r = await llamar('config', {}, { timeout: 15000 });
  if (!r.ok) return;
  const c = r.data;
  $('#acceso-fechas').textContent = `Del ${fechaLarga(c.fecha_inicio)} al ${fechaLarga(c.fecha_fin)}`;
}

function guardarYEntrar(datos, cedula) {
  sesion.guardar({ token: datos.token, expira: datos.expira, usuario: datos.usuario, cedula });
  alEntrar();
}

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

async function ingresar(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const cedula = soloDigitos(form.elements.cedula.value);
  const password = form.elements.password.value;
  const errores = {};
  if (!/^\d{6,9}$/.test(cedula)) errores.cedula = 'Escribe tu cédula (6 a 9 dígitos).';
  if (!password) errores.password = 'Escribe tu contraseña.';
  if (Object.keys(errores).length) { mostrarErrores(form, errores); return; }

  const boton = form.querySelector('[type="submit"]');
  cargando(boton, true);
  const r = await llamar('login', { cedula, password, token: undefined });
  cargando(boton, false);
  if (r.ok) { mostrarErrores(form, {}); form.reset(); guardarYEntrar(r.data, cedula); return; }
  if (r.code === 'RESET_REQUIRED') {
    mostrarErrores(form, {});
    $('#pestanas-acceso').hidden = true;
    form.hidden = true;
    const nc = $('#form-nueva-clave');
    nc.hidden = false;
    nc.elements.cedula.value = cedula;
    nc.elements.telefono.focus();
    return;
  }
  mostrarErrores(form, {}, r.message);
}

function validarClaves(form, errores) {
  const p1 = form.elements.password.value;
  const p2 = form.elements.password2.value;
  if (p1.length < 6) errores.password = 'Usa al menos 6 caracteres.';
  else if (p1 !== p2) errores.password2 = 'Las contraseñas no coinciden.';
}

async function registrar(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const v = (n) => form.elements[n].value.trim();
  const errores = {};
  if (!v('nombre')) errores.nombre = 'Escribe tu nombre.';
  if (!v('apellido')) errores.apellido = 'Escribe tu apellido.';
  const cedula = soloDigitos(v('cedula'));
  if (!/^\d{6,9}$/.test(cedula)) errores.cedula = 'La cédula debe tener entre 6 y 9 dígitos.';
  const telefono = soloDigitos(v('telefono'));
  if (telefono.length < 10 || telefono.length > 13) errores.telefono = 'Escribe tu teléfono con código, por ejemplo 0414 123 4567.';
  validarClaves(form, errores);
  if (Object.keys(errores).length) { mostrarErrores(form, errores); return; }

  const boton = form.querySelector('[type="submit"]');
  cargando(boton, true);
  const r = await llamar('register', {
    cedula, telefono, nombre: v('nombre'), apellido: v('apellido'), sucursal: v('sucursal'), password: form.elements.password.value, token: undefined,
  });
  cargando(boton, false);
  if (r.ok) { mostrarErrores(form, {}); form.reset(); guardarYEntrar(r.data, cedula); return; }
  if (r.campo) mostrarErrores(form, { [r.campo]: r.message });
  else mostrarErrores(form, {}, r.message);
}

async function nuevaClave(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const errores = {};
  const telefono = soloDigitos(form.elements.telefono.value);
  if (telefono.length < 10) errores.telefono = 'Escribe el teléfono con el que te registraste.';
  validarClaves(form, errores);
  if (Object.keys(errores).length) { mostrarErrores(form, errores); return; }

  const boton = form.querySelector('[type="submit"]');
  cargando(boton, true);
  const cedula = form.elements.cedula.value;
  const r = await llamar('setPassword', { cedula, telefono, password: form.elements.password.value, token: undefined });
  cargando(boton, false);
  if (r.ok) {
    mostrarErrores(form, {});
    form.reset();
    form.hidden = true;
    $('#pestanas-acceso').hidden = false;
    mostrarPestana(0);
    guardarYEntrar(r.data, cedula);
    return;
  }
  if (r.campo) mostrarErrores(form, { [r.campo]: r.message });
  else mostrarErrores(form, {}, r.message);
}
