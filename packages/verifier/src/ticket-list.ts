import { createHash } from "node:crypto";

export interface TicketListEntry {
  ticketIndex: number;
  buyerWalletAddress: string;
  ticketPublicId: string;
  confirmedAt: string;
}

const COLUMNS: readonly (keyof TicketListEntry)[] = [
  "ticketIndex",
  "buyerWalletAddress",
  "ticketPublicId",
  "confirmedAt",
];

/**
 * Canonical form of a draw's ticket list: rows sorted by ticketIndex ascending,
 * comma-joined, LF-terminated (including the last row), UTF-8. Not JSON - JSON's
 * key-order/number-format ambiguity would make the hash non-reproducible across
 * independent implementations. This exact byte sequence is what hashTicketList
 * hashes and what gets committed on-chain.
 */
export function canonicalizeTicketList(entries: readonly TicketListEntry[]): string {
  const seenIndexes = new Set<number>();
  for (const entry of entries) {
    if (seenIndexes.has(entry.ticketIndex)) {
      throw new Error(`duplicate ticketIndex ${entry.ticketIndex} in ticket list`);
    }
    seenIndexes.add(entry.ticketIndex);

    for (const column of COLUMNS) {
      const value = String(entry[column]);
      if (value.includes(",") || value.includes("\n")) {
        throw new Error(
          `ticket list field "${column}" for ticketIndex ${entry.ticketIndex} contains a comma or newline: ${JSON.stringify(value)}`,
        );
      }
    }
  }

  const sorted = [...entries].sort((a, b) => a.ticketIndex - b.ticketIndex);

  return sorted
    .map((entry) => COLUMNS.map((column) => String(entry[column])).join(","))
    .map((row) => `${row}\n`)
    .join("");
}

/** SHA-256 hex digest of the canonical CSV's UTF-8 bytes. */
export function hashTicketList(canonicalCsv: string): string {
  return createHash("sha256").update(canonicalCsv, "utf8").digest("hex");
}
