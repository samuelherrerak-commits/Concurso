/**
 * "Agregar a inicio": instala el portal como app.
 *  - Android y computadoras (Chrome, Edge): usa el aviso de instalación del navegador.
 *  - iPhone y iPad (Safari no tiene ese aviso): explica los pasos con un aviso.
 * Si ya se abrió como app, los botones no aparecen.
 */
import { $$, avisar } from './dom.js';

let aviso = null;

const yaInstalada = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function mostrarBotones(si) {
  $$('[data-instalar]').forEach((b) => { b.hidden = !si; });
}

async function instalar() {
  if (aviso) {
    aviso.prompt();
    const { outcome } = await aviso.userChoice;
    aviso = null;
    mostrarBotones(false);
    if (outcome === 'accepted') avisar('Listo: La bolsa de los deseos quedó en tu pantalla de inicio.');
    return;
  }
  if (esIOS()) {
    avisar('En Safari: toca el botón Compartir (el cuadrito con la flecha) y luego “Agregar a inicio”.', { duracion: 9000 });
    return;
  }
  avisar('Abre el menú del navegador (⋮) y elige “Instalar app” o “Agregar a pantalla de inicio”.', { duracion: 9000 });
}

export function iniciarInstalacion() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin app instalable, el portal funciona igual */ });
  }
  $$('[data-instalar]').forEach((b) => b.addEventListener('click', instalar));
  if (yaInstalada()) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    aviso = e;
    mostrarBotones(true);
  });
  window.addEventListener('appinstalled', () => { aviso = null; mostrarBotones(false); });
  if (esIOS()) mostrarBotones(true);
}
