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
 *  los cupones, las semanas y las categorías se ajustan solos.
 *
 *  Reglas (todas editables en la hoja Configuracion):
 *    - 1 cupón por cada monto_por_cupon vendido (acumulado, el sobrante no se pierde).
 *    - 1 cupón del viaje por cada m2_por_cupon_austral de Austral (acumulado).
 *    - Semanas y cortes en la hoja Periodos. Premios semanales: los que más
 *      cupones completan en la semana.
 *    - Al cierre, 3 categorías según los cupones. Cada categoría sortea sus
 *      premios con sus cupones; el viaje se sortea con cupones Austral entre
 *      las categorías permitidas (viaje_hasta_categoria).
 */

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

const ZONA_HORARIA = 'America/Caracas';

const HOJA = {
  CONFIG: 'Configuracion',
  PERIODOS: 'Periodos',
  USUARIOS: 'Usuarios',
  REGISTROS: 'Registros',
  RANKING: 'Ranking',
};

const COLUMNAS_USUARIOS = [
  'cedula', 'nombre', 'apellido', 'telefono', 'sucursal_o_zona',
  'password_hash', 'salt', 'fecha_registro', 'estado',
  'intentos_fallidos', 'bloqueado_hasta', 'rol',
];

const COLUMNAS_REGISTROS = [
  'id', 'fecha_carga', 'cedula', 'nombre', 'dia_venta', 'numero_factura',
  'monto', 'vendio_austral', 'm2_austral', 'url_foto', 'estado', 'nota_admin',
];

const COLUMNAS_PERIODOS = ['semana', 'inicio', 'fin', 'corte', 'entrega'];

const ESTADO = { PENDIENTE: 'Pendiente', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' };
const ESTADO_USUARIO = { ACTIVO: 'activo', BLOQUEADO: 'bloqueado' };
const ROL = { VENDEDOR: 'vendedor', ADMIN: 'admin' };

const SUCURSALES_POR_DEFECTO = [
  'Boleíta', 'La Castellana', 'Los Naranjos', 'El Bosque', 'Las Mercedes',
  'San Martín', 'Maracaibo', 'Acarigua', 'Barquisimeto',
];

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
const CEDULA_PRUEBA_DESDE = 90000001;
const CANTIDAD_PRUEBA = 8;

/** Filas por defecto de la hoja Configuracion: [clave, valor, descripción]. */
function configuracionPorDefecto_() {
  return [
    ['nombre_concurso', 'Copa Prosein', 'Nombre visible en el portal.'],
    ['fecha_inicio', fechaDesdeISO_('2026-10-15'), 'Primer día del concurso. Con num_semanas, dias_por_semana y hora_corte se arma la hoja Periodos (menú Copa Prosein → Generar periodos).'],
    ['num_semanas', 10, 'Cantidad de semanas (cortes) del concurso.'],
    ['dias_por_semana', 7, 'Días de ventas de cada semana. Empezando un jueves: de jueves a miércoles.'],
    ['hora_corte', "'15:00", 'Hora del corte, el día siguiente al último día de la semana (formato 24 h). Hasta esa hora se cargan las ventas de la semana.'],
    ['texto_entrega', 'en la mañana', 'Texto que acompaña la fecha de entrega de premios en el portal.'],
    ['bloquear_semanas_cerradas', 'SI', 'SI = después del corte ya no se cargan ventas con fecha de esa semana.'],
    ['fecha_sorteo', '', 'Fecha del sorteo final (informativa). Vacío = por definir.'],
    ['monto_por_cupon', 1500, 'Monto (USD) que completa 1 cupón.'],
    ['premios_semanales', 6, 'Ganadores por semana (los que más cupones completan).'],
    ['m2_por_cupon_austral', 100, 'm² de Austral que completan 1 cupón para el sorteo del viaje.'],
    ['sucursales', SUCURSALES_POR_DEFECTO.join(', '), 'Tiendas que el vendedor elige al registrarse, separadas por coma.'],
    ['categorias_modo', 'porcentaje', 'porcentaje = por posición en cupones (ver categoria_N_porcentaje). cupones = por cupones mínimos (ver categoria_N_min_cupones).'],
    ['categoria_1_nombre', 'Oro', 'Categoría de los que más cupones tienen.'],
    ['categoria_2_nombre', 'Plata', 'Categoría del medio.'],
    ['categoria_3_nombre', 'Bronce', 'Categoría de los que menos cupones tienen.'],
    ['categoria_1_porcentaje', 20, 'Modo porcentaje: % de vendedores con cupones que entran en la categoría 1 (los primeros del ranking). Empates en el límite suben.'],
    ['categoria_2_porcentaje', 30, 'Modo porcentaje: % siguiente para la categoría 2. El resto queda en la categoría 3.'],
    ['categoria_1_min_cupones', 30, 'Modo cupones: cupones mínimos para la categoría 1.'],
    ['categoria_2_min_cupones', 10, 'Modo cupones: cupones mínimos para la categoría 2. Con menos (y al menos 1): categoría 3.'],
    ['premios_categoria_1', 2, 'Premios que se sortean con los cupones de la categoría 1.'],
    ['premios_categoria_2', 1, 'Premios que se sortean con los cupones de la categoría 2.'],
    ['premios_categoria_3', 1, 'Premios que se sortean con los cupones de la categoría 3.'],
    ['premios_viaje', 1, 'Viajes todo incluido para dos que se sortean con los cupones Austral.'],
    ['viaje_hasta_categoria', 1, 'Categorías que entran al sorteo del viaje: 1 = solo la categoría 1; 2 = categorías 1 y 2.'],
    ['moneda', 'USD', 'Moneda de los montos.'],
    ['concurso_abierto', 'SI', 'SI = los vendedores pueden cargar ventas.'],
    ['contar_solo_aprobadas', 'NO', 'SI = solo cuentan facturas Aprobadas. NO = cuentan todas menos las Rechazadas.'],
    ['mostrar_ranking_publico', 'SI', 'SI = los vendedores ven el top 10 (sin cédulas).'],
    ['carpeta_fotos_id', '', 'Carpeta de Drive para las fotos. setup() la crea si está vacía.'],
    ['semana_ranking', '', 'Semana que muestra la hoja Ranking. Vacío = semana en juego.'],
    ['dias_sesion', 7, 'Días que dura una sesión antes de pedir login otra vez.'],
    ['monto_maximo_venta', 100000, 'Tope por factura para atajar errores de tipeo.'],
    ['token_api', 'copaprosein', 'Clave que el portal envía en cada solicitud (API_TOKEN en web/config.js). Si la cambias aquí, cámbiala también allá. Vacío = sin clave.'],
  ];
}

/** Claves de versiones anteriores que ya no se usan (setup() lo indica en la descripción). */
const CLAVES_OBSOLETAS = {
  fecha_fin: 'YA NO SE USA: el último día de ventas sale de la hoja Periodos.',
};

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
  setSucursal: apiDefinirSucursal_,
  getDashboard: apiDashboard_,
  addSale: apiAgregarVenta_,
  getRanking: apiRanking_,
  getPhoto: apiFoto_,
  adminResumen: apiAdminResumen_,
  adminVendedores: apiAdminVendedores_,
  adminVentas: apiAdminVentas_,
  adminSemana: apiAdminSemana_,
  adminCupones: apiAdminCupones_,
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
// Endpoints del vendedor
// ------------------------------------------------------------

function apiConfig_() {
  return ok_(configPublica_(leerConfig_()));
}

function apiRegistro_(req) {
  const cfg = leerConfig_();
  const cedula = validarCedula_(req.cedula);
  const nombre = validarNombre_(req.nombre, 'nombre', 'Escribe tu nombre.');
  const apellido = validarNombre_(req.apellido, 'apellido', 'Escribe tu apellido.');
  const telefono = validarTelefono_(req.telefono);
  const sucursal = validarSucursal_(req.sucursal, cfg);
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
      rol: ROL.VENDEDOR,
    };
    escribirFilaUsuario_(fila);
  });

  const sesion = crearSesion_(cedula, cfg);
  const usuario = { cedula: cedula, nombre: nombre, apellido: apellido, sucursal: sucursal, rol: ROL.VENDEDOR };
  return ok_({ token: sesion.token, expira: sesion.expira, usuario: usuarioPublico_(usuario, cfg) });
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
      throw errorApi_('RESET_REQUIRED', 'Tu cuenta necesita una contraseña nueva. Defínela para entrar.');
    }
    if (!verificarClave_(clave, u.salt, u.hash)) {
      registrarIntentoFallido_(u);
    }
    if (u.intentos > 0 || u.bloqueadoHasta) reiniciarIntentos_(u);
    return u;
  });

  const cfg = leerConfig_();
  const sesion = crearSesion_(cedula, cfg);
  return ok_({ token: sesion.token, expira: sesion.expira, usuario: usuarioPublico_(resultado, cfg) });
}

/**
 * Primera contraseña u "olvidé mi contraseña": la celda password_hash está vacía
 * (el admin la borró, o es una cuenta creada a mano). El usuario confirma su
 * teléfono registrado y define una nueva.
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
  return ok_({ token: sesion.token, expira: sesion.expira, usuario: usuarioPublico_(resultado, cfg) });
}

function apiLogout_(req) {
  if (typeof req.token === 'string' && req.token) {
    PropertiesService.getScriptProperties().deleteProperty(claveSesion_(req.token));
  }
  return ok_({ cerrada: true });
}

/** Para cuentas sin tienda válida (creadas antes de que fuera obligatoria). */
function apiDefinirSucursal_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  if (usuario.rol === ROL.ADMIN) throw errorApi_('FORBIDDEN', 'Las cuentas de administrador no tienen tienda.');
  const sucursal = validarSucursal_(req.sucursal, cfg);
  const actual = sucursalCanonica_(usuario.sucursal, cfg);
  if (actual && actual !== sucursal) {
    throw errorApi_('FORBIDDEN', 'Tu tienda ya está registrada (' + actual + '). Si cambiaste de tienda, habla con el coordinador.');
  }
  conBloqueo_(function () {
    const u = buscarUsuario_(leerUsuarios_({ fresco: true }), usuario.cedula);
    const sh = hoja_(HOJA.USUARIOS);
    sh.getRange(u.fila, mapaColumnas_(sh).sucursal_o_zona).setValue(sucursal);
    invalidarTabla_(HOJA.USUARIOS);
  });
  usuario.sucursal = sucursal;
  return ok_({ usuario: usuarioPublico_(usuario, cfg) });
}

function apiDashboard_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  const registros = leerRegistros_();
  const usuarios = leerUsuarios_();
  const stats = calcularEstadisticas_(registros, cfg);
  const cats = calcularCategorias_(stats, cfg);
  const semana = semanaActual_(cfg);
  const yo = stats.vendedores[usuario.cedula] || vendedorVacio_(usuario.cedula);
  const M = cfg.monto_por_cupon_centavos;
  const MA = cfg.m2_por_cupon_austral_centesimas;

  const propios = registros.filter(function (r) { return r.cedula === usuario.cedula; });
  propios.sort(function (a, b) {
    if (a.diaVenta !== b.diaVenta) return a.diaVenta < b.diaVenta ? 1 : -1;
    return b.fechaCarga - a.fechaCarga;
  });
  const pendientes = propios.filter(function (r) { return r.estado === ESTADO.PENDIENTE; });

  const s = semana.numero ? yo.semanas[semana.numero] : null;
  const miCategoria = cats.porCedula[usuario.cedula] || null;
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
    categoria: categoriaPublica_(miCategoria, yo, cats, cfg, semana),
    austral: {
      m2: yo.m2Centesimas / 100,
      cupones: yo.cuponesAustral,
      m2_por_cupon: cfg.m2_por_cupon_austral,
      sobrante: yo.sobranteM2Centesimas / 100,
      falta: (MA - yo.sobranteM2Centesimas) / 100,
      progreso: MA ? yo.sobranteM2Centesimas / MA : 0,
      participa: !!(miCategoria && miCategoria.id <= cfg.viaje_hasta_categoria),
    },
  };

  let ranking = null;
  if (cfg.mostrar_ranking_publico) {
    ranking = rankingPublico_(stats, usuarios, cfg, semana.numero, usuario.cedula);
    if (ranking.semana && ranking.semana.mi_posicion) resumen.semana.posicion = ranking.semana.mi_posicion;
  }

  return ok_({
    usuario: usuarioPublico_(usuario, cfg),
    concurso: configPublica_(cfg),
    resumen: resumen,
    cupones: yo.detalleCupones.map(function (c) { return cuponPublico_(c, cfg); }),
    cupones_austral: yo.detalleAustral.map(function (c) { return cuponAustralPublico_(c, cfg); }),
    registros: propios.map(registroPublico_),
    ranking: ranking,
  });
}

function apiAgregarVenta_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  if (usuario.rol === ROL.ADMIN) throw errorApi_('FORBIDDEN', 'Las cuentas de administrador no registran ventas.');
  if (!cfg.concurso_abierto) {
    throw errorApi_('CLOSED', 'La carga de ventas está cerrada en este momento.');
  }
  if (!sucursalCanonica_(usuario.sucursal, cfg)) {
    throw errorApi_('NEED_SUCURSAL', 'Elige tu tienda antes de registrar ventas.');
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
  const MA = cfg.m2_por_cupon_austral_centesimas;
  const s = semana.numero ? despues.semanas[semana.numero] : null;

  return ok_({
    registro: registroPublico_(nuevo),
    pendiente_aprobacion: cfg.contar_solo_aprobadas,
    cupones_antes: antes.cupones,
    cupones_despues: despues.cupones,
    cupones_nuevos: Math.max(0, despues.cupones - antes.cupones),
    nuevos_cupones: despues.detalleCupones.slice(antes.cupones).map(function (c) { return cuponPublico_(c, cfg); }),
    acumulado: centavosADolares_(despues.totalCentavos),
    sobrante: centavosADolares_(despues.sobranteCentavos),
    sobrante_antes: centavosADolares_(antes.sobranteCentavos),
    falta_para_proximo: centavosADolares_(M - despues.sobranteCentavos),
    monto_por_cupon: centavosADolares_(M),
    cupones_semana_actual: s ? s.cupones : 0,
    m2_total: despues.m2Centesimas / 100,
    austral_antes: antes.cuponesAustral,
    austral_despues: despues.cuponesAustral,
    austral_nuevos: Math.max(0, despues.cuponesAustral - antes.cuponesAustral),
    nuevos_cupones_austral: despues.detalleAustral.slice(antes.cuponesAustral).map(function (c) { return cuponAustralPublico_(c, cfg); }),
    m2_sobrante: despues.sobranteM2Centesimas / 100,
    m2_sobrante_antes: antes.sobranteM2Centesimas / 100,
    m2_falta: (MA - despues.sobranteM2Centesimas) / 100,
    m2_por_cupon: cfg.m2_por_cupon_austral,
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

/** Foto de una factura: el vendedor ve las suyas; el administrador, todas. */
function apiFoto_(req) {
  const usuario = requerirUsuario_(req.token);
  const id = String(req.id || '');
  const r = leerRegistros_().filter(function (x) { return x.id === id; })[0];
  if (!r || (r.cedula !== usuario.cedula && usuario.rol !== ROL.ADMIN)) throw errorApi_('NOT_FOUND', 'No encontramos esa factura.');
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
// Endpoints del administrador (solo lectura: auditar e imprimir)
// ------------------------------------------------------------

function requerirAdmin_(token) {
  const u = requerirUsuario_(token);
  if (u.rol !== ROL.ADMIN) throw errorApi_('FORBIDDEN', 'Esta sección es solo para administradores.');
  return u;
}

/** Datos que comparten todas las vistas del administrador. */
function contextoAdmin_() {
  const cfg = leerConfig_();
  const registros = leerRegistros_();
  const usuarios = leerUsuarios_();
  const stats = calcularEstadisticas_(registros, cfg);
  const cats = calcularCategorias_(stats, cfg);
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  return { cfg: cfg, registros: registros, usuarios: usuarios, stats: stats, cats: cats, porCedula: porCedula };
}

function apiAdminResumen_(req) {
  requerirAdmin_(req.token);
  const x = contextoAdmin_();
  const cfg = x.cfg;
  const vendedores = valores_(x.stats.vendedores);
  const suma = function (lista, fn) { return lista.reduce(function (t, v) { return t + fn(v); }, 0); };
  const cuentan = x.registros.filter(function (r) { return registroCuenta_(r, cfg); });
  const porEstado = function (e) { return x.registros.filter(function (r) { return r.estado === e; }).length; };

  const totales = {
    vendedores_registrados: x.usuarios.filter(function (u) { return u.rol !== ROL.ADMIN; }).length,
    vendedores_con_ventas: vendedores.filter(function (v) { return v.totalCentavos > 0; }).length,
    ventas: x.registros.length,
    pendientes: porEstado(ESTADO.PENDIENTE),
    aprobadas: porEstado(ESTADO.APROBADA),
    rechazadas: porEstado(ESTADO.RECHAZADA),
    monto: centavosADolares_(suma(cuentan, function (r) { return r.montoCentavos; })),
    cupones: suma(vendedores, function (v) { return v.cupones; }),
    m2: suma(vendedores, function (v) { return v.m2Centesimas; }) / 100,
    cupones_austral: suma(vendedores, function (v) { return v.cuponesAustral; }),
  };

  const tiendas = {};
  const tienda = function (nombre) {
    return tiendas[nombre] || (tiendas[nombre] = { nombre: nombre, vendedores: 0, ventas: 0, monto: 0, cupones: 0, m2: 0 });
  };
  cfg.sucursales.forEach(tienda);
  x.usuarios.forEach(function (u) {
    if (u.rol === ROL.ADMIN) return;
    tienda(sucursalCanonica_(u.sucursal, cfg) || 'Sin tienda').vendedores++;
  });
  cuentan.forEach(function (r) {
    const u = x.porCedula[r.cedula];
    const t = tienda((u && sucursalCanonica_(u.sucursal, cfg)) || 'Sin tienda');
    t.ventas++;
    t.monto += r.montoCentavos;
    t.m2 += r.m2Centesimas;
  });
  vendedores.forEach(function (v) {
    const u = x.porCedula[v.cedula];
    tienda((u && sucursalCanonica_(u.sucursal, cfg)) || 'Sin tienda').cupones += v.cupones;
  });

  const ahora = ahora_();
  const actual = semanaActual_(cfg);
  const urnas = armarUrnas_(x.stats, x.cats, x.usuarios, cfg);

  return ok_({
    concurso: configPublica_(cfg),
    totales: totales,
    sucursales: valores_(tiendas).map(function (t) {
      return { nombre: t.nombre, vendedores: t.vendedores, ventas: t.ventas, monto: centavosADolares_(t.monto), cupones: t.cupones, m2: t.m2 / 100 };
    }).filter(function (t) { return t.nombre !== 'Sin tienda' || t.vendedores || t.ventas; }),
    categorias: x.cats.resumen,
    urnas: urnas.map(resumenUrna_),
    periodos: cfg.periodos.map(function (p) {
      const lista = rankingSemana_(x.stats, p.numero);
      return {
        numero: p.numero, inicio: p.inicio, fin: p.fin, corte: p.corte, entrega: p.entrega,
        estado: p.corte <= ahora ? 'cerrada' : (p.numero === actual.numero ? 'en_juego' : 'pendiente'),
        participantes: lista.length,
        cupones: suma(lista, function (y) { return y.s.cupones; }),
      };
    }),
  });
}

function apiAdminVendedores_(req) {
  requerirAdmin_(req.token);
  const x = contextoAdmin_();
  const ventasPor = {};
  x.registros.forEach(function (r) {
    const v = ventasPor[r.cedula] || (ventasPor[r.cedula] = { ventas: 0, pendientes: 0, rechazadas: 0, nombre: r.nombre });
    v.ventas++;
    if (r.estado === ESTADO.PENDIENTE) v.pendientes++;
    if (r.estado === ESTADO.RECHAZADA) v.rechazadas++;
  });
  const cedulas = {};
  x.usuarios.forEach(function (u) { if (u.rol !== ROL.ADMIN) cedulas[u.cedula] = true; });
  Object.keys(ventasPor).forEach(function (c) { cedulas[c] = true; });

  const lista = Object.keys(cedulas).map(function (cedula) {
    const u = x.porCedula[cedula];
    const v = x.stats.vendedores[cedula] || vendedorVacio_(cedula);
    const r = ventasPor[cedula] || { ventas: 0, pendientes: 0, rechazadas: 0, nombre: '' };
    const cat = x.cats.porCedula[cedula];
    return {
      cedula: cedula,
      nombre: u ? u.nombre + ' ' + u.apellido : r.nombre || '(sin registro)',
      telefono: u ? u.telefono : '',
      sucursal: u ? (sucursalCanonica_(u.sucursal, x.cfg) || u.sucursal || '') : '',
      estado: u ? u.estado : 'sin registro',
      registrado: u ? u.fechaRegistro : 0,
      ventas: r.ventas,
      pendientes: r.pendientes,
      rechazadas: r.rechazadas,
      total: centavosADolares_(v.totalCentavos),
      cupones: v.cupones,
      m2: v.m2Centesimas / 100,
      cupones_austral: v.cuponesAustral,
      categoria: cat ? cat.nombre : '',
      categoria_id: cat ? cat.id : 0,
      participa_viaje: !!(cat && cat.id <= x.cfg.viaje_hasta_categoria && v.cuponesAustral > 0),
    };
  });
  lista.sort(function (a, b) { return (b.cupones - a.cupones) || (b.total - a.total) || compararTexto_(a.nombre, b.nombre); });
  return ok_({ vendedores: lista, categorias: x.cats.resumen });
}

function apiAdminVentas_(req) {
  requerirAdmin_(req.token);
  const cfg = leerConfig_();
  const usuarios = leerUsuarios_();
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const ventas = leerRegistros_().slice().sort(function (a, b) { return b.fechaCarga - a.fechaCarga; }).map(function (r) {
    const u = porCedula[r.cedula];
    const base = registroPublico_(r);
    base.cedula = r.cedula;
    base.vendedor = u ? u.nombre + ' ' + u.apellido : r.nombre;
    base.sucursal = u ? (sucursalCanonica_(u.sucursal, cfg) || u.sucursal) : '';
    base.semana = semanaDe_(r.diaVenta, cfg);
    base.cuenta = registroCuenta_(r, cfg);
    return base;
  });
  return ok_({ ventas: ventas, sucursales: cfg.sucursales, total_semanas: totalSemanas_(cfg) });
}

function apiAdminSemana_(req) {
  requerirAdmin_(req.token);
  const x = contextoAdmin_();
  const cfg = x.cfg;
  let n = parseInt(req.semana, 10);
  if (!(n >= 1 && n <= totalSemanas_(cfg))) n = semanaActual_(cfg).numero || 1;
  const p = rangoSemana_(n, cfg);
  const g = ganadoresSemanaDesde_(x.stats, x.usuarios, cfg, n, 1000);
  return ok_({
    numero: n, inicio: p.inicio, fin: p.fin, corte: p.corte, entrega: p.entrega,
    cerrada: p.corte <= ahora_(),
    premios: cfg.premios_semanales,
    lista: g.lista,
    empate_en_corte: g.empateEnCorte,
    total_semanas: totalSemanas_(cfg),
  });
}

/** Cupones listos para imprimir y meter en la urna (bowl) del sorteo. */
function apiAdminCupones_(req) {
  requerirAdmin_(req.token);
  const x = contextoAdmin_();
  const urnas = armarUrnas_(x.stats, x.cats, x.usuarios, x.cfg);
  const pedida = String(req.urna || 'todas');
  const elegidas = pedida === 'todas' ? urnas : urnas.filter(function (u) { return u.id === pedida; });
  if (!elegidas.length) throw errorApi_('NOT_FOUND', 'Esa urna no existe.');
  return ok_({
    concurso: x.cfg.nombre_concurso,
    generado: Date.now(),
    provisional: semanaActual_(x.cfg).estado !== 'terminado',
    urnas: elegidas,
  });
}

// ------------------------------------------------------------
// Cálculo de cupones, semanas, categorías y urnas (todo desde Registros)
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
 *    La semana sale de dia_venta (no de fecha_carga) y de la hoja Periodos.
 *  - Cupones del viaje = floor(m² Austral acumulados / m2_por_cupon_austral).
 *  - Cada cupón queda ligado a la factura que lo completó.
 * Todo en centavos (y centésimas de m²) para evitar errores de redondeo.
 */
function calcularEstadisticas_(registros, cfg) {
  const M = cfg.monto_por_cupon_centavos;
  const MA = cfg.m2_por_cupon_austral_centesimas;
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
    let acumuladoM2 = 0;
    ventas.forEach(function (r) {
      const antes = Math.floor(acumulado / M);
      acumulado += r.montoCentavos;
      const despues = Math.floor(acumulado / M);
      const w = semanaDe_(r.diaVenta, cfg);
      const s = v.semanas[w] || (v.semanas[w] = { montoCentavos: 0, cupones: 0, m2Centesimas: 0, acumuladoFinCentavos: 0, ultimaCarga: 0 });
      s.montoCentavos += r.montoCentavos;
      s.m2Centesimas += r.m2Centesimas;
      s.cupones += despues - antes;
      s.acumuladoFinCentavos = acumulado;
      s.ultimaCarga = Math.max(s.ultimaCarga, r.fechaCarga);
      v.ultimaCarga = Math.max(v.ultimaCarga, r.fechaCarga);
      for (let n = antes + 1; n <= despues; n++) {
        v.detalleCupones.push({
          n: n, diaVenta: r.diaVenta, factura: r.factura, semana: w, registroId: r.id, fechaCarga: r.fechaCarga,
          montoCentavos: r.montoCentavos, acumuladoCentavos: acumulado,
        });
      }
      if (r.m2Centesimas > 0) {
        const antesA = Math.floor(acumuladoM2 / MA);
        acumuladoM2 += r.m2Centesimas;
        const despuesA = Math.floor(acumuladoM2 / MA);
        for (let n = antesA + 1; n <= despuesA; n++) {
          v.detalleAustral.push({
            n: n, diaVenta: r.diaVenta, factura: r.factura, semana: w, registroId: r.id, fechaCarga: r.fechaCarga,
            m2Centesimas: r.m2Centesimas, acumuladoM2Centesimas: acumuladoM2,
          });
        }
      }
    });
    v.totalCentavos = acumulado;
    v.cupones = v.detalleCupones.length;
    v.sobranteCentavos = acumulado - v.cupones * M;
    v.m2Centesimas = acumuladoM2;
    v.cuponesAustral = v.detalleAustral.length;
    v.sobranteM2Centesimas = acumuladoM2 - v.cuponesAustral * MA;
    vendedores[cedula] = v;
  });

  return { vendedores: vendedores };
}

function vendedorVacio_(cedula) {
  return {
    cedula: cedula, totalCentavos: 0, m2Centesimas: 0, cupones: 0, sobranteCentavos: 0, detalleCupones: [],
    cuponesAustral: 0, sobranteM2Centesimas: 0, detalleAustral: [], semanas: {}, ultimaCarga: 0,
  };
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

/** Austral: m² ↓ (más m² = más cupones del viaje). Desempate: monto total. */
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
 * Categorías según los cupones acumulados (solo vendedores con al menos 1 cupón).
 *  - porcentaje: la categoría 1 son los primeros categoria_1_porcentaje % del ranking,
 *    la 2 el siguiente categoria_2_porcentaje %, el resto la 3.
 *  - cupones: categoria_1_min_cupones y categoria_2_min_cupones como pisos.
 * En ambos modos un empate en el límite sube a la categoría mayor.
 * Es provisional hasta el corte final.
 */
function calcularCategorias_(stats, cfg) {
  const lista = valores_(stats.vendedores)
    .filter(function (v) { return v.cupones > 0; })
    .sort(function (a, b) {
      return (b.cupones - a.cupones) || (b.totalCentavos - a.totalCentavos) || (a.ultimaCarga - b.ultimaCarga) || compararTexto_(a.cedula, b.cedula);
    });
  const N = lista.length;
  let min1 = Infinity;
  let min2 = Infinity;
  if (cfg.categorias_modo === 'cupones') {
    min1 = cfg.categoria_1_min_cupones;
    min2 = cfg.categoria_2_min_cupones;
  } else if (N) {
    const corte1 = Math.ceil(N * cfg.categoria_1_porcentaje / 100);
    const corte2 = Math.ceil(N * (cfg.categoria_1_porcentaje + cfg.categoria_2_porcentaje) / 100);
    if (corte1 > 0) min1 = lista[Math.min(corte1, N) - 1].cupones;
    if (corte2 > 0) min2 = lista[Math.min(corte2, N) - 1].cupones;
  }

  const porCedula = {};
  lista.forEach(function (v, i) {
    const id = v.cupones >= min1 ? 1 : v.cupones >= min2 ? 2 : 3;
    porCedula[v.cedula] = { id: id, nombre: cfg.categorias[id - 1].nombre, posicion: i + 1 };
  });
  const resumen = cfg.categorias.map(function (c) {
    const miembros = lista.filter(function (v) { return porCedula[v.cedula].id === c.id; });
    return {
      id: c.id,
      nombre: c.nombre,
      premios: c.premios,
      vendedores: miembros.length,
      cupones: miembros.reduce(function (t, v) { return t + v.cupones; }, 0),
      desde: miembros.length ? miembros[miembros.length - 1].cupones : null,
      hasta: miembros.length ? miembros[0].cupones : null,
      viaje: c.id <= cfg.viaje_hasta_categoria,
    };
  });
  return {
    porCedula: porCedula,
    resumen: resumen,
    participantes: N,
    minimos: { 1: isFinite(min1) ? min1 : null, 2: isFinite(min2) ? min2 : null },
  };
}

/** Lo que ve el vendedor de su categoría (y cuántos cupones le faltan para subir hoy). */
function categoriaPublica_(cat, v, cats, cfg, semana) {
  const provisional = semana.estado !== 'terminado';
  if (!cat) {
    return { id: 0, nombre: '', provisional: provisional, participantes: cats.participantes, para_subir: { categoria: cfg.categorias[2].nombre, cupones: 1 } };
  }
  let paraSubir = null;
  if (cat.id > 1) {
    const objetivo = cat.id - 1;
    const minimo = cats.minimos[objetivo];
    if (minimo !== null && minimo > v.cupones) paraSubir = { categoria: cfg.categorias[objetivo - 1].nombre, cupones: minimo - v.cupones };
  }
  return { id: cat.id, nombre: cat.nombre, provisional: provisional, participantes: cats.participantes, para_subir: paraSubir };
}

/**
 * Urnas del sorteo final: una por categoría (cupones normales) y la del viaje
 * (cupones Austral de las categorías permitidas). Cada cupón lleva un código
 * único dentro de su urna (C1-0001, V-0001…) para imprimirlo.
 */
function armarUrnas_(stats, cats, usuarios, cfg) {
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const urnas = cfg.categorias.map(function (c) {
    return { id: 'cat' + c.id, tipo: 'normal', categoria: c.id, nombre: c.nombre, prefijo: 'C' + c.id, premios: c.premios, cupones: [] };
  });
  const viaje = { id: 'viaje', tipo: 'austral', categoria: 0, nombre: 'Viaje todo incluido', prefijo: 'V', premios: cfg.premios_viaje, cupones: [] };

  valores_(stats.vendedores).forEach(function (v) {
    const cat = cats.porCedula[v.cedula];
    if (!cat) return;
    const u = porCedula[v.cedula];
    const base = {
      cedula: v.cedula,
      vendedor: u ? (u.nombre + ' ' + u.apellido).trim() : v.cedula,
      sucursal: u ? (sucursalCanonica_(u.sucursal, cfg) || u.sucursal) : '',
      categoria: cat.nombre,
    };
    v.detalleCupones.forEach(function (c) {
      urnas[cat.id - 1].cupones.push(Object.assign({ n: c.n, factura: c.factura, dia_venta: c.diaVenta, _orden: c.fechaCarga }, base));
    });
    if (cat.id <= cfg.viaje_hasta_categoria) {
      v.detalleAustral.forEach(function (c) {
        viaje.cupones.push(Object.assign({ n: c.n, factura: c.factura, dia_venta: c.diaVenta, _orden: c.fechaCarga }, base));
      });
    }
  });

  const todas = urnas.concat([viaje]);
  todas.forEach(function (u) {
    u.cupones.sort(function (a, b) {
      if (a.dia_venta !== b.dia_venta) return a.dia_venta < b.dia_venta ? -1 : 1;
      return (a._orden - b._orden) || compararTexto_(a.cedula, b.cedula) || (a.n - b.n);
    });
    const ancho = Math.max(4, String(u.cupones.length).length);
    u.cupones.forEach(function (c, i) {
      c.codigo = u.prefijo + '-' + ('000000' + (i + 1)).slice(-ancho);
      delete c._orden;
    });
  });
  return todas;
}

function resumenUrna_(u) {
  const vendedores = {};
  u.cupones.forEach(function (c) { vendedores[c.cedula] = true; });
  return { id: u.id, tipo: u.tipo, categoria: u.categoria, nombre: u.nombre, premios: u.premios, vendedores: Object.keys(vendedores).length, cupones: u.cupones.length };
}

/** Ganadores de una semana con todo el detalle (para el admin y el menú). */
function ganadoresSemanaDesde_(stats, usuarios, cfg, semana, limite) {
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const lista = rankingSemana_(stats, semana);
  const n = cfg.premios_semanales;
  const corte = lista[n - 1];
  const siguiente = lista[n];
  const empateEnCorte = !!(corte && siguiente && corte.s.cupones === siguiente.s.cupones && corte.s.montoCentavos === siguiente.s.montoCentavos && corte.s.acumuladoFinCentavos === siguiente.s.acumuladoFinCentavos);
  return {
    empateEnCorte: empateEnCorte,
    lista: lista.slice(0, limite || lista.length).map(function (x, i) {
      const u = porCedula[x.v.cedula];
      return {
        pos: i + 1,
        cedula: x.v.cedula,
        nombre: u ? nombreCorto_(u) : '',
        sucursal: u ? (sucursalCanonica_(u.sucursal, cfg) || u.sucursal) : '',
        cupones: x.s.cupones,
        monto: x.s.montoCentavos / 100,
        premio: i < n,
      };
    }),
  };
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
        return { pos: i + 1, nombre: nombre(v.cedula), m2: v.m2Centesimas / 100, cupones: v.cuponesAustral, es_tu: v.cedula === miCedula };
      }),
    },
    semana: numeroSemana ? {
      numero: numeroSemana,
      inicio: rango.inicio,
      fin: rango.fin,
      corte: rango.corte,
      entrega: rango.entrega,
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
// Semanas (hoja Periodos) y fechas (yyyy-MM-dd, zona Caracas)
// ------------------------------------------------------------

/** Hora actual. Es una función aparte para poder simular otras fechas en las pruebas. */
function ahora_() {
  return Date.now();
}

/**
 * Semanas a partir de la configuración: dias_por_semana días desde fecha_inicio.
 * El corte es el día siguiente al último día a la hora_corte; la entrega, el día después.
 */
function generarPeriodos_(inicioIso, cantidad, dias, horaCorte) {
  if (!esISOValida_(inicioIso)) return [];
  const lista = [];
  for (let i = 0; i < cantidad; i++) {
    const inicio = sumarDias_(inicioIso, i * dias);
    const fin = sumarDias_(inicio, dias - 1);
    lista.push({ inicio: inicio, fin: fin, corte: corteDefecto_(fin, horaCorte), entrega: sumarDias_(fin, 2) });
  }
  return lista;
}

function corteDefecto_(finIso, horaCorte) {
  return Utilities.parseDate(sumarDias_(finIso, 1) + ' ' + horaCorte, ZONA_HORARIA, 'yyyy-MM-dd HH:mm').getTime();
}

/** Semanas de la hoja Periodos (si está vacía o no existe, se calculan desde Configuracion). */
function leerPeriodos_(crudo, cfg) {
  let filas = [];
  if (SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA.PERIODOS)) {
    filas = leerTablaConCache_(HOJA.PERIODOS, function (fs) {
      return fs.map(function (f) {
        return { inicio: aISO_(f.inicio), fin: aISO_(f.fin), corte: aMillisFechaHora_(f.corte), entrega: aISO_(f.entrega) };
      }).filter(function (p) { return p.inicio && p.fin; });
    });
  }
  const base = filas.length ? filas : generarPeriodos_(aISO_(crudo.fecha_inicio), cfg.num_semanas, cfg.dias_por_semana, cfg.hora_corte);
  const lista = base.slice().sort(function (a, b) { return compararTexto_(a.inicio, b.inicio); });
  lista.forEach(function (p, i) {
    if (p.fin < p.inicio) throw errorApi_('SERVER', 'Hoja Periodos: la semana ' + (i + 1) + ' termina antes de empezar.');
    if (i > 0 && p.inicio <= lista[i - 1].fin) throw errorApi_('SERVER', 'Hoja Periodos: las semanas ' + i + ' y ' + (i + 1) + ' se solapan.');
  });
  return lista.map(function (p, i) {
    return {
      numero: i + 1,
      inicio: p.inicio,
      fin: p.fin,
      corte: p.corte || corteDefecto_(p.fin, cfg.hora_corte),
      entrega: p.entrega || sumarDias_(p.fin, 2),
    };
  });
}

function periodoDe_(iso, cfg) {
  for (let i = 0; i < cfg.periodos.length; i++) {
    const p = cfg.periodos[i];
    if (iso >= p.inicio && iso <= p.fin) return p;
  }
  return null;
}

/** Número de semana de un día de venta (0 = fuera de las semanas del concurso). */
function semanaDe_(iso, cfg) {
  const p = periodoDe_(iso, cfg);
  return p ? p.numero : 0;
}

function totalSemanas_(cfg) {
  return cfg.periodos.length;
}

function rangoSemana_(n, cfg) {
  return cfg.periodos[n - 1];
}

/**
 * Semana "en juego": la primera cuyo corte no ha pasado. Por ejemplo, el jueves
 * en la mañana sigue en juego la semana que cierra ese jueves en la tarde.
 * estado: antes · proxima · en_curso · en_corte (días terminados, esperando el corte) · terminado.
 */
function semanaActual_(cfg) {
  const ps = cfg.periodos;
  const total = ps.length;
  const hoy = hoyISO_();
  const ahora = ahora_();
  const describir = function (p, estado) {
    return { numero: estado === 'antes' ? 0 : p.numero, total: total, estado: estado, inicio: p.inicio, fin: p.fin, corte: p.corte, entrega: p.entrega };
  };
  if (hoy < ps[0].inicio) return describir(ps[0], 'antes');
  for (let i = 0; i < total; i++) {
    const p = ps[i];
    if (p.corte > ahora) return describir(p, hoy < p.inicio ? 'proxima' : hoy > p.fin ? 'en_corte' : 'en_curso');
  }
  return describir(ps[total - 1], 'terminado');
}

/** Días que se pueden elegir en el formulario de venta. */
function rangoCarga_(cfg) {
  const hoy = hoyISO_();
  const ahora = ahora_();
  const abiertas = cfg.bloquear_semanas_cerradas
    ? cfg.periodos.filter(function (p) { return p.corte > ahora; })
    : cfg.periodos;
  if (!abiertas.length) return { min: '', max: '' };
  const min = abiertas[0].inicio;
  const max = hoy < cfg.fecha_fin ? hoy : cfg.fecha_fin;
  return max < min ? { min: min, max: '' } : { min: min, max: max };
}

function hoyISO_() {
  return Utilities.formatDate(new Date(ahora_()), ZONA_HORARIA, 'yyyy-MM-dd');
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

/** Lee una fecha con hora de celda (Date o "dd/mm/aaaa hh:mm") y la devuelve en milisegundos. 0 = vacía. */
function aMillisFechaHora_(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) return valor.getTime();
  const t = String(valor === null || valor === undefined ? '' : valor).trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/) || t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const iso = m[0].indexOf('/') > -1 ? m[3] + '-' + dos_(Number(m[2])) + '-' + dos_(Number(m[1])) : m[1] + '-' + dos_(Number(m[2])) + '-' + dos_(Number(m[3]));
  return Utilities.parseDate(iso + ' ' + dos_(Number(m[4])) + ':' + m[5], ZONA_HORARIA, 'yyyy-MM-dd HH:mm').getTime();
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

function fechaHoraTexto_(ms) {
  return Utilities.formatDate(new Date(ms), ZONA_HORARIA, 'dd/MM/yyyy') + ' a las ' + Utilities.formatDate(new Date(ms), ZONA_HORARIA, 'HH:mm');
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
  if (nombre === HOJA.CONFIG || nombre === HOJA.PERIODOS) delete MEMO_.cfg;
  CacheService.getScriptCache().remove('tbl_' + nombre);
}

function numeroO_(valor, porDefecto) {
  const n = parsearNumero_(valor);
  return isNaN(n) ? porDefecto : n;
}

function entre_(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function leerConfig_() {
  if (MEMO_.cfg) return MEMO_.cfg;
  const crudo = leerTablaConCache_(HOJA.CONFIG, function (filas) {
    const o = {};
    filas.forEach(function (f) {
      const clave = String(f.clave || '').trim();
      if (!clave) return;
      const v = f.valor;
      if (v instanceof Date) o[clave] = clave === 'hora_corte' ? Utilities.formatDate(v, ZONA_HORARIA, 'HH:mm') : aISO_(v);
      else o[clave] = v;
    });
    return o;
  });

  const texto = function (clave, porDefecto) {
    const v = crudo[clave];
    return v === undefined || v === null ? porDefecto : String(v).trim();
  };
  const siONo = function (clave, porDefecto) {
    return crudo[clave] === undefined ? porDefecto : esSi_(crudo[clave]);
  };
  const hora = texto('hora_corte', '15:00').match(/^(\d{1,2}):(\d{2})$/);
  const nombresCat = ['Oro', 'Plata', 'Bronce'];
  const premiosCat = [2, 1, 1];
  const p1 = entre_(numeroO_(crudo.categoria_1_porcentaje, 20), 0, 100);
  const min1 = Math.max(1, Math.floor(numeroO_(crudo.categoria_1_min_cupones, 30)));
  const sucursales = texto('sucursales', '').split(/[,;\n]/).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(String);

  const cfg = {
    nombre_concurso: texto('nombre_concurso', '') || 'Copa Prosein',
    fecha_sorteo: aISO_(crudo.fecha_sorteo),
    num_semanas: entre_(Math.floor(numeroO_(crudo.num_semanas, 10)), 1, 60),
    dias_por_semana: entre_(Math.floor(numeroO_(crudo.dias_por_semana, 7)), 1, 31),
    hora_corte: hora && Number(hora[1]) < 24 ? dos_(Number(hora[1])) + ':' + hora[2] : '15:00',
    texto_entrega: texto('texto_entrega', 'en la mañana'),
    bloquear_semanas_cerradas: siONo('bloquear_semanas_cerradas', true),
    monto_por_cupon: numeroO_(crudo.monto_por_cupon, 1500),
    premios_semanales: Math.max(0, Math.floor(numeroO_(crudo.premios_semanales, 6))),
    m2_por_cupon_austral: numeroO_(crudo.m2_por_cupon_austral, 100),
    sucursales: sucursales.length ? sucursales : SUCURSALES_POR_DEFECTO.slice(),
    categorias_modo: texto('categorias_modo', 'porcentaje').toLowerCase() === 'cupones' ? 'cupones' : 'porcentaje',
    categorias: [1, 2, 3].map(function (i) {
      return {
        id: i,
        nombre: texto('categoria_' + i + '_nombre', '') || nombresCat[i - 1],
        premios: Math.max(0, Math.floor(numeroO_(crudo['premios_categoria_' + i], premiosCat[i - 1]))),
      };
    }),
    categoria_1_porcentaje: p1,
    categoria_2_porcentaje: entre_(numeroO_(crudo.categoria_2_porcentaje, 30), 0, 100 - p1),
    categoria_1_min_cupones: min1,
    categoria_2_min_cupones: entre_(Math.floor(numeroO_(crudo.categoria_2_min_cupones, 10)), 1, min1),
    premios_viaje: Math.max(0, Math.floor(numeroO_(crudo.premios_viaje, 1))),
    viaje_hasta_categoria: entre_(Math.floor(numeroO_(crudo.viaje_hasta_categoria, 1)), 1, 3),
    moneda: texto('moneda', '') || 'USD',
    concurso_abierto: esSi_(crudo.concurso_abierto),
    contar_solo_aprobadas: esSi_(crudo.contar_solo_aprobadas),
    mostrar_ranking_publico: esSi_(crudo.mostrar_ranking_publico),
    carpeta_fotos_id: texto('carpeta_fotos_id', ''),
    semana_ranking: parseInt(crudo.semana_ranking, 10) || 0,
    dias_sesion: Math.max(1, numeroO_(crudo.dias_sesion, 7)),
    monto_maximo_venta: numeroO_(crudo.monto_maximo_venta, 100000),
    token_api: texto('token_api', ''),
  };
  cfg.monto_por_cupon_centavos = Math.round(cfg.monto_por_cupon * 100);
  if (!(cfg.monto_por_cupon_centavos > 0)) throw errorApi_('SERVER', 'monto_por_cupon en Configuracion debe ser mayor que 0.');
  if (!(cfg.m2_por_cupon_austral > 0)) cfg.m2_por_cupon_austral = 100;
  cfg.m2_por_cupon_austral_centesimas = Math.round(cfg.m2_por_cupon_austral * 100);

  cfg.periodos = leerPeriodos_(crudo, cfg);
  if (!cfg.periodos.length) throw errorApi_('SERVER', 'No hay semanas configuradas: revisa fecha_inicio en Configuracion o la hoja Periodos.');
  cfg.fecha_inicio = cfg.periodos[0].inicio;
  cfg.fecha_fin = cfg.periodos[cfg.periodos.length - 1].fin;
  MEMO_.cfg = cfg;
  return cfg;
}

function configPublica_(cfg) {
  const semana = semanaActual_(cfg);
  const carga = rangoCarga_(cfg);
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
    periodos: cfg.periodos,
    texto_entrega: cfg.texto_entrega,
    bloquear_semanas_cerradas: cfg.bloquear_semanas_cerradas,
    dia_min_carga: carga.min,
    dia_max_carga: carga.max,
    sucursales: cfg.sucursales,
    m2_por_cupon_austral: cfg.m2_por_cupon_austral,
    categorias: cfg.categorias,
    categorias_modo: cfg.categorias_modo,
    categoria_1_porcentaje: cfg.categoria_1_porcentaje,
    categoria_2_porcentaje: cfg.categoria_2_porcentaje,
    categoria_1_min_cupones: cfg.categoria_1_min_cupones,
    categoria_2_min_cupones: cfg.categoria_2_min_cupones,
    premios_viaje: cfg.premios_viaje,
    viaje_hasta_categoria: cfg.viaje_hasta_categoria,
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
        rol: String(f.rol || '').trim().toLowerCase() === ROL.ADMIN ? ROL.ADMIN : ROL.VENDEDOR,
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

/** Agrega un usuario respetando el orden real de las columnas de la hoja. */
function escribirFilaUsuario_(fila) {
  const sh = hoja_(HOJA.USUARIOS);
  const mapa = mapaColumnas_(sh);
  const ancho = Math.max(sh.getLastColumn(), COLUMNAS_USUARIOS.length);
  const valores = [];
  for (let i = 0; i < ancho; i++) valores.push('');
  COLUMNAS_USUARIOS.forEach(function (c) {
    if (mapa[c]) valores[mapa[c] - 1] = protegerCelda_(fila[c] === undefined ? '' : fila[c]);
  });
  sh.appendRow(valores);
  invalidarTabla_(HOJA.USUARIOS);
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

function sinAcentos_(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Nombre oficial de la tienda (de la lista de Configuracion) o '' si no coincide. */
function sucursalCanonica_(valor, cfg) {
  const buscada = sinAcentos_(valor);
  if (!buscada) return '';
  for (let i = 0; i < cfg.sucursales.length; i++) {
    if (sinAcentos_(cfg.sucursales[i]) === buscada) return cfg.sucursales[i];
  }
  return '';
}

function validarSucursal_(valor, cfg) {
  const s = sucursalCanonica_(valor, cfg);
  if (!s) throw errorCampo_('sucursal', 'Elige tu tienda de la lista.');
  return s;
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
  const p = periodoDe_(iso, cfg);
  if (!p) {
    if (iso < cfg.fecha_inicio || iso > cfg.fecha_fin) {
      throw errorCampo_('dia_venta', 'La fecha debe estar dentro del concurso: del ' + fechaCorta_(cfg.fecha_inicio) + ' al ' + fechaCorta_(cfg.fecha_fin) + '.');
    }
    throw errorCampo_('dia_venta', 'Esa fecha no pertenece a ninguna semana del concurso.');
  }
  if (cfg.bloquear_semanas_cerradas && p.corte <= ahora_()) {
    throw errorCampo_('dia_venta', 'La semana ' + p.numero + ' cerró el ' + fechaHoraTexto_(p.corte) + '. Ya no se cargan ventas de esas fechas.');
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

function usuarioPublico_(u, cfg) {
  const admin = u.rol === ROL.ADMIN;
  const sucursal = cfg ? (sucursalCanonica_(u.sucursal, cfg) || '') : (u.sucursal || '');
  return {
    nombre: u.nombre,
    apellido: u.apellido,
    cedula_mask: enmascararCedula_(u.cedula),
    sucursal: sucursal,
    rol: admin ? ROL.ADMIN : ROL.VENDEDOR,
    necesita_sucursal: !admin && !!cfg && !sucursal,
  };
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

/** Datos de un cupón para volver a mostrar su ticket. */
function cuponPublico_(c, cfg) {
  const M = cfg.monto_por_cupon_centavos;
  return {
    n: c.n,
    dia_venta: c.diaVenta,
    factura: c.factura,
    semana: c.semana,
    fecha_carga: c.fechaCarga,
    monto: centavosADolares_(c.montoCentavos),
    acumulado: centavosADolares_(c.acumuladoCentavos),
    falta: centavosADolares_(M - (c.acumuladoCentavos % M)),
  };
}

function cuponAustralPublico_(c, cfg) {
  const MA = cfg.m2_por_cupon_austral_centesimas;
  return {
    n: c.n,
    dia_venta: c.diaVenta,
    factura: c.factura,
    semana: c.semana,
    fecha_carga: c.fechaCarga,
    m2: c.m2Centesimas / 100,
    m2_acumulado: c.acumuladoM2Centesimas / 100,
    m2_falta: (MA - (c.acumuladoM2Centesimas % MA)) / 100,
  };
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

  // Configuracion: agrega las claves que falten y actualiza solo las descripciones.
  const shCfg = asegurarHoja_(ss, HOJA.CONFIG, ['clave', 'valor', 'descripcion']);
  const existentes = {};
  filasComoObjetos_(shCfg).forEach(function (f) { if (f.clave) existentes[String(f.clave).trim()] = f; });
  configuracionPorDefecto_().forEach(function (fila) {
    const actual = existentes[fila[0]];
    if (!actual) shCfg.appendRow(fila);
    else if (String(actual.descripcion || '') !== fila[2]) shCfg.getRange(actual._fila, 3).setValue(fila[2]);
  });
  Object.keys(CLAVES_OBSOLETAS).forEach(function (clave) {
    if (existentes[clave]) shCfg.getRange(existentes[clave]._fila, 3).setValue(CLAVES_OBSOLETAS[clave]);
  });
  shCfg.setColumnWidth(1, 210);
  shCfg.setColumnWidth(2, 260);
  shCfg.setColumnWidth(3, 620);
  const lista = function (valores) { return SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build(); };
  const textoCfg = ['carpeta_fotos_id', 'semana_ranking', 'token_api', 'hora_corte', 'sucursales', 'texto_entrega', 'categoria_1_nombre', 'categoria_2_nombre', 'categoria_3_nombre'];
  filasComoObjetos_(shCfg).forEach(function (f) {
    const clave = String(f.clave || '').trim();
    const celda = shCfg.getRange(f._fila, 2);
    if (['concurso_abierto', 'contar_solo_aprobadas', 'mostrar_ranking_publico', 'bloquear_semanas_cerradas'].indexOf(clave) > -1) celda.setDataValidation(lista(['SI', 'NO']));
    if (clave === 'categorias_modo') celda.setDataValidation(lista(['porcentaje', 'cupones']));
    if (clave.indexOf('fecha_') === 0) celda.setNumberFormat('dd/mm/yyyy');
    if (textoCfg.indexOf(clave) > -1) celda.setNumberFormat('@');
  });

  // Periodos (semanas y cortes)
  const shP = asegurarHoja_(ss, HOJA.PERIODOS, COLUMNAS_PERIODOS);
  formatoColumnas_(shP, COLUMNAS_PERIODOS, { inicio: 'ddd dd/mm/yyyy', fin: 'ddd dd/mm/yyyy', corte: 'ddd dd/mm/yyyy hh:mm', entrega: 'ddd dd/mm/yyyy' });
  [70, 150, 150, 190, 150].forEach(function (w, i) { shP.setColumnWidth(i + 1, w); });
  MEMO_ = {};
  invalidarTabla_(HOJA.CONFIG);
  if (shP.getLastRow() < 2) escribirPeriodos_(periodosDesdeConfig_());

  // Usuarios
  const shU = asegurarHoja_(ss, HOJA.USUARIOS, COLUMNAS_USUARIOS);
  formatoColumnas_(shU, COLUMNAS_USUARIOS, {
    cedula: '@', telefono: '@', password_hash: '@', salt: '@',
    fecha_registro: 'dd/mm/yyyy hh:mm', bloqueado_hasta: 'dd/mm/yyyy hh:mm',
  });
  validacionColumna_(shU, COLUMNAS_USUARIOS, 'estado', [ESTADO_USUARIO.ACTIVO, ESTADO_USUARIO.BLOQUEADO]);
  validacionColumna_(shU, COLUMNAS_USUARIOS, 'rol', [ROL.VENDEDOR, ROL.ADMIN]);
  validacionColumna_(shU, COLUMNAS_USUARIOS, 'sucursal_o_zona', leerConfig_().sucursales, true);

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
  [HOJA.CONFIG, HOJA.PERIODOS, HOJA.REGISTROS, HOJA.USUARIOS, HOJA.RANKING].forEach(function (nombre, i) {
    ss.setActiveSheet(ss.getSheetByName(nombre));
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(shCfg);

  MEMO_ = {};
  invalidarTabla_(HOJA.CONFIG);
  carpetaFotos_(leerConfig_());
  invalidarTabla_(HOJA.CONFIG);
  recalcularRankings_();
  avisar_('Copa Prosein lista', 'Hojas listas. Revisa Configuracion y la hoja Periodos (semanas y cortes) y luego despliega la aplicación web.');
}

/** Semanas calculadas desde Configuracion (fecha_inicio, num_semanas, dias_por_semana, hora_corte). */
function periodosDesdeConfig_() {
  const filas = filasComoObjetos_(hoja_(HOJA.CONFIG));
  const crudo = {};
  filas.forEach(function (f) { if (f.clave) crudo[String(f.clave).trim()] = f.valor; });
  invalidarTabla_(HOJA.CONFIG);
  const cfgSinPeriodos = {
    num_semanas: entre_(Math.floor(numeroO_(crudo.num_semanas, 10)), 1, 60),
    dias_por_semana: entre_(Math.floor(numeroO_(crudo.dias_por_semana, 7)), 1, 31),
    hora_corte: (function () {
      const v = crudo.hora_corte instanceof Date ? Utilities.formatDate(crudo.hora_corte, ZONA_HORARIA, 'HH:mm') : String(crudo.hora_corte || '15:00').trim();
      const m = v.match(/^(\d{1,2}):(\d{2})$/);
      return m && Number(m[1]) < 24 ? dos_(Number(m[1])) + ':' + m[2] : '15:00';
    })(),
  };
  return generarPeriodos_(aISO_(crudo.fecha_inicio), cfgSinPeriodos.num_semanas, cfgSinPeriodos.dias_por_semana, cfgSinPeriodos.hora_corte);
}

function escribirPeriodos_(lista) {
  const sh = hoja_(HOJA.PERIODOS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, COLUMNAS_PERIODOS.length).clearContent();
  if (lista.length) {
    sh.getRange(2, 1, lista.length, COLUMNAS_PERIODOS.length).setValues(lista.map(function (p, i) {
      return [i + 1, fechaDesdeISO_(p.inicio), fechaDesdeISO_(p.fin), new Date(p.corte), fechaDesdeISO_(p.entrega)];
    }));
  }
  invalidarTabla_(HOJA.PERIODOS);
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

/** Aplica formatos por nombre de columna (busca la columna real en la fila de encabezados). */
function formatoColumnas_(sh, columnas, formatos) {
  const mapa = mapaColumnas_(sh);
  const filas = Math.max(sh.getMaxRows() - 1, 1);
  Object.keys(formatos).forEach(function (col) {
    if (mapa[col]) sh.getRange(2, mapa[col], filas, 1).setNumberFormat(formatos[col]);
  });
}

function validacionColumna_(sh, columnas, col, lista, permitirOtros) {
  const mapa = mapaColumnas_(sh);
  if (!mapa[col] || !lista.length) return;
  const regla = SpreadsheetApp.newDataValidation().requireValueInList(lista, true).setAllowInvalid(!!permitirOtros).build();
  sh.getRange(2, mapa[col], Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(regla);
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
    .addItem('Generar periodos (semanas y cortes)', 'menuGenerarPeriodos')
    .addItem('Recalcular rankings', 'menuRecalcularRankings')
    .addItem('Generar cupones para sorteo', 'menuGenerarCupones')
    .addSeparator()
    .addItem('Ganadores semanales (elegir semana)', 'menuGanadoresSemanales')
    .addItem('Resumen del sorteo final', 'menuResumenSorteo')
    .addSeparator()
    .addItem('Cargar datos de prueba', 'menuCargarDatosPrueba')
    .addItem('Borrar datos de prueba', 'menuBorrarDatosPrueba')
    .addToUi();
}

function menuGenerarPeriodos() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Generar periodos', 'Se reemplazan las filas de la hoja Periodos con semanas calculadas desde fecha_inicio, num_semanas, dias_por_semana y hora_corte (Configuracion). Los cambios que hayas hecho a mano en Periodos se pierden. ¿Continuar?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  MEMO_ = {};
  const lista = periodosDesdeConfig_();
  if (!lista.length) {
    ui.alert('Generar periodos', 'Revisa fecha_inicio en Configuracion: no es una fecha válida.', ui.ButtonSet.OK);
    return;
  }
  escribirPeriodos_(lista);
  let mensaje = '';
  lista.forEach(function (p, i) {
    mensaje += 'Semana ' + (i + 1) + ': ' + fechaCorta_(p.inicio) + ' al ' + fechaCorta_(p.fin) + ' · corte ' + fechaHoraTexto_(p.corte) + ' · entrega ' + fechaCorta_(p.entrega) + '\n';
  });
  ui.alert('Periodos generados', mensaje + '\nPuedes ajustar cualquier fecha directamente en la hoja Periodos.', ui.ButtonSet.OK);
}

function menuRecalcularRankings() {
  MEMO_ = {};
  invalidarTabla_(HOJA.REGISTROS);
  invalidarTabla_(HOJA.USUARIOS);
  invalidarTabla_(HOJA.CONFIG);
  invalidarTabla_(HOJA.PERIODOS);
  const r = recalcularRankings_();
  SpreadsheetApp.getActiveSpreadsheet().toast(r.vendedores + ' vendedores con ventas · ' + r.cupones + ' cupones en las urnas.', 'Rankings actualizados', 6);
}

function menuGenerarCupones() {
  MEMO_ = {};
  invalidarTabla_(HOJA.REGISTROS);
  const r = recalcularRankings_();
  const sh = hoja_(HOJA.RANKING);
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
  sh.getRange(3, r.columnaCupones).activate();
  avisar_('Cupones para el sorteo', 'Se generaron ' + r.cupones + ' cupones en las urnas (columna "Cupones para sorteo" de la hoja Ranking). Para imprimirlos, entra al portal con tu usuario administrador → Sorteo → Imprimir cupones.');
}

function menuGanadoresSemanales() {
  const ui = SpreadsheetApp.getUi();
  MEMO_ = {};
  invalidarTabla_(HOJA.REGISTROS);
  invalidarTabla_(HOJA.PERIODOS);
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
  const p = rangoSemana_(semana, cfg);
  let mensaje = 'Semana ' + semana + ' (' + fechaCorta_(p.inicio) + ' al ' + fechaCorta_(p.fin) + ')\n';
  mensaje += p.corte <= ahora_() ? 'Cerrada el ' + fechaHoraTexto_(p.corte) + '.\n\n' : 'Todavía abierta: el corte es el ' + fechaHoraTexto_(p.corte) + '. Estos resultados pueden cambiar.\n\n';
  if (!g.ganadores.length) mensaje += 'Nadie completó cupones esta semana.';
  g.ganadores.forEach(function (x, i) {
    mensaje += (i + 1) + '. ' + x.nombre + ' (C.I. ' + x.cedula + (x.sucursal ? ', ' + x.sucursal : '') + ') · ' + x.cupones + (x.cupones === 1 ? ' cupón' : ' cupones') + ' · $' + x.monto.toFixed(2) + '\n';
  });
  if (g.empateEnCorte) mensaje += '\nAtención: hay empate exacto en el último puesto premiado. Revisa la hoja Ranking.';
  ui.alert('Ganadores semanales', mensaje, ui.ButtonSet.OK);
}

/** Ganadores de una semana (también sirve para usarla desde otras funciones). */
function ganadoresSemana(semana) {
  const cfg = leerConfig_();
  const g = ganadoresSemanaDesde_(calcularEstadisticas_(leerRegistros_(), cfg), leerUsuarios_(), cfg, semana);
  return { ganadores: g.lista.filter(function (x) { return x.premio; }), empateEnCorte: g.empateEnCorte };
}

function menuResumenSorteo() {
  MEMO_ = {};
  invalidarTabla_(HOJA.REGISTROS);
  const cfg = leerConfig_();
  const stats = calcularEstadisticas_(leerRegistros_(), cfg);
  const cats = calcularCategorias_(stats, cfg);
  const urnas = armarUrnas_(stats, cats, leerUsuarios_(), cfg).map(resumenUrna_);
  const estado = semanaActual_(cfg).estado === 'terminado' ? 'Concurso cerrado: este es el resultado final.' : 'Provisional: el concurso sigue abierto.';
  let mensaje = estado + '\n\n';
  cats.resumen.forEach(function (c) {
    mensaje += c.nombre + ': ' + c.vendedores + ' vendedores' + (c.vendedores ? ' (de ' + c.desde + ' a ' + c.hasta + ' cupones)' : '') + ' · ' + c.premios + (c.premios === 1 ? ' premio' : ' premios') + '\n';
  });
  mensaje += '\nUrnas:\n';
  urnas.forEach(function (u) {
    mensaje += '· ' + u.nombre + ': ' + u.cupones + ' cupones de ' + u.vendedores + ' vendedores · ' + u.premios + (u.premios === 1 ? ' premio' : ' premios') + '\n';
  });
  SpreadsheetApp.getUi().alert('Sorteo final', mensaje, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Escribe la hoja Ranking: general, Austral, semana seleccionada, urnas y cupones para sorteo. */
function recalcularRankings_() {
  const cfg = leerConfig_();
  const stats = calcularEstadisticas_(leerRegistros_(), cfg);
  const usuarios = leerUsuarios_();
  const cats = calcularCategorias_(stats, cfg);
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const nombre = function (c) { return porCedula[c] ? nombreCorto_(porCedula[c]) : ''; };
  const sucursal = function (c) { return porCedula[c] ? (sucursalCanonica_(porCedula[c].sucursal, cfg) || porCedula[c].sucursal) : ''; };
  const categoria = function (c) { return cats.porCedula[c] ? cats.porCedula[c].nombre : ''; };

  const total = totalSemanas_(cfg);
  let semana = cfg.semana_ranking && cfg.semana_ranking <= total ? cfg.semana_ranking : semanaActual_(cfg).numero;
  if (!semana && total) semana = 1;
  const rango = semana ? rangoSemana_(semana, cfg) : null;
  const urnas = armarUrnas_(stats, cats, usuarios, cfg);

  const bloques = [];
  bloques.push({
    titulo: 'Ranking general (cupones acumulados)',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'Sucursal', 'Total vendido', 'Cupones', 'Categoría', 'm² Austral', 'Cupones viaje'],
    filas: rankingGeneral_(stats).map(function (v, i) {
      return [i + 1, v.cedula, nombre(v.cedula), sucursal(v.cedula), v.totalCentavos / 100, v.cupones, categoria(v.cedula), v.m2Centesimas / 100, v.cuponesAustral];
    }),
    texto: [1],
    formatos: { 4: '#,##0.00', 7: '#,##0.00' },
  });
  bloques.push({
    titulo: 'Viaje · cupones Austral (1 cada ' + cfg.m2_por_cupon_austral + ' m²)',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'Categoría', 'm² Austral', 'Cupones viaje', 'Participa'],
    filas: rankingAustral_(stats).map(function (v, i) {
      const cat = cats.porCedula[v.cedula];
      const participa = !!(cat && cat.id <= cfg.viaje_hasta_categoria && v.cuponesAustral > 0);
      return [i + 1, v.cedula, nombre(v.cedula), categoria(v.cedula), v.m2Centesimas / 100, v.cuponesAustral, participa ? 'SI' : 'NO'];
    }),
    texto: [1],
    formatos: { 4: '#,##0.00' },
  });
  bloques.push({
    titulo: semana ? 'Semana ' + semana + ' (' + fechaCorta_(rango.inicio) + ' al ' + fechaCorta_(rango.fin) + ' · corte ' + fechaHoraTexto_(rango.corte) + ')' : 'Semana',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'Sucursal', 'Cupones semana', 'Vendido semana', 'Premio'],
    filas: semana ? rankingSemana_(stats, semana).map(function (x, i) {
      return [i + 1, x.v.cedula, nombre(x.v.cedula), sucursal(x.v.cedula), x.s.cupones, x.s.montoCentavos / 100, i < cfg.premios_semanales ? 'Premio semanal' : ''];
    }) : [],
    texto: [1],
    formatos: { 5: '#,##0.00' },
  });
  bloques.push({
    titulo: 'Urnas del sorteo final',
    encabezados: ['Urna', 'Premios', 'Vendedores', 'Cupones'],
    filas: urnas.map(resumenUrna_).map(function (u) { return [u.nombre, u.premios, u.vendedores, u.cupones]; }),
    texto: [],
    formatos: {},
  });
  bloques.push({
    titulo: 'Cupones para sorteo',
    encabezados: ['Urna', 'Código', 'N° del vendedor', 'Cédula', 'Vendedor', 'Sucursal', 'Día de venta', 'Factura'],
    filas: [].concat.apply([], urnas.map(function (u) {
      return u.cupones.map(function (c) { return [u.nombre, c.codigo, c.n, c.cedula, c.vendedor, c.sucursal, fechaCorta_(c.dia_venta), c.factura]; });
    })),
    texto: [1, 3, 7],
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
      // Formatos antes que valores: así la cédula y los códigos quedan como texto.
      b.texto.forEach(function (off) { sh.getRange(4, columna + off, b.filas.length, 1).setNumberFormat('@'); });
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

  const totalCupones = urnas.reduce(function (t, u) { return t + u.cupones.length; }, 0);
  return { vendedores: rankingGeneral_(stats).length, cupones: totalCupones, columnaCupones: columnaCupones };
}

// ------------------------------------------------------------
// Datos de prueba (para verificar rankings antes del lanzamiento)
// ------------------------------------------------------------

function esCedulaPrueba_(cedula) {
  const n = Number(normalizarCedula_(cedula));
  return n >= CEDULA_PRUEBA_DESDE && n < CEDULA_PRUEBA_DESDE + CANTIDAD_PRUEBA;
}

function menuCargarDatosPrueba() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Datos de prueba', 'Se crearán ' + CANTIDAD_PRUEBA + ' vendedores de prueba (cédulas ' + CEDULA_PRUEBA_DESDE + ' a ' + (CEDULA_PRUEBA_DESDE + CANTIDAD_PRUEBA - 1) + ', contraseña "prueba123") con ventas en las semanas que ya pasaron. ¿Continuar?', ui.ButtonSet.YES_NO);
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
    const existentes = leerUsuarios_({ fresco: true });
    nombres.forEach(function (n, i) {
      const cedula = String(CEDULA_PRUEBA_DESDE + i);
      if (buscarUsuario_(existentes, cedula)) return;
      const salt = generarSalt_();
      escribirFilaUsuario_({
        cedula: cedula, nombre: n[0], apellido: n[1], telefono: '0414000000' + i,
        sucursal_o_zona: cfg.sucursales[i % cfg.sucursales.length],
        password_hash: hashClave_('prueba123', salt), salt: salt, fecha_registro: new Date(),
        estado: ESTADO_USUARIO.ACTIVO, intentos_fallidos: 0, bloqueado_hasta: '', rol: ROL.VENDEDOR,
      });
    });

    const registros = leerRegistros_({ fresco: true });
    const hoy = hoyISO_();
    const ultimoDia = hoy < cfg.fecha_fin ? hoy : cfg.fecha_fin;
    const dias = Math.max(0, diasEntre_(cfg.fecha_inicio, ultimoDia));
    const filas = [];
    let siguiente = Number((siguienteId_(registros).match(/(\d+)$/) || [0, 1])[1]);
    nombres.forEach(function (n, i) {
      const cedula = String(CEDULA_PRUEBA_DESDE + i);
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
          montoCentavos: monto, austral: austral, m2Centesimas: austral ? Math.round((20 + azar() * 160) * 100) : 0,
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
  const r = ui.alert('Borrar datos de prueba', 'Se borrarán las ventas con nota "' + NOTA_PRUEBA + '" y los vendedores con cédulas ' + CEDULA_PRUEBA_DESDE + ' a ' + (CEDULA_PRUEBA_DESDE + CANTIDAD_PRUEBA - 1) + '. ¿Continuar?', ui.ButtonSet.YES_NO);
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
      usuarios: borrar(HOJA.USUARIOS, function (f) { return esCedulaPrueba_(f.cedula) && String(f.rol || '').trim().toLowerCase() !== ROL.ADMIN; }),
    };
  });
}
