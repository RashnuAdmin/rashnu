import type { BlockHeight, TxId } from "./types";

export interface BlockHeader {
  height: BlockHeight;
  hash: string;
  /** Unix seconds, as recorded in the block header. */
  timestamp: number;
  transactionCount: number;
}

export interface BlockTransactions {
  height: BlockHeight;
  /** Ordered exactly as they appear in the block, coinbase transaction included at index 0. */
  txIds: TxId[];
}

/**
 * Abstraction over "a source of confirmed Bitcoin block data". Implementations talk to a
 * public block explorer or a full node's RPC - the RNG algorithm in rng.ts only ever
 * depends on this interface, never on a concrete adapter, so it can be tested with a
 * fake and verified independently against any real backend.
 */
export interface BitcoinBlockSource {
  /** The height of the current chain tip. */
  getTipHeight(): Promise<BlockHeight>;

  /** The block header at a given height, as currently seen by this source. */
  getBlockHeader(height: BlockHeight): Promise<BlockHeader>;

  /** The ordered transaction ids of a given block. */
  getBlockTransactions(height: BlockHeight): Promise<BlockTransactions>;

  /** The highest block height whose header timestamp is <= the given Unix-seconds cutoff. */
  getHeightAtOrBeforeTimestamp(cutoffUnixSeconds: number): Promise<BlockHeight>;
}
