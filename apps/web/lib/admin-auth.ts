import { constantTimeEqual } from "./timing-safe-equal";
import { getSession } from "./session";

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminSecretValid(providedSecret: string | null): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable: ADMIN_SECRET");
  }
  if (!providedSecret) return false;
  return constantTimeEqual(providedSecret, secret);
}

export function isAdminWallet(walletAddress: string | undefined): boolean {
  if (!walletAddress) return false;
  return parseAllowlist(process.env.ADMIN_WALLET_ADDRESSES).includes(walletAddress.toLowerCase());
}

/**
 * Two independent paths, kept both: the shared secret is what the runbook's
 * manual-testing curl commands use (no browser, no wallet), while a SIWE session
 * on an allow-listed wallet is what the /admin page itself now uses - a wallet
 * signature never gets typed into a public page's text field the way a static
 * secret does. Returns an identifying actor string for audit_log, or null.
 */
export async function getAdminActor(request: Request): Promise<string | null> {
  if (isAdminSecretValid(request.headers.get("x-admin-secret"))) {
    return "admin-secret";
  }
  const session = await getSession();
  if (isAdminWallet(session.walletAddress)) {
    return session.walletAddress as string;
  }
  return null;
}
