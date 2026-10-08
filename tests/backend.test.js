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

function entorno(opciones = {}) {
  const { inicioHaceDias = 10, semanas = 8, config = {} } = opciones;
  const e = crearEntorno({ silencioso: true });
  e.gas.setup();
  const hoy = e.gas.hoyISO_();
  const inicio = e.gas.sumarDias_(hoy, -inicioHaceDias);
  e.gas.escribirConfig_('fecha_inicio', e.gas.fechaDesdeISO_(inicio));
  e.gas.escribirConfig_('fecha_fin', e.gas.fechaDesdeISO_(e.gas.sumarDias_(inicio, semanas * 7 - 1)));
  Object.keys(config).forEach((k) => e.gas.escribirConfig_(k, config[k]));
  e.hoy = hoy;
  e.inicio = inicio;
  e.dia = (n) => e.gas.sumarDias_(inicio, n);
  e.registrar = (cedula, extra = {}) => {
    const r = e.api('register', {
      cedula, nombre: 'ana', apellido: 'pérez', telefono: '0414 123 45' + String(cedula).slice(-2), password: 'secreto1', ...extra,
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
  /** Simula que el admin edita una celda de Registros (y que pasó el caché de 20 s). */
  e.editarRegistro = (id, columna, valor) => {
    const sh = e.servicios.ss.getSheetByName('Registros');
    const encabezados = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((f) => f[0]);
    const fila = ids.indexOf(id) + 1;
    assert.ok(fila > 1, 'no existe ' + id);
    sh.getRange(fila, encabezados.indexOf(columna) + 1).setValue(valor);
    e.servicios.cache._vaciar();
  };
  e.editarUsuario = (cedula, columna, valor) => {
    const sh = e.servicios.ss.getSheetByName('Usuarios');
    const encabezados = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const cedulas = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((f) => String(f[0]));
    const fila = cedulas.indexOf(String(cedula)) + 1;
    assert.ok(fila > 1, 'no existe usuario ' + cedula);
    sh.getRange(fila, encabezados.indexOf(columna) + 1).setValue(valor);
    e.servicios.cache._vaciar();
  };
  e.stats = () => e.gas.calcularEstadisticas_(e.gas.leerRegistros_({ fresco: true }), e.gas.leerConfig_());
  return e;
}

test('setup crea las 4 hojas y se puede correr dos veces sin duplicar', () => {
  const e = crearEntorno({ silencioso: true });
  e.gas.setup();
  e.gas.setup();
  const nombres = e.servicios.ss.getSheets().map((h) => h.getName());
  assert.deepEqual(nombres, ['Configuracion', 'Registros', 'Usuarios', 'Ranking']);
  const claves = e.servicios.ss.getSheetByName('Configuracion').getDataRange().getValues().slice(1).map((f) => f[0]);
  assert.equal(new Set(claves).size, claves.length);
  assert.ok(claves.includes('monto_por_cupon') && claves.includes('carpeta_fotos_id'));
  const carpeta = claves.indexOf('carpeta_fotos_id');
  assert.ok(e.servicios.ss.getSheetByName('Configuracion').getDataRange().getValues()[carpeta + 1][1], 'carpeta de fotos creada');
  assert.equal(e.servicios.DriveApp._carpetas.size, 1, 'no crea carpetas repetidas');
});

test('setup funciona aunque no haya interfaz (ejecutado desde el editor)', () => {
  const e = crearEntorno({ silencioso: true, sinUi: true });
  assert.doesNotThrow(() => e.gas.setup());
});

test('registro valida datos y guarda texto sin perder ceros', () => {
  const e = entorno();
  assert.equal(e.api('register', { cedula: '12.34', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1' }).code, 'VALIDATION');
  const corta = e.api('register', { cedula: '12345678', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567', password: '123' });
  assert.equal(corta.campo, 'password');
  const sinTel = e.api('register', { cedula: '12345678', nombre: 'Ana', apellido: 'Pérez', telefono: '123', password: 'secreto1' });
  assert.equal(sinTel.campo, 'telefono');

  const ok = e.api('register', { cedula: 'V-12.345.678', nombre: '  maría   josé ', apellido: 'PÉREZ', telefono: '0414-123-4567', password: 'secreto1', sucursal: 'Boleíta' });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.usuario.nombre, 'María José');
  assert.equal(ok.data.usuario.apellido, 'Pérez');
  assert.equal(ok.data.usuario.cedula_mask, '12••••78');
  assert.ok(ok.data.token.length >= 32);

  const fila = e.servicios.ss.getSheetByName('Usuarios').getRange(2, 1, 1, 11).getValues()[0];
  assert.equal(fila[0], '12345678');
  assert.equal(fila[3], '04141234567', 'el teléfono conserva el 0 inicial');
  assert.match(fila[5], /^v1\$\d+\$[0-9a-f]{64}$/, 'la contraseña se guarda como hash');
  assert.ok(!JSON.stringify(fila).includes('secreto1'));

  const dup = e.api('register', { cedula: '12345678', nombre: 'Otra', apellido: 'Persona', telefono: '04140000000', password: 'secreto1' });
  assert.equal(dup.code, 'DUPLICATE');
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

test('una venta cargada tarde en la semana 1 no cambia la semana 2 si no cruza el umbral', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const t = e.registrar('20111223');
  e.vender(t, { dia: e.dia(1), factura: 'B-1', monto: 1000 });
  e.vender(t, { dia: e.dia(8), factura: 'B-2', monto: 1000 });
  let v = e.stats().vendedores['20111223'];
  assert.equal(v.semanas[1].cupones, 0);
  assert.equal(v.semanas[2].cupones, 1);
  // Factura de la semana 1 cargada después: ahora el cupón se completa en la semana 1.
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
  assert.equal(b.data.acumulado, 3300.5);
  assert.equal(b.data.sobrante, 300.5);
  assert.equal(b.data.sobrante_antes, 1000);
  assert.equal(b.data.registro.estado, 'Pendiente');
  assert.match(b.data.registro.id, /^CP-\d{6}$/);
  const archivo = [...e.servicios.DriveApp._archivos.values()][1];
  assert.match(archivo.getName(), /^30111222_2_\d+\.jpg$/);
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
  // Si el admin la rechaza, se puede volver a cargar (por ejemplo, con el monto correcto).
  e.editarRegistro(r1.data.registro.id, 'estado', 'Rechazada');
  assert.equal(e.vender(t2, { dia: e.hoy, factura: '123', monto: 500 }).ok, true);
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

test('concurso cerrado: no se cargan ventas', () => {
  const e = entorno({ config: { concurso_abierto: 'NO' } });
  const t = e.registrar('61111222');
  assert.equal(e.vender(t, { dia: e.hoy, factura: 'C1', monto: 10 }).code, 'CLOSED');
});

test('token vencido, inválido o cerrado devuelve AUTH', () => {
  const e = entorno();
  const t = e.registrar('70111222');
  assert.equal(e.api('getDashboard', { token: t }).ok, true);
  assert.equal(e.api('getDashboard', { token: 'x'.repeat(64) }).code, 'AUTH');
  assert.equal(e.api('getDashboard', {}).code, 'AUTH');
  assert.equal(e.api('addSale', { token: 'corto' }).code, 'AUTH');

  // Forzamos el vencimiento de la sesión.
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
  const fila = e.gas.leerRegistros_({ fresco: true })[0];
  assert.equal(fila.cedula, '71111222');
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
  const r = e.vender(t, { dia: e.hoy, factura: 'R1', monto: 3000 });
  e.vender(t, { dia: e.hoy, factura: 'R2', monto: 500 });
  assert.equal(e.api('getDashboard', { token: t }).data.resumen.cupones, 2);
  e.editarRegistro(r.data.registro.id, 'estado', 'Rechazada');
  e.editarRegistro(r.data.registro.id, 'nota_admin', 'Foto ilegible');
  const d = e.api('getDashboard', { token: t }).data;
  assert.equal(d.resumen.cupones, 0);
  assert.equal(d.resumen.sobrante, 500);
  assert.equal(d.registros.find((x) => x.numero_factura === 'R1').nota_admin, 'Foto ilegible');
});

test('neutraliza inyección de fórmulas en Sheets', () => {
  const e = entorno();
  const r = e.api('register', { cedula: '82111222', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1', sucursal: '=HYPERLINK("http://x","clic")' });
  assert.equal(r.ok, true);
  const hoja = e.servicios.ss.getSheetByName('Usuarios');
  assert.equal(hoja.formulasEscritas.length, 0, 'no se escribió ninguna fórmula');
  assert.equal(hoja.getRange(2, 5).getValue(), '=HYPERLINK("http://x","clic")', 'queda como texto');
  assert.equal(e.api('register', { cedula: '82111223', nombre: '=cmd', apellido: 'Pérez', telefono: '04141234567', password: 'secreto1' }).campo, 'nombre');
  assert.equal(e.vender(r.data.token, { dia: e.hoy, factura: '=1+1', monto: 10 }).campo, 'numero_factura');
  assert.equal(e.gas.protegerCelda_('+58 414'), "'+58 414");
  assert.equal(e.gas.protegerCelda_('@x'), "'@x");
  assert.equal(e.gas.protegerCelda_('-1'), "'-1");
});

test('ranking semanal: top 6, desempate por monto y 0 cupones no califica', () => {
  const e = entorno({ inicioHaceDias: 10 });
  const cupones = [3, 2, 2, 1, 1, 1, 1, 0]; // vendedor 8 vende $1.400: no completa cupón
  const tokens = cupones.map((c, i) => e.registrar('9000000' + i, { nombre: 'Vendedor', apellido: 'N' + 'abcdefgh'[i] }));
  cupones.forEach((c, i) => {
    // monto distinto para probar desempate: más índice → menos monto extra
    const monto = c * 1500 + (c ? 100 * (8 - i) : 1400);
    const r = e.vender(tokens[i], { dia: e.dia(8), factura: 'S' + i, monto });
    assert.equal(r.ok, true, JSON.stringify(r));
  });
  const lista = e.gas.rankingSemana_(e.stats(), 2);
  assert.equal(lista.length, 7, 'quien tiene 0 cupones no aparece');
  assert.deepEqual(plano(lista.map((x) => x.v.cedula)), ['90000000', '90000001', '90000002', '90000003', '90000004', '90000005', '90000006']);
  assert.equal(e.gas.rankingSemana_(e.stats(), 1).length, 0);

  const g = e.gas.ganadoresSemana(2);
  assert.equal(g.ganadores.length, 6);
  assert.equal(g.empateEnCorte, false);

  e.servicios.ui.respuestasPrompt.push({ boton: 'OK', texto: '2' });
  e.gas.menuGanadoresSemanales();
  const alerta = e.servicios.ui.alertas.at(-1);
  assert.match(alerta.msg, /Semana 2/);
  assert.match(alerta.msg, /1\. Vendedor Na .* 3 cupones/);
  assert.ok(!alerta.msg.includes('90000006'), 'el séptimo no gana');

  const d = e.api('getDashboard', { token: tokens[3] }).data;
  assert.equal(d.ranking.semana.mi_posicion, 4);
  assert.equal(d.resumen.semana.posicion, 4);
  assert.ok(!JSON.stringify(d.ranking).includes('9000000'), 'el ranking público no expone cédulas');
});

test('premio Austral: más m², desempate por monto total', () => {
  const e = entorno();
  const a = e.registrar('91000001', { nombre: 'Aura' });
  const b = e.registrar('91000002', { nombre: 'Beto' });
  const c = e.registrar('91000003', { nombre: 'Cira' });
  e.vender(a, { dia: e.hoy, factura: 'AU1', monto: 800, m2: 120 });
  e.vender(b, { dia: e.hoy, factura: 'AU2', monto: 900, m2: 120 });
  e.vender(c, { dia: e.hoy, factura: 'AU3', monto: 5000, m2: 119.99 });
  const lista = e.gas.rankingAustral_(e.stats());
  assert.deepEqual(plano(lista.map((v) => v.cedula)), ['91000002', '91000001', '91000003']);
  e.gas.menuGanadorAustral();
  assert.match(e.servicios.ui.alertas.at(-1).msg, /^🏆 Beto Pérez/);
});

test('cupones para sorteo: lista numerada y escrita en la hoja Ranking', () => {
  const e = entorno();
  const a = e.registrar('92000001');
  const b = e.registrar('92000002');
  e.vender(a, { dia: e.dia(0), factura: 'T1', monto: 4500 });
  e.vender(b, { dia: e.dia(1), factura: 'T2', monto: 1500 });
  const lista = e.gas.cuponesParaSorteo_(e.stats());
  assert.equal(lista.length, 4);
  assert.deepEqual(plano(lista.map((c) => c.cedula)), ['92000001', '92000001', '92000001', '92000002']);
  e.gas.menuGenerarCupones();
  const ranking = e.servicios.ss.getSheetByName('Ranking').getDataRange().getValues();
  const encabezados = ranking[2];
  const col = encabezados.indexOf('Cupón');
  assert.ok(col > -1);
  assert.equal(ranking[3][col], 'Cupón 0001');
  assert.equal(ranking[6][col], 'Cupón 0004');
  assert.equal(ranking[3][col + 1], '92000001', 'la cédula queda como texto');
  assert.match(e.servicios.ui.alertas.at(-1).msg, /4 cupones/);
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

test('datos de prueba: se cargan, cuentan en rankings y se borran', () => {
  const e = entorno({ inicioHaceDias: 20 });
  e.registrar('96000001');
  e.gas.menuCargarDatosPrueba();
  const stats = e.stats();
  assert.ok(Object.keys(stats.vendedores).length >= 6);
  assert.ok(e.gas.cuponesParaSorteo_(stats).length > 0);
  e.gas.menuBorrarDatosPrueba();
  assert.equal(e.gas.leerRegistros_({ fresco: true }).length, 0);
  assert.equal(e.gas.leerUsuarios_({ fresco: true }).length, 1, 'el usuario real se conserva');
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
  // Segunda lectura sale del caché (en varios trozos de < 100 KB).
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
  assert.equal(JSON.parse(e.gas.doGet({ parameter: { action: 'config' } }).getContent()).data.nombre, 'Copa Prosein');
});
