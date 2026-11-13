import { createHmac } from "node:crypto";
import { constantTimeEqual } from "./timing-safe-equal";

export interface TelegramInitData {
  authDate: number;
  queryId?: string;
  user?: { id: number; firstName?: string; username?: string };
  raw: Record<string, string>;
}

export type VerifyInitDataResult = { ok: true; data: TelegramInitData } | { ok: false; error: string };

/**
 * Hand-rolled against Telegram's own stable algorithm
 * (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app),
 * not an npm wrapper package - the Mini Apps SDK ecosystem has renamed this
 * exact piece of functionality three times within 2026 alone (see ADR-014's
 * update), while this underlying crypto hasn't changed at all. A ~40-line,
 * directly-verifiable implementation of a stable spec is more robust here
 * than a dependency on a package that might not exist under the same name by
 * the time this is read again.
 */
export function verifyTelegramInitData(
  raw: string,
  botToken: string,
  options: { maxAgeSeconds?: number } = {},
): VerifyInitDataResult {
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) {
    return { ok: false, error: "missing hash" };
  }
  params.delete("hash");

  const fields: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    fields[key] = value;
  }

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!constantTimeEqual(hash, expectedHash)) {
    return { ok: false, error: "signature mismatch" };
  }

  const authDate = Number(fields.auth_date);
  if (!Number.isInteger(authDate)) {
    return { ok: false, error: "missing or invalid auth_date" };
  }
  const maxAgeSeconds = options.maxAgeSeconds ?? 3600;
  if (Math.floor(Date.now() / 1000) - authDate > maxAgeSeconds) {
    return { ok: false, error: "expired" };
  }

  let user: TelegramInitData["user"];
  if (fields.user) {
    try {
      const parsed = JSON.parse(fields.user) as { id: number; first_name?: string; username?: string };
      user = { id: parsed.id, firstName: parsed.first_name, username: parsed.username };
    } catch {
      return { ok: false, error: "malformed user field" };
    }
  }

  return {
    ok: true,
    data: { authDate, queryId: fields.query_id, user, raw: fields },
  };
}
