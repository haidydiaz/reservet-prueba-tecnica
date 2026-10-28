import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/shared/password.ts';

test('el hash scrypt no contiene la contraseña y usa sal distinta cada vez', async () => {
  const first = await hashPassword('Contraseña-segura-1');
  const second = await hashPassword('Contraseña-segura-1');
  assert.match(first, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!first.includes('Contraseña-segura-1'));
  assert.notEqual(first, second);
});

test('verifyPassword acepta la contraseña correcta y rechaza la incorrecta', async () => {
  const hash = await hashPassword('Contraseña-segura-1');
  assert.equal(await verifyPassword('Contraseña-segura-1', hash), true);
  assert.equal(await verifyPassword('contraseña-segura-1', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('un hash dañado o con parámetros abusivos se rechaza sin lanzar errores', async () => {
  for (const stored of [
    '',
    'texto-plano',
    'scrypt$1$2$3',
    'scrypt$x$8$1$AAAA$AAAA',
    'scrypt$16384$8$1$$',
    'scrypt$1073741824$8$1$AAAA$AAAA',
    'bcrypt$16384$8$1$AAAA$AAAA',
  ]) {
    assert.equal(await verifyPassword('cualquiera', stored), false, stored);
  }
});
