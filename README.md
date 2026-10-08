# Copa Prosein · Portal de vendedores

Portal web para el concurso interno de ventas de Prosein. Cada vendedor:

- se registra con su **cédula** y una contraseña,
- carga sus ventas (día, número de factura, monto, **foto de la factura** y, si vendió Austral, los **m²**),
- ve su récord, sus **cupones** para el sorteo final y el ranking.

Cuando una venta completa un cupón, el portal **imprime un ticket de supermercado** con el número del cupón.

El sitio es **estático** (HTML, CSS y JavaScript sin frameworks) y el backend es **Google Apps Script** con **Google Sheets** como base de datos.

```
apps-script/
  Code.gs            ← backend completo (se pega en el editor de Apps Script)
  appsscript.json    ← manifiesto opcional (zona horaria Caracas)
web/                 ← el sitio que se publica
  index.html
  styles.css         ← colores de Prosein en :root
  config.js          ← AQUÍ va la URL del Web App
  app.js
  js/                ← módulos (api, panel, venta, ticket, imagen…)
  assets/
dev/                 ← solo para probar en tu computadora (no se publica)
tests/               ← pruebas del backend
```

---

## Reglas del concurso (cómo calcula el sistema)

| Regla | Cómo se calcula |
|---|---|
| **Cupones** | `cupones = piso(total vendido acumulado ÷ monto_por_cupon)`. Con $1.500: $4.600 = 3 cupones. El sobrante nunca se pierde. |
| **Cupones de la semana** | Son los cupones que el vendedor **completó** esa semana: `piso(acumulado al cierre de la semana ÷ M) − piso(acumulado al cierre de la semana anterior ÷ M)`. |
| **Ejemplo** | Semana 1 vende $4.000 → 2 cupones, sobran $1.000. Semana 2 vende $600 → $1.000 + $600 completan 1 cupón; sobran $100. |
| **Semana de una venta** | La define el **día de la venta**, no el día en que se cargó. La semana 1 empieza en `fecha_inicio`. |
| **Premios semanales** | Los `premios_semanales` (6) vendedores con más cupones completados en la semana. Desempate: mayor venta de la semana → mayor acumulado al cierre de esa semana → quien llegó primero a su marca. Quien tiene 0 cupones esa semana no califica. |
| **Premio mayor (viaje para dos)** | Quien venda más **m² de Austral** en todo el concurso. Desempate: mayor monto total vendido. |
| **Sorteo final** | Cada cupón acumulado es una participación. La mecánica exacta todavía se está definiendo (ver [Sorteo final](#sorteo-final)). |

Todo se recalcula desde la hoja **Registros** en cada consulta. No hay contadores guardados: si apruebas, rechazas o corriges una factura, los cupones totales y semanales se ajustan solos.

---

## Instalación paso a paso

### 1. Crear el Google Sheet

Crea un Google Sheet nuevo (por ejemplo "Copa Prosein 2026") en la cuenta de Google que va a administrar el concurso.

### 2. Pegar el script

1. En el Sheet: **Extensiones → Apps Script**.
2. Borra lo que haya en `Código.gs` y pega todo el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. *(Opcional, recomendado)* En **Configuración del proyecto** (ícono de engranaje), activa **"Mostrar el archivo de manifiesto appsscript.json"**. Abre `appsscript.json` y reemplázalo con [`apps-script/appsscript.json`](apps-script/appsscript.json). Esto fija la zona horaria en Caracas.
4. Guarda (Ctrl + S).

### 3. Ejecutar `setup()` y autorizar

1. En el selector de funciones (arriba), elige **`setup`** y pulsa **Ejecutar**.
2. Google pedirá permisos. Si aparece "Google no ha verificado esta app": **Configuración avanzada → Ir a … (no seguro)**. Es normal en scripts propios.
3. `setup()` crea las hojas **Configuracion**, **Registros**, **Usuarios** y **Ranking**, con sus formatos y listas desplegables. También crea en tu Drive la carpeta **"Copa Prosein · Fotos de facturas"**. Puedes correrlo otra vez sin perder datos.
4. Recarga el Sheet: aparecerá el menú **Copa Prosein**.

### 4. Revisar la hoja Configuracion

| clave | qué es |
|---|---|
| `nombre_concurso` | Copa Prosein |
| `fecha_inicio` | Primer día del concurso. La semana 1 empieza aquí. |
| `fecha_fin` | Último día de ventas válidas. |
| `fecha_sorteo` | Fecha del sorteo final (se muestra en el portal). |
| `monto_por_cupon` | 1500 |
| `premios_semanales` | 6 |
| `moneda` | USD |
| `concurso_abierto` | SI / NO. Con NO nadie puede cargar ventas. Úsalo para cerrar el concurso. |
| `contar_solo_aprobadas` | NO = las facturas suman al cargarlas (puedes rechazarlas después). SI = solo suman al aprobarlas. |
| `mostrar_ranking_publico` | SI / NO. Si es SI, los vendedores ven el top 10, sin cédulas. |
| `carpeta_fotos_id` | La crea `setup()`. No la cambies salvo que quieras usar otra carpeta. |
| `semana_ranking` | Semana que muestra la hoja Ranking (vacío = semana actual). |
| `dias_sesion` | Días que dura una sesión (7). |
| `monto_maximo_venta` | Tope por factura para atajar errores de tipeo (100000). |

### 5. Desplegar como aplicación web

1. En Apps Script: **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. **Ejecutar como: Yo**. **Quién tiene acceso: Cualquier persona**.
4. **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).
5. Para probarla, ábrela en el navegador: debe responder `{"ok":true,...}`.

> **Si cambias `Code.gs` después:** ve a **Implementar → Administrar implementaciones → Editar (lápiz) → Versión: Nueva versión → Implementar**. Así la URL no cambia. Si creas una implementación nueva, la URL sí cambia y tendrás que actualizar `config.js`.

### 6. Pegar la URL en el portal

Abre [`web/config.js`](web/config.js) y reemplaza `PEGA_AQUI_LA_URL_DEL_WEB_APP` con tu URL `/exec`.

### 7. Publicar el sitio

**Opción A: GitHub Pages** (este repo ya trae el flujo `.github/workflows/pages.yml`)

1. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Haz push a `main` (o corre el flujo "Publicar portal" desde la pestaña Actions).
3. La dirección queda en **Settings → Pages**.

> GitHub Pages en repos **privados** requiere un plan pago de GitHub. Si tu repo es privado y gratuito, usa la opción B.

**Opción B: Netlify (sin configurar nada)**

Entra a [app.netlify.com/drop](https://app.netlify.com/drop) y arrastra la carpeta `web`. Listo.

Comparte la dirección con los vendedores. Desde el celular pueden usar **"Agregar a la pantalla de inicio"** para tenerla como una app.

---

## Administración del concurso

### Revisar facturas

En **Registros** cada venta llega como **Pendiente**. Revisa la foto (columna `url_foto`) y cambia `estado` a **Aprobada** o **Rechazada**. En `nota_admin` puedes escribir el motivo: el vendedor lo ve en su historial.

- Con `contar_solo_aprobadas = NO`: las Pendientes y Aprobadas suman; las Rechazadas no.
- Con `contar_solo_aprobadas = SI`: solo suman las Aprobadas. Cuando apruebas, el vendedor ve su ticket la próxima vez que entra.
- Los cambios se ven en el portal en unos **20 segundos** (hay un caché corto para que el portal sea rápido).
- Una factura **rechazada** se puede volver a cargar (por ejemplo, con el monto correcto). Las demás no se pueden repetir, aunque sea otro vendedor y aunque cambien los ceros a la izquierda (`000123` = `123`).

### Olvidé mi contraseña

1. En **Usuarios**, busca la cédula y **borra la celda `password_hash`**.
2. Dile al vendedor que entre con su cédula. El portal le pedirá su **teléfono registrado** y una contraseña nueva.

Otros casos en **Usuarios**:

- **Bloqueo temporal:** tras 5 intentos fallidos la cuenta queda en pausa 15 minutos (`bloqueado_hasta`). Para desbloquear antes, borra esa celda.
- **Bloquear a alguien:** cambia `estado` a `bloqueado`. Pierde la sesión de inmediato.

### Menú "Copa Prosein"

| Opción | Qué hace |
|---|---|
| **Inicializar hojas** | Corre `setup()` (no borra datos). |
| **Recalcular rankings** | Reescribe la hoja Ranking: general, Austral, semana y cupones. |
| **Generar cupones para sorteo** | Lista numerada `Cupón 0001 → cédula / vendedor`, en el orden en que se completaron. |
| **Ganadores semanales (elegir semana)** | Pide el número de semana y muestra los ganadores. Avisa si hay empate exacto en el último puesto premiado. |
| **Ganador Austral** | Muestra el top 5 de m² Austral. El primero gana el viaje. |
| **Cargar / Borrar datos de prueba** | 8 vendedores de prueba (cédulas 90000001–90000008, contraseña `prueba123`) con ventas. Sirve para ver los rankings antes del lanzamiento. Bórralos antes de empezar. |

> **Recomendación para los premios semanales:** corre "Ganadores semanales" el mismo día y hora después de cerrar cada semana y guarda el resultado. Una factura cargada tarde con fecha de una semana pasada puede cambiar esa semana.

### Sorteo final

1. Cierra la carga: `concurso_abierto = NO`.
2. Revisa las facturas pendientes.
3. Menú **Generar cupones para sorteo**. En la hoja Ranking queda la lista `Cupón 0001 … Cupón N`.
4. Para sortear, puedes usar `=ALEATORIO.ENTRE(1; N)` en una celda aparte o un generador público, y grabar el momento.

La mecánica (cuántos premios, si un vendedor puede ganar dos veces, etc.) todavía se está definiendo. La lista sale de `cuponesParaSorteo_()` en `Code.gs`, así que es fácil ajustarla.

---

## Seguridad

- Las contraseñas se guardan con **hash SHA-256 + salt** por usuario, repetido 300 veces. Nunca en texto.
- La sesión es un token aleatorio que **vence** (7 días). En el servidor se guarda solo un hash del token.
- Cada acción usa **la cédula del token**, nunca una cédula enviada por el navegador.
- 5 intentos fallidos → bloqueo de 15 minutos.
- Todo se valida en el servidor: fechas dentro del concurso y no futuras, montos, m² obligatorios si vendió Austral, y que la foto sea realmente una imagen.
- Los textos que empiezan con `=`, `+`, `-` o `@` se guardan como texto (evita fórmulas maliciosas en el Sheet).
- Las escrituras usan `LockService` para que dos ventas simultáneas no se pisen.
- Las fotos quedan **privadas** en tu Drive. El vendedor ve solo las suyas a través del portal. Tú las abres desde la columna `url_foto`.

---

## Personalizar

- **Colores:** bloque `:root` al inicio de [`web/styles.css`](web/styles.css). Ya tiene los de prosein.com.ve: rojo `#DF1630`, carbón `#303133`, tipografía Poppins.
- **Textos de las reglas:** se arman con los valores de Configuracion (monto por cupón, premios semanales, fecha del sorteo).
- **Compresión de fotos:** `FOTO_LADO_MAX` y `FOTO_CALIDAD` en `web/config.js`.

---

## Probar en tu computadora (opcional, para desarrolladores)

Requiere [Node.js](https://nodejs.org) 18 o superior. No hace falta instalar nada más.

```bash
npm test          # 25 pruebas del backend (cupones, semanas, duplicadas, sesiones, fórmulas…)
npm run dev       # portal en http://localhost:5173 con datos de prueba
```

`npm run dev` corre el mismo `Code.gs` sobre un simulador de Google Sheets, así que puedes probar todo el flujo sin desplegar. Opciones: `--solo-aprobadas`, `--sin-ranking`, `--latencia=800`.

Con [Playwright](https://playwright.dev) instalado, `node dev/e2e.js capturas/` recorre el portal en un iPhone simulado (registro, venta, ticket, duplicada, sesión vencida, escritorio y movimiento reducido) y guarda capturas.
