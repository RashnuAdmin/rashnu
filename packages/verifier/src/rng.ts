import type { BitcoinBlockSource, BlockHeader } from "./btc-source";
import { blockHeight, ticketIndex, type BlockHeight, type TicketIndex, type TxId } from "./types";

export interface RngParams {
  /** Draw cutoff timestamp, Unix seconds UTC. */
  cutoffUnixSeconds: number;
  /** 1-indexed position of the transaction to select, coinbase counted as position 1. */
  rngN: number;
  /** Confirmations required before a candidate block is treated as final. */
  confirmationsRequired: number;
  /** Total tickets sold for this draw - the modulus for the winning index. */
  totalTicketsSold: number;
  /** Safety valve: abort instead of walking forward forever past thin blocks. */
  maxWalkForwardHops?: number;
}

export interface RngResolved {
  status: "resolved";
  qualifyingBlockHeight: BlockHeight;
  qualifyingBlockHash: string;
  qualifyingBlockTimestamp: number;
  winningTxId: TxId;
  /** The N actually used to select within the qualifying block - equal to rngN. */
  winningTxIndexInBlock: number;
  winningTicketIndex: TicketIndex;
}

export interface RngPending {
  status: "pending";
  reason: string;
}

type QualifyingBlockOutcome = { status: "resolved"; header: BlockHeader } | RngPending;

const DEFAULT_MAX_WALK_FORWARD_HOPS = 20;

function validateRngParams(params: RngParams): void {
  if (!Number.isInteger(params.rngN) || params.rngN < 1) {
    throw new Error(`rngN must be a positive integer, got ${params.rngN}`);
  }
  if (!Number.isInteger(params.totalTicketsSold) || params.totalTicketsSold < 1) {
    throw new Error(`totalTicketsSold must be a positive integer, got ${params.totalTicketsSold}`);
  }
}

/**
 * Walks forward from `startHeight` until it finds a confirmed block with at least
 * `rngN` transactions, or determines that the next candidate isn't confirmed yet.
 * Isolated from determineWinningTicket so this - the only part of the algorithm with
 * a loop - can be tested and reasoned about on its own.
 */
async function findQualifyingBlock(
  source: BitcoinBlockSource,
  startHeight: BlockHeight,
  rngN: number,
  confirmationsRequired: number,
  maxHops: number,
): Promise<QualifyingBlockOutcome> {
  let candidateHeight = startHeight;

  for (let hops = 0; ; hops++) {
    const tip = await source.getTipHeight();
    if (tip < candidateHeight + confirmationsRequired - 1) {
      return {
        status: "pending",
        reason: `block ${candidateHeight} does not yet have ${confirmationsRequired} confirmations (tip is ${tip})`,
      };
    }

    const header = await source.getBlockHeader(candidateHeight);
    if (header.transactionCount >= rngN) {
      return { status: "resolved", header };
    }

    if (hops >= maxHops) {
      throw new Error(
        `exceeded ${maxHops} walk-forward hops looking for a block with >= ${rngN} transactions, starting at height ${startHeight}`,
      );
    }
    candidateHeight = blockHeight(candidateHeight + 1);
  }
}

/** Pure: derives the winning ticket from an already-qualifying block's transactions. */
function deriveWinningResult(header: BlockHeader, txIds: TxId[], rngN: number, totalTicketsSold: number): RngResolved {
  const winningTxId = txIds[rngN - 1];
  if (winningTxId === undefined) {
    throw new Error(
      `block ${header.height} reported transactionCount ${header.transactionCount} but getBlockTransactions returned only ${txIds.length} txids`,
    );
  }

  const winningIndex = BigInt(`0x${winningTxId}`) % BigInt(totalTicketsSold);

  return {
    status: "resolved",
    qualifyingBlockHeight: header.height,
    qualifyingBlockHash: header.hash,
    qualifyingBlockTimestamp: header.timestamp,
    winningTxId,
    winningTxIndexInBlock: rngN,
    winningTicketIndex: ticketIndex(Number(winningIndex)),
  };
}

/**
 * Implements the locked RNG spec (see docs/architecture.md in the main repo):
 * anchor to the first confirmed Bitcoin block after the cutoff, walk forward past any
 * block too thin to contain the Nth transaction, then derive the winning ticket index
 * from that transaction's id. Deterministic and side-effect-free given `source` - the
 * same function Rashnu's own orchestration calls is what `rashnu-verifier` runs for a
 * stranger with no access to anything but public Bitcoin data and the published
 * ticket count.
 */
export async function determineWinningTicket(
  source: BitcoinBlockSource,
  params: RngParams,
): Promise<RngResolved | RngPending> {
  validateRngParams(params);

  const maxHops = params.maxWalkForwardHops ?? DEFAULT_MAX_WALK_FORWARD_HOPS;
  const cutoffHeight = await source.getHeightAtOrBeforeTimestamp(params.cutoffUnixSeconds);
  const startHeight = blockHeight(cutoffHeight + 1);

  const outcome = await findQualifyingBlock(source, startHeight, params.rngN, params.confirmationsRequired, maxHops);
  if (outcome.status === "pending") {
    return outcome;
  }

  const { txIds } = await source.getBlockTransactions(outcome.header.height);
  return deriveWinningResult(outcome.header, txIds, params.rngN, params.totalTicketsSold);
}
