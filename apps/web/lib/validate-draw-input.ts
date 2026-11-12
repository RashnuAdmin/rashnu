import { isAddress } from "viem";

export interface CreateDrawInput {
  ticketPriceUsdc: string;
  minTicketsThreshold: number;
  cutoffAt: string;
  depositAddress: string;
  rngN?: number;
  confirmationsRequired?: number;
}

export type ValidatedCreateDraw = {
  ticketPriceUsdc: bigint;
  minTicketsThreshold: number;
  cutoffAt: Date;
  depositAddress: `0x${string}`;
  rngN: number;
  confirmationsRequired: number;
};

export type ValidationResult = ({ ok: true } & ValidatedCreateDraw) | { ok: false; error: string };

/**
 * This same creation path is reused unchanged at mainnet cutover (ADR-001) - a
 * typo'd depositAddress accepted here isn't just a bad test draw, it's exactly
 * the kind of input that would misdirect real funds later. Checked now, on
 * testnet, while a mistake only costs test USDC.
 */
export function validateCreateDrawInput(body: Partial<CreateDrawInput>): ValidationResult {
  if (!body.depositAddress || !isAddress(body.depositAddress)) {
    return { ok: false, error: "depositAddress must be a valid Ethereum address" };
  }

  const cutoffAt = body.cutoffAt ? new Date(body.cutoffAt) : null;
  if (!cutoffAt || Number.isNaN(cutoffAt.getTime())) {
    return { ok: false, error: "cutoffAt must be a valid date" };
  }

  let ticketPriceUsdc: bigint;
  try {
    ticketPriceUsdc = BigInt(body.ticketPriceUsdc ?? "");
  } catch {
    return { ok: false, error: "ticketPriceUsdc must be an integer string (USDC base units)" };
  }
  if (ticketPriceUsdc <= 0n) {
    return { ok: false, error: "ticketPriceUsdc must be positive" };
  }

  if (!Number.isInteger(body.minTicketsThreshold) || body.minTicketsThreshold! < 1) {
    return { ok: false, error: "minTicketsThreshold must be a positive integer" };
  }

  const rngN = body.rngN ?? 3;
  if (!Number.isInteger(rngN) || rngN < 1) {
    return { ok: false, error: "rngN must be a positive integer" };
  }

  const confirmationsRequired = body.confirmationsRequired ?? 6;
  if (!Number.isInteger(confirmationsRequired) || confirmationsRequired < 1) {
    return { ok: false, error: "confirmationsRequired must be a positive integer" };
  }

  return {
    ok: true,
    ticketPriceUsdc,
    minTicketsThreshold: body.minTicketsThreshold!,
    cutoffAt,
    depositAddress: body.depositAddress,
    rngN,
    confirmationsRequired,
  };
}
