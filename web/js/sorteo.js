/**
 * Sorteo en vivo (solo administradores): todos los cupones de la bolsa dan vueltas dentro de
 * un bowl de vidrio; al tocar "Sacar cupón" el bowl se agita y sale el ganador.
 *
 * El cupón ganador lo elige el servidor (Apps Script) con azar criptográfico y lo anota en la
 * hoja Ganadores, así que el resultado no depende de este navegador y queda registrado.
 * La animación solo acompaña: dura lo mismo aunque el servidor responda antes.
 *
 * Modo ensayo: para practicar antes del sorteo (o mientras la ronda no cierra). Sortea aquí
 * mismo, también con azar criptográfico, y no anota nada.
 */
import { llamar } from './api.js';
import { $, h, icono, avisar, prepararDialogo } from './dom.js';
import { fechaConDia, fechaHora } from './formato.js';

const MAX_VISIBLES = 90;
const MEZCLA_MS = 3200;

let dlg = null;
let ctl = null;
let estado = null;
let animacion = null;
let alCerrarCb = null;

const reducir = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Entero al azar en [0, n) sin sesgo (crypto + rechazo). */
function azar(n) {
  const limite = 4294967296 - (4294967296 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limite) return buf[0] % n;
  }
}

// ---------- Bowl animado (canvas) ----------

function crearBowl(canvas) {
  const ctx = canvas.getContext('2d');
  let papeles = [];
  let modo = 'reposo';
  let fuerza = 0;
  let ultimo = 0;
  let pedido = 0;
  let w = 0;
  let r = 0;

  const medir = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const lado = canvas.clientWidth;
    canvas.width = lado * dpr;
    canvas.height = lado * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    w = lado;
    r = lado / 2 - 6;
  };

  const llenar = (codigos) => {
    medir();
    const lista = codigos.slice(0, MAX_VISIBLES);
    papeles = lista.map((codigo, i) => {
      // Se reparten en la mitad de abajo, como papeles reposando en el fondo del bowl.
      const a = Math.PI * (0.15 + 0.7 * ((i * 0.618) % 1));
      const d = r * (0.25 + 0.65 * ((i * 0.381) % 1));
      return {
        codigo,
        x: w / 2 + Math.cos(a) * d * 0.95,
        y: w / 2 + Math.sin(a) * d * 0.9,
        vx: 0, vy: 0,
        ang: (i * 47) % 360 * Math.PI / 180,
        va: 0,
        escala: 0.92 + (i % 3) * 0.06,
        tono: i % 5,
      };
    });
  };

  const paso = (dt) => {
    const cx = w / 2;
    const cy = w / 2;
    papeles.forEach((p) => {
      const k = w / 500; // las fuerzas escalan con el tamaño del bowl
      if (modo === 'mezcla') {
        // Como una tómbola de aire: chorros desde el fondo que levantan los papeles,
        // un remolino suave y empujones al azar para que se crucen.
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const abajo = Math.max(0, dy / r);
        p.vy -= (1500 + Math.random() * 2600) * abajo * fuerza * dt * k;
        p.vx += (-dy / dist) * 260 * fuerza * dt * k + (Math.random() - 0.5) * 3200 * fuerza * dt * k;
        p.vy += (dx / dist) * 260 * fuerza * dt * k + (Math.random() - 0.5) * 2200 * fuerza * dt * k;
        p.va += (Math.random() - 0.5) * 30 * fuerza * dt;
      }
      p.vy += 620 * dt * k; // gravedad
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.va *= 0.96;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ang += p.va * dt;
      // Choque con la pared del bowl.
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy);
      const limite = r - Math.max(14, w * 0.05);
      if (dist > limite) {
        const nx = dx / dist;
        const ny = dy / dist;
        p.x = cx + nx * limite;
        p.y = cy + ny * limite;
        const v = p.vx * nx + p.vy * ny;
        if (v > 0) {
          p.vx -= 1.75 * v * nx;
          p.vy -= 1.75 * v * ny;
          p.vx *= 0.9;
          p.vy *= 0.9;
          p.va += (Math.random() - 0.5) * 2;
        }
      }
    });
  };

  const dibujar = () => {
    ctx.clearRect(0, 0, w, w);
    const ancho = Math.max(30, w * 0.105);
    const alto = ancho * 0.56;
    const letra = Math.max(7, ancho * 0.19);
    papeles.forEach((p) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang);
      ctx.scale(p.escala, p.escala);
      ctx.fillStyle = ['#FFFDF6', '#FFF6E6', '#FFFFFF', '#FFF1DC', '#FDFBF4'][p.tono];
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;
      ctx.fillRect(-ancho / 2, -alto / 2, ancho, alto);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#DF1630';
      ctx.fillRect(-ancho / 2, -alto / 2, ancho, alto * 0.16);
      ctx.fillStyle = '#2A2926';
      ctx.font = `700 ${letra.toFixed(1)}px "Chivo Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.codigo, 0, 3);
      ctx.restore();
    });
  };

  const bucle = (t) => {
    const dt = Math.min(0.033, ultimo ? (t - ultimo) / 1000 : 0.016);
    ultimo = t;
    if (modo === 'mezcla') fuerza = Math.min(1, fuerza + dt * 1.6);
    paso(dt);
    dibujar();
    pedido = requestAnimationFrame(bucle);
  };

  return {
    llenar(codigos) { llenar(codigos); dibujar(); },
    iniciar() { cancelAnimationFrame(pedido); ultimo = 0; pedido = requestAnimationFrame(bucle); },
    detener() { cancelAnimationFrame(pedido); },
    mezclar() { modo = 'mezcla'; fuerza = 0.15; },
    calmar() { modo = 'reposo'; fuerza = 0; },
    /** Quita un papel (el que "sale") y devuelve su posición en el canvas. */
    sacar(codigo) {
      let i = papeles.findIndex((p) => p.codigo === codigo);
      if (i < 0) i = papeles.length ? azar(papeles.length) : -1;
      if (i < 0) return { x: w / 2, y: w / 2 };
      const [p] = papeles.splice(i, 1);
      return { x: p.x, y: p.y };
    },
    redimensionar() { const viejo = w; medir(); if (viejo) { const k = w / viejo; papeles.forEach((p) => { p.x *= k; p.y *= k; }); } dibujar(); },
  };
}

// ---------- Pantalla ----------

function armar() {
  dlg = h('dialog', { class: 'sorteo', id: 'dlg-sorteo', 'aria-labelledby': 'sorteo-titulo' },
    h('div', { class: 'sorteo__caja' },
      h('header', { class: 'sorteo__cab' },
        h('div', {},
          h('p', { class: 'sorteo__kicker' }, 'Copa Navideña ', h('span', { class: 'austral-marca austral-marca--chica' }, 'Austral'), ' - Prosein'),
          h('h2', { id: 'sorteo-titulo' }, 'Sorteo'),
          h('p', { class: 'sorteo__sub', id: 'sorteo-sub' })),
        h('button', { type: 'button', class: 'btn-icono sorteo__cerrar', 'data-cerrar': true, 'aria-label': 'Cerrar' }, icono('cerrar'))),
      h('div', { class: 'sorteo__cuerpo' },
        h('section', { class: 'sorteo__escena', 'aria-live': 'polite' },
          h('div', { class: 'bowl', id: 'sorteo-bowl' },
            h('canvas', { class: 'bowl__canvas', id: 'sorteo-canvas', 'aria-hidden': 'true' }),
            h('div', { class: 'bowl__brillo', 'aria-hidden': 'true' }),
            h('div', { class: 'bowl__base', 'aria-hidden': 'true' })),
          h('p', { class: 'sorteo__cuenta', id: 'sorteo-cuenta' }),
          h('div', { class: 'sorteo__ganador', id: 'sorteo-ganador', hidden: true })),
        h('aside', { class: 'sorteo__panel' },
          h('div', { class: 'sorteo__controles' },
            h('button', { type: 'button', class: 'btn btn--primario btn--grande btn--bloque', id: 'sorteo-sacar' }, h('span', { class: 'girador', 'aria-hidden': 'true' }), h('span', { 'data-texto': true }, 'Sacar cupón')),
            h('p', { class: 'sorteo__grupo', id: 'sorteo-grupo' }),
            h('label', { class: 'sorteo__opcion' }, h('input', { type: 'checkbox', id: 'sorteo-ensayo' }), h('span', {}, 'Modo ensayo (no queda registrado)')),
            h('p', { class: 'sorteo__nota', id: 'sorteo-nota' })),
          h('h3', { class: 'sorteo__lista-titulo' }, 'Premios'),
          h('ol', { class: 'sorteo__premios', id: 'sorteo-premios' })))));
  document.body.append(dlg);
  ctl = prepararDialogo(dlg, {
    cerrarConFondo: false,
    puedeCerrar: () => !(estado && estado.sacando),
    alCerrar: () => {
      if (animacion) animacion.detener();
      if (alCerrarCb) alCerrarCb();
    },
  });
  $('#sorteo-sacar').addEventListener('click', sacar);
  $('#sorteo-ensayo').addEventListener('change', () => {
    estado.ensayo = $('#sorteo-ensayo').checked;
    $('#sorteo-ganador').hidden = true;
    if (animacion) animacion.llenar(codigosEnBolsa());
    pintar();
  });
  window.addEventListener('resize', () => { if (dlg.open && animacion) animacion.redimensionar(); });
}

/** Abre el sorteo de una bolsa ('r1', 'r2', 'r3' o 'final'). */
export async function abrirSorteo(bolsaId, { alCerrar, repetir = false } = {}) {
  if (!dlg) armar();
  alCerrarCb = alCerrar || null;
  estado = { bolsaId, datos: null, ensayo: false, ensayoGanadores: [], sacando: false, unoPorVendedor: !repetir };
  $('#sorteo-titulo').textContent = 'Cargando…';
  $('#sorteo-sub').textContent = '';
  $('#sorteo-ganador').hidden = true;
  $('#sorteo-premios').replaceChildren();
  ctl.abrir();
  const r = await llamar('adminSorteo', { bolsa: bolsaId }, { timeout: 45000 });
  if (!r.ok) {
    $('#sorteo-titulo').textContent = 'No se pudo abrir el sorteo';
    $('#sorteo-sub').textContent = r.message || '';
    return;
  }
  estado.datos = r.data;
  // Si la bolsa no ha cerrado, solo se puede ensayar.
  estado.ensayo = !r.data.bolsa.cerrada;
  $('#sorteo-ensayo').checked = estado.ensayo;
  $('#sorteo-ensayo').disabled = !r.data.bolsa.cerrada;
  if (!animacion) animacion = crearBowl($('#sorteo-canvas'));
  requestAnimationFrame(() => {
    animacion.llenar(codigosEnBolsa());
    if (!reducir()) animacion.iniciar();
  });
  pintar();
}

function enBolsa() {
  const d = estado.datos;
  const salidosEnsayo = new Set(estado.ensayoGanadores.map((g) => g.clave));
  return d.cupones.filter((c) => !c.sacado && !(estado.ensayo && salidosEnsayo.has(c.clave)));
}

function codigosEnBolsa() {
  // Se mezcla el orden para que el bowl no muestre los códigos en fila.
  const lista = enBolsa().map((c) => c.codigo);
  for (let i = lista.length - 1; i > 0; i--) {
    const j = azar(i + 1);
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

function ganadoresVisibles() {
  const d = estado.datos;
  return estado.ensayo ? estado.ensayoGanadores : d.ganadores;
}

function pintar() {
  const d = estado.datos;
  if (!d) return;
  const b = d.bolsa;
  $('#sorteo-titulo').textContent = b.tipo === 'final' ? 'Gran Sorteo Final' : `Sorteo ${b.nombre}`;
  $('#sorteo-sub').textContent = [b.fecha ? fechaConDia(b.fecha) : '', b.cerrada ? 'Bolsa cerrada' : 'La ronda aún no cierra: solo ensayo'].filter(Boolean).join(' · ');
  dlg.classList.toggle('sorteo--ensayo', estado.ensayo);

  const ganadores = ganadoresVisibles();
  const validos = ganadores.filter((g) => g.estado !== 'Anulado');
  const quedan = enBolsa().length;
  const completo = validos.length >= d.premios;
  $('#sorteo-cuenta').textContent = `${quedan} ${quedan === 1 ? 'cupón' : 'cupones'} en la bolsa · ${Math.min(validos.length, d.premios)} de ${d.premios} premios`;
  const boton = $('#sorteo-sacar');
  boton.disabled = estado.sacando || completo || !quedan;
  const proximo = siguientePremio(validos);
  boton.querySelector('[data-texto]').textContent = completo ? 'Sorteo completo' : `Sacar cupón · premio ${proximo}${estado.ensayo ? ' (ensayo)' : ''}`;
  $('#sorteo-grupo').textContent = completo ? '' : `Premio ${proximo}: ${categoriaDe(proximo).nombre}`;
  $('#sorteo-grupo').hidden = completo;
  $('#sorteo-nota').textContent = estado.ensayo
    ? 'Ensayo: los cupones se sacan aquí mismo y no se anotan en la hoja Ganadores.'
    : 'Cada cupón que sale se anota en la hoja Ganadores con la fecha y la hora.';

  const lista = [];
  for (let n = 1; n <= d.premios; n++) {
    const g = validos.find((x) => x.premio === n);
    lista.push(h('li', { class: 'premio' + (g ? ' premio--lleno' : '') },
      h('span', { class: 'premio__n' }, String(n)),
      g ? h('div', { class: 'premio__datos' },
        h('strong', {}, g.vendedor),
        h('span', {}, `${g.codigo} · ${g.grupo}${g.factura ? ' · Fact. ' + g.factura : ''}`))
        : h('div', { class: 'premio__datos premio__datos--vacio' }, h('span', {}, 'Por sortear'), h('small', { class: 'premio__grupo' }, categoriaDe(n).nombre)),
      g && !estado.ensayo ? h('button', { type: 'button', class: 'btn btn--fantasma btn--chico', onclick: () => anular(g) }, 'Anular') : null));
  }
  const anulados = ganadores.filter((g) => g.estado === 'Anulado');
  if (anulados.length) {
    lista.push(h('li', { class: 'premio premio--anulados' }, h('span', {}, `Anulados: ${anulados.map((g) => `${g.codigo} (${g.vendedor})`).join(', ')}`)));
  }
  $('#sorteo-premios').replaceChildren(...lista);
}

/** Grupo entre el que se sortea un premio (el servidor lo manda; si no, todos). */
function categoriaDe(premio) {
  const lista = (estado.datos && estado.datos.categorias) || [];
  return lista[premio - 1] || { id: 'todos', nombre: 'Todos los canales' };
}

function siguientePremio(validos) {
  const usados = new Set(validos.map((g) => g.premio));
  let n = 1;
  while (usados.has(n)) n++;
  return n;
}

async function sacar() {
  const d = estado.datos;
  if (!d || estado.sacando) return;
  estado.sacando = true;
  $('#sorteo-ganador').hidden = true;
  const boton = $('#sorteo-sacar');
  boton.disabled = true;
  boton.setAttribute('aria-busy', 'true');
  const { unoPorVendedor } = estado;

  const sinMovimiento = reducir();
  if (!sinMovimiento) {
    animacion.iniciar();
    animacion.mezclar();
    $('#sorteo-bowl').classList.add('bowl--agitando');
  }
  const espera = new Promise((ok) => setTimeout(ok, sinMovimiento ? 300 : MEZCLA_MS));

  let ganador = null;
  let error = null;
  if (estado.ensayo) {
    const yaGanaron = new Set(unoPorVendedor ? estado.ensayoGanadores.map((g) => g.cedula) : []);
    const posibles = enBolsa().filter((c) => !yaGanaron.has(c.cedula));
    if (!posibles.length) error = 'No quedan cupones que puedan salir.';
    else {
      // Igual que el servidor: el premio se sortea entre su grupo; si no hay cupones de ese grupo, entre todos.
      const premio = siguientePremio(estado.ensayoGanadores);
      const cat = categoriaDe(premio);
      const delGrupo = cat.id === 'todos' ? posibles : posibles.filter((c) => c.categoria === cat.id);
      const bolsa = delGrupo.length ? delGrupo : posibles;
      const c = bolsa[azar(bolsa.length)];
      const nota = delGrupo.length || cat.id === 'todos' ? '' : `Sin cupones de ${cat.nombre}: se sorteó entre todos`;
      ganador = { ...c, premio, nota, estado: 'Válido', ensayo: true, fecha: Date.now() };
    }
  } else {
    const r = await llamar('adminSacar', { bolsa: estado.bolsaId, uno_por_vendedor: unoPorVendedor }, { timeout: 60000 });
    if (r.ok) {
      ganador = r.data.ganador;
      estado.nuevosDatos = r.data;
    } else error = r.message || 'No se pudo sacar el cupón.';
  }
  await espera;
  $('#sorteo-bowl').classList.remove('bowl--agitando');
  animacion.calmar();
  estado.sacando = false;
  boton.removeAttribute('aria-busy');

  if (error) {
    avisar(error, { tipo: 'error' });
    pintar();
    return;
  }
  const desde = animacion.sacar(ganador.codigo);
  if (estado.ensayo) estado.ensayoGanadores.push(ganador);
  else { estado.datos = estado.nuevosDatos; estado.nuevosDatos = null; }
  mostrarGanador(ganador, desde);
  pintar();
}

function mostrarGanador(g, desde) {
  const caja = $('#sorteo-ganador');
  const d = estado.datos;
  caja.replaceChildren(
    h('div', { class: 'ganador' + (g.ensayo ? ' ganador--ensayo' : '') },
      h('p', { class: 'ganador__premio' }, g.ensayo ? `ENSAYO · PREMIO ${g.premio}` : `PREMIO ${g.premio} DE ${d.premios}`),
      h('p', { class: 'ganador__grupo' }, /^Sin cupones/.test(g.nota || '') ? g.nota : categoriaDe(g.premio).nombre),
      h('p', { class: 'ganador__codigo' }, g.codigo),
      h('p', { class: 'ganador__nombre' }, g.vendedor),
      h('p', { class: 'ganador__dato' }, [g.grupo, g.factura ? `Factura ${g.factura}` : ''].filter(Boolean).join(' · ')),
      h('p', { class: 'ganador__dato ganador__dato--tenue' }, g.ensayo ? 'No queda registrado' : `Registrado ${fechaHora(Date.now())}`),
      h('button', { type: 'button', class: 'btn btn--blanco btn--chico', onclick: () => { caja.hidden = true; } }, 'Continuar')));
  caja.hidden = false;
  const tarjeta = caja.firstChild;
  if (!reducir()) {
    // Sale del bowl: arranca pequeño donde estaba el papel y sube al centro.
    const bowl = $('#sorteo-bowl').getBoundingClientRect();
    const fin = tarjeta.getBoundingClientRect();
    const dx = bowl.left + desde.x - (fin.left + fin.width / 2);
    const dy = bowl.top + desde.y - (fin.top + fin.height / 2);
    tarjeta.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(0.12) rotate(-25deg)`, opacity: 0.6 },
      { transform: 'translate(0, -24px) scale(1.06) rotate(2deg)', opacity: 1, offset: 0.7 },
      { transform: 'none', opacity: 1 },
    ], { duration: 900, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }
  setTimeout(() => caja.querySelector('button').focus({ preventScroll: true }), 50);
}

async function anular(g) {
  const nota = window.prompt(`¿Anular a ${g.vendedor} (${g.codigo}) del premio ${g.premio}? Su premio se vuelve a sortear.\n\nMotivo:`, 'La información no concuerda con el sistema');
  if (nota === null) return;
  const r = await llamar('adminAnular', { id: g.id, nota }, { timeout: 45000 });
  if (!r.ok) { avisar(r.message || 'No se pudo anular.', { tipo: 'error' }); return; }
  estado.datos = r.data;
  avisar(`Premio ${g.premio} anulado. Ya puedes sacar otro cupón.`);
  pintar();
}
