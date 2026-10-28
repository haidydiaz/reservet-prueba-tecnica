import { test } from 'node:test';
import assert from 'node:assert/strict';

// Regresión: i18n.js guardaba el idioma en 'reservet.language' pero lo leía de 'reservet.lang',
// así que al recargar siempre volvía a español. No necesita navegador: basta un localStorage falso.
test('el idioma guardado se recupera al cargar la página', async () => {
  const stored = new Map([['reservet.language', 'ru']]);
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  try {
    const { locale, t } = await import('../public/i18n.js');
    assert.equal(locale(), 'ru');
    assert.equal(t('signIn'), 'Войти');
  } finally {
    delete globalThis.localStorage;
  }
});

test('los tres idiomas tienen las mismas claves de mensajes', async () => {
  // Cada idioma debe traducir todo lo que usa la interfaz; t() lanzaría un error si faltara una clave.
  const source = (await import('node:fs/promises')).readFile(
    new URL('../public/i18n.js', import.meta.url),
    'utf8',
  );
  const text = await source;
  const keysOf = (language) => {
    const start = text.indexOf(`\n  ${language}: {`);
    const end = text.indexOf('\n  },', start);
    return [...text.slice(start, end).matchAll(/\n {4}(\w+):/g)].map((match) => match[1]).sort();
  };
  const spanish = keysOf('es');
  assert.ok(spanish.length > 50);
  assert.deepEqual(keysOf('en'), spanish);
  assert.deepEqual(keysOf('ru'), spanish);
});
