import { describe, expect, it } from "vitest";
import { reconcilePayment } from "../lib/reconciliation";

describe("reconcilePayment", () => {
  it("confirms exactly the tickets fully covered by cumulative payment", () => {
    const result = reconcilePayment({
      totalPaidUsdc: 15_000_000n, // 15 USDC
      ticketPriceUsdc: 5_000_000n, // 5 USDC/ticket
      pendingTicketIds: [101, 102, 103, 104],
      alreadyConfirmedCount: 0,
    });

    expect(result.ticketsToConfirm).toEqual([101, 102, 103]);
    expect(result.remainderUsdc).toBe(0n);
    expect(result.overpaidUsdc).toBe(0n);
  });

  it("confirms nothing when payment doesn't cover even one ticket", () => {
    const result = reconcilePayment({
      totalPaidUsdc: 3_000_000n,
      ticketPriceUsdc: 5_000_000n,
      pendingTicketIds: [101, 102],
      alreadyConfirmedCount: 0,
    });

    expect(result.ticketsToConfirm).toEqual([]);
    expect(result.remainderUsdc).toBe(3_000_000n);
    expect(result.overpaidUsdc).toBe(0n);
  });

  it("accounts for already-confirmed tickets - doesn't re-confirm or double count", () => {
    const result = reconcilePayment({
      totalPaidUsdc: 10_000_000n, // covers 2 tickets total; 1 already confirmed
      ticketPriceUsdc: 5_000_000n,
      pendingTicketIds: [102, 103], // ticket 101 already confirmed separately
      alreadyConfirmedCount: 1,
    });

    expect(result.ticketsToConfirm).toEqual([102]);
    expect(result.remainderUsdc).toBe(0n);
  });

  it("confirms oldest-pending-first when payment covers only some of them", () => {
    const result = reconcilePayment({
      totalPaidUsdc: 10_000_000n,
      ticketPriceUsdc: 5_000_000n,
      pendingTicketIds: [201, 202, 203],
      alreadyConfirmedCount: 0,
    });

    expect(result.ticketsToConfirm).toEqual([201, 202]);
  });

  it("never confirms more tickets than are actually pending", () => {
    const result = reconcilePayment({
      totalPaidUsdc: 100_000_000n, // way more than enough
      ticketPriceUsdc: 5_000_000n,
      pendingTicketIds: [301],
      alreadyConfirmedCount: 0,
    });

    expect(result.ticketsToConfirm).toEqual([301]);
  });

  it("flags overpayment only once every pending ticket is already covered", () => {
    const result = reconcilePayment({
      totalPaidUsdc: 20_000_000n, // covers 4, only 1 is pending
      ticketPriceUsdc: 5_000_000n,
      pendingTicketIds: [401],
      alreadyConfirmedCount: 0,
    });

    expect(result.ticketsToConfirm).toEqual([401]);
    expect(result.overpaidUsdc).toBe(15_000_000n);
    expect(result.remainderUsdc).toBe(0n);
  });

  it("treats a zero ticket price as fully pending (never divides by zero)", () => {
    expect(() =>
      reconcilePayment({
        totalPaidUsdc: 1n,
        ticketPriceUsdc: 0n,
        pendingTicketIds: [1],
        alreadyConfirmedCount: 0,
      }),
    ).toThrow(/ticketPriceUsdc/);
  });
});
