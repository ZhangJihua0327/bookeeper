interface RequestCacheEntry<T> {
  fingerprint: string;
  expiresAt: number;
  pending: Promise<T>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("同一个 submissionId 不能用于不同的提交内容");
    this.name = "IdempotencyConflictError";
  }
}

export class ExpiringRequestCache<T> {
  private readonly entries = new Map<string, RequestCacheEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  async execute(
    key: string,
    fingerprint: string,
    operation: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    this.prune();
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError();
      return { value: await existing.pending, replayed: true };
    }

    const pending = operation();
    this.entries.set(key, {
      fingerprint,
      expiresAt: Date.now() + this.ttlMs,
      pending,
    });

    try {
      return { value: await pending, replayed: false };
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
