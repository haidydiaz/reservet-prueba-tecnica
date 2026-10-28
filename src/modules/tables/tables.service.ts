import { AppError, isRecord } from '../../shared/errors.js';
import {
  TABLE_STATUSES,
  type RestaurantTable,
  type TableStatus,
  type TablesRepository,
} from './tables.repository.js';

export const MAX_NAME_LENGTH = 80;
export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 20;
// Límite de integer en PostgreSQL: un ID mayor provocaría un error 22003 (500) en vez de un 400/404.
const MAX_ID = 2_147_483_647;

const validation = (message: string) => new AppError(400, 'VALIDATION_ERROR', message);

export function parseTableId(raw: string): number {
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > MAX_ID) {
    throw validation('El identificador debe ser un entero positivo');
  }
  return Number(raw);
}

export function parseCreateInput(body: unknown): { name: string; capacity: number } {
  if (!isRecord(body)) throw validation('Se esperaba un objeto JSON con name y capacity');
  const { name, capacity } = body;
  if (typeof name !== 'string') throw validation('El nombre debe ser texto');
  const trimmed = name.trim();
  // Array.from cuenta caracteres reales (no unidades UTF-16), igual que varchar(80) en PostgreSQL.
  if (trimmed.length === 0 || Array.from(trimmed).length > MAX_NAME_LENGTH) {
    throw validation(`El nombre debe tener entre 1 y ${MAX_NAME_LENGTH} caracteres`);
  }
  if (/\p{Cc}/u.test(trimmed))
    throw validation('El nombre no puede contener caracteres de control');
  if (
    typeof capacity !== 'number' ||
    !Number.isInteger(capacity) ||
    capacity < MIN_CAPACITY ||
    capacity > MAX_CAPACITY
  ) {
    throw validation(`La capacidad debe ser un entero entre ${MIN_CAPACITY} y ${MAX_CAPACITY}`);
  }
  return { name: trimmed, capacity };
}

export function parseStatusInput(body: unknown): TableStatus {
  const status = isRecord(body) ? body.status : undefined;
  if (typeof status !== 'string' || !(TABLE_STATUSES as readonly string[]).includes(status)) {
    throw validation(`El estado debe ser uno de: ${TABLE_STATUSES.join(', ')}`);
  }
  return status as TableStatus;
}

// 23505 = unique_violation en PostgreSQL.
const isUniqueViolation = (error: unknown): boolean => isRecord(error) && error.code === '23505';

export class TablesService {
  constructor(private readonly repository: TablesRepository) {}

  list(): Promise<RestaurantTable[]> {
    return this.repository.list();
  }

  async create(body: unknown): Promise<RestaurantTable> {
    const { name, capacity } = parseCreateInput(body);
    try {
      return await this.repository.create(name, capacity);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'DUPLICATE_TABLE', 'Ya existe una mesa con ese nombre');
      }
      throw error;
    }
  }

  async updateStatus(rawId: string, body: unknown): Promise<RestaurantTable> {
    const id = parseTableId(rawId);
    const status = parseStatusInput(body);
    const table = await this.repository.updateStatus(id, status);
    if (!table) throw new AppError(404, 'TABLE_NOT_FOUND', 'La mesa no existe');
    return table;
  }
}
