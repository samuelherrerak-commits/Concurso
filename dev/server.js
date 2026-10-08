/**
 * Servidor local para probar el portal SIN desplegar Apps Script.
 * Sirve /web y responde /api con el mismo Code.gs corriendo en el simulador.
 *
 *   node dev/server.js            → concurso vacío (empezó hace 9 días)
 *   node dev/server.js --demo     → con 8 vendedores de prueba (contraseña prueba123)
 *   node dev/server.js --admin    → agrega un administrador: cédula 11111111, contraseña admin123
 *   node dev/server.js --solo-aprobadas   → contar_solo_aprobadas = SI
 *   node dev/server.js --sin-bloqueo      → bloquear_semanas_cerradas = NO
 *   node dev/server.js --dia=-3   → el concurso empieza dentro de 3 días
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
const SEMANAS = 10;
const inicio = e.gas.sumarDias_(hoy, -Number((args.find((a) => a.startsWith('--dia=')) || '--dia=9').split('=')[1]));
e.gas.escribirConfig_('fecha_inicio', e.gas.fechaDesdeISO_(inicio));
e.gas.escribirConfig_('num_semanas', SEMANAS);
e.gas.escribirConfig_('fecha_sorteo', e.gas.fechaDesdeISO_(e.gas.sumarDias_(inicio, SEMANAS * 7 + 3)));
if (args.includes('--solo-aprobadas')) e.gas.escribirConfig_('contar_solo_aprobadas', 'SI');
if (args.includes('--sin-ranking')) e.gas.escribirConfig_('mostrar_ranking_publico', 'NO');
if (args.includes('--sin-bloqueo')) e.gas.escribirConfig_('bloquear_semanas_cerradas', 'NO');
e.gas.escribirPeriodos_(e.gas.periodosDesdeConfig_());
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
  console.log(`Concurso: ${inicio} → ${e.gas.sumarDias_(inicio, SEMANAS * 7 - 1)} (${SEMANAS} semanas) · latencia simulada ${latencia} ms`);
  if (args.includes('--demo')) console.log('Vendedores de prueba: cédulas 90000001 a 90000008, contraseña "prueba123"');
  if (args.includes('--admin')) console.log('Administrador: cédula 11111111, contraseña "admin123"');
});
