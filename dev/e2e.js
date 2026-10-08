/**
 * Recorrido completo en un navegador real (Chromium) contra el servidor local.
 *   1) node dev/server.js --demo --admin      (en otra terminal)
 *   2) node dev/e2e.js [carpeta-de-capturas]
 * Requiere Playwright instalado (npm i -D playwright o global).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = path.resolve(process.argv[2] || 'capturas');
const FOTO = process.env.FOTO || path.join(__dirname, 'factura-prueba.jpg');
fs.mkdirSync(OUT, { recursive: true });

const errores = [];
const paso = (t) => console.log('·', t);
const comprobar = (cond, mensaje) => { if (!cond) errores.push('fallo: ' + mensaje); };

async function captura(page, nombre, opciones = {}) {
  await page.screenshot({ path: path.join(OUT, nombre + '.png'), ...opciones });
}

function vigilar(page, etiqueta) {
  page.on('console', (m) => { if (m.type() === 'error') errores.push(`console(${etiqueta}): ${m.text()}`); });
  page.on('pageerror', (e) => errores.push(`pageerror(${etiqueta}): ${e.message}`));
}

async function registrarVenta(page, { factura, monto, m2, foto = true }) {
  await page.click('#btn-registrar');
  await page.waitForSelector('#dlg-venta[data-abierto]');
  await page.waitForTimeout(500);
  await page.fill('#v-factura', factura);
  await page.fill('#v-monto', String(monto));
  if (m2 !== undefined) {
    await page.check('#v-austral');
    if (m2 !== null) await page.fill('#v-m2', String(m2));
  }
  if (foto) {
    await page.setInputFiles('#v-foto-vacio input[data-foto]:not([capture])', FOTO);
    await page.waitForSelector('#v-foto-previa:not([hidden])');
  }
}

async function ingresar(page, cedula, clave) {
  await page.goto(BASE);
  await page.waitForSelector('#vista-acceso:not([hidden])');
  await page.fill('#ing-cedula', cedula);
  await page.fill('#ing-clave', clave);
  await page.click('#form-ingresar [type=submit]');
}

async function continuarImpresora(page) {
  await page.waitForSelector('#impresora-continuar:not([disabled])', { timeout: 8000 });
  await page.click('#impresora-continuar');
  await page.waitForSelector('#dlg-impresora[open]', { state: 'detached' });
  await page.waitForTimeout(250);
}

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ ...devices['iPhone 13'], locale: 'es-VE', timezoneId: 'America/Caracas', acceptDownloads: true });
  const page = await ctx.newPage();
  vigilar(page, 'móvil');

  paso('Acceso');
  await page.goto(BASE);
  await page.waitForSelector('#vista-acceso:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#acceso-fechas').textContent.length > 0);
  await page.waitForTimeout(400);
  await captura(page, '01-acceso');

  paso('Errores de registro (la tienda es obligatoria)');
  await page.click('#tab-registro');
  await page.click('#form-registro [type=submit]');
  await page.waitForTimeout(200);
  comprobar(await page.locator('[data-error="sucursal"]:not(:empty)').count() === 1, 'pide la tienda');
  await captura(page, '02-registro-errores', { fullPage: true });

  paso('Registro');
  await page.fill('#reg-nombre', 'gabriela');
  await page.fill('#reg-apellido', 'mendoza');
  await page.fill('#reg-cedula', '18765432');
  await page.fill('#reg-telefono', '0414 765 4321');
  await page.selectOption('#reg-sucursal', 'Las Mercedes');
  await page.fill('#reg-clave', 'clave123');
  await page.fill('#reg-clave2', 'clave123');
  await page.click('#form-registro [type=submit]');
  await page.waitForSelector('#panel:not([hidden])');
  await page.waitForSelector('#resumen[aria-busy=false]');
  await page.waitForTimeout(300);
  comprobar((await page.textContent('#menu-cedula')).includes('Las Mercedes'), 'la tienda queda en la cuenta');
  await captura(page, '03-panel-vacio');
  await captura(page, '03b-panel-vacio-completo', { fullPage: true });

  paso('Formulario de venta + errores');
  await page.click('#btn-registrar');
  await page.waitForSelector('#dlg-venta[data-abierto]');
  await page.waitForTimeout(550);
  await captura(page, '04-form-venta');
  const rango = await page.evaluate(() => ({ min: document.querySelector('#v-dia').min, max: document.querySelector('#v-dia').max }));
  comprobar(rango.min && rango.max && rango.min <= rango.max, 'rango de días de carga ' + JSON.stringify(rango));
  await page.check('#v-austral');
  await page.click('#v-enviar');
  await page.waitForTimeout(350);
  await captura(page, '05-form-errores');
  await page.click('#dlg-venta [data-cerrar]');
  await page.waitForTimeout(600);

  paso('Venta que completa 1 cupón');
  await registrarVenta(page, { factura: '000123', monto: '2.300,50', m2: 42.5 });
  await page.waitForTimeout(150);
  await captura(page, '06-form-listo');
  await page.click('#v-enviar');
  await page.waitForSelector('#dlg-impresora[open]');
  let transcurrido = 0;
  for (const ms of [250, 850, 1700, 2600]) {
    await page.waitForTimeout(ms - transcurrido);
    transcurrido = ms;
    await captura(page, `07-impresion-${String(ms).padStart(4, '0')}ms`);
  }
  await continuarImpresora(page);
  await captura(page, '08-panel-con-cupon');

  paso('Factura duplicada');
  await registrarVenta(page, { factura: '123', monto: 500 });
  await page.click('#v-enviar');
  await page.waitForSelector('[data-error="numero_factura"]:not(:empty)');
  await captura(page, '09-duplicada');
  await page.click('#dlg-venta [data-cerrar]');
  await page.waitForTimeout(600);

  paso('Venta sin cupón nuevo');
  await page.click('#btn-registrar');
  await page.waitForSelector('#dlg-venta[data-abierto]');
  await page.fill('#v-factura', 'A-77');
  await page.fill('#v-monto', '150');
  await page.click('#v-enviar');
  await page.waitForSelector('#dlg-impresora[open]');
  await page.waitForTimeout(1300);
  await captura(page, '10-sobria');
  await continuarImpresora(page);

  paso('Venta con varios cupones y un cupón del viaje (Austral)');
  await registrarVenta(page, { factura: 'B-2001', monto: 6100, m2: 80 });
  await page.click('#v-enviar');
  await page.waitForSelector('#dlg-impresora[open]');
  await page.waitForTimeout(900);
  await captura(page, '11-varios-a');
  await page.waitForTimeout(2200);
  await captura(page, '11-varios-b');
  // Al continuar, la misma impresora vuelve a abrirse con el papel azul del viaje.
  await page.waitForSelector('#impresora-continuar:not([disabled])');
  await page.click('#impresora-continuar');
  await page.waitForSelector('#dlg-impresora.impresora--austral[data-abierto]');
  await page.waitForTimeout(2600);
  comprobar((await page.textContent('#impresora-etiqueta')) === 'Cupones del viaje', 'contador del viaje');
  await captura(page, '11-viaje');
  await continuarImpresora(page);
  await page.waitForTimeout(500);
  await captura(page, '12-panel-final', { fullPage: true });

  paso('Ver un cupón otra vez y descargarlo');
  const minis = page.locator('#cupones button.mini');
  comprobar(await minis.count() === 5, 'hay 5 cupones (' + await minis.count() + ')');
  await minis.first().click();
  await page.waitForSelector('#dlg-cupon[data-abierto]');
  await page.waitForTimeout(400);
  comprobar(await page.locator('#cupon-ticket .ticket .sello').isVisible(), 'el sello se ve sin animación');
  await captura(page, '13-ver-cupon');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#cupon-descargar')]);
  const destino = path.join(OUT, descarga.suggestedFilename());
  await descarga.saveAs(destino);
  comprobar(fs.statSync(destino).size > 10000, 'PNG del cupón descargado');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.locator('#viaje button.mini').first().click();
  await page.waitForSelector('#dlg-cupon[data-abierto]');
  await page.waitForTimeout(400);
  await captura(page, '13b-ver-cupon-viaje');
  const [descargaViaje] = await Promise.all([page.waitForEvent('download'), page.click('#cupon-descargar')]);
  await descargaViaje.saveAs(path.join(OUT, descargaViaje.suggestedFilename()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  paso('Ver foto');
  await page.click('.ventas .btn--chico');
  await page.waitForSelector('#visor-imagen img');
  await page.waitForTimeout(400);
  await captura(page, '14-foto');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  paso('Ranking y reglas');
  await page.click('[data-ranking=austral]');
  await page.locator('#seccion-ranking').scrollIntoViewIfNeeded();
  await captura(page, '15-ranking-austral');
  await page.click('[data-ranking=semana]');
  await captura(page, '15b-ranking-semana');
  await page.click('.reglas summary');
  await page.locator('.reglas').scrollIntoViewIfNeeded();
  await captura(page, '15c-reglas', { fullPage: true });

  paso('Sesión vencida (token borrado en el servidor)');
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('copa-prosein:sesion')).token);
  await page.evaluate(async (t) => { await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'logout', token: t, api_token: 'copaprosein' }) }); }, token);
  await page.reload();
  await page.waitForSelector('#vista-acceso:not([hidden])');
  await page.waitForTimeout(300);
  await captura(page, '16-sesion-vencida');

  paso('Cuenta vieja sin tienda: la elige al entrar');
  await page.evaluate(async () => { await fetch('/__dev/editar', { method: 'POST', body: JSON.stringify({ hoja: 'Usuarios', id: '90000002', columna: 'sucursal_o_zona', valor: '' }) }); });
  await page.fill('#ing-cedula', '90000002');
  await page.fill('#ing-clave', 'prueba123');
  await page.click('#form-ingresar [type=submit]');
  await page.waitForSelector('#dlg-sucursal[data-abierto]');
  await page.waitForTimeout(500);
  await captura(page, '17-elegir-tienda');
  await page.selectOption('#suc-sucursal', 'Maracaibo');
  await page.click('#form-sucursal [type=submit]');
  await page.waitForSelector('#dlg-sucursal[open]', { state: 'detached' });
  comprobar((await page.textContent('#menu-cedula')).includes('Maracaibo'), 'tienda guardada');
  await page.waitForTimeout(300);
  if (await page.locator('#dlg-impresora[open]').count()) await continuarImpresora(page);
  await captura(page, '17b-tienda-lista');

  paso('Escritorio');
  const escritorio = await navegador.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-VE', timezoneId: 'America/Caracas' });
  const p2 = await escritorio.newPage();
  vigilar(p2, 'escritorio');
  await ingresar(p2, '18765432', 'clave123');
  await p2.waitForSelector('#resumen[aria-busy=false]');
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(OUT, '18-escritorio.png'), fullPage: true });
  await p2.locator('#cupones button.mini').nth(1).click();
  await p2.waitForSelector('#dlg-cupon[data-abierto]');
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(OUT, '18b-escritorio-cupon.png') });

  paso('Administrador');
  const admin = await navegador.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-VE', timezoneId: 'America/Caracas', acceptDownloads: true });
  const pa = await admin.newPage();
  vigilar(pa, 'admin');
  await ingresar(pa, '11111111', 'admin123');
  await pa.waitForSelector('#admin:not([hidden]) .cifras');
  comprobar(await pa.locator('#panel').isHidden(), 'el admin no ve el panel del vendedor');
  await pa.waitForTimeout(300);
  await pa.screenshot({ path: path.join(OUT, '20-admin-resumen.png'), fullPage: true });
  for (const [vista, espera, n] of [['vendedores', '.tabla--vendedores', '21'], ['ventas', '.tabla--ventas', '22'], ['semanas', '.tabla--ganadores, #admin-semana .vacio', '23'], ['sorteo', '.urnas', '24']]) {
    await pa.click(`#admin-pestanas [data-vista=${vista}]`);
    await pa.waitForSelector(espera);
    await pa.waitForTimeout(250);
    await pa.screenshot({ path: path.join(OUT, `${n}-admin-${vista}.png`), fullPage: true });
  }
  await pa.click('#admin-pestanas [data-vista=ventas]');
  await pa.waitForSelector('.tabla--ventas');
  await pa.fill('.filtro--buscar input', 'B-2001');
  await pa.waitForTimeout(400);
  comprobar(await pa.locator('.tabla--ventas tbody tr').count() === 1, 'búsqueda de factura');
  await pa.click('.tabla--ventas .btn--chico');
  await pa.waitForSelector('#visor-imagen img');
  comprobar(true, 'el admin abre la foto de cualquier vendedor');
  await pa.keyboard.press('Escape');
  await pa.waitForTimeout(300);
  const [csv] = await Promise.all([pa.waitForEvent('download'), pa.click('#admin-vista .admin__acciones button:has-text("CSV")')]);
  await csv.saveAs(path.join(OUT, csv.suggestedFilename()));

  paso('Cupones para imprimir');
  const pi = await admin.newPage();
  vigilar(pi, 'imprimir');
  await pi.goto(BASE + '/cupones.html?urna=todas');
  await pi.waitForSelector('.hoja .boleto');
  await pi.waitForTimeout(500);
  await pi.screenshot({ path: path.join(OUT, '25-imprimir.png') });
  const urnas = await pi.$$eval('#urna option', (o) => o.map((x) => x.value));
  comprobar(urnas.join() === 'todas,cat1,cat2,cat3,viaje', 'urnas ' + urnas.join());
  await pi.selectOption('#urna', 'viaje');
  await pi.waitForTimeout(200);
  await pi.screenshot({ path: path.join(OUT, '25b-imprimir-viaje.png') });
  await pi.selectOption('#urna', 'todas');
  await pi.emulateMedia({ media: 'print' });
  await pi.pdf({ path: path.join(OUT, 'cupones.pdf'), format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await pi.emulateMedia({ media: 'screen' });

  paso('Vendedor no entra a lo del admin');
  const r = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('copa-prosein:sesion'));
    const res = await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'adminCupones', token: s.token, api_token: 'copaprosein' }) });
    return res.json();
  });
  comprobar(r.ok === false && r.code === 'FORBIDDEN', 'adminCupones prohibido para vendedores');

  paso('Movimiento reducido');
  const reducido = await navegador.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce', locale: 'es-VE' });
  const p3 = await reducido.newPage();
  vigilar(p3, 'reducido');
  await ingresar(p3, '18765432', 'clave123');
  await p3.waitForSelector('#resumen[aria-busy=false]');
  await registrarVenta(p3, { factura: 'RM-1', monto: 1500 });
  await p3.click('#v-enviar');
  await p3.waitForSelector('#dlg-impresora[open]');
  await p3.waitForTimeout(450);
  await p3.screenshot({ path: path.join(OUT, '19-reducido.png') });

  await navegador.close();
  if (errores.length) {
    console.log('\nErrores:\n' + errores.join('\n'));
    process.exit(1);
  }
  console.log('\nListo, sin errores. Capturas en ' + OUT);
})().catch((err) => {
  console.error(err);
  if (errores.length) console.log('\nErrores:\n' + errores.join('\n'));
  process.exit(1);
});
