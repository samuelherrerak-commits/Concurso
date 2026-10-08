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
 *
 * Hay dos tipos de ticket: el cupón normal (rojo) y el cupón del viaje (Austral, azul).
 */
import { $, h, icono, svgEl, prepararDialogo, reducirMovimiento, esperar } from './dom.js';
import { dinero, plural, decimal } from './formato.js';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

// ---------- Componentes ----------

function fila(etiqueta, valor) {
  return h('div', { class: 'ticket__fila', 'data-l': true }, h('span', {}, etiqueta), h('span', {}, valor));
}

function corte() {
  return h('hr', { class: 'corte', 'data-l': true });
}

/**
 * Barras del código de barras decorativo: siempre las mismas para el mismo texto.
 * Devuelve [[x, ancho], ...] en un lienzo de 200 × 40 (lo usan el SVG y la imagen descargable).
 */
export function barras(semilla) {
  let x = 2166136261;
  for (const c of String(semilla)) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  const azar = () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  const lista = [[0, 2], [4, 1]];
  let pos = 8;
  while (pos < 190) {
    const ancho = 1 + Math.floor(azar() * 3);
    lista.push([pos, ancho]);
    pos += ancho + 1 + Math.floor(azar() * 2.4);
  }
  lista.push([195, 1], [198, 2]);
  return lista;
}

function codigoBarras(semilla) {
  const svg = svgEl('svg', { viewBox: '0 0 200 40', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  barras(semilla).forEach(([pos, ancho]) => svg.append(svgEl('rect', { x: pos, y: 0, width: ancho, height: 40, fill: 'currentColor' })));
  return svg;
}

/**
 * Filas de texto de un ticket, en orden. Las comparten el ticket en pantalla
 * y la imagen PNG que se descarga.
 * @param {object} d { tipo?, n, hasta?, fechaHora, factura, vendedor, cedula, monto?, acumulado, falta, m2?, m2Acumulado?, m2Falta? }
 */
export function contenidoTicket(d) {
  const austral = d.tipo === 'austral';
  const rango = d.hasta && d.hasta > d.n;
  const filas = [
    { t: 'marca', texto: 'PROSEIN' },
    { t: 'sub', texto: austral ? 'VIAJE TODO INCLUIDO' : 'COPA PROSEIN' },
    { t: 'corte' },
    { t: 'fila', a: 'FECHA', b: d.fechaHora },
    { t: 'fila', a: 'FACTURA', b: d.factura },
    { t: 'fila', a: 'VENDEDOR', b: String(d.vendedor || '').toUpperCase() },
    { t: 'fila', a: 'C.I.', b: d.cedula },
  ];
  if (austral) filas.push({ t: 'fila', a: 'AUSTRAL', b: `${decimal(d.m2)} m²` });
  else if (d.monto !== null && d.monto !== undefined) filas.push({ t: 'fila', a: 'MONTO', b: dinero(d.monto) });
  filas.push(
    { t: 'corte' },
    { t: 'sello', arriba: austral ? (rango ? 'CUPONES VIAJE' : 'CUPÓN VIAJE') : (rango ? 'CUPONES' : 'CUPÓN'), abajo: rango ? `N° ${d.n} al ${d.hasta}` : `N° ${d.n}` },
    { t: 'corte' },
  );
  if (austral) {
    filas.push({ t: 'fila', a: 'M² ACUMULADOS', b: `${decimal(d.m2Acumulado)} m²` }, { t: 'fila', a: 'PRÓXIMO CUPÓN EN', b: `${decimal(d.m2Falta)} m²` });
  } else {
    filas.push({ t: 'fila', a: 'ACUMULADO', b: dinero(d.acumulado) }, { t: 'fila', a: 'PRÓXIMO CUPÓN EN', b: dinero(d.falta) });
  }
  filas.push(
    { t: 'barras', semilla: `${d.factura}-${austral ? 'V' : ''}${d.n}`, codigo: `${austral ? 'CV' : 'CP'} ${String(d.n).padStart(4, '0')}` },
    { t: 'gracias', texto: '¡GRACIAS POR SU VENTA!' },
  );
  return filas;
}

export function crearTicket(d) {
  const austral = d.tipo === 'austral';
  const rango = d.hasta && d.hasta > d.n;
  const nodos = contenidoTicket(d).map((f) => {
    switch (f.t) {
      case 'marca': return h('div', { class: 'ticket__marca', 'data-l': true }, f.texto);
      case 'sub': return h('div', { class: 'ticket__sub', 'data-l': true }, f.texto);
      case 'corte': return corte();
      case 'fila': return fila(f.a, f.b);
      case 'sello': return h('div', { class: 'ticket__cupon', 'data-l': true },
        h('div', { class: 'sello', 'data-sello': true }, h('small', {}, f.arriba), h('strong', {}, f.abajo)));
      case 'barras': return h('div', { class: 'ticket__barras', 'data-l': true }, codigoBarras(f.semilla), h('span', { class: 'ticket__codigo' }, f.codigo));
      default: return h('div', { class: 'ticket__gracias', 'data-l': true }, f.texto);
    }
  });
  const etiqueta = austral
    ? (rango ? `Cupones del viaje ${d.n} al ${d.hasta}` : `Cupón del viaje número ${d.n}, factura ${d.factura}`)
    : (rango ? `Cupones ${d.n} al ${d.hasta}` : `Cupón número ${d.n}, factura ${d.factura}`);
  return h('div', { class: 'ticket sombra-papel' + (austral ? ' ticket--austral' : ''), role: 'img', 'aria-label': etiqueta }, h('div', { class: 'papel' }, nodos));
}

/** Mini ticket tocable para "Mis cupones" y "Viaje todo incluido". */
export function crearMini({ n, dia, factura, nuevo, tipo, alTocar }) {
  const austral = tipo === 'austral';
  return h('button', {
    type: 'button',
    class: 'mini sombra-papel' + (nuevo ? ' mini--nuevo' : '') + (austral ? ' mini--austral' : ''),
    'aria-label': `Ver ${austral ? 'cupón del viaje' : 'cupón'} número ${n}, factura ${factura}`,
    onclick: alTocar,
  },
  h('span', { class: 'papel' },
    h('span', { class: 'mini__titulo' }, austral ? 'VIAJE' : 'CUPÓN'),
    h('span', { class: 'mini__n' }, `N° ${String(n).padStart(2, '0')}`),
    h('span', { class: 'mini__dato' }, dia),
    h('span', { class: 'mini__dato', title: factura }, `Fact. ${factura}`)));
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
    animar(sello, [
      { opacity: 0, transform: 'rotate(-16deg) scale(1.7)' },
      { opacity: 1, transform: 'rotate(-6deg) scale(0.94)', offset: 0.65 },
      { opacity: 1, transform: 'rotate(-7deg) scale(1)' },
    ], { duration: 320, easing: EASE_OUT }),
    // El golpe del sello mueve el papel apenas (no en los que luego se apilan: su transform lo maneja apilar).
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
 *   etiqueta: texto del contador ('Tus cupones' por defecto), variante: 'austral' para el viaje
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
  dlg.classList.toggle('impresora--austral', o.variante === 'austral');
  maquina.hidden = !conTickets;
  salida.hidden = !conTickets;
  $('#impresora-titulo').textContent = o.titulo || 'Venta registrada';
  $('#impresora-etiqueta').textContent = o.etiqueta || 'Tus cupones';

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

  marcador.style.opacity = reducido ? '1' : '0';
  marcador.style.transform = '';
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
        [...tickets, maquina, marcador].forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' }));
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

export function mensajeViaje({ nuevos, falta, participa, categoria }) {
  const partes = [];
  if (nuevos > 0) partes.push(h('strong', {}, nuevos === 1 ? '¡Un cupón más para el viaje! ' : `¡${plural(nuevos, 'cupón', 'cupones')} más para el viaje! `));
  partes.push('Te faltan ', h('strong', {}, `${decimal(falta)} m²`), ' de Austral para el próximo.');
  if (!participa && categoria) partes.push(` Para entrar al sorteo necesitas estar en ${categoria} al cierre.`);
  return partes;
}
