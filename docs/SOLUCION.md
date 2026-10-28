# Solución: login, protección del API y gestión de mesas

Esta rama añade autenticación con sesiones, protege en el servidor todos los endpoints de mesas,
implementa listar/crear/cambiar estado, conecta la interfaz y suma pruebas. También corrige los
defectos del código inicial (sección 6).

## 1. Puesta en marcha desde cero (sin Docker)

Requisitos: Git, Node.js 22.13 o superior y PostgreSQL 17 (también funciona 16).

```sql
-- Como administrador de PostgreSQL, cada sentencia por separado y con autocommit:
CREATE ROLE reservet_candidate LOGIN PASSWORD 'local_candidate_password';
CREATE DATABASE reservet_candidate OWNER reservet_candidate;
CREATE DATABASE reservet_candidate_test OWNER reservet_candidate;
```

```powershell
npm ci
Copy-Item .env.example .env        # ajusta puertos y contraseñas a tu instalación
npm run db:migrate                 # crea tablas; se puede repetir sin efectos
npm run db:seed                    # crea el usuario de prueba (lee SEED_USERNAME y SEED_PASSWORD de .env)
npm run dev                        # http://localhost:3000
```

Abre http://localhost:3000, elige **Mi API local** en «Fuente» e inicia sesión con el usuario del
seed. Repetir `npm run db:seed` cambia la contraseña de ese usuario y cierra sus sesiones.
Las credenciales del seed son solo locales: elige una contraseña propia en tu `.env`, que no se sube a Git.

### Variables de entorno (`.env.example`)

| Variable            | Para qué sirve                                                                 |
| ------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`      | Base de trabajo.                                                               |
| `TEST_DATABASE_URL` | Base exclusiva de pruebas. Debe terminar en `_test` o las pruebas no arrancan. |
| `SESSION_TTL_HOURS` | Duración de la sesión (por defecto 8; entre 0 y 720).                          |
| `COOKIE_SECURE`     | `true`/`false`. Por defecto `true` con `APP_ENV=pro` y `false` en desarrollo.  |
| `SEED_USERNAME`     | Usuario que crea `npm run db:seed`.                                            |
| `SEED_PASSWORD`     | Su contraseña (8 a 128 caracteres).                                            |

## 2. Pruebas

```powershell
npm run check     # lint + formato + tipos + todas las pruebas + compilación
npm test          # solo las pruebas
```

| Archivo                                              | Qué comprueba                                                        | Qué está simulado      |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ---------------------- |
| `tests/api.integration.test.js`                      | HTTP completo contra **PostgreSQL real** (login, 401, logout, mesas) | Nada                   |
| `tests/auth.unit.test.js`                            | Servicio de sesiones, cookies y limitador de intentos                | Repositorio en memoria |
| `tests/tables.service.test.js`                       | Validaciones, 409 por duplicado, 404                                 | Repositorio en memoria |
| `tests/password.test.js`                             | Hash scrypt y verificación                                           | Nada                   |
| `tests/ui-auth.test.js`                              | Interfaz: demo corregida, login, 401, logout                         | `fetch` y DOM (JSDOM)  |
| `tests/i18n.test.js`                                 | Persistencia del idioma, mismas claves en es/en/ru                   | `localStorage`         |
| `tests/http.test.js`, `config.test.js`, `ui.test.js` | Las originales, sin desactivar ninguna                               | Como antes             |

**Base de pruebas.** Crea `reservet_candidate_test` (sección 1), pon su URL en `TEST_DATABASE_URL`
y ejecuta `npm test`: las pruebas de integración aplican las migraciones solas y vacían las tablas
de **esa** base antes de cada caso. Si `TEST_DATABASE_URL` no está definida se omiten con un aviso
visible (la CI sí la define). Nunca apuntan a tu base de trabajo.

## 3. API

| Método y ruta                  | Sesión | Resultado                                                          |
| ------------------------------ | ------ | ------------------------------------------------------------------ |
| `POST /api/auth/login`         | No     | 200 `{ user }` + cookie · 400 cuerpo inválido · 401 genérico · 429 |
| `POST /api/auth/logout`        | No     | 204, revoca la sesión y borra la cookie (se puede repetir)         |
| `GET /api/auth/me`             | Sí     | 200 `{ user }` · 401                                               |
| `GET /api/tables`              | Sí     | 200 y array de mesas                                               |
| `POST /api/tables`             | Sí     | 201 y mesa `available` · 400 inválido · 409 nombre duplicado       |
| `PATCH /api/tables/:id/status` | Sí     | 200 y mesa completa · 400 ID/estado inválido · 404 inexistente     |

Sin sesión válida, las rutas de mesas responden **401** aunque se llamen sin la interfaz.
`/health` y `/health/db` siguen públicas y no revelan secretos. Los errores usan
`{ code, message, requestId }`, sin SQL ni stacks.

## 4. Flujo: login → petición autenticada → servicio → PostgreSQL

1. **Login.** El navegador envía `POST /api/auth/login`. `AuthService` busca el usuario
   (`lower(username)`), verifica la contraseña con scrypt en tiempo constante y, si es correcta,
   genera un token aleatorio de 32 bytes. En la tabla `sessions` se guarda **solo su SHA-256**.
   El servidor responde con la cookie `reservet_sid` (`HttpOnly`, `SameSite=Lax`, `Path=/`,
   `Max-Age` y `Secure` en producción). El JavaScript de la página nunca ve el token.
2. **Petición autenticada.** El navegador reenvía la cookie sola. `requireAuth` calcula el hash del
   token y busca una sesión no caducada (`expires_at > now()`) con su usuario. Si no existe: 401.
3. **Servicio.** `tables.routes.ts` solo traduce HTTP. `TablesService` valida nombre (1–80 caracteres,
   sin control), capacidad (entero 1–20), estado e ID, y traduce el error `23505` a 409.
4. **PostgreSQL.** `PgTablesRepository` ejecuta SQL parametrizado (`$1`, `$2`). El índice único
   `lower(btrim(name))` es la defensa final contra duplicados, incluso con peticiones simultáneas.
5. **Logout.** Borra la fila de `sessions`: el token deja de valer al instante, aunque alguien
   hubiera copiado la cookie.

## 5. Decisiones

- **Sesión en base de datos en vez de JWT.** La interfaz y la API comparten origen, así que la
  cookie es lo más simple y segura. Con JWT no se puede revocar al salir sin mantener igualmente
  una lista en el servidor. Coste: una consulta por petición, aceptable aquí.
- **Caducidad:** 8 horas fijas desde el login (configurable, no se renueva con el uso). Las sesiones
  vencidas se ignoran siempre y se limpian en cada login.
- **Revocación:** `logout` borra la sesión; un nuevo login con la cookie anterior revoca la previa.
  Volver a ejecutar el seed cierra las sesiones de ese usuario.
- **Contraseñas:** scrypt de `node:crypto` (N=16384, r=8, p=1), sal por usuario, parámetros dentro del
  hash para poder subirlos sin invalidar cuentas. Si el usuario no existe se hace igualmente un hash
  falso, para que el tiempo de respuesta no revele qué usuarios existen. Login incorrecto: 401 con
  mensaje genérico idéntico en ambos casos.
- **CSRF:** `SameSite=Lax` más rechazo (403) de peticiones que cambian datos con un `Origin` distinto
  del `Host`. Solo se aceptan cuerpos JSON.
- **Fuerza bruta:** 10 fallos por IP+usuario en 15 minutos dan 429 con `Retry-After`. Vive en memoria
  (una sola instancia). Con varias instancias habría que moverlo a la base de datos o al proxy.
- **Cookie `Secure`:** activa con `APP_ENV=pro` (el túnel termina TLS); en desarrollo se usa HTTP.
- **Sin dependencias nuevas:** cookies, hashing y límite de intentos se hicieron con Node estándar, así
  que `package.json` y `package-lock.json` no cambian de dependencias.
- **Migraciones nuevas, ninguna editada:** `002` (nombre único sin distinguir mayúsculas) y `003`
  (usuarios y sesiones).
- **Modo demo intacto:** sigue sin login ni base de datos. El modo API nunca se rellena con datos
  falsos: si la API falla, el error se muestra.

## 6. Registro de problemas del código inicial

| #   | Síntoma                                            | Reproducción                           | Causa                                                                                  | Corrección                                           | Prueba de regresión                          |
| --- | -------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| 1   | El idioma vuelve a español al recargar             | Elegir English y recargar la página    | `i18n.js` guardaba en `reservet.language` pero leía `reservet.lang`                    | Una constante `STORAGE_KEY` para leer y escribir     | `tests/i18n.test.js` (falla con el original) |
| 2   | No se puede crear una mesa de capacidad 20         | Nueva mesa, capacidad 20               | El navegador validaba `capacity >= 20`; el contrato permite 1–20                       | `capacity > 20`                                      | `tests/ui-auth.test.js`; integración 1 y 20  |
| 3   | La búsqueda distingue mayúsculas                   | Buscar `TERRAZA` en lugar de `terraza` | El texto buscado no se pasaba a minúsculas, solo el nombre                             | `toLocaleLowerCase(locale())` en la búsqueda         | `tests/ui-auth.test.js`                      |
| 4   | `.env` está versionado; falta `.env.example`       | `git ls-files .env`                    | El archivo se subió pese al `.gitignore`; el README y `config.ts` citan `.env.example` | `git rm --cached .env` y se crea `.env.example`      | Revisión del diff (ver nota)                 |
| 5   | «Mesa 1» y «mesa 1» conviven; también con espacios | Crear ambas                            | El `UNIQUE` original distingue mayúsculas y espacios                                   | Migración 002: índice en `lower(btrim(name))`        | `tests/api.integration.test.js` (409)        |
| 6   | Un ID enorme provocaría un 500                     | `PATCH /api/tables/99999999999/status` | `integer` de PostgreSQL desborda (`22003`) y no se validaba                            | ID entero positivo ≤ 2147483647, si no 400           | `tests/tables.service.test.js`, integración  |
| 7   | Duplicado en demo distingue mayúsculas             | Crear «mesa 01» en demo                | Comparación exacta de cadenas, distinta a la de la base                                | Comparación en minúsculas                            | `tests/ui-auth.test.js`                      |
| 8   | Un 401/400/429 se muestra como «HTTP n»            | Cualquier error de la API en modo API  | `request()` solo distinguía 404 y 409                                                  | Mapa de códigos y manejo del 401 → pantalla de login | `tests/ui-auth.test.js`                      |

Nota del #4: el `.env` original sigue en el historial de Git. Contenía solo credenciales locales de
demostración, pero cámbialas si las usaste en algún otro sitio.

## 7. Uso de IA

Herramienta: **Claude (Anthropic)**. Se usó para revisar el código inicial, proponer la arquitectura,
escribir la implementación (backend, interfaz, migraciones, pruebas, CI y esta documentación) y
verificarla en un entorno aislado. Los límites de ese entorno están en la sección 8.

> **Completa tú antes de entregar** (el README lo pide con tus palabras):
>
> - Qué partes revisaste y cómo las verificaste (por ejemplo, ejecutar `npm run check`, probar el
>   login a mano, mirar la tabla `sessions` con `psql`).
> - Una sugerencia de la IA que corregiste o descartaste y por qué. Si no ocurrió, una decisión que
>   contrastaste con documentación o pruebas (por ejemplo, la comparación sesión vs. JWT o los
>   parámetros de scrypt).

## 8. Estado de verificación, limitaciones y pendientes

**Verificado en el entorno de desarrollo de la solución:**

- Las tres migraciones se aplican en PostgreSQL 16 y las consultas SQL del repositorio se ejecutaron
  contra esa base: login sin distinguir mayúsculas, sesión caducada, `ON CONFLICT` del seed,
  duplicados con `23505`, `CHECK` de capacidad y borrado en cascada de sesiones.
- 22 pruebas unitarias (hash, sesiones, cookies, limitador, validaciones de mesas e idioma) pasan.
- La interfaz se probó en Chromium contra un servidor falso que imita el contrato: demo, 401 →
  login, credenciales incorrectas, login, crear con capacidad 20, duplicado, cambio de estado,
  logout y persistencia del idioma. Sin errores de JavaScript.

**No se pudo ejecutar allí** (no había acceso al registro de npm, así que no estaban instaladas
`express`, `pg`, `helmet` ni `jsdom`): `npm run check` completo, la capa HTTP de Express contra la base
real (`tests/api.integration.test.js`) y `tests/ui-auth.test.js` con JSDOM. Están escritas contra el
contrato descrito, pero **hay que ejecutarlas y corregir lo que falle antes de entregar**.

**Pendientes y límites conocidos:**

- El limitador de intentos es por instancia y en memoria. Detrás de un proxy, todas las peticiones
  comparten IP; si se despliega así, configura `trust proxy` o límite en el proxy.
- No hay roles, registro público ni recuperación de contraseña (fuera de alcance).
- El despliegue (Docker, Cloudflare) no se tocó. En el contenedor, el seed se ejecuta con
  `node build/scripts/seed-user.js`.
