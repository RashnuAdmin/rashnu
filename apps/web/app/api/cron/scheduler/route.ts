import { and, eq } from "drizzle-orm";
import { connection } from "next/server";
import { start } from "workflow/api";
import { draws, getDb } from "@lotto/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { drawLifecycleWorkflow } from "@/workflows/draw-lifecycle";

/**
 * Finds any draw past its cutoff and still selling, atomically claims it
 * (selling -> closed, via a conditional UPDATE), and starts its lifecycle workflow.
 * The atomic claim is what makes this safe to run from overlapping cron ticks: if
 * two ticks race, only one update's WHERE clause matches, so only one of them
 * starts the workflow.
 */
export async function GET(request: Request) {
  await connection();
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();

  const candidates = await db.query.draws.findMany({ where: eq(draws.status, "selling") });
  const now = new Date();
  const startedDrawIds: number[] = [];

  for (const draw of candidates) {
    if (draw.cutoffAt > now) continue;

    const claimed = await db
      .update(draws)
      .set({ status: "closed" })
      .where(and(eq(draws.id, draw.id), eq(draws.status, "selling")))
      .returning({ id: draws.id });
    if (claimed.length === 0) continue; // another tick already claimed it

    await start(drawLifecycleWorkflow, [draw.id]);
    startedDrawIds.push(draw.id);
  }

  return Response.json({ startedDrawIds });
}
