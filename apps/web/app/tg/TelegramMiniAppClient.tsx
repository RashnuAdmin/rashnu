"use client";

import { init, useRawInitData } from "@telegram-apps/sdk-react";
import { TonConnectButton, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { useEffect, useRef, useState } from "react";
import type { TonProofAccount, TonProofReply } from "@/lib/ton-proof";

type TelegramAuthState = { status: "pending" } | { status: "ok"; telegramUserId: number } | { status: "error"; message: string };

type TonAuthState = { status: "idle" } | { status: "verifying" } | { status: "ok"; tonWalletAddress: string } | { status: "error"; message: string };

export default function TelegramMiniAppClient() {
  const rawInitData = useRawInitData();
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();

  const [telegramAuth, setTelegramAuth] = useState<TelegramAuthState>({ status: "pending" });
  const [tonAuth, setTonAuth] = useState<TonAuthState>({ status: "idle" });
  const verifiedWalletAddress = useRef<string | null>(null);

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, []);

  useEffect(() => {
    if (!rawInitData) return;

    fetch("/api/tg/verify-init-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: rawInitData }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const { error } = (await res.json()) as { error: string };
          setTelegramAuth({ status: "error", message: error });
          return;
        }
        const { telegramUserId } = (await res.json()) as { telegramUserId: number };
        setTelegramAuth({ status: "ok", telegramUserId });
      })
      .catch((err: unknown) => {
        setTelegramAuth({ status: "error", message: err instanceof Error ? err.message : "Verification failed" });
      });
  }, [rawInitData]);

  // Once Telegram-authenticated, fetch a fresh TON Proof challenge and attach
  // it to the next connect request - must happen before the user taps
  // TonConnectButton, since the payload has to ride along in the wallet's
  // connect handshake, not a separate call afterward.
  useEffect(() => {
    if (telegramAuth.status !== "ok") return;

    fetch("/api/tg/ton-proof/payload")
      .then(async (res) => {
        if (!res.ok) return;
        const { payload } = (await res.json()) as { payload: string };
        tonConnectUI.setConnectRequestParameters({ state: "ready", value: { tonProof: payload } });
      })
      .catch(() => {
        // Non-fatal: the user can still tap connect without a proof request
        // pre-attached, they'll just fail server-side verification below.
      });
  }, [telegramAuth.status, tonConnectUI]);

  useEffect(() => {
    if (!wallet || verifiedWalletAddress.current === wallet.account.address) return;
    verifiedWalletAddress.current = wallet.account.address;

    void (async () => {
      const tonProofItem = wallet.connectItems?.tonProof;
      if (!tonProofItem || !("proof" in tonProofItem)) {
        setTonAuth({ status: "error", message: "Wallet did not return a TON Proof - try reconnecting" });
        return;
      }
      if (!wallet.account.publicKey) {
        setTonAuth({ status: "error", message: "Wallet did not report a public key - try reconnecting" });
        return;
      }

      setTonAuth({ status: "verifying" });

      const account: TonProofAccount = { address: wallet.account.address, publicKey: wallet.account.publicKey };
      const proof: TonProofReply = tonProofItem.proof;

      try {
        const res = await fetch("/api/tg/ton-proof/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account, proof }),
        });
        if (!res.ok) {
          const { error } = (await res.json()) as { error: string };
          setTonAuth({ status: "error", message: error });
          return;
        }
        const { tonWalletAddress } = (await res.json()) as { tonWalletAddress: string };
        setTonAuth({ status: "ok", tonWalletAddress });
      } catch (err) {
        setTonAuth({ status: "error", message: err instanceof Error ? err.message : "Verification failed" });
      }
    })();
  }, [wallet]);

  return (
    <main className="flex flex-1 flex-col items-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Rashnu - TON pool</h1>

      <section className="flex w-full max-w-sm flex-col gap-2 text-sm">
        <p className="font-medium">1. Telegram</p>
        {telegramAuth.status === "pending" && <p className="text-gray-600">Verifying your Telegram session...</p>}
        {telegramAuth.status === "ok" && <p className="text-green-700">Signed in as Telegram user #{telegramAuth.telegramUserId}.</p>}
        {telegramAuth.status === "error" && <p className="text-red-600">{telegramAuth.message}</p>}
      </section>

      {telegramAuth.status === "ok" && (
        <section className="flex w-full max-w-sm flex-col gap-2 text-sm">
          <p className="font-medium">2. TON wallet</p>
          <TonConnectButton />
          {tonAuth.status === "verifying" && <p className="text-gray-600">Verifying wallet signature...</p>}
          {tonAuth.status === "ok" && <p className="text-green-700">Wallet verified: {tonAuth.tonWalletAddress}</p>}
          {tonAuth.status === "error" && <p className="text-red-600">{tonAuth.message}</p>}
        </section>
      )}

      {tonAuth.status === "ok" && <p className="text-sm text-gray-600">Ticket purchases for the TON pool are coming soon.</p>}
    </main>
  );
}
