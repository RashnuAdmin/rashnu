import { constantTimeEqual } from "@/lib/timing-safe-equal";

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

/**
 * Telegram signs webhook deliveries with a secret_token header (set via
 * setWebhook's secret_token param, core.telegram.org/bots/api#setwebhook) -
 * this is a stable, documented Bot API feature, not one of the churning SDK
 * wrapper packages, so it's used directly rather than wrapped.
 */
function isAuthenticRequest(request: Request): boolean {
  const expected = process.env.TELEGRAM_MINIAPP_WEBHOOK_SECRET;
  const received = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || !received) return false;
  return constantTimeEqual(received, expected);
}

async function sendMessage(chatId: number, text: string, webAppUrl: string, botToken: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: "Open Rashnu", web_app: { url: webAppUrl } }]],
      },
    }),
  });
}

export async function POST(request: Request) {
  if (!isAuthenticRequest(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const botToken = process.env.TELEGRAM_MINIAPP_BOT_TOKEN;
  const domain = process.env.TG_MINIAPP_DOMAIN;
  if (!botToken || !domain) {
    throw new Error("Missing required environment variable: TELEGRAM_MINIAPP_BOT_TOKEN or TG_MINIAPP_DOMAIN");
  }

  const update = (await request.json()) as TelegramUpdate;
  const chatId = update.message?.chat.id;
  const text = update.message?.text;

  // Command surface beyond "open the Mini App" is explicitly deferred - see
  // docs/ton-pool.md's open questions.
  if (chatId !== undefined && text?.startsWith("/start")) {
    await sendMessage(chatId, "Welcome to Rashnu - open the app below to connect your wallet and buy tickets.", `https://${domain}/tg`, botToken);
  }

  return new Response("ok");
}
