import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { generateTonProofPayload } from "@/lib/ton-proof";
import { getTgSession } from "@/lib/tg-session";

export async function GET(request: Request) {
  const { allowed } = await checkRateLimit(`tg-ton-proof-payload:${getClientIp(request)}`, 30, 60_000);
  if (!allowed) {
    return Response.json({ error: "Too many requests - try again in a minute" }, { status: 429 });
  }

  const session = await getTgSession();
  if (!session.telegramUserId) {
    return Response.json({ error: "Call /api/tg/verify-init-data first" }, { status: 401 });
  }

  const payload = generateTonProofPayload();
  session.tonProofPayload = payload;
  session.tonProofPayloadIssuedAt = Date.now();
  await session.save();

  return Response.json({ payload });
}
