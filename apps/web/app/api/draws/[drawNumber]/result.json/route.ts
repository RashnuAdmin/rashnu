import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { draws, drawResults, getDb } from "@lotto/db";

export async function GET(_request: Request, { params }: { params: Promise<{ drawNumber: string }> }) {
  await connection();

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

  const result = await db.query.drawResults.findFirst({ where: eq(drawResults.drawId, draw.id) });

  return Response.json({
    drawNumber: draw.drawNumber,
    status: draw.status,
    cutoffAt: draw.cutoffAt,
    ticketPriceUsdc: draw.ticketPriceUsdc.toString(),
    ticketListHash: draw.ticketListHash,
    fundTxHash: draw.fundTxHash,
    contractDrawId: draw.contractDrawId?.toString() ?? null,
    rngN: draw.rngN,
    confirmationsRequired: draw.confirmationsRequired,
    rolledIntoDrawId: draw.rolledIntoDrawId,
    result: result
      ? {
          qualifyingBtcBlockHeight: result.qualifyingBtcBlockHeight,
          qualifyingBtcBlockHash: result.qualifyingBtcBlockHash,
          qualifyingBtcBlockTime: result.qualifyingBtcBlockTime,
          winningTxId: result.winningTxId,
          winningTxIndexInBlock: result.winningTxIndexInBlock,
          winningTicketIndex: result.winningTicketIndex,
          winnerWalletAddress: result.winnerWalletAddress,
          payoutAmountUsdc: result.payoutAmountUsdc.toString(),
          feeAmountUsdc: result.feeAmountUsdc.toString(),
          verifierVersion: result.verifierVersion,
          settlementTxHash: result.settlementTxHash,
          settledAt: result.settledAt,
        }
      : null,
  });
}
