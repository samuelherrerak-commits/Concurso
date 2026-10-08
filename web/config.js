/**
 * Configuración del portal.
 * Pega aquí la URL de tu aplicación web de Apps Script (termina en /exec).
 * Implementar → Administrar implementaciones → copia "URL de la aplicación web".
 */
export const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzLSNBJ9mr82WxWMf5hmiNJA60OndCrNiAi2oT4t8nT3DulIyukuEjRzJ14HUqm_7xnBw/exec',

  // Debe ser igual a token_api en la hoja Configuracion.
  API_TOKEN: 'copaprosein',

  // Tiempo máximo de espera por solicitud (las fotos pueden tardar con datos móviles).
  TIMEOUT_MS: 45000,

  // Compresión de la foto en el celular antes de enviarla.
  FOTO_LADO_MAX: 1280,
  FOTO_CALIDAD: 0.7,
};
