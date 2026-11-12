"use client";

import { useState } from "react";
import Link from "next/link";
import { SiweMessage } from "siwe";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { baseSepolia } from "wagmi/chains";

export function ConnectAndSignIn({ onSignedIn }: { onSignedIn: (walletAddress: string) => void }) {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const [ageAttested, setAgeAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (!address) return;
    setError(null);
    try {
      const nonceResponse = await fetch("/api/auth/nonce");
      const nonce = await nonceResponse.text();

      const siweMessage = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Rashnu.",
        uri: window.location.origin,
        version: "1",
        chainId: baseSepolia.id,
        nonce,
      });
      const preparedMessage = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message: preparedMessage });

      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: preparedMessage, signature, ageAttested }),
      });

      if (!verifyResponse.ok) {
        const { error: message } = (await verifyResponse.json()) as { error: string };
        setError(message);
        return;
      }

      const { walletAddress } = (await verifyResponse.json()) as { walletAddress: string };
      onSignedIn(walletAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col gap-3">
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            onClick={() => connect({ connector })}
            disabled={isConnecting}
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            Connect {connector.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">Connected: {address}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ageAttested} onChange={(e) => setAgeAttested(e.target.checked)} />
        I am 18 years or older and I agree to the{" "}
        <Link className="underline" href="/legal" target="_blank">
          Terms, odds, and fees
        </Link>
        .
      </label>
      <button
        onClick={signIn}
        disabled={!ageAttested || isSigning}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {isSigning ? "Signing..." : "Sign in with Ethereum"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
