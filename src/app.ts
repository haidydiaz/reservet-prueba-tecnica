import express from 'express';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { config } from './shared/config.js';
import { pool, type Queryable } from './shared/database.js';
import { AppError } from './shared/errors.js';
import { requireSameOrigin } from './shared/same-origin.js';
import { PgAuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { createRequireAuth } from './modules/auth/auth.middleware.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { LoginRateLimiter } from './modules/auth/rate-limiter.js';
import { PgTablesRepository } from './modules/tables/tables.repository.js';
import { TablesService } from './modules/tables/tables.service.js';
import { createTablesRouter } from './modules/tables/tables.routes.js';

type AppSettings = {
  sessionTtlMs: number;
  cookieSecure: boolean;
  // Inyectable para que las pruebas controlen el límite de intentos.
  limiter?: LoginRateLimiter;
};

// La aplicación se construye con una base inyectada: el servidor usa el pool real y las pruebas
// pueden usar otra conexión. Es el único lugar donde se conectan rutas, servicios y repositorios.
export function createApp(
  db: Queryable,
  settings: AppSettings = { sessionTtlMs: config.sessionTtlMs, cookieSecure: config.cookieSecure },
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      // Desarrollo local usa HTTP. HTTPS/HSTS se configuran al desplegar.
      strictTransportSecurity: false,
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'reservet' });
  });

  app.get('/health/db', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });

  const auth = new AuthService(new PgAuthRepository(db), { sessionTtlMs: settings.sessionTtlMs });
  const requireAuth = createRequireAuth(auth);
  const tables = new TablesService(new PgTablesRepository(db));

  // Las respuestas de la API contienen datos de sesión: nunca deben quedar en cachés.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', requireSameOrigin);
  app.use(
    '/api/auth',
    createAuthRouter(auth, {
      sessionTtlMs: settings.sessionTtlMs,
      cookieSecure: settings.cookieSecure,
      limiter: settings.limiter,
      requireAuth,
    }),
  );
  // Todas las rutas de mesas exigen sesión válida antes de llegar al servicio.
  app.use('/api/tables', requireAuth, createTablesRouter(tables));

  app.use((_req, res) => res.status(404).json({ message: 'Ruta no encontrada' }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof AppError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
          requestId: res.locals.requestId,
        });
        return;
      }
      if (error instanceof SyntaxError && 'body' in error) {
        res.status(400).json({
          code: 'INVALID_JSON',
          message: 'JSON inválido',
          requestId: res.locals.requestId,
        });
        return;
      }
      if (
        error &&
        typeof error === 'object' &&
        'type' in error &&
        error.type === 'entity.too.large'
      ) {
        res.status(413).json({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'JSON demasiado grande',
          requestId: res.locals.requestId,
        });
        return;
      }
      // No registrar cuerpos, credenciales ni parámetros SQL.
      console.error({
        event: 'request_failed',
        requestId: res.locals.requestId,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Error interno',
        requestId: res.locals.requestId,
      });
    },
  );
  return app;
}

export const app = createApp(pool);
