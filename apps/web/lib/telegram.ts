import type { StaleDraw } from "./draw-health";

/** Pure formatting, so the message content is testable without a real bot token. */
export function formatStaleDrawAlert(staleDraws: StaleDraw[]): string | null {
  if (staleDraws.length === 0) return null;

  const lines = staleDraws.map(
    (d) => `Draw #${d.drawNumber}: status "${d.status}", ${d.hoursSinceCutoff}h past cutoff with no resolution`,
  );
  return [
    "Rashnu health check - possibly stuck draw(s):",
    ...lines,
    "See /admin or run retry-workflow (see the runbook).",
  ].join("\n");
}

/**
 * Plain fetch to the Bot API - no SDK, this is a one-call integration. Throws
 * on failure rather than swallowing it, since a silently-failing alert is worse
 * than a visible error in the cron's own logs (vercel logs still shows it).
 */
export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("Missing required environment variable: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`);
  }
}
