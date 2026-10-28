import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Sin base ni red: fetch está simulado. Cubre el modo demo corregido y el flujo de sesión del modo API.
test('demo corregida y flujo de login, 401 y logout del modo API', async () => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), {
    url: 'http://localhost',
  });
  const previous = {};
  for (const key of ['document', 'localStorage', 'Option', 'fetch'])
    previous[key] = globalThis[key];
  try {
    for (const key of ['document', 'localStorage', 'Option']) globalThis[key] = dom.window[key];
    const { document } = dom.window;
    const $ = (selector) => document.querySelector(selector);
    const event = (type) => new dom.window.Event(type, { cancelable: true });
    const flush = async () => {
      for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    $('#table-dialog').close = () => {};
    await import('../public/app.js');
    const create = (name, capacity) => {
      $('#table-name').value = name;
      $('#table-capacity').value = String(capacity);
      $('#table-form').dispatchEvent(event('submit'));
    };

    // Regresión: la capacidad máxima permitida (20) se rechazaba en el navegador.
    create('Salón grande', 20);
    assert.equal(document.querySelectorAll('.table-card').length, 7);
    create('Salón enorme', 21);
    assert.notEqual($('#form-error').textContent, '');
    assert.equal(document.querySelectorAll('.table-card').length, 7);
    // Regresión: el duplicado en demo distinguía mayúsculas, la base de datos no.
    create('SALÓN GRANDE', 4);
    assert.notEqual($('#form-error').textContent, '');
    assert.equal(document.querySelectorAll('.table-card').length, 7);
    // Regresión: la búsqueda distinguía mayúsculas aunque el README exige ignorarlas.
    $('#search').value = 'TERRAZA';
    $('#search').dispatchEvent(event('input'));
    assert.equal(document.querySelectorAll('.table-card').length, 2);
    $('#search').value = '';
    $('#search').dispatchEvent(event('input'));
    assert.ok($('#login-panel').hidden, 'el login no aparece en modo demo');

    // Modo API sin sesión: la API responde 401 y la interfaz pide iniciar sesión.
    let signedIn = false;
    const tables = [{ id: 1, name: 'Mesa 1', capacity: 4, status: 'available' }];
    const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });
    const calls = [];
    globalThis.fetch = async (path, options = {}) => {
      calls.push(`${options.method ?? 'GET'} ${path}`);
      if (path === '/api/auth/login') {
        const { password } = JSON.parse(options.body);
        signedIn = password === 'clave-correcta';
        return signedIn
          ? respond(200, { user: { id: 1, username: 'encargado' } })
          : respond(401, {});
      }
      if (path === '/api/auth/logout') {
        signedIn = false;
        return respond(204, null);
      }
      if (!signedIn) return respond(401, { code: 'UNAUTHENTICATED' });
      if (path === '/api/auth/me') return respond(200, { user: { id: 1, username: 'encargado' } });
      if (path === '/api/tables') return respond(200, tables);
      return respond(404, {});
    };
    $('#source').value = 'api';
    $('#source').dispatchEvent(event('change'));
    await flush();
    assert.equal($('#login-panel').hidden, false);
    assert.equal($('.table-card'), null);
    assert.equal($('#new-table').disabled, true);

    // Credenciales incorrectas: mensaje genérico y el panel sigue visible.
    $('#login-username').value = 'encargado';
    $('#login-password').value = 'incorrecta';
    $('#login-form').dispatchEvent(event('submit'));
    await flush();
    assert.notEqual($('#login-error').textContent, '');
    assert.equal($('#login-panel').hidden, false);

    // Credenciales correctas: se listan las mesas y aparece la sesión.
    $('#login-password').value = 'clave-correcta';
    $('#login-form').dispatchEvent(event('submit'));
    await flush();
    assert.equal($('#login-panel').hidden, true);
    assert.equal($('#session-bar').hidden, false);
    assert.match($('#session-user').textContent, /encargado/);
    assert.equal($('#login-password').value, '');
    assert.equal(document.querySelectorAll('.table-card').length, 1);
    assert.equal($('#new-table').disabled, false);

    // Salir: se llama a logout, desaparecen las mesas y vuelve el login.
    $('#logout').dispatchEvent(event('click'));
    await flush();
    assert.ok(calls.includes('POST /api/auth/logout'));
    assert.equal($('#login-panel').hidden, false);
    assert.equal(document.querySelectorAll('.table-card').length, 0);

    // Sesión caducada durante el uso: un 401 al actualizar devuelve al login sin romper nada.
    signedIn = true;
    $('#login-username').value = 'encargado';
    $('#login-password').value = 'clave-correcta';
    $('#login-form').dispatchEvent(event('submit'));
    await flush();
    signedIn = false;
    $('#refresh').dispatchEvent(event('click'));
    await flush();
    assert.equal($('#login-panel').hidden, false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});
