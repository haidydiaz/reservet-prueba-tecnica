import type { RequestHandler } from 'express';
import { AppError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Defensa extra contra CSRF además de SameSite=Lax: una petición que cambia datos y declara
// un Origin distinto del Host al que llega se rechaza. Los clientes sin Origin (curl, pruebas)
// no son navegadores atacados por otra web, así que pasan.
export const requireSameOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (SAFE_METHODS.has(req.method) || !origin) {
    next();
    return;
  }
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (originHost !== req.get('host')) {
    throw new AppError(403, 'CROSS_ORIGIN', 'Origen no permitido');
  }
  next();
};
