import { t, locale, applyLanguage } from './i18n.js';
// El modo demo es temporal y nunca escribe en PostgreSQL.
// El modo API utiliza el contrato del primer ejercicio, sin sustituirlo por datos falsos.
const $ = (selector) => document.querySelector(selector);
const statuses = ['available', 'occupied', 'out_of_service'];
let lastNotice = null;
let formError = null;
const translatedError = (key, values = {}, status) =>
  Object.assign(new Error(t(key, values)), { key, values, status });
const showFormError = (error = null) => {
  formError = error;
  $('#form-error').textContent = error
    ? error.key
      ? t(error.key, error.values)
      : error.message
    : '';
};
const displayName = (table) =>
  isDemo() && table.demoKey ? `${t(table.demoKey)} ${table.demoNumber}` : table.name;
let demoTables = [
  {
    id: 1,
    name: 'Mesa 01',
    demoKey: 'tableName',
    demoNumber: '01',
    capacity: 2,
    status: 'available',
  },
  {
    id: 2,
    name: 'Mesa 02',
    demoKey: 'tableName',
    demoNumber: '02',
    capacity: 4,
    status: 'occupied',
  },
  {
    id: 3,
    name: 'Mesa 03',
    demoKey: 'tableName',
    demoNumber: '03',
    capacity: 4,
    status: 'available',
  },
  {
    id: 4,
    name: 'Terraza 01',
    demoKey: 'terrace',
    demoNumber: '01',
    capacity: 6,
    status: 'available',
  },
  {
    id: 5,
    name: 'Terraza 02',
    demoKey: 'terrace',
    demoNumber: '02',
    capacity: 2,
    status: 'occupied',
  },
  {
    id: 6,
    name: 'Mesa 06',
    demoKey: 'tableName',
    demoNumber: '06',
    capacity: 8,
    status: 'out_of_service',
  },
];
let tables = [];
let busy = false;
let loadError = '';
// Estado de sesión del modo API. El navegador nunca ve el token: viaja en una cookie HttpOnly.
let authenticated = false;
let needsLogin = false;
let currentUser = null;
let loginError = null;
const isDemo = () => $('#source').value === 'demo';
// En modo API no se puede crear ni editar hasta tener sesión; el servidor lo exige igualmente.
const locked = () => !isDemo() && !authenticated;
const showLoginError = (error = null) => {
  loginError = error;
  $('#login-error').textContent = error
    ? error.key
      ? t(error.key, error.values)
      : error.message
    : '';
};
const updateAuthUi = () => {
  $('#login-panel').hidden = isDemo() || !needsLogin;
  $('#session-bar').hidden = isDemo() || !authenticated;
  $('#session-user').textContent = currentUser
    ? t('signedInAs', { name: currentUser.username })
    : '';
};
// Una respuesta 401 en modo API significa que no hay sesión (o caducó): se pide iniciar sesión.
const handleAuthLoss = (error) => {
  if (isDemo() || error?.status !== 401) return false;
  authenticated = false;
  currentUser = null;
  needsLogin = true;
  tables = [];
  return true;
};
const notice = (key = '', error = false, values = {}) => {
  lastNotice = { key, error, values };
  $('#notice').textContent = key ? t(key, values) : '';
  $('#notice').className = `notice${error ? ' error' : ''}`;
};

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
    });
  } catch {
    throw translatedError('connectionError');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { status } = response;
    if (status === 401) throw translatedError('sessionRequired', {}, status);
    if (status === 404) throw translatedError('notFound', { path }, status);
    if (status === 400) throw translatedError('validation', {}, status);
    if (status === 409) throw translatedError('duplicate', {}, status);
    if (status === 429) throw translatedError('tooManyAttempts', {}, status);
    throw translatedError('httpError', { status }, status);
  }
  return body;
}

function validTable(table) {
  return (
    table &&
    Number.isInteger(table.id) &&
    table.id > 0 &&
    typeof table.name === 'string' &&
    table.name.trim().length > 0 &&
    table.name.length <= 80 &&
    Number.isInteger(table.capacity) &&
    table.capacity >= 1 &&
    table.capacity <= 20 &&
    statuses.includes(table.status)
  );
}

function setBusy(value) {
  busy = value;
  for (const selector of [
    '#source',
    '#refresh',
    '#save-table',
    '#close-dialog',
    '#cancel-dialog',
    '#login-submit',
    '#logout',
  ])
    $(selector).disabled = value;
  $('#new-table').disabled = value || locked();
  $('#tables').setAttribute('aria-busy', String(value));
  $('#save-table').textContent = t(value ? 'saving' : 'save');
  $('#login-submit').textContent = t(value ? 'signingIn' : 'signIn');
  document.querySelectorAll('.card-bottom select').forEach((select) => {
    select.disabled = value || locked();
  });
}

const tableIcon =
  '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="8" width="16" height="16" rx="3"/><path d="M12 4h8M12 28h8M4 12v8M28 12v8" stroke-linecap="round"/></svg>';

function render() {
  $('#total').textContent = tables.length;
  for (const status of statuses)
    $(`#${status}`).textContent = tables.filter((table) => table.status === status).length;
  updateAuthUi();
  const query = $('#search').value.trim().toLocaleLowerCase(locale());
  const filtered = tables.filter(
    (table) =>
      displayName(table).toLocaleLowerCase(locale()).includes(query) &&
      ($('#filter').value === 'all' || table.status === $('#filter').value),
  );
  $('#result-count').textContent = t('results', {
    shown: filtered.length,
    total: tables.length,
    source: t(isDemo() ? 'demoData' : 'apiData'),
  });
  $('#tables').replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const title = document.createElement('h3');
    const locked_ = !isDemo() && needsLogin;
    title.textContent = t(
      locked_
        ? 'loginRequiredTitle'
        : loadError
          ? 'errorTitle'
          : tables.length
            ? 'noMatches'
            : 'emptyTitle',
    );
    const description = document.createElement('p');
    description.textContent = t(
      locked_
        ? 'loginRequiredHint'
        : loadError
          ? 'errorHint'
          : tables.length
            ? 'searchHint'
            : 'emptyHint',
    );
    empty.append(title, description);
    $('#tables').append(empty);
  }
  for (const table of filtered) {
    const card = document.createElement('article');
    card.className = 'table-card';
    // Esta plantilla contiene solo valores constantes. Los datos de la API usan textContent.
    card.innerHTML = `<div class="card-top"><span class="table-symbol">${tableIcon}</span><span class="badge"></span></div><div class="card-body"><h3></h3><p></p></div><div class="card-bottom"><label></label><select></select></div>`;
    card.querySelector('.badge').classList.add(table.status);
    card.querySelector('.badge').textContent = t(table.status);
    card.querySelector('h3').textContent = displayName(table);
    card.querySelector('.card-body p').textContent = t('seats', { count: table.capacity });
    const select = card.querySelector('select');
    select.id = `status-${table.id}`;
    card.querySelector('label').htmlFor = select.id;
    card.querySelector('label').textContent = t('changeStatus');
    select.setAttribute('aria-label', t('statusOf', { name: displayName(table) }));
    for (const value of statuses) select.add(new Option(t(value), value));
    select.value = table.status;
    select.disabled = busy || locked();
    select.addEventListener('change', () => changeStatus(table, select.value));
    $('#tables').append(card);
  }
}

async function refreshSession() {
  try {
    currentUser = (await request('/api/auth/me'))?.user ?? null;
  } catch {
    currentUser = null;
  }
}

async function load() {
  if (busy) return;
  loadError = '';
  tables = [];
  setBusy(true);
  render();
  notice('loading');
  try {
    const result = isDemo() ? structuredClone(demoTables) : await request('/api/tables');
    if (
      !Array.isArray(result) ||
      !result.every(validTable) ||
      new Set(result.map((table) => table.id)).size !== result.length
    ) {
      throw translatedError('invalidList');
    }
    tables = result;
    if (!isDemo()) {
      // Si la API respondió con datos hay sesión válida; se consulta quién es para mostrarlo.
      authenticated = true;
      needsLogin = false;
      await refreshSession();
    }
    notice(isDemo() ? 'demoNotice' : 'loaded');
  } catch (error) {
    if (handleAuthLoss(error)) notice('loginRequired');
    else {
      loadError = error;
      notice(error.key || 'httpError', true, error.values);
    }
  } finally {
    setBusy(false);
    render();
  }
}

async function changeStatus(table, status) {
  if (busy) return;
  setBusy(true);
  try {
    if (isDemo()) {
      demoTables = demoTables.map((item) => (item.id === table.id ? { ...item, status } : item));
      tables = structuredClone(demoTables);
    } else {
      const updated = await request(`/api/tables/${table.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      if (!validTable(updated) || updated.id !== table.id || updated.status !== status)
        throw translatedError('invalidPatch');
      tables = tables.map((item) => (item.id === updated.id ? updated : item));
    }
    notice('updated', false, { name: displayName(table) });
  } catch (error) {
    if (handleAuthLoss(error)) notice('sessionRequired', true);
    else notice(error.key || 'httpError', true, error.values);
  } finally {
    setBusy(false);
    render();
  }
}

$('#new-table').addEventListener('click', () => {
  $('#table-form').reset();
  showFormError();
  $('#table-dialog').showModal();
  $('#table-name').focus();
});
for (const selector of ['#close-dialog', '#cancel-dialog'])
  $(selector).addEventListener('click', () => $('#table-dialog').close());
$('#table-dialog').addEventListener('cancel', (event) => {
  if (busy) event.preventDefault();
});
$('#table-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const name = $('#table-name').value.trim();
  const capacity = Number($('#table-capacity').value);
  showFormError();
  if (!name || name.length > 80 || !Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
    showFormError(translatedError('validation'));
    return;
  }
  setBusy(true);
  try {
    let created;
    if (isDemo()) {
      if (demoTables.some((table) => table.name.toLowerCase() === name.toLowerCase()))
        throw translatedError('duplicate');
      created = {
        id: Math.max(0, ...demoTables.map((table) => table.id)) + 1,
        name,
        capacity,
        status: 'available',
      };
      demoTables.push(created);
    } else {
      created = await request('/api/tables', {
        method: 'POST',
        body: JSON.stringify({ name, capacity }),
      });
      if (!validTable(created) || tables.some((table) => table.id === created.id))
        throw translatedError('invalidPost');
    }
    tables.push(created);
    loadError = '';
    $('#search').value = '';
    $('#filter').value = 'all';
    $('#table-dialog').close();
    notice('created', false, { name });
  } catch (error) {
    if (handleAuthLoss(error)) {
      $('#table-dialog').close();
      notice('sessionRequired', true);
    } else showFormError(error);
  } finally {
    setBusy(false);
    render();
  }
});
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  showLoginError();
  if (!username || !password) {
    showLoginError(translatedError('loginValidation'));
    return;
  }
  setBusy(true);
  let signedIn = false;
  try {
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    currentUser = result?.user ?? null;
    authenticated = true;
    needsLogin = false;
    signedIn = true;
    $('#login-password').value = '';
  } catch (error) {
    // En el login un 401 significa credenciales incorrectas, no sesión caducada.
    showLoginError(error.status === 401 ? translatedError('invalidCredentials') : error);
  } finally {
    setBusy(false);
    render();
  }
  if (signedIn) await load();
});
$('#logout').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    await request('/api/auth/logout', { method: 'POST' });
    authenticated = false;
    needsLogin = true;
    currentUser = null;
    tables = [];
    loadError = '';
    notice('loggedOut');
  } catch (error) {
    notice(error.key || 'httpError', true, error.values);
  } finally {
    setBusy(false);
    render();
  }
});
$('#source').addEventListener('change', () => {
  $('#mode-description').textContent = t(isDemo() ? 'demoDescription' : 'apiDescription');
  void load();
});
$('#refresh').addEventListener('click', () => void load());
$('#search').addEventListener('input', render);
$('#filter').addEventListener('change', render);
void load();

function updateLanguage() {
  applyLanguage($('#language').value);
  $('#mode-description').textContent = t(isDemo() ? 'demoDescription' : 'apiDescription');
  setBusy(busy);
  render();
  if (lastNotice) notice(lastNotice.key, lastNotice.error, lastNotice.values);
  showFormError(formError);
  showLoginError(loginError);
}
$('#language').addEventListener('change', updateLanguage);
applyLanguage();
updateLanguage();
