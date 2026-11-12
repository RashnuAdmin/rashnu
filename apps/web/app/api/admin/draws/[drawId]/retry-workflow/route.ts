import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import { auditLog, draws, getDb } from "@lotto/db";
import { getAdminActor } from "@/lib/admin-auth";
import { drawLifecycleWorkflow } from "@/workflows/draw-lifecycle";

/**
 * Manually (re)starts a draw's lifecycle workflow - for when a run failed outright
 * (exhausted its retries) rather than being mid-flight, since the scheduler only
 * ever looks for status='selling' draws and won't pick a 'closed'-but-stuck one
 * back up on its own. Every step in draw-lifecycle.ts re-checks DB state before
 * doing anything side-effecting, so restarting is safe even partway through.
 */
export async function POST(request: Request, { params }: { params: Promise<{ drawId: string }> }) {
  const actor = await getAdminActor(request);
  if (!actor) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { drawId: drawIdParam } = await params;
  const drawId = Number(drawIdParam);
  if (!Number.isInteger(drawId)) {
    return Response.json({ error: "Invalid drawId" }, { status: 400 });
  }

  const db = getDb();
  const draw = await db.query.draws.findFirst({ where: eq(draws.id, drawId) });
  if (!draw) {
    return Response.json({ error: "Draw not found" }, { status: 404 });
  }
  const retryableStatuses = ["closed", "published", "funded", "awaiting_block", "winner_computed"];
  if (!retryableStatuses.includes(draw.status)) {
    return Response.json(
      { error: `Draw status '${draw.status}' is not retryable (expected one of: ${retryableStatuses.join(", ")})` },
      { status: 409 },
    );
  }

  const run = await start(drawLifecycleWorkflow, [drawId]);

  await db.insert(auditLog).values({
    entityType: "draw",
    entityId: String(drawId),
    eventType: "workflow_retried",
    payload: { previousStatus: draw.status, runId: run.runId },
    actor,
  });

  return Response.json({ drawId, runId: run.runId });
}
