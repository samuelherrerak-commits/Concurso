/**
 * Texto de la Copa: las tarjetas de bienvenida (se deslizan al abrir la app la primera vez)
 * y la sección "Cómo funciona la Copa". Las fechas, el valor del cupón y los m² o piezas de
 * Austral salen de la configuración, así que si cambian en el Sheet, cambian aquí.
 */
import { $, $$, h, prepararDialogo } from './dom.js';
import { dinero, decimal, fechaLarga, fechaConDia, conPunto } from './formato.js';
import { recuerdo } from './api.js';

const CLAVE_VISTA = 'intro-vista';
let dialogo = null;
let mostradaEnSesion = false;
let alTerminar = null;

const fuerte = (t) => h('strong', {}, t);
const dosDigitos = (n) => String(n).padStart(2, '0');

/** "15 de oct." → "15 de oct." y "5 de nov." → "05 de nov." como en el texto de la Copa. */
function diaMes(iso) {
  const [, m, d] = iso.split('-').map(Number);
  const meses = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'];
  return `${dosDigitos(d)} de ${meses[m - 1]}`;
}

/** "Del 15 de oct. al 05 de nov." o "Del 06 al 26 de nov." */
function delAl(inicio, fin) {
  const [, m1] = inicio.split('-').map(Number);
  const [, m2] = fin.split('-').map(Number);
  const d1 = dosDigitos(Number(inicio.slice(8)));
  return m1 === m2 ? `Del ${d1} al ${diaMes(fin)}` : `Del ${diaMes(inicio)} al ${diaMes(fin)}`;
}

/** "Cada 80 m² o piezas (Distribuidores: 500)". */
function textoAustral(c, propio) {
  if (propio) return `${decimal(propio, 0)} m² o piezas`;
  const lista = c.m2_austral_por_canal || [];
  const base = lista.find((x) => x.canal === 'Tienda') || { m2: c.m2_por_cupon_austral };
  const distintos = lista.filter((x) => x.m2 !== base.m2);
  return `${decimal(base.m2, 0)} m² o piezas` + (distintos.length ? ` (${distintos.map((x) => `${x.etiqueta}: ${decimal(x.m2, 0)}`).join('; ')})` : '');
}

/**
 * Bloques de la Copa. `yo` (opcional) trae el valor del cupón y los m² Austral del vendedor.
 * Cada bloque: { id, titulo, kicker, cuerpo: [nodos] }.
 */
export function bloquesCopa(c, yo = null) {
  const sorteos = c.rondas.filter((p) => p.con_sorteo);
  const napa = c.rondas.find((p) => !p.con_sorteo);
  const N = dosDigitos(c.cupones_por_cupon_final);
  const valor = yo && yo.monto_por_cupon ? fuerte(dinero(yo.monto_por_cupon, { compacto: true })) : fuerte('monto de tu canal');
  const letra = (l, ...partes) => h('li', { class: 'regla' }, h('span', { class: 'regla__letra', 'aria-hidden': 'true' }, l), h('span', {}, ...partes));

  return [
    {
      id: 'bienvenida',
      kicker: 'Copa Navideña Austral - Prosein',
      titulo: 'Bienvenidos a esta Copa Navideña',
      cuerpo: [
        h('p', {}, 'Estamos contentos de unirnos para que ganes más en esta Navidad.'),
        h('p', {}, 'Desde el ', fuerte(fechaLarga(c.fecha_inicio)), ' hasta el ', fuerte(fechaLarga(c.fecha_fin)), ', por impulsar nuestros productos de ', h('span', { class: 'austral-texto' }, 'Austral'), ' y vender en Prosein, tendrás la oportunidad de ganar premios.'),
        h('p', { class: 'copa__grito' }, '¡Siempre podrás ganar!'),
      ],
    },
    {
      id: 'consiste',
      kicker: '¿En qué consiste la Copa?',
      titulo: `${sorteos.length === 3 ? 'Tres' : sorteos.length} sorteos + una ñapa`,
      cuerpo: [
        h('p', {}, 'Para que puedas:'),
        h('ul', { class: 'premios' },
          h('li', {}, 'Ir a ', fuerte('Margarita por dos días en pareja')),
          h('li', {}, 'Ganarte un ', fuerte('reloj Cubit')),
          h('li', {}, fuerte('Complementos para un mercado'), ' de tus hallacas'),
          h('li', {}, 'Y algunas ', fuerte('sorpresas más'))),
      ],
    },
    {
      id: 'sorteos',
      kicker: '1.- Los sorteos',
      titulo: `${dosDigitos(sorteos.length + 1)} sorteos con 07 premios cada uno`,
      cuerpo: [
        h('ul', { class: 'cronograma' },
          sorteos.map((p) => h('li', {},
            h('strong', {}, p.nombre),
            h('span', {}, delAl(p.inicio, p.fin)),
            h('span', { class: 'cronograma__sorteo' }, conPunto(`Sorteo el ${fechaConDia(p.sorteo)}`)))),
          h('li', { class: 'cronograma__final' },
            h('strong', {}, 'Gran Sorteo Final'),
            h('span', { class: 'cronograma__sorteo' }, conPunto(fechaConDia(c.fecha_sorteo_final).replace(/^./, (x) => x.toUpperCase()))))),
      ],
    },
    napa ? {
      id: 'napa',
      kicker: '2.- La ñapa',
      titulo: '01 ñapa',
      cuerpo: [
        h('p', {}, 'Para que puedas tener más oportunidad de llegar con cupones al sorteo final, te damos ', fuerte(delAl(napa.inicio, napa.fin).replace(/^Del/, 'del')), ' para seguir ganando cupones.'),
        h('p', { class: 'copa__nota' }, 'La ñapa no tiene sorteo propio: todo lo que sumes cuenta para el Gran Sorteo Final.'),
      ],
    } : null,
    {
      id: 'cupones',
      kicker: '3.- Condiciones',
      titulo: 'Cómo ganas cupones',
      cuerpo: [h('ol', { class: 'reglas-letras' },
        letra('A', 'Ganas un cupón por el logro de un monto específico de venta asociado a tu canal.'),
        letra('B', 'Cada ', valor, ' en ventas te da ', fuerte('01 cupón'), ' (es el valor del cupón de tu canal). Lo que sobra no se pierde: se suma para tus próximas ventas y para generar más cupones.'),
        letra('C', 'A cada sorteo entran los cupones que completes en esa ronda.'),
        letra('D', 'Las rondas cierran el último día previsto. Si registras después de ese último día, la venta queda para la siguiente ronda.'))],
    },
    {
      id: 'final',
      kicker: '3.- Condiciones',
      titulo: 'Gran Sorteo Final',
      cuerpo: [h('ol', { class: 'reglas-letras', start: 5 },
        letra('E', 'Por cada ', fuerte(`${N} cupones`), ' de todas las rondas tienes ', fuerte('01 cupón'), ' para el Sorteo Final, que cuenta desde el inicio de la Copa. Desde el inicio hasta el final puedes acumular cupones.'),
        letra('F', 'El Gran Sorteo Final será con los cupones que ganaste cada ', N, ' cupones acumulados en toda la campaña.'),
        letra('G', 'Cada ', fuerte(textoAustral(c, yo && yo.m2_austral)), ' de ', h('span', { class: 'austral-texto' }, 'Austral'), ' te dan ', fuerte('1 cupón adicional'), ' para el Gran Sorteo Final.'),
        letra('H', 'El ', fuerte('mejor vendedor de cada ronda por canal'), ' gana un cupón para el Gran Sorteo Final.'))],
    },
    {
      id: 'registro',
      kicker: '3.- Condiciones',
      titulo: 'Al registrar tus ventas',
      cuerpo: [h('ol', { class: 'reglas-letras', start: 9 },
        letra('I', 'Registra cada factura con su foto. Una factura solo se registra una vez, y el coordinador puede rechazar las que no se lean bien.'),
        letra('J', 'En caso de ganar, si la información no concuerda con el sistema, quedas eliminado de cualquiera de los sorteos.'))],
    },
  ].filter(Boolean);
}

// ---------- Tarjetas deslizables ----------

function armarTarjetas(c, yo) {
  const bloques = bloquesCopa(c, yo);
  const pista = $('#intro-pista');
  pista.replaceChildren(...bloques.map((b, i) => h('article', {
    class: 'tarjeta-intro' + (i === 0 ? ' tarjeta-intro--portada' : ''),
    'aria-roledescription': 'tarjeta',
    'aria-label': `${i + 1} de ${bloques.length}: ${b.titulo}`,
  }, h('div', { class: 'tarjeta-intro__hoja' },
    i === 0 ? h('img', { class: 'tarjeta-intro__bolsa', src: 'assets/bolsa-roja.svg', alt: '', width: 72, height: 72 }) : null,
    h('p', { class: 'tarjeta-intro__kicker' }, b.kicker),
    h('h2', { class: 'tarjeta-intro__titulo' }, b.titulo),
    h('div', { class: 'tarjeta-intro__cuerpo' }, b.cuerpo)))));
  $('#intro-puntos').replaceChildren(...bloques.map((b, i) => h('button', {
    type: 'button', class: 'intro__punto', 'aria-label': `Ir a la tarjeta ${i + 1}`, onclick: () => irA(i),
  })));
  return bloques.length;
}

function actual() {
  const pista = $('#intro-pista');
  return Math.round(pista.scrollLeft / Math.max(1, pista.clientWidth));
}

function irA(i) {
  const pista = $('#intro-pista');
  const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  pista.scrollTo({ left: i * pista.clientWidth, behavior: suave ? 'smooth' : 'auto' });
}

function actualizarControles() {
  const total = $$('#intro-pista .tarjeta-intro').length;
  const i = Math.min(total - 1, actual());
  $$('#intro-puntos .intro__punto').forEach((p, j) => p.setAttribute('aria-current', String(i === j)));
  const ultima = i === total - 1;
  $('#intro-siguiente').querySelector('[data-texto]').textContent = ultima ? '¡Empezar!' : 'Siguiente';
  $('#intro-saltar').style.visibility = ultima ? 'hidden' : 'visible';
}

/**
 * Muestra las tarjetas. `yo` = valor del cupón y m² Austral del vendedor, si ya entró.
 * Devuelve una promesa que se cumple al cerrarlas.
 */
export function mostrarIntro(c, yo = null) {
  const dlg = $('#dlg-intro');
  if (!dialogo) {
    dialogo = prepararDialogo(dlg, {
      cerrarConFondo: false,
      alCerrar: () => {
        recuerdo.guardar(CLAVE_VISTA, true);
        const fin = alTerminar;
        alTerminar = null;
        if (fin) fin();
      },
    });
    const pista = $('#intro-pista');
    let pendiente = 0;
    pista.addEventListener('scroll', () => {
      cancelAnimationFrame(pendiente);
      pendiente = requestAnimationFrame(actualizarControles);
    }, { passive: true });
    $('#intro-siguiente').addEventListener('click', () => {
      const total = $$('#intro-pista .tarjeta-intro').length;
      const i = actual();
      if (i >= total - 1) dialogo.cerrar('ok');
      else irA(i + 1);
    });
    $('#intro-saltar').addEventListener('click', () => dialogo.cerrar('saltar'));
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); irA(actual() + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); irA(Math.max(0, actual() - 1)); }
    });
  }
  armarTarjetas(c, yo);
  mostradaEnSesion = true;
  const cerrada = new Promise((resolver) => { alTerminar = resolver; });
  dialogo.abrir();
  requestAnimationFrame(() => {
    $('#intro-pista').scrollLeft = 0;
    actualizarControles();
    $('#intro-siguiente').focus({ preventScroll: true });
  });
  return cerrada;
}

/** Al iniciar la app: las tarjetas salen solo la primera vez en este teléfono. */
export function mostrarIntroSiFalta(c, yo = null) {
  if (mostradaEnSesion || recuerdo.leer(CLAVE_VISTA)) return Promise.resolve();
  return mostrarIntro(c, yo);
}

// ---------- "Cómo funciona la Copa" ----------

/** "Austral" en azul dentro de un texto (el texto no cambia). */
function conAustral(texto) {
  return texto.split(/(Austral)/).map((t) => (t === 'Austral' ? h('span', { class: 'austral-texto' }, t) : t));
}

/**
 * Texto exacto (definitivo) que envió Prosein para "Cómo funciona la Copa", sin reescribir.
 * Solo "(XXXX)" se cambia por el valor del cupón del vendedor.
 */
export function pintarComoFunciona(c, yo, { alVerTarjetas } = {}) {
  const valor = yo && yo.monto_por_cupon ? dinero(yo.monto_por_cupon, { compacto: true }) : 'XXXX';
  const titulo = (t) => h('h3', { class: 'reglas__titulo' }, t);
  const linea = (t, clase) => h('p', clase ? { class: clase } : {}, conAustral(t));
  const ronda = (nombre, resto) => h('p', { class: 'reglas__ronda' }, h('strong', {}, nombre), '  ', resto);
  const letra = (t) => {
    const m = t.match(/^([A-L]\.-)([\s\S]*)$/);
    return h('p', { class: 'reglas__condicion' }, h('strong', {}, m[1]), conAustral(m[2]));
  };
  $('#reglas-contenido').replaceChildren(
    h('section', { class: 'reglas__bloque' },
      h('h3', { class: 'reglas__titulo reglas__titulo--copa' }, 'COPA NAVIDEÑA ', h('span', { class: 'austral-texto' }, 'AUSTRAL'), '-PROSEIN'),
      linea('Bienvenidos a esta Copa Navideña, estamos contentos de unirnos para que ganes más en esta Navidad.'),
      linea('Desde el 15 de octubre hasta el 19 de diciembre por impulsar nuestros productos de Austral y vender en Prosein tendrás la oportunidad para que ganes premios.'),
      linea('¡Siempre podrás ganar!', 'copa__grito')),
    h('section', { class: 'reglas__bloque' },
      titulo('¿En qué consiste la COPA?'),
      linea('Tres sorteos + una ñapa para que puedas: Ir a Margarita por dos días en pareja, ganarte un reloj Cubit, complementos para un mercado de tus hallacas y algunas sorpresas más.')),
    h('section', { class: 'reglas__bloque' },
      titulo('1.- 04 SORTEOS CON 07 PREMIOS CADA UNO:'),
      ronda('Ronda 1', 'Del 15 de oct. al 05 de nov. Sorteo el lunes 9 de nov.'),
      ronda('Ronda 2', 'Del 06 al 26 de nov. Sorteo el lunes 30 de nov.'),
      ronda('Ronda 3', 'Del 27 de nov. al 10 de dic.  Sorteo el lunes 14 de dic.'),
      ronda('GRAN SORTEO FINAL:', 'Lunes 21 de diciembre')),
    h('section', { class: 'reglas__bloque' },
      titulo('2.- 01 ÑAPA:'),
      linea('Para que puedas tener más oportunidad de llegar con cupones al sorteo final, te damos del 11 al 19 de dic. para seguir ganando puntos.')),
    h('section', { class: 'reglas__bloque' },
      titulo('3.- CONDICIONES'),
      letra('A.- Participan todos nuestros productos MENOS el pavimento y revestimiento importado de proveedores nacionales.'),
      letra('B.- Ganas un cupón por el logro de un monto específico de venta asociado a tu canal.'),
      letra(`C.- Cada (${valor}) en ventas te da 01 cupón (es el valor del cupón de tu canal). Lo que sobra no se pierde, se suma para tus próximas ventas y para generar más cupones.`),
      letra('D.- A cada sorteo entran los cupones que completes en esa ronda.'),
      letra('E.- Las rondas cierran el día previsto. Si registras después de ese último día, queda para la siguiente ronda.'),
      letra('F.- Por cada 08 cupones de todas las rondas tienes 01 cupón que cuenta desde el inicio de la Copa para el Sorteo final.'),
      letra('G.- Gran Sorteo Final será con cupones especiales que hayas acumulado a lo largo de las rondas más el tiempo de ñapa.'),
      letra('H.- Cada 80 m² / piezas de Austral te dan 1 cupón adicional para el Gran Sorteo Final.'),
      letra('I.- El mejor vendedor de cada ronda por canal, gana un cupón para el Gran Sorteo Final.'),
      letra('J.- Registra cada factura con su foto. Una factura solo se registra una vez, y el coordinador puede rechazar las que no se lean bien. Coloca los datos solicitados.'),
      letra('K.- En caso de ganar y la información no concordar con el sistema, quedas eliminado de cualquiera de los sorteos.'),
      letra('L.- Recuerda que las facturas deben estar registradas por ti como vendedor. No cuentan ventas que hayas realizado en nombre de gerentes.')),
    h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: alVerTarjetas }, 'Ver las tarjetas de bienvenida'));
}
