export interface ReconcilePaymentInput {
  /** Cumulative confirmed on-chain payments from this buyer, for this draw. */
  totalPaidUsdc: bigint;
  ticketPriceUsdc: bigint;
  /** This buyer's pending tickets for this draw, ordered oldest-first (id ASC). */
  pendingTicketIds: number[];
  /** How many of this buyer's tickets for this draw are already confirmed. */
  alreadyConfirmedCount: number;
}

export interface ReconcilePaymentResult {
  /** Subset of pendingTicketIds to mark confirmed now, oldest first. */
  ticketsToConfirm: number[];
  /** Paid but not yet enough for another ticket - not an error, just not there yet. */
  remainderUsdc: bigint;
  /** Paid beyond every pending ticket - flag for manual review, never auto-resolved. */
  overpaidUsdc: bigint;
}

/**
 * Pure function: given a buyer's cumulative confirmed payment for a draw, how many
 * of their pending tickets does that cover? Oldest-pending-first, never confirms more
 * than exist, never double-confirms what's already confirmed. The caller (the
 * payment-watcher cron) is responsible for all I/O - this only does the arithmetic,
 * so it's fully testable without a database or a chain.
 */
export function reconcilePayment(input: ReconcilePaymentInput): ReconcilePaymentResult {
  if (input.ticketPriceUsdc <= 0n) {
    throw new Error(`ticketPriceUsdc must be positive, got ${input.ticketPriceUsdc}`);
  }

  const affordableCount = input.totalPaidUsdc / input.ticketPriceUsdc;
  const newlyAffordableCount = affordableCount - BigInt(input.alreadyConfirmedCount);
  const toConfirmCount = Math.max(
    0,
    Math.min(input.pendingTicketIds.length, Number(newlyAffordableCount)),
  );

  const ticketsToConfirm = input.pendingTicketIds.slice(0, toConfirmCount);
  const accountedForCount = BigInt(input.alreadyConfirmedCount + toConfirmCount);
  const unaccountedUsdc = input.totalPaidUsdc - accountedForCount * input.ticketPriceUsdc;

  const allPendingConfirmed = toConfirmCount === input.pendingTicketIds.length;

  return {
    ticketsToConfirm,
    remainderUsdc: allPendingConfirmed ? 0n : unaccountedUsdc,
    overpaidUsdc: allPendingConfirmed ? unaccountedUsdc : 0n,
  };
}
