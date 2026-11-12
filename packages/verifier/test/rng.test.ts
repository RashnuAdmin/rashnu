import { describe, expect, it } from "vitest";
import { determineWinningTicket } from "../src/rng";
import { blockHeight, txId } from "../src/types";
import { FakeBitcoinBlockSource } from "./fakeBtcSource";
import { BLOCK_800000, BLOCK_800000_THIRD_TX } from "./fixtures/block-800000";
import { THIN_BLOCK_100 } from "./fixtures/thin-block-100";

describe("determineWinningTicket", () => {
  it("resolves against a real block, N=3 (1-indexed, coinbase=position 1)", async () => {
    const source = new FakeBitcoinBlockSource(
      [
        { height: blockHeight(799999), hash: "prev", timestamp: BLOCK_800000.timestamp - 600, txIds: [] },
        {
          height: BLOCK_800000.height,
          hash: BLOCK_800000.hash,
          timestamp: BLOCK_800000.timestamp,
          txIds: BLOCK_800000.firstTxIds,
        },
      ],
      blockHeight(800006), // tip: exactly 7 confirmations on 800000
    );

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
    // Hand-verified: BigInt("0x" + the real txid) % 100n === 99n.
    expect(result.winningTicketIndex).toBe(99);
  });

  it("treats the coinbase transaction as position 1 (N=1 selects the coinbase)", async () => {
    const source = new FakeBitcoinBlockSource(
      [
        { height: blockHeight(799999), hash: "prev", timestamp: BLOCK_800000.timestamp - 600, txIds: [] },
        {
          height: BLOCK_800000.height,
          hash: BLOCK_800000.hash,
          timestamp: BLOCK_800000.timestamp,
          txIds: BLOCK_800000.firstTxIds,
        },
      ],
      blockHeight(800006),
    );

    const result = await determineWinningTicket(source, {
      cutoffUnixSeconds: BLOCK_800000.timestamp - 1,
      rngN: 1,
      confirmationsRequired: 6,
      totalTicketsSold: 100,
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("unreachable");
    expect(result.winningTxId).toBe(BLOCK_800000.firstTxIds[0]);
  });

  it("walks forward past genuinely thin blocks to find one with >= N transactions", async () => {
    // Height 100 is real (fixtures/thin-block-100.ts) and really has only the
    // coinbase transaction. Heights 99/101/102 below are synthetic - hand-constructed
    // purely to exercise the walk-forward loop deterministically, not claimed as real.
    const synthenticQualifyingTxIds = ["1", "2", "3", "4"].map((digit) => txId(digit.repeat(64)));

    const source = new FakeBitcoinBlockSource(
      [
        { height: blockHeight(99), hash: "synthetic-99", timestamp: THIN_BLOCK_100.timestamp - 600, txIds: [] },
        { height: THIN_BLOCK_100.height, hash: THIN_BLOCK_100.hash, timestamp: THIN_BLOCK_100.timestamp, txIds: THIN_BLOCK_100.txIds },
        { height: blockHeight(101), hash: "synthetic-101", timestamp: THIN_BLOCK_100.timestamp + 600, txIds: [txId("a".repeat(64))] },
        { height: blockHeight(102), hash: "synthetic-102", timestamp: THIN_BLOCK_100.timestamp + 1200, txIds: synthenticQualifyingTxIds },
      ],
      blockHeight(108), // comfortably past height 102 + 6 confirmations
    );

    const result = await determineWinningTicket(source, {
      cutoffUnixSeconds: THIN_BLOCK_100.timestamp - 1,
      rngN: 3,
      confirmationsRequired: 6,
      totalTicketsSold: 1000,
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("unreachable");
    expect(result.qualifyingBlockHeight).toBe(102);
    expect(result.winningTxId).toBe(synthenticQualifyingTxIds[2]);
  });

  it("returns pending when the qualifying block does not yet have enough confirmations", async () => {
    const source = new FakeBitcoinBlockSource(
      [
        { height: blockHeight(799999), hash: "prev", timestamp: BLOCK_800000.timestamp - 600, txIds: [] },
        {
          height: BLOCK_800000.height,
          hash: BLOCK_800000.hash,
          timestamp: BLOCK_800000.timestamp,
          txIds: BLOCK_800000.firstTxIds,
        },
      ],
      blockHeight(800002), // only 3 confirmations - not enough for K=6
    );

    const result = await determineWinningTicket(source, {
      cutoffUnixSeconds: BLOCK_800000.timestamp - 1,
      rngN: 3,
      confirmationsRequired: 6,
      totalTicketsSold: 100,
    });

    expect(result.status).toBe("pending");
  });

  it("throws after exceeding the walk-forward hop cap", async () => {
    const blocks = [{ height: blockHeight(0), hash: "genesis", timestamp: 0, txIds: [] }];
    for (let h = 1; h <= 25; h++) {
      blocks.push({ height: blockHeight(h), hash: `synthetic-${h}`, timestamp: h * 600, txIds: [] }); // every block thin
    }

    const source = new FakeBitcoinBlockSource(blocks, blockHeight(100));

    await expect(
      determineWinningTicket(source, {
        cutoffUnixSeconds: 0,
        rngN: 3,
        confirmationsRequired: 1,
        totalTicketsSold: 100,
        maxWalkForwardHops: 20,
      }),
    ).rejects.toThrow(/walk-forward/);
  });

  it("rejects a non-positive rngN", async () => {
    const source = new FakeBitcoinBlockSource(
      [{ height: blockHeight(1), hash: "x", timestamp: 0, txIds: [] }],
      blockHeight(10),
    );
    await expect(
      determineWinningTicket(source, {
        cutoffUnixSeconds: 0,
        rngN: 0,
        confirmationsRequired: 1,
        totalTicketsSold: 100,
      }),
    ).rejects.toThrow(/rngN/);
  });

  it("rejects a non-positive totalTicketsSold", async () => {
    const source = new FakeBitcoinBlockSource(
      [{ height: blockHeight(1), hash: "x", timestamp: 0, txIds: [] }],
      blockHeight(10),
    );
    await expect(
      determineWinningTicket(source, {
        cutoffUnixSeconds: 0,
        rngN: 3,
        confirmationsRequired: 1,
        totalTicketsSold: 0,
      }),
    ).rejects.toThrow(/totalTicketsSold/);
  });
});
