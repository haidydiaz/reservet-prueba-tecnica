import { pool } from '../src/shared/database.js';
import { hashPassword } from '../src/shared/password.js';
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH } from '../src/modules/auth/auth.service.js';

// Crea (o actualiza) el usuario de prueba leyendo SEED_USERNAME y SEED_PASSWORD del entorno
// o de tu .env local. Así ninguna contraseña vive en Git y el comando se puede repetir:
// ejecutarlo otra vez cambia la contraseña y cierra las sesiones abiertas de ese usuario.
const MIN_PASSWORD_LENGTH = 8;

const username = process.env.SEED_USERNAME?.trim();
const password = process.env.SEED_PASSWORD;

try {
  if (!username || !password) {
    throw new Error('Define SEED_USERNAME y SEED_PASSWORD (ver .env.example).');
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    throw new Error(`SEED_USERNAME admite hasta ${MAX_USERNAME_LENGTH} caracteres.`);
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_PASSWORD debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`,
    );
  }
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (lower(username)) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [username, await hashPassword(password)],
  );
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
  // Nunca se imprime la contraseña.
  console.log(`Usuario listo: ${username}`);
} catch (error) {
  console.error('Seed fallido:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
