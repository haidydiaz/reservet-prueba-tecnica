// Cookies sin dependencias: solo necesitamos leer una y escribir una.
export const SESSION_COOKIE = 'reservet_sid';

// 32 bytes aleatorios en base64url = 43 caracteres. Descartar otros formatos evita consultar la base.
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
export const isTokenFormat = (value: string): boolean => TOKEN_FORMAT.test(value);

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type CookieOptions = { secure: boolean };

// HttpOnly: JavaScript de la página no puede leerla (mitiga robo por XSS).
// SameSite=Lax: el navegador no la envía en POST entre sitios distintos (mitiga CSRF).
// Secure: solo por HTTPS cuando está activado. Path=/ porque la API y la interfaz comparten origen.
function attributes({ secure }: CookieOptions): string[] {
  return ['Path=/', 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])];
}

export function sessionCookie(token: string, maxAgeMs: number, options: CookieOptions): string {
  const maxAge = Math.max(0, Math.floor(maxAgeMs / 1000));
  return [`${SESSION_COOKIE}=${token}`, `Max-Age=${maxAge}`, ...attributes(options)].join('; ');
}

export function clearedSessionCookie(options: CookieOptions): string {
  return [
    `${SESSION_COOKIE}=`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ...attributes(options),
  ].join('; ');
}
