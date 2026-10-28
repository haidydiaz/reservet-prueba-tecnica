import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TablesService,
  parseCreateInput,
  parseStatusInput,
  parseTableId,
} from '../src/modules/tables/tables.service.ts';

const code = (status, errorCode) => (error) => error.status === status && error.code === errorCode;

function fakeRepository() {
  const rows = [];
  return {
    rows,
    async list() {
      return rows.map((row) => ({ ...row }));
    },
    async create(name, capacity) {
      if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        });
      }
      const row = { id: rows.length + 1, name, capacity, status: 'available' };
      rows.push(row);
      return { ...row };
    },
    async updateStatus(id, status) {
      const row = rows.find((item) => item.id === id);
      if (!row) return null;
      row.status = status;
      return { ...row };
    },
  };
}

test('crear recorta el nombre y acepta los límites de capacidad 1 y 20', () => {
  assert.deepEqual(parseCreateInput({ name: '  Mesa 1  ', capacity: 4 }), {
    name: 'Mesa 1',
    capacity: 4,
  });
  assert.equal(parseCreateInput({ name: 'a', capacity: 1 }).capacity, 1);
  assert.equal(parseCreateInput({ name: 'a', capacity: 20 }).capacity, 20);
  assert.equal(parseCreateInput({ name: 'x'.repeat(80), capacity: 2 }).name.length, 80);
  assert.equal(parseCreateInput({ name: '🍽'.repeat(80), capacity: 2 }).capacity, 2);
});

test('crear rechaza nombres y capacidades inválidos con 400', () => {
  const invalid = [
    undefined,
    null,
    'texto',
    [],
    {},
    { name: 'Mesa', capacity: 0 },
    { name: 'Mesa', capacity: 21 },
    { name: 'Mesa', capacity: -3 },
    { name: 'Mesa', capacity: 2.5 },
    { name: 'Mesa', capacity: '4' },
    { name: 'Mesa', capacity: null },
    { name: 'Mesa', capacity: NaN },
    { name: '', capacity: 4 },
    { name: '    ', capacity: 4 },
    { name: 'x'.repeat(81), capacity: 4 },
    { name: '🍽'.repeat(81), capacity: 4 },
    { name: 'Mesa\n1', capacity: 4 },
    { name: 7, capacity: 4 },
    { name: ['Mesa'], capacity: 4 },
  ];
  for (const body of invalid) {
    assert.throws(
      () => parseCreateInput(body),
      code(400, 'VALIDATION_ERROR'),
      JSON.stringify(body),
    );
  }
});

test('el estado solo admite los tres valores del contrato', () => {
  for (const status of ['available', 'occupied', 'out_of_service']) {
    assert.equal(parseStatusInput({ status }), status);
  }
  for (const body of [
    undefined,
    {},
    { status: 'AVAILABLE' },
    { status: 'closed' },
    { status: 1 },
    'occupied',
  ]) {
    assert.throws(() => parseStatusInput(body), code(400, 'VALIDATION_ERROR'));
  }
});

test('el ID debe ser un entero positivo que quepa en un integer de PostgreSQL', () => {
  assert.equal(parseTableId('1'), 1);
  assert.equal(parseTableId('2147483647'), 2147483647);
  for (const raw of ['0', '-1', '01', '1.5', 'abc', '', '2147483648', '99999999999', '1e3', ' 1']) {
    assert.throws(() => parseTableId(raw), code(400, 'VALIDATION_ERROR'), raw);
  }
});

test('el servicio lista, crea y cambia estados', async () => {
  const service = new TablesService(fakeRepository());
  assert.deepEqual(await service.list(), []);
  const created = await service.create({ name: 'Terraza 1', capacity: 6 });
  assert.deepEqual(created, { id: 1, name: 'Terraza 1', capacity: 6, status: 'available' });
  const updated = await service.updateStatus('1', { status: 'occupied' });
  assert.equal(updated.status, 'occupied');
  assert.equal((await service.list())[0].status, 'occupied');
});

test('un nombre duplicado (23505) se convierte en 409 sin exponer el mensaje de PostgreSQL', async () => {
  const service = new TablesService(fakeRepository());
  await service.create({ name: 'Mesa 1', capacity: 4 });
  await assert.rejects(service.create({ name: ' mesa 1 ', capacity: 2 }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'DUPLICATE_TABLE');
    assert.doesNotMatch(error.message, /duplicate key|constraint/i);
    return true;
  });
});

test('cambiar el estado de una mesa inexistente da 404 y los datos inválidos 400', async () => {
  const service = new TablesService(fakeRepository());
  await assert.rejects(
    service.updateStatus('999', { status: 'occupied' }),
    code(404, 'TABLE_NOT_FOUND'),
  );
  await assert.rejects(
    service.updateStatus('abc', { status: 'occupied' }),
    code(400, 'VALIDATION_ERROR'),
  );
  await assert.rejects(
    service.updateStatus('1', { status: 'otro' }),
    code(400, 'VALIDATION_ERROR'),
  );
});

test('los errores inesperados del repositorio no se disfrazan de errores de cliente', async () => {
  const repository = fakeRepository();
  repository.create = async () => {
    throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
  };
  await assert.rejects(
    new TablesService(repository).create({ name: 'Mesa', capacity: 2 }),
    (error) => error.code === 'ECONNREFUSED' && error.status === undefined,
  );
});
