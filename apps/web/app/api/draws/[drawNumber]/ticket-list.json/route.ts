import { asc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { draws, getDb, tickets } from "@lotto/db";
import { canonicalizeTicketList, hashTicketList } from "rashnu-verifier";

/**
 * The exact data used to compute ticketListHash, published so anyone can
 * independently recompute the hash committed on-chain in fundDraw - this and
 * src/ticket-list.ts's canonicalizeTicketList/hashTicketList are the same code
 * path the draw-lifecycle workflow itself uses, never a second implementation.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ drawNumber: string }> }) {
  await connection();

  const { drawNumber: drawNumberParam } = await params;
  const drawNumber = Number(drawNumberParam);
  if (!Number.isInteger(drawNumber)) {
    return Response.json({ error: "Invalid drawNumber" }, { status: 400 });
  }

  const db = getDb();
  const draw = await db.query.draws.findFirst({ where: eq(draws.drawNumber, drawNumber) });
  if (!draw || !draw.ticketListHash) {
    return Response.json({ error: "Ticket list not published yet for this draw" }, { status: 404 });
  }

  const confirmedTickets = await db.query.tickets.findMany({
    where: eq(tickets.drawId, draw.id),
    orderBy: asc(tickets.ticketIndex),
  });

  const entries = confirmedTickets
    .filter((t) => t.ticketIndex !== null)
    .map((t) => ({
      ticketIndex: t.ticketIndex!,
      buyerWalletAddress: t.buyerWalletAddress,
      ticketPublicId: t.publicId,
      confirmedAt: t.confirmedAt!.toISOString(),
    }));

  const canonicalCsv = canonicalizeTicketList(entries);
  const recomputedHash = hashTicketList(canonicalCsv);

  return Response.json({
    drawNumber: draw.drawNumber,
    ticketListHash: draw.ticketListHash,
    ticketListPublishedAt: draw.ticketListPublishedAt,
    recomputedHashMatches: `0x${recomputedHash}` === draw.ticketListHash,
    entries,
    canonicalCsv,
  });
}
