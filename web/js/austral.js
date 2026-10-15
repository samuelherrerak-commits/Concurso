/**
 * Cupones Austral calculados en el portal con valores fijos:
 * 80 m² o piezas por cupón para tiendas y corporativo, 500 para distribuidores.
 * Se calculan con las facturas del vendedor (las que cuentan), en el orden en que se
 * registraron, y reemplazan lo que diga el servidor.
 */
export const M2_AUSTRAL_POR_CANAL = { Tienda: 80, Corporativo: 80, Distribuidor: 500 };
const M2_AUSTRAL_RESPALDO = 80;

/** m² o piezas de Austral que dan 1 cupón adicional, según el canal del vendedor. */
export function m2PorCupon(usuario) {
  return (usuario && M2_AUSTRAL_POR_CANAL[usuario.canal]) || M2_AUSTRAL_RESPALDO;
}

function cuenta(r, concurso) {
  return concurso && concurso.contar_solo_aprobadas ? r.estado === 'Aprobada' : r.estado !== 'Rechazada';
}

/** Cálculo en centésimas para evitar errores de redondeo. */
export function calcularAustral(registros, usuario, concurso) {
  const MA = Math.round(m2PorCupon(usuario) * 100);
  const ventas = (registros || [])
    .filter((r) => r.vendio_austral && r.m2_austral > 0 && cuenta(r, concurso))
    .slice()
    .sort((a, b) => (a.fecha_carga - b.fecha_carga) || String(a.id).localeCompare(String(b.id)));
  let acumulado = 0;
  const detalle = [];
  ventas.forEach((r) => {
    const m2 = Math.round(r.m2_austral * 100);
    const antes = Math.floor(acumulado / MA);
    acumulado += m2;
    const despues = Math.floor(acumulado / MA);
    for (let n = antes + 1; n <= despues; n++) {
      detalle.push({
        n,
        dia_venta: r.dia_venta,
        factura: r.numero_factura,
        fecha_carga: r.fecha_carga,
        m2: m2 / 100,
        m2_acumulado: acumulado / 100,
        m2_falta: (MA - (acumulado % MA)) / 100,
      });
    }
  });
  const cupones = detalle.length;
  const sobrante = acumulado - cupones * MA;
  return {
    m2: acumulado / 100,
    cupones,
    m2_por_cupon: MA / 100,
    sobrante: sobrante / 100,
    falta: (MA - sobrante) / 100,
    progreso: sobrante / MA,
    detalle,
  };
}

/** Reemplaza en los datos del panel todo lo de Austral por el cálculo con valores fijos. */
export function aplicarAustral(datos) {
  if (!datos || !datos.resumen || datos.usuario.rol === 'admin') return datos;
  const a = calcularAustral(datos.registros, datos.usuario, datos.concurso);
  const r = datos.resumen;
  r.m2 = a.m2;
  r.austral = { ...r.austral, m2: a.m2, cupones: a.cupones, m2_por_cupon: a.m2_por_cupon, sobrante: a.sobrante, falta: a.falta, progreso: a.progreso };
  if (r.final) {
    r.final.austral = a.cupones;
    r.final.total = (r.final.cupones || 0) + a.cupones + (r.final.mejor_vendedor || 0);
  }
  datos.cupones_austral = a.detalle;
  return datos;
}

/**
 * Ajusta la respuesta de una venta nueva (lo que imprime la impresora) con el mismo cálculo.
 * `registros` son las facturas que el vendedor tenía antes de esta venta.
 */
export function aplicarAustralVenta(res, registros, usuario, concurso) {
  const antes = calcularAustral(registros, usuario, concurso);
  const despues = calcularAustral([...(registros || []), res.registro], usuario, concurso);
  res.austral_antes = antes.cupones;
  res.austral_despues = despues.cupones;
  res.austral_nuevos = Math.max(0, despues.cupones - antes.cupones);
  res.nuevos_cupones_austral = despues.detalle.slice(antes.cupones);
  res.m2_total = despues.m2;
  res.m2_sobrante = despues.sobrante;
  res.m2_sobrante_antes = antes.sobrante;
  res.m2_falta = despues.falta;
  res.m2_por_cupon = despues.m2_por_cupon;
  if (res.final) {
    res.final.austral = despues.cupones;
    res.final.total = (res.final.cupones || 0) + despues.cupones + (res.final.mejor_vendedor || 0);
  }
  return res;
}
