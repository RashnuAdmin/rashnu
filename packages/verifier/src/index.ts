export * from "./types";
export * from "./btc-source";
export * from "./rng";
export * from "./ticket-list";
export * from "./adapters/mempool-space-source";

// cli.ts is an entrypoint (invoked via bin/cli.js), not re-exported here - it runs
// main() as an import side effect, which a barrel export must never trigger.
// evm-reader.ts (reading LotteryPool's DrawSettled event) lands once the contract
// exists (M2+) - there's nothing on-chain yet to read.
