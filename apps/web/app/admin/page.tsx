"use client";

import { useEffect, useState } from "react";
import { ConnectAndSignIn } from "@/components/ConnectAndSignIn";

interface DrawSummary {
  id: number;
  drawNumber: number;
  status: string;
  cutoffAt: string;
  ticketPriceUsdc: string;
  minTicketsThreshold: number;
  depositAddress: string;
  tickets: { total: number; confirmed: number; pending: number };
  totalPaidUsdc: string;
}

interface StaleDraw {
  id: number;
  drawNumber: number;
  status: string;
  hoursSinceCutoff: number;
}

/**
 * Admin dashboard. The real gate is server-side (lib/admin-auth.ts): a SIWE
 * session whose wallet is in ADMIN_WALLET_ADDRESSES, checked via the ordinary
 * signed-in-cookie request below - no secret is typed into this public page.
 * A shared-secret header path still exists server-side too, for the runbook's
 * scripted curl commands, but this UI no longer uses it.
 */
export default function AdminPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [draws, setDraws] = useState<DrawSummary[] | null>(null);
  const [staleDraws, setStaleDraws] = useState<StaleDraw[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newDraw, setNewDraw] = useState({
    ticketPriceUsdc: "5000000",
    minTicketsThreshold: 10,
    cutoffAt: "",
    depositAddress: "",
  });

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/session");
      const { walletAddress } = (await response.json()) as { walletAddress: string | null };
      setWalletAddress(walletAddress);
      setLoadingSession(false);
    })();
  }, []);

  async function loadDraws() {
    setError(null);
    const response = await fetch("/api/admin/draws");
    if (!response.ok) {
      setError("Unauthorized - this wallet is not on the admin allowlist");
      return;
    }
    const { draws } = (await response.json()) as { draws: DrawSummary[] };
    setDraws(draws);

    const healthResponse = await fetch("/api/admin/health");
    if (healthResponse.ok) {
      const { staleDraws } = (await healthResponse.json()) as { staleDraws: StaleDraw[] };
      setStaleDraws(staleDraws);
    }
  }

  async function createDraw() {
    setError(null);
    const response = await fetch("/api/admin/draws", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newDraw),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({ error: "Request failed" }))) as { error: string };
      setError(body.error);
      return;
    }
    await loadDraws();
  }

  if (loadingSession) {
    return <p className="mx-auto max-w-3xl px-6 py-16">Loading...</p>;
  }

  if (!walletAddress) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-gray-600">Sign in with an admin-allow-listed wallet to continue.</p>
        <ConnectAndSignIn onSignedIn={setWalletAddress} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Signed in as {walletAddress}</p>
        <button onClick={loadDraws} className="rounded bg-black px-4 py-2 text-white">
          Load draws
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {staleDraws.length > 0 && (
        <div className="rounded border border-red-600 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Possibly stuck draws</p>
          {staleDraws.map((d) => (
            <p key={d.id}>
              Draw #{d.drawNumber}: status <code>{d.status}</code>, {d.hoursSinceCutoff}h past cutoff with no
              resolution - consider <code>POST /api/admin/draws/{d.id}/retry-workflow</code> (see the runbook).
            </p>
          ))}
        </div>
      )}

      <div className="rounded border p-4">
        <h2 className="font-semibold">Create draw</h2>
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <label>
            Ticket price (USDC base units, 6 decimals)
            <input
              value={newDraw.ticketPriceUsdc}
              onChange={(e) => setNewDraw({ ...newDraw, ticketPriceUsdc: e.target.value })}
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <label>
            Minimum tickets threshold
            <input
              type="number"
              value={newDraw.minTicketsThreshold}
              onChange={(e) => setNewDraw({ ...newDraw, minTicketsThreshold: Number(e.target.value) })}
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <label>
            Cutoff (local time)
            <input
              type="datetime-local"
              value={newDraw.cutoffAt}
              onChange={(e) => setNewDraw({ ...newDraw, cutoffAt: e.target.value })}
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <label>
            Deposit address
            <input
              value={newDraw.depositAddress}
              onChange={(e) => setNewDraw({ ...newDraw, depositAddress: e.target.value })}
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <button onClick={createDraw} className="mt-2 rounded bg-black px-4 py-2 text-white">
            Create draw
          </button>
        </div>
      </div>

      {draws && (
        <table className="w-full table-auto text-left text-sm [&_td]:py-2 [&_td]:pr-4 [&_th]:py-2 [&_th]:pr-4">
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              <th>Cutoff</th>
              <th>Tickets (confirmed/pending/total)</th>
              <th>Paid (USDC)</th>
              <th>Deposit address</th>
            </tr>
          </thead>
          <tbody>
            {draws.map((draw) => (
              <tr key={draw.id} className="border-t">
                <td>{draw.drawNumber}</td>
                <td>{draw.status}</td>
                <td>{new Date(draw.cutoffAt).toLocaleString()}</td>
                <td>
                  {draw.tickets.confirmed}/{draw.tickets.pending}/{draw.tickets.total}
                </td>
                <td>{(Number(draw.totalPaidUsdc) / 1_000_000).toFixed(2)}</td>
                <td className="font-mono text-xs">{draw.depositAddress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
