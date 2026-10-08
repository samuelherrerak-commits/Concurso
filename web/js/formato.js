/** Formatos para Venezuela: $2.300,50 · 12/10/2026 · "12 al 18 de oct." */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'];

let numeroVE;
try {
  numeroVE = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
} catch {
  numeroVE = null;
}

function conSeparadores(n, decimales) {
  if (numeroVE && decimales === 2) return numeroVE.format(n);
  const [entero, dec] = Math.abs(n).toFixed(decimales).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + miles + (dec ? ',' + dec : '');
}

/** $2.300,00 (con decimales) o $2.300 (compacto, si es entero). */
export function dinero(n, { compacto = false } = {}) {
  const v = Number(n) || 0;
  if (compacto && Number.isInteger(Math.round(v * 100) / 100)) return '$' + conSeparadores(v, 0);
  return '$' + conSeparadores(v, 2);
}

export function decimal(n, decimales = 2) {
  const v = Number(n) || 0;
  if (Number.isInteger(v)) return conSeparadores(v, 0);
  return conSeparadores(v, decimales);
}

/**
 * Interpreta lo que el vendedor escribe: "2300", "2300,50", "2.300,50", "2,300.50".
 * Devuelve NaN si no es un número.
 */
export function parsearDecimal(texto) {
  let t = String(texto ?? '').trim().replace(/[^\d.,]/g, '');
  if (!t) return NaN;
  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  if (coma > -1 && punto > -1) {
    t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (coma > -1) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function partes(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  return { a, m, d };
}

/** 12/10/2026 */
export function fechaCorta(iso) {
  if (!iso) return '';
  const { a, m, d } = partes(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

/** 12/10 */
export function diaMes(iso) {
  if (!iso) return '';
  const { m, d } = partes(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** 12 de octubre */
export function fechaLarga(iso) {
  if (!iso) return '';
  const { m, d } = partes(iso);
  return `${d} de ${MESES[m - 1]}`;
}

/** 12 oct. */
export function fechaMedia(iso) {
  if (!iso) return '';
  const { m, d } = partes(iso);
  return `${d} ${MESES_CORTOS[m - 1]}`;
}

/** "12 al 18 de oct." o "28 de sept. al 4 de oct." */
export function rango(inicio, fin) {
  if (!inicio || !fin) return '';
  const a = partes(inicio);
  const b = partes(fin);
  if (a.m === b.m) return `${a.d} al ${b.d} de ${MESES_CORTOS[b.m - 1]}`;
  return `${a.d} de ${MESES_CORTOS[a.m - 1]} al ${b.d} de ${MESES_CORTOS[b.m - 1]}`;
}

/** 08/10/2026 14:32 (hora de Caracas) */
export function fechaHora(ms) {
  const d = new Date(ms);
  try {
    const f = new Intl.DateTimeFormat('es-VE', {
      timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const p = Object.fromEntries(f.map((x) => [x.type, x.value]));
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  } catch {
    return d.toLocaleString();
  }
}

/** Hoy en Caracas, yyyy-mm-dd. */
export function hoyCaracas() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

export function iniciales(nombre, apellido) {
  return ((nombre || '').trim()[0] || '') + ((apellido || '').trim()[0] || '');
}

export function ordinal(n) {
  return `${n}º`;
}

export function pesoArchivo(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "jueves" para una fecha yyyy-mm-dd. */
export function diaSemana(iso) {
  if (!iso) return '';
  const { a, m, d } = partes(iso);
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

/** "viernes 23 de oct." */
export function fechaConDia(iso) {
  if (!iso) return '';
  const { m, d } = partes(iso);
  return `${diaSemana(iso)} ${d} de ${MESES_CORTOS[m - 1]}`;
}

/** Fecha y hora de Caracas desde milisegundos: { iso, hora: "3:00 p. m." }. */
export function enCaracas(ms) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const h24 = Number(p.hour);
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return { iso: `${p.year}-${p.month}-${p.day}`, hora: `${h12}:${p.minute} ${h24 < 12 ? 'a. m.' : 'p. m.'}` };
  } catch {
    const d = new Date(ms);
    return { iso: d.toISOString().slice(0, 10), hora: d.toLocaleTimeString() };
  }
}

/** Cierra una frase con punto sin duplicarlo ("14 de oct." no lleva otro). */
export function conPunto(texto) {
  return /\.$/.test(texto) ? texto : texto + '.';
}

/** "jueves 22 de oct., 3:00 p. m." */
export function momento(ms) {
  if (!ms) return '';
  const c = enCaracas(ms);
  return `${fechaConDia(c.iso)}, ${c.hora}`;
}
