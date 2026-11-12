import { generateNonce } from "siwe";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const { allowed } = await checkRateLimit(`nonce:${getClientIp(request)}`, 30, 60_000);
  if (!allowed) {
    return Response.json({ error: "Too many requests - try again in a minute" }, { status: 429 });
  }

  const session = await getSession();
  session.nonce = generateNonce();
  await session.save();

  return new Response(session.nonce, {
    headers: { "content-type": "text/plain" },
  });
}
