import type { BitcoinBlockSource, BlockHeader, BlockTransactions } from "../btc-source";
import { blockHeight, txId, type BlockHeight } from "../types";

interface MempoolSpaceBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
}

export interface MempoolSpaceSourceOptions {
  /** Defaults to the public mempool.space instance. Point at a self-hosted instance if needed. */
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://mempool.space/api";

/**
 * BitcoinBlockSource backed by the public mempool.space REST API. This is one
 * replaceable adapter among possibly several (Blockstream, a full node's own RPC) -
 * the RNG algorithm in rng.ts depends only on the BitcoinBlockSource interface, never
 * on this class directly.
 */
export class MempoolSpaceSource implements BitcoinBlockSource {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: MempoolSpaceSourceOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getTipHeight(): Promise<BlockHeight> {
    const text = await this.getText("/blocks/tip/height");
    return blockHeight(Number(text));
  }

  async getBlockHeader(height: BlockHeight): Promise<BlockHeader> {
    const hash = await this.getHashAtHeight(height);
    const block = await this.getJson<MempoolSpaceBlock>(`/block/${hash}`);
    return {
      height: blockHeight(block.height),
      hash: block.id,
      timestamp: block.timestamp,
      transactionCount: block.tx_count,
    };
  }

  async getBlockTransactions(height: BlockHeight): Promise<BlockTransactions> {
    const hash = await this.getHashAtHeight(height);
    const txIds = await this.getJson<string[]>(`/block/${hash}/txids`);
    return { height, txIds: txIds.map(txId) };
  }

  /**
   * Binary search over block heights for the highest height whose header timestamp
   * is <= cutoffUnixSeconds. Relies on block timestamps being effectively
   * monotonic in height (consensus only guarantees a timestamp greater than the
   * median of the preceding 11 blocks, so a very rare, very small amount of local
   * non-monotonicity is possible - acceptable here since this is a no-more-than-
   * one-block-off height lookup, not the RNG's core security property).
   */
  async getHeightAtOrBeforeTimestamp(cutoffUnixSeconds: number): Promise<BlockHeight> {
    const tip = await this.getTipHeight();
    let low = 0;
    let high = tip;
    let best: BlockHeight | undefined;

    while (low <= high) {
      const mid = blockHeight(Math.floor((low + high) / 2));
      const header = await this.getBlockHeader(mid);
      if (header.timestamp <= cutoffUnixSeconds) {
        best = mid;
        low = blockHeight(mid + 1);
      } else {
        high = blockHeight(mid - 1);
      }
    }

    if (best === undefined) {
      throw new Error(`No block at or before timestamp ${cutoffUnixSeconds} (genesis is after it)`);
    }
    return best;
  }

  private async getHashAtHeight(height: BlockHeight): Promise<string> {
    return this.getText(`/block-height/${height}`);
  }

  private async getText(path: string): Promise<string> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`mempool.space request failed: GET ${path} -> ${response.status}`);
    }
    return (await response.text()).trim();
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`mempool.space request failed: GET ${path} -> ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
