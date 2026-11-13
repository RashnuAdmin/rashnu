import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyTelegramInitData } from "@/lib/telegram-init-data";
import { getTgSession } from "@/lib/tg-session";

export async function POST(request: Request) {
  const { allowed } = await checkRateLimit(`tg-verify-init-data:${getClientIp(request)}`, 30, 60_000);
  if (!allowed) {
    return Response.json({ error: "Too many requests - try again in a minute" }, { status: 429 });
  }

  const { initData } = (await request.json()) as { initData?: string };
  if (!initData) {
    return Response.json({ error: "Missing initData" }, { status: 400 });
  }

  const botToken = process.env.TELEGRAM_MINIAPP_BOT_TOKEN;
  if (!botToken) {
    throw new Error("Missing required environment variable: TELEGRAM_MINIAPP_BOT_TOKEN");
  }

  const result = verifyTelegramInitData(initData, botToken);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 401 });
  }
  if (!result.data.user) {
    return Response.json({ error: "initData did not include a user" }, { status: 401 });
  }

  const session = await getTgSession();
  session.telegramUserId = result.data.user.id;
  await session.save();

  return Response.json({ telegramUserId: result.data.user.id });
}
