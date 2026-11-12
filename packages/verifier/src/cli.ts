#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseComputeWinnerArgs, parseHashTicketsArgs } from "./cli-args";
import { MempoolSpaceSource } from "./adapters/mempool-space-source";
import { determineWinningTicket } from "./rng";
import { canonicalizeTicketList, hashTicketList, type TicketListEntry } from "./ticket-list";

/**
 * Standalone CLI for lotto-verifier. Once the LotteryPool contract exists (M2+),
 * this grows a `verify --contract <address> --draw-id <id>` command that reads a
 * draw's committed parameters directly from chain events (via evm-reader.ts) instead
 * of requiring every flag by hand. For now it exposes the underlying primitives
 * directly, which is already enough for an independent party to recompute a draw's
 * result from nothing but public data.
 *
 * Argument parsing/validation lives in cli-args.ts, deliberately separated from the
 * I/O below, so it's unit-testable without a network or filesystem.
 */

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.error(`rashnu-verifier - independently verify a Rashnu draw's fairness

Usage:
  rashnu-verifier compute-winner --cutoff <unix-seconds> --rng-n <n> \\
      --confirmations <k> --tickets <count> [--source mempool-space]

  rashnu-verifier hash-tickets --file <path-to-ticket-list.json>
      (JSON array of { ticketIndex, buyerWalletAddress, ticketPublicId, confirmedAt })
`);
}

export async function computeWinner(argv: string[]): Promise<void> {
  const parsed = parseComputeWinnerArgs(argv);
  if (!parsed.ok) {
    printUsage();
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  const source = new MempoolSpaceSource();
  const result = await determineWinningTicket(source, {
    cutoffUnixSeconds: parsed.cutoffUnixSeconds,
    rngN: parsed.rngN,
    confirmationsRequired: parsed.confirmationsRequired,
    totalTicketsSold: parsed.totalTicketsSold,
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "pending") {
    process.exitCode = 2;
  }
}

export async function hashTickets(argv: string[]): Promise<void> {
  const parsed = parseHashTicketsArgs(argv);
  if (!parsed.ok) {
    printUsage();
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  const entries = JSON.parse(readFileSync(parsed.file, "utf8")) as TicketListEntry[];
  const canonicalCsv = canonicalizeTicketList(entries);
  const hash = hashTicketList(canonicalCsv);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ticketCount: entries.length, sha256: hash }, null, 2));
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  switch (command) {
    case "compute-winner":
      await computeWinner(rest);
      return;
    case "hash-tickets":
      await hashTickets(rest);
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

// Deliberately no auto-run here (e.g. an import.meta.url entrypoint check) - that
// would run against this file's own URL, not bin/cli.js's, since the bin shim
// dynamically imports this module rather than being this module. The shim calls
// main() itself; this file stays a plain, side-effect-free export, safe to import
// directly in tests.
