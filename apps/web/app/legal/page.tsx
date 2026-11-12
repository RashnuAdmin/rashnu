import Link from "next/link";

export const metadata = { title: "Terms & odds - Rashnu" };

export default function LegalPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16 text-sm">
      <div>
        <h1 className="text-2xl font-semibold">Terms, odds, and fees</h1>
        <p className="text-gray-600">
          This is a testnet platform (see ADR-001 in the project&apos;s{" "}
          <a className="underline" href="https://github.com/RashnuAdmin/rashnu/blob/main/docs/decisions.md">
            decision log
          </a>
          ) - tickets are paid for with Base Sepolia test USDC, which has no real-world
          value. Nothing here is a real-money product, and nothing here is legal,
          financial, or tax advice.
        </p>
      </div>

      <div className="rounded border p-3">
        <p className="font-semibold">Eligibility</p>
        <p>
          You must self-attest that you are 18 years or older to create an account.
          This is a self-attestation only, not identity verification - see ADR-006.
          A real-money launch would require stronger verification before it could rely
          on this alone.
        </p>
      </div>

      <div className="rounded border p-3">
        <p className="font-semibold">Your odds of winning</p>
        <p>
          Each draw sells a variable number of tickets. If a draw closes with{" "}
          <code>N</code> confirmed tickets and you hold <code>k</code> of them, your
          odds of winning that draw are exactly <code>k / N</code> - every ticket has
          an equal, independent chance, because the winner is selected uniformly at
          random over all confirmed tickets (see the RNG spec in{" "}
          <a className="underline" href="https://github.com/RashnuAdmin/rashnu/blob/main/docs/architecture.md">
            architecture.md
          </a>
          ). The buy page shows the current ticket count live, so you can compute your
          odds before paying.
        </p>
      </div>

      <div className="rounded border p-3">
        <p className="font-semibold">Fees</p>
        <p>
          The platform keeps a fixed 15% of each draw&apos;s pot; the remaining 85% goes
          to the winner. This split is enforced on-chain by the <code>LotteryPool</code>{" "}
          contract itself, not just stated here - you can verify it on any settled
          draw&apos;s <Link className="underline" href="/draws/2/verify">verify page</Link>.
        </p>
      </div>

      <div className="rounded border p-3">
        <p className="font-semibold">If a draw doesn&apos;t sell enough tickets</p>
        <p>
          A draw that doesn&apos;t reach its minimum ticket threshold rolls over: your
          ticket carries forward into the next draw automatically (not refunded) - see
          ADR-007.
        </p>
      </div>

      <div className="rounded border p-3">
        <p className="font-semibold">Disputes</p>
        <p>
          Every draw is independently verifiable by anyone, without trusting this
          site - see any draw&apos;s verify page for the exact recomputation steps. If
          you believe a result is wrong,{" "}
          <a className="underline" href="https://github.com/RashnuAdmin/rashnu/issues/new">
            open an issue
          </a>{" "}
          with your own recomputation and where it diverges.
        </p>
      </div>

      <p>
        <Link className="underline" href="/">
          Back to Rashnu
        </Link>
      </p>
    </main>
  );
}
