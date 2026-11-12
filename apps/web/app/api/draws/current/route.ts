import { count, eq } from "drizzle-orm";
import { connection } from "next/server";
import { draws, getDb, tickets } from "@lotto/db";

export async function GET() {
  // Nothing here reads cookies/params/searchParams, so Cache Components has no
  // signal that this must be dynamic and would otherwise try to prerender it at
  // build time (when there's no real DATABASE_URL yet). connection() defers
  // execution to request time - the documented way to force that under Cache
  // Components now that `export const dynamic = "force-dynamic"` is removed.
  await connection();

  const db = getDb();

  const draw = await db.query.draws.findFirst({ where: eq(draws.status, "selling") });
  if (!draw) {
    return Response.json({ draw: null });
  }

  const [{ ticketsSold }] = await db
    .select({ ticketsSold: count() })
    .from(tickets)
    .where(eq(tickets.drawId, draw.id));

  return Response.json({
    draw: {
      id: draw.id,
      drawNumber: draw.drawNumber,
      cutoffAt: draw.cutoffAt,
      ticketPriceUsdc: draw.ticketPriceUsdc.toString(),
      minTicketsThreshold: draw.minTicketsThreshold,
      depositAddress: draw.depositAddress,
      ticketsSold,
    },
  });
}
