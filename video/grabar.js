// Graba video/explicacion.html cuadro a cuadro y lo codifica en MP4 con ffmpeg.
// Uso: NODE_PATH=$(npm root -g) node video/grabar.js salida.mp4 [fps] [desde] [hasta]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const salida = process.argv[2] || 'video/la-bolsa-de-los-deseos.mp4';
  const fps = Number(process.argv[3] || 30);
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1920 } });
  await pagina.goto('file://' + path.resolve(__dirname, 'explicacion.html'));
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.waitForTimeout(500);
  const total = await pagina.evaluate(() => window.DURACION);
  const desde = Number(process.argv[4] || 0);
  const hasta = Number(process.argv[5] || total);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', salida], { stdio: ['pipe', 'inherit', 'inherit'] });
  const cuadros = Math.round((hasta - desde) * fps);
  for (let i = 0; i < cuadros; i++) {
    await pagina.evaluate((t) => window.render(t), desde + i / fps);
    const img = await pagina.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log(`cuadro ${i}/${cuadros}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await navegador.close();
  console.log('listo', salida);
})();
