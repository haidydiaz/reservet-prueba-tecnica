import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, hashToken } from '../src/modules/auth/auth.service.ts';
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  isTokenFormat,
  readCookie,
  sessionCookie,
} from '../src/modules/auth/cookies.ts';
import { LoginRateLimiter } from '../src/modules/auth/rate-limiter.ts';
import { hashPassword } from '../src/shared/password.ts';

// Repositorio en memoria: estas pruebas no usan PostgreSQL. Las de integración sí.
function memoryRepository(users) {
  const sessions = new Map();
  return {
    sessions,
    async findUserByUsername(username) {
      return users.find((user) => user.username.toLowerCase() === username.toLowerCase()) ?? null;
    },
    async createSession(tokenHash, userId, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt });
    },
    async findSessionUser(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session || session.expiresAt <= new Date()) return null;
      const user = users.find((item) => item.id === session.userId);
      return { id: user.id, username: user.username };
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async deleteExpiredSessions() {},
  };
}

async function setup(sessionTtlMs = 60_000) {
  const users = [
    { id: 1, username: 'Encargado', passwordHash: await hashPassword('clave-de-prueba-1') },
  ];
  const repository = memoryRepository(users);
  return { repository, auth: new AuthService(repository, { sessionTtlMs }) };
}

test('login correcto crea una sesión y guarda solo el hash del token', async () => {
  const { auth, repository } = await setup();
  const result = await auth.login('encargado', 'clave-de-prueba-1');
  assert.deepEqual(result.user, { id: 1, username: 'Encargado' });
  assert.ok(isTokenFormat(result.token));
  assert.ok(!repository.sessions.has(result.token));
  assert.ok(repository.sessions.has(hashToken(result.token)));
  assert.deepEqual(await auth.authenticate(result.token), { id: 1, username: 'Encargado' });
});

test('login incorrecto da el mismo error genérico para usuario inexistente y contraseña errónea', async () => {
  const { auth, repository } = await setup();
  const errors = [];
  for (const [user, password] of [
    ['encargado', 'incorrecta'],
    ['fantasma', 'clave-de-prueba-1'],
  ]) {
    await assert.rejects(auth.login(user, password), (error) => {
      errors.push(error);
      return error.status === 401 && error.code === 'INVALID_CREDENTIALS';
    });
  }
  assert.equal(errors[0].message, errors[1].message);
  assert.equal(repository.sessions.size, 0);
});

test('credenciales con tipos o longitudes inválidos no llegan a la base de datos', async () => {
  const { auth } = await setup();
  for (const [user, password] of [
    [undefined, 'x'],
    ['a', undefined],
    ['', 'x'],
    ['a', ''],
    [1, 2],
    [{}, []],
  ]) {
    await assert.rejects(auth.login(user, password), (error) => error.status === 400);
  }
  await assert.rejects(auth.login('a'.repeat(51), 'x'), (error) => error.status === 401);
  await assert.rejects(auth.login('encargado', 'x'.repeat(129)), (error) => error.status === 401);
});

test('logout revoca la sesión de inmediato', async () => {
  const { auth } = await setup();
  const { token } = await auth.login('encargado', 'clave-de-prueba-1');
  await auth.logout(token);
  assert.equal(await auth.authenticate(token), null);
  await auth.logout(token); // repetirlo no falla
  await auth.logout(undefined);
});

test('una sesión caducada o un token mal formado no autentican', async () => {
  const { auth } = await setup(-1000);
  const { token } = await auth.login('encargado', 'clave-de-prueba-1');
  assert.equal(await auth.authenticate(token), null);
  for (const invalid of [undefined, '', 'corto', `${token}extra`, 'ñ'.repeat(43)]) {
    assert.equal(await auth.authenticate(invalid), null);
  }
});

test('cada login genera un token distinto', async () => {
  const { auth } = await setup();
  const first = await auth.login('encargado', 'clave-de-prueba-1');
  const second = await auth.login('encargado', 'clave-de-prueba-1');
  assert.notEqual(first.token, second.token);
});

test('la cookie de sesión es HttpOnly, SameSite=Lax y Secure solo si se pide', () => {
  const token = 'a'.repeat(43);
  const dev = sessionCookie(token, 3_600_000, { secure: false });
  assert.match(
    dev,
    new RegExp(`^${SESSION_COOKIE}=${token}; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax$`),
  );
  assert.match(sessionCookie(token, 3_600_000, { secure: true }), /; Secure$/);
  const cleared = clearedSessionCookie({ secure: true });
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly/);
});

test('readCookie encuentra la cookie correcta y tolera valores raros', () => {
  assert.equal(readCookie(`otra=1; ${SESSION_COOKIE}=abc; x=y`, SESSION_COOKIE), 'abc');
  assert.equal(readCookie(undefined, SESSION_COOKIE), undefined);
  assert.equal(readCookie('sin-igual', SESSION_COOKIE), undefined);
  assert.equal(readCookie(`${SESSION_COOKIE}=%E0%A4%A`, SESSION_COOKIE), undefined);
  assert.equal(readCookie(`x${SESSION_COOKIE}=abc`, SESSION_COOKIE), undefined);
});

test('el limitador bloquea tras demasiados fallos, expira y se reinicia con un acierto', () => {
  let now = 0;
  const limiter = new LoginRateLimiter(3, 1000, () => now);
  for (let i = 0; i < 2; i++) limiter.recordFailure('a');
  assert.equal(limiter.isBlocked('a'), false);
  limiter.recordFailure('a');
  assert.equal(limiter.isBlocked('a'), true);
  assert.equal(limiter.isBlocked('b'), false);
  assert.equal(limiter.retryAfterSeconds('a'), 1);
  now = 1001;
  assert.equal(limiter.isBlocked('a'), false);
  limiter.recordFailure('c');
  limiter.reset('c');
  assert.equal(limiter.retryAfterSeconds('c'), 0);
});
