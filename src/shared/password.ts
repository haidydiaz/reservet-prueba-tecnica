import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt viene con Node: no añade dependencias. Los parámetros se guardan dentro del hash
// (scrypt$N$r$p$sal$hash) para poder aumentarlos en el futuro sin invalidar cuentas existentes.
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

type ScryptParams = { N: number; r: number; p: number };

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...params, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, PARAMS);
  const { N, r, p } = PARAMS;
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

function parseHash(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return null;
  // Un hash manipulado no debe poder pedir cantidades absurdas de memoria o CPU.
  if (N > 1 << 20 || r > 32 || p > 16) return null;
  const salt = Buffer.from(parts[4], 'base64');
  const key = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || key.length === 0) return null;
  return { params: { N, r, p }, salt, key };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  try {
    const candidate = await derive(password, parsed.salt, parsed.params);
    // Comparación en tiempo constante: no revela cuántos bytes coinciden.
    return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
  } catch {
    return false;
  }
}

// Cuando el usuario no existe se calcula igualmente un hash. Así la respuesta tarda lo mismo
// y no se puede averiguar qué usuarios existen midiendo el tiempo.
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}
