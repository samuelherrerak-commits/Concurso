/**
 * Servidor local para probar el portal SIN desplegar Apps Script.
 * Sirve /web y responde /api con el mismo Code.gs corriendo en el simulador.
 *
 *   node dev/server.js            → campaña vacía, corrida para que hoy sea el día 25 (Ronda 2)
 *   node dev/server.js --demo     → con 8 vendedores de prueba (contraseña prueba123)
 *   node dev/server.js --admin    → agrega un administrador: cédula 11111111, contraseña admin123
 *   node dev/server.js --solo-aprobadas   → contar_solo_aprobadas = SI
 *   node dev/server.js --sin-bloqueo      → bloquear_rondas_cerradas = NO
 *   node dev/server.js --dia=5    → hoy es el día 5 de la campaña (negativo: empieza dentro de N días)
 *   node dev/server.js --real     → las fechas reales del cronograma (15/10 al 19/12/2026)
 *   node dev/server.js --metas    → metas de ejemplo en la hoja Canales
 *   PORT=8080 node dev/server.js --latencia=800
 *
 * Los datos viven en memoria: se pierden al cerrar el servidor.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./gas-mock');

const args = process.argv.slice(2);
const PORT = Number(process.env.PORT || 5173);
const latencia = Number((args.find((a) => a.startsWith('--latencia=')) || '--latencia=350').split('=')[1]);
const WEB = path.join(__dirname, '..', 'web');

const e = crearEntorno({ silencioso: true, sinUi: true });
e.gas.setup();
const hoy = e.gas.hoyISO_();
// El cronograma real se corre en el tiempo para que "hoy" caiga dentro de la campaña.
const original = e.gas.rondasPorDefecto_('15:00');
const dia = Number((args.find((a) => a.startsWith('--dia=')) || '--dia=25').split('=')[1]);
const corrimiento = args.includes('--real') ? 0 : e.gas.diasEntre_(original[0].inicio, e.gas.sumarDias_(hoy, -dia));
const mover = (iso) => (iso ? e.gas.sumarDias_(iso, corrimiento) : '');
const rondas = original.map((r) => ({ ...r, inicio: mover(r.inicio), fin: mover(r.fin), sorteo: mover(r.sorteo), corte: r.corte + corrimiento * 86400000 }));
e.gas.escribirRondas_(rondas);
e.gas.escribirConfig_('fecha_sorteo_final', e.gas.fechaDesdeISO_(mover('2026-12-21')));
if (args.includes('--solo-aprobadas')) e.gas.escribirConfig_('contar_solo_aprobadas', 'SI');
if (args.includes('--sin-ranking')) e.gas.escribirConfig_('mostrar_ranking_publico', 'NO');
if (args.includes('--sin-bloqueo')) e.gas.escribirConfig_('bloquear_rondas_cerradas', 'NO');
if (args.includes('--metas')) {
  // Metas de ejemplo: $8.000 en tiendas, $12.000 en Distribuidores, Corporativo sin meta; Maracaibo con cupón de $1.000.
  const sh = e.servicios.ss.getSheetByName('Canales');
  const filas = sh.getDataRange().getValues();
  filas.forEach((f, i) => {
    if (!i) return;
    if (f[0] === 'Tienda') sh.getRange(i + 1, 4).setValue(8000);
    if (f[0] === 'Distribuidor') sh.getRange(i + 1, 4).setValue(12000);
    if (f[1] === 'Maracaibo') sh.getRange(i + 1, 3).setValue(1000);
  });
}
e.servicios.cache._vaciar();
if (args.includes('--demo')) e.gas.cargarDatosPrueba_();
if (args.includes('--admin')) {
  // Igual que agregarlo a mano en la hoja Usuarios, pero ya con contraseña.
  const salt = e.gas.generarSalt_();
  e.gas.escribirFilaUsuario_({
    cedula: '11111111', nombre: 'Coordinación', apellido: 'Prosein', telefono: '04140000000', sucursal_o_zona: '',
    password_hash: e.gas.hashClave_('admin123', salt), salt, fecha_registro: new Date(), estado: 'activo',
    intentos_fallidos: 0, bloqueado_hasta: '', rol: 'admin',
  });
}
e.servicios.cache._vaciar();

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function leerCuerpo(req, limite = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limite) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

/** Utilidad solo de desarrollo: simula ediciones del admin en el Sheet (Registros o Usuarios). */
function editarRegistro({ id, columna, valor, hoja = 'Registros' }) {
  if (!['Registros', 'Usuarios'].includes(hoja)) return { ok: false };
  const sh = e.servicios.ss.getSheetByName(hoja);
  const enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((f) => String(f[0]));
  const fila = ids.indexOf(String(id)) + 1;
  if (fila < 2) return { ok: false };
  sh.getRange(fila, enc.indexOf(columna) + 1).setValue(valor);
  e.servicios.cache._vaciar();
  return { ok: true };
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/api') {
      const cuerpo = await leerCuerpo(req);
      await new Promise((r) => setTimeout(r, latencia));
      const salida = e.gas.doPost({ postData: { contents: cuerpo } });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(salida.getContent());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__dev/editar') {
      const r = editarRegistro(JSON.parse(await leerCuerpo(req)));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
      return;
    }
    if (url.pathname === '/config.js') {
      const real = fs.readFileSync(path.join(WEB, 'config.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': TIPOS['.js'], 'Cache-Control': 'no-store' });
      res.end(real.replace(/API_URL:\s*'[^']*'/, "API_URL: '/api'"));
      return;
    }
    const relativo = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const archivo = path.join(WEB, path.normalize(relativo));
    if (!archivo.startsWith(WEB) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(archivo).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(err && err.stack ? err.stack : err));
  }
});

servidor.listen(PORT, () => {
  console.log(`Copa Prosein (local) en http://localhost:${PORT}`);
  rondas.forEach((r) => console.log(`  ${r.nombre}: ${r.inicio} → ${r.fin}${r.sorteo ? ' · sorteo ' + r.sorteo : ' · sin sorteo'}`));
  console.log(`Latencia simulada ${latencia} ms`);
  if (args.includes('--demo')) console.log('Vendedores de prueba: cédulas 90000001 a 90000008, contraseña "prueba123"');
  if (args.includes('--admin')) console.log('Administrador: cédula 11111111, contraseña "admin123"');
});
