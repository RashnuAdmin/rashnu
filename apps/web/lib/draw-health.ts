export const NON_TERMINAL_POST_CUTOFF_STATUSES = [
  "closed",
  "published",
  "funded",
  "awaiting_block",
  "winner_computed",
] as const;

export interface DrawHealthInput {
  id: number;
  drawNumber: number;
  status: string;
  cutoffAt: Date;
}

export interface StaleDraw {
  id: number;
  drawNumber: number;
  status: string;
  hoursSinceCutoff: number;
}

/**
 * A draw sitting in one of these statuses should normally resolve within
 * ~1-2 hours of cutoff (Bitcoin confirmation wait plus a little margin) - one
 * still there past `staleAfterMs` either needs admin/retry-workflow attention
 * or is still a genuine, if slow, wait (real Bitcoin block timing varies - see
 * architecture.md's M4 notes), not necessarily a bug either way.
 */
export function findStaleDraws(
  draws: DrawHealthInput[],
  now: Date,
  staleAfterMs: number,
): StaleDraw[] {
  return draws
    .filter((draw) => (NON_TERMINAL_POST_CUTOFF_STATUSES as readonly string[]).includes(draw.status))
    .filter((draw) => now.getTime() - draw.cutoffAt.getTime() > staleAfterMs)
    .map((draw) => ({
      id: draw.id,
      drawNumber: draw.drawNumber,
      status: draw.status,
      hoursSinceCutoff: Math.round(((now.getTime() - draw.cutoffAt.getTime()) / (60 * 60 * 1000)) * 10) / 10,
    }));
}
