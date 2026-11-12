import { describe, expect, it } from "vitest";
import { canonicalizeTicketList, hashTicketList } from "../src/ticket-list";

describe("canonicalizeTicketList", () => {
  it("sorts by ticketIndex ascending regardless of input order", () => {
    const csv = canonicalizeTicketList([
      { ticketIndex: 1, buyerWalletAddress: "0xabc", ticketPublicId: "uuid-1", confirmedAt: "2026-01-01T00:00:00.000Z" },
      { ticketIndex: 0, buyerWalletAddress: "0xdef", ticketPublicId: "uuid-0", confirmedAt: "2026-01-01T00:00:01.000Z" },
    ]);

    expect(csv).toBe(
      "0,0xdef,uuid-0,2026-01-01T00:00:01.000Z\n1,0xabc,uuid-1,2026-01-01T00:00:00.000Z\n",
    );
  });

  it("throws on a duplicate ticketIndex", () => {
    expect(() =>
      canonicalizeTicketList([
        { ticketIndex: 0, buyerWalletAddress: "0xabc", ticketPublicId: "uuid-1", confirmedAt: "2026-01-01T00:00:00.000Z" },
        { ticketIndex: 0, buyerWalletAddress: "0xdef", ticketPublicId: "uuid-0", confirmedAt: "2026-01-01T00:00:01.000Z" },
      ]),
    ).toThrow(/duplicate ticketIndex/);
  });

  it("rejects a field containing a comma or newline", () => {
    expect(() =>
      canonicalizeTicketList([
        { ticketIndex: 0, buyerWalletAddress: "0xabc,evil", ticketPublicId: "uuid-1", confirmedAt: "2026-01-01T00:00:00.000Z" },
      ]),
    ).toThrow(/comma or newline/);
  });

  it("produces an empty string for an empty list", () => {
    expect(canonicalizeTicketList([])).toBe("");
  });
});

describe("hashTicketList", () => {
  it("matches an independently-computed SHA-256 for a known canonical CSV", () => {
    const csv = canonicalizeTicketList([
      { ticketIndex: 1, buyerWalletAddress: "0xabc", ticketPublicId: "uuid-1", confirmedAt: "2026-01-01T00:00:00.000Z" },
      { ticketIndex: 0, buyerWalletAddress: "0xdef", ticketPublicId: "uuid-0", confirmedAt: "2026-01-01T00:00:01.000Z" },
    ]);

    // Independently verified via `python3 -c "import hashlib; print(hashlib.sha256(b'...').hexdigest())"`.
    expect(hashTicketList(csv)).toBe(
      "5d5a45dc9f530202fb76f7354b9f8175fd6ca118bfaa5c8a01435c8da10377ff",
    );
  });

  it("is sensitive to row order before canonicalization would have fixed it", () => {
    // Guards against accidentally hashing pre-sort input - same rows, different order,
    // must hash differently if not run through canonicalizeTicketList first.
    expect(hashTicketList("a\nb\n")).not.toBe(hashTicketList("b\na\n"));
  });
});
