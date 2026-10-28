// Limita intentos de login fallidos por clave (IP + usuario) en una ventana de tiempo.
// Vive en memoria: se reinicia con el servidor y no se comparte entre instancias. Es suficiente
// para una sola instancia; con varias habría que moverlo a la base de datos o a un proxy.
export class LoginRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  private active(key: string): { count: number; resetAt: number } | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.resetAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  isBlocked(key: string): boolean {
    return (this.active(key)?.count ?? 0) >= this.maxFailures;
  }

  retryAfterSeconds(key: string): number {
    const entry = this.active(key);
    return entry ? Math.max(1, Math.ceil((entry.resetAt - this.now()) / 1000)) : 0;
  }

  recordFailure(key: string): void {
    const entry = this.active(key);
    if (entry) entry.count += 1;
    else this.entries.set(key, { count: 1, resetAt: this.now() + this.windowMs });
    if (this.entries.size > 5000) this.prune();
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune(): void {
    for (const key of [...this.entries.keys()]) this.active(key);
  }
}
