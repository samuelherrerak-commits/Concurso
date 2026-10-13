'use strict';
/**
 * Pruebas del backend (apps-script/Code.gs) sobre el simulador de Apps Script.
 * Correr con: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('../dev/gas-mock');

const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]).toString('base64');
/** Los arreglos creados dentro del simulador vienen de otro "realm": los copiamos. */
const plano = (x) => JSON.parse(JSON.stringify(x));
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0]).toString('base64');

/** Milisegundos de una hora de Caracas (UTC-4). */
const caracas = (iso, hh = 0, mm = 0) => {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d, hh + 4, mm);
};

/**
 * Campaña de prueba que empezó hace `inicioHaceDias` días.
 * Rondas por defecto (días): Ronda 1 [0–6], Ronda 2 [7–13], Ronda 3 [14–27] y La Ñapa [28–41] sin sorteo.
 * Por defecto no se bloquean las rondas cerradas (las pruebas de cortes lo activan).
 */
function entorno(opciones = {}) {
  const { inicioHaceDias = 10, config = {}, rondas } = opciones;
  const e = crearEntorno({ silencioso: true });
  e.gas.setup();
  const hoy = e.gas.hoyISO_();
  const inicio = e.gas.sumarDias_(hoy, -inicioHaceDias);
  e.gas.escribirConfig_('bloquear_rondas_cerradas', 'NO');
  Object.keys(config).forEach((k) => e.gas.escribirConfig_(k, config[k]));
  const dia = (n) => e.gas.sumarDias_(inicio, n);
  const tramos = rondas || [['Ronda 1', 0, 6, true], ['Ronda 2', 7, 13, true], ['Ronda 3', 14, 27, true], ['La Ñapa', 28, 41, false]];
  e.gas.escribirRondas_(tramos.map(([nombre, a, b, sorteo]) => ({
    nombre, inicio: dia(a), fin: dia(b), corte: e.gas.corteDefecto_(dia(b), '15:00'), sorteo: sorteo ? dia(b + 4) : '',
  })));
  e.servicios.cache._vaciar();
  e.hoy = hoy;
  e.inicio = inicio;
  e.dia = dia;
  e.registrar = (cedula, extra = {}) => {
    const r = e.api('register', {
      cedula, nombre: 'ana', apellido: 'pérez', telefono: '0414 123 45' + String(cedula).slice(-2), password: 'secreto1', canal: 'Tienda', sucursal: 'Boleíta', ...extra,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data.token;
  };
  e.vender = (token, datos) => e.api('addSale', {
    token,
    dia_venta: datos.dia,
    numero_factura: datos.factura,
    monto: datos.monto,
    vendio_austral: !!datos.m2,
    m2_austral: datos.m2,
    foto: datos.foto || JPEG,
  });
  const editar = (hojaNombre, buscada, columna, valor) => {
    const sh = e.servicios.ss.getSheetByName(hojaNombre);
    const encabezados = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const claves = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((f) => String(f[0]));
    const fila = claves.indexOf(String(buscada)) + 1;
    assert.ok(fila > 1, 'no existe ' + buscada + ' en ' + hojaNombre);
    sh.getRange(fila, encabezados.indexOf(columna) + 1).setValue(valor);
    e.servicios.cache._vaciar();
  };
  /** Simula que el admin edita una celda en el Sheet (y que pasó el caché de 20 s). */
  e.editarRegistro = (id, columna, valor) => editar('Registros', id, columna, valor);
  e.editarUsuario = (cedula, columna, valor) => editar('Usuarios', cedula, columna, valor);
  /** Cambia el valor del cupón o la meta de una tienda o canal en la hoja Canales. */
  e.canal = (canal, tienda, cambios) => {
    const sh = e.servicios.ss.getSheetByName('Canales');
    const filas = sh.getDataRange().getValues();
    const i = filas.findIndex((f, j) => j > 0 && f[0] === canal && String(f[1]) === (tienda || ''));
    assert.ok(i > 0, 'no existe ' + canal + ' ' + tienda);
    if ('monto' in cambios) sh.getRange(i + 1, 3).setValue(cambios.monto);
    if ('meta' in cambios) sh.getRange(i + 1, 4).setValue(cambios.meta);
    e.servicios.cache._vaciar();
  };
  /** Agrega una fila a Usuarios a mano, como lo haría el admin en el Sheet. */
  e.agregarUsuarioAMano = (datos) => {
    const sh = e.servicios.ss.getSheetByName('Usuarios');
    const encabezados = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.appendRow(encabezados.map((h) => (datos[h] === undefined ? '' : datos[h])));
    e.servicios.cache._vaciar();
  };
  e.stats = () => e.gas.calcularEstadisticas_(e.gas.leerRegistros_({ fresco: true }), e.gas.leerConfig_(), e.gas.leerUsuarios_({ fresco: true }));
  e.reloj = (ms) => { e.gas.ahora_ = () => ms; };
  return e;
}

// ------------------------------------------------------------
// Instalación y migración
// ------------------------------------------------------------

test('setup crea las 6 hojas, el cronograma de rondas y los canales, y se puede correr dos veces', () => {
  const e = crearEntorno({ silencioso: true });
  e.gas.setup();
  e.gas.setup();
  const nombres = e.servicios.ss.getSheets().map((h) => h.getName());
  assert.deepEqual(nombres, ['Configuracion', 'Rondas', 'Canales', 'Registros', 'Usuarios', 'Ranking']);
  const cfgFilas = e.servicios.ss.getSheetByName('Configuracion').getDataRange().getValues().slice(1);
  const claves = cfgFilas.map((f) => f[0]);
  assert.equal(new Set(claves).size, claves.length);
  ['nombre_sorteo', 'porcentaje_meta_final', 'cupones_por_cupon_final', 'fecha_sorteo_final', 'm2_por_cupon_austral', 'hora_corte'].forEach((k) => assert.ok(claves.includes(k), k));
  assert.equal(cfgFilas.find((f) => f[0] === 'hora_corte')[1], '15:00', 'la hora queda como texto');
  assert.ok(cfgFilas.find((f) => f[0] === 'carpeta_fotos_id')[1], 'carpeta de fotos creada');
  assert.equal(e.servicios.DriveApp._carpetas.size, 1, 'no crea carpetas repetidas');

  const cfg = e.gas.leerConfig_();
  assert.equal(cfg.nombre_sorteo, 'La bolsa de los deseos');
  assert.deepEqual(plano(cfg.rondas.map((r) => [r.nombre, r.inicio, r.fin, r.sorteo, r.con_sorteo])), [
    ['Ronda 1', '2026-10-15', '2026-11-05', '2026-11-09', true],
    ['Ronda 2', '2026-11-06', '2026-11-26', '2026-11-30', true],
    ['Ronda 3', '2026-11-27', '2026-12-10', '2026-12-14', true],
    ['La Ñapa', '2026-12-11', '2026-12-19', '', false],
  ]);
  assert.equal(cfg.rondas[0].corte, caracas('2026-11-06', 15), 'corte de la Ronda 1: viernes 6/11 a las 3 p. m.');
  assert.equal(cfg.total_sorteos, 3);
  assert.equal(cfg.fecha_sorteo_final, '2026-12-21');
  assert.equal(e.servicios.ss.getSheetByName('Rondas').getLastRow(), 5, 'una fila por ronda');

  const canales = e.servicios.ss.getSheetByName('Canales').getDataRange().getValues().slice(1);
  assert.equal(canales.length, 11, '9 tiendas + Distribuidor + Corporativo');
  assert.deepEqual(canales.slice(-2).map((f) => f[0]), ['Distribuidor', 'Corporativo']);
  assert.deepEqual(plano(cfg.sucursales), ['Boleíta', 'La Castellana', 'Los Naranjos', 'El Bosque', 'Las Mercedes', 'San Martín', 'Maracaibo', 'Acarigua', 'Barquisimeto']);
});

test('setup funciona aunque no haya interfaz (ejecutado desde el editor)', () => {
  const e = crearEntorno({ silencioso: true, sinUi: true });
  assert.doesNotThrow(() => e.gas.setup());
});

test('setup actualiza un Sheet de la versión anterior sin perder ventas ni usuarios', () => {
  const e = crearEntorno({ silencioso: true });
  const ss = e.servicios.ss;
  const cfg = ss.insertSheet('Configuracion');
  cfg.appendRow(['clave', 'valor', 'descripcion']);
  cfg.appendRow(['fecha_inicio', e.gas.fechaDesdeISO_('2026-10-15'), 'vieja']);
  cfg.appendRow(['num_semanas', 10, 'vieja']);
  cfg.appendRow(['monto_por_cupon', 2000, 'vieja']);
  cfg.appendRow(['sucursales', 'Boleíta, Valencia', 'vieja']);
  cfg.appendRow(['categorias_modo', 'porcentaje', 'vieja']);
  cfg.appendRow(['concurso_abierto', 'SI', 'vieja']);
  const per = ss.insertSheet('Periodos');
  per.appendRow(['semana', 'inicio', 'fin', 'corte', 'entrega']);
  const us = ss.insertSheet('Usuarios');
  us.appendRow(['cedula', 'nombre', 'apellido', 'telefono', 'sucursal_o_zona', 'password_hash', 'salt', 'fecha_registro', 'estado', 'intentos_fallidos', 'bloqueado_hasta', 'rol']);
  const salt = 'abc';
  us.appendRow(["'12345678", 'Ana', 'Pérez', "'04141234567", 'Valencia', e.gas.hashClave_('secreto1', salt), salt, new Date(), 'activo', 0, '', 'vendedor']);
  us.appendRow(["'12345679", 'Luis', 'Díaz', "'04141234568", 'Zona Este', e.gas.hashClave_('secreto1', salt), salt, new Date(), 'activo', 0, '', 'vendedor']);

  e.gas.setup();
  const filas = cfg.getDataRange().getValues();
  assert.equal(filas.find((f) => f[0] === 'monto_por_cupon')[1], 2000, 'conserva los valores que ya tenía');
  ['fecha_inicio', 'num_semanas', 'sucursales', 'categorias_modo'].forEach((k) => assert.ok(!filas.some((f) => f[0] === k), 'quita ' + k));
  assert.ok(filas.some((f) => f[0] === 'nombre_sorteo'), 'agrega las claves nuevas');
  assert.equal(ss.getSheetByName('Periodos'), null, 'borra la hoja Periodos');
  assert.equal(us.getRange(1, 13).getValue(), 'canal', 'agrega la columna canal al final');
  const canales = ss.getSheetByName('Canales').getDataRange().getValues().slice(1);
  assert.deepEqual(canales.map((f) => [f[0], f[1], f[2]]), [['Tienda', 'Boleíta', 2000], ['Tienda', 'Valencia', 2000], ['Distribuidor', '', 2000], ['Corporativo', '', 2000]], 'las tiendas viejas pasan a Canales con su valor de cupón');

  const ana = e.api('login', { cedula: '12345678', password: 'secreto1' });
  assert.equal(ana.ok, true, JSON.stringify(ana));
  assert.equal(ana.data.usuario.canal, 'Tienda', 'con tienda válida queda en el canal Tienda');
  assert.equal(ana.data.usuario.necesita_canal, false);
  const luis = e.api('login', { cedula: '12345679', password: 'secreto1' });
  assert.equal(luis.data.usuario.necesita_canal, true, 'sin tienda válida debe elegir canal');
});

// ------------------------------------------------------------
// Registro, canales y acceso
// ------------------------------------------------------------

test('registro exige canal; en Tienda también la tienda de la lista', () => {
  const e = entorno();
  const base = { nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1', canal: 'Tienda', sucursal: 'Boleíta' };
  assert.equal(e.api('register', { ...base, cedula: '12.34' }).code, 'VALIDATION');
  assert.equal(e.api('register', { ...base, cedula: '12345678', password: '123' }).campo, 'password');
  assert.equal(e.api('register', { ...base, cedula: '12345678', telefono: '123' }).campo, 'telefono');
  assert.equal(e.api('register', { ...base, cedula: '12345678', canal: '' }).campo, 'canal');
  assert.equal(e.api('register', { ...base, cedula: '12345678', canal: 'Mayorista' }).campo, 'canal');
  assert.equal(e.api('register', { ...base, cedula: '12345678', sucursal: '' }).campo, 'sucursal');
  assert.equal(e.api('register', { ...base, cedula: '12345678', sucursal: '=HYPERLINK("http://x")' }).campo, 'sucursal', 'no entra texto libre');

  const ok = e.api('register', { ...base, cedula: 'V-12.345.678', nombre: '  maría   josé ', apellido: 'PÉREZ', telefono: '0414-123-4567', sucursal: '  san martin ' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.usuario.nombre, 'María José');
  assert.equal(ok.data.usuario.cedula_mask, '12••••78');
  assert.equal(ok.data.usuario.canal, 'Tienda');
  assert.equal(ok.data.usuario.sucursal, 'San Martín', 'se guarda el nombre oficial de la tienda');
  assert.equal(ok.data.usuario.necesita_canal, false);

  const dist = e.api('register', { ...base, cedula: '23456789', canal: 'distribuidores', sucursal: 'Boleíta' });
  assert.equal(dist.ok, true);
  assert.equal(dist.data.usuario.canal, 'Distribuidor');
  assert.equal(dist.data.usuario.canal_etiqueta, 'Distribuidores');
  assert.equal(dist.data.usuario.sucursal, '', 'fuera de Tienda no se guarda tienda');

  const sh = e.servicios.ss.getSheetByName('Usuarios');
  const enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const fila = sh.getRange(2, 1, 1, enc.length).getValues()[0];
  assert.equal(fila[0], '12345678');
  assert.equal(fila[3], '04141234567', 'el teléfono conserva el 0 inicial');
  assert.equal(fila[enc.indexOf('sucursal_o_zona')], 'San Martín');
  assert.equal(fila[enc.indexOf('canal')], 'Tienda');
  assert.match(fila[enc.indexOf('password_hash')], /^v1\$\d+\$[0-9a-f]{64}$/, 'la contraseña se guarda como hash');
  assert.ok(!JSON.stringify(fila).includes('secreto1'));

  const otro = e.api('register', { ...base, cedula: '34567890', rol: 'admin' });
  assert.equal(otro.data.usuario.rol, 'vendedor', 'nadie se registra como admin');

  const conf = e.api('config').data;
  assert.equal(conf.sucursales.length, 9, 'el formulario recibe la lista de tiendas');
  assert.deepEqual(plano(conf.canales.map((c) => c.canal)), ['Tienda', 'Distribuidor', 'Corporativo']);
});

test('las tiendas salen de la hoja Canales', () => {
  const e = entorno();
  const sh = e.servicios.ss.getSheetByName('Canales');
  sh.appendRow(['Tienda', 'Puerto Ordaz', 1800, 50000]);
  e.servicios.cache._vaciar();
  assert.ok(e.api('config').data.sucursales.includes('Puerto Ordaz'));
  assert.equal(e.api('register', { cedula: '33445566', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1', canal: 'Tienda', sucursal: 'puerto ordaz' }).ok, true);
});

test('cuentas sin canal válido: lo eligen antes de vender, y solo una vez', () => {
  const e = entorno();
  const t = e.registrar('34445566');
  e.editarUsuario('34445566', 'sucursal_o_zona', 'Zona Vieja');
  e.editarUsuario('34445566', 'canal', '');
  const d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.usuario.necesita_canal, true);
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'NS1', monto: 10 }).code, 'NEED_CANAL');
  assert.equal(e.api('setCanal', { token: t, canal: 'Tienda', sucursal: 'Nada' }).campo, 'sucursal');
  const ok = e.api('setCanal', { token: t, canal: 'Corporativo' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.usuario.canal, 'Corporativo');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'NS1', monto: 10 }).ok, true);
  assert.equal(e.api('setCanal', { token: t, canal: 'Tienda', sucursal: 'Acarigua' }).code, 'FORBIDDEN', 'no se cambia de canal desde el portal');
});

test('login: errores, aviso de intentos restantes y bloqueo tras 5 fallos', () => {
  const e = entorno();
  e.registrar('11222333');
  assert.equal(e.api('login', { cedula: '99999999', password: 'x' }).code, 'CREDENCIALES');
  for (let i = 1; i <= 4; i++) {
    const r = e.api('login', { cedula: '11222333', password: 'mala' });
    assert.equal(r.code, 'CREDENCIALES');
    assert.match(r.message, new RegExp(`quedan? ${5 - i}`));
  }
  assert.equal(e.api('login', { cedula: '11222333', password: 'mala' }).code, 'LOCKED');
  assert.equal(e.api('login', { cedula: '11222333', password: 'secreto1' }).code, 'LOCKED', 'bloqueado aunque la clave sea buena');

  e.editarUsuario('11222333', 'bloqueado_hasta', new Date(Date.now() - 1000));
  const ok = e.api('login', { cedula: '11.222.333', password: 'secreto1' });
  assert.equal(ok.ok, true);
  const fila = e.servicios.ss.getSheetByName('Usuarios').getRange(2, 10, 1, 2).getValues()[0];
  assert.deepEqual(fila, [0, ''], 'intentos reiniciados');

  e.editarUsuario('11222333', 'estado', 'bloqueado');
  assert.equal(e.api('login', { cedula: '11222333', password: 'secreto1' }).code, 'LOCKED');
  assert.equal(e.api('getDashboard', { token: ok.data.token }).code, 'AUTH', 'un usuario bloqueado pierde la sesión');
});

test('reinicio de contraseña: el admin borra el hash y el vendedor define otra', () => {
  const e = entorno();
  e.registrar('93000001', { telefono: '0414-555-1234' });
  e.editarUsuario('93000001', 'password_hash', '');
  assert.equal(e.api('login', { cedula: '93000001', password: 'secreto1' }).code, 'RESET_REQUIRED');
  assert.equal(e.api('setPassword', { cedula: '93000001', telefono: '04140000000', password: 'nueva123' }).code, 'CREDENCIALES');
  const ok = e.api('setPassword', { cedula: '93000001', telefono: '+58 414 555 1234', password: 'nueva123' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(e.api('login', { cedula: '93000001', password: 'secreto1' }).code, 'CREDENCIALES');
  assert.equal(e.api('login', { cedula: '93000001', password: 'nueva123' }).ok, true);
  assert.equal(e.api('setPassword', { cedula: '93000001', telefono: '04145551234', password: 'otra1234' }).code, 'FORBIDDEN', 'no se puede pisar una clave existente');
});

test('token vencido, inválido o cerrado devuelve AUTH', () => {
  const e = entorno();
  const t = e.registrar('70111222');
  assert.equal(e.api('getDashboard', { token: t }).ok, true);
  assert.equal(e.api('getDashboard', { token: 'x'.repeat(64) }).code, 'AUTH');
  assert.equal(e.api('getDashboard', {}).code, 'AUTH');
  assert.equal(e.api('addSale', { token: 'corto' }).code, 'AUTH');

  const props = e.servicios.propiedades._mapa;
  const [clave, valor] = [...props.entries()].find(([k]) => k.startsWith('ses_'));
  props.set(clave, JSON.stringify({ ...JSON.parse(valor), e: Date.now() - 1 }));
  assert.equal(e.api('getDashboard', { token: t }).code, 'AUTH');
  assert.equal(props.has(clave), false, 'la sesión vencida se borra');

  const t2 = e.api('login', { cedula: '70111222', password: 'secreto1' }).data.token;
  assert.equal(e.api('logout', { token: t2 }).ok, true);
  assert.equal(e.api('getDashboard', { token: t2 }).code, 'AUTH');
  assert.ok(![...props.keys()].some((k) => k.includes(t2)), 'el token no se guarda en claro');
});

test('los endpoints usan la cédula del token, no la que manda el cliente', () => {
  const e = entorno();
  const t1 = e.registrar('71111222');
  e.registrar('71111333');
  const r = e.api('addSale', { token: t1, cedula: '71111333', dia_venta: e.hoy, numero_factura: 'Z9', monto: 1600, vendio_austral: false, foto: JPEG });
  assert.equal(r.ok, true);
  assert.equal(e.gas.leerRegistros_({ fresco: true })[0].cedula, '71111222');
});

test('token_api: sin la clave del portal no se atiende ninguna acción', () => {
  const e = entorno();
  e.registrar('98000001');
  assert.equal(e.api('config', { api_token: undefined }).code, 'FORBIDDEN_API');
  assert.equal(e.api('login', { cedula: '98000001', password: 'secreto1', api_token: 'otra' }).code, 'FORBIDDEN_API');
  assert.equal(JSON.parse(e.gas.doGet({ parameter: { action: 'config' } }).getContent()).code, 'FORBIDDEN_API');
  assert.equal(JSON.parse(e.gas.doGet({ parameter: {} }).getContent()).ok, true, 'el chequeo de salud no pide clave');
  assert.equal(e.api('login', { cedula: '98000001', password: 'secreto1' }).ok, true);
  e.gas.escribirConfig_('token_api', '');
  assert.equal(e.api('config', { api_token: undefined }).ok, true);
});

// ------------------------------------------------------------
// Cupones, valor por canal y rondas
// ------------------------------------------------------------

test('cupones acumulados: el sobrante pasa de una ronda a la otra', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const t = e.registrar('20111222');
  // Ronda 1: $4.000 → 2 cupones, sobran $1.000.
  assert.equal(e.vender(t, { dia: e.dia(0), factura: 'A-1', monto: 2500 }).ok, true);
  assert.equal(e.vender(t, { dia: e.dia(3), factura: 'A-2', monto: 1500 }).ok, true);
  // Ronda 2: $600 → los $1.000 sobrantes + $600 completan 1 cupón; sobran $100.
  const r = e.vender(t, { dia: e.dia(8), factura: 'A-3', monto: 600 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.cupones_antes, 2);
  assert.equal(r.data.cupones_despues, 3);
  assert.equal(r.data.sobrante, 100);
  assert.equal(r.data.falta_para_proximo, 1400);
  assert.equal(r.data.ronda.nombre, 'Ronda 2');
  assert.equal(r.data.cupones_ronda, 1);

  const v = e.stats().vendedores['20111222'];
  assert.equal(v.rondas[1].cupones, 2);
  assert.equal(v.rondas[2].cupones, 1);

  const d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 3);
  assert.equal(d.resumen.total, 4600);
  assert.equal(d.resumen.monto_por_cupon, 1500);
  assert.equal(d.resumen.ronda.numero, 2);
  assert.equal(d.resumen.ronda.cupones, 1);
  assert.equal(d.resumen.ronda.monto, 600);
  assert.equal(Math.round(d.resumen.progreso * 1000), 67);
  assert.deepEqual(d.cupones.map((c) => [c.n, c.factura, c.ronda]), [[1, 'A-1', 1], [2, 'A-2', 1], [3, 'A-3', 2]]);
  assert.deepEqual(d.registros.map((x) => x.numero_factura), ['A-3', 'A-2', 'A-1'], 'historial del más reciente al más viejo');
});

test('el valor del cupón depende de la tienda o del canal (hoja Canales)', () => {
  const e = entorno();
  e.canal('Tienda', 'Maracaibo', { monto: 1000 });
  e.canal('Distribuidor', '', { monto: 3000 });
  const tm = e.registrar('20200001', { sucursal: 'Maracaibo' });
  const tb = e.registrar('20200002');
  const td = e.registrar('20200003', { canal: 'Distribuidor', sucursal: '' });
  [tm, tb, td].forEach((t, i) => assert.equal(e.vender(t, { dia: e.hoy, factura: 'VC' + i, monto: 6000 }).data.cupones_despues, [6, 4, 2][i]));
  const d = e.api('getDashboard', { token: tm }).data;
  assert.equal(d.resumen.monto_por_cupon, 1000);
  assert.equal(d.cupones[0].falta, 1000);
  const r = e.vender(td, { dia: e.hoy, factura: 'VC9', monto: 500 });
  assert.equal(r.data.monto_por_cupon, 3000);
  assert.equal(r.data.falta_para_proximo, 2500);
});

test('cada cupón trae lo necesario para volver a ver su ticket', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const t = e.registrar('20111299');
  e.vender(t, { dia: e.dia(0), factura: 'K-1', monto: 2000 });
  e.vender(t, { dia: e.dia(1), factura: 'K-2', monto: 3500 });
  const c = e.api('getDashboard', { token: t }).data.cupones;
  assert.deepEqual(c.map((x) => [x.n, x.factura, x.monto, x.acumulado, x.falta]), [
    [1, 'K-1', 2000, 2000, 1000],
    [2, 'K-2', 3500, 5500, 500],
    [3, 'K-2', 3500, 5500, 500],
  ]);
  assert.ok(c[0].fecha_carga > 0);
});

test('una venta cargada tarde en la ronda 1 no cambia la ronda 2 si no cruza el umbral', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const t = e.registrar('20111223');
  e.vender(t, { dia: e.dia(1), factura: 'B-1', monto: 1000 });
  e.vender(t, { dia: e.dia(8), factura: 'B-2', monto: 1000 });
  let v = e.stats().vendedores['20111223'];
  assert.equal(v.rondas[1].cupones, 0);
  assert.equal(v.rondas[2].cupones, 1);
  const r = e.vender(t, { dia: e.dia(2), factura: 'B-3', monto: 600 });
  assert.equal(r.data.cupones_nuevos, 0, '$2.600 sigue siendo 1 cupón');
  v = e.stats().vendedores['20111223'];
  assert.equal(v.rondas[1].cupones, 1);
  assert.equal(v.rondas[2].cupones, 0);
});

test('addSale devuelve lo necesario para imprimir los tickets', () => {
  const e = entorno();
  const t = e.registrar('30111222');
  const a = e.vender(t, { dia: e.hoy, factura: '0001', monto: 1000 });
  assert.equal(a.data.cupones_nuevos, 0);
  assert.equal(a.data.falta_para_proximo, 500);
  assert.equal(a.data.pendiente_aprobacion, false);
  const b = e.vender(t, { dia: e.hoy, factura: '0002', monto: '2.300,50' });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.data.cupones_antes, 0);
  assert.equal(b.data.cupones_despues, 2);
  assert.deepEqual(b.data.nuevos_cupones.map((c) => c.n), [1, 2]);
  assert.equal(b.data.nuevos_cupones[0].acumulado, 3300.5);
  assert.equal(b.data.sobrante, 300.5);
  assert.equal(b.data.sobrante_antes, 1000);
  assert.equal(b.data.registro.estado, 'Pendiente');
  assert.match(b.data.registro.id, /^CP-\d{6}$/);
  assert.equal(b.data.final.faltan_para_proximo, 8, 'cuántos cupones faltan para el próximo cupón final');
  const archivo = [...e.servicios.DriveApp._archivos.values()][1];
  assert.match(archivo.getName(), /^30111222_2_\d+\.jpg$/);
});

test('tickets Austral: 1 por cada 100 m², el sobrante se acumula', () => {
  const e = entorno();
  const t = e.registrar('31111222');
  const a = e.vender(t, { dia: e.hoy, factura: 'AU-1', monto: 900, m2: 60 });
  assert.equal(a.data.austral_nuevos, 0);
  assert.equal(a.data.m2_falta, 40);
  const b = e.vender(t, { dia: e.hoy, factura: 'AU-2', monto: 900, m2: 145.5 });
  assert.equal(b.data.austral_despues, 2, '60 + 145,5 = 205,5 m² → 2 cupones');
  assert.deepEqual(b.data.nuevos_cupones_austral.map((c) => [c.n, c.factura, c.m2, c.m2_acumulado]), [[1, 'AU-2', 145.5, 205.5], [2, 'AU-2', 145.5, 205.5]]);
  assert.equal(b.data.m2_sobrante, 5.5);
  assert.equal(b.data.m2_falta, 94.5);
  assert.equal(b.data.cupones_nuevos, 1, 'el monto también suma cupones normales');

  const d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.austral.cupones, 2);
  assert.equal(d.resumen.austral.participa, true, 'sin meta definida, los tickets entran al final');
  assert.equal(d.resumen.final.austral, 2);
  assert.equal(d.resumen.final.total, 2, '0 cupones finales + 2 tickets Austral');
  assert.equal(d.cupones_austral[0].m2_falta, 94.5);

  const e2 = entorno({ config: { m2_por_cupon_austral: 50 } });
  const t2 = e2.registrar('31111333');
  assert.equal(e2.vender(t2, { dia: e2.hoy, factura: 'AU-9', monto: 10, m2: 120 }).data.austral_nuevos, 2, 'la regla se cambia en Configuracion');
});

test('si vendió Austral, los m² son obligatorios', () => {
  const e = entorno();
  const t = e.registrar('50111222');
  const sinM2 = e.api('addSale', { token: t, dia_venta: e.hoy, numero_factura: 'X1', monto: 100, vendio_austral: true, foto: JPEG });
  assert.equal(sinM2.campo, 'm2_austral');
  const ok = e.api('addSale', { token: t, dia_venta: e.hoy, numero_factura: 'X1', monto: 100, vendio_austral: true, m2_austral: '35,5', foto: JPEG });
  assert.equal(ok.data.m2_total, 35.5);
  const sinAustral = e.api('addSale', { token: t, dia_venta: e.hoy, numero_factura: 'X2', monto: 100, vendio_austral: false, m2_austral: 99, foto: JPEG });
  assert.equal(sinAustral.data.registro.m2_austral, 0, 'si no vendió Austral, se ignoran los m²');
});

test('rechaza facturas duplicadas, también de otro vendedor y con ceros a la izquierda', () => {
  const e = entorno();
  const t1 = e.registrar('40111222');
  const t2 = e.registrar('40111333');
  const r1 = e.vender(t1, { dia: e.hoy, factura: '000123', monto: 500 });
  assert.equal(r1.ok, true);
  assert.match(e.vender(t1, { dia: e.hoy, factura: '000123', monto: 500 }).message, /Ya registraste/);
  const otro = e.vender(t2, { dia: e.hoy, factura: '123', monto: 500 });
  assert.equal(otro.code, 'DUPLICATE');
  assert.match(otro.message, /otro vendedor/);
  e.editarRegistro(r1.data.registro.id, 'estado', 'Rechazada');
  assert.equal(e.vender(t2, { dia: e.hoy, factura: '123', monto: 500 }).ok, true);
});

test('valida fecha (futura, fuera de la campaña, inexistente), monto y foto', () => {
  const e = entorno({ inicioHaceDias: 3 });
  const t = e.registrar('60111222');
  assert.equal(e.vender(t, { dia: e.gas.sumarDias_(e.hoy, 1), factura: 'F1', monto: 10 }).message, 'La fecha no puede ser futura.');
  assert.match(e.vender(t, { dia: e.dia(-1), factura: 'F1', monto: 10 }).message, /dentro de la campaña/);
  assert.equal(e.vender(t, { dia: '2026-02-30', factura: 'F1', monto: 10 }).campo, 'dia_venta');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 0 }).campo, 'monto');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 250000 }).campo, 'monto');
  assert.equal(e.vender(t, { dia: e.hoy, factura: '', monto: 10 }).campo, 'numero_factura');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 10, foto: 'hola' }).campo, 'foto');
  const noEsImagen = 'data:image/jpeg;base64,' + Buffer.from('<?php echo 1; ?>').toString('base64');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 10, foto: noEsImagen }).campo, 'foto');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 10, foto: PNG }).ok, true);
  assert.equal(e.servicios.DriveApp._archivos.size, 1, 'las ventas inválidas no suben fotos');
});

test('cortes del cronograma real: cada ronda cierra al día siguiente a las 3 p. m.', () => {
  const e = crearEntorno({ silencioso: true });
  e.gas.setup();
  const reloj = (ms) => { e.gas.ahora_ = () => ms; };
  const vender = (token, dia, factura) => e.api('addSale', { token, dia_venta: dia, numero_factura: factura, monto: 10, vendio_austral: false, foto: JPEG });
  reloj(caracas('2026-10-20', 9));
  const t = e.api('register', { cedula: '35111222', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1', canal: 'Tienda', sucursal: 'Boleíta' }).data.token;
  const actual = () => e.gas.rondaActual_(e.gas.leerConfig_());

  reloj(caracas('2026-10-10', 9));
  assert.equal(actual().estado, 'antes');
  assert.match(vender(t, '2026-10-10', 'Q0').message, /dentro de la campaña/);

  // Viernes 6/11 en la mañana: la Ronda 1 (15/10–5/11) sigue en juego hasta el corte.
  reloj(caracas('2026-11-06', 10));
  let s = actual();
  assert.deepEqual([s.numero, s.nombre, s.estado], [1, 'Ronda 1', 'en_corte']);
  assert.equal(vender(t, '2026-11-05', 'Q1').ok, true, 'antes del corte sí');
  assert.equal(vender(t, '2026-11-06', 'Q2').ok, true, 'el viernes ya es Ronda 2');

  reloj(caracas('2026-11-06', 15));
  const tarde = vender(t, '2026-11-05', 'Q3');
  assert.equal(tarde.campo, 'dia_venta');
  assert.match(tarde.message, /Ronda 1 cerró el 06\/11\/2026 a las 15:00/);
  s = actual();
  assert.deepEqual([s.numero, s.estado, s.sorteo], [2, 'en_curso', '2026-11-30']);
  assert.equal(e.api('config').data.dia_min_carga, '2026-11-06');

  // La Ñapa: sin sorteo, sigue sumando.
  reloj(caracas('2026-12-15', 12));
  s = actual();
  assert.deepEqual([s.numero, s.nombre, s.con_sorteo], [4, 'La Ñapa', false]);
  assert.equal(vender(t, '2026-12-15', 'Q4').ok, true);

  // Después del corte final ya no se carga nada.
  reloj(caracas('2026-12-20', 16));
  assert.equal(actual().estado, 'terminado');
  assert.match(vender(t, '2026-12-19', 'Q5').message, /La Ñapa cerró/);
  assert.equal(e.api('config').data.dia_max_carga, '');
  e.gas.escribirConfig_('bloquear_rondas_cerradas', 'NO');
  assert.equal(vender(t, '2026-12-19', 'Q5').ok, true, 'con bloquear_rondas_cerradas = NO se aceptan ventas tardías');
});

test('la hoja Rondas manda: fechas, cortes y nombres se editan a mano', () => {
  const e = crearEntorno({ silencioso: true });
  e.gas.setup();
  const sh = e.servicios.ss.getSheetByName('Rondas');
  // La Ronda 2 se alarga hasta el 27/11 y su corte pasa al sábado 28 a las 10:00.
  sh.getRange(3, 4).setValue(e.gas.fechaDesdeISO_('2026-11-27'));
  sh.getRange(3, 5).setValue('28/11/2026 10:00');
  sh.getRange(4, 3).setValue(e.gas.fechaDesdeISO_('2026-11-28'));
  sh.getRange(5, 2).setValue('La Ñapa navideña');
  e.servicios.cache._vaciar();
  e.gas.invalidarTabla_('Rondas');
  const cfg = e.gas.leerConfig_();
  assert.equal(e.gas.rondaNumeroDe_('2026-11-27', cfg), 2);
  assert.equal(e.gas.rondaNumeroDe_('2026-11-28', cfg), 3);
  assert.equal(cfg.rondas[1].corte, caracas('2026-11-28', 10));
  assert.equal(cfg.rondas[3].nombre, 'La Ñapa navideña');

  sh.getRange(4, 3).setValue(e.gas.fechaDesdeISO_('2026-11-20'));
  e.servicios.cache._vaciar();
  const r = e.api('config');
  assert.equal(r.code, 'SERVER');
  assert.match(r.message, /se solapan/);

  e.servicios.ui.respuestaAlert = e.servicios.ui.Button.YES;
  e.gas.menuRestaurarRondas();
  assert.equal(e.gas.leerConfig_().rondas[2].inicio, '2026-11-27', 'el menú restaura el cronograma original');
});

test('concurso cerrado: no se cargan ventas', () => {
  const e = entorno({ config: { concurso_abierto: 'NO' } });
  const t = e.registrar('61111222');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'C1', monto: 10 }).code, 'CLOSED');
});

test('contar_solo_aprobadas = SI: los cupones llegan al aprobar', () => {
  const e = entorno({ config: { contar_solo_aprobadas: 'SI' } });
  const t = e.registrar('80111222');
  const r = e.vender(t, { dia: e.hoy, factura: 'P1', monto: 3100 });
  assert.equal(r.data.pendiente_aprobacion, true);
  assert.equal(r.data.cupones_nuevos, 0);
  let d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 0);
  assert.equal(d.resumen.monto_pendiente, 3100);
  e.editarRegistro(r.data.registro.id, 'estado', 'Aprobada');
  d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 2);
});

test('rechazar una factura descuenta sus cupones (todo se recalcula)', () => {
  const e = entorno();
  const t = e.registrar('81111222');
  const r = e.vender(t, { dia: e.hoy, factura: 'R1', monto: 3000, m2: 150 });
  e.vender(t, { dia: e.hoy, factura: 'R2', monto: 500 });
  e.editarRegistro(r.data.registro.id, 'estado', 'Rechazada');
  e.editarRegistro(r.data.registro.id, 'nota_admin', 'Foto ilegible');
  const d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 0);
  assert.equal(d.resumen.austral.cupones, 0);
  assert.equal(d.resumen.sobrante, 500);
  assert.equal(d.registros.find((x) => x.numero_factura === 'R1').nota_admin, 'Foto ilegible');
});

test('neutraliza inyección de fórmulas en Sheets', () => {
  const e = entorno();
  const t = e.registrar('82111222');
  assert.equal(e.api('register', { cedula: '82111223', nombre: '=cmd', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1', canal: 'Tienda', sucursal: 'Boleíta' }).campo, 'nombre');
  assert.equal(e.vender(t, { dia: e.hoy, factura: '=1+1', monto: 10 }).campo, 'numero_factura');
  assert.equal(e.servicios.ss.getSheetByName('Usuarios').formulasEscritas.length, 0, 'no se escribió ninguna fórmula');
  assert.equal(e.gas.protegerCelda_('+58 414'), "'+58 414");
  assert.equal(e.gas.protegerCelda_('=SUM(A1)'), "'=SUM(A1)");
});

// ------------------------------------------------------------
// Metas, Gran Sorteo Final y bolsas
// ------------------------------------------------------------

test('Gran Sorteo Final: 1 cupón cada 10, solo con el 80 % de la meta de su tienda o canal', () => {
  const e = entorno();
  e.canal('Tienda', 'Boleíta', { meta: 20000 });
  const a = e.registrar('20300001');
  const sinMeta = e.registrar('20300002', { canal: 'Corporativo', sucursal: '' });

  // $15.000 = 10 cupones, pero es el 75 % de la meta: no entra al final todavía.
  e.vender(a, { dia: e.hoy, factura: 'GF1', monto: 15000 });
  let r = e.api('getDashboard', { token: a }).data.resumen;
  assert.equal(r.cupones, 10);
  assert.deepEqual(plano(r.meta), { definida: true, meta: 20000, vendido: 15000, avance: 0.75, porcentaje_requerido: 80, requerido: 16000, falta: 1000, cumple: false });
  assert.deepEqual(plano(r.final), { cupones: 0, austral: 0, total: 0, posibles: 1, por_cada: 10, faltan_para_proximo: 10, cumple: false });

  // $1.000 más llega al 80 %.
  const v = e.vender(a, { dia: e.hoy, factura: 'GF2', monto: 1000 });
  assert.equal(v.data.cupones_final_antes, 0);
  assert.equal(v.data.cupones_final_despues, 1);
  assert.equal(v.data.meta.cumple, true);
  r = e.api('getDashboard', { token: a }).data.resumen;
  assert.equal(r.final.cupones, 1);
  assert.equal(r.final.faltan_para_proximo, 10, '10 cupones exactos: le faltan 10 para el siguiente');

  // Sin meta definida en Canales: cumple.
  e.vender(sinMeta, { dia: e.hoy, factura: 'GF3', monto: 30000 });
  r = e.api('getDashboard', { token: sinMeta }).data.resumen;
  assert.equal(r.meta.definida, false);
  assert.equal(r.final.cupones, 2);

  // Las reglas se cambian en Configuracion.
  e.gas.escribirConfig_('cupones_por_cupon_final', 5);
  e.gas.escribirConfig_('porcentaje_meta_final', 90);
  e.servicios.cache._vaciar();
  r = e.api('getDashboard', { token: a }).data.resumen;
  assert.equal(r.meta.cumple, false, '$16.000 es el 80 %, no llega al 90 %');
  assert.equal(r.final.posibles, 2);
});

test('bolsas: cada ronda con sus cupones, La Ñapa sin sorteo y el final con los tickets Austral', () => {
  const e = entorno({ inicioHaceDias: 30 });
  e.canal('Tienda', 'Boleíta', { meta: 10000 });
  const a = e.registrar('20400001', { nombre: 'Ana', apellido: 'Uno' });
  const b = e.registrar('20400002', { nombre: 'Beto', apellido: 'Dos' });
  e.vender(a, { dia: e.dia(1), factura: 'BA1', monto: 4500, m2: 230 }); // ronda 1: 3 cupones y 2 tickets Austral
  e.vender(a, { dia: e.dia(8), factura: 'BA2', monto: 1500 }); // ronda 2: 1
  e.vender(a, { dia: e.dia(29), factura: 'BA3', monto: 9000 }); // La Ñapa: 6 → 10 en total
  e.vender(b, { dia: e.dia(15), factura: 'BB1', monto: 3000, m2: 100 }); // ronda 3: 2 y 1 ticket, no llega a la meta

  const bolsas = plano(e.gas.armarBolsas_(e.stats(), e.gas.leerUsuarios_(), e.gas.leerConfig_()));
  assert.deepEqual(bolsas.map((x) => [x.id, x.nombre, x.cupones.length]), [
    ['r1', 'Ronda 1', 3], ['r2', 'Ronda 2', 1], ['r3', 'Ronda 3', 2], ['final', 'Gran Sorteo Final', 3],
  ]);
  assert.equal(bolsas[0].cupones[0].codigo, 'R1-0001');
  assert.equal(bolsas[0].cupones[0].sucursal, 'Boleíta');
  assert.deepEqual(bolsas[3].cupones.map((c) => [c.codigo, c.cedula, c.origen]), [
    ['F-0001', '20400001', 'cupones'], ['F-0002', '20400001', 'austral'], ['F-0003', '20400001', 'austral'],
  ], '1 cupón final (10 cupones) + 2 tickets Austral; Beto no llega al 80 % de su meta');
  assert.equal(bolsas[0].fecha, e.dia(10), 'cada bolsa trae la fecha de su sorteo');

  e.gas.escribirConfig_('austral_requiere_meta', 'NO');
  const final = plano(e.gas.armarBolsas_(e.stats(), e.gas.leerUsuarios_(), e.gas.leerConfig_())).at(-1);
  assert.equal(final.cupones.length, 4, 'con austral_requiere_meta = NO, el ticket de Beto también entra');
});

test('ranking de la ronda en el portal, sin cédulas', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const cupones = [3, 2, 1, 0];
  const tokens = cupones.map((c, i) => e.registrar('8000000' + i, { nombre: 'Vendedor', apellido: 'N' + 'abcd'[i] }));
  cupones.forEach((c, i) => e.vender(tokens[i], { dia: e.dia(8), factura: 'S' + i, monto: c * 1500 + 100 }));
  const d = e.api('getDashboard', { token: tokens[1] }).data;
  assert.equal(d.ranking.ronda.nombre, 'Ronda 2');
  assert.equal(d.ranking.ronda.participantes, 3, 'con 0 cupones en la ronda no aparece');
  assert.equal(d.ranking.ronda.mi_posicion, 2);
  assert.equal(d.resumen.ronda.posicion, 2);
  assert.ok(d.ranking.ronda.sorteo && d.ranking.ronda.corte > 0);
  assert.ok(!JSON.stringify(d.ranking).includes('8000000'), 'el ranking público no expone cédulas');
});

test('menús: cupones para sorteo en la hoja Ranking, resultado de una ronda y resumen', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const t = e.registrar('20500001', { nombre: 'Rosa', apellido: 'Ríos' });
  e.vender(t, { dia: e.dia(1), factura: 'M1', monto: 4500 });
  e.vender(t, { dia: e.dia(8), factura: 'M2', monto: 1500, m2: 120 });
  e.gas.menuGenerarCupones();
  const ranking = e.servicios.ss.getSheetByName('Ranking').getDataRange().getValues();
  const col = ranking[2].indexOf('Código');
  assert.ok(col > -1);
  assert.equal(ranking[3][col - 1], 'Ronda 1');
  assert.equal(ranking[3][col], 'R1-0001');
  assert.equal(typeof ranking[3][col + 2], 'string', 'la cédula queda como texto');
  assert.match(e.servicios.ui.alertas.at(-1).msg, /5 cupones/);

  e.servicios.ui.respuestasPrompt.push({ boton: 'OK', texto: '1' });
  e.gas.menuResultadoRonda();
  const msg = e.servicios.ui.alertas.at(-1).msg;
  assert.match(msg, /Ronda 1/);
  assert.match(msg, /1\. Rosa Ríos \(Boleíta\) · 3 cupones/);

  e.gas.menuResumenSorteo();
  const resumen = e.servicios.ui.alertas.at(-1).msg;
  assert.match(resumen, /La bolsa de los deseos/);
  assert.match(resumen, /Ronda 2 \([^)]*\): 1 cupones de 1 vendedores/);
  assert.match(resumen, /Gran Sorteo Final[^\n]*: 1 cupones/);
});

// ------------------------------------------------------------
// Administrador
// ------------------------------------------------------------

test('administrador: se crea a mano en Usuarios, define su clave y audita todo', () => {
  const e = entorno({ inicioHaceDias: 10 });
  e.canal('Tienda', 'Boleíta', { meta: 5000 });
  const tokens = [0, 1, 2].map((i) => e.registrar('7000001' + i, { canal: i === 2 ? 'Distribuidor' : 'Tienda', sucursal: i === 2 ? '' : 'Boleíta' }));
  e.vender(tokens[0], { dia: e.dia(1), factura: 'AD0', monto: 15000, m2: 200 });
  e.vender(tokens[1], { dia: e.dia(8), factura: 'AD1', monto: 3000 });
  e.vender(tokens[2], { dia: e.dia(8), factura: 'AD2', monto: 1500 });

  e.agregarUsuarioAMano({ cedula: "'10200300", nombre: 'Carmen', apellido: 'Auditora', telefono: "'04121112233", rol: 'admin', estado: 'activo' });
  assert.equal(e.api('login', { cedula: '10200300', password: 'cualquiera' }).code, 'RESET_REQUIRED');
  const def = e.api('setPassword', { cedula: '10200300', telefono: '0412-111-2233', password: 'admin123' });
  assert.equal(def.ok, true, JSON.stringify(def));
  assert.equal(def.data.usuario.rol, 'admin');
  assert.equal(def.data.usuario.necesita_canal, false, 'el admin no necesita canal');
  const admin = def.data.token;

  const res = e.api('adminResumen', { token: admin });
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  assert.equal(res.data.totales.vendedores_registrados, 3, 'el admin no cuenta como vendedor');
  assert.equal(res.data.totales.cupones, 13);
  assert.equal(res.data.totales.cumplen_meta, 2, '$15.000 cumple; $3.000 no llega al 80 % de $5.000; Distribuidor sin meta cumple');
  assert.equal(res.data.totales.cupones_final, 1);
  assert.equal(res.data.rondas.length, 4);
  assert.deepEqual(plano(res.data.bolsas.map((b) => b.id)), ['r1', 'r2', 'r3', 'final']);
  const boleita = res.data.canales.find((c) => c.nombre === 'Boleíta');
  assert.deepEqual([boleita.vendedores, boleita.meta, boleita.cumplen, boleita.monto_por_cupon], [2, 5000, 1, 1500]);
  assert.equal(res.data.canales.find((c) => c.nombre === 'Distribuidores').vendedores, 1);

  const vend = e.api('adminVendedores', { token: admin }).data.vendedores;
  assert.equal(vend.length, 3);
  assert.equal(vend[0].cedula, '70000010', 'el admin ve la cédula completa');
  assert.deepEqual([vend[0].grupo, vend[0].meta, vend[0].cumple, vend[0].cupones_final], ['Boleíta', 5000, true, 1]);
  assert.equal(vend.find((v) => v.cedula === '70000011').avance, 0.6);

  const ventas = e.api('adminVentas', { token: admin }).data;
  assert.equal(ventas.ventas.length, 3);
  assert.ok(ventas.ventas.every((v) => v.vendedor && v.cedula && v.ronda >= 1 && v.grupo));
  assert.equal(ventas.rondas.length, 4);

  const ronda = e.api('adminRonda', { token: admin, ronda: 2 }).data;
  assert.equal(ronda.nombre, 'Ronda 2');
  assert.deepEqual(plano(ronda.lista.map((x) => [x.cedula, x.cupones])), [['70000011', 2], ['70000012', 1]]);

  const bolsa = e.api('adminCupones', { token: admin, bolsa: 'r1' }).data;
  assert.equal(bolsa.bolsas.length, 1);
  assert.equal(bolsa.bolsas[0].cupones.length, 10);
  assert.equal(bolsa.sorteo, 'La bolsa de los deseos');
  assert.equal(e.api('adminCupones', { token: admin }).data.bolsas.length, 4, 'sin bolsa: todas');
  assert.equal(e.api('adminCupones', { token: admin, bolsa: 'nada' }).code, 'NOT_FOUND');

  assert.equal(e.api('getPhoto', { token: admin, id: ventas.ventas[0].id }).ok, true, 'puede ver cualquier foto');
  assert.equal(e.vender(admin, { dia: e.hoy, factura: 'ADM-1', monto: 10 }).code, 'FORBIDDEN');
  ['adminResumen', 'adminVendedores', 'adminVentas', 'adminRonda', 'adminCupones'].forEach((accion) => {
    assert.equal(e.api(accion, { token: tokens[0] }).code, 'FORBIDDEN', accion);
  });
});

test('getPhoto: cada vendedor solo ve sus propias fotos', () => {
  const e = entorno();
  const a = e.registrar('94000001');
  const b = e.registrar('94000002');
  const venta = e.vender(a, { dia: e.hoy, factura: 'FOT1', monto: 10, foto: PNG });
  const id = venta.data.registro.id;
  assert.equal(e.api('getPhoto', { token: a, id }).data.foto, PNG);
  assert.equal(e.api('getPhoto', { token: b, id }).code, 'NOT_FOUND');
});

test('ranking oculto si mostrar_ranking_publico = NO', () => {
  const e = entorno({ config: { mostrar_ranking_publico: 'NO' } });
  const t = e.registrar('95000001');
  assert.equal(e.api('getDashboard', { token: t }).data.ranking, null);
  assert.equal(e.api('getRanking', { token: t }).code, 'FORBIDDEN');
});

// ------------------------------------------------------------
// Datos de prueba, volumen y robustez
// ------------------------------------------------------------

test('datos de prueba: tiendas, distribuidor y corporativo; se borran sin tocar a nadie más', () => {
  const e = entorno({ inicioHaceDias: 20 });
  e.registrar('96000001');
  e.agregarUsuarioAMano({ cedula: "'90000003", nombre: 'Admin', apellido: 'Real', rol: 'admin' });
  e.gas.menuCargarDatosPrueba();
  assert.ok(Object.keys(e.stats().vendedores).length >= 6);
  const cfg = e.gas.leerConfig_();
  const perfiles = e.gas.leerUsuarios_({ fresco: true }).filter((u) => u.cedula.startsWith('9000000') && u.rol !== 'admin').map((u) => e.gas.perfilUsuario_(u, cfg));
  assert.ok(perfiles.every(Boolean), 'todos con canal válido');
  assert.ok(perfiles.some((p) => p.canal === 'Distribuidor') && perfiles.some((p) => p.canal === 'Corporativo'));
  e.gas.menuBorrarDatosPrueba();
  assert.equal(e.gas.leerRegistros_({ fresco: true }).length, 0);
  assert.deepEqual(e.gas.leerUsuarios_({ fresco: true }).map((u) => u.cedula).sort(), ['90000003', '96000001'], 'el usuario real y el admin se conservan');
});

test('miles de registros: el caché en trozos funciona y los cálculos cuadran', () => {
  const e = entorno({ inicioHaceDias: 30 });
  const t = e.registrar('97000001');
  const filas = [];
  for (let i = 0; i < 3000; i++) {
    filas.push(e.gas.filaRegistro_({
      id: 'CP-' + String(i + 1).padStart(6, '0'), fechaCarga: Date.now() - i * 1000, cedula: String(97000100 + (i % 120)),
      nombre: 'Prueba Masiva', diaVenta: e.dia(i % 30), factura: 'M' + i, facturaNorm: '', montoCentavos: 75000,
      austral: i % 3 === 0, m2Centesimas: i % 3 === 0 ? 1050 : 0, urlFoto: '', estado: 'Aprobada', nota: '',
    }));
  }
  const sh = e.servicios.ss.getSheetByName('Registros');
  sh.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
  e.servicios.cache._vaciar();
  const d1 = e.api('getDashboard', { token: t });
  assert.equal(d1.ok, true, JSON.stringify(d1).slice(0, 300));
  assert.equal(d1.data.ranking.general.participantes, 120);
  assert.equal(d1.data.ranking.general.top[0].cupones, 12, '25 ventas × $750 = $18.750 → 12 cupones (valor de respaldo $1.500)');
  assert.ok(Number(e.servicios.cache.get('tbl_Registros')) > 1, 'se guardó en varios trozos');
  const d2 = e.api('getDashboard', { token: t });
  assert.deepEqual(d2.data.ranking, d1.data.ranking);
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'NUEVA-1', monto: 1500 }).data.registro.id, 'CP-003001');
});

test('acciones desconocidas o cuerpo inválido no rompen el servicio', () => {
  const e = entorno();
  assert.equal(e.api('borrarTodo').code, 'BAD_REQUEST');
  assert.equal(JSON.parse(e.gas.doPost({ postData: { contents: '{no es json' } }).getContent()).code, 'BAD_REQUEST');
  assert.equal(JSON.parse(e.gas.doGet({ parameter: { action: 'config', api_token: 'copaprosein' } }).getContent()).data.nombre, 'Copa Prosein');
});
