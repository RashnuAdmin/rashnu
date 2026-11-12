import { inArray } from "drizzle-orm";
import { draws, getDb } from "@lotto/db";
import { getAdminActor } from "@/lib/admin-auth";
import { findStaleDraws, NON_TERMINAL_POST_CUTOFF_STATUSES } from "@/lib/draw-health";

const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const actor = await getAdminActor(request);
  if (!actor) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const candidates = await db.query.draws.findMany({
    where: inArray(draws.status, NON_TERMINAL_POST_CUTOFF_STATUSES),
  });

  const staleDraws = findStaleDraws(candidates, new Date(), STALE_AFTER_MS);

  return Response.json({ staleDraws });
}
