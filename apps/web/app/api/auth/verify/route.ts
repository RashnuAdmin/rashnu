import { eq } from "drizzle-orm";
import { SiweMessage } from "siwe";
import { buyers, getDb } from "@lotto/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";

export async function POST(request: Request) {
  const { allowed } = await checkRateLimit(`verify:${getClientIp(request)}`, 30, 60_000);
  if (!allowed) {
    return Response.json({ error: "Too many requests - try again in a minute" }, { status: 429 });
  }

  const { message, signature, ageAttested } = (await request.json()) as {
    message: string;
    signature: string;
    ageAttested?: boolean;
  };

  const session = await getSession();
  if (!session.nonce) {
    return Response.json({ error: "No nonce in session - call /api/auth/nonce first" }, { status: 400 });
  }

  const siweMessage = new SiweMessage(message);

  let verification;
  try {
    verification = await siweMessage.verify({ signature, nonce: session.nonce });
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!verification.success) {
    return Response.json({ error: "Signature verification failed" }, { status: 401 });
  }

  const walletAddress = siweMessage.address.toLowerCase();
  const db = getDb();

  const existing = await db.query.buyers.findFirst({ where: eq(buyers.walletAddress, walletAddress) });

  if (!existing) {
    if (!ageAttested) {
      return Response.json({ error: "Age attestation is required to create an account" }, { status: 400 });
    }
    await db.insert(buyers).values({
      walletAddress,
      ageAttested: true,
      ageAttestedAt: new Date(),
    });
  }

  session.nonce = undefined;
  session.walletAddress = walletAddress;
  await session.save();

  return Response.json({ walletAddress });
}
