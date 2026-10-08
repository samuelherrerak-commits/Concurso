/**
 * Tickets de supermercado: el componente (grande y mini) y la "impresora".
 *
 * Movimiento (principios de Emil Kowalski):
 *  - Solo transform y opacity (más clip-path estático para la ranura).
 *  - El papel avanza renglón por renglón como una impresora térmica:
 *    cada paso es un ease-out corto, ~60 ms por línea.
 *  - Al cortar el papel cae unos píxeles y se asienta (física creíble).
 *  - El sello entra con escala + rotación, como un sello de goma.
 *  - prefers-reduced-motion: sin impresión ni rotación, solo un fundido.
 */
import { $, h, icono, svgEl, prepararDialogo, reducirMovimiento, esperar } from './dom.js';
import { dinero, plural } from './formato.js';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

// ---------- Componentes ----------

function fila(etiqueta, valor) {
  return h('div', { class: 'ticket__fila', 'data-l': true }, h('span', {}, etiqueta), h('span', {}, valor));
}

function corte() {
  return h('hr', { class: 'corte', 'data-l': true });
}

/** Código de barras decorativo, siempre igual para el mismo texto. */
function codigoBarras(semilla) {
  let x = 2166136261;
  for (const c of String(semilla)) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  const azar = () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  const svg = svgEl('svg', { viewBox: '0 0 200 40', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const barra = (pos, ancho) => svg.append(svgEl('rect', { x: pos, y: 0, width: ancho, height: 40, fill: 'currentColor' }));
  barra(0, 2); barra(4, 1);
  let pos = 8;
  while (pos < 190) {
    const ancho = 1 + Math.floor(azar() * 3);
    barra(pos, ancho);
    pos += ancho + 1 + Math.floor(azar() * 2.4);
  }
  barra(195, 1); barra(198, 2);
  return svg;
}

/**
 * @param {object} d { n, hasta?, fechaHora, factura, vendedor, cedula, monto?, acumulado, falta }
 */
export function crearTicket(d) {
  const rango = d.hasta && d.hasta > d.n;
  const sello = h('div', { class: 'sello', 'data-sello': true },
    h('small', {}, rango ? 'CUPONES' : 'CUPÓN'),
    h('strong', {}, rango ? `N° ${d.n} al ${d.hasta}` : `N° ${d.n}`));
  const papel = h('div', { class: 'papel' },
    h('div', { class: 'ticket__marca', 'data-l': true }, 'PROSEIN'),
    h('div', { class: 'ticket__sub', 'data-l': true }, 'COPA PROSEIN'),
    corte(),
    fila('FECHA', d.fechaHora),
    fila('FACTURA', d.factura),
    fila('VENDEDOR', String(d.vendedor || '').toUpperCase()),
    fila('C.I.', d.cedula),
    d.monto !== null && d.monto !== undefined ? fila('MONTO', dinero(d.monto)) : null,
    corte(),
    h('div', { class: 'ticket__cupon', 'data-l': true }, sello),
    corte(),
    fila('ACUMULADO', dinero(d.acumulado)),
    fila('PRÓXIMO CUPÓN EN', dinero(d.falta)),
    h('div', { class: 'ticket__barras', 'data-l': true }, codigoBarras(`${d.factura}-${d.n}`), h('span', { class: 'ticket__codigo' }, `CP ${String(d.n).padStart(4, '0')}`)),
    h('div', { class: 'ticket__gracias', 'data-l': true }, '¡GRACIAS POR SU VENTA!'),
  );
  return h('div', { class: 'ticket sombra-papel', role: 'img', 'aria-label': rango ? `Cupones ${d.n} al ${d.hasta}` : `Cupón número ${d.n}, factura ${d.factura}` }, papel);
}

/** Mini ticket para "Mis cupones". */
export function crearMini({ n, dia, factura, nuevo }) {
  return h('div', { class: 'mini sombra-papel' + (nuevo ? ' mini--nuevo' : ''), role: 'listitem' },
    h('div', { class: 'papel' },
      h('div', { class: 'mini__titulo' }, 'CUPÓN'),
      h('div', { class: 'mini__n' }, `N° ${String(n).padStart(2, '0')}`),
      h('div', { class: 'mini__dato' }, dia),
      h('div', { class: 'mini__dato', title: factura }, `Fact. ${factura}`)));
}

// ---------- Animación ----------

/** Corre una animación WAAPI y deja fijado el estado final. */
async function animar(el, cuadros, opciones) {
  const a = el.animate(cuadros, { fill: 'forwards', ...opciones });
  try {
    await a.finished;
  } catch {
    return; // cancelada
  }
  const ultimo = cuadros[cuadros.length - 1];
  if (ultimo.transform !== undefined) el.style.transform = ultimo.transform;
  if (ultimo.opacity !== undefined) el.style.opacity = ultimo.opacity;
  a.cancel();
}

function vibrar(patron) {
  try { if (navigator.vibrate) navigator.vibrate(patron); } catch { /* sin acción */ }
}

/** El papel sale de la ranura renglón por renglón (de abajo hacia arriba, como sale el papel). */
async function imprimirTicket(ticket, duracion, caida) {
  const alto = ticket.offsetHeight;
  const cimas = [...ticket.querySelectorAll('[data-l]')].map((l) => l.offsetTop);
  const pasos = [-alto, ...cimas.reverse().map((t) => -t), 0];
  const cuadros = pasos.map((y, i) => ({
    transform: `translateY(${y}px)`,
    offset: i / (pasos.length - 1),
    easing: EASE_OUT,
  }));
  ticket.style.opacity = '1';
  await animar(ticket, cuadros, { duration: duracion });
  // Corte del papel: cae un poco y se asienta.
  await animar(ticket, [
    { transform: 'translateY(0)', easing: EASE_OUT },
    { transform: 'translateY(7px)', offset: 0.35, easing: EASE_IN_OUT },
    { transform: 'translateY(0)' },
  ], { duration: caida });
}

async function sellar(ticket, { golpe = true } = {}) {
  const sello = ticket.querySelector('[data-sello]');
  vibrar(14);
  await Promise.all([
    // (sin golpe en los tickets que luego se apilan: su transform lo maneja apilar)
    animar(sello, [
      { opacity: 0, transform: 'rotate(-16deg) scale(1.7)' },
      { opacity: 1, transform: 'rotate(-6deg) scale(0.94)', offset: 0.65 },
      { opacity: 1, transform: 'rotate(-7deg) scale(1)' },
    ], { duration: 320, easing: EASE_OUT }),
    // El golpe del sello mueve el papel apenas.
    !golpe ? null : animar(ticket, [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(1.5px) scale(0.992)', offset: 0.7 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: 260, delay: 140, easing: EASE_OUT }),
  ]);
}

function apilar(tickets, nuevo) {
  // Los tickets anteriores se corren hacia atrás con un pequeño desfase.
  tickets.slice(0, nuevo).forEach((t, i) => {
    const d = nuevo - i;
    const destino = `translate(${-7 * d}px, ${7 * d}px) rotate(${-2.5 * d}deg)`;
    animar(t, [{ transform: t.style.transform || 'none' }, { transform: destino }], { duration: 280, easing: EASE_OUT });
  });
}

function contar(el, desde, hasta, duracion) {
  if (desde === hasta || reducirMovimiento()) { el.textContent = String(hasta); return Promise.resolve(); }
  return new Promise((resolve) => {
    const inicio = performance.now();
    const paso = (ahora) => {
      const t = Math.min(1, (ahora - inicio) / duracion);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(desde + (hasta - desde) * e));
      if (t < 1) requestAnimationFrame(paso); else resolve();
    };
    requestAnimationFrame(paso);
  });
}

async function llenarBarra(relleno, desde, hasta, completo) {
  const fijar = (p) => { relleno.style.transform = `scaleX(${p})`; };
  if (reducirMovimiento()) { fijar(hasta); return; }
  if (completo) {
    await animar(relleno, [{ transform: `scaleX(${desde})` }, { transform: 'scaleX(1)' }], { duration: 280, easing: EASE_OUT });
    fijar(0);
    await esperar(40);
    desde = 0;
  }
  await animar(relleno, [{ transform: `scaleX(${desde})` }, { transform: `scaleX(${hasta})` }], { duration: 380, easing: EASE_OUT });
}

// ---------- La impresora ----------

let control = null;
let alCerrarActual = null;

function preparar() {
  if (control) return control;
  const dlg = $('#dlg-impresora');
  control = prepararDialogo(dlg, {
    alCerrar: () => { const f = alCerrarActual; alCerrarActual = null; if (f) f(); },
  });
  $('#impresora-continuar').addEventListener('click', () => control.cerrar('continuar'));
  // Tocar fuera del ticket y del marcador también cierra.
  $('#impresora-escena').addEventListener('click', (e) => {
    if (e.target.id === 'impresora-escena') control.cerrar('fondo');
  });
  return control;
}

/**
 * Muestra la impresora.
 * @param {object} o
 *   tickets: datos de cada ticket (vacío = confirmación sobria)
 *   cuponesAntes, cuponesDespues, progresoAntes, progresoDespues (0..1)
 *   titulo, mensaje (nodos o texto), modo: 'cupon' | 'sobrio' | 'pendiente'
 */
export function mostrarImpresora(o) {
  const ctl = preparar();
  const dlg = $('#dlg-impresora');
  const maquina = $('#impresora-maquina');
  const salida = $('#impresora-salida');
  const pila = $('#impresora-pila');
  const cuenta = $('#impresora-cuenta');
  const relleno = $('#impresora-relleno');
  const mensaje = $('#impresora-mensaje');
  const confirmacion = $('#impresora-confirmacion');
  const continuar = $('#impresora-continuar');
  const marcador = $('#impresora-marcador');
  const reducido = reducirMovimiento();
  const conTickets = o.tickets && o.tickets.length > 0;

  dlg.classList.toggle('impresora--sobria', !conTickets);
  maquina.hidden = !conTickets;
  salida.hidden = !conTickets;
  $('#impresora-titulo').textContent = o.titulo || 'Venta registrada';

  // Máximo 4 tickets en pantalla: si son más, el último agrupa el resto.
  let datos = o.tickets || [];
  if (datos.length > 4) {
    const ultimo = datos[datos.length - 1];
    datos = [...datos.slice(0, 3), { ...datos[3], hasta: ultimo.n }];
  }
  const tickets = datos.map(crearTicket);
  pila.replaceChildren(...tickets);
  tickets.forEach((t) => { t.style.opacity = reducido ? '1' : '0'; });

  confirmacion.replaceChildren();
  if (!conTickets) {
    const espera = o.modo === 'pendiente';
    confirmacion.append(h('div', { class: 'confirmacion' },
      h('div', { class: 'confirmacion__icono' + (espera ? ' confirmacion__icono--espera' : '') }, icono(espera ? 'reloj' : 'check')),
      h('h2', {}, o.titulo),
      o.subtitulo ? h('p', {}, o.subtitulo) : null));
  }
  cuenta.textContent = String(o.cuponesAntes);
  relleno.style.transform = `scaleX(${o.progresoAntes})`;
  mensaje.replaceChildren(...[].concat(o.mensaje || []));

  const elementosMarcador = [marcador];
  elementosMarcador.forEach((el) => { el.style.opacity = reducido ? '1' : '0'; el.style.transform = ''; });
  maquina.style.opacity = reducido ? '1' : '0';
  continuar.disabled = !reducido;

  return new Promise((resolve) => {
    alCerrarActual = resolve;
    ctl.abrir();
    $('#impresora-escena').focus({ preventScroll: true });

    const secuencia = async () => {
      const tareas = [];
      await esperar(reducido ? 0 : 90);
      if (reducido) {
        // Sin movimiento: todo aparece ya impreso con un fundido.
        const todo = [...tickets, maquina, marcador];
        todo.forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' }));
        tickets.forEach((t, i) => {
          t.querySelector('[data-sello]').style.opacity = '1';
          const d = tickets.length - 1 - i;
          t.style.transform = d ? `translate(${-7 * d}px, ${7 * d}px)` : 'none';
        });
        cuenta.textContent = String(o.cuponesDespues);
        relleno.style.transform = `scaleX(${o.progresoDespues})`;
        continuar.disabled = false;
        return;
      }

      if (conTickets) {
        await animar(maquina, [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 250, easing: EASE_OUT });
        vibrar([8, 50, 8, 50, 8]);
        // Presupuesto total ≈ 2,5 s: con varios tickets cada uno se imprime más rápido.
        const n = tickets.length;
        const porTicket = n === 1 ? 760 : Math.max(220, Math.round(900 / n));
        for (let i = 0; i < n; i++) {
          const ultimo = i === n - 1;
          if (i > 0) apilar(tickets, i);
          await imprimirTicket(tickets[i], porTicket, ultimo ? 280 : 110);
          tareas.push(sellar(tickets[i], { golpe: ultimo }));
        }
      }

      tareas.push(animar(marcador, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: EASE_OUT }));
      await esperar(120);
      const completo = o.cuponesDespues > o.cuponesAntes;
      await Promise.all([
        ...tareas,
        contar(cuenta, o.cuponesAntes, o.cuponesDespues, 500),
        o.modo === 'pendiente' ? null : llenarBarra(relleno, o.progresoAntes, o.progresoDespues, completo),
      ]);
      continuar.disabled = false;
    };
    secuencia().catch(() => { continuar.disabled = false; });
  });
}

/** Texto del marcador después de una venta o de una aprobación. */
export function mensajeMarcador({ nuevos, falta }) {
  const partes = [];
  if (nuevos > 0) partes.push(h('strong', {}, nuevos === 1 ? '¡Ganaste un cupón! ' : `¡Ganaste ${plural(nuevos, 'cupón', 'cupones')}! `));
  partes.push('Te faltan ', h('strong', {}, dinero(falta, { compacto: true })), ' para tu próximo cupón.');
  return partes;
}
