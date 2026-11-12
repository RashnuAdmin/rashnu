"use client";

import { useEffect, useState } from "react";

/**
 * Recomputes the ticket-list hash in the browser from the raw published CSV -
 * a real client-side check, not a claim the page's own server code makes about
 * itself. Uses the Web Crypto API directly rather than trusting any value this
 * page's server component computed.
 */
export function ClientHashCheck({ drawNumber, expectedHash }: { drawNumber: number; expectedHash: string }) {
  const [status, setStatus] = useState<"checking" | "match" | "mismatch" | "error">("checking");
  const [computedHash, setComputedHash] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/draws/${drawNumber}/ticket-list.json`);
        if (!response.ok) {
          setStatus("error");
          return;
        }
        const { canonicalCsv } = (await response.json()) as { canonicalCsv: string };
        const bytes = new TextEncoder().encode(canonicalCsv);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hex = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const withPrefix = `0x${hex}`;
        setComputedHash(withPrefix);
        setStatus(withPrefix === expectedHash ? "match" : "mismatch");
      } catch {
        setStatus("error");
      }
    })();
  }, [drawNumber, expectedHash]);

  return (
    <div className="rounded border p-3 text-sm">
      <p className="font-semibold">Browser self-check (recomputed in your own browser, not trusted from the server):</p>
      {status === "checking" && <p>Downloading the published ticket list and hashing it...</p>}
      {status === "match" && <p className="text-green-700">✓ Matches: {computedHash}</p>}
      {status === "mismatch" && (
        <p className="text-red-600">
          ✗ MISMATCH - computed {computedHash}, page claims {expectedHash}. This is exactly the kind of
          discrepancy the dispute channel below exists for.
        </p>
      )}
      {status === "error" && <p className="text-red-600">Could not fetch the ticket list to check.</p>}
    </div>
  );
}
