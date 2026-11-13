import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

// Separate from lib/session.ts's cookie/SessionData on purpose (ADR-013): a TON
// wallet address is not the same buyer identity as an EVM wallet address, and
// this Mini App runs in a different context (Telegram's WebView) from the main
// buyer flow - mixing the two into one cookie would couple concerns that ADR-013
// deliberately kept apart.
export interface TgSessionData {
  telegramUserId?: number;
  tonWalletAddress?: string;
  // Single-use TON Proof payload issued by /api/tg/ton-proof/payload, consumed
  // by /api/tg/ton-proof/verify - never accept a client-supplied payload value,
  // only ever compare against what the server itself issued and stored here.
  tonProofPayload?: string;
  tonProofPayloadIssuedAt?: number;
}

function sessionOptions() {
  const password = process.env.SESSION_SECRET;
  if (!password) {
    throw new Error("Missing required environment variable: SESSION_SECRET");
  }
  return {
    password,
    cookieName: "rashnu_tg_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      // Telegram's Mini App WebView navigates to this app inside an iframe-like
      // context launched from a different origin (Telegram's own client) - "lax"
      // (not "strict") is required for the session cookie to survive that launch
      // at all, while still blocking cross-site POST forgery the same way
      // lib/session.ts's cookie does.
      sameSite: "lax" as const,
    },
  };
}

export async function getTgSession(): Promise<IronSession<TgSessionData>> {
  return getIronSession<TgSessionData>(await cookies(), sessionOptions());
}
