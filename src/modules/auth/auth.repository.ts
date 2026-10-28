import type { Queryable } from '../../shared/database.js';

export type AuthUser = { id: number; username: string };
export type UserRecord = AuthUser & { passwordHash: string };

export interface AuthRepository {
  findUserByUsername(username: string): Promise<UserRecord | null>;
  createSession(tokenHash: string, userId: number, expiresAt: Date): Promise<void>;
  findSessionUser(tokenHash: string): Promise<AuthUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;
}

type UserRow = { id: number; username: string; password_hash: string };

// Solo SQL: sin reglas de negocio ni HTTP. Todo parametrizado ($1, $2…), nunca concatenado.
export class PgAuthRepository implements AuthRepository {
  constructor(private readonly db: Queryable) {}

  async findUserByUsername(username: string): Promise<UserRecord | null> {
    const { rows } = await this.db.query<UserRow>(
      'SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)',
      [username],
    );
    const row = rows[0];
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : null;
  }

  async createSession(tokenHash: string, userId: number, expiresAt: Date): Promise<void> {
    await this.db.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, userId, expiresAt],
    );
  }

  async findSessionUser(tokenHash: string): Promise<AuthUser | null> {
    const { rows } = await this.db.query<{ id: number; username: string }>(
      `SELECT u.id, u.username
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ? { id: rows[0].id, username: rows[0].username } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async deleteExpiredSessions(): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE expires_at <= now()');
  }
}
