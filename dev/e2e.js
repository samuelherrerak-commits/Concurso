/**
 * Recorrido completo en un navegador real (Chromium) contra el servidor local.
 *   1) node dev/server.js --demo      (en otra terminal)
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

async function captura(page, nombre, opciones = {}) {
  await page.screenshot({ path: path.join(OUT, nombre + '.png'), ...opciones });
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

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ ...devices['iPhone 13'], locale: 'es-VE', timezoneId: 'America/Caracas' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));

  paso('Acceso');
  await page.goto(BASE);
  await page.waitForSelector('#vista-acceso:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#acceso-fechas').textContent.length > 0);
  await page.waitForTimeout(400);
  await captura(page, '01-acceso');

  paso('Errores de registro');
  await page.click('#tab-registro');
  await page.click('#form-registro [type=submit]');
  await page.waitForTimeout(200);
  await captura(page, '02-registro-errores', { fullPage: true });

  paso('Registro');
  await page.fill('#reg-nombre', 'gabriela');
  await page.fill('#reg-apellido', 'mendoza');
  await page.fill('#reg-cedula', '18765432');
  await page.fill('#reg-telefono', '0414 765 4321');
  await page.fill('#reg-sucursal', 'Las Mercedes');
  await page.fill('#reg-clave', 'clave123');
  await page.fill('#reg-clave2', 'clave123');
  await page.click('#form-registro [type=submit]');
  await page.waitForSelector('#vista-panel:not([hidden])');
  await page.waitForSelector('#resumen[aria-busy=false]');
  await page.waitForTimeout(300);
  await captura(page, '03-panel-vacio');
  await captura(page, '03b-panel-vacio-completo', { fullPage: true });

  paso('Formulario de venta + errores');
  await page.click('#btn-registrar');
  await page.waitForSelector('#dlg-venta[data-abierto]');
  await page.waitForTimeout(550);
  await captura(page, '04-form-venta');
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
  for (const ms of [250, 550, 850, 1250, 1700, 2600]) {
    await page.waitForTimeout(ms - transcurrido);
    transcurrido = ms;
    await captura(page, `07-impresion-${String(ms).padStart(4, '0')}ms`);
  }
  await page.click('#impresora-continuar');
  await page.waitForTimeout(700);
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
  await page.click('#impresora-continuar');
  await page.waitForTimeout(700);

  paso('Venta que completa varios cupones');
  await registrarVenta(page, { factura: 'B-2001', monto: 6100 });
  await page.click('#v-enviar');
  await page.waitForSelector('#dlg-impresora[open]');
  await page.waitForTimeout(900);
  await captura(page, '11-varios-a');
  await page.waitForTimeout(2200);
  await captura(page, '11-varios-b');
  await page.click('#impresora-continuar');
  await page.waitForTimeout(800);
  await captura(page, '12-panel-final', { fullPage: true });

  paso('Ver foto');
  await page.click('.ventas .btn--chico');
  await page.waitForSelector('#visor-imagen img');
  await page.waitForTimeout(400);
  await captura(page, '13-foto');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  paso('Ranking Austral y cupones');
  await page.click('[data-ranking=austral]');
  await page.locator('#seccion-ranking').scrollIntoViewIfNeeded();
  await captura(page, '14-ranking-austral');
  await page.click('[data-ranking=semana]');
  await captura(page, '14b-ranking-semana');

  paso('Sesión vencida (token borrado en el servidor)');
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('copa-prosein:sesion')).token);
  await page.evaluate(async (t) => { await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'logout', token: t }) }); }, token);
  await page.evaluate(() => localStorage.setItem('copa-prosein:sesion', JSON.stringify({ ...JSON.parse(localStorage.getItem('copa-prosein:sesion')) })));
  await page.reload();
  await page.waitForSelector('#vista-acceso:not([hidden])');
  await page.waitForTimeout(300);
  await captura(page, '15-sesion-vencida');

  paso('Login de nuevo');
  await page.fill('#ing-cedula', '18765432');
  await page.fill('#ing-clave', 'clave123');
  await page.click('#form-ingresar [type=submit]');
  await page.waitForSelector('#resumen[aria-busy=false]');

  paso('Escritorio');
  const escritorio = await navegador.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-VE', timezoneId: 'America/Caracas' });
  const p2 = await escritorio.newPage();
  p2.on('pageerror', (e) => errores.push('pageerror(desktop): ' + e.message));
  await p2.goto(BASE);
  await p2.fill('#ing-cedula', '18765432');
  await p2.fill('#ing-clave', 'clave123');
  await p2.click('#form-ingresar [type=submit]');
  await p2.waitForSelector('#resumen[aria-busy=false]');
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(OUT, '16-escritorio.png'), fullPage: true });
  await p2.click('#btn-registrar');
  await p2.waitForSelector('#dlg-venta[data-abierto]');
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(OUT, '17-escritorio-form.png') });

  paso('Movimiento reducido');
  const reducido = await navegador.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce', locale: 'es-VE' });
  const p3 = await reducido.newPage();
  p3.on('pageerror', (e) => errores.push('pageerror(reduced): ' + e.message));
  await p3.goto(BASE);
  await p3.fill('#ing-cedula', '18765432');
  await p3.fill('#ing-clave', 'clave123');
  await p3.click('#form-ingresar [type=submit]');
  await p3.waitForSelector('#resumen[aria-busy=false]');
  await registrarVenta(p3, { factura: 'RM-1', monto: 1500 });
  await p3.click('#v-enviar');
  await p3.waitForSelector('#dlg-impresora[open]');
  await p3.waitForTimeout(450);
  await p3.screenshot({ path: path.join(OUT, '18-reducido.png') });

  await navegador.close();
  if (errores.length) {
    console.log('\nErrores en la página:\n' + errores.join('\n'));
    process.exit(1);
  }
  console.log('\nListo, sin errores. Capturas en ' + OUT);
})().catch((err) => {
  console.error(err);
  if (errores.length) console.log('\nErrores en la página:\n' + errores.join('\n'));
  process.exit(1);
});
