import 'dotenv/config';

// Validar configuración al arrancar evita errores confusos en la primera petición.
export function readConfig(env: NodeJS.ProcessEnv) {
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) {
    throw new Error('HOST debe ser 127.0.0.1 o 0.0.0.0.');
  }
  const appEnv = env.APP_ENV ?? 'dev';
  if (!['dev', 'pro'].includes(appEnv)) throw new Error('APP_ENV debe ser dev o pro.');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  if (!env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL. Copia .env.example a .env.');
  }
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL debe ser una URL de PostgreSQL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname) {
    throw new Error('DATABASE_URL debe usar postgres:// o postgresql:// con un servidor.');
  }
  // La sesión caduca sola; salir (logout) la revoca de inmediato en la base de datos.
  const sessionHours = Number(env.SESSION_TTL_HOURS ?? 8);
  if (!Number.isFinite(sessionHours) || sessionHours <= 0 || sessionHours > 720) {
    throw new Error('SESSION_TTL_HOURS debe ser un número mayor que 0 y de hasta 720.');
  }
  if (env.COOKIE_SECURE !== undefined && !['true', 'false'].includes(env.COOKIE_SECURE)) {
    throw new Error('COOKIE_SECURE debe ser true o false.');
  }
  // En producción la cookie solo viaja por HTTPS (el túnel/proxy termina TLS).
  const cookieSecure =
    env.COOKIE_SECURE === undefined ? appEnv === 'pro' : env.COOKIE_SECURE === 'true';
  return Object.freeze({
    port,
    host,
    appEnv,
    databaseUrl: env.DATABASE_URL,
    sessionTtlMs: Math.round(sessionHours * 60 * 60 * 1000),
    cookieSecure,
  });
}

export const config = readConfig(process.env);
