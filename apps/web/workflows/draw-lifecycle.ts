import { sleep, FatalError } from "workflow";
import { and, asc, count, eq, max } from "drizzle-orm";
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { draws, drawResults, getDb, tickets } from "@lotto/db";
import { erc20ApproveAbi, lotteryPoolAbi } from "@lotto/contracts-sdk";
import {
  MempoolSpaceSource,
  canonicalizeTicketList,
  determineWinningTicket,
  hashTicketList,
  type RngResolved,
} from "rashnu-verifier";

/**
 * Orchestrates one draw from cutoff through settlement. Triggered by
 * app/api/cron/scheduler/route.ts once that route atomically claims the draw
 * (selling -> closed) - this function assumes that's already happened and never
 * re-claims it itself. Every step below is written to be safe to replay (the
 * Workflow SDK caches completed steps' results, but a given draw could also in
 * principle be re-triggered by a bug, so each step re-checks DB state before
 * doing anything that moves money).
 */
export async function drawLifecycleWorkflow(drawId: number) {
  "use workflow";

  const closeResult = await closeSalesAndPublish(drawId);

  if (closeResult.confirmedCount < closeResult.minTicketsThreshold) {
    await rolloverDraw(drawId);
    return { outcome: "rolled_over" as const, drawId };
  }

  await fundDrawOnChain(drawId);

  let rngResult = await checkRngStatus(drawId);
  while (rngResult.status === "pending") {
    await sleep("5m");
    rngResult = await checkRngStatus(drawId);
  }

  await persistDrawResult(drawId, rngResult);
  await submitResultOnChain(drawId, rngResult);
  await createNextScheduledDraw(drawId);

  return { outcome: "settled" as const, drawId };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new FatalError(`Missing required environment variable: ${name}`);
  return value;
}

function toBytes32(hex: string): Hex {
  const withoutPrefix = hex.startsWith("0x") ? hex.slice(2) : hex;
  return `0x${withoutPrefix.padStart(64, "0")}` as Hex;
}

/** Step 1: order confirmed tickets, void unpaid ones, commit the canonical hash. */
async function closeSalesAndPublish(drawId: number) {
  "use step";
  const db = getDb();

  const draw = await db.query.draws.findFirst({ where: eq(draws.id, drawId) });
  if (!draw) throw new FatalError(`draw ${drawId} not found`);
  if (draw.ticketListHash) {
    // already done (replay or re-trigger) - don't reassign indexes a second time
    const [{ confirmedCount }] = await db
      .select({ confirmedCount: count() })
      .from(tickets)
      .where(and(eq(tickets.drawId, drawId), eq(tickets.status, "confirmed")));
    return { confirmedCount, minTicketsThreshold: draw.minTicketsThreshold };
  }

  const confirmedTickets = await db.query.tickets.findMany({
    where: and(eq(tickets.drawId, drawId), eq(tickets.status, "confirmed")),
    orderBy: asc(tickets.id),
  });

  for (let i = 0; i < confirmedTickets.length; i++) {
    await db.update(tickets).set({ ticketIndex: i }).where(eq(tickets.id, confirmedTickets[i]!.id));
  }

  // A pending (never-paid) ticket can never be confirmed for this draw once sales
  // are closed - void it rather than leaving it dangling.
  await db
    .update(tickets)
    .set({ status: "void" })
    .where(and(eq(tickets.drawId, drawId), eq(tickets.status, "pending_payment")));

  const entries = confirmedTickets.map((t, i) => ({
    ticketIndex: i,
    buyerWalletAddress: t.buyerWalletAddress,
    ticketPublicId: t.publicId,
    confirmedAt: t.confirmedAt!.toISOString(),
  }));
  const ticketListHash = toBytes32(hashTicketList(canonicalizeTicketList(entries)));

  await db
    .update(draws)
    .set({ ticketListHash, ticketListPublishedAt: new Date() })
    .where(eq(draws.id, drawId));

  return { confirmedCount: confirmedTickets.length, minTicketsThreshold: draw.minTicketsThreshold };
}

/** Rollover path: no contract call - tickets and pot carry to a fresh next draw. */
async function rolloverDraw(drawId: number) {
  "use step";
  const db = getDb();

  const draw = await db.query.draws.findFirst({ where: eq(draws.id, drawId) });
  if (!draw) throw new FatalError(`draw ${drawId} not found`);
  if (draw.status === "rolled_over") return; // already done

  const [{ maxDrawNumber }] = await db.select({ maxDrawNumber: max(draws.drawNumber) }).from(draws);
  const nextCutoffAt = new Date(draw.cutoffAt.getTime() + 24 * 60 * 60 * 1000);

  const [nextDraw] = await db
    .insert(draws)
    .values({
      drawNumber: (maxDrawNumber ?? 0) + 1,
      cutoffAt: nextCutoffAt,
      status: "selling",
      ticketPriceUsdc: draw.ticketPriceUsdc,
      minTicketsThreshold: draw.minTicketsThreshold,
      depositAddress: draw.depositAddress,
      rngN: draw.rngN,
      confirmationsRequired: draw.confirmationsRequired,
      rolledFromDrawId: draw.id,
    })
    .returning();
  if (!nextDraw) throw new FatalError("failed to create rollover draw");

  const confirmedTickets = await db.query.tickets.findMany({
    where: and(eq(tickets.drawId, drawId), eq(tickets.status, "confirmed")),
  });

  for (const ticket of confirmedTickets) {
    await db.insert(tickets).values({
      drawId: nextDraw.id,
      buyerWalletAddress: ticket.buyerWalletAddress,
      status: "confirmed",
      confirmedAt: ticket.confirmedAt,
      rolledFromTicketId: ticket.id,
    });
  }

  await db
    .update(tickets)
    .set({ status: "rolled_forward" })
    .where(and(eq(tickets.drawId, drawId), eq(tickets.status, "confirmed")));

  await db
    .update(draws)
    .set({ status: "rolled_over", rolledIntoDrawId: nextDraw.id })
    .where(eq(draws.id, drawId));
}

/** Step: fund the on-chain pot, approving the pool first if the treasury's current
 * allowance isn't enough. Idempotent - returns the existing tx hash if already funded. */
async function fundDrawOnChain(drawId: number) {
  "use step";
  const db = getDb();

  const draw = await db.query.draws.findFirst({ where: eq(draws.id, drawId) });
  if (!draw) throw new FatalError(`draw ${drawId} not found`);
  if (draw.fundTxHash) return draw.fundTxHash;
  if (!draw.ticketListHash) throw new FatalError(`draw ${drawId} has no ticketListHash yet`);

  const [{ confirmedCount }] = await db
    .select({ confirmedCount: count() })
    .from(tickets)
    .where(and(eq(tickets.drawId, drawId), eq(tickets.status, "confirmed")));
  const amount = draw.ticketPriceUsdc * BigInt(confirmedCount);

  const poolAddress = requireEnv("LOTTERY_POOL_ADDRESS") as Hex;
  const usdcAddress = requireEnv("USDC_ADDRESS") as Hex;
  const transport = http(requireEnv("BASE_SEPOLIA_RPC_URL"));
  const account = privateKeyToAccount(requireEnv("TREASURY_PRIVATE_KEY") as Hex);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

  const allowance = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20ApproveAbi,
    functionName: "allowance",
    args: [account.address, poolAddress],
  });
  if (allowance < amount) {
    const approveTxHash = await walletClient.writeContract({
      address: usdcAddress,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [poolAddress, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
  }

  const fundTxHash = await walletClient.writeContract({
    address: poolAddress,
    abi: lotteryPoolAbi,
    functionName: "fundDraw",
    args: [
      BigInt(drawId),
      amount,
      BigInt(confirmedCount),
      draw.ticketListHash as Hex,
      BigInt(Math.floor(draw.cutoffAt.getTime() / 1000)),
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

  await db.update(draws).set({ status: "funded", fundTxHash, contractDrawId: BigInt(drawId) }).where(eq(draws.id, drawId));

  return fundTxHash;
}

/** Step: one poll of the RNG algorithm against live Bitcoin data - resolved or pending. */
async function checkRngStatus(drawId: number): Promise<RngResolved | { status: "pending"; reason: string }> {
  "use step";
  const db = getDb();

  const draw = await db.query.draws.findFirst({ where: eq(draws.id, drawId) });
  if (!draw) throw new FatalError(`draw ${drawId} not found`);

  const [{ confirmedCount }] = await db
    .select({ confirmedCount: count() })
    .from(tickets)
    .where(and(eq(tickets.drawId, drawId), eq(tickets.status, "confirmed")));

  await db.update(draws).set({ status: "awaiting_block" }).where(and(eq(draws.id, drawId), eq(draws.status, "funded")));

  const source = new MempoolSpaceSource();
  return determineWinningTicket(source, {
    cutoffUnixSeconds: Math.floor(draw.cutoffAt.getTime() / 1000),
    rngN: draw.rngN,
    confirmationsRequired: draw.confirmationsRequired,
    totalTicketsSold: confirmedCount,
  });
}

/** Step: map the winning index to the actual ticket/buyer and record the result. */
async function persistDrawResult(drawId: number, rngResult: RngResolved) {
  "use step";
  const db = getDb();

  const existing = await db.query.drawResults.findFirst({ where: eq(drawResults.drawId, drawId) });
  if (existing) return;

  const winningTicket = await db.query.tickets.findFirst({
    where: and(eq(tickets.drawId, drawId), eq(tickets.ticketIndex, rngResult.winningTicketIndex)),
  });
  if (!winningTicket) {
    throw new FatalError(`no ticket with index ${rngResult.winningTicketIndex} for draw ${drawId}`);
  }

  await db.insert(drawResults).values({
    drawId,
    qualifyingBtcBlockHeight: rngResult.qualifyingBlockHeight,
    qualifyingBtcBlockHash: rngResult.qualifyingBlockHash,
    qualifyingBtcBlockTime: new Date(rngResult.qualifyingBlockTimestamp * 1000),
    winningTxId: rngResult.winningTxId,
    winningTxIndexInBlock: rngResult.winningTxIndexInBlock,
    winningTicketIndex: rngResult.winningTicketIndex,
    winningTicketId: winningTicket.id,
    winnerWalletAddress: winningTicket.buyerWalletAddress,
    payoutAmountUsdc: 0n, // filled in from the on-chain event once submitResultOnChain confirms
    feeAmountUsdc: 0n,
    verifierVersion: "rashnu-verifier@0.1.0",
  });

  await db.update(draws).set({ status: "winner_computed" }).where(eq(draws.id, drawId));
}

/** Step: submit the result on-chain and record the authoritative payout/fee split
 * straight from the emitted event - never recompute it client-side. */
async function submitResultOnChain(drawId: number, rngResult: RngResolved) {
  "use step";
  const db = getDb();

  const draw = await db.query.draws.findFirst({ where: eq(draws.id, drawId) });
  if (!draw) throw new FatalError(`draw ${drawId} not found`);
  if (draw.status === "settled") return;

  const result = await db.query.drawResults.findFirst({ where: eq(drawResults.drawId, drawId) });
  if (!result) throw new FatalError(`draw ${drawId} has no draw_results row yet`);

  const poolAddress = requireEnv("LOTTERY_POOL_ADDRESS") as Hex;
  const transport = http(requireEnv("BASE_SEPOLIA_RPC_URL"));
  const account = privateKeyToAccount(requireEnv("OPERATOR_PRIVATE_KEY") as Hex);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

  const settleTxHash = await walletClient.writeContract({
    address: poolAddress,
    abi: lotteryPoolAbi,
    functionName: "submitResult",
    args: [
      BigInt(drawId),
      result.winnerWalletAddress as Hex,
      toBytes32(rngResult.winningTxId),
      rngResult.winningTicketIndex,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: settleTxHash });

  const [settledEvent] = parseEventLogs({ abi: lotteryPoolAbi, logs: receipt.logs, eventName: "DrawSettled" });
  if (!settledEvent) throw new FatalError(`DrawSettled event not found in receipt ${settleTxHash}`);

  await db
    .update(drawResults)
    .set({
      payoutAmountUsdc: settledEvent.args.payoutAmount,
      feeAmountUsdc: settledEvent.args.feeAmount,
      settlementTxHash: settleTxHash,
      settledAt: new Date(),
    })
    .where(eq(drawResults.drawId, drawId));

  await db.update(draws).set({ status: "settled" }).where(eq(draws.id, drawId));
}

/** Step: ensure the next nightly draw exists once this one has fully settled. */
async function createNextScheduledDraw(drawId: number) {
  "use step";
  const db = getDb();

  const draw = await db.query.draws.findFirst({ where: eq(draws.id, drawId) });
  if (!draw) throw new FatalError(`draw ${drawId} not found`);

  const alreadyExists = await db.query.draws.findFirst({ where: eq(draws.drawNumber, draw.drawNumber + 1) });
  if (alreadyExists) return alreadyExists.id;

  const nextCutoffAt = new Date(draw.cutoffAt.getTime() + 24 * 60 * 60 * 1000);
  const [nextDraw] = await db
    .insert(draws)
    .values({
      drawNumber: draw.drawNumber + 1,
      cutoffAt: nextCutoffAt,
      status: "selling",
      ticketPriceUsdc: draw.ticketPriceUsdc,
      minTicketsThreshold: draw.minTicketsThreshold,
      depositAddress: draw.depositAddress,
      rngN: draw.rngN,
      confirmationsRequired: draw.confirmationsRequired,
    })
    .returning();

  return nextDraw?.id;
}
