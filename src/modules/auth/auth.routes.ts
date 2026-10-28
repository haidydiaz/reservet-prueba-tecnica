import { Router, type RequestHandler } from 'express';
import { AppError, isRecord } from '../../shared/errors.js';
import type { AuthService } from './auth.service.js';
import { readSessionToken } from './auth.middleware.js';
import { clearedSessionCookie, sessionCookie } from './cookies.js';
import { LoginRateLimiter } from './rate-limiter.js';

type AuthRouterOptions = {
  sessionTtlMs: number;
  cookieSecure: boolean;
  limiter?: LoginRateLimiter;
  requireAuth: RequestHandler;
};

export function createAuthRouter(auth: AuthService, options: AuthRouterOptions) {
  const limiter = options.limiter ?? new LoginRateLimiter();
  const router = Router();

  router.post('/login', async (req, res) => {
    const body: unknown = req.body;
    const username = isRecord(body) ? body.username : undefined;
    const password = isRecord(body) ? body.password : undefined;
    // Se limita por IP + usuario: frena la fuerza bruta sin bloquear a otros usuarios.
    const key = `${req.ip ?? 'desconocida'}|${String(username).trim().toLowerCase().slice(0, 50)}`;

    if (limiter.isBlocked(key)) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Espera unos minutos');
    }

    let result;
    try {
      result = await auth.login(username, password);
    } catch (error) {
      if (error instanceof AppError && error.status === 401) limiter.recordFailure(key);
      throw error;
    }
    limiter.reset(key);

    // Si ya había una sesión en este navegador, se revoca: una sola sesión activa por login.
    await auth.logout(readSessionToken(req));
    res.setHeader(
      'Set-Cookie',
      sessionCookie(result.token, options.sessionTtlMs, { secure: options.cookieSecure }),
    );
    res.json({ user: result.user });
  });

  router.post('/logout', async (req, res) => {
    await auth.logout(readSessionToken(req));
    res.setHeader('Set-Cookie', clearedSessionCookie({ secure: options.cookieSecure }));
    res.status(204).end();
  });

  router.get('/me', options.requireAuth, (_req, res) => {
    res.json({ user: res.locals.user });
  });

  return router;
}
