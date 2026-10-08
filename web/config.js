/**
 * Configuración del portal.
 * Pega aquí la URL de tu aplicación web de Apps Script (termina en /exec).
 * Implementar → Administrar implementaciones → copia "URL de la aplicación web".
 */
export const CONFIG = {
  API_URL: 'PEGA_AQUI_LA_URL_DEL_WEB_APP',

  // Tiempo máximo de espera por solicitud (las fotos pueden tardar con datos móviles).
  TIMEOUT_MS: 45000,

  // Compresión de la foto en el celular antes de enviarla.
  FOTO_LADO_MAX: 1280,
  FOTO_CALIDAD: 0.7,
};
