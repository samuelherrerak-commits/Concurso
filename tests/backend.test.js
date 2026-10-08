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
 * Concurso de prueba que empezó hace `inicioHaceDias` días, con semanas de 7 días.
 * Por defecto no se bloquean las semanas cerradas (las pruebas de cortes lo activan).
 */
function entorno(opciones = {}) {
  const { inicioHaceDias = 10, semanas = 8, config = {}, inicio: inicioFijo } = opciones;
  const e = crearEntorno({ silencioso: true });
  e.gas.setup();
  const hoy = e.gas.hoyISO_();
  const inicio = inicioFijo || e.gas.sumarDias_(hoy, -inicioHaceDias);
  e.gas.escribirConfig_('fecha_inicio', e.gas.fechaDesdeISO_(inicio));
  e.gas.escribirConfig_('num_semanas', semanas);
  e.gas.escribirConfig_('bloquear_semanas_cerradas', 'NO');
  Object.keys(config).forEach((k) => e.gas.escribirConfig_(k, config[k]));
  e.gas.escribirPeriodos_(e.gas.periodosDesdeConfig_());
  e.servicios.cache._vaciar();
  e.hoy = hoy;
  e.inicio = inicio;
  e.dia = (n) => e.gas.sumarDias_(inicio, n);
  e.registrar = (cedula, extra = {}) => {
    const r = e.api('register', {
      cedula, nombre: 'ana', apellido: 'pérez', telefono: '0414 123 45' + String(cedula).slice(-2), password: 'secreto1', sucursal: 'Boleíta', ...extra,
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
  /** Agrega una fila a Usuarios a mano, como lo haría el admin en el Sheet. */
  e.agregarUsuarioAMano = (datos) => {
    const sh = e.servicios.ss.getSheetByName('Usuarios');
    const encabezados = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.appendRow(encabezados.map((h) => (datos[h] === undefined ? '' : datos[h])));
    e.servicios.cache._vaciar();
  };
  e.stats = () => e.gas.calcularEstadisticas_(e.gas.leerRegistros_({ fresco: true }), e.gas.leerConfig_());
  e.reloj = (ms) => { e.gas.ahora_ = () => ms; };
  return e;
}

// ------------------------------------------------------------
// Instalación y migración
// ------------------------------------------------------------

test('setup crea las 5 hojas, las semanas desde el jueves 15/10 y se puede correr dos veces', () => {
  const e = crearEntorno({ silencioso: true });
  e.gas.setup();
  e.gas.setup();
  const nombres = e.servicios.ss.getSheets().map((h) => h.getName());
  assert.deepEqual(nombres, ['Configuracion', 'Periodos', 'Registros', 'Usuarios', 'Ranking']);
  const cfgFilas = e.servicios.ss.getSheetByName('Configuracion').getDataRange().getValues().slice(1);
  const claves = cfgFilas.map((f) => f[0]);
  assert.equal(new Set(claves).size, claves.length);
  ['monto_por_cupon', 'm2_por_cupon_austral', 'sucursales', 'categorias_modo', 'premios_viaje', 'hora_corte', 'num_semanas'].forEach((k) => assert.ok(claves.includes(k), k));
  assert.equal(cfgFilas.find((f) => f[0] === 'hora_corte')[1], '15:00', 'la hora queda como texto');
  assert.ok(cfgFilas.find((f) => f[0] === 'carpeta_fotos_id')[1], 'carpeta de fotos creada');
  assert.equal(e.servicios.DriveApp._carpetas.size, 1, 'no crea carpetas repetidas');

  const cfg = e.gas.leerConfig_();
  assert.equal(cfg.periodos.length, 10);
  assert.equal(cfg.periodos[0].inicio, '2026-10-15');
  assert.equal(cfg.periodos[0].fin, '2026-10-21', 'de jueves a miércoles');
  assert.equal(cfg.periodos[0].corte, caracas('2026-10-22', 15), 'corte el jueves a las 3 p. m.');
  assert.equal(cfg.periodos[0].entrega, '2026-10-23', 'premios el viernes');
  assert.equal(cfg.periodos[9].fin, '2026-12-23');
  assert.equal(cfg.periodos[9].corte, caracas('2026-12-24', 15), 'corte final');
  assert.equal(e.servicios.ss.getSheetByName('Periodos').getLastRow(), 11, 'una fila por semana');
  assert.deepEqual(plano(cfg.sucursales), ['Boleíta', 'La Castellana', 'Los Naranjos', 'El Bosque', 'Las Mercedes', 'San Martín', 'Maracaibo', 'Acarigua', 'Barquisimeto']);
});

test('setup funciona aunque no haya interfaz (ejecutado desde el editor)', () => {
  const e = crearEntorno({ silencioso: true, sinUi: true });
  assert.doesNotThrow(() => e.gas.setup());
});

test('setup actualiza un Sheet de la versión anterior sin perder datos', () => {
  const e = crearEntorno({ silencioso: true });
  const ss = e.servicios.ss;
  const cfg = ss.insertSheet('Configuracion');
  cfg.appendRow(['clave', 'valor', 'descripcion']);
  cfg.appendRow(['fecha_inicio', e.gas.fechaDesdeISO_('2026-10-08'), 'vieja']);
  cfg.appendRow(['fecha_fin', e.gas.fechaDesdeISO_('2026-12-02'), 'vieja']);
  cfg.appendRow(['monto_por_cupon', 2000, 'vieja']);
  cfg.appendRow(['concurso_abierto', 'SI', 'vieja']);
  const us = ss.insertSheet('Usuarios');
  const viejos = ['cedula', 'nombre', 'apellido', 'telefono', 'sucursal_o_zona', 'password_hash', 'salt', 'fecha_registro', 'estado', 'intentos_fallidos', 'bloqueado_hasta'];
  us.appendRow(viejos);
  const salt = 'abc';
  us.appendRow(["'12345678", 'Ana', 'Pérez', "'04141234567", 'Zona Este', e.gas.hashClave_('secreto1', salt), salt, new Date(), 'activo', 0, '']);

  e.gas.setup();
  const filas = cfg.getDataRange().getValues();
  assert.equal(filas.find((f) => f[0] === 'monto_por_cupon')[1], 2000, 'conserva los valores que ya tenía');
  assert.match(filas.find((f) => f[0] === 'fecha_fin')[2], /YA NO SE USA/);
  assert.match(filas.find((f) => f[0] === 'fecha_inicio')[2], /Periodos/, 'actualiza la descripción');
  assert.ok(filas.some((f) => f[0] === 'sucursales'), 'agrega las claves nuevas');
  assert.equal(us.getRange(1, 12).getValue(), 'rol', 'agrega la columna rol al final');
  assert.equal(e.gas.leerConfig_().periodos[0].inicio, '2026-10-08', 'arma las semanas con la fecha que había');

  // El usuario viejo entra, pero se le pide elegir tienda antes de vender.
  const r = e.api('login', { cedula: '12345678', password: 'secreto1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.usuario.necesita_sucursal, true);
  assert.equal(r.data.usuario.rol, 'vendedor');
});

// ------------------------------------------------------------
// Registro, tiendas y acceso
// ------------------------------------------------------------

test('registro valida datos, exige tienda de la lista y guarda texto sin perder ceros', () => {
  const e = entorno();
  const base = { nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1', sucursal: 'Boleíta' };
  assert.equal(e.api('register', { ...base, cedula: '12.34' }).code, 'VALIDATION');
  assert.equal(e.api('register', { ...base, cedula: '12345678', password: '123' }).campo, 'password');
  assert.equal(e.api('register', { ...base, cedula: '12345678', telefono: '123' }).campo, 'telefono');
  assert.equal(e.api('register', { ...base, cedula: '12345678', sucursal: '' }).campo, 'sucursal');
  assert.equal(e.api('register', { ...base, cedula: '12345678', sucursal: 'Valencia' }).campo, 'sucursal');
  assert.equal(e.api('register', { ...base, cedula: '12345678', sucursal: '=HYPERLINK("http://x")' }).campo, 'sucursal', 'no entra texto libre');

  const ok = e.api('register', { cedula: 'V-12.345.678', nombre: '  maría   josé ', apellido: 'PÉREZ', telefono: '0414-123-4567', password: 'secreto1', sucursal: '  san martin ' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.usuario.nombre, 'María José');
  assert.equal(ok.data.usuario.apellido, 'Pérez');
  assert.equal(ok.data.usuario.cedula_mask, '12••••78');
  assert.equal(ok.data.usuario.sucursal, 'San Martín', 'se guarda el nombre oficial de la tienda');
  assert.equal(ok.data.usuario.rol, 'vendedor');
  assert.equal(ok.data.usuario.necesita_sucursal, false);
  assert.ok(ok.data.token.length >= 32);

  const fila = e.servicios.ss.getSheetByName('Usuarios').getRange(2, 1, 1, 12).getValues()[0];
  assert.equal(fila[0], '12345678');
  assert.equal(fila[3], '04141234567', 'el teléfono conserva el 0 inicial');
  assert.equal(fila[4], 'San Martín');
  assert.match(fila[5], /^v1\$\d+\$[0-9a-f]{64}$/, 'la contraseña se guarda como hash');
  assert.equal(fila[11], 'vendedor');
  assert.ok(!JSON.stringify(fila).includes('secreto1'));

  assert.equal(e.api('register', { ...base, cedula: '12345678', rol: 'admin' }).code, 'DUPLICATE');
  const otro = e.api('register', { ...base, cedula: '23456789', rol: 'admin' });
  assert.equal(otro.data.usuario.rol, 'vendedor', 'nadie se registra como admin');

  const conf = e.api('config').data;
  assert.equal(conf.sucursales.length, 9, 'el formulario recibe la lista de tiendas');
});

test('la lista de tiendas se cambia desde Configuracion', () => {
  const e = entorno({ config: { sucursales: 'Boleíta, Valencia; Puerto Ordaz' } });
  assert.deepEqual(plano(e.api('config').data.sucursales), ['Boleíta', 'Valencia', 'Puerto Ordaz']);
  assert.equal(e.api('register', { cedula: '33445566', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1', sucursal: 'valencia' }).ok, true);
});

test('cuentas sin tienda válida: deben elegirla antes de vender, y solo una vez', () => {
  const e = entorno();
  const t = e.registrar('34445566');
  e.editarUsuario('34445566', 'sucursal_o_zona', 'Zona Vieja');
  const d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.usuario.necesita_sucursal, true);
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'NS1', monto: 10 }).code, 'NEED_SUCURSAL');
  assert.equal(e.api('setSucursal', { token: t, sucursal: 'Nada' }).campo, 'sucursal');
  const ok = e.api('setSucursal', { token: t, sucursal: 'Maracaibo' });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.usuario.sucursal, 'Maracaibo');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'NS1', monto: 10 }).ok, true);
  assert.equal(e.api('setSucursal', { token: t, sucursal: 'Acarigua' }).code, 'FORBIDDEN', 'no se cambia de tienda desde el portal');
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
  const r = e.api('login', { cedula: '93000001', password: 'secreto1' });
  assert.equal(r.code, 'RESET_REQUIRED');
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
// Cupones y semanas
// ------------------------------------------------------------

test('cupones acumulados: el sobrante pasa de una semana a la otra', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const t = e.registrar('20111222');
  // Semana 1: $4.000 → 2 cupones, sobran $1.000.
  assert.equal(e.vender(t, { dia: e.dia(0), factura: 'A-1', monto: 2500 }).ok, true);
  assert.equal(e.vender(t, { dia: e.dia(3), factura: 'A-2', monto: 1500 }).ok, true);
  // Semana 2: $600 → los $1.000 sobrantes + $600 completan 1 cupón; sobran $100.
  const r = e.vender(t, { dia: e.dia(8), factura: 'A-3', monto: 600 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.cupones_antes, 2);
  assert.equal(r.data.cupones_despues, 3);
  assert.equal(r.data.cupones_nuevos, 1);
  assert.equal(r.data.sobrante, 100);
  assert.equal(r.data.falta_para_proximo, 1400);
  assert.equal(r.data.cupones_semana_actual, 1, 'hoy es semana 2');

  const v = e.stats().vendedores['20111222'];
  assert.equal(v.semanas[1].cupones, 2);
  assert.equal(v.semanas[2].cupones, 1);

  const d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 3);
  assert.equal(d.resumen.total, 4600);
  assert.equal(d.resumen.semana.numero, 2);
  assert.equal(d.resumen.semana.cupones, 1);
  assert.equal(d.resumen.semana.monto, 600);
  assert.equal(Math.round(d.resumen.progreso * 1000), 67);
  assert.deepEqual(d.cupones.map((c) => [c.n, c.factura, c.semana]), [[1, 'A-1', 1], [2, 'A-2', 1], [3, 'A-3', 2]]);
  assert.deepEqual(d.registros.map((x) => x.numero_factura), ['A-3', 'A-2', 'A-1'], 'historial del más reciente al más viejo');
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

test('una venta cargada tarde en la semana 1 no cambia la semana 2 si no cruza el umbral', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const t = e.registrar('20111223');
  e.vender(t, { dia: e.dia(1), factura: 'B-1', monto: 1000 });
  e.vender(t, { dia: e.dia(8), factura: 'B-2', monto: 1000 });
  let v = e.stats().vendedores['20111223'];
  assert.equal(v.semanas[1].cupones, 0);
  assert.equal(v.semanas[2].cupones, 1);
  const r = e.vender(t, { dia: e.dia(2), factura: 'B-3', monto: 600 });
  assert.equal(r.data.cupones_nuevos, 0, '$2.600 sigue siendo 1 cupón');
  v = e.stats().vendedores['20111223'];
  assert.equal(v.semanas[1].cupones, 1);
  assert.equal(v.semanas[2].cupones, 0);
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
  assert.equal(b.data.acumulado, 3300.5);
  assert.equal(b.data.sobrante, 300.5);
  assert.equal(b.data.sobrante_antes, 1000);
  assert.equal(b.data.registro.estado, 'Pendiente');
  assert.match(b.data.registro.id, /^CP-\d{6}$/);
  const archivo = [...e.servicios.DriveApp._archivos.values()][1];
  assert.match(archivo.getName(), /^30111222_2_\d+\.jpg$/);
});

test('cupones del viaje: 1 por cada 100 m² de Austral, el sobrante se acumula', () => {
  const e = entorno();
  const t = e.registrar('31111222');
  const a = e.vender(t, { dia: e.hoy, factura: 'AU-1', monto: 900, m2: 60 });
  assert.equal(a.data.austral_nuevos, 0);
  assert.equal(a.data.m2_falta, 40);
  const b = e.vender(t, { dia: e.hoy, factura: 'AU-2', monto: 900, m2: 145.5 });
  assert.equal(b.data.austral_antes, 0);
  assert.equal(b.data.austral_despues, 2, '60 + 145,5 = 205,5 m² → 2 cupones');
  assert.equal(b.data.austral_nuevos, 2);
  assert.deepEqual(b.data.nuevos_cupones_austral.map((c) => [c.n, c.factura, c.m2, c.m2_acumulado]), [[1, 'AU-2', 145.5, 205.5], [2, 'AU-2', 145.5, 205.5]]);
  assert.equal(b.data.m2_sobrante, 5.5);
  assert.equal(b.data.m2_sobrante_antes, 60);
  assert.equal(b.data.m2_falta, 94.5);
  assert.equal(b.data.cupones_nuevos, 1, 'el monto también suma cupones normales');

  const d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.austral.cupones, 2);
  assert.equal(d.resumen.austral.m2, 205.5);
  assert.equal(d.resumen.austral.falta, 94.5);
  assert.equal(d.cupones_austral.length, 2);
  assert.equal(d.cupones_austral[0].m2_falta, 94.5);

  const e2 = entorno({ config: { m2_por_cupon_austral: 50 } });
  const t2 = e2.registrar('31111333');
  assert.equal(e2.vender(t2, { dia: e2.hoy, factura: 'AU-9', monto: 10, m2: 120 }).data.austral_nuevos, 2, 'la regla se cambia en Configuracion');
});

test('si vendió Austral, los m² son obligatorios', () => {
  const e = entorno();
  const t = e.registrar('50111222');
  const sinM2 = e.api('addSale', { token: t, dia_venta: e.hoy, numero_factura: 'X1', monto: 100, vendio_austral: true, foto: JPEG });
  assert.equal(sinM2.code, 'VALIDATION');
  assert.equal(sinM2.campo, 'm2_austral');
  const cero = e.api('addSale', { token: t, dia_venta: e.hoy, numero_factura: 'X1', monto: 100, vendio_austral: true, m2_austral: 0, foto: JPEG });
  assert.equal(cero.campo, 'm2_austral');
  const ok = e.api('addSale', { token: t, dia_venta: e.hoy, numero_factura: 'X1', monto: 100, vendio_austral: true, m2_austral: '35,5', foto: JPEG });
  assert.equal(ok.ok, true);
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
  const mismo = e.vender(t1, { dia: e.hoy, factura: '000123', monto: 500 });
  assert.equal(mismo.code, 'DUPLICATE');
  assert.match(mismo.message, /Ya registraste/);
  const otro = e.vender(t2, { dia: e.hoy, factura: '123', monto: 500 });
  assert.equal(otro.code, 'DUPLICATE');
  assert.match(otro.message, /otro vendedor/);
  assert.equal(otro.campo, 'numero_factura');
  e.editarRegistro(r1.data.registro.id, 'estado', 'Rechazada');
  assert.equal(e.vender(t2, { dia: e.hoy, factura: '123', monto: 500 }).ok, true);
});

test('valida fecha (futura, fuera del concurso, inexistente), monto y foto', () => {
  const e = entorno({ inicioHaceDias: 3 });
  const t = e.registrar('60111222');
  assert.equal(e.vender(t, { dia: e.gas.sumarDias_(e.hoy, 1), factura: 'F1', monto: 10 }).message, 'La fecha no puede ser futura.');
  assert.match(e.vender(t, { dia: e.dia(-1), factura: 'F1', monto: 10 }).message, /dentro del concurso/);
  assert.equal(e.vender(t, { dia: '2026-02-30', factura: 'F1', monto: 10 }).campo, 'dia_venta');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 0 }).campo, 'monto');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: -5 }).campo, 'monto');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 250000 }).campo, 'monto');
  assert.equal(e.vender(t, { dia: e.hoy, factura: '', monto: 10 }).campo, 'numero_factura');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 10, foto: 'hola' }).campo, 'foto');
  const noEsImagen = 'data:image/jpeg;base64,' + Buffer.from('<?php echo 1; ?>').toString('base64');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 10, foto: noEsImagen }).campo, 'foto');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'F1', monto: 10, foto: PNG }).ok, true);
  assert.equal(e.servicios.DriveApp._archivos.size, 1, 'las ventas inválidas no suben fotos');
});

test('cortes: la semana cierra el jueves a las 3 p. m. y después no se cargan sus ventas', () => {
  const e = entorno({ inicio: '2026-10-15', semanas: 10, config: { bloquear_semanas_cerradas: 'SI' } });
  e.reloj(caracas('2026-10-20', 9));
  const t = e.registrar('35111222');

  e.reloj(caracas('2026-10-10', 9));
  let s = e.gas.semanaActual_(e.gas.leerConfig_());
  assert.equal(s.estado, 'antes');
  assert.equal(s.numero, 0);
  assert.match(e.vender(t, { dia: '2026-10-10', factura: 'Q0', monto: 10 }).message, /dentro del concurso/);

  // Jueves 22 en la mañana: la semana 1 (15–21) sigue en juego hasta el corte.
  e.reloj(caracas('2026-10-22', 10));
  s = e.gas.semanaActual_(e.gas.leerConfig_());
  assert.equal(s.numero, 1);
  assert.equal(s.estado, 'en_corte');
  assert.equal(e.vender(t, { dia: '2026-10-21', factura: 'Q1', monto: 10 }).ok, true, 'antes del corte sí');
  assert.equal(e.vender(t, { dia: '2026-10-22', factura: 'Q2', monto: 10 }).ok, true, 'el jueves ya es la semana 2');
  assert.equal(e.gas.semanaDe_('2026-10-22', e.gas.leerConfig_()), 2);

  // Jueves 22 a las 3:00 p. m. en punto: la semana 1 queda cerrada.
  e.reloj(caracas('2026-10-22', 15));
  const tarde = e.vender(t, { dia: '2026-10-21', factura: 'Q3', monto: 10 });
  assert.equal(tarde.campo, 'dia_venta');
  assert.match(tarde.message, /La semana 1 cerró el 22\/10\/2026 a las 15:00/);
  s = e.gas.semanaActual_(e.gas.leerConfig_());
  assert.equal(s.numero, 2);
  assert.equal(s.estado, 'en_curso');
  const conf = e.api('config').data;
  assert.equal(conf.dia_min_carga, '2026-10-22', 'el formulario ya no ofrece días de la semana 1');
  assert.equal(conf.dia_max_carga, '2026-10-22');

  // Después del corte final ya no se carga nada.
  e.reloj(caracas('2026-12-24', 16));
  s = e.gas.semanaActual_(e.gas.leerConfig_());
  assert.equal(s.estado, 'terminado');
  assert.equal(s.numero, 10);
  assert.match(e.vender(t, { dia: '2026-12-23', factura: 'Q4', monto: 10 }).message, /La semana 10 cerró/);
  assert.equal(e.api('config').data.dia_max_carga, '');

  // Con bloquear_semanas_cerradas = NO se aceptan ventas tardías.
  e.gas.escribirConfig_('bloquear_semanas_cerradas', 'NO');
  assert.equal(e.vender(t, { dia: '2026-12-23', factura: 'Q4', monto: 10 }).ok, true);
});

test('la hoja Periodos manda: se pueden editar semanas y cortes a mano', () => {
  const e = entorno({ inicio: '2026-10-15', semanas: 3 });
  const sh = e.servicios.ss.getSheetByName('Periodos');
  // La semana 2 se alarga hasta el viernes 30 y su corte pasa al sábado a las 10:00.
  sh.getRange(3, 3).setValue(e.gas.fechaDesdeISO_('2026-10-30'));
  sh.getRange(3, 4).setValue('31/10/2026 10:00');
  sh.getRange(4, 2).setValue(e.gas.fechaDesdeISO_('2026-10-31'));
  e.servicios.cache._vaciar();
  const cfg = e.gas.leerConfig_();
  assert.equal(e.gas.semanaDe_('2026-10-30', cfg), 2);
  assert.equal(e.gas.semanaDe_('2026-10-31', cfg), 3);
  assert.equal(cfg.periodos[1].corte, caracas('2026-10-31', 10));

  // Semanas solapadas: error claro en vez de cálculos raros.
  sh.getRange(4, 2).setValue(e.gas.fechaDesdeISO_('2026-10-29'));
  e.servicios.cache._vaciar();
  const r = e.api('config');
  assert.equal(r.code, 'SERVER');
  assert.match(r.message, /se solapan/);
});

test('generar periodos usa la hora de corte aunque Sheets la guarde como hora', () => {
  const e = entorno({ inicio: '2026-10-15', semanas: 2 });
  const hora = e.servicios.Utilities.parseDate('1899-12-30 16:30', 'America/Caracas', 'yyyy-MM-dd HH:mm');
  e.gas.escribirConfig_('hora_corte', hora);
  e.gas.escribirPeriodos_(e.gas.periodosDesdeConfig_());
  assert.equal(e.gas.leerConfig_().periodos[0].corte, caracas('2026-10-22', 16, 30));
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
  assert.equal(d.resumen.ventas_pendientes, 1);
  assert.equal(d.resumen.monto_pendiente, 3100);
  e.editarRegistro(r.data.registro.id, 'estado', 'Aprobada');
  d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 2);
  assert.equal(d.resumen.ventas_pendientes, 0);
});

test('rechazar una factura descuenta sus cupones (todo se recalcula)', () => {
  const e = entorno();
  const t = e.registrar('81111222');
  const r = e.vender(t, { dia: e.hoy, factura: 'R1', monto: 3000, m2: 150 });
  e.vender(t, { dia: e.hoy, factura: 'R2', monto: 500 });
  let d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 2);
  assert.equal(d.resumen.austral.cupones, 1);
  e.editarRegistro(r.data.registro.id, 'estado', 'Rechazada');
  e.editarRegistro(r.data.registro.id, 'nota_admin', 'Foto ilegible');
  d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 0);
  assert.equal(d.resumen.austral.cupones, 0);
  assert.equal(d.resumen.sobrante, 500);
  assert.equal(d.registros.find((x) => x.numero_factura === 'R1').nota_admin, 'Foto ilegible');
});

test('neutraliza inyección de fórmulas en Sheets', () => {
  const e = entorno();
  const t = e.registrar('82111222');
  assert.equal(e.api('register', { cedula: '82111223', nombre: '=cmd', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1', sucursal: 'Boleíta' }).campo, 'nombre');
  assert.equal(e.vender(t, { dia: e.hoy, factura: '=1+1', monto: 10 }).campo, 'numero_factura');
  assert.equal(e.servicios.ss.getSheetByName('Usuarios').formulasEscritas.length, 0, 'no se escribió ninguna fórmula');
  assert.equal(e.gas.protegerCelda_('+58 414'), "'+58 414");
  assert.equal(e.gas.protegerCelda_('@x'), "'@x");
  assert.equal(e.gas.protegerCelda_('-1'), "'-1");
  assert.equal(e.gas.protegerCelda_('=SUM(A1)'), "'=SUM(A1)");
});

// ------------------------------------------------------------
// Rankings, categorías y urnas
// ------------------------------------------------------------

test('ranking semanal: top 6, desempate por monto y 0 cupones no califica', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const cupones = [3, 2, 2, 1, 1, 1, 1, 0];
  const tokens = cupones.map((c, i) => e.registrar('8000000' + i, { nombre: 'Vendedor', apellido: 'N' + 'abcdefgh'[i] }));
  cupones.forEach((c, i) => {
    const monto = c * 1500 + (c ? 100 * (8 - i) : 1400);
    const r = e.vender(tokens[i], { dia: e.dia(8), factura: 'S' + i, monto });
    assert.equal(r.ok, true, JSON.stringify(r));
  });
  const lista = e.gas.rankingSemana_(e.stats(), 2);
  assert.equal(lista.length, 7, 'quien tiene 0 cupones no aparece');
  assert.deepEqual(plano(lista.map((x) => x.v.cedula)), ['80000000', '80000001', '80000002', '80000003', '80000004', '80000005', '80000006']);
  assert.equal(e.gas.rankingSemana_(e.stats(), 1).length, 0);

  const g = e.gas.ganadoresSemana(2);
  assert.equal(g.ganadores.length, 6);
  assert.equal(g.empateEnCorte, false);

  e.servicios.ui.respuestasPrompt.push({ boton: 'OK', texto: '2' });
  e.gas.menuGanadoresSemanales();
  const alerta = e.servicios.ui.alertas.at(-1);
  assert.match(alerta.msg, /Semana 2/);
  assert.match(alerta.msg, /corte/);
  assert.match(alerta.msg, /1\. Vendedor Na \(C\.I\. 80000000, Boleíta\) · 3 cupones/);
  assert.ok(!alerta.msg.includes('80000006'), 'el séptimo no gana');

  const d = e.api('getDashboard', { token: tokens[3] }).data;
  assert.equal(d.ranking.semana.mi_posicion, 4);
  assert.equal(d.resumen.semana.posicion, 4);
  assert.ok(d.ranking.semana.corte > 0 && d.ranking.semana.entrega, 'el ranking trae corte y entrega');
  assert.ok(!JSON.stringify(d.ranking).includes('8000000'), 'el ranking público no expone cédulas');
});

/** 10 vendedores con 10, 9, 9, 7, 6, 5, 4, 3, 2 y 1 cupones. */
function concursoConCategorias(config = {}) {
  const e = entorno({ config });
  const cupones = [10, 9, 9, 7, 6, 5, 4, 3, 2, 1];
  const tokens = cupones.map((c, i) => {
    const t = e.registrar(String(70000010 + i), { nombre: 'Persona', apellido: 'Apellido' + 'abcdefghij'[i] });
    const r = e.vender(t, { dia: e.hoy, factura: 'G' + i, monto: c * 1500, m2: i < 4 ? 250 : 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    return t;
  });
  return { e, tokens };
}

test('categorías por porcentaje: 20 % / 30 % / resto, y los empates en el límite suben', () => {
  const { e, tokens } = concursoConCategorias();
  const cats = e.gas.calcularCategorias_(e.stats(), e.gas.leerConfig_());
  const de = (i) => cats.porCedula[String(70000010 + i)].nombre;
  // Top 20 % de 10 = 2 puestos (10 y 9 cupones), pero el tercero también tiene 9: sube a Oro.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(de), ['Oro', 'Oro', 'Oro', 'Plata', 'Plata', 'Bronce', 'Bronce', 'Bronce', 'Bronce', 'Bronce']);
  assert.deepEqual(plano(cats.resumen.map((c) => [c.nombre, c.vendedores, c.desde, c.hasta, c.premios])), [
    ['Oro', 3, 9, 10, 2], ['Plata', 2, 6, 7, 1], ['Bronce', 5, 1, 5, 1],
  ]);

  const plata = e.api('getDashboard', { token: tokens[4] }).data.resumen.categoria;
  assert.equal(plata.nombre, 'Plata');
  assert.equal(plata.provisional, true);
  assert.deepEqual(plano(plata.para_subir), { categoria: 'Oro', cupones: 3 }, 'con 6 cupones le faltan 3 para llegar a 9');
  assert.equal(e.api('getDashboard', { token: tokens[0] }).data.resumen.categoria.para_subir, null);
});

test('categorías por cupones mínimos (modo cupones)', () => {
  const { e } = concursoConCategorias({ categorias_modo: 'cupones', categoria_1_min_cupones: 7, categoria_2_min_cupones: 4 });
  const cats = e.gas.calcularCategorias_(e.stats(), e.gas.leerConfig_());
  assert.deepEqual(plano(cats.resumen.map((c) => c.vendedores)), [4, 3, 3]);
  const nombres = { categoria_1_nombre: 'Diamante', premios_categoria_1: 3 };
  const otro = concursoConCategorias(nombres).e;
  assert.equal(otro.gas.leerConfig_().categorias[0].nombre, 'Diamante');
  assert.equal(otro.gas.leerConfig_().categorias[0].premios, 3);
});

test('urnas: cada categoría con sus cupones; el viaje solo con cupones Austral de la categoría 1', () => {
  const { e, tokens } = concursoConCategorias();
  const cfg = e.gas.leerConfig_();
  const stats = e.stats();
  const cats = e.gas.calcularCategorias_(stats, cfg);
  const urnas = plano(e.gas.armarUrnas_(stats, cats, e.gas.leerUsuarios_(), cfg));
  assert.deepEqual(urnas.map((u) => [u.id, u.nombre, u.premios, u.cupones.length]), [
    ['cat1', 'Oro', 2, 28], ['cat2', 'Plata', 1, 13], ['cat3', 'Bronce', 1, 15], ['viaje', 'Viaje todo incluido', 1, 6],
  ]);
  // Los vendedores 0–3 vendieron 250 m² (2 cupones Austral cada uno); el 3 es Plata y no entra al viaje.
  assert.deepEqual([...new Set(urnas[3].cupones.map((c) => c.cedula))], ['70000010', '70000011', '70000012']);
  assert.equal(urnas[0].cupones[0].codigo, 'C1-0001');
  assert.equal(urnas[3].cupones[5].codigo, 'V-0006');
  assert.deepEqual(Object.keys(urnas[0].cupones[0]).sort(), ['categoria', 'cedula', 'codigo', 'dia_venta', 'factura', 'n', 'sucursal', 'vendedor']);
  assert.equal(urnas[0].cupones[0].sucursal, 'Boleíta');

  assert.equal(e.api('getDashboard', { token: tokens[2] }).data.resumen.austral.participa, true);
  assert.equal(e.api('getDashboard', { token: tokens[3] }).data.resumen.austral.participa, false);

  const abierto = concursoConCategorias({ viaje_hasta_categoria: 2 }).e;
  const cfg2 = abierto.gas.leerConfig_();
  const s2 = abierto.stats();
  const viaje = abierto.gas.armarUrnas_(s2, abierto.gas.calcularCategorias_(s2, cfg2), abierto.gas.leerUsuarios_(), cfg2)[3];
  assert.equal(viaje.cupones.length, 8, 'con viaje_hasta_categoria = 2 entra también Plata');
});

test('cupones para sorteo: lista por urna en la hoja Ranking y resumen en el menú', () => {
  const { e } = concursoConCategorias();
  e.gas.menuGenerarCupones();
  const ranking = e.servicios.ss.getSheetByName('Ranking').getDataRange().getValues();
  const encabezados = ranking[2];
  const col = encabezados.indexOf('Código');
  assert.ok(col > -1);
  assert.equal(ranking[3][col - 1], 'Oro');
  assert.equal(ranking[3][col], 'C1-0001');
  assert.equal(typeof ranking[3][col + 2], 'string', 'la cédula queda como texto');
  assert.match(e.servicios.ui.alertas.at(-1).msg, /62 cupones/);
  e.gas.menuResumenSorteo();
  const msg = e.servicios.ui.alertas.at(-1).msg;
  assert.match(msg, /Provisional/);
  assert.match(msg, /Oro: 3 vendedores \(de 9 a 10 cupones\) · 2 premios/);
  assert.match(msg, /Viaje todo incluido: 6 cupones de 3 vendedores · 1 premio/);
});

// ------------------------------------------------------------
// Administrador
// ------------------------------------------------------------

test('administrador: se crea a mano en Usuarios, define su clave y audita todo', () => {
  const { e, tokens } = concursoConCategorias();
  e.agregarUsuarioAMano({ cedula: "'10200300", nombre: 'Carmen', apellido: 'Auditora', telefono: "'04121112233", rol: 'admin', estado: 'activo' });
  assert.equal(e.api('login', { cedula: '10200300', password: 'cualquiera' }).code, 'RESET_REQUIRED');
  const def = e.api('setPassword', { cedula: '10200300', telefono: '0412-111-2233', password: 'admin123' });
  assert.equal(def.ok, true, JSON.stringify(def));
  assert.equal(def.data.usuario.rol, 'admin');
  assert.equal(def.data.usuario.necesita_sucursal, false, 'el admin no necesita tienda');
  const admin = def.data.token;

  const res = e.api('adminResumen', { token: admin });
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  assert.equal(res.data.totales.vendedores_registrados, 10, 'el admin no cuenta como vendedor');
  assert.equal(res.data.totales.cupones, 56);
  assert.equal(res.data.totales.cupones_austral, 8);
  assert.equal(res.data.urnas.length, 4);
  assert.equal(res.data.periodos.length, 8);
  assert.equal(res.data.sucursales.find((s) => s.nombre === 'Boleíta').vendedores, 10);

  const vend = e.api('adminVendedores', { token: admin }).data.vendedores;
  assert.equal(vend.length, 10);
  assert.equal(vend[0].cedula, '70000010', 'el admin ve la cédula completa');
  assert.equal(vend[0].categoria, 'Oro');
  assert.equal(vend[0].participa_viaje, true);
  assert.equal(vend[3].participa_viaje, false);

  const ventas = e.api('adminVentas', { token: admin }).data.ventas;
  assert.equal(ventas.length, 10);
  assert.ok(ventas[0].vendedor && ventas[0].cedula && ventas[0].semana >= 1);

  const sem = e.api('adminSemana', { token: admin, semana: 2 }).data;
  assert.equal(sem.numero, 2);
  assert.equal(sem.lista.length, 10);
  assert.equal(sem.lista[0].cedula, '70000010');
  assert.equal(sem.lista.filter((x) => x.premio).length, 6);

  const urna = e.api('adminCupones', { token: admin, urna: 'viaje' }).data;
  assert.equal(urna.urnas.length, 1);
  assert.equal(urna.urnas[0].cupones.length, 6);
  assert.equal(urna.provisional, true);
  assert.equal(e.api('adminCupones', { token: admin }).data.urnas.length, 4, 'sin urna: todas');
  assert.equal(e.api('adminCupones', { token: admin, urna: 'nada' }).code, 'NOT_FOUND');

  // Puede ver cualquier foto, pero no registra ventas.
  const foto = e.api('getPhoto', { token: admin, id: ventas[0].id });
  assert.equal(foto.ok, true);
  assert.equal(e.vender(admin, { dia: e.hoy, factura: 'ADM-1', monto: 10 }).code, 'FORBIDDEN');

  // Un vendedor no entra a nada de esto.
  ['adminResumen', 'adminVendedores', 'adminVentas', 'adminSemana', 'adminCupones'].forEach((accion) => {
    assert.equal(e.api(accion, { token: tokens[0] }).code, 'FORBIDDEN', accion);
  });
});

test('getPhoto: cada vendedor solo ve sus propias fotos', () => {
  const e = entorno();
  const a = e.registrar('94000001');
  const b = e.registrar('94000002');
  const venta = e.vender(a, { dia: e.hoy, factura: 'FOT1', monto: 10, foto: PNG });
  const id = venta.data.registro.id;
  assert.equal(venta.data.registro.tiene_foto, true);
  const propia = e.api('getPhoto', { token: a, id });
  assert.equal(propia.ok, true);
  assert.equal(propia.data.foto, PNG);
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

test('datos de prueba: se cargan con tiendas reales y se borran sin tocar a nadie más', () => {
  const e = entorno({ inicioHaceDias: 20 });
  e.registrar('96000001');
  e.agregarUsuarioAMano({ cedula: "'90000003", nombre: 'Admin', apellido: 'Real', rol: 'admin' });
  e.gas.menuCargarDatosPrueba();
  const stats = e.stats();
  assert.ok(Object.keys(stats.vendedores).length >= 6);
  const usuarios = e.gas.leerUsuarios_({ fresco: true });
  assert.ok(usuarios.filter((u) => u.cedula.startsWith('9000000') && u.rol !== 'admin').every((u) => e.gas.sucursalCanonica_(u.sucursal, e.gas.leerConfig_())));
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
  assert.equal(d1.data.ranking.general.top[0].cupones, 12, '25 ventas × $750 = $18.750 → 12 cupones');
  const enCache = e.servicios.cache.get('tbl_Registros');
  assert.ok(Number(enCache) > 1, 'se guardó en varios trozos');
  const d2 = e.api('getDashboard', { token: t });
  assert.deepEqual(d2.data.ranking, d1.data.ranking);
  const venta = e.vender(t, { dia: e.hoy, factura: 'NUEVA-1', monto: 1500 });
  assert.equal(venta.data.registro.id, 'CP-003001');
});

test('acciones desconocidas o cuerpo inválido no rompen el servicio', () => {
  const e = entorno();
  assert.equal(e.api('borrarTodo').code, 'BAD_REQUEST');
  const salida = e.gas.doPost({ postData: { contents: '{no es json' } });
  assert.equal(JSON.parse(salida.getContent()).code, 'BAD_REQUEST');
  assert.equal(JSON.parse(e.gas.doGet({ parameter: {} }).getContent()).ok, true);
  assert.equal(JSON.parse(e.gas.doGet({ parameter: { action: 'config', api_token: 'copaprosein' } }).getContent()).data.nombre, 'Copa Prosein');
});
