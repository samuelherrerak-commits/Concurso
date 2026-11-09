/**
 * Aviso con cuenta regresiva para un sorteo: sale cada vez que el vendedor entra al portal,
 * hasta la hora `hasta`. Las horas llevan su zona (-04:00 = Venezuela), así que el contador
 * es el mismo en cualquier teléfono. Para el próximo sorteo basta con cambiar AVISO.
 */
import { h, prepararDialogo } from './dom.js';

export const AVISO = {
  sorteo: '2026-11-09T14:30:00-04:00',
  hasta: '2026-11-09T18:00:00-04:00',
  kicker: '¡1er SORTEO!',
  fechaTexto: 'Hoy lunes 9 de nov.',
  horaTexto: '2:30 p. m.',
};

const MICROONDAS = '<svg viewBox="0 0 360 230" aria-hidden="true"><rect x="8" y="10" width="344" height="200" rx="22" fill="#F4F5F7"/><rect x="30" y="34" width="216" height="152" rx="12" fill="#1E2227"/><rect x="44" y="48" width="188" height="124" rx="8" fill="#2D333A"/><path d="M58 60 L120 60 L72 160 L58 160 Z" fill="#fff" opacity=".1"/><rect x="270" y="36" width="64" height="28" rx="6" fill="#1E2227"/><text x="302" y="56" text-anchor="middle" font-family="Chivo Mono, monospace" font-size="16" font-weight="700" fill="#46E07A">2:30</text><g fill="#C9CDD3"><circle cx="284" cy="86" r="7"/><circle cx="302" cy="86" r="7"/><circle cx="320" cy="86" r="7"/><circle cx="284" cy="106" r="7"/><circle cx="302" cy="106" r="7"/><circle cx="320" cy="106" r="7"/></g><rect x="276" y="148" width="52" height="30" rx="8" fill="#DF1630"/><path d="M300 10 l-18 -10 l-6 22 z M300 10 l18 -10 l6 22 z" fill="#F2B233"/><circle cx="300" cy="12" r="8" fill="#E9A21B"/></svg>';

let dlg = null;
let ctl = null;
let reloj = 0;
let alTerminar = null;

const dos = (n) => String(n).padStart(2, '0');

function armar() {
  const caja = (id, etiqueta) => h('div', { class: 'aviso-sorteo__caja' }, h('b', { id }, '00'), h('span', {}, etiqueta));
  const micro = h('div', { class: 'aviso-sorteo__micro' });
  micro.innerHTML = MICROONDAS;
  dlg = h('dialog', { class: 'aviso-sorteo', 'aria-labelledby': 'aviso-sorteo-titulo' },
    h('div', { class: 'aviso-sorteo__tarjeta' },
      h('button', { type: 'button', class: 'aviso-sorteo__x', 'data-cerrar': true, 'aria-label': 'Cerrar' }, '×'),
      h('div', { class: 'aviso-sorteo__cab' },
        h('img', { src: 'assets/logo-prosein.jpg', alt: 'Prosein', width: 58, height: 58 }),
        h('div', {},
          h('small', {}, 'Copa Navideña'),
          h('b', {}, AVISO.kicker),
          h('div', { class: 'aviso-sorteo__marca' }, h('span', { class: 'aviso-sorteo__austral' }, 'Austral'), ' - Prosein'))),
      h('h2', { id: 'aviso-sorteo-titulo' }, 'Falta poco para nuestro ', h('em', {}, 'primer sorteo')),
      h('p', { class: 'aviso-sorteo__pregunta' }, '¿Quiénes se ganarán los ', h('strong', {}, '7 microondas'), '?'),
      micro,
      h('div', { class: 'aviso-sorteo__cuando' }, h('span', {}, AVISO.fechaTexto), h('span', {}, AVISO.horaTexto)),
      h('div', { class: 'aviso-sorteo__contador', id: 'aviso-sorteo-contador', role: 'timer', 'aria-live': 'off' },
        caja('aviso-h', 'Horas'), caja('aviso-m', 'Min'), caja('aviso-s', 'Seg')),
      h('p', { class: 'aviso-sorteo__ya', id: 'aviso-sorteo-ya', hidden: true }, '¡El sorteo está en curso!'),
      h('button', { type: 'button', class: 'aviso-sorteo__boton', 'data-cerrar': true }, '¡Entendido, a vender!')));
  document.body.append(dlg);
  ctl = prepararDialogo(dlg, {
    alCerrar: () => {
      clearInterval(reloj);
      const fin = alTerminar;
      alTerminar = null;
      if (fin) fin();
    },
  });
}

function actualizar() {
  const falta = Math.max(0, new Date(AVISO.sorteo).getTime() - Date.now());
  const s = Math.floor(falta / 1000);
  document.getElementById('aviso-h').textContent = dos(Math.floor(s / 3600));
  document.getElementById('aviso-m').textContent = dos(Math.floor((s % 3600) / 60));
  document.getElementById('aviso-s').textContent = dos(s % 60);
  const ya = falta === 0;
  document.getElementById('aviso-sorteo-contador').hidden = ya;
  document.getElementById('aviso-sorteo-ya').hidden = !ya;
}

/** Muestra el aviso si todavía está vigente. Devuelve una promesa que se cumple al cerrarlo. */
export function mostrarAvisoSorteo() {
  try { if (localStorage.getItem('copa-prosein:sin-aviso')) return Promise.resolve(); } catch { /* sin acción */ }
  if (Date.now() >= new Date(AVISO.hasta).getTime()) return Promise.resolve();
  if (!dlg) armar();
  if (dlg.open) return Promise.resolve();
  actualizar();
  clearInterval(reloj);
  reloj = setInterval(actualizar, 1000);
  const cerrado = new Promise((ok) => { alTerminar = ok; });
  ctl.abrir();
  return cerrado;
}
