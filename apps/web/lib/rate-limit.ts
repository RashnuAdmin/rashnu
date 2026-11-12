import { sql } from "drizzle-orm";
import { getDb, rateLimitBuckets } from "@lotto/db";

export function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * Vercel sets x-forwarded-for on every request; falls back to a constant key so
 * local dev (where it's absent) still works, just sharing one bucket.
 */
export function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Fixed-window counter, atomic via Postgres upsert (concurrent requests race on
 * the same row, not on application logic). Old windows are never cleaned up here -
 * this app's volume doesn't warrant it yet, but a cron sweep on rate_limit_buckets
 * older than a day would be the next step if that changes.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; count: number }> {
  const db = getDb();
  const start = windowStart(new Date(), windowMs);

  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });

  return { allowed: row.count <= limit, count: row.count };
}
