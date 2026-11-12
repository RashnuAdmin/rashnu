"use client";

import { useEffect, useState } from "react";
import { BuyTickets } from "@/components/BuyTickets";
import { ConnectAndSignIn } from "@/components/ConnectAndSignIn";

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/session");
      const { walletAddress } = (await response.json()) as { walletAddress: string | null };
      setWalletAddress(walletAddress);
      setLoadingSession(false);
    })();
  }, []);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50">
      <main className="flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
        <div>
          <h1 className="text-2xl font-semibold">Rashnu</h1>
          <p className="text-sm text-gray-600">A lottery platform anyone can verify.</p>
        </div>

        {loadingSession ? (
          <p>Loading...</p>
        ) : walletAddress ? (
          <BuyTickets walletAddress={walletAddress} />
        ) : (
          <ConnectAndSignIn onSignedIn={setWalletAddress} />
        )}
      </main>
    </div>
  );
}
