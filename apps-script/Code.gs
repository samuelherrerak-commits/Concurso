/**
 * ============================================================
 *  COPA PROSEIN · Backend (Google Apps Script + Google Sheets)
 * ============================================================
 *
 *  Cómo usarlo (detalle en README.md):
 *    1. En el Google Sheet: Extensiones → Apps Script → pega este archivo.
 *    2. Ejecuta setup() una vez y autoriza los permisos.
 *    3. Implementar → Nueva implementación → Aplicación web
 *       (Ejecutar como: Yo · Quién tiene acceso: Cualquier persona).
 *    4. Copia la URL /exec en web/config.js.
 *
 *  Todo se recalcula desde la hoja Registros en cada consulta: no hay
 *  contadores guardados. Si apruebas, rechazas o corriges una factura,
 *  los cupones (totales y semanales) se ajustan solos.
 */

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

const ZONA_HORARIA = 'America/Caracas';

const HOJA = {
  CONFIG: 'Configuracion',
  USUARIOS: 'Usuarios',
  REGISTROS: 'Registros',
  RANKING: 'Ranking',
};

const COLUMNAS_USUARIOS = [
  'cedula', 'nombre', 'apellido', 'telefono', 'sucursal_o_zona',
  'password_hash', 'salt', 'fecha_registro', 'estado',
  'intentos_fallidos', 'bloqueado_hasta',
];

const COLUMNAS_REGISTROS = [
  'id', 'fecha_carga', 'cedula', 'nombre', 'dia_venta', 'numero_factura',
  'monto', 'vendio_austral', 'm2_austral', 'url_foto', 'estado', 'nota_admin',
];

const ESTADO = { PENDIENTE: 'Pendiente', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' };
const ESTADO_USUARIO = { ACTIVO: 'activo', BLOQUEADO: 'bloqueado' };

const SEGURIDAD = {
  ITERACIONES_HASH: 300,
  MAX_INTENTOS: 5,
  MINUTOS_BLOQUEO: 15,
  CLAVE_MIN: 6,
  CLAVE_MAX: 72,
};

const FOTO = {
  MAX_BYTES: 4 * 1024 * 1024, // 4 MB ya decodificada (el portal envía ~200-500 KB)
  TIPOS: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
};

const CACHE_SEGUNDOS = 20;
const NOTA_PRUEBA = 'DATO DE PRUEBA';
const SUCURSAL_PRUEBA = 'PRUEBA';

/** Filas por defecto de la hoja Configuracion: [clave, valor, descripción]. */
function configuracionPorDefecto_() {
  const hoy = hoyISO_();
  return [
    ['nombre_concurso', 'Copa Prosein', 'Nombre visible en el portal.'],
    ['fecha_inicio', fechaDesdeISO_(hoy), 'Primer día del concurso. La semana 1 empieza este día.'],
    ['fecha_fin', fechaDesdeISO_(sumarDias_(hoy, 7 * 8 - 1)), 'Último día de ventas válidas.'],
    ['fecha_sorteo', fechaDesdeISO_(sumarDias_(hoy, 7 * 8 + 3)), 'Fecha del sorteo final (informativa).'],
    ['monto_por_cupon', 1500, 'Monto (USD) que completa 1 cupón.'],
    ['premios_semanales', 6, 'Ganadores por semana (los que más cupones completan).'],
    ['moneda', 'USD', 'Moneda de los montos.'],
    ['concurso_abierto', 'SI', 'SI = los vendedores pueden cargar ventas.'],
    ['contar_solo_aprobadas', 'NO', 'SI = solo cuentan facturas Aprobadas. NO = cuentan todas menos las Rechazadas.'],
    ['mostrar_ranking_publico', 'SI', 'SI = los vendedores ven el top 10 (sin cédulas).'],
    ['carpeta_fotos_id', '', 'Carpeta de Drive para las fotos. setup() la crea si está vacía.'],
    ['semana_ranking', '', 'Semana que muestra la hoja Ranking. Vacío = semana actual.'],
    ['dias_sesion', 7, 'Días que dura una sesión antes de pedir login otra vez.'],
    ['monto_maximo_venta', 100000, 'Tope por factura para atajar errores de tipeo.'],
    ['token_api', 'copaprosein', 'Clave que el portal envía en cada solicitud (API_TOKEN en web/config.js). Si la cambias aquí, cámbiala también allá. Vacío = sin clave.'],
  ];
}

// ------------------------------------------------------------
// Web App: entrada y router
// ------------------------------------------------------------

/** GET sirve para probar la URL desde el navegador. */
function doGet(e) {
  const accion = e && e.parameter && e.parameter.action;
  if (accion === 'config') return salidaJson_(enrutar_({ action: 'config', api_token: e.parameter.api_token }));
  return salidaJson_(ok_({ servicio: 'Copa Prosein API', estado: 'activo' }));
}

/**
 * El portal llama con fetch POST y Content-Type text/plain (sin preflight CORS).
 * El cuerpo es JSON: { action, token?, ...datos }.
 */
function doPost(e) {
  let solicitud;
  try {
    solicitud = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return salidaJson_(fallo_('BAD_REQUEST', 'Solicitud inválida.'));
  }
  return salidaJson_(enrutar_(solicitud));
}

const ACCIONES_ = {
  config: apiConfig_,
  register: apiRegistro_,
  login: apiLogin_,
  setPassword: apiDefinirClave_,
  logout: apiLogout_,
  getDashboard: apiDashboard_,
  addSale: apiAgregarVenta_,
  getRanking: apiRanking_,
  getPhoto: apiFoto_,
};

function enrutar_(solicitud) {
  MEMO_ = {};
  const fn = solicitud && typeof solicitud.action === 'string' ? ACCIONES_[solicitud.action] : null;
  if (!fn) return fallo_('BAD_REQUEST', 'Acción desconocida.');
  try {
    verificarTokenApi_(solicitud);
    return fn(solicitud);
  } catch (err) {
    if (err && err.esErrorApi) return fallo_(err.code, err.message, err.extra);
    console.error('Error en ' + solicitud.action + ': ' + (err && err.stack ? err.stack : err));
    return fallo_('SERVER', 'Ocurrió un error inesperado. Intenta de nuevo en unos segundos.');
  }
}

/**
 * Clave compartida del portal (token_api en Configuracion).
 * Filtra llamadas que no vienen del portal. Ojo: la clave viaja en el código
 * del sitio, así que no reemplaza el login de cada vendedor.
 */
function verificarTokenApi_(solicitud) {
  const esperado = leerConfig_().token_api;
  if (!esperado) return;
  if (String(solicitud.api_token || '') !== esperado) {
    throw errorApi_('FORBIDDEN_API', 'Este portal no está autorizado para conectarse. Revisa API_TOKEN en config.js.');
  }
}

function salidaJson_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

function ok_(data) {
  return { ok: true, data: data };
}

function fallo_(code, message, extra) {
  const r = { ok: false, code: code, message: message };
  if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  return r;
}

/** Lanza un error que el router convierte en respuesta { ok:false }. */
function errorApi_(code, message, extra) {
  const err = new Error(message);
  err.esErrorApi = true;
  err.code = code;
  err.extra = extra || null;
  return err;
}

function errorCampo_(campo, message) {
  return errorApi_('VALIDATION', message, { campo: campo });
}

// ------------------------------------------------------------
// Endpoints
// ------------------------------------------------------------

function apiConfig_() {
  return ok_(configPublica_(leerConfig_()));
}

function apiRegistro_(req) {
  const cedula = validarCedula_(req.cedula);
  const nombre = validarNombre_(req.nombre, 'nombre', 'Escribe tu nombre.');
  const apellido = validarNombre_(req.apellido, 'apellido', 'Escribe tu apellido.');
  const telefono = validarTelefono_(req.telefono);
  const sucursal = textoLibre_(req.sucursal, 60);
  const clave = validarClave_(req.password);

  conBloqueo_(function () {
    const usuarios = leerUsuarios_({ fresco: true });
    if (buscarUsuario_(usuarios, cedula)) {
      throw errorApi_('DUPLICATE', 'Esta cédula ya está registrada. Ingresa con tu contraseña.', { campo: 'cedula' });
    }
    const salt = generarSalt_();
    const fila = {
      cedula: cedula,
      nombre: nombre,
      apellido: apellido,
      telefono: telefono,
      sucursal_o_zona: sucursal,
      password_hash: hashClave_(clave, salt),
      salt: salt,
      fecha_registro: new Date(),
      estado: ESTADO_USUARIO.ACTIVO,
      intentos_fallidos: 0,
      bloqueado_hasta: '',
    };
    hoja_(HOJA.USUARIOS).appendRow(COLUMNAS_USUARIOS.map(function (c) { return protegerCelda_(fila[c]); }));
    invalidarTabla_(HOJA.USUARIOS);
  });

  const cfg = leerConfig_();
  const sesion = crearSesion_(cedula, cfg);
  return ok_({ token: sesion.token, expira: sesion.expira, usuario: usuarioPublico_({ cedula: cedula, nombre: nombre, apellido: apellido, sucursal: sucursal }) });
}

function apiLogin_(req) {
  const cedula = normalizarCedula_(req.cedula);
  const clave = typeof req.password === 'string' ? req.password : '';
  if (!/^\d{6,9}$/.test(cedula) || !clave) {
    throw errorApi_('CREDENCIALES', 'Escribe tu cédula y tu contraseña.');
  }

  const resultado = conBloqueo_(function () {
    const usuarios = leerUsuarios_({ fresco: true });
    const u = buscarUsuario_(usuarios, cedula);
    if (!u) throw errorApi_('CREDENCIALES', 'Cédula o contraseña incorrecta.');
    verificarCuentaUsable_(u);
    if (!u.hash) {
      throw errorApi_('RESET_REQUIRED', 'Tu contraseña fue reiniciada. Define una nueva para entrar.');
    }
    if (!verificarClave_(clave, u.salt, u.hash)) {
      registrarIntentoFallido_(u);
    }
    if (u.intentos > 0 || u.bloqueadoHasta) reiniciarIntentos_(u);
    return u;
  });

  const cfg = leerConfig_();
  const sesion = crearSesion_(cedula, cfg);
  return ok_({ token: sesion.token, expira: sesion.expira, usuario: usuarioPublico_(resultado) });
}

/**
 * Flujo "olvidé mi contraseña": el admin borra password_hash en Usuarios.
 * El vendedor confirma su teléfono registrado y define una nueva.
 */
function apiDefinirClave_(req) {
  const cedula = validarCedula_(req.cedula);
  const telefono = normalizarTelefono_(req.telefono);
  const clave = validarClave_(req.password);

  const resultado = conBloqueo_(function () {
    const usuarios = leerUsuarios_({ fresco: true });
    const u = buscarUsuario_(usuarios, cedula);
    if (!u) throw errorApi_('CREDENCIALES', 'No encontramos esa cédula.');
    verificarCuentaUsable_(u);
    if (u.hash) throw errorApi_('FORBIDDEN', 'Tu cuenta ya tiene contraseña. Ingresa normalmente o pide al coordinador que la reinicie.');
    if (!mismoTelefono_(u.telefono, telefono)) {
      registrarIntentoFallido_(u, 'El teléfono no coincide con el registrado.');
    }
    const salt = generarSalt_();
    const sh = hoja_(HOJA.USUARIOS);
    const mapa = mapaColumnas_(sh);
    sh.getRange(u.fila, mapa.password_hash).setValue(hashClave_(clave, salt));
    sh.getRange(u.fila, mapa.salt).setValue(salt);
    sh.getRange(u.fila, mapa.intentos_fallidos).setValue(0);
    sh.getRange(u.fila, mapa.bloqueado_hasta).setValue('');
    invalidarTabla_(HOJA.USUARIOS);
    return u;
  });

  const cfg = leerConfig_();
  const sesion = crearSesion_(cedula, cfg);
  return ok_({ token: sesion.token, expira: sesion.expira, usuario: usuarioPublico_(resultado) });
}

function apiLogout_(req) {
  if (typeof req.token === 'string' && req.token) {
    PropertiesService.getScriptProperties().deleteProperty(claveSesion_(req.token));
  }
  return ok_({ cerrada: true });
}

function apiDashboard_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  const registros = leerRegistros_();
  const usuarios = leerUsuarios_();
  const stats = calcularEstadisticas_(registros, cfg);
  const semana = semanaActual_(cfg);
  const yo = stats.vendedores[usuario.cedula] || vendedorVacio_(usuario.cedula);
  const M = cfg.monto_por_cupon_centavos;

  const propios = registros.filter(function (r) { return r.cedula === usuario.cedula; });
  propios.sort(function (a, b) {
    if (a.diaVenta !== b.diaVenta) return a.diaVenta < b.diaVenta ? 1 : -1;
    return b.fechaCarga - a.fechaCarga;
  });
  const pendientes = propios.filter(function (r) { return r.estado === ESTADO.PENDIENTE; });

  const s = semana.numero ? yo.semanas[semana.numero] : null;
  const resumen = {
    cupones: yo.cupones,
    total: centavosADolares_(yo.totalCentavos),
    m2: yo.m2Centesimas / 100,
    sobrante: centavosADolares_(yo.sobranteCentavos),
    falta_para_proximo: centavosADolares_(M - yo.sobranteCentavos),
    progreso: M ? yo.sobranteCentavos / M : 0,
    ventas_pendientes: pendientes.length,
    monto_pendiente: centavosADolares_(pendientes.reduce(function (t, r) { return t + r.montoCentavos; }, 0)),
    semana: {
      numero: semana.numero,
      cupones: s ? s.cupones : 0,
      monto: s ? centavosADolares_(s.montoCentavos) : 0,
    },
  };

  let ranking = null;
  if (cfg.mostrar_ranking_publico) {
    ranking = rankingPublico_(stats, usuarios, cfg, semana.numero, usuario.cedula);
    if (ranking.semana && ranking.semana.mi_posicion) resumen.semana.posicion = ranking.semana.mi_posicion;
  }

  return ok_({
    usuario: usuarioPublico_(usuario),
    concurso: configPublica_(cfg),
    resumen: resumen,
    cupones: yo.detalleCupones.map(cuponPublico_),
    registros: propios.map(registroPublico_),
    ranking: ranking,
  });
}

function apiAgregarVenta_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  if (!cfg.concurso_abierto) {
    throw errorApi_('CLOSED', 'La carga de ventas está cerrada en este momento.');
  }

  const diaVenta = validarDiaVenta_(req.dia_venta, cfg);
  const factura = validarFactura_(req.numero_factura);
  const montoCentavos = validarMonto_(req.monto, cfg);
  const vendioAustral = req.vendio_austral === true || req.vendio_austral === 'SI';
  const m2Centesimas = vendioAustral ? validarM2_(req.m2_austral) : 0;
  const foto = validarFoto_(req.foto);

  // Verificación rápida antes de subir la foto (se repite dentro del bloqueo).
  verificarFacturaUnica_(leerRegistros_(), factura.normalizada, usuario.cedula, factura.texto);

  const nombreArchivo = usuario.cedula + '_' + factura.normalizada + '_' + Date.now() + '.' + foto.extension;
  const archivo = guardarFoto_(foto, nombreArchivo, cfg);

  let antes, nuevo, registros;
  try {
    conBloqueo_(function () {
      registros = leerRegistros_({ fresco: true });
      verificarFacturaUnica_(registros, factura.normalizada, usuario.cedula, factura.texto);
      antes = calcularEstadisticas_(registros, cfg).vendedores[usuario.cedula] || vendedorVacio_(usuario.cedula);

      nuevo = {
        id: siguienteId_(registros),
        fechaCarga: Date.now(),
        cedula: usuario.cedula,
        nombre: nombreCorto_(usuario),
        diaVenta: diaVenta,
        factura: factura.texto,
        facturaNorm: factura.normalizada,
        montoCentavos: montoCentavos,
        austral: vendioAustral,
        m2Centesimas: m2Centesimas,
        urlFoto: archivo.getUrl(),
        estado: ESTADO.PENDIENTE,
        nota: '',
      };
      hoja_(HOJA.REGISTROS).appendRow(filaRegistro_(nuevo));
      invalidarTabla_(HOJA.REGISTROS);
    });
  } catch (err) {
    try { archivo.setTrashed(true); } catch (ignorado) { /* sin acción */ }
    throw err;
  }

  registros.push(nuevo);
  const despues = calcularEstadisticas_(registros, cfg).vendedores[usuario.cedula] || vendedorVacio_(usuario.cedula);
  const semana = semanaActual_(cfg);
  const M = cfg.monto_por_cupon_centavos;
  const s = semana.numero ? despues.semanas[semana.numero] : null;

  const nuevos = despues.detalleCupones.slice(antes.cupones).map(cuponPublico_);
  return ok_({
    registro: registroPublico_(nuevo),
    pendiente_aprobacion: cfg.contar_solo_aprobadas,
    cupones_antes: antes.cupones,
    cupones_despues: despues.cupones,
    cupones_nuevos: Math.max(0, despues.cupones - antes.cupones),
    nuevos_cupones: nuevos,
    acumulado: centavosADolares_(despues.totalCentavos),
    sobrante: centavosADolares_(despues.sobranteCentavos),
    sobrante_antes: centavosADolares_(antes.sobranteCentavos),
    falta_para_proximo: centavosADolares_(M - despues.sobranteCentavos),
    monto_por_cupon: centavosADolares_(M),
    cupones_semana_actual: s ? s.cupones : 0,
    m2_total: despues.m2Centesimas / 100,
  });
}

function apiRanking_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  if (!cfg.mostrar_ranking_publico) throw errorApi_('FORBIDDEN', 'El ranking no está publicado.');
  const stats = calcularEstadisticas_(leerRegistros_(), cfg);
  const total = totalSemanas_(cfg);
  let semana = parseInt(req.semana, 10);
  if (!(semana >= 1 && semana <= total)) semana = semanaActual_(cfg).numero;
  return ok_(rankingPublico_(stats, leerUsuarios_(), cfg, semana, usuario.cedula));
}

/** Devuelve la foto de una factura propia (las fotos no se comparten públicamente). */
function apiFoto_(req) {
  const usuario = requerirUsuario_(req.token);
  const id = String(req.id || '');
  const r = leerRegistros_().filter(function (x) { return x.id === id; })[0];
  if (!r || r.cedula !== usuario.cedula) throw errorApi_('NOT_FOUND', 'No encontramos esa factura.');
  const fileId = idArchivoDesdeUrl_(r.urlFoto);
  if (!fileId) throw errorApi_('NOT_FOUND', 'Esta venta no tiene foto.');
  let blob;
  try {
    blob = DriveApp.getFileById(fileId).getBlob();
  } catch (err) {
    throw errorApi_('NOT_FOUND', 'No pudimos abrir la foto. Puede que la hayan movido o borrado.');
  }
  return ok_({ id: id, foto: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) });
}

// ------------------------------------------------------------
// Cálculo de cupones y rankings (todo desde Registros)
// ------------------------------------------------------------

/** ¿Este registro suma para cupones y rankings? */
function registroCuenta_(r, cfg) {
  return cfg.contar_solo_aprobadas ? r.estado === ESTADO.APROBADA : r.estado !== ESTADO.RECHAZADA;
}

/**
 * Estadísticas por vendedor.
 *  - cupones = floor(acumulado / monto_por_cupon). El sobrante nunca se pierde.
 *  - Cupones de la semana w = cupones completados durante w:
 *      floor(acum_fin_w / M) - floor(acum_fin_(w-1) / M)
 *    La semana sale de dia_venta (no de fecha_carga).
 *  - Cada cupón queda ligado a la factura que lo completó.
 * Todo en centavos (y centésimas de m²) para evitar errores de redondeo.
 */
function calcularEstadisticas_(registros, cfg) {
  const M = cfg.monto_por_cupon_centavos;
  const porCedula = {};
  registros.forEach(function (r) {
    if (!r.cedula || !registroCuenta_(r, cfg)) return;
    (porCedula[r.cedula] = porCedula[r.cedula] || []).push(r);
  });

  const vendedores = {};
  Object.keys(porCedula).forEach(function (cedula) {
    const ventas = porCedula[cedula].slice().sort(compararCronologico_);
    const v = vendedorVacio_(cedula);
    let acumulado = 0;
    ventas.forEach(function (r) {
      const antes = M ? Math.floor(acumulado / M) : 0;
      acumulado += r.montoCentavos;
      const despues = M ? Math.floor(acumulado / M) : 0;
      const w = semanaDe_(r.diaVenta, cfg);
      const s = v.semanas[w] || (v.semanas[w] = { montoCentavos: 0, cupones: 0, m2Centesimas: 0, acumuladoFinCentavos: 0, ultimaCarga: 0 });
      s.montoCentavos += r.montoCentavos;
      s.m2Centesimas += r.m2Centesimas;
      s.cupones += despues - antes;
      s.acumuladoFinCentavos = acumulado;
      s.ultimaCarga = Math.max(s.ultimaCarga, r.fechaCarga);
      v.m2Centesimas += r.m2Centesimas;
      v.ultimaCarga = Math.max(v.ultimaCarga, r.fechaCarga);
      for (let n = antes + 1; n <= despues; n++) {
        v.detalleCupones.push({ n: n, diaVenta: r.diaVenta, factura: r.factura, semana: w, registroId: r.id, fechaCarga: r.fechaCarga });
      }
    });
    v.totalCentavos = acumulado;
    v.cupones = v.detalleCupones.length;
    v.sobranteCentavos = acumulado - v.cupones * M;
    vendedores[cedula] = v;
  });

  return { vendedores: vendedores };
}

function vendedorVacio_(cedula) {
  return { cedula: cedula, totalCentavos: 0, m2Centesimas: 0, cupones: 0, sobranteCentavos: 0, detalleCupones: [], semanas: {}, ultimaCarga: 0 };
}

function compararCronologico_(a, b) {
  if (a.diaVenta !== b.diaVenta) return a.diaVenta < b.diaVenta ? -1 : 1;
  if (a.fechaCarga !== b.fechaCarga) return a.fechaCarga - b.fechaCarga;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ranking general: cupones ↓, total ↓, m² ↓. */
function rankingGeneral_(stats) {
  return valores_(stats.vendedores)
    .filter(function (v) { return v.totalCentavos > 0; })
    .sort(function (a, b) {
      return (b.cupones - a.cupones) || (b.totalCentavos - a.totalCentavos) || (b.m2Centesimas - a.m2Centesimas) || compararTexto_(a.cedula, b.cedula);
    });
}

/** Premio mayor: más m² Austral en todo el concurso. Desempate: mayor monto total. */
function rankingAustral_(stats) {
  return valores_(stats.vendedores)
    .filter(function (v) { return v.m2Centesimas > 0; })
    .sort(function (a, b) {
      return (b.m2Centesimas - a.m2Centesimas) || (b.totalCentavos - a.totalCentavos) || (a.ultimaCarga - b.ultimaCarga);
    });
}

/**
 * Premios semanales: más cupones completados en la semana.
 * Desempate: mayor venta de la semana → mayor acumulado al cierre de esa semana
 * → quien llegó primero a su marca (carga más temprana de su última factura de la semana).
 * Con 0 cupones en la semana no se califica.
 */
function rankingSemana_(stats, semana) {
  return valores_(stats.vendedores)
    .map(function (v) { return { v: v, s: v.semanas[semana] }; })
    .filter(function (x) { return x.s && x.s.cupones > 0; })
    .sort(function (a, b) {
      return (b.s.cupones - a.s.cupones) ||
        (b.s.montoCentavos - a.s.montoCentavos) ||
        (b.s.acumuladoFinCentavos - a.s.acumuladoFinCentavos) ||
        (a.s.ultimaCarga - b.s.ultimaCarga);
    });
}

/**
 * Lista expandida de cupones para el sorteo, numerada en el orden en que
 * se completaron (día de venta y luego hora de carga).
 * El sorteo final todavía se está definiendo: usa esta lista como base.
 */
function cuponesParaSorteo_(stats) {
  const todos = [];
  valores_(stats.vendedores).forEach(function (v) {
    v.detalleCupones.forEach(function (c) { todos.push({ cedula: v.cedula, cupon: c }); });
  });
  todos.sort(function (a, b) {
    if (a.cupon.diaVenta !== b.cupon.diaVenta) return a.cupon.diaVenta < b.cupon.diaVenta ? -1 : 1;
    return (a.cupon.fechaCarga - b.cupon.fechaCarga) || compararTexto_(a.cedula, b.cedula) || (a.cupon.n - b.cupon.n);
  });
  return todos.map(function (x, i) { return { numero: i + 1, cedula: x.cedula, cupon: x.cupon }; });
}

function rankingPublico_(stats, usuarios, cfg, numeroSemana, miCedula) {
  const nombres = mapaNombres_(usuarios);
  const nombre = function (cedula) { return nombres[cedula] || 'Vendedor'; };

  const general = rankingGeneral_(stats);
  const austral = rankingAustral_(stats);
  const semanal = numeroSemana ? rankingSemana_(stats, numeroSemana) : [];
  const posicion = function (lista, fn) {
    for (let i = 0; i < lista.length; i++) if (fn(lista[i]) === miCedula) return i + 1;
    return null;
  };
  const rango = numeroSemana ? rangoSemana_(numeroSemana, cfg) : null;

  return {
    general: {
      mi_posicion: posicion(general, function (v) { return v.cedula; }),
      participantes: general.length,
      top: general.slice(0, 10).map(function (v, i) {
        return { pos: i + 1, nombre: nombre(v.cedula), cupones: v.cupones, total: centavosADolares_(v.totalCentavos), es_tu: v.cedula === miCedula };
      }),
    },
    austral: {
      mi_posicion: posicion(austral, function (v) { return v.cedula; }),
      participantes: austral.length,
      top: austral.slice(0, 10).map(function (v, i) {
        return { pos: i + 1, nombre: nombre(v.cedula), m2: v.m2Centesimas / 100, es_tu: v.cedula === miCedula };
      }),
    },
    semana: numeroSemana ? {
      numero: numeroSemana,
      inicio: rango.inicio,
      fin: rango.fin,
      premios: cfg.premios_semanales,
      mi_posicion: posicion(semanal, function (x) { return x.v.cedula; }),
      participantes: semanal.length,
      top: semanal.slice(0, 10).map(function (x, i) {
        return { pos: i + 1, nombre: nombre(x.v.cedula), cupones: x.s.cupones, monto: centavosADolares_(x.s.montoCentavos), es_tu: x.v.cedula === miCedula };
      }),
    } : null,
  };
}

// ------------------------------------------------------------
// Semanas y fechas (todas en formato yyyy-MM-dd, zona Caracas)
// ------------------------------------------------------------

function semanaDe_(iso, cfg) {
  return Math.floor(diasEntre_(cfg.fecha_inicio, iso) / 7) + 1;
}

function totalSemanas_(cfg) {
  if (!cfg.fecha_inicio || !cfg.fecha_fin || cfg.fecha_fin < cfg.fecha_inicio) return 0;
  return Math.floor(diasEntre_(cfg.fecha_inicio, cfg.fecha_fin) / 7) + 1;
}

function rangoSemana_(n, cfg) {
  const inicio = sumarDias_(cfg.fecha_inicio, 7 * (n - 1));
  let fin = sumarDias_(inicio, 6);
  if (cfg.fecha_fin && fin > cfg.fecha_fin) fin = cfg.fecha_fin;
  return { inicio: inicio, fin: fin };
}

/** Semana en curso. Antes de empezar: numero 0. Después de terminar: la última. */
function semanaActual_(cfg) {
  const hoy = hoyISO_();
  const total = totalSemanas_(cfg);
  if (!total || hoy < cfg.fecha_inicio) {
    return { numero: 0, total: total, estado: 'antes', inicio: cfg.fecha_inicio, fin: cfg.fecha_inicio ? sumarDias_(cfg.fecha_inicio, 6) : '' };
  }
  const terminado = hoy > cfg.fecha_fin;
  const n = terminado ? total : semanaDe_(hoy, cfg);
  const r = rangoSemana_(n, cfg);
  return { numero: n, total: total, estado: terminado ? 'terminado' : 'en_curso', inicio: r.inicio, fin: r.fin };
}

function hoyISO_() {
  return Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
}

function isoAUtc_(iso) {
  const p = iso.split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function diasEntre_(desdeIso, hastaIso) {
  return Math.round((isoAUtc_(hastaIso) - isoAUtc_(desdeIso)) / 86400000);
}

function sumarDias_(iso, dias) {
  const d = new Date(isoAUtc_(iso) + dias * 86400000);
  return d.getUTCFullYear() + '-' + dos_(d.getUTCMonth() + 1) + '-' + dos_(d.getUTCDate());
}

function dos_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Date (medianoche en Caracas) para escribir en celdas de fecha. */
function fechaDesdeISO_(iso) {
  return Utilities.parseDate(iso, ZONA_HORARIA, 'yyyy-MM-dd');
}

/** Lee una fecha de celda (Date o texto) y la devuelve como yyyy-MM-dd. */
function aISO_(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) return Utilities.formatDate(valor, ZONA_HORARIA, 'yyyy-MM-dd');
  const t = String(valor === null || valor === undefined ? '' : valor).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + dos_(Number(m[2])) + '-' + dos_(Number(m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + dos_(Number(m[2])) + '-' + dos_(Number(m[1]));
  return '';
}

function esISOValida_(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const p = iso.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function aMillis_(valor) {
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === 'number') return valor;
  const n = Date.parse(String(valor || ''));
  return isNaN(n) ? 0 : n;
}

function fechaCorta_(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

// ------------------------------------------------------------
// Lectura de hojas (una sola getValues() por hoja + caché corto)
// ------------------------------------------------------------

let MEMO_ = {};

function hoja_(nombre) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh) throw errorApi_('SERVER', 'Falta la hoja "' + nombre + '". Ejecuta setup() en el Sheet.');
  return sh;
}

/** { nombre_columna: número_de_columna (1-based) } leyendo la fila de encabezados. */
function mapaColumnas_(sh) {
  const encabezados = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const mapa = {};
  encabezados.forEach(function (h, i) { mapa[String(h).trim()] = i + 1; });
  return mapa;
}

/** Filas como objetos { columna: valor }, con el número de fila en _fila. */
function filasComoObjetos_(sh) {
  const valores = sh.getDataRange().getValues();
  const encabezados = (valores.shift() || []).map(function (h) { return String(h).trim(); });
  return valores.map(function (fila, i) {
    const o = { _fila: i + 2 };
    encabezados.forEach(function (h, j) { if (h) o[h] = fila[j]; });
    return o;
  });
}

function leerTablaConCache_(nombre, parsear, opciones) {
  const fresco = opciones && opciones.fresco;
  if (!fresco && MEMO_[nombre]) return MEMO_[nombre];
  if (!fresco) {
    const enCache = cacheLeerJson_('tbl_' + nombre);
    if (enCache) return (MEMO_[nombre] = enCache);
  }
  const datos = parsear(filasComoObjetos_(hoja_(nombre)));
  MEMO_[nombre] = datos;
  cachePonerJson_('tbl_' + nombre, datos, CACHE_SEGUNDOS);
  return datos;
}

function invalidarTabla_(nombre) {
  delete MEMO_[nombre];
  CacheService.getScriptCache().remove('tbl_' + nombre);
}

function leerConfig_() {
  const crudo = leerTablaConCache_(HOJA.CONFIG, function (filas) {
    const o = {};
    filas.forEach(function (f) {
      const clave = String(f.clave || '').trim();
      if (!clave) return;
      const v = f.valor;
      o[clave] = v instanceof Date ? aISO_(v) : v;
    });
    return o;
  });

  const numero = function (v, porDefecto) {
    const n = parsearNumero_(v);
    return isNaN(n) ? porDefecto : n;
  };
  const cfg = {
    nombre_concurso: String(crudo.nombre_concurso || 'Copa Prosein'),
    fecha_inicio: aISO_(crudo.fecha_inicio),
    fecha_fin: aISO_(crudo.fecha_fin),
    fecha_sorteo: aISO_(crudo.fecha_sorteo),
    monto_por_cupon: numero(crudo.monto_por_cupon, 1500),
    premios_semanales: Math.max(0, Math.floor(numero(crudo.premios_semanales, 6))),
    moneda: String(crudo.moneda || 'USD'),
    concurso_abierto: esSi_(crudo.concurso_abierto),
    contar_solo_aprobadas: esSi_(crudo.contar_solo_aprobadas),
    mostrar_ranking_publico: esSi_(crudo.mostrar_ranking_publico),
    carpeta_fotos_id: String(crudo.carpeta_fotos_id || '').trim(),
    semana_ranking: parseInt(crudo.semana_ranking, 10) || 0,
    dias_sesion: Math.max(1, numero(crudo.dias_sesion, 7)),
    monto_maximo_venta: numero(crudo.monto_maximo_venta, 100000),
    token_api: String(crudo.token_api === undefined || crudo.token_api === null ? '' : crudo.token_api).trim(),
  };
  cfg.monto_por_cupon_centavos = Math.round(cfg.monto_por_cupon * 100);
  if (!cfg.fecha_inicio || !cfg.fecha_fin) throw errorApi_('SERVER', 'Faltan fecha_inicio o fecha_fin en la hoja Configuracion.');
  if (!(cfg.monto_por_cupon_centavos > 0)) throw errorApi_('SERVER', 'monto_por_cupon en Configuracion debe ser mayor que 0.');
  return cfg;
}

function configPublica_(cfg) {
  const semana = semanaActual_(cfg);
  return {
    nombre: cfg.nombre_concurso,
    fecha_inicio: cfg.fecha_inicio,
    fecha_fin: cfg.fecha_fin,
    fecha_sorteo: cfg.fecha_sorteo,
    monto_por_cupon: cfg.monto_por_cupon,
    premios_semanales: cfg.premios_semanales,
    moneda: cfg.moneda,
    concurso_abierto: cfg.concurso_abierto,
    contar_solo_aprobadas: cfg.contar_solo_aprobadas,
    mostrar_ranking_publico: cfg.mostrar_ranking_publico,
    hoy: hoyISO_(),
    total_semanas: semana.total,
    semana_actual: semana,
  };
}

/** Usuarios. En caché se guarda sin hash ni salt. */
function leerUsuarios_(opciones) {
  const parsear = function (filas) {
    return filas.map(function (f) {
      return {
        fila: f._fila,
        cedula: normalizarCedula_(f.cedula),
        nombre: String(f.nombre || '').trim(),
        apellido: String(f.apellido || '').trim(),
        telefono: String(f.telefono || '').trim(),
        sucursal: String(f.sucursal_o_zona || '').trim(),
        hash: String(f.password_hash || '').trim(),
        salt: String(f.salt || '').trim(),
        fechaRegistro: aMillis_(f.fecha_registro),
        estado: String(f.estado || ESTADO_USUARIO.ACTIVO).trim().toLowerCase(),
        intentos: parseInt(f.intentos_fallidos, 10) || 0,
        bloqueadoHasta: f.bloqueado_hasta ? aMillis_(f.bloqueado_hasta) : 0,
      };
    }).filter(function (u) { return u.cedula; });
  };
  if (opciones && opciones.fresco) {
    const datos = parsear(filasComoObjetos_(hoja_(HOJA.USUARIOS)));
    MEMO_[HOJA.USUARIOS] = datos;
    return datos;
  }
  if (MEMO_[HOJA.USUARIOS]) return MEMO_[HOJA.USUARIOS];
  const enCache = cacheLeerJson_('tbl_' + HOJA.USUARIOS);
  if (enCache) return (MEMO_[HOJA.USUARIOS] = enCache);
  const datos = parsear(filasComoObjetos_(hoja_(HOJA.USUARIOS)));
  MEMO_[HOJA.USUARIOS] = datos;
  cachePonerJson_('tbl_' + HOJA.USUARIOS, datos.map(function (u) {
    const copia = Object.assign({}, u);
    copia.hash = copia.hash ? 'x' : '';
    copia.salt = '';
    return copia;
  }), CACHE_SEGUNDOS);
  return datos;
}

function leerRegistros_(opciones) {
  return leerTablaConCache_(HOJA.REGISTROS, function (filas) {
    return filas.map(function (f) {
      const estadoTexto = String(f.estado || '').trim().toLowerCase();
      const estado = estadoTexto.indexOf('aprob') === 0 ? ESTADO.APROBADA
        : estadoTexto.indexOf('rechaz') === 0 ? ESTADO.RECHAZADA : ESTADO.PENDIENTE;
      const factura = String(f.numero_factura || '').trim();
      const monto = parsearNumero_(f.monto);
      const m2 = parsearNumero_(f.m2_austral);
      return {
        fila: f._fila,
        id: String(f.id || '').trim(),
        fechaCarga: aMillis_(f.fecha_carga),
        cedula: normalizarCedula_(f.cedula),
        nombre: String(f.nombre || '').trim(),
        diaVenta: aISO_(f.dia_venta),
        factura: factura,
        facturaNorm: normalizarFactura_(factura),
        montoCentavos: isNaN(monto) ? 0 : Math.round(monto * 100),
        austral: esSi_(f.vendio_austral),
        m2Centesimas: isNaN(m2) ? 0 : Math.round(m2 * 100),
        urlFoto: String(f.url_foto || '').trim(),
        estado: estado,
        nota: String(f.nota_admin || '').trim(),
      };
    }).filter(function (r) { return r.cedula && r.diaVenta; });
  }, opciones);
}

function filaRegistro_(r) {
  const valores = {
    id: r.id,
    fecha_carga: new Date(r.fechaCarga),
    cedula: r.cedula,
    nombre: r.nombre,
    dia_venta: fechaDesdeISO_(r.diaVenta),
    numero_factura: r.factura,
    monto: r.montoCentavos / 100,
    vendio_austral: r.austral ? 'SI' : 'NO',
    m2_austral: r.m2Centesimas / 100,
    url_foto: r.urlFoto,
    estado: r.estado,
    nota_admin: r.nota,
  };
  return COLUMNAS_REGISTROS.map(function (c) { return protegerCelda_(valores[c]); });
}

function siguienteId_(registros) {
  let max = 0;
  registros.forEach(function (r) {
    const m = r.id.match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'CP-' + ('00000' + (max + 1)).slice(-6);
}

// Caché en trozos (CacheService admite ~100 KB por valor).
function cachePonerJson_(clave, objeto, segundos) {
  try {
    const texto = JSON.stringify(objeto);
    const TAM = 45000;
    const n = Math.max(1, Math.ceil(texto.length / TAM));
    if (n > 20) return;
    const piezas = {};
    for (let i = 0; i < n; i++) piezas[clave + '_' + i] = texto.substr(i * TAM, TAM);
    const cache = CacheService.getScriptCache();
    cache.putAll(piezas, segundos);
    cache.put(clave, String(n), segundos);
  } catch (err) {
    console.warn('No se pudo guardar en caché ' + clave + ': ' + err);
  }
}

function cacheLeerJson_(clave) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(clave));
    if (!n) return null;
    const claves = [];
    for (let i = 0; i < n; i++) claves.push(clave + '_' + i);
    const piezas = cache.getAll(claves);
    let texto = '';
    for (let i = 0; i < claves.length; i++) {
      if (piezas[claves[i]] === undefined || piezas[claves[i]] === null) return null;
      texto += piezas[claves[i]];
    }
    return JSON.parse(texto);
  } catch (err) {
    return null;
  }
}

// ------------------------------------------------------------
// Validación y saneamiento
// ------------------------------------------------------------

function normalizarCedula_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/\D/g, '').replace(/^0+/, '');
}

function validarCedula_(valor) {
  const c = normalizarCedula_(valor);
  if (!/^\d{6,9}$/.test(c)) throw errorCampo_('cedula', 'La cédula debe tener entre 6 y 9 dígitos, sin letras ni puntos.');
  return c;
}

function validarNombre_(valor, campo, mensajeVacio) {
  const t = String(valor || '').replace(/\s+/g, ' ').trim();
  if (!t) throw errorCampo_(campo, mensajeVacio);
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{1,39}$/.test(t)) {
    throw errorCampo_(campo, 'Usa solo letras (de 2 a 40).');
  }
  return t.toLowerCase().replace(/(^|[\s'-])([a-záéíóúüñ])/g, function (m, sep, letra) { return sep + letra.toUpperCase(); });
}

function normalizarTelefono_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/\D/g, '');
}

/** Compara los últimos 10 dígitos (0414… y +58 414… son el mismo número). */
function mismoTelefono_(a, b) {
  const x = normalizarTelefono_(a).slice(-10);
  const y = normalizarTelefono_(b).slice(-10);
  return x.length === 10 && x === y;
}

function validarTelefono_(valor) {
  const t = normalizarTelefono_(valor);
  if (t.length < 10 || t.length > 13) throw errorCampo_('telefono', 'Escribe tu teléfono con código de área, por ejemplo 0414 123 4567.');
  return t;
}

function validarClave_(valor) {
  if (typeof valor !== 'string' || valor.length < SEGURIDAD.CLAVE_MIN) {
    throw errorCampo_('password', 'La contraseña debe tener al menos ' + SEGURIDAD.CLAVE_MIN + ' caracteres.');
  }
  if (valor.length > SEGURIDAD.CLAVE_MAX) throw errorCampo_('password', 'La contraseña es demasiado larga.');
  return valor;
}

function validarDiaVenta_(valor, cfg) {
  const iso = String(valor || '').trim();
  if (!esISOValida_(iso)) throw errorCampo_('dia_venta', 'Elige el día de la venta.');
  if (iso > hoyISO_()) throw errorCampo_('dia_venta', 'La fecha no puede ser futura.');
  if ((cfg.fecha_inicio && iso < cfg.fecha_inicio) || (cfg.fecha_fin && iso > cfg.fecha_fin)) {
    throw errorCampo_('dia_venta', 'La fecha debe estar dentro del concurso: del ' + fechaCorta_(cfg.fecha_inicio) + ' al ' + fechaCorta_(cfg.fecha_fin) + '.');
  }
  return iso;
}

function normalizarFactura_(texto) {
  const limpio = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sinCeros = limpio.replace(/^0+(?=[A-Z0-9])/, '');
  return sinCeros || limpio;
}

function validarFactura_(valor) {
  const t = String(valor || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!t) throw errorCampo_('numero_factura', 'Escribe el número de factura.');
  if (!/^[A-Z0-9][A-Z0-9 .\/-]{0,29}$/.test(t)) {
    throw errorCampo_('numero_factura', 'Usa solo letras, números y guiones (máximo 30).');
  }
  return { texto: t, normalizada: normalizarFactura_(t) };
}

function validarMonto_(valor, cfg) {
  const n = typeof valor === 'number' ? valor : parsearNumero_(valor);
  if (!isFinite(n) || n <= 0) throw errorCampo_('monto', 'Escribe un monto mayor que 0.');
  if (n > cfg.monto_maximo_venta) {
    throw errorCampo_('monto', 'El monto supera el máximo por factura (' + cfg.monto_maximo_venta + ' ' + cfg.moneda + '). Revisa la cifra.');
  }
  return Math.round(n * 100);
}

function validarM2_(valor) {
  const n = typeof valor === 'number' ? valor : parsearNumero_(valor);
  if (!isFinite(n) || n <= 0) throw errorCampo_('m2_austral', 'Escribe los metros cuadrados de Austral (mayor que 0).');
  if (n > 100000) throw errorCampo_('m2_austral', 'Revisa los metros cuadrados: la cifra es demasiado alta.');
  return Math.round(n * 100);
}

function validarFoto_(valor) {
  const t = typeof valor === 'string' ? valor : '';
  const m = t.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw errorCampo_('foto', 'Agrega la foto de la factura.');
  if (m[2].length > Math.ceil(FOTO.MAX_BYTES / 3) * 4) throw errorCampo_('foto', 'La foto es demasiado pesada. Toma otra con menos zoom.');
  let bytes;
  try {
    bytes = Utilities.base64Decode(m[2]);
  } catch (err) {
    throw errorCampo_('foto', 'No pudimos leer la foto. Intenta de nuevo.');
  }
  const b = function (i) { return bytes[i] & 0xff; };
  const esJpeg = b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  const esPng = b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47;
  const esWebp = b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45;
  const tipoReal = esJpeg ? 'image/jpeg' : esPng ? 'image/png' : esWebp ? 'image/webp' : '';
  if (!tipoReal) throw errorCampo_('foto', 'El archivo no parece una foto. Usa JPG o PNG.');
  return { bytes: bytes, tipo: tipoReal, extension: FOTO.TIPOS[tipoReal] };
}

/** Facturas únicas en todo el concurso. Las rechazadas no bloquean un nuevo intento. */
function verificarFacturaUnica_(registros, facturaNorm, cedula, facturaTexto) {
  const existente = registros.filter(function (r) {
    return r.facturaNorm === facturaNorm && r.estado !== ESTADO.RECHAZADA;
  })[0];
  if (!existente) return;
  if (existente.cedula === cedula) {
    throw errorApi_('DUPLICATE', 'Ya registraste la factura ' + facturaTexto + '.', { campo: 'numero_factura' });
  }
  throw errorApi_('DUPLICATE', 'La factura ' + facturaTexto + ' ya fue registrada por otro vendedor. Si es un error, habla con el coordinador.', { campo: 'numero_factura' });
}

/** Texto libre seguro para Sheets: sin caracteres de control y sin fórmulas. */
function textoLibre_(valor, max) {
  return String(valor || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Neutraliza valores que Sheets interpretaría como fórmula (=, +, -, @). */
function protegerCelda_(valor) {
  if (typeof valor !== 'string') return valor;
  return /^[=+\-@\t\r]/.test(valor) ? "'" + valor : valor;
}

function parsearNumero_(valor) {
  if (typeof valor === 'number') return valor;
  let t = String(valor === null || valor === undefined ? '' : valor).replace(/[^\d.,-]/g, '');
  if (!t) return NaN;
  const ultimaComa = t.lastIndexOf(',');
  const ultimoPunto = t.lastIndexOf('.');
  if (ultimaComa > -1 && ultimoPunto > -1) {
    // El separador que aparece de último es el decimal.
    t = ultimaComa > ultimoPunto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (ultimaComa > -1) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  }
  return Number(t);
}

function esSi_(valor) {
  if (valor === true) return true;
  const t = String(valor || '').trim().toUpperCase();
  return t === 'SI' || t === 'SÍ' || t === 'TRUE' || t === 'X';
}

// ------------------------------------------------------------
// Contraseñas y sesiones
// ------------------------------------------------------------

function sha256Hex_(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function generarSalt_() {
  return sha256Hex_(Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now()).slice(0, 32);
}

/** SHA-256 con salt por usuario, repetido N veces. Formato: v1$N$hex. */
function hashClave_(clave, salt, iteraciones) {
  const n = iteraciones || SEGURIDAD.ITERACIONES_HASH;
  let h = sha256Hex_(salt + ':' + clave);
  for (let i = 1; i < n; i++) h = sha256Hex_(h + ':' + salt);
  return 'v1$' + n + '$' + h;
}

function verificarClave_(clave, salt, guardado) {
  const partes = String(guardado || '').split('$');
  if (partes.length !== 3 || partes[0] !== 'v1') return false;
  const calculado = hashClave_(clave, salt, Number(partes[1]));
  if (calculado.length !== guardado.length) return false;
  let diferencia = 0;
  for (let i = 0; i < calculado.length; i++) diferencia |= calculado.charCodeAt(i) ^ guardado.charCodeAt(i);
  return diferencia === 0;
}

function verificarCuentaUsable_(u) {
  if (u.estado === ESTADO_USUARIO.BLOQUEADO) {
    throw errorApi_('LOCKED', 'Tu cuenta está bloqueada. Habla con el coordinador del concurso.');
  }
  if (u.bloqueadoHasta && u.bloqueadoHasta > Date.now()) {
    const minutos = Math.max(1, Math.ceil((u.bloqueadoHasta - Date.now()) / 60000));
    throw errorApi_('LOCKED', 'Demasiados intentos fallidos. Intenta de nuevo en ' + minutos + (minutos === 1 ? ' minuto.' : ' minutos.'));
  }
}

/** Suma un intento fallido; al 5º bloquea temporalmente. Siempre lanza error. */
function registrarIntentoFallido_(u, mensaje) {
  const sh = hoja_(HOJA.USUARIOS);
  const mapa = mapaColumnas_(sh);
  const intentos = (u.bloqueadoHasta && u.bloqueadoHasta <= Date.now() ? 0 : u.intentos) + 1;
  invalidarTabla_(HOJA.USUARIOS);
  if (intentos >= SEGURIDAD.MAX_INTENTOS) {
    sh.getRange(u.fila, mapa.intentos_fallidos).setValue(0);
    sh.getRange(u.fila, mapa.bloqueado_hasta).setValue(new Date(Date.now() + SEGURIDAD.MINUTOS_BLOQUEO * 60000));
    throw errorApi_('LOCKED', 'Demasiados intentos fallidos. Tu cuenta quedó en pausa ' + SEGURIDAD.MINUTOS_BLOQUEO + ' minutos.');
  }
  sh.getRange(u.fila, mapa.intentos_fallidos).setValue(intentos);
  const quedan = SEGURIDAD.MAX_INTENTOS - intentos;
  throw errorApi_('CREDENCIALES', (mensaje || 'Cédula o contraseña incorrecta.') + ' Te ' + (quedan === 1 ? 'queda 1 intento.' : 'quedan ' + quedan + ' intentos.'));
}

function reiniciarIntentos_(u) {
  const sh = hoja_(HOJA.USUARIOS);
  const mapa = mapaColumnas_(sh);
  sh.getRange(u.fila, mapa.intentos_fallidos).setValue(0);
  sh.getRange(u.fila, mapa.bloqueado_hasta).setValue('');
  invalidarTabla_(HOJA.USUARIOS);
}

/** La clave en PropertiesService es un hash del token: ver las propiedades no da acceso. */
function claveSesion_(token) {
  return 'ses_' + sha256Hex_('sesion:' + token).slice(0, 40);
}

function crearSesion_(cedula, cfg) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const expira = Date.now() + cfg.dias_sesion * 86400000;
  const props = PropertiesService.getScriptProperties();
  props.setProperty(claveSesion_(token), JSON.stringify({ c: cedula, e: expira }));
  if (Math.random() < 0.1) limpiarSesionesVencidas_();
  return { token: token, expira: expira };
}

function limpiarSesionesVencidas_() {
  const props = PropertiesService.getScriptProperties();
  const todas = props.getProperties();
  const ahora = Date.now();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf('ses_') !== 0) return;
    try {
      if (JSON.parse(todas[k]).e < ahora) props.deleteProperty(k);
    } catch (err) {
      props.deleteProperty(k);
    }
  });
}

/** Valida el token y devuelve el usuario. Todo endpoint autenticado usa SOLO esta cédula. */
function requerirUsuario_(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
    throw errorApi_('AUTH', 'Tu sesión venció. Ingresa de nuevo.');
  }
  const props = PropertiesService.getScriptProperties();
  const clave = claveSesion_(token);
  const crudo = props.getProperty(clave);
  if (!crudo) throw errorApi_('AUTH', 'Tu sesión venció. Ingresa de nuevo.');
  let sesion;
  try {
    sesion = JSON.parse(crudo);
  } catch (err) {
    props.deleteProperty(clave);
    throw errorApi_('AUTH', 'Tu sesión venció. Ingresa de nuevo.');
  }
  if (!sesion.e || sesion.e < Date.now()) {
    props.deleteProperty(clave);
    throw errorApi_('AUTH', 'Tu sesión venció. Ingresa de nuevo.');
  }
  const u = buscarUsuario_(leerUsuarios_(), sesion.c);
  if (!u) throw errorApi_('AUTH', 'No encontramos tu cuenta. Ingresa de nuevo.');
  if (u.estado === ESTADO_USUARIO.BLOQUEADO) {
    props.deleteProperty(clave);
    throw errorApi_('AUTH', 'Tu cuenta está bloqueada. Habla con el coordinador del concurso.');
  }
  return u;
}

function buscarUsuario_(usuarios, cedula) {
  for (let i = 0; i < usuarios.length; i++) if (usuarios[i].cedula === cedula) return usuarios[i];
  return null;
}

/** Ejecuta fn con el bloqueo del script (evita dos escrituras a la vez). */
function conBloqueo_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw errorApi_('BUSY', 'Hay muchas cargas en este momento. Intenta de nuevo en unos segundos.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
// Fotos en Drive
// ------------------------------------------------------------

function guardarFoto_(foto, nombreArchivo, cfg) {
  const carpeta = carpetaFotos_(cfg);
  return carpeta.createFile(Utilities.newBlob(foto.bytes, foto.tipo, nombreArchivo));
}

function carpetaFotos_(cfg) {
  if (cfg.carpeta_fotos_id) {
    try {
      return DriveApp.getFolderById(cfg.carpeta_fotos_id);
    } catch (err) {
      console.warn('carpeta_fotos_id inválida, se crea una nueva: ' + err);
    }
  }
  return conBloqueo_(function () {
    invalidarTabla_(HOJA.CONFIG);
    const actual = leerConfig_();
    if (actual.carpeta_fotos_id && actual.carpeta_fotos_id !== cfg.carpeta_fotos_id) {
      return DriveApp.getFolderById(actual.carpeta_fotos_id);
    }
    const carpeta = DriveApp.createFolder('Copa Prosein · Fotos de facturas');
    escribirConfig_('carpeta_fotos_id', carpeta.getId());
    return carpeta;
  });
}

function idArchivoDesdeUrl_(url) {
  const t = String(url || '');
  const m = t.match(/\/d\/([A-Za-z0-9_-]{10,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : '';
}

// ------------------------------------------------------------
// Formatos de salida
// ------------------------------------------------------------

function centavosADolares_(c) {
  return Math.round(c) / 100;
}

function enmascararCedula_(cedula) {
  const c = String(cedula || '');
  if (c.length <= 4) return c;
  return c.slice(0, 2) + '•'.repeat(c.length - 4) + c.slice(-2);
}

function nombreCorto_(u) {
  const primero = function (t) { return String(t || '').trim().split(/\s+/)[0] || ''; };
  return (primero(u.nombre) + ' ' + primero(u.apellido)).trim();
}

function mapaNombres_(usuarios) {
  const m = {};
  usuarios.forEach(function (u) { m[u.cedula] = nombreCorto_(u); });
  return m;
}

function usuarioPublico_(u) {
  return { nombre: u.nombre, apellido: u.apellido, cedula_mask: enmascararCedula_(u.cedula), sucursal: u.sucursal || '' };
}

function registroPublico_(r) {
  return {
    id: r.id,
    fecha_carga: r.fechaCarga,
    dia_venta: r.diaVenta,
    numero_factura: r.factura,
    monto: centavosADolares_(r.montoCentavos),
    vendio_austral: r.austral,
    m2_austral: r.m2Centesimas / 100,
    estado: r.estado,
    nota_admin: r.nota,
    tiene_foto: !!idArchivoDesdeUrl_(r.urlFoto),
  };
}

function cuponPublico_(c) {
  return { n: c.n, dia_venta: c.diaVenta, factura: c.factura, semana: c.semana };
}

function valores_(objeto) {
  return Object.keys(objeto).map(function (k) { return objeto[k]; });
}

function compararTexto_(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ------------------------------------------------------------
// Configuración inicial de las hojas
// ------------------------------------------------------------

const COLOR = {
  MARCA: '#DF1630',
  MARCA_SUAVE: '#FDECEE',
  TINTA: '#303133',
  LINEA: '#EAEAEA',
};

/** Crea (o completa) las hojas, formatos, validaciones y la carpeta de fotos. No borra datos. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(ZONA_HORARIA);

  // Configuracion
  const shCfg = asegurarHoja_(ss, HOJA.CONFIG, ['clave', 'valor', 'descripcion']);
  const existentes = {};
  filasComoObjetos_(shCfg).forEach(function (f) { if (f.clave) existentes[String(f.clave).trim()] = f._fila; });
  configuracionPorDefecto_().forEach(function (fila) {
    if (!existentes[fila[0]]) shCfg.appendRow(fila);
  });
  shCfg.setColumnWidth(1, 210);
  shCfg.setColumnWidth(2, 200);
  shCfg.setColumnWidth(3, 520);
  const siNo = SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO'], true).setAllowInvalid(false).build();
  filasComoObjetos_(shCfg).forEach(function (f) {
    const clave = String(f.clave || '').trim();
    const celda = shCfg.getRange(f._fila, 2);
    if (['concurso_abierto', 'contar_solo_aprobadas', 'mostrar_ranking_publico'].indexOf(clave) > -1) celda.setDataValidation(siNo);
    if (clave.indexOf('fecha_') === 0) celda.setNumberFormat('dd/mm/yyyy');
    if (clave === 'carpeta_fotos_id' || clave === 'semana_ranking' || clave === 'token_api') celda.setNumberFormat('@');
  });

  // Usuarios
  const shU = asegurarHoja_(ss, HOJA.USUARIOS, COLUMNAS_USUARIOS);
  formatoColumnas_(shU, COLUMNAS_USUARIOS, {
    cedula: '@', telefono: '@', password_hash: '@', salt: '@',
    fecha_registro: 'dd/mm/yyyy hh:mm', bloqueado_hasta: 'dd/mm/yyyy hh:mm',
  });
  validacionColumna_(shU, COLUMNAS_USUARIOS, 'estado', [ESTADO_USUARIO.ACTIVO, ESTADO_USUARIO.BLOQUEADO]);

  // Registros
  const shR = asegurarHoja_(ss, HOJA.REGISTROS, COLUMNAS_REGISTROS);
  formatoColumnas_(shR, COLUMNAS_REGISTROS, {
    id: '@', cedula: '@', numero_factura: '@',
    fecha_carga: 'dd/mm/yyyy hh:mm', dia_venta: 'dd/mm/yyyy',
    monto: '#,##0.00', m2_austral: '#,##0.00',
  });
  validacionColumna_(shR, COLUMNAS_REGISTROS, 'estado', [ESTADO.PENDIENTE, ESTADO.APROBADA, ESTADO.RECHAZADA]);
  validacionColumna_(shR, COLUMNAS_REGISTROS, 'vendio_austral', ['SI', 'NO']);
  colorearEstados_(shR, COLUMNAS_REGISTROS.indexOf('estado') + 1);

  asegurarHoja_(ss, HOJA.RANKING, null);

  // Orden de pestañas
  [HOJA.CONFIG, HOJA.REGISTROS, HOJA.USUARIOS, HOJA.RANKING].forEach(function (nombre, i) {
    ss.setActiveSheet(ss.getSheetByName(nombre));
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(shCfg);

  MEMO_ = {};
  invalidarTabla_(HOJA.CONFIG);
  carpetaFotos_(leerConfig_());
  invalidarTabla_(HOJA.CONFIG);
  recalcularRankings_();
  avisar_('Copa Prosein lista', 'Hojas creadas. Revisa las fechas en Configuracion y luego despliega la aplicación web.');
}

function asegurarHoja_(ss, nombre, encabezados) {
  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);
  if (encabezados) {
    const actuales = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    const faltan = encabezados.filter(function (h) { return actuales.indexOf(h) === -1; });
    if (!actuales.filter(String).length) {
      sh.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    } else if (faltan.length) {
      sh.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan]);
    }
    const ancho = Math.max(encabezados.length, sh.getLastColumn());
    sh.getRange(1, 1, 1, ancho).setFontWeight('bold').setBackground(COLOR.MARCA).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function formatoColumnas_(sh, columnas, formatos) {
  const filas = Math.max(sh.getMaxRows() - 1, 1);
  Object.keys(formatos).forEach(function (col) {
    const i = columnas.indexOf(col);
    if (i > -1) sh.getRange(2, i + 1, filas, 1).setNumberFormat(formatos[col]);
  });
}

function validacionColumna_(sh, columnas, col, lista) {
  const i = columnas.indexOf(col);
  if (i === -1) return;
  const regla = SpreadsheetApp.newDataValidation().requireValueInList(lista, true).setAllowInvalid(false).build();
  sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(regla);
}

function colorearEstados_(sh, columna) {
  const rango = sh.getRange(2, columna, Math.max(sh.getMaxRows() - 1, 1), 1);
  const regla = function (texto, fondo, tinta) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(texto).setBackground(fondo).setFontColor(tinta).setRanges([rango]).build();
  };
  sh.setConditionalFormatRules([
    regla(ESTADO.APROBADA, '#E7F5EC', '#17663A'),
    regla(ESTADO.RECHAZADA, '#FDECEE', '#A3122A'),
    regla(ESTADO.PENDIENTE, '#FFF4DE', '#8A5300'),
  ]);
}

function escribirConfig_(clave, valor) {
  const sh = hoja_(HOJA.CONFIG);
  const fila = filasComoObjetos_(sh).filter(function (f) { return String(f.clave).trim() === clave; })[0];
  if (fila) sh.getRange(fila._fila, 2).setValue(valor);
  else sh.appendRow([clave, valor, '']);
  invalidarTabla_(HOJA.CONFIG);
}

function avisar_(titulo, mensaje) {
  try {
    SpreadsheetApp.getUi().alert(titulo, mensaje, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    console.log(titulo + ': ' + mensaje);
  }
}

// ------------------------------------------------------------
// Menú "Copa Prosein" en el Sheet
// ------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Copa Prosein')
    .addItem('Inicializar hojas', 'setup')
    .addItem('Recalcular rankings', 'menuRecalcularRankings')
    .addItem('Generar cupones para sorteo', 'menuGenerarCupones')
    .addSeparator()
    .addItem('Ganadores semanales (elegir semana)', 'menuGanadoresSemanales')
    .addItem('Ganador Austral', 'menuGanadorAustral')
    .addSeparator()
    .addItem('Cargar datos de prueba', 'menuCargarDatosPrueba')
    .addItem('Borrar datos de prueba', 'menuBorrarDatosPrueba')
    .addToUi();
}

function menuRecalcularRankings() {
  MEMO_ = {};
  invalidarTabla_(HOJA.REGISTROS);
  invalidarTabla_(HOJA.USUARIOS);
  invalidarTabla_(HOJA.CONFIG);
  const r = recalcularRankings_();
  SpreadsheetApp.getActiveSpreadsheet().toast(r.vendedores + ' vendedores con ventas · ' + r.cupones + ' cupones en total.', 'Rankings actualizados', 6);
}

function menuGenerarCupones() {
  MEMO_ = {};
  invalidarTabla_(HOJA.REGISTROS);
  const r = recalcularRankings_();
  const sh = hoja_(HOJA.RANKING);
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
  sh.getRange(3, r.columnaCupones).activate();
  avisar_('Cupones para el sorteo', 'Se generaron ' + r.cupones + ' cupones numerados (columna "Cupones para sorteo" de la hoja Ranking). Cada cupón es una participación.');
}

function menuGanadoresSemanales() {
  const ui = SpreadsheetApp.getUi();
  MEMO_ = {};
  invalidarTabla_(HOJA.REGISTROS);
  const cfg = leerConfig_();
  const total = totalSemanas_(cfg);
  const actual = semanaActual_(cfg).numero || 1;
  const resp = ui.prompt('Ganadores semanales', 'Número de semana (1 a ' + total + '). Déjalo vacío para la semana ' + actual + '.', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const texto = resp.getResponseText().trim();
  const semana = texto ? parseInt(texto, 10) : actual;
  if (!(semana >= 1 && semana <= total)) {
    ui.alert('Semana inválida', 'Escribe un número entre 1 y ' + total + '.', ui.ButtonSet.OK);
    return;
  }
  escribirConfig_('semana_ranking', String(semana));
  recalcularRankings_();
  const g = ganadoresSemana(semana);
  const rango = rangoSemana_(semana, cfg);
  let mensaje = 'Semana ' + semana + ' (' + fechaCorta_(rango.inicio) + ' al ' + fechaCorta_(rango.fin) + ')\n\n';
  if (!g.ganadores.length) mensaje += 'Nadie completó cupones esta semana.';
  g.ganadores.forEach(function (x, i) {
    mensaje += (i + 1) + '. ' + x.nombre + ' (C.I. ' + x.cedula + ') · ' + x.cupones + (x.cupones === 1 ? ' cupón' : ' cupones') + ' · $' + x.monto.toFixed(2) + '\n';
  });
  if (g.empateEnCorte) mensaje += '\nAtención: hay empate exacto en el último puesto premiado. Revisa la hoja Ranking.';
  ui.alert('Ganadores semanales', mensaje, ui.ButtonSet.OK);
}

/** Ganadores de una semana (también sirve para usarla desde otras funciones). */
function ganadoresSemana(semana) {
  const cfg = leerConfig_();
  const stats = calcularEstadisticas_(leerRegistros_(), cfg);
  const nombres = mapaNombres_(leerUsuarios_());
  const lista = rankingSemana_(stats, semana);
  const n = cfg.premios_semanales;
  const ganadores = lista.slice(0, n).map(function (x) {
    return { cedula: x.v.cedula, nombre: nombres[x.v.cedula] || '', cupones: x.s.cupones, monto: x.s.montoCentavos / 100 };
  });
  const corte = lista[n - 1];
  const siguiente = lista[n];
  const empateEnCorte = !!(corte && siguiente && corte.s.cupones === siguiente.s.cupones && corte.s.montoCentavos === siguiente.s.montoCentavos && corte.s.acumuladoFinCentavos === siguiente.s.acumuladoFinCentavos);
  return { ganadores: ganadores, empateEnCorte: empateEnCorte };
}

function menuGanadorAustral() {
  MEMO_ = {};
  invalidarTabla_(HOJA.REGISTROS);
  const cfg = leerConfig_();
  const stats = calcularEstadisticas_(leerRegistros_(), cfg);
  const nombres = mapaNombres_(leerUsuarios_());
  const lista = rankingAustral_(stats).slice(0, 5);
  let mensaje = lista.length ? '' : 'Todavía no hay ventas Austral registradas.';
  lista.forEach(function (v, i) {
    mensaje += (i === 0 ? '🏆 ' : (i + 1) + '. ') + (nombres[v.cedula] || '') + ' (C.I. ' + v.cedula + ') · ' + (v.m2Centesimas / 100).toFixed(2) + ' m² · $' + (v.totalCentavos / 100).toFixed(2) + ' vendidos\n';
  });
  SpreadsheetApp.getUi().alert('Premio mayor · Austral (viaje para dos)', mensaje, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Escribe la hoja Ranking: general, Austral, semana seleccionada y cupones para sorteo. */
function recalcularRankings_() {
  const cfg = leerConfig_();
  const stats = calcularEstadisticas_(leerRegistros_(), cfg);
  const usuarios = leerUsuarios_();
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const nombre = function (c) { return porCedula[c] ? nombreCorto_(porCedula[c]) : ''; };
  const sucursal = function (c) { return porCedula[c] ? porCedula[c].sucursal : ''; };

  const total = totalSemanas_(cfg);
  let semana = cfg.semana_ranking && cfg.semana_ranking <= total ? cfg.semana_ranking : semanaActual_(cfg).numero;
  if (!semana && total) semana = 1;
  const rango = semana ? rangoSemana_(semana, cfg) : null;

  const bloques = [];
  bloques.push({
    titulo: 'Ranking general (cupones acumulados)',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'Sucursal', 'Total vendido', 'Cupones', 'm² Austral'],
    filas: rankingGeneral_(stats).map(function (v, i) {
      return [i + 1, v.cedula, nombre(v.cedula), sucursal(v.cedula), v.totalCentavos / 100, v.cupones, v.m2Centesimas / 100];
    }),
    formatos: { 4: '#,##0.00', 6: '#,##0.00' },
  });
  bloques.push({
    titulo: 'Premio mayor · Austral (m²)',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'm² Austral', 'Total vendido'],
    filas: rankingAustral_(stats).map(function (v, i) {
      return [i + 1, v.cedula, nombre(v.cedula), v.m2Centesimas / 100, v.totalCentavos / 100];
    }),
    formatos: { 3: '#,##0.00', 4: '#,##0.00' },
  });
  bloques.push({
    titulo: semana ? 'Semana ' + semana + ' (' + fechaCorta_(rango.inicio) + ' al ' + fechaCorta_(rango.fin) + ')' : 'Semana',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'Cupones semana', 'Vendido semana', 'Premio'],
    filas: semana ? rankingSemana_(stats, semana).map(function (x, i) {
      return [i + 1, x.v.cedula, nombre(x.v.cedula), x.s.cupones, x.s.montoCentavos / 100, i < cfg.premios_semanales ? 'Premio semanal' : ''];
    }) : [],
    formatos: { 4: '#,##0.00' },
  });
  const cupones = cuponesParaSorteo_(stats);
  bloques.push({
    titulo: 'Cupones para sorteo',
    encabezados: ['Cupón', 'Cédula', 'Vendedor', 'Día de venta', 'Factura'],
    filas: cupones.map(function (c) {
      return ['Cupón ' + ('000' + c.numero).slice(-Math.max(4, String(cupones.length).length)), c.cedula, nombre(c.cedula), fechaCorta_(c.cupon.diaVenta), c.cupon.factura];
    }),
    formatos: {},
  });

  const sh = hoja_(HOJA.RANKING);
  sh.clear();
  sh.getRange(1, 1).setValue('Copa Prosein · Rankings — actualizado ' + Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'))
    .setFontWeight('bold').setFontSize(12);

  let columna = 1;
  let columnaCupones = 1;
  bloques.forEach(function (b) {
    const ancho = b.encabezados.length;
    if (b.titulo === 'Cupones para sorteo') columnaCupones = columna;
    sh.getRange(2, columna).setValue(b.titulo).setFontWeight('bold').setFontColor(COLOR.MARCA);
    sh.getRange(3, columna, 1, ancho).setValues([b.encabezados]).setFontWeight('bold').setBackground(COLOR.MARCA_SUAVE).setFontColor(COLOR.TINTA);
    if (b.filas.length) {
      // Formatos antes que valores: así la cédula queda como texto.
      sh.getRange(4, columna + 1, b.filas.length, 1).setNumberFormat('@');
      Object.keys(b.formatos).forEach(function (off) {
        sh.getRange(4, columna + Number(off), b.filas.length, 1).setNumberFormat(b.formatos[off]);
      });
      sh.getRange(4, columna, b.filas.length, ancho).setValues(b.filas.map(function (f) { return f.map(protegerCelda_); }));
    } else {
      sh.getRange(4, columna).setValue('Sin datos todavía');
    }
    columna += ancho + 1;
  });
  sh.setFrozenRows(3);

  return { vendedores: rankingGeneral_(stats).length, cupones: cupones.length, columnaCupones: columnaCupones };
}

// ------------------------------------------------------------
// Datos de prueba (para verificar rankings antes del lanzamiento)
// ------------------------------------------------------------

function menuCargarDatosPrueba() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Datos de prueba', 'Se crearán 8 vendedores de prueba (cédulas 90000001 a 90000008, contraseña "prueba123") con ventas en las primeras semanas. ¿Continuar?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  const n = cargarDatosPrueba_();
  menuRecalcularRankings();
  avisar_('Datos de prueba', 'Listo: ' + n + ' ventas de prueba. Puedes borrarlas con "Borrar datos de prueba".');
}

function cargarDatosPrueba_() {
  const cfg = leerConfig_();
  const nombres = [
    ['María', 'Pérez'], ['José', 'Rodríguez'], ['Ana', 'González'], ['Luis', 'Hernández'],
    ['Carla', 'Martínez'], ['Pedro', 'López'], ['Daniela', 'Díaz'], ['Jorge', 'Ramírez'],
  ];
  // Generador pseudoaleatorio fijo: siempre los mismos datos.
  let semilla = 42;
  const azar = function () { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };

  return conBloqueo_(function () {
    const shU = hoja_(HOJA.USUARIOS);
    const existentes = leerUsuarios_({ fresco: true });
    nombres.forEach(function (n, i) {
      const cedula = String(90000001 + i);
      if (buscarUsuario_(existentes, cedula)) return;
      const salt = generarSalt_();
      const fila = {
        cedula: cedula, nombre: n[0], apellido: n[1], telefono: '0414000000' + i, sucursal_o_zona: SUCURSAL_PRUEBA,
        password_hash: hashClave_('prueba123', salt), salt: salt, fecha_registro: new Date(),
        estado: ESTADO_USUARIO.ACTIVO, intentos_fallidos: 0, bloqueado_hasta: '',
      };
      shU.appendRow(COLUMNAS_USUARIOS.map(function (c) { return fila[c]; }));
    });
    invalidarTabla_(HOJA.USUARIOS);

    const registros = leerRegistros_({ fresco: true });
    const hoy = hoyISO_();
    const ultimoDia = hoy < cfg.fecha_fin ? hoy : cfg.fecha_fin;
    const dias = Math.max(0, diasEntre_(cfg.fecha_inicio, ultimoDia));
    const filas = [];
    let siguiente = Number((siguienteId_(registros).match(/(\d+)$/) || [0, 1])[1]);
    nombres.forEach(function (n, i) {
      const cedula = String(90000001 + i);
      const ventas = 3 + Math.floor(azar() * 6);
      for (let k = 0; k < ventas; k++) {
        const dia = sumarDias_(cfg.fecha_inicio, Math.floor(azar() * (dias + 1)));
        const monto = Math.round((300 + azar() * 2700) * 100);
        const austral = azar() < 0.4;
        filas.push(filaRegistro_({
          id: 'CP-' + ('00000' + siguiente++).slice(-6),
          fechaCarga: Date.now() - Math.floor(azar() * 86400000),
          cedula: cedula, nombre: n[0] + ' ' + n[1], diaVenta: dia,
          factura: 'P' + cedula.slice(-2) + '-' + (1000 + k), facturaNorm: '',
          montoCentavos: monto, austral: austral, m2Centesimas: austral ? Math.round((10 + azar() * 140) * 100) : 0,
          urlFoto: '', estado: azar() < 0.85 ? ESTADO.APROBADA : ESTADO.PENDIENTE, nota: NOTA_PRUEBA,
        }));
      }
    });
    if (filas.length) {
      const sh = hoja_(HOJA.REGISTROS);
      sh.getRange(sh.getLastRow() + 1, 1, filas.length, COLUMNAS_REGISTROS.length).setValues(filas);
    }
    invalidarTabla_(HOJA.REGISTROS);
    return filas.length;
  });
}

function menuBorrarDatosPrueba() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Borrar datos de prueba', 'Se borrarán las ventas con nota "' + NOTA_PRUEBA + '" y los vendedores de la sucursal "' + SUCURSAL_PRUEBA + '". ¿Continuar?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  const n = borrarDatosPrueba_();
  menuRecalcularRankings();
  avisar_('Datos de prueba', 'Se borraron ' + n.ventas + ' ventas y ' + n.usuarios + ' vendedores de prueba.');
}

function borrarDatosPrueba_() {
  return conBloqueo_(function () {
    const borrar = function (nombre, condicion) {
      const sh = hoja_(nombre);
      const filas = filasComoObjetos_(sh).filter(condicion).map(function (f) { return f._fila; });
      filas.sort(function (a, b) { return b - a; }).forEach(function (f) { sh.deleteRow(f); });
      invalidarTabla_(nombre);
      return filas.length;
    };
    return {
      ventas: borrar(HOJA.REGISTROS, function (f) { return String(f.nota_admin).trim() === NOTA_PRUEBA; }),
      usuarios: borrar(HOJA.USUARIOS, function (f) { return String(f.sucursal_o_zona).trim() === SUCURSAL_PRUEBA; }),
    };
  });
}
