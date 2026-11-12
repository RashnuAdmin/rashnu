import { inArray } from "drizzle-orm";
import { connection } from "next/server";
import { draws, getDb } from "@lotto/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { findStaleDraws, NON_TERMINAL_POST_CUTOFF_STATUSES } from "@/lib/draw-health";
import { formatStaleDrawAlert, sendTelegramMessage } from "@/lib/telegram";

const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Runs once daily (Vercel Hobby's cron frequency cap - see vercel.json) - a
 * digest, not real-time alerting. Worst case, a draw that goes stale right
 * after one run waits until the next for a Telegram ping; it's still already
 * visible any time on /admin, which polls on every page load.
 */
export async function GET(request: Request) {
  await connection();

  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const candidates = await db.query.draws.findMany({
    where: inArray(draws.status, NON_TERMINAL_POST_CUTOFF_STATUSES),
  });

  const staleDraws = findStaleDraws(candidates, new Date(), STALE_AFTER_MS);
  const message = formatStaleDrawAlert(staleDraws);

  if (message) {
    await sendTelegramMessage(message);
  }

  return Response.json({ staleDraws, alertSent: message !== null });
}
