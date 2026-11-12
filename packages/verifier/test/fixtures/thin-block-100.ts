import { blockHeight, txId } from "../../src/types";

/**
 * Real Bitcoin block, pinned as a regression fixture for the thin-block fallback
 * path: height 100 (mined 2009-01-10) genuinely has only the coinbase transaction -
 * independently verifiable at
 * https://mempool.space/block/000000007bc154e0fa7ea32218a72fe2c1bb9f86cf8c9ebf9a715ed27fdb229a
 * (fetched via the mempool.space public API on 2026-11-11). Blocks 100 through at
 * least 199 are all single-transaction in real history - early Bitcoin had near-zero
 * transaction volume - so this is a genuine, not contrived, thin-block case.
 */
export const THIN_BLOCK_100 = {
  height: blockHeight(100),
  hash: "000000007bc154e0fa7ea32218a72fe2c1bb9f86cf8c9ebf9a715ed27fdb229a",
  timestamp: 1231660825,
  transactionCount: 1,
  txIds: [
    // Single-tx block: the coinbase txid equals the merkle root.
    txId("2d05f0c9c3e1c226e63b5fac240137687544cf631cd616fd34fd188fc9020866"),
  ],
};
