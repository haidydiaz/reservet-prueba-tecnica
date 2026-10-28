# Reservet · Prueba técnica junior

**Español** · [English](README.en.md) · [Русский](README.ru.md)

Completa una aplicación para el personal de un restaurante: **login, gestión de
mesas y persistencia en PostgreSQL**. Trabaja localmente, publica la solución en
**tu propio GitHub** y entrega la URL con instrucciones reproducibles.

> **Solución del candidato:** login con sesiones, API de mesas protegida, interfaz conectada y
> pruebas. Instalación, variables, seed, pruebas, decisiones, registro de problemas y uso de IA:
> [docs/SOLUCION.md](docs/SOLUCION.md). Arranque rápido: `npm ci`, copiar `.env.example` a `.env`,
> `npm run db:migrate`, `npm run db:seed`, `npm run dev`.

Este README define el alcance obligatorio. El plazo lo comunica el evaluador;
documenta cualquier tarea incompleta. Las etapas adicionales de las guías no
forman parte de esta prueba.

## 1. Punto de partida y alcance

Incluido: TypeScript/Express, conexión y migraciones PostgreSQL, esquema de mesas,
interfaz en español/inglés/ruso con modo demo/API y pruebas básicas.

Debes implementar autenticación, proteger los endpoints de mesas, listar/crear/
cambiar estados, conectar la interfaz, añadir pruebas y documentar tu solución.
El login todavía no existe: debes construirlo.

**No se requiere Docker, AWS/SQS, Cloudflare, runner, dominios ni deployment.**
Tampoco reservas, pagos, inventario o recuperación de contraseña. La infraestructura
del repositorio original la administra el evaluador, no el candidato.

## 2. Tu repositorio

Crea un repositorio vacío en tu GitHub, sin generar otro README. Conserva el
historial del proyecto y cambia el destino de tus pushes:

```powershell
git clone https://github.com/Eddierh/reservet.git reservet-prueba
cd reservet-prueba
git remote rename origin upstream
git remote add origin https://github.com/TU_USUARIO/reservet-prueba-tecnica.git
git push -u origin main
git switch -c feat/technical-test
```

Sustituye `TU_USUARIO` y el nombre por los tuyos. Haz commits pequeños en tu rama.
No envíes cambios ni PR al repositorio original. Si tu repo es privado, concede
acceso al evaluador antes de entregar.

## 3. Preparación local sin Docker

Instala Git, Node.js **22.13 o superior compatible con las dependencias** y
PostgreSQL **17** directamente en tu equipo. Comprueba `git --version`,
`node --version`, `npm --version` y `psql --version`. Si `psql` no está en PATH,
usa SQL Shell o la herramienta de consultas de pgAdmin.

Conéctate a tu PostgreSQL como administrador y ejecuta estas sentencias **por
separado**, con autocommit activado; CREATE DATABASE no admite una transacción:

```sql
CREATE ROLE reservet_candidate LOGIN PASSWORD 'local_candidate_password';
CREATE DATABASE reservet_candidate OWNER reservet_candidate;
CREATE DATABASE reservet_candidate_test OWNER reservet_candidate;
```

Usa nombres diferentes si ya existen. El usuario de la app no necesita ser
superusuario. La base `_test` es exclusiva para pruebas. No te conectes a las
bases dev/pro del proyecto original.

```powershell
npm ci
# Solo si aún no existe .env:
Copy-Item .env.example .env
```

Ajusta `.env` a tu instalación:

```dotenv
PORT=3000
DATABASE_URL=postgresql://reservet_candidate:local_candidate_password@localhost:5432/reservet_candidate
```

El ejemplo original usa **5433** para Docker; una instalación directa suele usar
**5432**. Usa tu puerto real y codifica los caracteres especiales de la contraseña
para una URL. No subas `.env` ni credenciales reales.

```powershell
npm run db:migrate
npm run dev
```

Abre **http://localhost:3000** y, en otra terminal, comprueba:

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/health/db
```

Espera `status: ok` y `database: connected`. Selecciona **Mi API local** para
probar tu backend. Inicialmente `/api/tables` devuelve 404: debes implementarlo.
El modo demo solo guarda en memoria y no demuestra persistencia. No uses
`npm run db:up` ni `npm run db:down`: son comandos para Docker.

## 4. Tareas obligatorias

### A. Autenticación

- Agrega migraciones de usuarios y un seed o procedimiento repetible para crear
  un usuario de prueba. No incluyas contraseñas reales en Git.
- Implementa login, logout y consulta de sesión actual. Puedes elegir sesión o
  token: explica tu decisión, caducidad y comportamiento de revocación al salir.
- Guarda contraseñas con scrypt, bcrypt o Argon2; nunca en texto plano ni con
  SHA-256 simple. Login incorrecto: 401 y mensaje genérico.
- Protege en el **servidor** todos los endpoints de mesas: sin autenticación deben
  responder 401. Ocultar botones no es protección suficiente.
- Crea la pantalla de login y la acción de salir; conserva los tres idiomas y
  el selector. No se exige registro público, correo ni roles avanzados.
- Documenta nuevas variables con ejemplos en `.env.example`. Las rutas de salud
  pueden seguir públicas, sin revelar secretos.

### B. API de mesas

| Método y ruta                  | Entrada                               | Resultado                                |
| ------------------------------ | ------------------------------------- | ---------------------------------------- |
| `GET /api/tables`              | Sin cuerpo                            | 200 y array de mesas                     |
| `POST /api/tables`             | `{ "name": "Mesa 1", "capacity": 4 }` | 201 y mesa creada con estado `available` |
| `PATCH /api/tables/:id/status` | `{ "status": "occupied" }`            | 200 y mesa completa actualizada          |

Cada mesa incluye `id` entero positivo, `name`, `capacity` entera y `status`.
Valida nombre no vacío de hasta 80 caracteres, capacidad de **1 a 20**, ID
positivo y estados `available`, `occupied`, `out_of_service`.

Datos inválidos: **400**; mesa inexistente: **404**; nombre duplicado: **409**;
sin autenticación: **401**. Usa SQL parametrizado y restricciones de base de datos.
No devuelvas consultas, contraseñas ni stacks al cliente.

### C. Arquitectura e interfaz

- Divide el módulo en rutas, servicio y repositorio; separa HTTP, negocio y SQL.
- Agrega migraciones nuevas, sin modificar las ya aplicadas. La solución debe
  funcionar con una base vacía y los comandos documentados, sin cambios ocultos.
- Conecta el listado, formulario, filtros y cambio de estado de la interfaz.
  Muestra carga y errores, evita envíos repetidos e inserta texto externo de
  forma segura. Valida en servidor aunque el navegador ya valide.
- Comprueba que las mesas del modo API sobreviven a recargar y reiniciar el
  servidor. El modo demo no debe ocultar errores de tu backend.
- Si usas cookies, conserva el mismo origen y documenta sus opciones de seguridad.
- La búsqueda debe ignorar mayúsculas/minúsculas y el idioma elegido debe
  conservarse al recargar.

### D. Pruebas y calidad

Incluye pruebas de login correcto/incorrecto, acceso sin sesión, logout según tu
mecanismo, crear/listar/cambiar estado, validaciones, duplicados y mesa inexistente.
Comprueba persistencia contra la base `_test`, nunca borrando datos de trabajo.

Las pruebas incluidas usan mocks/JSDOM y no cubren tu backend de negocio.
Documenta cómo configurar y migrar la base de pruebas, sus comandos y qué está
simulado. Si necesitas `TEST_DATABASE_URL`, explícalo y prepara una base temporal
para las pruebas de integración en tu CI. No desactives comprobaciones existentes.

```powershell
npm run format
npm run check
```

`check` ejecuta lint, formato, tipos, pruebas y compilación. **Verificaciones** debe
pasar en tu GitHub. El deployment está reservado al repositorio original y se
omite en las copias: no necesitas instalar un runner.

## 5. Orden de trabajo y publicación

1. Prepara PostgreSQL y comprueba `/health/db`.
2. Implementa y prueba mesas en tu rama.
3. Agrega usuarios, seed, login y protección del módulo.
4. Conecta la interfaz, verifica los tres idiomas y completa pruebas.
5. Ejecuta las verificaciones y prueba tus instrucciones desde cero.
6. Sube tu rama, abre un PR **en tu propio repo**, revísalo e intégralo a su rama
   por defecto para que la solución final sea fácil de encontrar.

```powershell
git add <archivos-de-tu-cambio>
git commit -m "feat: describe el cambio implementado"
git push -u origin feat/technical-test
```

## 6. Evaluación

### Uso de IA y explicación de la entrega

- **Puedes usar IA para programar, investigar, depurar y escribir pruebas.**
  Indica las herramientas utilizadas y en qué partes te ayudaron.
- Eres responsable de comprender, revisar y verificar todo el código entregado,
  también el generado. No compartas secretos ni datos personales con herramientas.
- Incluye una explicación escrita del flujo login → petición autenticada →
  servicio → PostgreSQL, de tus decisiones y de cómo verificaste el resultado.
- Describe una sugerencia de IA que corregiste o descartaste y por qué. Si no
  ocurrió, explica una decisión que contrastaste con documentación o pruebas.
- No pedimos el historial completo de conversaciones. Un vídeo explicativo es
  opcional; **no habrá ejercicios de programación ni cambios en vivo con el evaluador**.

### Revisión del código inicial

El código entregado es un punto de partida y puede contener defectos funcionales.
Revisarlo y corregir lo que detectes forma parte de la prueba. Las comprobaciones
incluidas no garantizan que todos los comportamientos sean correctos: amplía las
pruebas sin desactivar las existentes.

No te limites al caso feliz: revisa límites, errores y comportamientos después de
recargar. Para cada problema encontrado, documenta **síntoma, reproducción, causa,
corrección y prueba de regresión**.
No basta con afirmar que una IA lo arregló: explica la causa y la evidencia.

### Criterios

| Criterio       | Evidencia                                                                   |
| -------------- | --------------------------------------------------------------------------- |
| Funcionamiento | Login y mesas con PostgreSQL real                                           |
| Diseño         | Responsabilidades claras y decisiones explicadas                            |
| Seguridad      | Hash de contraseñas, protección del backend, validación y SQL parametrizado |
| Pruebas        | Casos correctos, errores y persistencia reproducibles                       |
| Entrega        | Commits comprensibles, CI correcta e instrucciones completas                |

Debes poder explicar tu código y las herramientas o ayudas utilizadas. Reservas,
SQS, microservicios y deployment no son requisitos ni sustituyen tareas obligatorias.

## 7. Entrega al evaluador

Envía por el mismo canal en que recibiste la prueba:

- **URL de tu repositorio**, accesible al evaluador, rama final y SHA a revisar.
- URL del PR de tu repo y de una ejecución correcta de CI.
- Un README con instalación, PostgreSQL, variables, migraciones, seed, arranque
  y comandos para todas las pruebas.
- Credenciales **solo de demostración local**, o el procedimiento para generarlas;
  nunca claves personales ni secretos de otros ambientes.
- Decisiones, pendientes y limitaciones. Capturas o vídeo son opcionales y no
  sustituyen código e instrucciones.
- Una sección de uso de IA y un registro de problemas encontrados con su explicación
  y las pruebas que añadiste.

```text
Repositorio: https://github.com/TU_USUARIO/reservet-prueba-tecnica
Rama final y commit:
Pull request:
CI:
Instrucciones de ejecución: sección de mi README
Usuario de prueba: procedimiento de seed documentado
Completado / pendiente:
```

Antes de entregar, clona tu repo en otra carpeta y sigue tus propias instrucciones.
La revisión no debe depender de tu `.env`, archivos fuera del repo o acceso a nuestra PC.

## Referencias y administración

[Arquitectura](docs/ARQUITECTURA.md) · [Contribución](CONTRIBUTING.md) ·
[Guía de aprendizaje](docs/GUIA_JUNIOR.md).
Las etapas de reservas/SQS son formación futura. Algunas guías históricas usan
Docker: para esta prueba sigue la preparación local de este README.
La [guía de deployment para tus proyectos](docs/DEPLOYMENT.md) es aprendizaje
opcional: usa tus propios recursos y no forma parte de la entrega.
