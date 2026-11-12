import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  nonce?: string;
  walletAddress?: string;
}

function sessionOptions() {
  const password = process.env.SESSION_SECRET;
  if (!password) {
    throw new Error("Missing required environment variable: SESSION_SECRET");
  }
  return {
    password,
    cookieName: "rashnu_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      // Explicit, not relied-on-by-default: admin POST routes (createDraw,
      // retry-workflow) now authorize via this cookie alone (lib/admin-auth.ts),
      // so a cross-site forged request must not be able to ride along on it.
      // "lax" still allows the SIWE sign-in flow itself, which never redirects
      // cross-site.
      sameSite: "lax" as const,
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
