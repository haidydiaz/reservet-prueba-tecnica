import type { Request, RequestHandler } from 'express';
import { AppError } from '../../shared/errors.js';
import type { AuthService } from './auth.service.js';
import { SESSION_COOKIE, readCookie } from './cookies.js';

export const readSessionToken = (req: Request): string | undefined =>
  readCookie(req.headers.cookie, SESSION_COOKIE);

// La protección vive en el servidor: sin sesión válida, ninguna ruta detrás de este
// middleware responde, aunque alguien llame a la API sin pasar por la interfaz.
export function createRequireAuth(auth: AuthService): RequestHandler {
  return async (req, res, next) => {
    const user = await auth.authenticate(readSessionToken(req));
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Autenticación requerida');
    res.locals.user = user;
    next();
  };
}
