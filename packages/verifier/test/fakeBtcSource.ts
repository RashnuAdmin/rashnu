import type { BitcoinBlockSource, BlockHeader, BlockTransactions } from "../src/btc-source";
import type { BlockHeight, TxId } from "../src/types";

export interface FakeBlock {
  height: BlockHeight;
  hash: string;
  timestamp: number;
  txIds: TxId[];
}

/**
 * In-memory BitcoinBlockSource for tests. No network calls - the RNG algorithm is
 * tested purely against data supplied here, whether that data is a real pinned
 * fixture or hand-constructed to exercise a specific code path.
 */
export class FakeBitcoinBlockSource implements BitcoinBlockSource {
  private readonly blocksByHeight = new Map<number, FakeBlock>();
  private tipHeight: BlockHeight;

  constructor(blocks: FakeBlock[], tipHeight: BlockHeight) {
    for (const block of blocks) {
      this.blocksByHeight.set(block.height, block);
    }
    this.tipHeight = tipHeight;
  }

  setTipHeight(height: BlockHeight): void {
    this.tipHeight = height;
  }

  async getTipHeight(): Promise<BlockHeight> {
    return this.tipHeight;
  }

  async getBlockHeader(height: BlockHeight): Promise<BlockHeader> {
    const block = this.require(height);
    return {
      height: block.height,
      hash: block.hash,
      timestamp: block.timestamp,
      transactionCount: block.txIds.length,
    };
  }

  async getBlockTransactions(height: BlockHeight): Promise<BlockTransactions> {
    const block = this.require(height);
    return { height: block.height, txIds: block.txIds };
  }

  async getHeightAtOrBeforeTimestamp(cutoffUnixSeconds: number): Promise<BlockHeight> {
    let best: FakeBlock | undefined;
    for (const block of this.blocksByHeight.values()) {
      if (block.timestamp <= cutoffUnixSeconds && (!best || block.height > best.height)) {
        best = block;
      }
    }
    if (!best) {
      throw new Error(`FakeBitcoinBlockSource has no block at or before timestamp ${cutoffUnixSeconds}`);
    }
    return best.height;
  }

  private require(height: BlockHeight): FakeBlock {
    const block = this.blocksByHeight.get(height);
    if (!block) {
      throw new Error(`FakeBitcoinBlockSource has no block at height ${height}`);
    }
    return block;
  }
}
