# Copa Prosein · Portal de vendedores

Portal web para el concurso interno de ventas de Prosein. Cada vendedor:

- se registra con su **cédula**, una contraseña y su **tienda Prosein** (obligatoria),
- carga sus ventas (día, número de factura, monto, **foto de la factura** y, si vendió Austral, los **m²**),
- ve su récord, su **categoría**, sus **cupones** para el sorteo final, sus **cupones del viaje** (Austral) y el ranking.

Cuando una venta completa un cupón, el portal **imprime un ticket de supermercado** con el número del cupón (rojo; los del viaje salen en tinta azul). Después, tocando cualquier cupón en "Mis cupones", el vendedor lo vuelve a ver sin animación y lo **descarga como imagen**.

Hay además una cuenta de **administrador** (la agregas a mano en la hoja Usuarios) para **auditar todo** desde el portal y **imprimir los cupones** de cada urna para el sorteo.

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

Todos los números de esta tabla se cambian en la hoja **Configuracion** (y las fechas en **Periodos**).

| Regla | Cómo se calcula |
|---|---|
| **Cupones** | `cupones = piso(total vendido acumulado ÷ monto_por_cupon)`. Con $1.500: $4.600 = 3 cupones. El sobrante nunca se pierde. |
| **Semanas y cortes** | 10 semanas desde el **jueves 15/10/2026**. Cada semana va de **jueves a miércoles**; el **corte** es el jueves siguiente a las **3:00 p. m.** y los premios se entregan el **viernes en la mañana**. El corte final es el jueves 24/12/2026 a las 3:00 p. m. |
| **Semana de una venta** | La define el **día de la venta** (no el día en que se cargó). Hasta el corte del jueves se pueden cargar las ventas del miércoles. Después del corte, esa semana queda cerrada (`bloquear_semanas_cerradas = SI`). |
| **Cupones de la semana** | Los cupones que el vendedor **completó** esa semana: `piso(acumulado al cierre ÷ M) − piso(acumulado al cierre de la semana anterior ÷ M)`. Lo que sobra pasa a la semana siguiente. |
| **Ejemplo** | Semana 1 vende $4.000 → 2 cupones, sobran $1.000. Semana 2 vende $600 → $1.000 + $600 completan 1 cupón; sobran $100. |
| **Premios semanales** | Los `premios_semanales` (6) vendedores con más cupones completados en la semana. Desempate: mayor venta de la semana → mayor acumulado al cierre → quien llegó primero. Con 0 cupones esa semana no se califica. |
| **Categorías** | Al corte final, quienes tienen cupones quedan en 3 categorías. Por defecto: **Oro** = el 20 % con más cupones, **Plata** = el 30 % siguiente, **Bronce** = el resto. Si hay empate en el límite, se sube a la categoría mayor. También se puede usar por cupones mínimos (`categorias_modo = cupones`). Durante el concurso la categoría es **provisional** ("Plata · hoy"). |
| **Sorteo final por categoría** | Cada categoría sortea sus premios **solo entre sus cupones**: 2 premios en Oro (los buenos), 1 en Plata y 1 en Bronce. |
| **Viaje todo incluido** | Cada **100 m² de Austral** = **1 cupón del viaje** (el sobrante de m² también se acumula). Solo entran a la urna del viaje los cupones de los vendedores de **Oro** (`viaje_hasta_categoria = 1`). |

Todo se recalcula desde la hoja **Registros** en cada consulta. No hay contadores guardados: si apruebas, rechazas o corriges una factura, los cupones, las categorías y las urnas se ajustan solos.

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
3. `setup()` crea las hojas **Configuracion**, **Periodos**, **Registros**, **Usuarios** y **Ranking**, con sus formatos y listas desplegables. También crea en tu Drive la carpeta **"Copa Prosein · Fotos de facturas"**. Puedes correrlo otra vez sin perder datos.
4. Recarga el Sheet: aparecerá el menú **Copa Prosein**.

### 4. Revisar la hoja Configuracion

Cada fila tiene su explicación en la columna **descripción**. Las más importantes:

| clave | valor inicial | qué es |
|---|---|---|
| `fecha_inicio` | 15/10/2026 | Primer día del concurso (jueves). |
| `num_semanas` | 10 | Cantidad de semanas (cortes). |
| `dias_por_semana` | 7 | De jueves a miércoles. |
| `hora_corte` | 15:00 | Hora del corte, el día siguiente al último día de la semana. |
| `texto_entrega` | en la mañana | Se muestra junto a la fecha de entrega de premios. |
| `bloquear_semanas_cerradas` | SI | Después del corte ya no se cargan ventas con fecha de esa semana. |
| `fecha_sorteo` | (vacío) | Fecha del sorteo final, informativa. |
| `monto_por_cupon` | 1500 | Monto que completa 1 cupón. |
| `premios_semanales` | 6 | Ganadores por semana. |
| `m2_por_cupon_austral` | 100 | m² de Austral que completan 1 cupón del viaje. |
| `sucursales` | Boleíta, La Castellana, Los Naranjos, El Bosque, Las Mercedes, San Martín, Maracaibo, Acarigua, Barquisimeto | Tiendas para elegir al registrarse, separadas por coma. |
| `categorias_modo` | porcentaje | `porcentaje` o `cupones`. |
| `categoria_1_nombre` … `categoria_3_nombre` | Oro, Plata, Bronce | Nombres visibles. |
| `categoria_1_porcentaje` / `categoria_2_porcentaje` | 20 / 30 | Modo porcentaje (el resto queda en la 3). |
| `categoria_1_min_cupones` / `categoria_2_min_cupones` | 30 / 10 | Modo cupones. |
| `premios_categoria_1` … `premios_categoria_3` | 2 / 1 / 1 | Premios que sortea cada categoría. |
| `premios_viaje` | 1 | Viajes que se sortean con los cupones Austral. |
| `viaje_hasta_categoria` | 1 | 1 = solo Oro entra al viaje; 2 = Oro y Plata. |
| `concurso_abierto` | SI | Con NO nadie puede cargar ventas. |
| `contar_solo_aprobadas` | NO | NO = las facturas suman al cargarlas (puedes rechazarlas después). SI = solo suman al aprobarlas. |
| `mostrar_ranking_publico` | SI | Los vendedores ven el top 10, sin cédulas. |
| `token_api` | copaprosein | Igual que `API_TOKEN` en `web/config.js`. |

Otras claves: `nombre_concurso`, `moneda`, `carpeta_fotos_id` (la crea `setup()`), `semana_ranking`, `dias_sesion`, `monto_maximo_venta`.

### 4b. Revisar la hoja Periodos (semanas y cortes)

`setup()` llena **Periodos** con una fila por semana: `semana`, `inicio`, `fin`, `corte` (fecha y hora) y `entrega`. La semana 1 queda del jueves 15/10 al miércoles 21/10, corte el jueves 22/10 a las 3:00 p. m. y entrega el viernes 23/10.

- Puedes **editar cualquier fila a mano** (por ejemplo, mover un corte por un feriado). El portal usa lo que diga esta hoja.
- Si cambias `fecha_inicio`, `num_semanas`, `dias_por_semana` u `hora_corte`, usa el menú **Copa Prosein → Generar periodos** para recalcular todas las filas (borra los cambios hechos a mano).
- La semana 10 entrega premios el **viernes 25/12**. Si ese día no se entrega, cambia la celda `entrega` de la semana 10.

### 4c. Crear el usuario administrador

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

Comparte la dirección con los vendedores. Desde el celular pueden usar **"Agregar a la pantalla de inicio"** para tenerla como una app.

---

## Administración del concurso

### Panel del administrador (en el portal)

Es de **solo lectura**: sirve para auditar sin tocar el Sheet.

| Pestaña | Qué muestra |
|---|---|
| **Resumen** | Semana en juego, corte y entrega; vendedores, facturas (pendientes y rechazadas), monto, cupones, m² Austral y cupones del viaje; las 3 categorías con su rango de cupones; totales por tienda. |
| **Vendedores** | Todos los vendedores con tienda, categoría, cupones, vendido, m² y cupones del viaje (y si entran o no al viaje). Búsqueda, filtros y descarga **CSV**. |
| **Ventas** | Todas las facturas con su estado, semana y foto. Filtros por estado, semana y tienda; descarga **CSV**. |
| **Semanas** | Las 10 semanas con su corte y estado; los ganadores de cada semana, con aviso si hay empate exacto en el último puesto. |
| **Sorteo** | Las 4 urnas (Oro, Plata, Bronce y Viaje) con sus cupones, y los botones para **imprimirlos**. |

### Imprimir los cupones para las urnas

En **Sorteo → Imprimir** se abre `cupones.html`:

- Papel **carta**, **24 cupones por hoja** (3 × 8) con líneas punteadas para recortar. Cada urna empieza en una hoja nueva.
- Cada cupón lleva su código único dentro de la urna (`C1-0001` para Oro, `C2-…` Plata, `C3-…` Bronce, `V-0001` viaje), el nombre, la cédula, la tienda y la factura que lo completó.
- Los cupones del **viaje** llevan una **banda negra** para no mezclarlos. En el diálogo de impresión activa **"Gráficos de fondo"** y usa **escala 100 %**.
- Antes del corte final las hojas salen marcadas **PROVISIONAL** (las categorías todavía pueden cambiar). Imprime después del corte del jueves 24/12.

La misma lista queda en la hoja **Ranking** con el menú **Generar cupones para sorteo**, para verificar un código cuando salga.

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
- **Cambio de tienda:** edita `sucursal_o_zona` (usa un nombre de la lista `sucursales`). Las cuentas creadas sin tienda la eligen la próxima vez que entran.

### Menú "Copa Prosein"

| Opción | Qué hace |
|---|---|
| **Inicializar hojas** | Corre `setup()` (no borra datos). |
| **Generar periodos (semanas y cortes)** | Recalcula la hoja Periodos desde Configuracion. |
| **Recalcular rankings** | Reescribe la hoja Ranking: general (con categoría), viaje Austral, semana y urnas. |
| **Generar cupones para sorteo** | Lista de cada urna con su código (`C1-0001`, `V-0001`…), cédula, vendedor y factura. |
| **Ganadores semanales (elegir semana)** | Pide el número de semana y muestra los ganadores. Avisa si hay empate exacto en el último puesto premiado. |
| **Resumen del sorteo final** | Cuántos vendedores y cupones hay en cada categoría y en la urna del viaje. |
| **Cargar / Borrar datos de prueba** | 8 vendedores de prueba (cédulas 90000001–90000008, contraseña `prueba123`) con ventas. Bórralos antes de empezar. |

> **Premios semanales:** después del corte del jueves a las 3:00 p. m. corre "Ganadores semanales" (o mira la pestaña Semanas del panel) y guarda el resultado para la entrega del viernes.

### Sorteo final

1. Después del corte final (jueves 24/12, 3:00 p. m.) pon `concurso_abierto = NO` y revisa las facturas pendientes.
2. En el panel: **Sorteo → Imprimir todos**. Recorta y pon cada grupo en su urna: Oro, Plata, Bronce y Viaje.
3. Saca los premios de cada urna (2 en Oro, 1 en Plata, 1 en Bronce) y el viaje de la urna del viaje.
4. Verifica cada código en la hoja Ranking (menú **Generar cupones para sorteo**) o en el panel.

---

## Seguridad

- Las contraseñas se guardan con **hash SHA-256 + salt** por usuario, repetido 300 veces. Nunca en texto.
- Cada solicitud lleva la clave del portal (`token_api`). Sin ella, el Web App no responde. Es un filtro contra llamadas de afuera, no una contraseña: la clave queda visible en el código del sitio. La protección real es el login de cada vendedor.
- La sesión de cada vendedor es un token aleatorio que **vence** (7 días). En el servidor se guarda solo un hash del token.
- Cada acción usa **la cédula del token**, nunca una cédula enviada por el navegador.
- 5 intentos fallidos → bloqueo de 15 minutos.
- Todo se valida en el servidor: fechas dentro del concurso y no futuras, montos, m² obligatorios si vendió Austral, y que la foto sea realmente una imagen.
- Los textos que empiezan con `=`, `+`, `-` o `@` se guardan como texto (evita fórmulas maliciosas en el Sheet).
- Las escrituras usan `LockService` para que dos ventas simultáneas no se pisen.
- Las fotos quedan **privadas** en tu Drive. El vendedor ve solo las suyas a través del portal; el administrador puede ver todas desde el panel. También las abres desde la columna `url_foto`.
- El rol de administrador solo se asigna a mano en la hoja (`rol = admin`). Las acciones del panel verifican el rol en el servidor: un vendedor no puede pedir esos datos.

---

## Personalizar

- **Colores:** bloque `:root` al inicio de [`web/styles.css`](web/styles.css). Ya tiene los de prosein.com.ve: rojo `#DF1630`, carbón `#303133`, tipografía Poppins.
- **Textos de las reglas:** se arman con los valores de Configuracion (monto por cupón, premios semanales, fecha del sorteo).
- **Compresión de fotos:** `FOTO_LADO_MAX` y `FOTO_CALIDAD` en `web/config.js`.

---

## Actualizar desde la primera versión

Si ya tenías el Sheet de la versión anterior (con `fecha_inicio` 08/10/2026):

1. Pega el nuevo [`apps-script/Code.gs`](apps-script/Code.gs) y guarda.
2. Ejecuta **`setup()`**: agrega las claves nuevas de Configuracion, la hoja **Periodos** y la columna **`rol`** en Usuarios, sin borrar datos. La fila `fecha_fin` queda marcada como "YA NO SE USA".
3. En Configuracion pon **`fecha_inicio` = 15/10/2026**.
4. Menú **Copa Prosein → Generar periodos**.
5. **Implementar → Administrar implementaciones → Editar → Versión: Nueva versión → Implementar** (la URL no cambia).
6. Agrega tu fila de administrador en Usuarios (paso 4c).

Los vendedores que se registraron sin tienda la eligen la próxima vez que entran.

---

## Probar en tu computadora (opcional, para desarrolladores)

Requiere [Node.js](https://nodejs.org) 18 o superior. No hace falta instalar nada más.

```bash
npm test          # 37 pruebas del backend (cupones, cortes, categorías, urnas, admin, sesiones…)
npm run dev       # portal en http://localhost:5173 con datos de prueba y un administrador
```

`npm run dev` corre el mismo `Code.gs` sobre un simulador de Google Sheets, así que puedes probar todo el flujo sin desplegar. El administrador de prueba es la cédula `11111111` con contraseña `admin123`. Opciones: `--solo-aprobadas`, `--sin-ranking`, `--sin-bloqueo`, `--dia=-3` (el concurso empieza en 3 días), `--latencia=800`.

Con [Playwright](https://playwright.dev) instalado, `node dev/e2e.js capturas/` recorre el portal (registro con tienda, ventas, tickets normales y del viaje, ver y descargar cupones, tienda faltante, panel del administrador, cupones para imprimir en PDF y movimiento reducido) y guarda capturas.
