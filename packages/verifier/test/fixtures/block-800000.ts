import { blockHeight, txId } from "../../src/types";

/**
 * Real Bitcoin block, pinned as a regression fixture. Independently verifiable by
 * anyone at https://mempool.space/block/00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054
 * (fetched via the mempool.space public API on 2026-11-11).
 */
export const BLOCK_800000 = {
  height: blockHeight(800000),
  hash: "00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054",
  timestamp: 1690168629,
  transactionCount: 3721,
  // First 10 txids, in block order (index 0 = coinbase). Real data; enough to exercise
  // any N in the single-digit range without needing the full 3721-entry list.
  firstTxIds: [
    txId("b75ca3106ed100521aa50e3ec267a06431c6319538898b25e1b757a5736f5fb4"),
    txId("d41f5de48325e79070ccd3a23005f7a3b405f3ce1faa4df09f6d71770497e9d5"),
    txId("c2f59c6fc8e812f5f1f00c8a0a9ab1929c1e796788c57f49001b8006a824ea17"),
    txId("965f866bf8623bbf956c1b2aeec1efc1ad162fd428ab7fb89f128a0754ebbc32"),
    txId("6033990087599ce3cc6fd6f90694736fb9d7912bf5b2eec973389adf29066634"),
    txId("9f93590c52c2f8c2090b111db3202cd02853cc674be5535aa29813cafa685ce9"),
    txId("b8075e230cabaf8318a5247c0c91b1de03b2b63336898d0cf2dd222e56fe592a"),
    txId("41bbcbed634b86ce645af38dcae0088fa6a2f3bd93d153b02422623a9973b38b"),
    txId("1d11c135b165b5d9fe07f1b015ed21536aa1c235ff75cd7da5e73746d464cc97"),
    txId("06cec2bd617a0ec4c6e2fc3c717f7b425d60eea9d9275e133930442b14ff77f7"),
  ],
};

/**
 * Hand-verified expected answer for N=3 (1-indexed, coinbase=position 1) against this
 * block: the 3rd transaction is firstTxIds[2]. Anyone can reproduce this by parsing
 * that txid as a big-endian unsigned integer and reducing mod a chosen ticket count -
 * see rng.test.ts.
 */
export const BLOCK_800000_THIRD_TX = BLOCK_800000.firstTxIds[2];
