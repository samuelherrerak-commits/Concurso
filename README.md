# Copa Navideña Austral - Prosein

Portal web para el concurso interno de ventas de Prosein (fin de año 2026), publicado en **https://bolsa-de-los-deseos-2026.onrender.com/**. Cada vendedor:

- se registra con su **cédula**, una contraseña y su **canal de ventas** (Tiendas, Distribuidores o Corporativo; en Tiendas también elige su tienda),
- carga sus ventas (día, número de factura, **monto total de la factura sin IVA**, **foto de la factura**; si vendió **revestimiento o pavimento importado de proveedor nacional**, ese monto en dólares, que se resta porque no participa; y si vendió Austral, los **m² o piezas**),
- ve sus **cupones** de cada ronda, el avance de su **meta**, sus cupones para el **Gran Sorteo Final**, sus **cupones Austral** y el ranking.

La primera vez que se abre el portal salen unas **tarjetas de bienvenida** que se deslizan (bienvenida, premios, sorteos, ñapa y condiciones A–J). Se pueden volver a ver desde **"¿Cómo funciona la Copa?"** en la pantalla de acceso o en la sección **Cómo funciona la Copa** del panel. Sus textos están en `web/js/copa.js`; las fechas, el valor del cupón y los m² o piezas de Austral salen de las hojas.

Cuando una venta completa un cupón, el portal **imprime un ticket de supermercado** con el número del cupón (rojo; los cupones Austral salen en tinta azul). Después, tocando cualquier cupón en "Mis cupones", el vendedor lo vuelve a ver sin animación y lo **descarga como imagen**.

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

Los números se cambian en la hoja **Configuracion**, las fechas en **Rondas** y el valor del cupón, las metas y los m² o piezas de Austral en **Canales**.

| Regla | Cómo se calcula |
|---|---|
| **Canales** | Cada vendedor es de **Tiendas** (con su tienda), **Distribuidores** o **Corporativo**. Cada tienda y cada canal tiene su **valor de cupón**, su **meta** (informativa) y sus **m² o piezas de Austral por cupón** (hoja Canales). |
| **Cupones** | `cupones = piso(total vendido acumulado ÷ valor del cupón de su tienda o canal)`. Con $1.500: $4.600 = 3 cupones. El sobrante nunca se pierde. El monto es **sin IVA** y **no cuenta** el pavimento y revestimiento importado de proveedores nacionales: el vendedor lo indica y se resta de la factura. |
| **Rondas** | Ronda 1: 15/10 al 5/11, sorteo **lun 9/11**. Ronda 2: 6/11 al 26/11, sorteo **lun 30/11**. Ronda 3: 27/11 al 10/12, sorteo **lun 14/12**. **La Ñapa**: 11/12 al 19/12, **sin sorteo** (solo suma para el final). |
| **Cierre de cada ronda** | Cada ronda cierra al **terminar su último día** (11:59 p. m.). La ronda de una venta es la del **día en que se registra**: si una factura del 5/11 se registra el 6/11, cuenta para la Ronda 2. Se registra hasta el 19/12. |
| **Sorteo de cada ronda** | A la bolsa entran **solo los cupones completados en esa ronda**: `piso(acumulado al cierre ÷ M) − piso(acumulado al cierre de la ronda anterior ÷ M)`. El sobrante en $ pasa a la siguiente ronda. La ronda la define el **día de registro**. |
| **Gran Sorteo Final** | **Lun 21/12**. Cada **8 cupones** acumulados en toda la campaña (incluida La Ñapa) = **1 cupón final**. No hay requisito de meta: la meta es solo informativa. |
| **Cupones Austral** | Cada **80 m² o piezas de Austral** = **1 cupón adicional para el Gran Sorteo Final** (el sobrante se acumula). En **Distribuidores** cada **500**, porque venden mercancía Austral. |
| **Mejor vendedor** | Al cerrar cada ronda con sorteo, quien **más vendió (monto) en su canal** (Tiendas, Distribuidores, Corporativo) gana **1 cupón para el Gran Sorteo Final**. Empate: quien llegó primero a ese monto. La Ñapa no da mejor vendedor. |

Todo se recalcula desde la hoja **Registros** en cada consulta. No hay contadores guardados: si apruebas, rechazas o corriges una factura, los cupones de cada ronda y del final se ajustan solos.

---

## Instalación paso a paso

### 1. Crear el Google Sheet

Crea un Google Sheet nuevo (por ejemplo "Copa Navideña 2026") en la cuenta de Google que va a administrar el concurso.

### 2. Pegar el script

1. En el Sheet: **Extensiones → Apps Script**.
2. Borra lo que haya en `Código.gs` y pega todo el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. *(Opcional, recomendado)* En **Configuración del proyecto** (ícono de engranaje), activa **"Mostrar el archivo de manifiesto appsscript.json"**. Abre `appsscript.json` y reemplázalo con [`apps-script/appsscript.json`](apps-script/appsscript.json). Esto fija la zona horaria en Caracas.
4. Guarda (Ctrl + S).

### 3. Ejecutar `setup()` y autorizar

1. En el selector de funciones (arriba), elige **`setup`** y pulsa **Ejecutar**.
2. Google pedirá permisos. Si aparece "Google no ha verificado esta app": **Configuración avanzada → Ir a … (no seguro)**. Es normal en scripts propios.
3. `setup()` crea las hojas **Configuracion**, **Rondas**, **Canales**, **Registros**, **Usuarios** y **Ranking**, con sus formatos y listas desplegables. También crea en tu Drive la carpeta **"Copa Navideña · Fotos de facturas"**. Puedes correrlo otra vez sin perder datos.
4. Recarga el Sheet: aparecerá el menú **Copa Navideña**.

### 4. Revisar la hoja Configuracion

Cada fila tiene su explicación en la columna **descripción**:

| clave | valor inicial | qué es |
|---|---|---|
| `nombre_sorteo` | Copa Navideña | Nombre de los sorteos en el portal. Si la hoja aún dice "La bolsa de los deseos" o "Copa Prosein", se usa el nombre nuevo. |
| `fecha_sorteo_final` | 21/12/2026 | Gran Sorteo Final. |
| `cupones_por_cupon_final` | 8 | Cada N cupones = 1 cupón final (si la hoja aún dice 10, `setup()` lo cambia a 8). |
| `monto_por_cupon` | 1500 | Valor de respaldo, si una tienda o canal no tiene valor en Canales. |
| `m2_por_cupon_austral` | 80 | m² o piezas de Austral por cupón adicional para el Gran Sorteo Final, si la hoja Canales no trae otro valor (Distribuidores: 500 en Canales). |
| `concurso_abierto` | SI | Con NO nadie puede cargar ventas. |
| `contar_solo_aprobadas` | NO | NO = las facturas suman al cargarlas (puedes rechazarlas después). SI = solo suman al aprobarlas. |
| `mostrar_ranking_publico` | SI | Los vendedores ven el top 10, sin cédulas. |
| `token_api` | copaprosein | Igual que `API_TOKEN` en `web/config.js`. |

Otras claves: `nombre_concurso`, `moneda`, `carpeta_fotos_id` (la crea `setup()`), `ronda_ranking`, `dias_sesion`, `monto_maximo_venta`.

### 4b. Revisar la hoja Rondas

Una fila por ronda: `ronda`, `nombre`, `inicio`, `fin` y `sorteo`. Cada ronda cierra al terminar su día `fin`. Ya viene con el cronograma de fin de año. Puedes editar cualquier celda (por ejemplo, alargar una ronda); el portal usa lo que diga esta hoja. Una ronda con `sorteo` vacío no tiene sorteo (como La Ñapa). Si algo se daña: menú **Copa Navideña → Restaurar rondas**.

### 4c. Poner el valor del cupón, la meta y Austral en la hoja Canales

Una fila por tienda (canal `Tienda`) y una para `Distribuidor` y otra para `Corporativo`:

| canal | tienda | monto_por_cupon | meta | m2_por_cupon_austral |
|---|---|---|---|---|
| Tienda | Boleíta | 1500 | 20000 | |
| Tienda | Maracaibo | 1000 | 12000 | |
| Distribuidor | | 3000 | 50000 | 500 |
| Corporativo | | 2500 | 40000 | |

- `monto_por_cupon`: cuánto hay que vender para 1 cupón.
- `meta`: lo que debería vender un vendedor de esa tienda o canal en toda la campaña. Es **informativa**: el vendedor ve su avance, pero no es requisito para el Gran Sorteo Final. Vacía = sin meta.
- `m2_por_cupon_austral`: m² o piezas de Austral para 1 cupón adicional del Gran Sorteo Final. Vacío = el de Configuracion (80). Distribuidores: 500.
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

El portal está publicado en **Render** como *Static Site*: **https://bolsa-de-los-deseos-2026.onrender.com/**

Configuración en Render (**+ New → Static Site**, repo `samuelherrerak-commits/Concurso`):

| Campo | Valor |
|---|---|
| Name | `bolsa-de-los-deseos-2026` |
| Branch | `claude/wonderful-fermat-qy0w17` |
| Build Command | `echo listo` |
| Publish Directory | `web` |

Con **Auto-Deploy** activado, cada push a esa rama se publica solo.

> Alternativas: GitHub Pages (el repo trae el flujo `.github/workflows/pages.yml`, se corre desde Actions → "Publicar portal") o Netlify ([app.netlify.com/drop](https://app.netlify.com/drop), arrastrando la carpeta `web`).

Comparte la dirección con los vendedores. El portal se instala como app (ícono de la bolsa, pantalla completa):

- **Android (Chrome):** botón **"Agregar la app a tu inicio"** en la pantalla de acceso (o en el menú de la cuenta), o menú ⋮ → **Instalar app**.
- **iPhone (Safari):** botón **Compartir** → **Agregar a inicio**. El portal muestra estos pasos al tocar el botón.

---

## Administración del concurso

### Panel del administrador (en el portal)

Es de **solo lectura**: sirve para auditar sin tocar el Sheet.

| Pestaña | Qué muestra |
|---|---|
| **Resumen** | Ronda en juego, cierre y sorteo; vendedores, facturas, monto, cupones, cupones del Gran Sorteo Final (por cupones, Austral y mejor vendedor), m² Austral y cupones Austral; una fila por tienda y canal con su valor de cupón, meta y m² Austral por cupón. |
| **Vendedores** | Cada vendedor con su tienda o canal, cupones, cupones de la ronda, vendido, % de la meta, cupones del Gran Sorteo Final, cupones Austral y de mejor vendedor. Filtros y **CSV**. |
| **Ventas** | Todas las facturas con su estado, ronda y foto. Filtros y **CSV**. |
| **Rondas** | Las 4 rondas con su cierre, sorteo y estado; quién completó cupones en cada una y el **mejor vendedor por canal**. |
| **Sorteos** | Las bolsas: Ronda 1, 2, 3 y Gran Sorteo Final (que incluye los cupones Austral y los de mejor vendedor), con sus cupones y el botón para **imprimirlos**. |

### Imprimir los cupones para la bolsa

En **Sorteos → Imprimir** se abre `cupones.html`:

- Papel **carta**, **24 cupones por hoja** (3 × 8) con líneas punteadas para recortar. Cada sorteo empieza en una hoja nueva.
- Cada cupón lleva su código único (`R1-0001` Ronda 1, `R2-…`, `R3-…`, `F-0001` Gran Sorteo Final, incluidos los cupones Austral y de mejor vendedor), el nombre, la cédula, la tienda o canal y la factura.
- Los del **Gran Sorteo Final** llevan una **banda roja**; los **cupones Austral** van en la misma bolsa con una **banda negra** y los de **mejor vendedor** con una **banda dorada**. En el diálogo de impresión activa **"Gráficos de fondo"** y usa **escala 100 %**.
- Antes del cierre de su ronda las hojas salen marcadas **PROVISIONAL**. Imprime cada bolsa después del cierre (Ronda 1: desde el viernes 6/11).

### Revisar facturas

En **Registros** cada venta llega como **Pendiente**. Revisa la foto (columna `url_foto`) y cambia `estado` a **Aprobada** o **Rechazada**. En `nota_admin` puedes escribir el motivo: el vendedor lo ve en su historial.

Columnas de monto: `monto_factura` es el total de la factura sin IVA, `monto_excluido` lo vendido en pavimento o revestimiento importado de proveedores nacionales y `monto` lo que cuenta para la Copa (factura menos excluido). Si corriges una factura a mano, cambia `monto`: es la que se usa para los cupones.

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

### Menú "Copa Navideña"

| Opción | Qué hace |
|---|---|
| **Inicializar hojas** | Corre `setup()` (no borra ventas ni usuarios). |
| **Restaurar rondas (cronograma original)** | Vuelve a escribir la hoja Rondas con las fechas de fin de año. |
| **Recalcular rankings** | Reescribe la hoja Ranking: general (con meta y cupones finales), ronda, cupones Austral y sorteos. |
| **Generar cupones para sorteo** | Lista de cada bolsa con su código (`R1-0001`, `F-0001`…), cédula, vendedor y factura. |
| **Resultado de una ronda** | Pide la ronda y muestra quién completó cupones y cuántos van a su sorteo. |
| **Resumen de los sorteos** | Cuántos cupones y vendedores hay en cada bolsa. |
| **Cargar / Borrar datos de prueba** | 8 vendedores de prueba (cédulas 90000001–90000008, contraseña `prueba123`). Bórralos antes de empezar. |

### Cada sorteo

1. Espera el cierre de la ronda (al terminar su último día; para la Ronda 1, el jueves 5/11 a las 11:59 p. m.) y revisa las facturas pendientes.
2. En el panel: **Sorteos → Ronda N → Imprimir cupones**. Recorta, dobla y mete los cupones en la bolsa.
3. Verifica el código del cupón que salga en la hoja Ranking (menú **Generar cupones para sorteo**) o en el panel.
4. Para el **Gran Sorteo Final** (21/12), después del cierre de La Ñapa (sábado 19/12 a las 11:59 p. m.) imprime **Gran Sorteo Final** (ya trae los cupones Austral y los de mejor vendedor). Desde el 20/12 el portal ya no deja registrar.

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
- **Textos de las reglas:** se arman con Configuracion, Rondas y Canales (valor del cupón, fechas de cada sorteo, m² o piezas de Austral).
- **Compresión de fotos:** `FOTO_LADO_MAX` y `FOTO_CALIDAD` en `web/config.js`.

---

## Actualizar desde la versión anterior (semanas y categorías)

1. Pega el nuevo [`apps-script/Code.gs`](apps-script/Code.gs) y guarda.
2. Ejecuta **`setup()`**. Sin borrar ventas ni usuarios:
   - crea las hojas **Rondas** (con el cronograma de fin de año) y **Canales** (con tus tiendas y el `monto_por_cupon` que tenías),
   - **borra** la hoja Periodos y las claves viejas de Configuracion (semanas, categorías, `sucursales`…),
   - agrega la columna **`canal`** en Usuarios. Quien ya tenía una tienda válida queda en el canal Tienda; los demás eligen su canal al entrar.
3. Llena el **valor del cupón**, la **meta** y los **m² o piezas de Austral** de cada tienda y canal en la hoja **Canales**.
4. **Implementar → Administrar implementaciones → Editar → Versión: Nueva versión → Implementar** (la URL no cambia).
5. Si no lo has hecho, agrega tu fila de administrador en Usuarios (paso 4d).
6. Publica el sitio nuevo (paso 7).

---

## Probar en tu computadora (opcional, para desarrolladores)

Requiere [Node.js](https://nodejs.org) 18 o superior. No hace falta instalar nada más.

```bash
npm test          # 40 pruebas del backend (cupones, canales, rondas, metas, bolsas, admin, sesiones…)
npm run dev       # portal en http://localhost:5173 con datos de prueba y un administrador
```

`npm run dev` corre el mismo `Code.gs` sobre un simulador de Google Sheets, así que puedes probar todo el flujo sin desplegar. El administrador de prueba es la cédula `11111111` con contraseña `admin123`. Las fechas se corren para que hoy sea el día 25 de la campaña (Ronda 2). Opciones: `--real` (fechas reales), `--dia=5`, `--metas`, `--solo-aprobadas`, `--sin-ranking`, `--latencia=800`.

Con [Playwright](https://playwright.dev) instalado, `node dev/e2e.js capturas/` recorre el portal (registro con canal y tienda, ventas, tarjetas de bienvenida, tickets normales y Austral, ver y descargar cupones, tienda faltante, panel del administrador, cupones para imprimir en PDF y movimiento reducido) y guarda capturas.
