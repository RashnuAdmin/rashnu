import { and, asc, eq, max } from "drizzle-orm";
import { createPublicClient, http, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";
import { connection } from "next/server";
import { draws, getDb, payments, tickets } from "@lotto/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { reconcilePayment } from "@/lib/reconciliation";

/**
 * Polls for USDC Transfer events into the currently-selling draw's deposit address,
 * records them as payments, and reconciles each payer's cumulative confirmed total
 * against their pending tickets. Manually triggered for M3 testing - M4 wires this
 * (and the rest of the draw lifecycle) into a scheduled Vercel Cron / Workflow.
 */

const MIN_CONFIRMATIONS = 2;
const DEFAULT_LOOKBACK_BLOCKS = 2_000n;
/** Base's public RPC caps eth_getLogs at a 200-block range - confirmed by hitting
 * this limit directly, not assumed. A dedicated provider (Alchemy/Infura) typically
 * allows much wider ranges, but chunking works regardless of which is configured. */
const MAX_BLOCK_RANGE_PER_REQUEST = 200n;

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export async function GET(request: Request) {
  // No cookies/params read here either - see the comment in draws/current/route.ts.
  await connection();

  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const usdcAddress = process.env.USDC_ADDRESS;
  if (!usdcAddress) {
    throw new Error("Missing required environment variable: USDC_ADDRESS");
  }

  const db = getDb();
  const draw = await db.query.draws.findFirst({ where: eq(draws.status, "selling") });
  if (!draw) {
    return Response.json({ newPayments: 0, confirmedTickets: 0, reason: "no draw currently selling" });
  }

  const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });
  const tipBlock = await client.getBlockNumber();

  const [{ maxBlock }] = await db
    .select({ maxBlock: max(payments.blockNumber) })
    .from(payments)
    .where(eq(payments.drawId, draw.id));

  const fromBlock = maxBlock !== null ? BigInt(maxBlock) + 1n : tipBlock > DEFAULT_LOOKBACK_BLOCKS ? tipBlock - DEFAULT_LOOKBACK_BLOCKS : 0n;

  const logs = [];
  for (let start = fromBlock; start <= tipBlock; start += MAX_BLOCK_RANGE_PER_REQUEST) {
    const end = start + MAX_BLOCK_RANGE_PER_REQUEST - 1n > tipBlock ? tipBlock : start + MAX_BLOCK_RANGE_PER_REQUEST - 1n;
    const chunk = await client.getLogs({
      address: usdcAddress as `0x${string}`,
      event: transferEvent,
      args: { to: draw.depositAddress as `0x${string}` },
      fromBlock: start,
      toBlock: end,
    });
    logs.push(...chunk);
  }

  let newPaymentsCount = 0;
  const touchedSenders = new Set<string>();

  for (const log of logs) {
    if (log.blockNumber === null || log.transactionHash === null) continue; // pending log, shouldn't happen for a mined-range query

    const confirmations = Number(tipBlock - log.blockNumber + 1n);
    const fromAddress = log.args.from!.toLowerCase();

    const inserted = await db
      .insert(payments)
      .values({
        drawId: draw.id,
        txHash: log.transactionHash,
        fromAddress,
        amountUsdc: log.args.value!,
        blockNumber: Number(log.blockNumber),
        confirmations,
        confirmedAt: confirmations >= MIN_CONFIRMATIONS ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });

    if (inserted.length > 0) {
      newPaymentsCount += 1;
      touchedSenders.add(fromAddress);
    }
  }

  let confirmedTicketsCount = 0;
  for (const fromAddress of touchedSenders) {
    const senderPayments = await db.query.payments.findMany({
      where: and(eq(payments.drawId, draw.id), eq(payments.fromAddress, fromAddress)),
    });
    const totalPaidUsdc = senderPayments
      .filter((p) => p.confirmedAt !== null)
      .reduce((sum, p) => sum + p.amountUsdc, 0n);

    const buyerTickets = await db.query.tickets.findMany({
      where: and(eq(tickets.drawId, draw.id), eq(tickets.buyerWalletAddress, fromAddress)),
      orderBy: asc(tickets.id),
    });
    const pendingTicketIds = buyerTickets.filter((t) => t.status === "pending_payment").map((t) => t.id);
    const alreadyConfirmedCount = buyerTickets.filter((t) => t.status === "confirmed").length;

    const result = reconcilePayment({
      totalPaidUsdc,
      ticketPriceUsdc: draw.ticketPriceUsdc,
      pendingTicketIds,
      alreadyConfirmedCount,
    });

    for (const ticketId of result.ticketsToConfirm) {
      await db
        .update(tickets)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(tickets.id, ticketId));
      confirmedTicketsCount += 1;
    }
  }

  return Response.json({ newPayments: newPaymentsCount, confirmedTickets: confirmedTicketsCount });
}
