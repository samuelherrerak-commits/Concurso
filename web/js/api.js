import { CONFIG } from '../config.js';

const CLAVE_SESION = 'copa-prosein:sesion';

/** Sesión guardada en localStorage (con try/catch: puede estar bloqueado). */
export const sesion = {
  leer() {
    try {
      const s = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
      if (!s || !s.token || !s.expira || s.expira < Date.now()) return null;
      return s;
    } catch {
      return null;
    }
  },
  guardar(datos) {
    try { localStorage.setItem(CLAVE_SESION, JSON.stringify(datos)); } catch { /* modo privado */ }
  },
  borrar() {
    try { localStorage.removeItem(CLAVE_SESION); } catch { /* modo privado */ }
  },
};

/** Preferencias por vendedor (p. ej. cupones ya vistos). */
export const recuerdo = {
  leer(clave) {
    try { return JSON.parse(localStorage.getItem('copa-prosein:' + clave)); } catch { return null; }
  },
  guardar(clave, valor) {
    try { localStorage.setItem('copa-prosein:' + clave, JSON.stringify(valor)); } catch { /* sin acción */ }
  },
};

const MENSAJES = {
  NETWORK: 'No hay conexión. Revisa tu internet e intenta de nuevo.',
  TIMEOUT: 'El servidor tardó demasiado. Revisa tu conexión e intenta de nuevo.',
  SERVER: 'El servidor respondió algo inesperado. Intenta de nuevo en unos segundos.',
  SETUP: 'Falta configurar el portal: pega la URL del Web App en config.js.',
};

/**
 * Llama al Web App de Apps Script.
 * POST con Content-Type text/plain: así el navegador no hace "preflight" CORS.
 * Siempre resuelve con { ok, data } o { ok:false, code, message, campo? }.
 */
export async function llamar(accion, datos = {}, opciones = {}) {
  if (!CONFIG.API_URL || CONFIG.API_URL.startsWith('PEGA_')) {
    return { ok: false, code: 'SETUP', message: MENSAJES.SETUP };
  }
  const s = sesion.leer();
  const cuerpo = { action: accion, ...datos };
  if (s && !('token' in cuerpo)) cuerpo.token = s.token;

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), opciones.timeout || CONFIG.TIMEOUT_MS);
  let respuesta;
  try {
    respuesta = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(cuerpo),
      redirect: 'follow',
      signal: control.signal,
    });
  } catch (err) {
    clearTimeout(reloj);
    const code = err && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
    return { ok: false, code, message: MENSAJES[code] };
  }
  clearTimeout(reloj);

  let json;
  try {
    json = await respuesta.json();
  } catch {
    return { ok: false, code: 'SERVER', message: MENSAJES.SERVER };
  }
  if (!json || typeof json.ok !== 'boolean') return { ok: false, code: 'SERVER', message: MENSAJES.SERVER };
  if (!json.ok && json.code === 'AUTH') {
    sesion.borrar();
    window.dispatchEvent(new CustomEvent('sesion:vencida', { detail: json.message }));
  }
  return json;
}
