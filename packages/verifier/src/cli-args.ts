import { parseArgs } from "node:util";

export type ParsedArgs<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface ComputeWinnerArgs {
  cutoffUnixSeconds: number;
  rngN: number;
  confirmationsRequired: number;
  totalTicketsSold: number;
  source: string;
}

/** Pure argument parsing/validation - no I/O, so it's testable without a network or filesystem. */
export function parseComputeWinnerArgs(argv: string[]): ParsedArgs<ComputeWinnerArgs> {
  const { values } = parseArgs({
    args: argv,
    options: {
      cutoff: { type: "string" },
      "rng-n": { type: "string" },
      confirmations: { type: "string" },
      tickets: { type: "string" },
      source: { type: "string", default: "mempool-space" },
    },
  });

  if (!values.cutoff || !values["rng-n"] || !values.confirmations || !values.tickets) {
    return { ok: false, error: "missing required flag: --cutoff, --rng-n, --confirmations, and --tickets are all required" };
  }
  if (values.source !== "mempool-space") {
    return { ok: false, error: `unknown --source "${values.source}" (only "mempool-space" is implemented)` };
  }

  return {
    ok: true,
    cutoffUnixSeconds: Number(values.cutoff),
    rngN: Number(values["rng-n"]),
    confirmationsRequired: Number(values.confirmations),
    totalTicketsSold: Number(values.tickets),
    source: values.source,
  };
}

export interface HashTicketsArgs {
  file: string;
}

export function parseHashTicketsArgs(argv: string[]): ParsedArgs<HashTicketsArgs> {
  const { values } = parseArgs({ args: argv, options: { file: { type: "string" } } });

  if (!values.file) {
    return { ok: false, error: "missing required flag: --file is required" };
  }

  return { ok: true, file: values.file };
}
