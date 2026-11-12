"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { erc20Abi } from "viem";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

interface Draw {
  id: number;
  drawNumber: number;
  cutoffAt: string;
  ticketPriceUsdc: string;
  minTicketsThreshold: number;
  depositAddress: string;
  ticketsSold: number;
}

interface Ticket {
  publicId: string;
  status: string;
  ticketIndex: number | null;
  createdAt: string;
}

const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}` | undefined;

export function BuyTickets({ walletAddress }: { walletAddress: string }) {
  const [draw, setDraw] = useState<Draw | null>(null);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [pendingPayment, setPendingPayment] = useState<{ totalDueUsdc: string; depositAddress: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const wagmiConfig = useConfig();
  const { writeContractAsync, isPending: isSending } = useWriteContract();

  const refreshMyTickets = useCallback(async (drawNumber: number) => {
    const response = await fetch(`/api/draws/${drawNumber}/my-tickets`);
    if (response.ok) {
      const { tickets } = (await response.json()) as { tickets: Ticket[] };
      setMyTickets(tickets);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/draws/current");
      const { draw } = (await response.json()) as { draw: Draw | null };
      setDraw(draw);
      if (draw) await refreshMyTickets(draw.drawNumber);
    })();
  }, [refreshMyTickets]);

  async function buyTickets() {
    if (!draw) return;
    setError(null);
    const response = await fetch(`/api/draws/${draw.drawNumber}/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    if (!response.ok) {
      const { error: message } = (await response.json()) as { error: string };
      setError(message);
      return;
    }
    const { totalDueUsdc, depositAddress } = (await response.json()) as {
      totalDueUsdc: string;
      depositAddress: string;
    };
    setPendingPayment({ totalDueUsdc, depositAddress });
    await refreshMyTickets(draw.drawNumber);
  }

  async function payNow() {
    if (!pendingPayment || !USDC_ADDRESS || !draw) return;
    const hash = await writeContractAsync({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [pendingPayment.depositAddress as `0x${string}`, BigInt(pendingPayment.totalDueUsdc)],
    });
    setIsConfirming(true);
    try {
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setPendingPayment(null);
      await refreshMyTickets(draw.drawNumber);
    } finally {
      setIsConfirming(false);
    }
  }

  if (!draw) {
    return <p>No draw is currently open for ticket sales.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-semibold">Draw #{draw.drawNumber}</p>
        <p className="text-sm text-gray-600">Cutoff: {new Date(draw.cutoffAt).toLocaleString()}</p>
        <p className="text-sm text-gray-600">
          Ticket price: {(Number(draw.ticketPriceUsdc) / 1_000_000).toFixed(2)} USDC
        </p>
        <p className="text-sm text-gray-600">Tickets sold so far: {draw.ticketsSold}</p>
        <p className="text-sm text-gray-600">
          {myTickets.length > 0 && draw.ticketsSold > 0
            ? `Your odds right now: roughly ${myTickets.length} in ${draw.ticketsSold} (some tickets may still be awaiting payment confirmation).`
            : "Winner gets 85% of the pot; 15% is the platform fee."}{" "}
          <Link className="underline" href="/legal" target="_blank">
            Terms, odds, and fees
          </Link>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
          className="w-20 rounded border px-2 py-1"
        />
        <button onClick={buyTickets} className="rounded bg-black px-4 py-2 text-white">
          Buy tickets
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {pendingPayment && (
        <div className="rounded border p-3 text-sm">
          <p>
            Send exactly <strong>{(Number(pendingPayment.totalDueUsdc) / 1_000_000).toFixed(2)} USDC</strong> to{" "}
            <code>{pendingPayment.depositAddress}</code>
          </p>
          <button
            onClick={payNow}
            disabled={isSending || isConfirming}
            className="mt-2 rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {isSending ? "Sending..." : isConfirming ? "Confirming..." : "Pay now from my wallet"}
          </button>
        </div>
      )}

      <div>
        <p className="font-semibold">My tickets for this draw ({walletAddress})</p>
        <ul className="list-disc pl-5 text-sm">
          {myTickets.map((ticket) => (
            <li key={ticket.publicId}>
              {ticket.publicId.slice(0, 8)} - {ticket.status}
              {ticket.ticketIndex !== null ? ` (index ${ticket.ticketIndex})` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
