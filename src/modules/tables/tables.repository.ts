import type { Queryable } from '../../shared/database.js';

export const TABLE_STATUSES = ['available', 'occupied', 'out_of_service'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];
export type RestaurantTable = {
  id: number;
  name: string;
  capacity: number;
  status: TableStatus;
};

export interface TablesRepository {
  list(): Promise<RestaurantTable[]>;
  create(name: string, capacity: number): Promise<RestaurantTable>;
  updateStatus(id: number, status: TableStatus): Promise<RestaurantTable | null>;
}

// Solo SQL: sin validación ni HTTP. El índice único de la base es la defensa final contra
// duplicados (incluso con dos peticiones simultáneas); el servicio traduce su error 23505.
export class PgTablesRepository implements TablesRepository {
  constructor(private readonly db: Queryable) {}

  async list(): Promise<RestaurantTable[]> {
    const { rows } = await this.db.query<RestaurantTable>(
      'SELECT id, name, capacity, status FROM restaurant_tables ORDER BY id',
    );
    return rows;
  }

  async create(name: string, capacity: number): Promise<RestaurantTable> {
    const { rows } = await this.db.query<RestaurantTable>(
      `INSERT INTO restaurant_tables (name, capacity) VALUES ($1, $2)
       RETURNING id, name, capacity, status`,
      [name, capacity],
    );
    return rows[0];
  }

  async updateStatus(id: number, status: TableStatus): Promise<RestaurantTable | null> {
    const { rows } = await this.db.query<RestaurantTable>(
      `UPDATE restaurant_tables SET status = $2 WHERE id = $1
       RETURNING id, name, capacity, status`,
      [id, status],
    );
    return rows[0] ?? null;
  }
}
