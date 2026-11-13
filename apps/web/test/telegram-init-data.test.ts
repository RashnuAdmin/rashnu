import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramInitData } from "../lib/telegram-init-data";

const BOT_TOKEN = "123456:test-bot-token";

/**
 * Builds a validly-signed initData string the exact way Telegram's own
 * algorithm specifies (docs.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret_key = HMAC_SHA256(key="WebAppData", message=bot_token), then
 * hash = hex(HMAC_SHA256(key=secret_key, message=data_check_string)), where
 * data_check_string is all non-hash fields sorted by key, "key=value" joined
 * by "\n". There's no official published test vector to check against, so
 * these tests verify the algorithm's own properties instead: a validly-built
 * payload passes, and tampering with any single part breaks it.
 */
function signInitData(fields: Record<string, string>, botToken: string = BOT_TOKEN): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

describe("verifyTelegramInitData", () => {
  it("accepts a validly-signed payload and returns its parsed fields", () => {
    const now = Math.floor(Date.now() / 1000);
    const raw = signInitData({ auth_date: String(now), query_id: "abc123", user: '{"id":42}' });

    const result = verifyTelegramInitData(raw, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.authDate).toBe(now);
      expect(result.data.user?.id).toBe(42);
    }
  });

  it("rejects a payload signed with a different bot token", () => {
    const now = Math.floor(Date.now() / 1000);
    const raw = signInitData({ auth_date: String(now) }, "999999:a-different-token");

    const result = verifyTelegramInitData(raw, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload with any field tampered with after signing", () => {
    const now = Math.floor(Date.now() / 1000);
    const raw = signInitData({ auth_date: String(now), query_id: "abc123" });
    const tampered = raw.replace("abc123", "tampered");

    const result = verifyTelegramInitData(tampered, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload with a missing hash", () => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)) });
    const result = verifyTelegramInitData(params.toString(), BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it("rejects an expired auth_date", () => {
    const old = Math.floor(Date.now() / 1000) - 3600 * 24; // 24h old
    const raw = signInitData({ auth_date: String(old) });

    const result = verifyTelegramInitData(raw, BOT_TOKEN, { maxAgeSeconds: 3600 });
    expect(result.ok).toBe(false);
  });

  it("accepts a fresh auth_date within the max age", () => {
    const recent = Math.floor(Date.now() / 1000) - 60;
    const raw = signInitData({ auth_date: String(recent) });

    const result = verifyTelegramInitData(raw, BOT_TOKEN, { maxAgeSeconds: 3600 });
    expect(result.ok).toBe(true);
  });
});
