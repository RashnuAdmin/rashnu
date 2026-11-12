import { and, eq } from "drizzle-orm";
import { draws, getDb, tickets } from "@lotto/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";

const MAX_TICKETS_PER_REQUEST = 1000;

export async function POST(request: Request, { params }: { params: Promise<{ drawNumber: string }> }) {
  const session = await getSession();
  if (!session.walletAddress) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { allowed } = await checkRateLimit(`tickets:${session.walletAddress}`, 10, 60_000);
  if (!allowed) {
    return Response.json({ error: "Too many ticket purchase requests - try again in a minute" }, { status: 429 });
  }

  const { drawNumber: drawNumberParam } = await params;
  const drawNumber = Number(drawNumberParam);
  if (!Number.isInteger(drawNumber)) {
    return Response.json({ error: "Invalid drawNumber" }, { status: 400 });
  }

  const { quantity } = (await request.json()) as { quantity?: number };
  if (!Number.isInteger(quantity) || quantity! < 1 || quantity! > MAX_TICKETS_PER_REQUEST) {
    return Response.json({ error: `quantity must be an integer between 1 and ${MAX_TICKETS_PER_REQUEST}` }, { status: 400 });
  }

  const db = getDb();
  const draw = await db.query.draws.findFirst({ where: and(eq(draws.drawNumber, drawNumber), eq(draws.status, "selling")) });
  if (!draw) {
    return Response.json({ error: "Draw is not open for ticket sales" }, { status: 409 });
  }
  if (new Date() >= draw.cutoffAt) {
    return Response.json({ error: "Draw's cutoff has already passed" }, { status: 409 });
  }

  const rows = Array.from({ length: quantity! }, () => ({
    drawId: draw.id,
    buyerWalletAddress: session.walletAddress!,
    status: "pending_payment" as const,
  }));
  const created = await db.insert(tickets).values(rows).returning({ publicId: tickets.publicId });

  return Response.json({
    ticketPublicIds: created.map((t) => t.publicId),
    totalDueUsdc: (draw.ticketPriceUsdc * BigInt(quantity!)).toString(),
    depositAddress: draw.depositAddress,
  });
}
