import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyTonProof, type TonProofAccount, type TonProofReply } from "@/lib/ton-proof";
import { getTgSession } from "@/lib/tg-session";

const PAYLOAD_MAX_AGE_MS = 5 * 60_000;

export async function POST(request: Request) {
  const { allowed } = await checkRateLimit(`tg-ton-proof-verify:${getClientIp(request)}`, 30, 60_000);
  if (!allowed) {
    return Response.json({ error: "Too many requests - try again in a minute" }, { status: 429 });
  }

  const { account, proof } = (await request.json()) as { account?: TonProofAccount; proof?: TonProofReply };
  if (!account || !proof) {
    return Response.json({ error: "Missing account or proof" }, { status: 400 });
  }

  const session = await getTgSession();
  if (!session.telegramUserId) {
    return Response.json({ error: "Call /api/tg/verify-init-data first" }, { status: 401 });
  }
  if (!session.tonProofPayload || !session.tonProofPayloadIssuedAt) {
    return Response.json({ error: "Call /api/tg/ton-proof/payload first" }, { status: 400 });
  }
  if (Date.now() - session.tonProofPayloadIssuedAt > PAYLOAD_MAX_AGE_MS) {
    session.tonProofPayload = undefined;
    session.tonProofPayloadIssuedAt = undefined;
    await session.save();
    return Response.json({ error: "Proof payload expired - fetch a new one" }, { status: 400 });
  }

  const domain = process.env.TG_MINIAPP_DOMAIN;
  if (!domain) {
    throw new Error("Missing required environment variable: TG_MINIAPP_DOMAIN");
  }

  const expectedPayload = session.tonProofPayload;

  // Single-use regardless of outcome: a payload must never be verifiable twice.
  session.tonProofPayload = undefined;
  session.tonProofPayloadIssuedAt = undefined;

  const result = verifyTonProof(account, proof, expectedPayload, domain);
  if (!result.ok) {
    await session.save();
    return Response.json({ error: result.error }, { status: 401 });
  }

  session.tonWalletAddress = result.address;
  await session.save();

  return Response.json({ tonWalletAddress: result.address });
}
