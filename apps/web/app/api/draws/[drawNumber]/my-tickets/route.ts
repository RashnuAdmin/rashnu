import { and, asc, eq } from "drizzle-orm";
import { draws, getDb, tickets } from "@lotto/db";
import { getSession } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ drawNumber: string }> }) {
  const session = await getSession();
  if (!session.walletAddress) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { drawNumber: drawNumberParam } = await params;
  const drawNumber = Number(drawNumberParam);
  if (!Number.isInteger(drawNumber)) {
    return Response.json({ error: "Invalid drawNumber" }, { status: 400 });
  }

  const db = getDb();
  const draw = await db.query.draws.findFirst({ where: eq(draws.drawNumber, drawNumber) });
  if (!draw) {
    return Response.json({ error: "Draw not found" }, { status: 404 });
  }

  const myTickets = await db.query.tickets.findMany({
    where: and(eq(tickets.drawId, draw.id), eq(tickets.buyerWalletAddress, session.walletAddress)),
    orderBy: asc(tickets.id),
  });

  return Response.json({
    tickets: myTickets.map((t) => ({
      publicId: t.publicId,
      status: t.status,
      ticketIndex: t.ticketIndex,
      createdAt: t.createdAt,
    })),
  });
}
