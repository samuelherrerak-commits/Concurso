# Copa Prosein · La bolsa de los deseos

Portal web para el concurso interno de ventas de Prosein (fin de año 2026). Cada vendedor:

- se registra con su **cédula**, una contraseña y su **canal de ventas** (Tiendas, Distribuidores o Corporativo; en Tiendas también elige su tienda),
- carga sus ventas (día, número de factura, monto, **foto de la factura** y, si vendió Austral, los **m²**),
- ve sus **cupones** de cada ronda, el avance de su **meta**, sus cupones para el **Gran Sorteo Final**, sus **tickets Austral** y el ranking.

Cuando una venta completa un cupón, el portal **imprime un ticket de supermercado** con el número del cupón (rojo; los tickets Austral salen en tinta azul). Después, tocando cualquier cupón en "Mis cupones", el vendedor lo vuelve a ver sin animación y lo **descarga como imagen**.

Hay además una cuenta de **administrador** (la agregas a mano en la hoja Usuarios) para **auditar todo** desde el portal e **imprimir los cupones** de cada sorteo para meterlos en la bolsa.

El sitio es **estático** (HTML, CSS y JavaScript sin frameworks) y el backend es **Google Apps Script** con **Google Sheets** como base de datos.

```
apps-script/
  Code.gs            ← backend completo (se pega en el editor de Apps Script)
  appsscript.json    ← manifiesto opcional (zona horaria Caracas)
web/                 ← el sitio que se publica
  index.html         ← portal del vendedor y del administrador
  cupones.html       ← cupones para imprimir (solo administrador)
  styles.css         ← colores de Prosein en :root
  imprimir.css       ← hoja carta, 24 cupones por hoja
  config.js          ← AQUÍ va la URL del Web App
  app.js
  js/                ← módulos (api, panel, venta, ticket, cupon, admin, imprimir…)
  assets/
dev/                 ← solo para probar en tu computadora (no se publica)
tests/               ← pruebas del backend
```

---

## Reglas del concurso (cómo calcula el sistema)

Los números se cambian en la hoja **Configuracion**, las fechas en **Rondas** y el valor del cupón y las metas en **Canales**.

| Regla | Cómo se calcula |
|---|---|
| **Canales** | Cada vendedor es de **Tiendas** (con su tienda), **Distribuidores** o **Corporativo**. Cada tienda y cada canal tiene su **valor de cupón** y su **meta** (hoja Canales). |
| **Cupones** | `cupones = piso(total vendido acumulado ÷ valor del cupón de su tienda o canal)`. Con $1.500: $4.600 = 3 cupones. El sobrante nunca se pierde. |
| **Rondas** | Ronda 1: 15/10 al 5/11, sorteo **lun 9/11**. Ronda 2: 6/11 al 26/11, sorteo **lun 30/11**. Ronda 3: 27/11 al 10/12, sorteo **lun 14/12**. **La Ñapa**: 11/12 al 19/12, **sin sorteo** (solo suma para el final). |
| **Corte** | Cada ronda cierra el día siguiente a su último día a las **3:00 p. m.** (por ejemplo, la Ronda 1 el viernes 6/11). Después del corte no se cargan ventas con fecha de esa ronda. |
| **Sorteo de cada ronda** | A la bolsa entran **solo los cupones completados en esa ronda**: `piso(acumulado al cierre ÷ M) − piso(acumulado al cierre de la ronda anterior ÷ M)`. El sobrante en $ pasa a la siguiente ronda. La ronda la define el **día de la venta**. |
| **Gran Sorteo Final** | **Lun 21/12**. Cada **10 cupones** acumulados en toda la campaña (incluida La Ñapa) = **1 cupón final**, solo si el vendedor vendió al menos el **80 % de la meta** de su tienda o canal. Sin meta en Canales = no hay requisito. |
| **Tickets Austral** | Cada **100 m² de Austral** = **1 ticket adicional para el Gran Sorteo Final** (el sobrante se acumula). Entran con la misma condición del 80 % de la meta (`austral_requiere_meta = SI`). |

Todo se recalcula desde la hoja **Registros** en cada consulta. No hay contadores guardados: si apruebas, rechazas o corriges una factura, los cupones de cada ronda y del final se ajustan solos.

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
3. `setup()` crea las hojas **Configuracion**, **Rondas**, **Canales**, **Registros**, **Usuarios** y **Ranking**, con sus formatos y listas desplegables. También crea en tu Drive la carpeta **"Copa Prosein · Fotos de facturas"**. Puedes correrlo otra vez sin perder datos.
4. Recarga el Sheet: aparecerá el menú **Copa Prosein**.

### 4. Revisar la hoja Configuracion

Cada fila tiene su explicación en la columna **descripción**:

| clave | valor inicial | qué es |
|---|---|---|
| `nombre_sorteo` | La bolsa de los deseos | Nombre de los sorteos en el portal. |
| `hora_corte` | 15:00 | Hora del corte (el día siguiente al fin de cada ronda) cuando la hoja Rondas no trae otra. |
| `bloquear_rondas_cerradas` | SI | Después del corte ya no se cargan ventas con fecha de esa ronda. |
| `fecha_sorteo_final` | 21/12/2026 | Gran Sorteo Final. |
| `porcentaje_meta_final` | 80 | % de la meta que hay que vender para entrar al Gran Sorteo Final. |
| `cupones_por_cupon_final` | 10 | Cada N cupones = 1 cupón final. |
| `monto_por_cupon` | 1500 | Valor de respaldo, si una tienda o canal no tiene valor en Canales. |
| `m2_por_cupon_austral` | 100 | m² de Austral por ticket adicional para el Gran Sorteo Final. |
| `austral_requiere_meta` | SI | SI = los tickets Austral entran solo si el vendedor cumple el % de su meta. NO = entran siempre. |
| `concurso_abierto` | SI | Con NO nadie puede cargar ventas. |
| `contar_solo_aprobadas` | NO | NO = las facturas suman al cargarlas (puedes rechazarlas después). SI = solo suman al aprobarlas. |
| `mostrar_ranking_publico` | SI | Los vendedores ven el top 10, sin cédulas. |
| `token_api` | copaprosein | Igual que `API_TOKEN` en `web/config.js`. |

Otras claves: `nombre_concurso`, `moneda`, `carpeta_fotos_id` (la crea `setup()`), `ronda_ranking`, `dias_sesion`, `monto_maximo_venta`.

### 4b. Revisar la hoja Rondas

Una fila por ronda: `ronda`, `nombre`, `inicio`, `fin`, `corte` (fecha y hora) y `sorteo`. Ya viene con el cronograma de fin de año. Puedes editar cualquier celda (por ejemplo, mover un corte); el portal usa lo que diga esta hoja. Una ronda con `sorteo` vacío no tiene sorteo (como La Ñapa). Si algo se daña: menú **Copa Prosein → Restaurar rondas**.

### 4c. Poner el valor del cupón y la meta en la hoja Canales

Una fila por tienda (canal `Tienda`) y una para `Distribuidor` y otra para `Corporativo`:

| canal | tienda | monto_por_cupon | meta |
|---|---|---|---|
| Tienda | Boleíta | 1500 | 20000 |
| Tienda | Maracaibo | 1000 | 12000 |
| Distribuidor | | 3000 | 50000 |
| Corporativo | | 2500 | 40000 |

- `monto_por_cupon`: cuánto hay que vender para 1 cupón.
- `meta`: lo que debe vender un vendedor de esa tienda o canal en toda la campaña. Para el Gran Sorteo Final necesita el `porcentaje_meta_final` (80 %). **Vacía = sin requisito.**
- Para agregar una tienda, agrega una fila con canal `Tienda`: aparece en el registro.

### 4d. Crear el usuario administrador

En la hoja **Usuarios**, agrega una fila a mano con: `cedula`, `nombre`, `apellido`, `telefono` y **`rol` = `admin`**. Deja `password_hash` vacío.

Luego entra al portal con esa cédula: te pedirá el teléfono que escribiste y una contraseña nueva. A partir de ahí entras directo a la vista de **Administración**. Puedes tener varios administradores.

### 5. Desplegar como aplicación web

1. En Apps Script: **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. **Ejecutar como: Yo**. **Quién tiene acceso: Cualquier persona**.
4. **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).
5. Para probarla, ábrela en el navegador: debe responder `{"ok":true,...}`.

> **Si cambias `Code.gs` después:**
> 1. Pega el nuevo `Code.gs` y guarda.
> 2. Ejecuta `setup()` otra vez: agrega las filas nuevas de Configuracion (por ejemplo `token_api`) sin borrar datos.
> 3. **Implementar → Administrar implementaciones → Editar (lápiz) → Versión: Nueva versión → Implementar**. Así la URL no cambia. Si creas una implementación nueva, la URL sí cambia y tendrás que actualizar `config.js`.

### 6. Pegar la URL y la clave en el portal

En [`web/config.js`](web/config.js):

- `API_URL`: tu URL `/exec` (ya está puesta la de Prosein).
- `API_TOKEN`: `copaprosein`, igual que `token_api` en la hoja Configuracion. Si algún día la cambias, cámbiala en los dos lugares.

### 7. Publicar el sitio

**Opción A: GitHub Pages** (este repo ya trae el flujo `.github/workflows/pages.yml`)

1. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Haz push a `main` (o corre el flujo "Publicar portal" desde la pestaña Actions).
3. La dirección queda en **Settings → Pages**.

> GitHub Pages en repos **privados** requiere un plan pago de GitHub. Si tu repo es privado y gratuito, usa la opción B.

**Opción B: Netlify (sin configurar nada)**

Entra a [app.netlify.com/drop](https://app.netlify.com/drop) y arrastra la carpeta `web`. Listo.

Comparte la dirección con los vendedores. El portal se instala como app (ícono de la bolsa, pantalla completa):

- **Android (Chrome):** botón **"Agregar la app a tu inicio"** en la pantalla de acceso (o en el menú de la cuenta), o menú ⋮ → **Instalar app**.
- **iPhone (Safari):** botón **Compartir** → **Agregar a inicio**. El portal muestra estos pasos al tocar el botón.

---

## Administración del concurso

### Panel del administrador (en el portal)

Es de **solo lectura**: sirve para auditar sin tocar el Sheet.

| Pestaña | Qué muestra |
|---|---|
| **Resumen** | Ronda en juego, corte y sorteo; vendedores, facturas, monto, cupones, cuántos cumplen el 80 % de la meta, tickets del Gran Sorteo Final (por cupones y por Austral), m² Austral y tickets Austral; una fila por tienda y canal con su valor de cupón, meta y avance. |
| **Vendedores** | Cada vendedor con su tienda o canal, cupones, cupones de la ronda, vendido, % de la meta, tickets del Gran Sorteo Final y tickets Austral. Filtros y **CSV**. |
| **Ventas** | Todas las facturas con su estado, ronda y foto. Filtros y **CSV**. |
| **Rondas** | Las 4 rondas con su corte, sorteo y estado; quién completó cupones en cada una. |
| **Sorteos** | Las bolsas: Ronda 1, 2, 3 y Gran Sorteo Final (que incluye los tickets Austral), con sus cupones y el botón para **imprimirlos**. |

### Imprimir los cupones para la bolsa

En **Sorteos → Imprimir** se abre `cupones.html`:

- Papel **carta**, **24 cupones por hoja** (3 × 8) con líneas punteadas para recortar. Cada sorteo empieza en una hoja nueva.
- Cada cupón lleva su código único (`R1-0001` Ronda 1, `R2-…`, `R3-…`, `F-0001` Gran Sorteo Final, incluidos los tickets Austral), el nombre, la cédula, la tienda o canal y la factura.
- Los del **Gran Sorteo Final** llevan una **banda roja**; los **tickets Austral** van en la misma bolsa con una **banda negra**. En el diálogo de impresión activa **"Gráficos de fondo"** y usa **escala 100 %**.
- Antes del corte de su ronda las hojas salen marcadas **PROVISIONAL**. Imprime cada bolsa después de su corte (Ronda 1: después del viernes 6/11 a las 3:00 p. m.).

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
- **Cambio de tienda o canal:** edita `canal` (Tienda, Distribuidor o Corporativo) y `sucursal_o_zona` (una tienda de la hoja Canales). Las cuentas sin canal válido lo eligen la próxima vez que entran.

### Menú "Copa Prosein"

| Opción | Qué hace |
|---|---|
| **Inicializar hojas** | Corre `setup()` (no borra ventas ni usuarios). |
| **Restaurar rondas (cronograma original)** | Vuelve a escribir la hoja Rondas con las fechas de fin de año. |
| **Recalcular rankings** | Reescribe la hoja Ranking: general (con meta y cupones finales), ronda, tickets Austral y sorteos. |
| **Generar cupones para sorteo** | Lista de cada bolsa con su código (`R1-0001`, `F-0001`…), cédula, vendedor y factura. |
| **Resultado de una ronda** | Pide la ronda y muestra quién completó cupones y cuántos van a su sorteo. |
| **Resumen de los sorteos** | Cuántos cupones y vendedores hay en cada bolsa y cuántos cumplen la meta. |
| **Cargar / Borrar datos de prueba** | 8 vendedores de prueba (cédulas 90000001–90000008, contraseña `prueba123`). Bórralos antes de empezar. |

### Cada sorteo

1. Espera el corte de la ronda (por ejemplo, viernes 6/11 a las 3:00 p. m. para la Ronda 1) y revisa las facturas pendientes.
2. En el panel: **Sorteos → Ronda N → Imprimir cupones**. Recorta, dobla y mete los cupones en la bolsa.
3. Verifica el código del cupón que salga en la hoja Ranking (menú **Generar cupones para sorteo**) o en el panel.
4. Para el **Gran Sorteo Final** (21/12), después del corte de La Ñapa (domingo 20/12, 3:00 p. m.) pon `concurso_abierto = NO` e imprime **Gran Sorteo Final** (ya trae los tickets Austral).

---

## Seguridad

- Las contraseñas se guardan con **hash SHA-256 + salt** por usuario, repetido 300 veces. Nunca en texto.
- Cada solicitud lleva la clave del portal (`token_api`). Sin ella, el Web App no responde. Es un filtro contra llamadas de afuera, no una contraseña: la clave queda visible en el código del sitio. La protección real es el login de cada vendedor.
- La sesión de cada vendedor es un token aleatorio que **vence** (7 días). En el servidor se guarda solo un hash del token.
- Cada acción usa **la cédula del token**, nunca una cédula enviada por el navegador.
- 5 intentos fallidos → bloqueo de 15 minutos.
- Todo se valida en el servidor: fechas dentro de la campaña y de rondas abiertas, no futuras, montos, m² obligatorios si vendió Austral, y que la foto sea realmente una imagen.
- Los textos que empiezan con `=`, `+`, `-` o `@` se guardan como texto (evita fórmulas maliciosas en el Sheet).
- Las escrituras usan `LockService` para que dos ventas simultáneas no se pisen.
- Las fotos quedan **privadas** en tu Drive. El vendedor ve solo las suyas a través del portal; el administrador puede ver todas desde el panel. También las abres desde la columna `url_foto`.
- El rol de administrador solo se asigna a mano en la hoja (`rol = admin`). Las acciones del panel verifican el rol en el servidor: un vendedor no puede pedir esos datos.

---

## Personalizar

- **Colores:** bloque `:root` al inicio de [`web/styles.css`](web/styles.css). Ya tiene los de prosein.com.ve: rojo `#DF1630`, carbón `#303133`, tipografía Poppins.
- **Textos de las reglas:** se arman con Configuracion, Rondas y Canales (valor del cupón, fechas de cada sorteo, % de la meta).
- **Compresión de fotos:** `FOTO_LADO_MAX` y `FOTO_CALIDAD` en `web/config.js`.

---

## Actualizar desde la versión anterior (semanas y categorías)

1. Pega el nuevo [`apps-script/Code.gs`](apps-script/Code.gs) y guarda.
2. Ejecuta **`setup()`**. Sin borrar ventas ni usuarios:
   - crea las hojas **Rondas** (con el cronograma de fin de año) y **Canales** (con tus tiendas y el `monto_por_cupon` que tenías),
   - **borra** la hoja Periodos y las claves viejas de Configuracion (semanas, categorías, `sucursales`…),
   - agrega la columna **`canal`** en Usuarios. Quien ya tenía una tienda válida queda en el canal Tienda; los demás eligen su canal al entrar.
3. Llena el **valor del cupón** y la **meta** de cada tienda y canal en la hoja **Canales**.
4. **Implementar → Administrar implementaciones → Editar → Versión: Nueva versión → Implementar** (la URL no cambia).
5. Si no lo has hecho, agrega tu fila de administrador en Usuarios (paso 4d).
6. Publica el sitio nuevo (paso 7).

---

## Probar en tu computadora (opcional, para desarrolladores)

Requiere [Node.js](https://nodejs.org) 18 o superior. No hace falta instalar nada más.

```bash
npm test          # 36 pruebas del backend (cupones, canales, rondas, metas, bolsas, admin, sesiones…)
npm run dev       # portal en http://localhost:5173 con datos de prueba y un administrador
```

`npm run dev` corre el mismo `Code.gs` sobre un simulador de Google Sheets, así que puedes probar todo el flujo sin desplegar. El administrador de prueba es la cédula `11111111` con contraseña `admin123`. Las fechas se corren para que hoy sea el día 25 de la campaña (Ronda 2). Opciones: `--real` (fechas reales), `--dia=5`, `--metas`, `--solo-aprobadas`, `--sin-ranking`, `--sin-bloqueo`, `--latencia=800`.

Con [Playwright](https://playwright.dev) instalado, `node dev/e2e.js capturas/` recorre el portal (registro con canal y tienda, ventas, tickets normales y Austral, ver y descargar cupones, tienda faltante, panel del administrador, cupones para imprimir en PDF y movimiento reducido) y guarda capturas.
