import { describe, expect, it } from "vitest";
import { MempoolSpaceSource } from "../../src/adapters/mempool-space-source";
import { determineWinningTicket } from "../../src/rng";
import { blockHeight } from "../../src/types";
import { BLOCK_800000, BLOCK_800000_THIRD_TX } from "../fixtures/block-800000";

/**
 * Hits the real mempool.space API. Not part of the default `pnpm test` / CI run
 * (see vitest.config.ts) - network-dependent tests don't belong in a fast, reliable
 * CI suite. Run explicitly with `pnpm test:integration`.
 */
describe("MempoolSpaceSource (live network)", () => {
  it("fetches the real block 800000 header matching the pinned fixture", async () => {
    const source = new MempoolSpaceSource();
    const header = await source.getBlockHeader(BLOCK_800000.height);

    expect(header.hash).toBe(BLOCK_800000.hash);
    expect(header.timestamp).toBe(BLOCK_800000.timestamp);
    expect(header.transactionCount).toBe(BLOCK_800000.transactionCount);
  });

  it("fetches the real block 800000 txids matching the pinned fixture", async () => {
    const source = new MempoolSpaceSource();
    const { txIds } = await source.getBlockTransactions(BLOCK_800000.height);

    expect(txIds.slice(0, BLOCK_800000.firstTxIds.length)).toEqual(BLOCK_800000.firstTxIds);
  });

  it("finds the correct height for a timestamp just before block 800000", async () => {
    const source = new MempoolSpaceSource();
    const height = await source.getHeightAtOrBeforeTimestamp(BLOCK_800000.timestamp - 1);

    expect(height).toBe(blockHeight(BLOCK_800000.height - 1));
  });

  it("runs the full RNG algorithm end to end against live data for a long-settled draw", async () => {
    const source = new MempoolSpaceSource();

    const result = await determineWinningTicket(source, {
      cutoffUnixSeconds: BLOCK_800000.timestamp - 1,
      rngN: 3,
      confirmationsRequired: 6,
      totalTicketsSold: 100,
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("unreachable");
    expect(result.qualifyingBlockHeight).toBe(BLOCK_800000.height);
    expect(result.winningTxId).toBe(BLOCK_800000_THIRD_TX);
    expect(result.winningTicketIndex).toBe(99);
  });
});
