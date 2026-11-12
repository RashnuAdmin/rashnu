import { describe, expect, it } from "vitest";
import { MempoolSpaceSource } from "../src/adapters/mempool-space-source";
import { blockHeight } from "../src/types";

/**
 * Unit tests for the binary-search logic via an injected fetchFn - no real network
 * call. The live-network path is covered separately by
 * test/integration/mempool-space-source.integration.test.ts.
 */
function fakeFetch(tipHeight: number, timestampByHeight: Record<number, number>): typeof fetch {
  const hashOf = (height: number) => `hash-${height}`;

  return (async (url: string | URL) => {
    const path = url.toString();

    if (path.endsWith("/blocks/tip/height")) {
      return new Response(String(tipHeight));
    }

    const heightMatch = /\/block-height\/(\d+)$/.exec(path);
    if (heightMatch) {
      return new Response(hashOf(Number(heightMatch[1])));
    }

    const blockMatch = /\/block\/hash-(\d+)$/.exec(path);
    if (blockMatch) {
      const height = Number(blockMatch[1]);
      const timestamp = timestampByHeight[height];
      if (timestamp === undefined) {
        return new Response("not found", { status: 404 });
      }
      return new Response(
        JSON.stringify({ id: hashOf(height), height, timestamp, tx_count: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`fakeFetch: unexpected request ${path}`);
  }) as typeof fetch;
}

function timestamps(tipHeight: number, secondsPerBlock: number): Record<number, number> {
  const result: Record<number, number> = {};
  for (let h = 0; h <= tipHeight; h++) {
    result[h] = h * secondsPerBlock;
  }
  return result;
}

describe("MempoolSpaceSource.getHeightAtOrBeforeTimestamp", () => {
  it("binary-searches to the exact height boundary", async () => {
    const source = new MempoolSpaceSource({ fetchFn: fakeFetch(10, timestamps(10, 100)) });
    await expect(source.getHeightAtOrBeforeTimestamp(550)).resolves.toBe(5);
  });

  it("returns height 0 for a cutoff between genesis and height 1", async () => {
    const source = new MempoolSpaceSource({ fetchFn: fakeFetch(10, timestamps(10, 100)) });
    await expect(source.getHeightAtOrBeforeTimestamp(50)).resolves.toBe(0);
  });

  it("returns the tip when the cutoff is after every known block", async () => {
    const source = new MempoolSpaceSource({ fetchFn: fakeFetch(10, timestamps(10, 100)) });
    await expect(source.getHeightAtOrBeforeTimestamp(100_000)).resolves.toBe(10);
  });

  it("throws when the cutoff is before genesis", async () => {
    const source = new MempoolSpaceSource({ fetchFn: fakeFetch(0, { 0: 100 }) });
    await expect(source.getHeightAtOrBeforeTimestamp(50)).rejects.toThrow(/no block/i);
  });
});

describe("MempoolSpaceSource basic getters", () => {
  it("getTipHeight reads the tip", async () => {
    const source = new MempoolSpaceSource({ fetchFn: fakeFetch(42, timestamps(42, 1)) });
    await expect(source.getTipHeight()).resolves.toBe(42);
  });

  it("getBlockHeader maps the raw response onto our BlockHeader shape", async () => {
    const source = new MempoolSpaceSource({ fetchFn: fakeFetch(5, timestamps(5, 10)) });
    const header = await source.getBlockHeader(blockHeight(3));
    expect(header).toEqual({ height: 3, hash: "hash-3", timestamp: 30, transactionCount: 1 });
  });

  it("uses the custom baseUrl when provided", async () => {
    let requestedUrl: string | undefined;
    const source = new MempoolSpaceSource({
      baseUrl: "https://example.test/api",
      fetchFn: (async (url: string | URL) => {
        requestedUrl = url.toString();
        return new Response("7");
      }) as typeof fetch,
    });
    await source.getTipHeight();
    expect(requestedUrl).toBe("https://example.test/api/blocks/tip/height");
  });
});
