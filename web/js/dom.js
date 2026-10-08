/** Utilidades de DOM pequeñas: crear nodos, íconos, avisos y diálogos animados. */

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/**
 * h('div', { class: 'x', onclick }, hijo1, 'texto', ...)
 * Los textos siempre se insertan como texto (nunca como HTML).
 */
export function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

const SVG = 'http://www.w3.org/2000/svg';

export function icono(nombre, clase = 'icono') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', clase);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '#i-' + nombre);
  svg.append(use);
  return svg;
}

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export const reducirMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Avisos flotantes (toasts) con transiciones, no keyframes: se pueden interrumpir. */
export function avisar(mensaje, { tipo = 'info', duracion = 4200 } = {}) {
  const zona = document.getElementById('avisos');
  const t = h('div', { class: 'toast' + (tipo === 'error' ? ' toast--error' : ''), role: tipo === 'error' ? 'alert' : 'status', 'data-entrando': true },
    icono(tipo === 'error' ? 'alerta' : 'check'), h('span', {}, mensaje));
  zona.append(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.removeAttribute('data-entrando')));
  const cerrar = () => {
    t.setAttribute('data-saliendo', '');
    t.addEventListener('transitionend', () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 600);
  };
  setTimeout(cerrar, duracion);
  t.addEventListener('click', cerrar);
}

/**
 * Abre un <dialog> con animación de entrada (data-abierto) y lo cierra
 * esperando que termine la transición. Cierra con Escape y tocando el fondo.
 */
export function prepararDialogo(dlg, { alCerrar, cerrarConFondo = true, puedeCerrar } = {}) {
  let cerrando = false;
  const cerrar = (valor) => {
    if (!dlg.open || cerrando) return;
    if (puedeCerrar && !puedeCerrar(valor)) return;
    cerrando = true;
    dlg.removeAttribute('data-abierto');
    const fin = () => {
      if (!cerrando) return;
      cerrando = false;
      dlg.close(valor);
      if (alCerrar) alCerrar(valor);
    };
    const ms = reducirMovimiento() ? 0 : parseFloat(getComputedStyle(dlg).transitionDuration || '0') * 1000;
    if (ms > 0) {
      dlg.addEventListener('transitionend', (e) => { if (e.target === dlg) fin(); }, { once: true });
      setTimeout(fin, ms + 80);
    } else fin();
  };
  const abrir = () => {
    if (dlg.open) return;
    dlg.showModal();
    // Dos frames: el navegador pinta el estado inicial antes de animar.
    requestAnimationFrame(() => requestAnimationFrame(() => dlg.setAttribute('data-abierto', '')));
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); cerrar('cancel'); });
  if (cerrarConFondo) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) cerrar('fondo'); });
  }
  $$('[data-cerrar]', dlg).forEach((b) => b.addEventListener('click', () => cerrar('boton')));
  return { abrir, cerrar };
}

/** Muestra errores devueltos por el servidor o por la validación local. */
export function mostrarErrores(form, errores = {}, general = '') {
  $$('[data-error]', form).forEach((p) => { p.textContent = ''; });
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  const aviso = $('[data-aviso]', form);
  if (aviso) aviso.textContent = general || '';
  let primero = null;
  for (const [campo, mensaje] of Object.entries(errores)) {
    const p = $(`[data-error="${campo}"]`, form);
    if (p) p.replaceChildren(icono('alerta', 'icono'), document.createTextNode(mensaje));
    const control = form.elements[campo] || form.querySelector(`[data-control="${campo}"]`);
    if (control && control.setAttribute) {
      control.setAttribute('aria-invalid', 'true');
      if (!primero) primero = control;
    }
  }
  if (primero && typeof primero.focus === 'function') primero.focus({ preventScroll: false });
  else if (general && aviso) aviso.scrollIntoView({ block: 'nearest' });
}

export function cargando(boton, activo, texto) {
  if (!boton) return;
  boton.toggleAttribute('data-cargando', activo);
  boton.disabled = activo;
  const span = boton.querySelector('[data-texto]') || boton.querySelector('span:last-child');
  if (span && texto) span.textContent = texto;
}
