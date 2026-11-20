import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "bookeeper_session";

export function sha256(value: unknown) {
  return createHash("sha256").update(String(value)).digest();
}

/** 定长比较，避免密码比对被计时攻击。 */
export function safeEqual(left: unknown, right: unknown) {
  const a = sha256(left);
  const b = sha256(right);
  return timingSafeEqual(a, b);
}

export function signSession(secret: string, ttlMs: number, now = Date.now()) {
  const expiresAt = now + ttlMs;
  const payload = `${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(secret: string, token: unknown, now = Date.now()) {
  if (!token || typeof token !== "string") return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function buildSessionCookie(token: string, { ttlMs, secure }: { ttlMs: number; secure: boolean }) {
  const maxAge = Math.floor(ttlMs / 1000);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** 简单的登录失败限流：同一 IP 5 分钟内最多 10 次。 */
export function createLoginLimiter({ windowMs = 5 * 60 * 1000, max = 10 } = {}) {
  const attempts = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string, now = Date.now()) {
      const entry = attempts.get(key);
      if (!entry || entry.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true };
      }
      entry.count += 1;
      return { allowed: entry.count <= max, retryAfterMs: entry.resetAt - now };
    },
    reset(key: string) {
      attempts.delete(key);
    },
  };
}
