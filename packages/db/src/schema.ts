import {
  bigint,
  bigserial,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * All USDC amounts are bigint base units (6 decimals) - never floats, anywhere in this schema.
 */

export const drawStatus = pgEnum("draw_status", [
  "scheduled",
  "selling",
  "closed",
  "rolled_over",
  "published",
  "funded",
  "awaiting_block",
  "winner_computed",
  "settled",
  "failed",
]);

export const ticketStatus = pgEnum("ticket_status", [
  "pending_payment",
  "confirmed",
  "void",
  "rolled_forward",
]);

export const buyers = pgTable("buyers", {
  walletAddress: text("wallet_address").primaryKey(),
  ageAttested: boolean("age_attested").notNull().default(false),
  ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const draws = pgTable("draws", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  drawNumber: integer("draw_number").notNull(),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
  status: drawStatus("status").notNull().default("scheduled"),

  ticketPriceUsdc: bigint("ticket_price_usdc", { mode: "bigint" }).notNull(),
  minTicketsThreshold: integer("min_tickets_threshold").notNull(),

  // RNG parameters, fixed per-draw and published before cutoff - see packages/verifier.
  rngN: integer("rng_n").notNull().default(3),
  confirmationsRequired: integer("confirmations_required").notNull().default(6),

  depositAddress: text("deposit_address").notNull(),
  contractDrawId: bigint("contract_draw_id", { mode: "bigint" }),

  rolledFromDrawId: bigint("rolled_from_draw_id", { mode: "number" }),
  rolledIntoDrawId: bigint("rolled_into_draw_id", { mode: "number" }),

  ticketListHash: text("ticket_list_hash"),
  ticketListPublishedAt: timestamp("ticket_list_published_at", { withTimezone: true }),
  fundTxHash: text("fund_tx_hash"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // $onUpdate, not a call-site concern: every one of the lifecycle workflow's
  // several `.update(draws)` calls would otherwise have to remember to set this
  // by hand - found because it was in fact stuck at creation time forever, never
  // once updated, despite the column's whole purpose.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  drawNumberIdx: uniqueIndex("draws_draw_number_idx").on(table.drawNumber),
}));

export const tickets = pgTable("tickets", {
  // bigserial id is the ordering key for the deterministic ticket list (see RNG spec) - not a UUID.
  id: bigserial("id", { mode: "number" }).primaryKey(),
  publicId: uuid("public_id").notNull().defaultRandom(),

  drawId: bigint("draw_id", { mode: "number" })
    .notNull()
    .references(() => draws.id, { onDelete: "restrict" }),
  buyerWalletAddress: text("buyer_wallet_address")
    .notNull()
    .references(() => buyers.walletAddress, { onDelete: "restrict" }),

  status: ticketStatus("status").notNull().default("pending_payment"),
  ticketIndex: integer("ticket_index"), // assigned only at cutoff snapshot
  // Set when the payment watcher confirms this ticket - required by the canonical
  // ticket-list hash (packages/verifier's TicketListEntry), not just informational.
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

  rolledFromTicketId: bigint("rolled_from_ticket_id", { mode: "number" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: uniqueIndex("tickets_public_id_idx").on(table.publicId),
  drawTicketIndexIdx: uniqueIndex("tickets_draw_id_ticket_index_idx").on(
    table.drawId,
    table.ticketIndex,
  ),
}));

export const payments = pgTable("payments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  drawId: bigint("draw_id", { mode: "number" })
    .notNull()
    .references(() => draws.id, { onDelete: "restrict" }),

  txHash: text("tx_hash").notNull(),
  fromAddress: text("from_address").notNull(),
  amountUsdc: bigint("amount_usdc", { mode: "bigint" }).notNull(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull(),
  confirmations: integer("confirmations").notNull().default(0),

  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (table) => ({
  txHashIdx: uniqueIndex("payments_tx_hash_idx").on(table.txHash),
}));

export const drawResults = pgTable("draw_results", {
  drawId: bigint("draw_id", { mode: "number" })
    .primaryKey()
    .references(() => draws.id, { onDelete: "restrict" }),

  qualifyingBtcBlockHeight: bigint("qualifying_btc_block_height", { mode: "number" }).notNull(),
  qualifyingBtcBlockHash: text("qualifying_btc_block_hash").notNull(),
  qualifyingBtcBlockTime: timestamp("qualifying_btc_block_time", { withTimezone: true }).notNull(),

  winningTxId: text("winning_tx_id").notNull(),
  winningTxIndexInBlock: integer("winning_tx_index_in_block").notNull(),
  winningTicketIndex: integer("winning_ticket_index").notNull(),
  winningTicketId: bigint("winning_ticket_id", { mode: "number" })
    .notNull()
    .references(() => tickets.id, { onDelete: "restrict" }),
  winnerWalletAddress: text("winner_wallet_address").notNull(),

  payoutAmountUsdc: bigint("payout_amount_usdc", { mode: "bigint" }).notNull(),
  feeAmountUsdc: bigint("fee_amount_usdc", { mode: "bigint" }).notNull(),
  verifierVersion: text("verifier_version").notNull(),

  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  settlementTxHash: text("settlement_tx_hash"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

/**
 * Fixed-window rate limiting backed by Postgres (not Redis - this app's traffic
 * doesn't warrant a second infra dependency yet). One row per (key, window);
 * concurrent requests race on the same row via an upsert, not application code.
 */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.key, table.windowStart] }),
}));

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
