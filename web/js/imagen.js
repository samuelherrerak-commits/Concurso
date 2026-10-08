/**
 * Comprime la foto en el celular antes de enviarla:
 * lado mayor ≤ 1280 px, JPEG calidad ~0,7. Respeta la orientación EXIF.
 */
export async function comprimirImagen(archivo, { ladoMax = 1280, calidad = 0.7 } = {}) {
  if (!archivo || !/^image\//.test(archivo.type || 'image/')) {
    throw new Error('Ese archivo no es una foto.');
  }
  if (archivo.size > 30 * 1024 * 1024) throw new Error('La foto pesa demasiado. Toma otra.');

  const fuente = await decodificar(archivo);
  const escala = Math.min(1, ladoMax / Math.max(fuente.ancho, fuente.alto));
  const ancho = Math.max(1, Math.round(fuente.ancho * escala));
  const alto = Math.max(1, Math.round(fuente.alto * escala));

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#fff'; // los PNG transparentes quedan sobre blanco
  ctx.fillRect(0, 0, ancho, alto);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente.imagen, 0, 0, ancho, alto);
  if (fuente.liberar) fuente.liberar();

  const blob = await new Promise((resolve) => lienzo.toBlob(resolve, 'image/jpeg', calidad));
  if (!blob) throw new Error('No pudimos procesar la foto. Intenta de nuevo.');
  const dataUrl = await new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = () => reject(new Error('No pudimos leer la foto.'));
    lector.readAsDataURL(blob);
  });
  return { dataUrl, bytes: blob.size, ancho, alto };
}

async function decodificar(archivo) {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      return { imagen: bmp, ancho: bmp.width, alto: bmp.height, liberar: () => bmp.close && bmp.close() };
    } catch {
      /* algunos navegadores no aceptan opciones: probamos con <img> */
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No pudimos abrir esa foto. Prueba tomarla de nuevo.'));
      i.src = url;
    });
    return { imagen: img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}
