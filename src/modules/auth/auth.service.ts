import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors.js';
import { verifyAgainstDummy, verifyPassword } from '../../shared/password.js';
import type { AuthRepository, AuthUser } from './auth.repository.js';
import { isTokenFormat } from './cookies.js';

export const MAX_USERNAME_LENGTH = 50;
export const MAX_PASSWORD_LENGTH = 128;

export type LoginResult = { token: string; user: AuthUser; expiresAt: Date };

// El navegador guarda el token; la base de datos solo guarda su SHA-256.
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos');

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly options: { sessionTtlMs: number; now?: () => Date },
  ) {}

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  async login(username: unknown, password: unknown): Promise<LoginResult> {
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !username.trim() ||
      !password
    ) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Usuario y contraseña son obligatorios');
    }
    // Entradas imposibles se tratan como credenciales incorrectas, sin gastar CPU en hashear.
    if (username.trim().length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw invalidCredentials();
    }

    const user = await this.repository.findUserByUsername(username.trim());
    if (!user) {
      await verifyAgainstDummy(password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw invalidCredentials();

    // Token nuevo en cada login: evita la fijación de sesión.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + this.options.sessionTtlMs);
    await this.repository.createSession(hashToken(token), user.id, expiresAt);
    // Limpieza oportunista: una fallida aquí no debe impedir el login.
    await this.repository.deleteExpiredSessions().catch(() => undefined);
    return { token, user: { id: user.id, username: user.username }, expiresAt };
  }

  async authenticate(token: string | undefined): Promise<AuthUser | null> {
    if (!token || !isTokenFormat(token)) return null;
    return this.repository.findSessionUser(hashToken(token));
  }

  // Revocar = borrar la fila: el token deja de valer al instante, aunque la cookie siga copiada.
  async logout(token: string | undefined): Promise<void> {
    if (!token || !isTokenFormat(token)) return;
    await this.repository.deleteSession(hashToken(token));
  }
}
