import { constantTimeEqual } from "./timing-safe-equal";

/**
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on its own
 * invocations of this project's scheduled Cron Jobs once CRON_SECRET is set as a
 * project env var - no vercel.json config needed. Without this check, both
 * /api/cron/* routes were plain public GETs: anyone could trigger Base RPC log
 * scans or workflow starts directly, with no rate limit either.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable: CRON_SECRET");
  }
  const header = request.headers.get("authorization");
  if (!header) return false;
  return constantTimeEqual(header, `Bearer ${secret}`);
}
