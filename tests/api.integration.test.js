// Carga .env para que TEST_DATABASE_URL también funcione sin exportarla a mano.
import 'dotenv/config';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';

// Pruebas de integración con PostgreSQL REAL (nada de mocks): login, sesión, mesas y persistencia.
// Necesitan TEST_DATABASE_URL apuntando a una base cuyo nombre termine en _test. Ver docs/SOLUCION.md.
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  test(
    'integración con PostgreSQL',
    { skip: 'Define TEST_DATABASE_URL (base _test) para ejecutarlas.' },
    () => {},
  );
} else {
  await defineSuite(testUrl);
}

async function defineSuite(databaseUrl) {
  // Seguridad: estas pruebas vacían tablas. Se niegan a correr contra cualquier base de trabajo.
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL debe apuntar a una base terminada en _test (recibida: ${databaseName}).`,
    );
  }
  process.env.DATABASE_URL = databaseUrl;
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const { createApp } = await import('../src/app.ts');
  const { pool } = await import('../src/shared/database.ts');
  const { hashPassword } = await import('../src/shared/password.ts');
  const { LoginRateLimiter } = await import('../src/modules/auth/rate-limiter.ts');

  const USERNAME = 'encargado';
  const PASSWORD = 'clave-de-prueba-1';
  const settings = () => ({
    sessionTtlMs: 60_000,
    cookieSecure: false,
    limiter: new LoginRateLimiter(5, 60_000),
  });
  let passwordHash;
  let server;
  let base;

  const listen = async (app) => {
    const instance = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => instance.once('listening', resolve));
    return instance;
  };
  const urlOf = (instance) => `http://127.0.0.1:${instance.address().port}`;
  const close = (instance) => new Promise((resolve) => instance.close(resolve));

  before(async () => {
    passwordHash = await hashPassword(PASSWORD);
    server = await listen(createApp(pool, settings()));
    base = urlOf(server);
  });
  after(async () => {
    await close(server);
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE sessions, users, restaurant_tables RESTART IDENTITY CASCADE');
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [
      USERNAME,
      passwordHash,
    ]);
  });

  const api = (path, { method = 'GET', body, cookie, headers = {}, url = base } = {}) =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const cookieHeader = (response) =>
    response.headers.getSetCookie().find((value) => value.startsWith('reservet_sid='));
  const login = async (username = USERNAME, password = PASSWORD) => {
    const response = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    const setCookie = cookieHeader(response);
    return { response, cookie: setCookie?.split(';')[0], setCookie };
  };
  const count = async (table) =>
    Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  const createTable = (cookie, body) => api('/api/tables', { method: 'POST', cookie, body });

  test('login correcto: devuelve el usuario y una cookie HttpOnly SameSite=Lax', async () => {
    const { response, setCookie, cookie } = await login('Encargado');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).user.username, USERNAME);
    assert.match(setCookie, /; HttpOnly/);
    assert.match(setCookie, /; SameSite=Lax/);
    assert.match(setCookie, /; Path=\//);
    assert.match(setCookie, /; Max-Age=60/);
    assert.doesNotMatch(setCookie, /Secure/, 'en dev la cookie no es Secure para poder usar HTTP');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    // El token no se guarda en claro: la base solo tiene su hash.
    const token = cookie.split('=')[1];
    const rows = (await pool.query('SELECT token_hash FROM sessions')).rows;
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, token);
  });

  test('la contraseña se guarda con scrypt, nunca en claro', async () => {
    const { rows } = await pool.query('SELECT password_hash FROM users');
    assert.match(rows[0].password_hash, /^scrypt\$/);
    assert.ok(!rows[0].password_hash.includes(PASSWORD));
  });

  test('login incorrecto: 401 genérico, igual para usuario inexistente, sin cookie', async () => {
    const wrongPassword = await login(USERNAME, 'incorrecta');
    const unknownUser = await login('fantasma', PASSWORD);
    for (const { response, setCookie } of [wrongPassword, unknownUser]) {
      assert.equal(response.status, 401);
      assert.equal(setCookie, undefined);
    }
    const first = await wrongPassword.response.json();
    const second = await unknownUser.response.json();
    assert.equal(first.code, 'INVALID_CREDENTIALS');
    assert.equal(first.message, second.message);
    assert.equal(await count('sessions'), 0);
  });

  test('login con cuerpo inválido responde 400', async () => {
    for (const body of [{}, { username: USERNAME }, { username: 1, password: 2 }, []]) {
      const response = await api('/api/auth/login', { method: 'POST', body });
      assert.equal(response.status, 400);
    }
  });

  test('sin sesión todas las rutas de mesas y /me responden 401', async () => {
    const calls = [
      api('/api/tables'),
      api('/api/tables', { method: 'POST', body: { name: 'Mesa 1', capacity: 4 } }),
      api('/api/tables/1/status', { method: 'PATCH', body: { status: 'occupied' } }),
      api('/api/auth/me'),
      api('/api/tables', { cookie: 'reservet_sid=' + 'a'.repeat(43) }),
      api('/api/tables', { cookie: 'reservet_sid=basura' }),
    ];
    for (const response of await Promise.all(calls)) {
      assert.equal(response.status, 401);
      const payload = await response.json();
      assert.equal(payload.code, 'UNAUTHENTICATED');
      assert.equal(payload.requestId, response.headers.get('x-request-id'));
    }
    assert.equal(await count('restaurant_tables'), 0);
    // Las rutas de salud siguen siendo públicas y no revelan secretos.
    assert.equal((await api('/health')).status, 200);
    assert.equal((await api('/health/db')).status, 200);
  });

  test('/me devuelve el usuario de la sesión', async () => {
    const { cookie } = await login();
    const response = await api('/api/auth/me', { cookie });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.username, USERNAME);
  });

  test('logout revoca la sesión al instante y limpia la cookie', async () => {
    const { cookie } = await login();
    assert.equal((await api('/api/tables', { cookie })).status, 200);
    const response = await api('/api/auth/logout', { method: 'POST', cookie });
    assert.equal(response.status, 204);
    assert.match(cookieHeader(response), /Max-Age=0/);
    assert.equal(await count('sessions'), 0);
    // La cookie copiada antes de salir deja de valer.
    assert.equal((await api('/api/tables', { cookie })).status, 401);
    // Repetir logout o hacerlo sin sesión no falla.
    assert.equal((await api('/api/auth/logout', { method: 'POST' })).status, 204);
  });

  test('una sesión caducada deja de autenticar', async () => {
    const { cookie } = await login();
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    assert.equal((await api('/api/tables', { cookie })).status, 401);
  });

  test('volver a iniciar sesión con cookie previa revoca la sesión anterior', async () => {
    const first = await login();
    const second = await api('/api/auth/login', {
      method: 'POST',
      cookie: first.cookie,
      body: { username: USERNAME, password: PASSWORD },
    });
    assert.equal(second.status, 200);
    assert.equal((await api('/api/tables', { cookie: first.cookie })).status, 401);
    assert.equal(await count('sessions'), 1);
  });

  test('listar, crear y cambiar estado cumplen el contrato', async () => {
    const { cookie } = await login();
    const empty = await api('/api/tables', { cookie });
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), []);

    const created = await createTable(cookie, { name: '  Mesa 1  ', capacity: 4 });
    assert.equal(created.status, 201);
    const table = await created.json();
    assert.deepEqual(table, { id: 1, name: 'Mesa 1', capacity: 4, status: 'available' });

    for (const status of ['occupied', 'out_of_service', 'available']) {
      const response = await api(`/api/tables/${table.id}/status`, {
        method: 'PATCH',
        cookie,
        body: { status },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ...table, status });
    }
    const listed = await (await api('/api/tables', { cookie })).json();
    assert.deepEqual(listed, [table]);
  });

  test('la capacidad acepta 1 y 20 y rechaza 0, 21 y valores no enteros', async () => {
    const { cookie } = await login();
    assert.equal((await createTable(cookie, { name: 'Mínima', capacity: 1 })).status, 201);
    assert.equal((await createTable(cookie, { name: 'Máxima', capacity: 20 })).status, 201);
    for (const capacity of [0, 21, -1, 2.5, '4', null]) {
      const response = await createTable(cookie, { name: 'Inválida', capacity });
      assert.equal(response.status, 400, String(capacity));
      assert.equal((await response.json()).code, 'VALIDATION_ERROR');
    }
    assert.equal(await count('restaurant_tables'), 2);
  });

  test('los nombres inválidos se rechazan con 400 y no se guardan', async () => {
    const { cookie } = await login();
    for (const name of ['', '   ', 'x'.repeat(81), 7, null, 'Mesa\n1']) {
      assert.equal((await createTable(cookie, { name, capacity: 4 })).status, 400, String(name));
    }
    assert.equal((await createTable(cookie, 'texto')).status, 400);
    assert.equal((await createTable(cookie, [])).status, 400);
    assert.equal((await createTable(cookie, { name: 'x'.repeat(80), capacity: 4 })).status, 201);
    assert.equal(await count('restaurant_tables'), 1);
  });

  test('un nombre duplicado (sin distinguir mayúsculas ni espacios) da 409 sin detalles de SQL', async () => {
    const { cookie } = await login();
    assert.equal((await createTable(cookie, { name: 'Mesa 1', capacity: 4 })).status, 201);
    for (const name of ['Mesa 1', 'MESA 1', 'mesa 1', '  mesa 1  ']) {
      const response = await createTable(cookie, { name, capacity: 2 });
      assert.equal(response.status, 409, name);
      const payload = await response.json();
      assert.equal(payload.code, 'DUPLICATE_TABLE');
      assert.doesNotMatch(JSON.stringify(payload), /duplicate key|constraint|restaurant_tables/i);
    }
    assert.equal(await count('restaurant_tables'), 1);
  });

  test('dos altas simultáneas del mismo nombre: una gana y la otra recibe 409', async () => {
    const { cookie } = await login();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createTable(cookie, { name: 'Carrera', capacity: 4 })),
    );
    const statuses = results.map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
    assert.equal(await count('restaurant_tables'), 1);
  });

  test('mesa inexistente da 404 y los IDs inválidos o desbordados dan 400', async () => {
    const { cookie } = await login();
    const patch = (id) =>
      api(`/api/tables/${id}/status`, { method: 'PATCH', cookie, body: { status: 'occupied' } });
    assert.equal((await patch(999)).status, 404);
    assert.equal((await (await patch(999)).json()).code, 'TABLE_NOT_FOUND');
    for (const id of ['abc', '0', '-1', '1.5', '99999999999', '2147483648']) {
      assert.equal((await patch(id)).status, 400, id);
    }
    await createTable(cookie, { name: 'Mesa 1', capacity: 4 });
    for (const status of ['cerrada', 'AVAILABLE', 5, undefined]) {
      const response = await api('/api/tables/1/status', {
        method: 'PATCH',
        cookie,
        body: { status },
      });
      assert.equal(response.status, 400, String(status));
    }
  });

  test('SQL parametrizado: un nombre con comillas se guarda como texto y no rompe nada', async () => {
    const { cookie } = await login();
    const name = "'); DROP TABLE restaurant_tables; --";
    assert.equal((await createTable(cookie, { name, capacity: 3 })).status, 201);
    const listed = await (await api('/api/tables', { cookie })).json();
    assert.equal(listed[0].name, name);
    assert.equal(await count('restaurant_tables'), 1);
  });

  test('los datos sobreviven a reiniciar el servidor (otra instancia, misma base)', async () => {
    const { cookie } = await login();
    await createTable(cookie, { name: 'Persistente', capacity: 6 });
    await api('/api/tables/1/status', { method: 'PATCH', cookie, body: { status: 'occupied' } });

    const restarted = await listen(createApp(pool, settings()));
    try {
      // La sesión también vive en PostgreSQL, así que sigue válida tras el reinicio.
      const response = await api('/api/tables', { cookie, url: urlOf(restarted) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [
        { id: 1, name: 'Persistente', capacity: 6, status: 'occupied' },
      ]);
    } finally {
      await close(restarted);
    }
    const { rows } = await pool.query('SELECT name, status FROM restaurant_tables');
    assert.deepEqual(rows, [{ name: 'Persistente', status: 'occupied' }]);
  });

  test('tras demasiados intentos fallidos el login responde 429 con Retry-After', async () => {
    const attempts = [];
    for (let i = 0; i < 5; i++) attempts.push((await login('victima', 'mala')).response.status);
    assert.deepEqual(attempts, [401, 401, 401, 401, 401]);
    const blocked = await login('victima', 'mala');
    assert.equal(blocked.response.status, 429);
    assert.ok(Number(blocked.response.headers.get('retry-after')) > 0);
    assert.equal((await blocked.response.json()).code, 'TOO_MANY_ATTEMPTS');
    // Otro usuario no queda bloqueado por los fallos de "victima".
    assert.equal((await login()).response.status, 200);
  });

  test('una petición de otro origen que cambia datos se rechaza con 403 (CSRF)', async () => {
    const { cookie } = await login();
    const post = (origin) =>
      new Promise((resolve, reject) => {
        const body = JSON.stringify({ name: `Mesa ${origin}`, capacity: 2 });
        const request = http.request(
          `${base}/api/tables`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              Cookie: cookie,
              Origin: origin,
            },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
          },
        );
        request.on('error', reject);
        request.end(body);
      });
    assert.equal(await post('http://sitio-malicioso.example'), 403);
    assert.equal(await count('restaurant_tables'), 0);
    assert.equal(await post(base), 201);
  });
}
