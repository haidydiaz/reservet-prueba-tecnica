import pg from 'pg';
import { config } from './config.js';

// Lo mínimo que necesitan repositorios y rutas: permite probarlos con una base falsa.
export type Queryable = Pick<InstanceType<typeof pg.Pool>, 'query'>;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
  max: 10,
});
pool.on('error', (error) => console.error('Error de conexión PostgreSQL', error.message));
