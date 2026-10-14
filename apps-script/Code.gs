/**
 * ============================================================
 *  COPA NAVIDEÑA AUSTRAL - PROSEIN
 *  Backend (Google Apps Script + Google Sheets)
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
 *  los cupones de cada ronda y del sorteo final se ajustan solos.
 *
 *  Reglas (editables en las hojas Configuracion, Rondas y Canales):
 *    - Cada vendedor tiene un canal (Tienda, Distribuidor o Corporativo). Cada
 *      tienda y cada canal tiene su valor de cupón, su meta (informativa) y sus m² o
 *      piezas de Austral por cupón (hoja Canales).
 *    - 1 cupón por cada "valor de cupón" vendido (acumulado; el sobrante no se pierde).
 *    - Rondas (hoja Rondas): cada sorteo de ronda usa los cupones completados en
 *      esa ronda. La ronda de una venta es la del día en que se registra: lo que se
 *      registra después del último día de una ronda pasa a la siguiente.
 *      La Ñapa no tiene sorteo: solo suma para el final.
 *    - Gran Sorteo Final: 1 cupón por cada cupones_por_cupon_final cupones, 1 por cada
 *      m² o piezas de Austral de su canal (80; 500 para distribuidores) y 1 por cada
 *      ronda con sorteo en la que fue quien más vendió de su canal.
 */

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

const ZONA_HORARIA = 'America/Caracas';

const HOJA = {
  CONFIG: 'Configuracion',
  RONDAS: 'Rondas',
  CANALES: 'Canales',
  USUARIOS: 'Usuarios',
  REGISTROS: 'Registros',
  RANKING: 'Ranking',
};

/** Hojas de versiones anteriores que setup() borra (no tienen datos de ventas). */
const HOJAS_OBSOLETAS = ['Periodos'];

const COLUMNAS_USUARIOS = [
  'cedula', 'nombre', 'apellido', 'telefono', 'sucursal_o_zona',
  'password_hash', 'salt', 'fecha_registro', 'estado',
  'intentos_fallidos', 'bloqueado_hasta', 'rol', 'canal',
];

const COLUMNAS_REGISTROS = [
  'id', 'fecha_carga', 'cedula', 'nombre', 'dia_venta', 'numero_factura',
  'monto', 'vendio_austral', 'm2_austral', 'url_foto', 'estado', 'nota_admin',
];

const COLUMNAS_RONDAS = ['ronda', 'nombre', 'inicio', 'fin', 'sorteo'];
const COLUMNAS_CANALES = ['canal', 'tienda', 'monto_por_cupon', 'meta', 'm2_por_cupon_austral'];

const ESTADO = { PENDIENTE: 'Pendiente', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' };
const ESTADO_USUARIO = { ACTIVO: 'activo', BLOQUEADO: 'bloqueado' };
const ROL = { VENDEDOR: 'vendedor', ADMIN: 'admin' };

const CANAL = { TIENDA: 'Tienda', DISTRIBUIDOR: 'Distribuidor', CORPORATIVO: 'Corporativo' };
const CANALES = [CANAL.TIENDA, CANAL.DISTRIBUIDOR, CANAL.CORPORATIVO];
const ETIQUETA_CANAL = { Tienda: 'Tiendas', Distribuidor: 'Distribuidores', Corporativo: 'Corporativo' };

/** Los distribuidores venden mercancía Austral: su cupón Austral pide más m² o piezas. */
const M2_AUSTRAL_DISTRIBUIDOR = 500;

const SUCURSALES_POR_DEFECTO = [
  'Boleíta', 'La Castellana', 'Los Naranjos', 'El Bosque', 'Las Mercedes',
  'San Martín', 'Maracaibo', 'Acarigua', 'Barquisimeto',
];

/**
 * Cronograma de fin de año 2026. Cada ronda cierra al terminar su último día: lo que
 * se registra después pasa a la ronda siguiente (cuenta la fecha de registro).
 */
const RONDAS_POR_DEFECTO = [
  { nombre: 'Ronda 1', inicio: '2026-10-15', fin: '2026-11-05', sorteo: '2026-11-09' },
  { nombre: 'Ronda 2', inicio: '2026-11-06', fin: '2026-11-26', sorteo: '2026-11-30' },
  { nombre: 'Ronda 3', inicio: '2026-11-27', fin: '2026-12-10', sorteo: '2026-12-14' },
  { nombre: 'La Ñapa', inicio: '2026-12-11', fin: '2026-12-19', sorteo: '' },
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
    ['nombre_concurso', 'Copa Navideña Austral - Prosein', 'Nombre visible en el portal.'],
    ['nombre_sorteo', 'Copa Navideña', 'Nombre de los sorteos.'],
    ['fecha_sorteo_final', fechaDesdeISO_('2026-12-21'), 'Fecha del Gran Sorteo Final.'],
    ['monto_por_cupon', 1500, 'Valor del cupón para quien no tenga valor en la hoja Canales (respaldo).'],
    ['cupones_por_cupon_final', 10, 'Cada N cupones acumulados en toda la campaña = 1 cupón para el Gran Sorteo Final.'],
    ['m2_por_cupon_austral', 80, 'm² o piezas de Austral que dan 1 cupón adicional para el Gran Sorteo Final, si la hoja Canales no trae otro valor para la tienda o el canal.'],
    ['moneda', 'USD', 'Moneda de los montos.'],
    ['concurso_abierto', 'SI', 'SI = los vendedores pueden cargar ventas.'],
    ['contar_solo_aprobadas', 'NO', 'SI = solo cuentan facturas Aprobadas. NO = cuentan todas menos las Rechazadas.'],
    ['mostrar_ranking_publico', 'SI', 'SI = los vendedores ven el top 10 (sin cédulas).'],
    ['carpeta_fotos_id', '', 'Carpeta de Drive para las fotos. setup() la crea si está vacía.'],
    ['ronda_ranking', '', 'Ronda que muestra la hoja Ranking. Vacío = ronda en juego.'],
    ['dias_sesion', 7, 'Días que dura una sesión antes de pedir login otra vez.'],
    ['monto_maximo_venta', 100000, 'Tope por factura para atajar errores de tipeo.'],
    ['token_api', 'copaprosein', 'Clave que el portal envía en cada solicitud (API_TOKEN en web/config.js). Si la cambias aquí, cámbiala también allá. Vacío = sin clave.'],
  ];
}

/** Claves de versiones anteriores: setup() las borra de Configuracion. */
const CLAVES_OBSOLETAS = [
  'fecha_inicio', 'fecha_fin', 'num_semanas', 'dias_por_semana', 'texto_entrega', 'bloquear_semanas_cerradas',
  'fecha_sorteo', 'premios_semanales', 'sucursales', 'categorias_modo', 'categoria_1_nombre', 'categoria_2_nombre',
  'categoria_3_nombre', 'categoria_1_porcentaje', 'categoria_2_porcentaje', 'categoria_1_min_cupones',
  'categoria_2_min_cupones', 'premios_categoria_1', 'premios_categoria_2', 'premios_categoria_3',
  'viaje_hasta_categoria', 'semana_ranking', 'premios_viaje', 'viaje_requiere_meta',
  'hora_corte', 'bloquear_rondas_cerradas', 'porcentaje_meta_final', 'austral_requiere_meta',
];

// ------------------------------------------------------------
// Web App: entrada y router
// ------------------------------------------------------------

/** GET sirve para probar la URL desde el navegador. */
function doGet(e) {
  const accion = e && e.parameter && e.parameter.action;
  if (accion === 'config') return salidaJson_(enrutar_({ action: 'config', api_token: e.parameter.api_token }));
  return salidaJson_(ok_({ servicio: 'Copa Navideña Austral - Prosein API', estado: 'activo' }));
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
  setCanal: apiDefinirCanal_,
  getDashboard: apiDashboard_,
  addSale: apiAgregarVenta_,
  getRanking: apiRanking_,
  getPhoto: apiFoto_,
  adminResumen: apiAdminResumen_,
  adminVendedores: apiAdminVendedores_,
  adminVentas: apiAdminVentas_,
  adminRonda: apiAdminRonda_,
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
  const perfil = validarPerfil_(req.canal, req.sucursal, cfg);
  const clave = validarClave_(req.password);

  conBloqueo_(function () {
    const usuarios = leerUsuarios_({ fresco: true });
    if (buscarUsuario_(usuarios, cedula)) {
      throw errorApi_('DUPLICATE', 'Esta cédula ya está registrada. Ingresa con tu contraseña.', { campo: 'cedula' });
    }
    const salt = generarSalt_();
    escribirFilaUsuario_({
      cedula: cedula,
      nombre: nombre,
      apellido: apellido,
      telefono: telefono,
      sucursal_o_zona: perfil.tienda,
      password_hash: hashClave_(clave, salt),
      salt: salt,
      fecha_registro: new Date(),
      estado: ESTADO_USUARIO.ACTIVO,
      intentos_fallidos: 0,
      bloqueado_hasta: '',
      rol: ROL.VENDEDOR,
      canal: perfil.canal,
    });
  });

  const sesion = crearSesion_(cedula, cfg);
  const usuario = { cedula: cedula, nombre: nombre, apellido: apellido, sucursal: perfil.tienda, canal: perfil.canal, rol: ROL.VENDEDOR };
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

/** Para cuentas sin canal o sin tienda válida (creadas antes de que fueran obligatorios). */
function apiDefinirCanal_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  if (usuario.rol === ROL.ADMIN) throw errorApi_('FORBIDDEN', 'Las cuentas de administrador no tienen canal.');
  const perfil = validarPerfil_(req.canal, req.sucursal, cfg);
  const actual = perfilUsuario_(usuario, cfg);
  if (actual && (actual.canal !== perfil.canal || actual.tienda !== perfil.tienda)) {
    throw errorApi_('FORBIDDEN', 'Tu canal ya está registrado (' + textoPerfil_(actual) + '). Si cambiaste de tienda o de canal, habla con el coordinador.');
  }
  conBloqueo_(function () {
    const u = buscarUsuario_(leerUsuarios_({ fresco: true }), usuario.cedula);
    const sh = hoja_(HOJA.USUARIOS);
    const mapa = mapaColumnas_(sh);
    sh.getRange(u.fila, mapa.sucursal_o_zona).setValue(perfil.tienda);
    sh.getRange(u.fila, mapa.canal).setValue(perfil.canal);
    invalidarTabla_(HOJA.USUARIOS);
  });
  usuario.sucursal = perfil.tienda;
  usuario.canal = perfil.canal;
  return ok_({ usuario: usuarioPublico_(usuario, cfg) });
}

/** Avance de la meta de su tienda o canal (informativo). */
function metaPublica_(v) {
  const meta = v.metaCentavos;
  return {
    definida: meta > 0,
    meta: centavosADolares_(meta),
    vendido: centavosADolares_(v.totalCentavos),
    avance: meta > 0 ? v.totalCentavos / meta : 0,
  };
}

function finalPublico_(v, cfg) {
  const N = cfg.cupones_por_cupon_final;
  return {
    cupones: v.cuponesFinal,
    austral: v.ticketsAustralFinal,
    mejor_vendedor: v.ticketsMejorVendedor,
    rondas_mejor_vendedor: v.mejorVendedor.map(function (m) { return m.nombre_ronda; }),
    total: v.ticketsFinal,
    por_cada: N,
    faltan_para_proximo: N - (v.cupones % N),
  };
}

function apiDashboard_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  const registros = leerRegistros_();
  const usuarios = leerUsuarios_();
  const stats = calcularEstadisticas_(registros, cfg, usuarios);
  const ronda = rondaActual_(cfg);
  const yo = stats.vendedores[usuario.cedula] || vendedorVacio_(usuario.cedula, reglaDe_(usuario, cfg), cfg);
  const M = yo.montoPorCuponCentavos;
  const MA = yo.m2PorCuponCentesimas;

  const propios = registros.filter(function (r) { return r.cedula === usuario.cedula; });
  propios.sort(function (a, b) { return b.fechaCarga - a.fechaCarga; });
  const pendientes = propios.filter(function (r) { return r.estado === ESTADO.PENDIENTE; });

  const enRonda = ronda.numero ? yo.rondas[ronda.numero] : null;
  const resumen = {
    cupones: yo.cupones,
    total: centavosADolares_(yo.totalCentavos),
    m2: yo.m2Centesimas / 100,
    monto_por_cupon: centavosADolares_(M),
    sobrante: centavosADolares_(yo.sobranteCentavos),
    falta_para_proximo: centavosADolares_(M - yo.sobranteCentavos),
    progreso: M ? yo.sobranteCentavos / M : 0,
    ventas_pendientes: pendientes.length,
    monto_pendiente: centavosADolares_(pendientes.reduce(function (t, r) { return t + r.montoCentavos; }, 0)),
    ronda: {
      numero: ronda.numero,
      nombre: ronda.nombre,
      con_sorteo: ronda.con_sorteo,
      cupones: enRonda ? enRonda.cupones : 0,
      monto: enRonda ? centavosADolares_(enRonda.montoCentavos) : 0,
    },
    meta: metaPublica_(yo),
    final: finalPublico_(yo, cfg),
    austral: {
      m2: yo.m2Centesimas / 100,
      cupones: yo.cuponesAustral,
      m2_por_cupon: MA / 100,
      sobrante: yo.sobranteM2Centesimas / 100,
      falta: (MA - yo.sobranteM2Centesimas) / 100,
      progreso: MA ? yo.sobranteM2Centesimas / MA : 0,
    },
  };

  let ranking = null;
  if (cfg.mostrar_ranking_publico) {
    ranking = rankingPublico_(stats, usuarios, cfg, ronda.numero, usuario.cedula);
    if (ranking.ronda && ranking.ronda.mi_posicion) resumen.ronda.posicion = ranking.ronda.mi_posicion;
  }

  return ok_({
    usuario: usuarioPublico_(usuario, cfg),
    concurso: configPublica_(cfg),
    resumen: resumen,
    cupones: yo.detalleCupones.map(function (c) { return cuponPublico_(c, M); }),
    cupones_austral: yo.detalleAustral.map(function (c) { return cuponAustralPublico_(c, MA); }),
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
  if (hoyISO_() > cfg.fecha_fin) {
    throw errorApi_('CLOSED', 'La Copa terminó el ' + fechaCorta_(cfg.fecha_fin) + '. Ya no se registran ventas.');
  }
  if (!perfilUsuario_(usuario, cfg)) {
    throw errorApi_('NEED_CANAL', 'Elige tu canal (y tu tienda) antes de registrar ventas.');
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
  const usuarios = leerUsuarios_();
  const regla = reglaDe_(usuario, cfg);

  let antes, nuevo, registros;
  try {
    conBloqueo_(function () {
      registros = leerRegistros_({ fresco: true });
      verificarFacturaUnica_(registros, factura.normalizada, usuario.cedula, factura.texto);
      antes = calcularEstadisticas_(registros, cfg, usuarios).vendedores[usuario.cedula] || vendedorVacio_(usuario.cedula, regla, cfg);

      nuevo = {
        id: siguienteId_(registros),
        fechaCarga: ahora_(),
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
  const despues = calcularEstadisticas_(registros, cfg, usuarios).vendedores[usuario.cedula] || vendedorVacio_(usuario.cedula, regla, cfg);
  const ronda = rondaDeCarga_(nuevo.fechaCarga, cfg);
  const M = despues.montoPorCuponCentavos;
  const MA = despues.m2PorCuponCentesimas;

  return ok_({
    registro: registroPublico_(nuevo),
    pendiente_aprobacion: cfg.contar_solo_aprobadas,
    cupones_antes: antes.cupones,
    cupones_despues: despues.cupones,
    cupones_nuevos: Math.max(0, despues.cupones - antes.cupones),
    nuevos_cupones: despues.detalleCupones.slice(antes.cupones).map(function (c) { return cuponPublico_(c, M); }),
    acumulado: centavosADolares_(despues.totalCentavos),
    sobrante: centavosADolares_(despues.sobranteCentavos),
    sobrante_antes: centavosADolares_(antes.sobranteCentavos),
    falta_para_proximo: centavosADolares_(M - despues.sobranteCentavos),
    monto_por_cupon: centavosADolares_(M),
    ronda: ronda ? { numero: ronda.numero, nombre: ronda.nombre, con_sorteo: ronda.con_sorteo } : null,
    cupones_ronda: ronda && despues.rondas[ronda.numero] ? despues.rondas[ronda.numero].cupones : 0,
    cupones_final_antes: antes.cuponesFinal,
    cupones_final_despues: despues.cuponesFinal,
    meta: metaPublica_(despues),
    final: finalPublico_(despues, cfg),
    m2_total: despues.m2Centesimas / 100,
    austral_antes: antes.cuponesAustral,
    austral_despues: despues.cuponesAustral,
    austral_nuevos: Math.max(0, despues.cuponesAustral - antes.cuponesAustral),
    nuevos_cupones_austral: despues.detalleAustral.slice(antes.cuponesAustral).map(function (c) { return cuponAustralPublico_(c, MA); }),
    m2_sobrante: despues.sobranteM2Centesimas / 100,
    m2_sobrante_antes: antes.sobranteM2Centesimas / 100,
    m2_falta: (MA - despues.sobranteM2Centesimas) / 100,
    m2_por_cupon: MA / 100,
  });
}

function apiRanking_(req) {
  const usuario = requerirUsuario_(req.token);
  const cfg = leerConfig_();
  if (!cfg.mostrar_ranking_publico) throw errorApi_('FORBIDDEN', 'El ranking no está publicado.');
  const usuarios = leerUsuarios_();
  const stats = calcularEstadisticas_(leerRegistros_(), cfg, usuarios);
  let ronda = parseInt(req.ronda, 10);
  if (!(ronda >= 1 && ronda <= cfg.rondas.length)) ronda = rondaActual_(cfg).numero;
  return ok_(rankingPublico_(stats, usuarios, cfg, ronda, usuario.cedula));
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
  const stats = calcularEstadisticas_(registros, cfg, usuarios);
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  return { cfg: cfg, registros: registros, usuarios: usuarios, stats: stats, porCedula: porCedula };
}

/** "Boleíta" para tiendas, "Distribuidores" o "Corporativo" para los otros canales. */
function grupoDe_(perfil) {
  if (!perfil) return 'Sin canal';
  return perfil.canal === CANAL.TIENDA ? perfil.tienda : ETIQUETA_CANAL[perfil.canal];
}

function apiAdminResumen_(req) {
  requerirAdmin_(req.token);
  const x = contextoAdmin_();
  const cfg = x.cfg;
  const vendedores = valores_(x.stats.vendedores);
  const suma = function (lista, fn) { return lista.reduce(function (t, v) { return t + fn(v); }, 0); };
  const cuentan = x.registros.filter(function (r) { return registroCuenta_(r, cfg); });
  const porEstado = function (e) { return x.registros.filter(function (r) { return r.estado === e; }).length; };
  const vendedoresActivos = x.usuarios.filter(function (u) { return u.rol !== ROL.ADMIN; });

  const totales = {
    vendedores_registrados: vendedoresActivos.length,
    vendedores_con_ventas: vendedores.filter(function (v) { return v.totalCentavos > 0; }).length,
    ventas: x.registros.length,
    pendientes: porEstado(ESTADO.PENDIENTE),
    aprobadas: porEstado(ESTADO.APROBADA),
    rechazadas: porEstado(ESTADO.RECHAZADA),
    monto: centavosADolares_(suma(cuentan, function (r) { return r.montoCentavos; })),
    cupones: suma(vendedores, function (v) { return v.cupones; }),
    cupones_mejor_vendedor: suma(vendedores, function (v) { return v.ticketsMejorVendedor; }),
    cupones_final: suma(vendedores, function (v) { return v.cuponesFinal; }),
    tickets_austral_final: suma(vendedores, function (v) { return v.ticketsAustralFinal; }),
    m2: suma(vendedores, function (v) { return v.m2Centesimas; }) / 100,
    cupones_austral: suma(vendedores, function (v) { return v.cuponesAustral; }),
  };

  // Una fila por tienda y por canal (Distribuidores, Corporativo), en el orden de la hoja Canales.
  const grupos = {};
  const orden = [];
  const grupo = function (nombre, canal, regla) {
    if (!grupos[nombre]) {
      grupos[nombre] = {
        nombre: nombre, canal: canal,
        monto_por_cupon: regla ? centavosADolares_(regla.montoCentavos) : 0,
        meta: regla ? centavosADolares_(regla.metaCentavos) : 0,
        m2_por_cupon_austral: regla ? regla.m2Centesimas / 100 : 0,
        vendedores: 0, con_ventas: 0, ventas: 0, monto: 0, cupones: 0, cupones_final: 0, m2: 0,
      };
      orden.push(nombre);
    }
    return grupos[nombre];
  };
  cfg.canales.forEach(function (r) { grupo(r.canal === CANAL.TIENDA ? r.tienda : ETIQUETA_CANAL[r.canal], r.canal, r); });
  const grupoUsuario = function (cedula) {
    const u = x.porCedula[cedula];
    const perfil = u ? perfilUsuario_(u, cfg) : null;
    return grupo(grupoDe_(perfil), perfil ? perfil.canal : '', null);
  };
  vendedoresActivos.forEach(function (u) { grupoUsuario(u.cedula).vendedores++; });
  cuentan.forEach(function (r) {
    const g = grupoUsuario(r.cedula);
    g.ventas++;
    g.monto += r.montoCentavos;
    g.m2 += r.m2Centesimas;
  });
  vendedores.forEach(function (v) {
    const g = grupoUsuario(v.cedula);
    if (v.totalCentavos > 0) g.con_ventas++;
    g.cupones += v.cupones;
    g.cupones_final += v.ticketsFinal;
  });

  const ahora = ahora_();
  const actual = rondaActual_(cfg);
  return ok_({
    concurso: configPublica_(cfg),
    totales: totales,
    canales: orden.map(function (n) {
      const g = grupos[n];
      return Object.assign({}, g, { monto: centavosADolares_(g.monto), m2: g.m2 / 100 });
    }).filter(function (g) { return g.nombre !== 'Sin canal' || g.vendedores || g.ventas; }),
    rondas: cfg.rondas.map(function (p) {
      const lista = rankingRonda_(x.stats, p.numero);
      return {
        numero: p.numero, nombre: p.nombre, inicio: p.inicio, fin: p.fin, corte: p.corte, sorteo: p.sorteo, con_sorteo: p.con_sorteo,
        estado: p.corte <= ahora ? 'cerrada' : (p.numero === actual.numero ? 'en_juego' : 'pendiente'),
        participantes: lista.length,
        cupones: suma(lista, function (y) { return y.s.cupones; }),
        mejores: mejoresPublicos_(x.stats, p.numero, x.porCedula),
      };
    }),
    bolsas: armarBolsas_(x.stats, x.usuarios, cfg).map(resumenBolsa_),
  });
}

/** Ganadores del cupón de mejor vendedor de una ronda (uno por canal). */
function mejoresPublicos_(stats, ronda, porCedula) {
  return stats.mejores.filter(function (m) { return m.ronda === ronda; }).map(function (m) {
    const u = porCedula[m.cedula];
    return { canal: ETIQUETA_CANAL[m.canal], cedula: m.cedula, nombre: u ? nombreCorto_(u) : m.cedula, monto: centavosADolares_(m.montoCentavos) };
  });
}

function apiAdminVendedores_(req) {
  requerirAdmin_(req.token);
  const x = contextoAdmin_();
  const cfg = x.cfg;
  const actual = rondaActual_(cfg).numero;
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
    const perfil = u ? perfilUsuario_(u, cfg) : null;
    const v = x.stats.vendedores[cedula] || vendedorVacio_(cedula, u ? reglaDe_(u, cfg) : null, cfg);
    const r = ventasPor[cedula] || { ventas: 0, pendientes: 0, rechazadas: 0, nombre: '' };
    return {
      cedula: cedula,
      nombre: u ? u.nombre + ' ' + u.apellido : r.nombre || '(sin registro)',
      telefono: u ? u.telefono : '',
      canal: perfil ? perfil.canal : '',
      grupo: grupoDe_(perfil),
      sucursal: perfil ? perfil.tienda : '',
      estado: u ? u.estado : 'sin registro',
      ventas: r.ventas,
      pendientes: r.pendientes,
      rechazadas: r.rechazadas,
      total: centavosADolares_(v.totalCentavos),
      monto_por_cupon: centavosADolares_(v.montoPorCuponCentavos),
      cupones: v.cupones,
      cupones_ronda: actual && v.rondas[actual] ? v.rondas[actual].cupones : 0,
      meta: centavosADolares_(v.metaCentavos),
      avance: v.metaCentavos > 0 ? v.totalCentavos / v.metaCentavos : 0,
      cupones_final: v.cuponesFinal,
      m2: v.m2Centesimas / 100,
      m2_por_cupon_austral: v.m2PorCuponCentesimas / 100,
      cupones_austral: v.cuponesAustral,
      cupones_mejor_vendedor: v.ticketsMejorVendedor,
      tickets_final: v.ticketsFinal,
    };
  });
  lista.sort(function (a, b) { return (b.cupones - a.cupones) || (b.total - a.total) || compararTexto_(a.nombre, b.nombre); });
  return ok_({ vendedores: lista, grupos: cfg.canales.map(function (r) { return r.canal === CANAL.TIENDA ? r.tienda : ETIQUETA_CANAL[r.canal]; }), ronda_actual: actual });
}

function apiAdminVentas_(req) {
  requerirAdmin_(req.token);
  const cfg = leerConfig_();
  const usuarios = leerUsuarios_();
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const ventas = leerRegistros_().slice().sort(function (a, b) { return b.fechaCarga - a.fechaCarga; }).map(function (r) {
    const u = porCedula[r.cedula];
    const perfil = u ? perfilUsuario_(u, cfg) : null;
    const base = registroPublico_(r);
    base.cedula = r.cedula;
    base.vendedor = u ? u.nombre + ' ' + u.apellido : r.nombre;
    base.grupo = grupoDe_(perfil);
    base.ronda = rondaDeCarga_(r.fechaCarga, cfg).numero;
    base.cuenta = registroCuenta_(r, cfg);
    return base;
  });
  return ok_({
    ventas: ventas,
    grupos: cfg.canales.map(function (r) { return r.canal === CANAL.TIENDA ? r.tienda : ETIQUETA_CANAL[r.canal]; }),
    rondas: cfg.rondas.map(function (p) { return { numero: p.numero, nombre: p.nombre }; }),
  });
}

function apiAdminRonda_(req) {
  requerirAdmin_(req.token);
  const x = contextoAdmin_();
  const cfg = x.cfg;
  let n = parseInt(req.ronda, 10);
  if (!(n >= 1 && n <= cfg.rondas.length)) n = rondaActual_(cfg).numero || 1;
  const p = cfg.rondas[n - 1];
  return ok_({
    numero: n, nombre: p.nombre, inicio: p.inicio, fin: p.fin, corte: p.corte, sorteo: p.sorteo, con_sorteo: p.con_sorteo,
    cerrada: p.corte <= ahora_(),
    mejores: mejoresPublicos_(x.stats, n, x.porCedula),
    lista: rankingRonda_(x.stats, n).map(function (y, i) {
      const u = x.porCedula[y.v.cedula];
      return {
        pos: i + 1,
        cedula: y.v.cedula,
        nombre: u ? nombreCorto_(u) : '',
        grupo: grupoDe_(u ? perfilUsuario_(u, cfg) : null),
        cupones: y.s.cupones,
        monto: centavosADolares_(y.s.montoCentavos),
      };
    }),
    total_rondas: cfg.rondas.length,
  });
}

/** Cupones listos para imprimir y meter en la bolsa de cada sorteo. */
function apiAdminCupones_(req) {
  requerirAdmin_(req.token);
  const x = contextoAdmin_();
  const bolsas = armarBolsas_(x.stats, x.usuarios, x.cfg);
  const pedida = String(req.bolsa || req.urna || 'todas');
  const elegidas = pedida === 'todas' ? bolsas : bolsas.filter(function (b) { return b.id === pedida; });
  if (!elegidas.length) throw errorApi_('NOT_FOUND', 'Ese sorteo no existe.');
  const ahora = ahora_();
  return ok_({
    concurso: x.cfg.nombre_concurso,
    sorteo: x.cfg.nombre_sorteo,
    generado: Date.now(),
    bolsas: elegidas.map(function (b) { return Object.assign({ provisional: b.corte > ahora }, b); }),
  });
}

// ------------------------------------------------------------
// Cálculo de cupones, rondas, metas y bolsas (todo desde Registros)
// ------------------------------------------------------------

/** ¿Este registro suma para cupones y rankings? */
function registroCuenta_(r, cfg) {
  return cfg.contar_solo_aprobadas ? r.estado === ESTADO.APROBADA : r.estado !== ESTADO.RECHAZADA;
}

/**
 * Estadísticas por vendedor.
 *  - El valor del cupón (M), la meta y los m² o piezas de Austral por cupón (MA) salen
 *    de su canal o tienda (hoja Canales).
 *  - Las ventas se acumulan en el orden en que se registraron. cupones = floor(acumulado / M).
 *    El sobrante nunca se pierde.
 *  - Cupones de la ronda r = cupones completados con ventas registradas durante r. La ronda
 *    sale de la fecha de registro (fecha_carga): lo registrado después del último día de una
 *    ronda cuenta para la siguiente.
 *  - Gran Sorteo Final: floor(cupones / cupones_por_cupon_final) + 1 cupón por cada
 *    MA m² o piezas de Austral + 1 por cada ronda con sorteo (ya cerrada) en la que fue el
 *    que más vendió de su canal.
 *  - Cada cupón queda ligado a la factura que lo completó.
 * Todo en centavos (y centésimas de m²) para evitar errores de redondeo.
 */
function calcularEstadisticas_(registros, cfg, usuarios) {
  const usuarioDe = {};
  (usuarios || []).forEach(function (u) { usuarioDe[u.cedula] = u; });
  const porCedula = {};
  registros.forEach(function (r) {
    if (!r.cedula || !registroCuenta_(r, cfg)) return;
    (porCedula[r.cedula] = porCedula[r.cedula] || []).push(r);
  });

  const vendedores = {};
  Object.keys(porCedula).forEach(function (cedula) {
    const u = usuarioDe[cedula];
    const v = vendedorVacio_(cedula, u ? reglaDe_(u, cfg) : null, cfg);
    const M = v.montoPorCuponCentavos;
    const MA = v.m2PorCuponCentesimas;
    const ventas = porCedula[cedula].slice().sort(compararCronologico_);
    let acumulado = 0;
    let acumuladoM2 = 0;
    ventas.forEach(function (r) {
      const antes = Math.floor(acumulado / M);
      acumulado += r.montoCentavos;
      const despues = Math.floor(acumulado / M);
      const ronda = rondaDeCarga_(r.fechaCarga, cfg).numero;
      const s = v.rondas[ronda] || (v.rondas[ronda] = { montoCentavos: 0, cupones: 0, m2Centesimas: 0, ultimaCarga: 0 });
      s.montoCentavos += r.montoCentavos;
      s.m2Centesimas += r.m2Centesimas;
      s.cupones += despues - antes;
      s.ultimaCarga = Math.max(s.ultimaCarga, r.fechaCarga);
      v.ultimaCarga = Math.max(v.ultimaCarga, r.fechaCarga);
      for (let n = antes + 1; n <= despues; n++) {
        v.detalleCupones.push({
          n: n, diaVenta: r.diaVenta, factura: r.factura, ronda: ronda, registroId: r.id, fechaCarga: r.fechaCarga,
          montoCentavos: r.montoCentavos, acumuladoCentavos: acumulado,
        });
      }
      if (r.m2Centesimas > 0) {
        const antesA = Math.floor(acumuladoM2 / MA);
        acumuladoM2 += r.m2Centesimas;
        const despuesA = Math.floor(acumuladoM2 / MA);
        for (let n = antesA + 1; n <= despuesA; n++) {
          v.detalleAustral.push({
            n: n, diaVenta: r.diaVenta, factura: r.factura, ronda: ronda, registroId: r.id, fechaCarga: r.fechaCarga,
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

  const mejores = mejoresVendedores_(vendedores, usuarioDe, cfg);
  mejores.forEach(function (m) { vendedores[m.cedula].mejorVendedor.push(m); });
  valores_(vendedores).forEach(function (v) { completarFinal_(v, cfg); });
  return { vendedores: vendedores, mejores: mejores };
}

/**
 * El que más vendió (monto) en cada ronda con sorteo, por canal (Tiendas, Distribuidores,
 * Corporativo). Solo rondas ya cerradas. Empate: quien llegó primero a ese monto.
 */
function mejoresVendedores_(vendedores, usuarioDe, cfg) {
  const ahora = ahora_();
  const lista = [];
  cfg.rondas.forEach(function (p) {
    if (!p.con_sorteo || p.corte > ahora) return;
    const lider = {};
    valores_(vendedores).forEach(function (v) {
      const s = v.rondas[p.numero];
      const perfil = perfilUsuario_(usuarioDe[v.cedula], cfg);
      if (!s || !(s.montoCentavos > 0) || !perfil) return;
      const actual = lider[perfil.canal];
      if (!actual || s.montoCentavos > actual.s.montoCentavos ||
        (s.montoCentavos === actual.s.montoCentavos && (s.ultimaCarga < actual.s.ultimaCarga ||
          (s.ultimaCarga === actual.s.ultimaCarga && compararTexto_(v.cedula, actual.v.cedula) < 0)))) {
        lider[perfil.canal] = { v: v, s: s };
      }
    });
    CANALES.forEach(function (c) {
      const x = lider[c];
      if (x) lista.push({ ronda: p.numero, nombre_ronda: p.nombre, canal: c, cedula: x.v.cedula, montoCentavos: x.s.montoCentavos, fechaCarga: x.s.ultimaCarga });
    });
  });
  return lista;
}

/** Cupones del Gran Sorteo Final: 1 cada N cupones, los de Austral y los de mejor vendedor. */
function completarFinal_(v, cfg) {
  v.cuponesFinal = Math.floor(v.cupones / cfg.cupones_por_cupon_final);
  v.ticketsAustralFinal = v.cuponesAustral;
  v.ticketsMejorVendedor = v.mejorVendedor.length;
  v.ticketsFinal = v.cuponesFinal + v.ticketsAustralFinal + v.ticketsMejorVendedor;
}

function vendedorVacio_(cedula, regla, cfg) {
  const r = regla || { montoCentavos: cfg.monto_por_cupon_centavos, metaCentavos: 0, m2Centesimas: cfg.m2_por_cupon_austral_centesimas };
  const v = {
    cedula: cedula, totalCentavos: 0, m2Centesimas: 0, cupones: 0, sobranteCentavos: 0, detalleCupones: [],
    cuponesAustral: 0, sobranteM2Centesimas: 0, detalleAustral: [], rondas: {}, ultimaCarga: 0, mejorVendedor: [],
    montoPorCuponCentavos: r.montoCentavos, metaCentavos: r.metaCentavos,
    m2PorCuponCentesimas: r.m2Centesimas || cfg.m2_por_cupon_austral_centesimas,
  };
  completarFinal_(v, cfg);
  return v;
}

/** Orden en que se registraron las ventas (así se acumulan los cupones). */
function compararCronologico_(a, b) {
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

/** Austral: m² ↓ (más m² = más tickets Austral). Desempate: monto total. */
function rankingAustral_(stats) {
  return valores_(stats.vendedores)
    .filter(function (v) { return v.m2Centesimas > 0; })
    .sort(function (a, b) {
      return (b.m2Centesimas - a.m2Centesimas) || (b.totalCentavos - a.totalCentavos) || (a.ultimaCarga - b.ultimaCarga);
    });
}

/** Cupones completados en una ronda ↓, venta de la ronda ↓, quien llegó primero. Con 0 cupones no aparece. */
function rankingRonda_(stats, ronda) {
  return valores_(stats.vendedores)
    .map(function (v) { return { v: v, s: v.rondas[ronda] }; })
    .filter(function (x) { return x.s && x.s.cupones > 0; })
    .sort(function (a, b) {
      return (b.s.cupones - a.s.cupones) || (b.s.montoCentavos - a.s.montoCentavos) || (a.s.ultimaCarga - b.s.ultimaCarga);
    });
}

/**
 * Bolsas de los sorteos: una por cada ronda con sorteo (cupones completados
 * en esa ronda) y el Gran Sorteo Final: 1 cupón cada N, los cupones Austral y los de
 * mejor vendedor. Cada cupón lleva un código único dentro de su bolsa (R1-0001, F-0001).
 */
function armarBolsas_(stats, usuarios, cfg) {
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const ultima = cfg.rondas[cfg.rondas.length - 1];
  const bolsas = cfg.rondas.filter(function (p) { return p.con_sorteo; }).map(function (p) {
    return { id: 'r' + p.numero, tipo: 'ronda', ronda: p.numero, nombre: p.nombre, prefijo: 'R' + p.numero, fecha: p.sorteo, corte: p.corte, cupones: [] };
  });
  const porRonda = {};
  bolsas.forEach(function (b) { porRonda[b.ronda] = b; });
  const final = { id: 'final', tipo: 'final', ronda: 0, nombre: 'Gran Sorteo Final', prefijo: 'F', fecha: cfg.fecha_sorteo_final, corte: ultima.corte, cupones: [] };

  valores_(stats.vendedores).forEach(function (v) {
    const u = porCedula[v.cedula];
    const base = {
      cedula: v.cedula,
      vendedor: u ? (u.nombre + ' ' + u.apellido).trim() : v.cedula,
      sucursal: grupoDe_(u ? perfilUsuario_(u, cfg) : null),
    };
    v.detalleCupones.forEach(function (c) {
      const b = porRonda[c.ronda];
      if (b) b.cupones.push(Object.assign({ n: c.n, factura: c.factura, dia_venta: c.diaVenta, _orden: c.fechaCarga }, base));
    });
    for (let n = 1; n <= v.cuponesFinal; n++) {
      final.cupones.push(Object.assign({ origen: 'cupones', n: n, factura: '', dia_venta: '', de: v.cuponesFinal, _orden: 0 }, base));
    }
    v.detalleAustral.forEach(function (c) {
      final.cupones.push(Object.assign({ origen: 'austral', n: c.n, factura: c.factura, dia_venta: c.diaVenta, _orden: c.fechaCarga }, base));
    });
    v.mejorVendedor.forEach(function (m, i) {
      final.cupones.push(Object.assign({ origen: 'mejor_vendedor', n: i + 1, factura: '', dia_venta: '', ronda: m.nombre_ronda, _orden: m.fechaCarga }, base));
    });
  });

  const todas = bolsas.concat([final]);
  todas.forEach(function (b) {
    b.cupones.sort(function (a, c) {
      return (a._orden - c._orden) || compararTexto_(a.vendedor, c.vendedor) || compararTexto_(a.cedula, c.cedula) || (a.n - c.n);
    });
    const ancho = Math.max(4, String(b.cupones.length).length);
    b.cupones.forEach(function (c, i) {
      c.codigo = b.prefijo + '-' + ('000000' + (i + 1)).slice(-ancho);
      delete c._orden;
    });
  });
  return todas;
}

function resumenBolsa_(b) {
  const vendedores = {};
  b.cupones.forEach(function (c) { vendedores[c.cedula] = true; });
  return { id: b.id, tipo: b.tipo, ronda: b.ronda, nombre: b.nombre, fecha: b.fecha, corte: b.corte, vendedores: Object.keys(vendedores).length, cupones: b.cupones.length };
}

function rankingPublico_(stats, usuarios, cfg, numeroRonda, miCedula) {
  const nombres = mapaNombres_(usuarios);
  const nombre = function (cedula) { return nombres[cedula] || 'Vendedor'; };

  const general = rankingGeneral_(stats);
  const austral = rankingAustral_(stats);
  const deRonda = numeroRonda ? rankingRonda_(stats, numeroRonda) : [];
  const posicion = function (lista, fn) {
    for (let i = 0; i < lista.length; i++) if (fn(lista[i]) === miCedula) return i + 1;
    return null;
  };
  const p = numeroRonda ? cfg.rondas[numeroRonda - 1] : null;

  return {
    general: {
      mi_posicion: posicion(general, function (v) { return v.cedula; }),
      participantes: general.length,
      top: general.slice(0, 10).map(function (v, i) {
        return { pos: i + 1, nombre: nombre(v.cedula), cupones: v.cupones, es_tu: v.cedula === miCedula };
      }),
    },
    austral: {
      mi_posicion: posicion(austral, function (v) { return v.cedula; }),
      participantes: austral.length,
      top: austral.slice(0, 10).map(function (v, i) {
        return { pos: i + 1, nombre: nombre(v.cedula), m2: v.m2Centesimas / 100, cupones: v.cuponesAustral, es_tu: v.cedula === miCedula };
      }),
    },
    ronda: p ? {
      numero: p.numero,
      nombre: p.nombre,
      inicio: p.inicio,
      fin: p.fin,
      corte: p.corte,
      sorteo: p.sorteo,
      con_sorteo: p.con_sorteo,
      mi_posicion: posicion(deRonda, function (x) { return x.v.cedula; }),
      participantes: deRonda.length,
      top: deRonda.slice(0, 10).map(function (x, i) {
        return { pos: i + 1, nombre: nombre(x.v.cedula), cupones: x.s.cupones, es_tu: x.v.cedula === miCedula };
      }),
    } : null,
  };
}

// ------------------------------------------------------------
// Rondas (hoja Rondas) y fechas (yyyy-MM-dd, zona Caracas)
// ------------------------------------------------------------

/** Hora actual. Es una función aparte para poder simular otras fechas en las pruebas. */
function ahora_() {
  return Date.now();
}

/** Cierre de una ronda: el final de su último día (00:00 del día siguiente, hora de Caracas). */
function cierreRonda_(finIso) {
  return Utilities.parseDate(sumarDias_(finIso, 1) + ' 00:00', ZONA_HORARIA, 'yyyy-MM-dd HH:mm').getTime();
}

/** Rondas de la hoja Rondas (si está vacía o no existe, el cronograma por defecto). */
function leerRondas_(cfg) {
  let filas = [];
  if (SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA.RONDAS)) {
    filas = leerTablaConCache_(HOJA.RONDAS, function (fs) {
      return fs.map(function (f) {
        return {
          nombre: String(f.nombre || '').trim(),
          inicio: aISO_(f.inicio),
          fin: aISO_(f.fin),
          sorteo: aISO_(f.sorteo),
        };
      }).filter(function (p) { return p.inicio && p.fin; });
    });
  }
  const base = filas.length ? filas : RONDAS_POR_DEFECTO;
  const lista = base.slice().sort(function (a, b) { return compararTexto_(a.inicio, b.inicio); });
  lista.forEach(function (p, i) {
    if (p.fin < p.inicio) throw errorApi_('SERVER', 'Hoja Rondas: la ronda ' + (i + 1) + ' termina antes de empezar.');
    if (i > 0 && p.inicio <= lista[i - 1].fin) throw errorApi_('SERVER', 'Hoja Rondas: las rondas ' + i + ' y ' + (i + 1) + ' se solapan.');
  });
  let sorteos = 0;
  return lista.map(function (p, i) {
    const conSorteo = !!p.sorteo;
    if (conSorteo) sorteos++;
    return {
      numero: i + 1,
      nombre: p.nombre || 'Ronda ' + (i + 1),
      inicio: p.inicio,
      fin: p.fin,
      corte: cierreRonda_(p.fin),
      sorteo: p.sorteo || '',
      con_sorteo: conSorteo,
      numero_sorteo: conSorteo ? sorteos : 0,
    };
  });
}

function rondaDe_(iso, cfg) {
  for (let i = 0; i < cfg.rondas.length; i++) {
    const p = cfg.rondas[i];
    if (iso >= p.inicio && iso <= p.fin) return p;
  }
  return null;
}

/** Número de ronda de un día (0 = fuera de las rondas). */
function rondaNumeroDe_(iso, cfg) {
  const p = rondaDe_(iso, cfg);
  return p ? p.numero : 0;
}

/**
 * Ronda de una venta según la fecha en que se registró en el portal: la primera ronda
 * que no había cerrado. Lo registrado después del último día de una ronda pasa a la siguiente.
 */
function rondaDeCarga_(ms, cfg) {
  const iso = Utilities.formatDate(new Date(ms), ZONA_HORARIA, 'yyyy-MM-dd');
  for (let i = 0; i < cfg.rondas.length; i++) {
    if (iso <= cfg.rondas[i].fin) return cfg.rondas[i];
  }
  return cfg.rondas[cfg.rondas.length - 1];
}

/**
 * Ronda "en juego": la primera que no ha cerrado (cierra al terminar su último día).
 * estado: antes · proxima · en_curso · terminado.
 */
function rondaActual_(cfg) {
  const ps = cfg.rondas;
  const total = ps.length;
  const hoy = hoyISO_();
  const ahora = ahora_();
  const describir = function (p, estado) {
    return {
      numero: estado === 'antes' ? 0 : p.numero, total: total, total_sorteos: cfg.total_sorteos, estado: estado,
      nombre: p.nombre, con_sorteo: p.con_sorteo, numero_sorteo: p.numero_sorteo,
      inicio: p.inicio, fin: p.fin, corte: p.corte, sorteo: p.sorteo,
    };
  };
  if (hoy < ps[0].inicio) return describir(ps[0], 'antes');
  for (let i = 0; i < total; i++) {
    const p = ps[i];
    if (p.corte > ahora) return describir(p, hoy < p.inicio ? 'proxima' : hoy > p.fin ? 'en_corte' : 'en_curso');
  }
  return describir(ps[total - 1], 'terminado');
}

/**
 * Días que se pueden elegir en el formulario de venta: cualquier día de la campaña
 * hasta hoy. Se puede registrar mientras la campaña no haya terminado.
 */
function rangoCarga_(cfg) {
  const hoy = hoyISO_();
  const min = cfg.fecha_inicio;
  if (hoy > cfg.fecha_fin || hoy < min) return { min: min, max: '' };
  return { min: min, max: hoy };
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


/** Nombres anteriores del concurso: si la hoja aún los tiene, se usa el nombre nuevo. */
const NOMBRES_ANTERIORES = ['copa prosein', 'la bolsa de los deseos'];

function nombreVigente_(valor, porDefecto) {
  return !valor || NOMBRES_ANTERIORES.indexOf(valor.toLowerCase()) >= 0 ? porDefecto : valor;
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
  if (nombre === HOJA.CONFIG || nombre === HOJA.RONDAS || nombre === HOJA.CANALES) delete MEMO_.cfg;
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
      if (v instanceof Date) o[clave] = aISO_(v);
      else o[clave] = v;
    });
    return o;
  });

  const texto = function (clave, porDefecto) {
    const v = crudo[clave];
    return v === undefined || v === null ? porDefecto : String(v).trim();
  };
  const cfg = {
    nombre_concurso: nombreVigente_(texto('nombre_concurso', ''), 'Copa Navideña Austral - Prosein'),
    nombre_sorteo: nombreVigente_(texto('nombre_sorteo', ''), 'Copa Navideña'),
    fecha_sorteo_final: aISO_(crudo.fecha_sorteo_final) || '2026-12-21',
    monto_por_cupon: numeroO_(crudo.monto_por_cupon, 1500),
    cupones_por_cupon_final: Math.max(1, Math.floor(numeroO_(crudo.cupones_por_cupon_final, 10))),
    m2_por_cupon_austral: numeroO_(crudo.m2_por_cupon_austral, 80),
    moneda: texto('moneda', '') || 'USD',
    concurso_abierto: esSi_(crudo.concurso_abierto),
    contar_solo_aprobadas: esSi_(crudo.contar_solo_aprobadas),
    mostrar_ranking_publico: esSi_(crudo.mostrar_ranking_publico),
    carpeta_fotos_id: texto('carpeta_fotos_id', ''),
    ronda_ranking: parseInt(crudo.ronda_ranking, 10) || 0,
    dias_sesion: Math.max(1, numeroO_(crudo.dias_sesion, 7)),
    monto_maximo_venta: numeroO_(crudo.monto_maximo_venta, 100000),
    token_api: texto('token_api', ''),
  };
  cfg.monto_por_cupon_centavos = Math.round(cfg.monto_por_cupon * 100);
  if (!(cfg.monto_por_cupon_centavos > 0)) throw errorApi_('SERVER', 'monto_por_cupon en Configuracion debe ser mayor que 0.');
  if (!(cfg.m2_por_cupon_austral > 0)) cfg.m2_por_cupon_austral = 80;
  cfg.m2_por_cupon_austral_centesimas = Math.round(cfg.m2_por_cupon_austral * 100);

  cfg.canales = leerCanales_(cfg);
  cfg.sucursales = cfg.canales.filter(function (r) { return r.canal === CANAL.TIENDA; }).map(function (r) { return r.tienda; });
  cfg.reglas = {};
  cfg.canales.forEach(function (r) { cfg.reglas[claveRegla_(r.canal, r.tienda)] = r; });

  cfg.rondas = leerRondas_(cfg);
  if (!cfg.rondas.length) throw errorApi_('SERVER', 'No hay rondas configuradas: revisa la hoja Rondas.');
  cfg.total_sorteos = cfg.rondas.filter(function (p) { return p.con_sorteo; }).length;
  cfg.fecha_inicio = cfg.rondas[0].inicio;
  cfg.fecha_fin = cfg.rondas[cfg.rondas.length - 1].fin;
  MEMO_.cfg = cfg;
  return cfg;
}

// ------------------------------------------------------------
// Canales, tiendas, valor del cupón y metas (hoja Canales)
// ------------------------------------------------------------

/** 'Tienda', 'Distribuidor' o 'Corporativo' (acepta plurales, minúsculas y sin acentos). '' si no coincide. */
function canalCanonico_(valor) {
  const t = sinAcentos_(valor);
  if (!t) return '';
  if (t.indexOf('tienda') === 0) return CANAL.TIENDA;
  if (t.indexOf('distrib') === 0) return CANAL.DISTRIBUIDOR;
  if (t.indexOf('corpor') === 0) return CANAL.CORPORATIVO;
  return '';
}

function claveRegla_(canal, tienda) {
  return canal === CANAL.TIENDA ? 'T|' + sinAcentos_(tienda) : canal;
}

/**
 * Filas de la hoja Canales: { canal, tienda, montoCentavos, metaCentavos, m2Centesimas }.
 * Meta vacía = sin meta (la meta es solo informativa). m2_por_cupon_austral vacío = el de
 * Configuracion. Si la hoja no existe o está vacía, se usan las tiendas por defecto.
 */
function leerCanales_(cfg) {
  let filas = [];
  if (SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA.CANALES)) {
    filas = leerTablaConCache_(HOJA.CANALES, function (fs) {
      return fs.map(function (f) {
        const monto = parsearNumero_(f.monto_por_cupon);
        const meta = parsearNumero_(f.meta);
        const m2 = parsearNumero_(f.m2_por_cupon_austral);
        return {
          canal: canalCanonico_(f.canal),
          tienda: String(f.tienda || '').replace(/\s+/g, ' ').trim(),
          monto: isNaN(monto) ? null : monto,
          meta: isNaN(meta) ? null : meta,
          m2: isNaN(m2) ? null : m2,
        };
      }).filter(function (r) { return r.canal && (r.canal !== CANAL.TIENDA || r.tienda); });
    });
  }
  if (!filas.length) filas = canalesPorDefecto_(cfg.monto_por_cupon);
  const m2Base = cfg.m2_por_cupon_austral_centesimas;
  const vistos = {};
  const lista = [];
  filas.forEach(function (f) {
    const clave = claveRegla_(f.canal, f.tienda);
    if (vistos[clave]) return;
    vistos[clave] = true;
    const monto = f.monto > 0 ? Math.round(f.monto * 100) : cfg.monto_por_cupon_centavos;
    lista.push({
      canal: f.canal,
      tienda: f.canal === CANAL.TIENDA ? f.tienda : '',
      montoCentavos: monto,
      metaCentavos: f.meta > 0 ? Math.round(f.meta * 100) : 0,
      m2Centesimas: f.m2 > 0 ? Math.round(f.m2 * 100) : m2Base,
    });
  });
  [CANAL.DISTRIBUIDOR, CANAL.CORPORATIVO].forEach(function (c) {
    if (!vistos[c]) lista.push({ canal: c, tienda: '', montoCentavos: cfg.monto_por_cupon_centavos, metaCentavos: 0, m2Centesimas: c === CANAL.DISTRIBUIDOR ? M2_AUSTRAL_DISTRIBUIDOR * 100 : m2Base });
  });
  return lista;
}

function canalesPorDefecto_(monto) {
  return SUCURSALES_POR_DEFECTO.map(function (t) { return { canal: CANAL.TIENDA, tienda: t, monto: monto, meta: null, m2: null }; })
    .concat([
      { canal: CANAL.DISTRIBUIDOR, tienda: '', monto: monto, meta: null, m2: M2_AUSTRAL_DISTRIBUIDOR },
      { canal: CANAL.CORPORATIVO, tienda: '', monto: monto, meta: null, m2: null },
    ]);
}

/**
 * Canal y tienda válidos de un usuario, o null si le falta algo.
 * Cuentas viejas sin canal pero con una tienda válida quedan en el canal Tienda.
 */
function perfilUsuario_(u, cfg) {
  if (!u || u.rol === ROL.ADMIN) return null;
  const tienda = sucursalCanonica_(u.sucursal, cfg);
  let canal = canalCanonico_(u.canal);
  if (!canal && tienda) canal = CANAL.TIENDA;
  if (!canal || (canal === CANAL.TIENDA && !tienda)) return null;
  return { canal: canal, tienda: canal === CANAL.TIENDA ? tienda : '' };
}

/** Valor del cupón, meta y m² Austral por cupón de un usuario (el respaldo de Configuracion si no tiene canal). */
function reglaDe_(u, cfg) {
  const perfil = perfilUsuario_(u, cfg);
  const regla = perfil ? cfg.reglas[claveRegla_(perfil.canal, perfil.tienda)] : null;
  return regla || { canal: '', tienda: '', montoCentavos: cfg.monto_por_cupon_centavos, metaCentavos: 0, m2Centesimas: cfg.m2_por_cupon_austral_centesimas };
}

function validarPerfil_(canalTexto, tiendaTexto, cfg) {
  const canal = canalCanonico_(canalTexto);
  if (!canal) throw errorCampo_('canal', 'Elige tu canal de ventas.');
  if (canal !== CANAL.TIENDA) return { canal: canal, tienda: '' };
  return { canal: canal, tienda: validarSucursal_(tiendaTexto, cfg) };
}

function textoPerfil_(perfil) {
  return perfil.canal === CANAL.TIENDA ? 'Tienda ' + perfil.tienda : ETIQUETA_CANAL[perfil.canal];
}

function configPublica_(cfg) {
  const ronda = rondaActual_(cfg);
  const carga = rangoCarga_(cfg);
  return {
    nombre: cfg.nombre_concurso,
    nombre_sorteo: cfg.nombre_sorteo,
    fecha_inicio: cfg.fecha_inicio,
    fecha_fin: cfg.fecha_fin,
    fecha_sorteo_final: cfg.fecha_sorteo_final,
    monto_por_cupon: cfg.monto_por_cupon,
    moneda: cfg.moneda,
    concurso_abierto: cfg.concurso_abierto,
    contar_solo_aprobadas: cfg.contar_solo_aprobadas,
    mostrar_ranking_publico: cfg.mostrar_ranking_publico,
    hoy: hoyISO_(),
    rondas: cfg.rondas,
    total_rondas: cfg.rondas.length,
    total_sorteos: cfg.total_sorteos,
    ronda_actual: ronda,
    dia_min_carga: carga.min,
    dia_max_carga: carga.max,
    canales: CANALES.map(function (c) { return { canal: c, etiqueta: ETIQUETA_CANAL[c] }; }),
    sucursales: cfg.sucursales,
    cupones_por_cupon_final: cfg.cupones_por_cupon_final,
    m2_por_cupon_austral: cfg.m2_por_cupon_austral,
    m2_austral_por_canal: CANALES.map(function (c) {
      const valores = cfg.canales.filter(function (r) { return r.canal === c; }).map(function (r) { return r.m2Centesimas / 100; });
      return { canal: c, etiqueta: ETIQUETA_CANAL[c], m2: valores.length ? Math.min.apply(null, valores) : cfg.m2_por_cupon_austral, varia: valores.some(function (m) { return m !== valores[0]; }) };
    }),
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
        canal: String(f.canal || '').trim(),
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
  if (iso < cfg.fecha_inicio || iso > cfg.fecha_fin) {
    throw errorCampo_('dia_venta', 'La fecha debe estar dentro de la campaña: del ' + fechaCorta_(cfg.fecha_inicio) + ' al ' + fechaCorta_(cfg.fecha_fin) + '.');
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
  if (!isFinite(n) || n <= 0) throw errorCampo_('m2_austral', 'Escribe los m² o piezas de Austral (mayor que 0).');
  if (n > 100000) throw errorCampo_('m2_austral', 'Revisa los m² o piezas: la cifra es demasiado alta.');
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
    const carpeta = DriveApp.createFolder('Copa Navideña · Fotos de facturas');
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
  const perfil = admin ? null : perfilUsuario_(u, cfg);
  return {
    nombre: u.nombre,
    apellido: u.apellido,
    cedula_mask: enmascararCedula_(u.cedula),
    canal: perfil ? perfil.canal : '',
    canal_etiqueta: perfil ? ETIQUETA_CANAL[perfil.canal] : '',
    sucursal: perfil ? perfil.tienda : '',
    rol: admin ? ROL.ADMIN : ROL.VENDEDOR,
    necesita_canal: !admin && !perfil,
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

/** Datos de un cupón para volver a mostrar su ticket. M = valor del cupón del vendedor. */
function cuponPublico_(c, M) {
  return {
    n: c.n,
    dia_venta: c.diaVenta,
    factura: c.factura,
    ronda: c.ronda,
    fecha_carga: c.fechaCarga,
    monto: centavosADolares_(c.montoCentavos),
    acumulado: centavosADolares_(c.acumuladoCentavos),
    falta: centavosADolares_(M - (c.acumuladoCentavos % M)),
  };
}

function cuponAustralPublico_(c, MA) {
  return {
    n: c.n,
    dia_venta: c.diaVenta,
    factura: c.factura,
    ronda: c.ronda,
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

/** Crea (o completa) las hojas, formatos, validaciones y la carpeta de fotos. No borra ventas ni usuarios. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(ZONA_HORARIA);

  // Configuracion: agrega las claves que falten, actualiza las descripciones y quita las obsoletas.
  const shCfg = asegurarHoja_(ss, HOJA.CONFIG, ['clave', 'valor', 'descripcion']);
  const existentes = {};
  filasComoObjetos_(shCfg).forEach(function (f) { if (f.clave) existentes[String(f.clave).trim()] = f; });
  const sucursalesViejas = existentes.sucursales ? String(existentes.sucursales.valor || '').split(/[,;\n]/).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(String) : [];
  CLAVES_OBSOLETAS.map(function (c) { return existentes[c] ? existentes[c]._fila : 0; })
    .filter(Boolean).sort(function (a, b) { return b - a; })
    .forEach(function (fila) { shCfg.deleteRow(fila); });
  const vigentes = {};
  filasComoObjetos_(shCfg).forEach(function (f) { if (f.clave) vigentes[String(f.clave).trim()] = f; });
  configuracionPorDefecto_().forEach(function (fila) {
    const actual = vigentes[fila[0]];
    if (!actual) shCfg.appendRow(fila);
    else if (String(actual.descripcion || '') !== fila[2]) shCfg.getRange(actual._fila, 3).setValue(fila[2]);
  });
  // El cupón Austral pasó de 100 a 80 m² o piezas.
  if (vigentes.m2_por_cupon_austral && Number(vigentes.m2_por_cupon_austral.valor) === 100) {
    shCfg.getRange(vigentes.m2_por_cupon_austral._fila, 2).setValue(80);
  }
  shCfg.setColumnWidth(1, 210);
  shCfg.setColumnWidth(2, 260);
  shCfg.setColumnWidth(3, 620);
  const lista = function (valores) { return SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build(); };
  const textoCfg = ['carpeta_fotos_id', 'ronda_ranking', 'token_api', 'nombre_sorteo', 'nombre_concurso'];
  filasComoObjetos_(shCfg).forEach(function (f) {
    const clave = String(f.clave || '').trim();
    const celda = shCfg.getRange(f._fila, 2);
    if (['concurso_abierto', 'contar_solo_aprobadas', 'mostrar_ranking_publico'].indexOf(clave) > -1) celda.setDataValidation(lista(['SI', 'NO']));
    else celda.clearDataValidations();
    if (clave.indexOf('fecha_') === 0) celda.setNumberFormat('dd/mm/yyyy');
    if (textoCfg.indexOf(clave) > -1) celda.setNumberFormat('@');
  });
  MEMO_ = {};
  invalidarTabla_(HOJA.CONFIG);

  // Rondas (acumulación y sorteo; cada ronda cierra al terminar su último día)
  const shRo = asegurarHoja_(ss, HOJA.RONDAS, COLUMNAS_RONDAS);
  const colCorte = mapaColumnas_(shRo).corte;
  if (colCorte) shRo.deleteColumn(colCorte); // ya no hay corte a las 3 p. m.
  formatoColumnas_(shRo, COLUMNAS_RONDAS, { nombre: '@', inicio: 'ddd dd/mm/yyyy', fin: 'ddd dd/mm/yyyy', sorteo: 'ddd dd/mm/yyyy' });
  [70, 140, 150, 150, 150].forEach(function (w, i) { shRo.setColumnWidth(i + 1, w); });
  invalidarTabla_(HOJA.RONDAS);
  if (shRo.getLastRow() < 2) escribirRondas_(RONDAS_POR_DEFECTO);

  // Canales (valor del cupón, meta y m² o piezas Austral por tienda y por canal)
  const existiaM2 = !!(ss.getSheetByName(HOJA.CANALES) && mapaColumnas_(ss.getSheetByName(HOJA.CANALES)).m2_por_cupon_austral);
  const shCa = asegurarHoja_(ss, HOJA.CANALES, COLUMNAS_CANALES);
  formatoColumnas_(shCa, COLUMNAS_CANALES, { tienda: '@', monto_por_cupon: '#,##0.00', meta: '#,##0.00', m2_por_cupon_austral: '#,##0.##' });
  validacionColumna_(shCa, COLUMNAS_CANALES, 'canal', CANALES);
  [130, 180, 150, 150, 190].forEach(function (w, i) { shCa.setColumnWidth(i + 1, w); });
  if (shCa.getLastRow() < 2) {
    const monto = leerConfig_().monto_por_cupon;
    const tiendas = sucursalesViejas.length ? sucursalesViejas : SUCURSALES_POR_DEFECTO;
    const filas = tiendas.map(function (t) { return [CANAL.TIENDA, t, monto, '', '']; })
      .concat([[CANAL.DISTRIBUIDOR, '', monto, '', M2_AUSTRAL_DISTRIBUIDOR], [CANAL.CORPORATIVO, '', monto, '', '']]);
    shCa.getRange(2, 1, filas.length, COLUMNAS_CANALES.length).setValues(filas);
  } else if (!existiaM2) {
    // Columna nueva: los distribuidores necesitan 500 m² o piezas por cupón Austral.
    const mapa = mapaColumnas_(shCa);
    filasComoObjetos_(shCa).forEach(function (f) {
      if (canalCanonico_(f.canal) === CANAL.DISTRIBUIDOR) shCa.getRange(f._fila, mapa.m2_por_cupon_austral).setValue(M2_AUSTRAL_DISTRIBUIDOR);
    });
  }
  invalidarTabla_(HOJA.CANALES);

  HOJAS_OBSOLETAS.forEach(function (nombre) {
    const sh = ss.getSheetByName(nombre);
    if (sh) ss.deleteSheet(sh);
  });

  // Usuarios
  MEMO_ = {};
  const shU = asegurarHoja_(ss, HOJA.USUARIOS, COLUMNAS_USUARIOS);
  formatoColumnas_(shU, COLUMNAS_USUARIOS, {
    cedula: '@', telefono: '@', password_hash: '@', salt: '@',
    fecha_registro: 'dd/mm/yyyy hh:mm', bloqueado_hasta: 'dd/mm/yyyy hh:mm',
  });
  validacionColumna_(shU, COLUMNAS_USUARIOS, 'estado', [ESTADO_USUARIO.ACTIVO, ESTADO_USUARIO.BLOQUEADO]);
  validacionColumna_(shU, COLUMNAS_USUARIOS, 'rol', [ROL.VENDEDOR, ROL.ADMIN]);
  validacionColumna_(shU, COLUMNAS_USUARIOS, 'canal', CANALES, true);
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
  [HOJA.CONFIG, HOJA.RONDAS, HOJA.CANALES, HOJA.REGISTROS, HOJA.USUARIOS, HOJA.RANKING].forEach(function (nombre, i) {
    ss.setActiveSheet(ss.getSheetByName(nombre));
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(shCfg);

  MEMO_ = {};
  invalidarTabla_(HOJA.CONFIG);
  carpetaFotos_(leerConfig_());
  invalidarTabla_(HOJA.CONFIG);
  recalcularRankings_();
  avisar_('Copa Navideña lista', 'Hojas listas. Revisa Configuracion, las fechas de la hoja Rondas y, en la hoja Canales, el valor del cupón, la meta y los m² o piezas de Austral de cada tienda y canal. Luego despliega la aplicación web.');
}

function escribirRondas_(lista) {
  const sh = hoja_(HOJA.RONDAS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, COLUMNAS_RONDAS.length).clearContent();
  if (lista.length) {
    sh.getRange(2, 1, lista.length, COLUMNAS_RONDAS.length).setValues(lista.map(function (p, i) {
      return [i + 1, p.nombre, fechaDesdeISO_(p.inicio), fechaDesdeISO_(p.fin), p.sorteo ? fechaDesdeISO_(p.sorteo) : ''];
    }));
  }
  invalidarTabla_(HOJA.RONDAS);
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
// Menú "Copa Navideña" en el Sheet
// ------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Copa Navideña')
    .addItem('Inicializar hojas', 'setup')
    .addItem('Restaurar rondas (cronograma original)', 'menuRestaurarRondas')
    .addItem('Recalcular rankings', 'menuRecalcularRankings')
    .addItem('Generar cupones para sorteo', 'menuGenerarCupones')
    .addSeparator()
    .addItem('Resultado de una ronda', 'menuResultadoRonda')
    .addItem('Resumen de los sorteos', 'menuResumenSorteo')
    .addSeparator()
    .addItem('Cargar datos de prueba', 'menuCargarDatosPrueba')
    .addItem('Borrar datos de prueba', 'menuBorrarDatosPrueba')
    .addToUi();
}

function refrescarTodo_() {
  MEMO_ = {};
  [HOJA.REGISTROS, HOJA.USUARIOS, HOJA.CONFIG, HOJA.RONDAS, HOJA.CANALES].forEach(invalidarTabla_);
}

function menuRestaurarRondas() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Restaurar rondas', 'Se reemplazan las filas de la hoja Rondas con el cronograma original (Ronda 1, 2, 3 y La Ñapa). Los cambios que hayas hecho a mano se pierden. ¿Continuar?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  escribirRondas_([]); // primero se vacía: así funciona aunque la hoja tenga fechas solapadas
  refrescarTodo_();
  const lista = RONDAS_POR_DEFECTO;
  escribirRondas_(lista);
  let mensaje = '';
  lista.forEach(function (p) {
    mensaje += p.nombre + ': ' + fechaCorta_(p.inicio) + ' al ' + fechaCorta_(p.fin) + (p.sorteo ? ' · sorteo ' + fechaCorta_(p.sorteo) : ' · sin sorteo') + '\n';
  });
  ui.alert('Rondas restauradas', mensaje + '\nPuedes ajustar cualquier fecha directamente en la hoja Rondas.', ui.ButtonSet.OK);
}

function menuRecalcularRankings() {
  refrescarTodo_();
  const r = recalcularRankings_();
  SpreadsheetApp.getActiveSpreadsheet().toast(r.vendedores + ' vendedores con ventas · ' + r.cupones + ' cupones en los sorteos.', 'Rankings actualizados', 6);
}

function menuGenerarCupones() {
  refrescarTodo_();
  const r = recalcularRankings_();
  const sh = hoja_(HOJA.RANKING);
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
  sh.getRange(3, r.columnaCupones).activate();
  avisar_('Cupones para el sorteo', 'Se generaron ' + r.cupones + ' cupones (columna "Cupones para sorteo" de la hoja Ranking). Para imprimirlos, entra al portal con tu usuario administrador → Sorteos → Imprimir.');
}

function menuResultadoRonda() {
  const ui = SpreadsheetApp.getUi();
  refrescarTodo_();
  const cfg = leerConfig_();
  const total = cfg.rondas.length;
  const actual = rondaActual_(cfg).numero || 1;
  const nombres = cfg.rondas.map(function (p) { return p.numero + ' = ' + p.nombre; }).join(', ');
  const resp = ui.prompt('Resultado de una ronda', 'Número de ronda (' + nombres + '). Déjalo vacío para la ronda ' + actual + '.', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const texto = resp.getResponseText().trim();
  const n = texto ? parseInt(texto, 10) : actual;
  if (!(n >= 1 && n <= total)) {
    ui.alert('Ronda inválida', 'Escribe un número entre 1 y ' + total + '.', ui.ButtonSet.OK);
    return;
  }
  escribirConfig_('ronda_ranking', String(n));
  recalcularRankings_();
  const p = cfg.rondas[n - 1];
  const usuarios = leerUsuarios_();
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const lista = rankingRonda_(calcularEstadisticas_(leerRegistros_(), cfg, usuarios), n);
  const cupones = lista.reduce(function (t, x) { return t + x.s.cupones; }, 0);
  let mensaje = p.nombre + ' (' + fechaCorta_(p.inicio) + ' al ' + fechaCorta_(p.fin) + ')\n';
  mensaje += p.corte <= ahora_() ? 'Cerrada (terminó el ' + fechaCorta_(p.fin) + ').\n' : 'Todavía abierta hasta el final del ' + fechaCorta_(p.fin) + '. Estos números pueden cambiar.\n';
  mensaje += p.con_sorteo ? 'Sorteo: ' + fechaCorta_(p.sorteo) + ' · ' + cupones + ' cupones de ' + lista.length + ' vendedores.\n\n' : 'Sin sorteo: sus cupones suman para el Gran Sorteo Final.\n\n';
  lista.slice(0, 15).forEach(function (x, i) {
    const u = porCedula[x.v.cedula];
    mensaje += (i + 1) + '. ' + (u ? nombreCorto_(u) : x.v.cedula) + ' (' + grupoDe_(u ? perfilUsuario_(u, cfg) : null) + ') · ' + x.s.cupones + (x.s.cupones === 1 ? ' cupón' : ' cupones') + '\n';
  });
  if (lista.length > 15) mensaje += '… y ' + (lista.length - 15) + ' más en la hoja Ranking.\n';
  const mejores = mejoresPublicos_(calcularEstadisticas_(leerRegistros_(), cfg, usuarios), n, porCedula);
  if (mejores.length) {
    mensaje += '\nMejor vendedor por canal (cupón para el Gran Sorteo Final):\n';
    mejores.forEach(function (m) { mensaje += '· ' + m.canal + ': ' + m.nombre + ' (' + m.monto + ' ' + cfg.moneda + ')\n'; });
  }
  ui.alert('Resultado de la ronda', mensaje, ui.ButtonSet.OK);
}

function menuResumenSorteo() {
  refrescarTodo_();
  const cfg = leerConfig_();
  const usuarios = leerUsuarios_();
  const stats = calcularEstadisticas_(leerRegistros_(), cfg, usuarios);
  const bolsas = armarBolsas_(stats, usuarios, cfg).map(resumenBolsa_);
  let mensaje = cfg.nombre_sorteo + '\n\n';
  bolsas.forEach(function (b) {
    mensaje += '· ' + b.nombre + (b.fecha ? ' (' + fechaCorta_(b.fecha) + ')' : '') + ': ' + b.cupones + ' cupones de ' + b.vendedores + ' vendedores' + (b.corte > ahora_() ? ' · provisional' : '') + '\n';
  });
  mensaje += '\nGran Sorteo Final: 1 cupón por cada ' + cfg.cupones_por_cupon_final + ' cupones, más los cupones Austral y los de mejor vendedor de cada ronda.';
  SpreadsheetApp.getUi().alert('Sorteos', mensaje, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Escribe la hoja Ranking: general (con meta), ronda seleccionada, tickets Austral, sorteos y cupones para sorteo. */
function recalcularRankings_() {
  const cfg = leerConfig_();
  const usuarios = leerUsuarios_();
  const stats = calcularEstadisticas_(leerRegistros_(), cfg, usuarios);
  const porCedula = {};
  usuarios.forEach(function (u) { porCedula[u.cedula] = u; });
  const nombre = function (c) { return porCedula[c] ? nombreCorto_(porCedula[c]) : ''; };
  const grupo = function (c) { return grupoDe_(porCedula[c] ? perfilUsuario_(porCedula[c], cfg) : null); };

  const total = cfg.rondas.length;
  let ronda = cfg.ronda_ranking && cfg.ronda_ranking <= total ? cfg.ronda_ranking : rondaActual_(cfg).numero;
  if (!ronda && total) ronda = 1;
  const p = ronda ? cfg.rondas[ronda - 1] : null;
  const bolsas = armarBolsas_(stats, usuarios, cfg);

  const bloques = [];
  bloques.push({
    titulo: 'Ranking general · Gran Sorteo Final (1 cupón cada ' + cfg.cupones_por_cupon_final + ' cupones + Austral + mejor vendedor)',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'Tienda o canal', 'Valor cupón', 'Total vendido', 'Cupones', 'Meta', '% de la meta', 'Cupones final (cada 10)', 'm² o piezas Austral', 'Cupones Austral', 'Mejor vendedor', 'Total Gran Sorteo Final'],
    filas: rankingGeneral_(stats).map(function (v, i) {
      return [i + 1, v.cedula, nombre(v.cedula), grupo(v.cedula), v.montoPorCuponCentavos / 100, v.totalCentavos / 100, v.cupones,
        v.metaCentavos ? v.metaCentavos / 100 : 'sin meta', v.metaCentavos ? v.totalCentavos / v.metaCentavos : '',
        v.cuponesFinal, v.m2Centesimas / 100, v.cuponesAustral, v.ticketsMejorVendedor, v.ticketsFinal];
    }),
    texto: [1],
    formatos: { 4: '#,##0.00', 5: '#,##0.00', 7: '#,##0.00', 8: '0%', 10: '#,##0.00' },
  });
  bloques.push({
    titulo: p ? p.nombre + ' (' + fechaCorta_(p.inicio) + ' al ' + fechaCorta_(p.fin) + (p.sorteo ? ' · sorteo ' + fechaCorta_(p.sorteo) : ' · sin sorteo') + ')' : 'Ronda',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'Tienda o canal', 'Cupones ronda', 'Vendido ronda'],
    filas: ronda ? rankingRonda_(stats, ronda).map(function (x, i) {
      return [i + 1, x.v.cedula, nombre(x.v.cedula), grupo(x.v.cedula), x.s.cupones, x.s.montoCentavos / 100];
    }) : [],
    texto: [1],
    formatos: { 5: '#,##0.00' },
  });
  bloques.push({
    titulo: 'Cupones Austral para el Gran Sorteo Final (1 cada ' + cfg.m2_por_cupon_austral + ' m² o piezas; distribuidores según la hoja Canales)',
    encabezados: ['Pos', 'Cédula', 'Vendedor', 'm² o piezas Austral', 'Cupones Austral', 'm² o piezas por cupón'],
    filas: rankingAustral_(stats).map(function (v, i) {
      return [i + 1, v.cedula, nombre(v.cedula), v.m2Centesimas / 100, v.cuponesAustral, v.m2PorCuponCentesimas / 100];
    }),
    texto: [1],
    formatos: { 3: '#,##0.00' },
  });
  bloques.push({
    titulo: cfg.nombre_sorteo,
    encabezados: ['Sorteo', 'Fecha', 'Vendedores', 'Cupones'],
    filas: bolsas.map(resumenBolsa_).map(function (b) { return [b.nombre, b.fecha ? fechaCorta_(b.fecha) : '', b.vendedores, b.cupones]; }),
    texto: [1],
    formatos: {},
  });
  bloques.push({
    titulo: 'Cupones para sorteo',
    encabezados: ['Sorteo', 'Código', 'N° del vendedor', 'Cédula', 'Vendedor', 'Tienda o canal', 'Día de venta', 'Factura'],
    filas: [].concat.apply([], bolsas.map(function (b) {
      return b.cupones.map(function (c) { return [b.nombre, c.codigo, c.n, c.cedula, c.vendedor, c.sucursal, c.dia_venta ? fechaCorta_(c.dia_venta) : '', c.factura]; });
    })),
    texto: [1, 3, 6, 7],
    formatos: {},
  });

  const sh = hoja_(HOJA.RANKING);
  sh.clear();
  sh.getRange(1, 1).setValue(cfg.nombre_concurso + ' — actualizado ' + Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy HH:mm'))
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

  const totalCupones = bolsas.reduce(function (t, b) { return t + b.cupones.length; }, 0);
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
  const r = ui.alert('Datos de prueba', 'Se crearán ' + CANTIDAD_PRUEBA + ' vendedores de prueba (cédulas ' + CEDULA_PRUEBA_DESDE + ' a ' + (CEDULA_PRUEBA_DESDE + CANTIDAD_PRUEBA - 1) + ', contraseña "prueba123") con ventas en los días que ya pasaron de la campaña. ¿Continuar?', ui.ButtonSet.YES_NO);
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
  // Los 6 primeros en tiendas; luego uno de Distribuidores y uno de Corporativo.
  const perfilDe = function (i) {
    if (i === 6) return { canal: CANAL.DISTRIBUIDOR, tienda: '' };
    if (i === 7) return { canal: CANAL.CORPORATIVO, tienda: '' };
    return { canal: CANAL.TIENDA, tienda: cfg.sucursales[i % cfg.sucursales.length] };
  };
  // Generador pseudoaleatorio fijo: siempre los mismos datos.
  let semilla = 42;
  const azar = function () { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };

  return conBloqueo_(function () {
    const existentes = leerUsuarios_({ fresco: true });
    nombres.forEach(function (n, i) {
      const cedula = String(CEDULA_PRUEBA_DESDE + i);
      if (buscarUsuario_(existentes, cedula)) return;
      const salt = generarSalt_();
      const perfil = perfilDe(i);
      escribirFilaUsuario_({
        cedula: cedula, nombre: n[0], apellido: n[1], telefono: '0414000000' + i,
        sucursal_o_zona: perfil.tienda, canal: perfil.canal,
        password_hash: hashClave_('prueba123', salt), salt: salt, fecha_registro: new Date(),
        estado: ESTADO_USUARIO.ACTIVO, intentos_fallidos: 0, bloqueado_hasta: '', rol: ROL.VENDEDOR,
      });
    });

    const registros = leerRegistros_({ fresco: true });
    const hoy = hoyISO_();
    if (hoy < cfg.fecha_inicio) return 0;
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
          fechaCarga: Math.min(ahora_(), Utilities.parseDate(dia + ' 09:00', ZONA_HORARIA, 'yyyy-MM-dd HH:mm').getTime() + Math.floor(azar() * 10 * 3600000)),
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
