import { desc, eq, inArray, max, sql } from "drizzle-orm";
import { auditLog, draws, getDb, payments, tickets } from "@lotto/db";
import { getAdminActor } from "@/lib/admin-auth";
import { validateCreateDrawInput, type CreateDrawInput } from "@/lib/validate-draw-input";

export async function GET(request: Request) {
  const actor = await getAdminActor(request);
  if (!actor) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const allDraws = await db.query.draws.findMany({ orderBy: desc(draws.drawNumber) });

  const summaries = await Promise.all(
    allDraws.map(async (draw) => {
      const [ticketCounts] = await db
        .select({
          total: sql<number>`count(*)`,
          confirmed: sql<number>`count(*) filter (where ${tickets.status} = 'confirmed')`,
          pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending_payment')`,
        })
        .from(tickets)
        .where(eq(tickets.drawId, draw.id));

      const [paymentTotals] = await db
        .select({ totalPaidUsdc: sql<string>`coalesce(sum(${payments.amountUsdc}), 0)` })
        .from(payments)
        .where(eq(payments.drawId, draw.id));

      return {
        id: draw.id,
        drawNumber: draw.drawNumber,
        status: draw.status,
        cutoffAt: draw.cutoffAt,
        ticketPriceUsdc: draw.ticketPriceUsdc.toString(),
        minTicketsThreshold: draw.minTicketsThreshold,
        depositAddress: draw.depositAddress,
        tickets: ticketCounts,
        totalPaidUsdc: paymentTotals.totalPaidUsdc,
      };
    }),
  );

  return Response.json({ draws: summaries });
}

export async function POST(request: Request) {
  const actor = await getAdminActor(request);
  if (!actor) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<CreateDrawInput>;
  const validated = validateCreateDrawInput(body);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  const db = getDb();

  // At most one draw is ever active at a time (ADR-008's "one recurring draw"
  // cadence) - reject rather than silently creating an ambiguous second one that
  // every "current draw" lookup elsewhere would have no principled way to pick
  // between.
  const activeStatuses = ["selling", "closed", "published", "funded", "awaiting_block", "winner_computed"] as const;
  const activeDraw = await db.query.draws.findFirst({ where: inArray(draws.status, activeStatuses) });
  if (activeDraw) {
    return Response.json(
      { error: `Draw #${activeDraw.drawNumber} is already active (status: ${activeDraw.status})` },
      { status: 409 },
    );
  }

  const [{ maxDrawNumber }] = await db.select({ maxDrawNumber: max(draws.drawNumber) }).from(draws);
  const drawNumber = (maxDrawNumber ?? 0) + 1;

  const [created] = await db
    .insert(draws)
    .values({
      drawNumber,
      cutoffAt: validated.cutoffAt,
      status: "selling",
      ticketPriceUsdc: validated.ticketPriceUsdc,
      minTicketsThreshold: validated.minTicketsThreshold,
      depositAddress: validated.depositAddress,
      rngN: validated.rngN,
      confirmationsRequired: validated.confirmationsRequired,
    })
    .returning();

  await db.insert(auditLog).values({
    entityType: "draw",
    entityId: String(created.id),
    eventType: "draw_created",
    payload: { drawNumber, ticketPriceUsdc: validated.ticketPriceUsdc.toString(), minTicketsThreshold: validated.minTicketsThreshold },
    actor,
  });

  return Response.json({ draw: { ...created, ticketPriceUsdc: created.ticketPriceUsdc.toString() } });
}
