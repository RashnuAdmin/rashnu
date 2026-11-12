import { and, count, eq } from "drizzle-orm";
import Link from "next/link";
import { draws, drawResults, getDb, tickets } from "@lotto/db";
import { ClientHashCheck } from "@/components/ClientHashCheck";

function formatUsdc(amount: bigint): string {
  return (Number(amount) / 1_000_000).toFixed(2);
}

// Every byte of this page depends on the specific draw's live data - there's no
// static shell worth preserving via Suspense, so disable prerendering outright
// rather than engineer streaming boundaries for no real benefit.
export const instant = false;

export default async function VerifyPage({ params }: { params: Promise<{ drawNumber: string }> }) {
  const { drawNumber: drawNumberParam } = await params;
  const drawNumber = Number(drawNumberParam);

  const db = getDb();
  const draw = Number.isInteger(drawNumber)
    ? await db.query.draws.findFirst({ where: eq(draws.drawNumber, drawNumber) })
    : undefined;

  if (!draw) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p>Draw #{drawNumberParam} not found.</p>
      </main>
    );
  }

  const result = await db.query.drawResults.findFirst({ where: eq(drawResults.drawId, draw.id) });
  const [{ confirmedTicketCount }] = await db
    .select({ confirmedTicketCount: count() })
    .from(tickets)
    .where(and(eq(tickets.drawId, draw.id), eq(tickets.status, "confirmed")));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16 text-sm">
      <div>
        <h1 className="text-2xl font-semibold">Draw #{draw.drawNumber} - verification</h1>
        <p className="text-gray-600">
          Status: <strong>{draw.status}</strong> - cutoff {new Date(draw.cutoffAt).toLocaleString()} - ticket price{" "}
          {formatUsdc(draw.ticketPriceUsdc)} USDC - minimum {draw.minTicketsThreshold} tickets
        </p>
      </div>

      {draw.status === "rolled_over" && (
        <div className="rounded border p-3">
          <p>
            This draw did not meet its minimum ticket threshold and rolled over. Its tickets and pot carried
            forward to{" "}
            <Link className="underline" href={`/draws/${draw.drawNumber + 1}/verify`}>
              the next draw
            </Link>
            . No on-chain settlement happens for a rolled-over draw.
          </p>
        </div>
      )}

      {draw.ticketListHash && (
        <div className="flex flex-col gap-2 rounded border p-3">
          <p className="font-semibold">1. The published ticket list</p>
          <p>
            Committed hash: <code className="break-all">{draw.ticketListHash}</code>
          </p>
          <p>
            Published at: {draw.ticketListPublishedAt ? new Date(draw.ticketListPublishedAt).toLocaleString() : "-"}
          </p>
          <p>
            <a className="underline" href={`/api/draws/${draw.drawNumber}/ticket-list.json`}>
              Download the full published ticket list (JSON + canonical CSV)
            </a>
          </p>
          {draw.fundTxHash && (
            <p>
              Committed on-chain (before the Bitcoin block below could exist) in{" "}
              <a
                className="underline"
                target="_blank"
                rel="noreferrer"
                href={`https://sepolia.basescan.org/tx/${draw.fundTxHash}`}
              >
                this fundDraw transaction
              </a>{" "}
              - check its timestamp yourself against the block below&apos;s.
            </p>
          )}
          <ClientHashCheck drawNumber={draw.drawNumber} expectedHash={draw.ticketListHash} />
        </div>
      )}

      {result && (
        <>
          <div className="flex flex-col gap-2 rounded border p-3">
            <p className="font-semibold">2. The Bitcoin-derived randomness</p>
            <p>
              Qualifying block:{" "}
              <a
                className="underline"
                target="_blank"
                rel="noreferrer"
                href={`https://mempool.space/block/${result.qualifyingBtcBlockHash}`}
              >
                height {result.qualifyingBtcBlockHeight}
              </a>{" "}
              ({new Date(result.qualifyingBtcBlockTime).toUTCString()}) - this link goes straight to a public
              block explorer, not anything this platform controls.
            </p>
            <p>
              Winning transaction (position {result.winningTxIndexInBlock} in that block, 1-indexed, coinbase =
              position 1):{" "}
              <a
                className="underline break-all"
                target="_blank"
                rel="noreferrer"
                href={`https://mempool.space/tx/${result.winningTxId}`}
              >
                {result.winningTxId}
              </a>
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded border p-3">
            <p className="font-semibold">3. The arithmetic</p>
            <p className="font-mono text-xs break-all">
              winning_index = BigInt(0x{result.winningTxId}) mod {confirmedTicketCount} (tickets sold) ={" "}
              {result.winningTicketIndex}
            </p>
            <p>
              Winner: <code className="break-all">{result.winnerWalletAddress}</code> (ticket index{" "}
              {result.winningTicketIndex} in the published list above)
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded border p-3">
            <p className="font-semibold">4. Settlement</p>
            <p>
              Payout: {formatUsdc(result.payoutAmountUsdc)} USDC to the winner, {formatUsdc(result.feeAmountUsdc)}{" "}
              USDC platform fee.
            </p>
            {result.settlementTxHash && (
              <p>
                <a
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://sepolia.basescan.org/tx/${result.settlementTxHash}`}
                >
                  View the settlement transaction on Basescan
                </a>
              </p>
            )}
          </div>
        </>
      )}

      <div className="rounded border p-3">
        <p className="font-semibold">Don&apos;t trust this page - verify it yourself</p>
        {draw.status === "rolled_over" ? (
          <p>
            This draw never reached a Bitcoin-derived result - it rolled over before funding, so there&apos;s no
            winner computation to independently recompute. What you can still verify yourself: the published
            ticket list above really does have fewer than {draw.minTicketsThreshold} tickets (the threshold),
            and that its tickets reappear, carried forward, in{" "}
            {draw.rolledIntoDrawId ? (
              <Link className="underline" href={`/draws/${draw.drawNumber + 1}/verify`}>
                the next draw
              </Link>
            ) : (
              "the next draw"
            )}
            &apos;s published ticket list.
          </p>
        ) : (
          <>
            <p>
              Everything above is derived from public data: the ticket list, the Bitcoin block, and the on-chain
              transactions. Recompute it independently:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-2 text-xs text-zinc-100">
              {`npx rashnu-verifier compute-winner \\
  --cutoff ${Math.floor(new Date(draw.cutoffAt).getTime() / 1000)} \\
  --rng-n ${draw.rngN} --confirmations ${draw.confirmationsRequired} \\
  --tickets ${confirmedTicketCount}`}
            </pre>
          </>
        )}
        <p className="mt-2">
          Source:{" "}
          <a className="underline" href="https://github.com/RashnuAdmin/rashnu">
            github.com/RashnuAdmin/rashnu
          </a>{" "}
          (packages/verifier is the standalone, independently-runnable implementation of everything on this
          page).
        </p>
        <p className="mt-2">
          Found a discrepancy?{" "}
          <a className="underline" href="https://github.com/RashnuAdmin/rashnu/issues/new">
            Open an issue
          </a>{" "}
          - that&apos;s the dispute channel.
        </p>
      </div>
    </main>
  );
}
