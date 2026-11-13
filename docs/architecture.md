# Architecture

## What this system is

A lottery platform whose entire value proposition is that anyone — not just the
operator — can independently verify two things:

1. Every sold ticket was actually paid for (check the published ticket list against
   the wallet/pot balance).
2. The winner was chosen by a process nobody could manipulate, because it's derived
   from public Bitcoin blockchain data that doesn't exist yet at the moment ticket
   sales close.

The platform takes a fixed cut of the pot (default 15%) and pays the rest to the
winner. See [`decisions.md`](./decisions.md) for why each major choice below was made
instead of an alternative.

**Trust model, stated honestly:** this is *publicly falsifiable*, not literally
trustless. The smart contract cannot verify Bitcoin data on-chain (no light-client
bridge — see ADR-003); a designated operator address submits the result. What makes
this safe is that (a) the pot is committed on-chain, hash-locked to a published ticket
list, *before* the Bitcoin data used for randomness can exist, and (b) the RNG
algorithm is open-source, deterministic, and runnable by any stranger via
`rashnu-verifier`, so a fraudulent submission is publicly, permanently provable, not
just privately suspected.

## Monorepo structure

```
/rashnu
  apps/web                     Next.js App Router - buyer flow, admin, public /verify pages, API routes
  packages/verifier             STANDALONE, dependency-light - the single source of truth for RNG math
                                 (will be published to npm as `rashnu-verifier`, see M5)
  packages/db                   Drizzle schema + Neon client, shared by the web app and scripts
  packages/contracts-sdk        (M2+) generated ABI + typed viem bindings from the Foundry build
  contracts                     Foundry project (own toolchain; forge-std and OpenZeppelin as
                                 pinned git submodules - see .gitmodules)
  docs                          this documentation
```

**Why `packages/verifier` is isolated:** it has zero dependency on the web app, the
database, or any secret - only a read-only chain client and public HTTP calls to
Bitcoin explorers. The web app's draw-lifecycle orchestration *imports this package as
a library* to compute the "official" result; it never reimplements the math. The same
function that produces the official answer is the function a total stranger runs via
`npx rashnu-verifier`. This removes the "the website quietly drifted from the public
tool" failure mode by construction - one decision lives in one place.

**Why Foundry sits outside `/packages`:** `forge install`'s git-submodule dependency
model doesn't compose cleanly with pnpm's node_modules. Foundry is a sibling of
`apps/` and `packages/`, with its own toolchain.

## RNG algorithm - the locked, precise spec

This is the trust-critical core of the entire platform (see ADR-002). It must stay
exactly this precise, with no implicit behavior, because it is independently
re-implemented by anyone running `rashnu-verifier`.

**Committed inputs**, fixed before the qualifying block can exist:

- `T` - the draw's cutoff timestamp (UTC).
- `N` - fixed integer, default **3**, **1-indexed over the block's full transaction
  list including the coinbase transaction as position 1** (so N=3 is the block's 2nd
  non-coinbase transaction - documented here as an adjustable constant, not hidden).
- `K` - required confirmations before a candidate block is treated as final, default
  **6** (~60 minutes).
- The full ordered ticket list, canonicalized and hashed at the moment of cutoff -
  before anyone can know what the qualifying block will contain.

**Steps:**

1. **Qualifying height.** `H = H_cutoff + 1`, where `H_cutoff` is the highest block
   whose header timestamp is `<= T`. Height-based, not "whichever block I happened to
   be watching live" - any future observer re-derives the identical `H` purely from
   permanent on-chain timestamps.
2. **Confirmation wait.** Don't evaluate block `H` until it has `>= K` confirmations.
   If `H` is reorged out before that, recompute `H_cutoff`/`H` from the new chain state
   and wait again.
3. **Thin-block fallback.** Once `H` has `K` confirmations, if `txCount(H) < N`, advance
   to `H + 1` and repeat step 2/3. (Sanity cap: abort/alert after 20 hops - an
   operational safety valve, not a cryptographic requirement. In practice this almost
   never triggers; average Bitcoin blocks carry thousands of transactions.)
4. **Select the transaction.** The Nth transaction (1-indexed, coinbase = position 1)
   in block `H`.
5. **Derive the winning index.** Parse that transaction's txid (standard big-endian hex
   display, as shown by mempool.space / blockstream.info / `bitcoin-cli
   getrawtransaction`) as an unsigned integer. `winning_index = txid_int mod
   total_tickets_sold`. (Modulo bias at this scale is undetectable: txid space is 256
   bits against at most low-millions of tickets - no rejection sampling needed.)
6. **Ticket ordering.** By `(created_at ASC, id ASC)`, where `id` is a monotonic
   `bigserial` (not a UUID, which carries no ordering information) - ties are
   structurally impossible.
7. **Canonical hash.** SHA-256 over a fixed-column CSV
   (`ticket_index,buyer_wallet_address,ticket_public_id,confirmed_at`), rows sorted by
   `ticket_index` ascending, each row (including the last) terminated by a single
   `\n`, UTF-8 bytes - not JSON, which has key-order/number-format ambiguity. A
   pretty-printed JSON copy is published for humans; the hash committed on-chain is
   always over this CSV. Implemented in `packages/verifier/src/ticket-list.ts`
   (`canonicalizeTicketList` + `hashTicketList`).

**Golden fixtures** (built in M1): at least one real historical Bitcoin block, plus one
genuinely thin/near-empty historical block to exercise the step-3 fallback path.

## Off-chain data model (Postgres / Neon, via Drizzle)

Schema lives in `packages/db/src/schema.ts`. Currently live in the provisioned Neon
database: `buyers`, `draws`, `tickets`, `payments`, `draw_results`, `audit_log`.

Cross-cutting rules:

- All USDC amounts are `bigint` base units (6 decimals) - never floats, anywhere.
- Buyer identity is wallet-based (Sign-In With Ethereum). The wallet used to
  authenticate is the same one used to pay and to receive payout, so **payment
  attribution is just the sender address** - no per-purchase unique deposit address or
  memo scheme is needed. Each draw publishes **one** deposit address.
- Financial foreign keys are `ON DELETE RESTRICT` - nothing money-related is
  cascade-deletable.
- Underpaid/overpaid transfers are flagged for manual admin resolution in v1, not
  auto-refunded.

**Rollover:** a draw under `min_tickets_threshold` is marked `rolled_over`; its tickets
are marked `rolled_forward`; new ticket rows are inserted into the next draw pointing
back via `rolled_from_ticket_id`. History is never mutated - every past draw, including
rolled-over ones, keeps an independently re-publishable record.

## `LotteryPool` smart contract

Location: `contracts/src/LotteryPool.sol`. Built with Foundry + OpenZeppelin
(`contracts/lib/openzeppelin-contracts`, pinned at v5.7.0). **Deployed and verified
on Base Sepolia** at
[`0x115623A1c4f325455c24c16AC7b6FC1f7a5683FD`](https://sepolia.basescan.org/address/0x115623A1c4f325455c24c16AC7b6FC1f7a5683FD)
(verified on both Basescan and Sourcify - exact source match), against Circle's real
test USDC on Base Sepolia (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`), configured
with the testnet admin/operator/feeRecipient addresses, 15% fee, 7-day recovery
timeout. Deployment record: `contracts/broadcast/Deploy.s.sol/84532/run-latest.json`.

Deliberately narrow scope (ADR-003): payout/escrow only. One deployed contract handles
every draw's lifecycle. **No on-chain rollover function** - if a draw misses threshold,
the platform simply never calls `fundDraw` for it, and the collected USDC rolls into
the next draw's funding amount.

**Roles:** `DEFAULT_ADMIN_ROLE`/owner (treasury; EOA on testnet, **must** become a Safe
multisig before mainnet - see the runbook's mainnet cutover checklist). `OPERATOR_ROLE`
(the result-submitting address, kept separate from owner so it can later point at
automation without redeploying).

**Core functions:**

- `fundDraw(drawId, amount, ticketCount, ticketListHash, cutoffTimestamp)` -
  owner-only. Pulls `amount` USDC from treasury via `SafeERC20`. **Happens before the
  qualifying Bitcoin block can exist** - the on-chain, timestamped commitment to
  `ticketListHash` provably predates the randomness source. This ordering is the core
  anti-manipulation property of the whole design.
- `submitResult(drawId, winner, winningTxId, winningTicketIndex)` - operator-only,
  `nonReentrant`. Requires `winningTicketIndex < ticketCount` (the contract's one
  possible sanity check - it cannot verify the Bitcoin math itself). Splits the pot by
  `feeBps` (default 1500 = 15%), pays winner and fee recipient atomically, emits one
  `DrawSettled` event - the canonical record the public verifier reads.
- `recoverStuckFunds(drawId)` - owner-only escape hatch after a configurable timeout
  (e.g. 7 days funded-but-unsettled) - guards against a lost/compromised operator key
  permanently stranding a pot.
- `pause()` / `unpause()` gating the two state-changing functions.

**Security:** `ReentrancyGuard`, `SafeERC20`, checks-effects-interactions, USDC
address/fee recipient/feeBps set at deploy time (mainnet cutover = redeploy with new
config, not a code change). `submitResult` also rejects a `winner` equal to the pool's
own address or the token's - a real finding from the invariant fuzzer (see below), not
something a manual review caught: without it, a winner address colliding with either
contract makes the payout self-transfer and get stuck while the draw still records as
cleanly `Settled`.

## Draw lifecycle orchestration (Vercel)

State machine: `scheduled -> selling -> closed -> {rolled_over | published} -> funded
-> awaiting_block -> winner_computed -> settled` (plus `failed` for manual
intervention). Implemented as a Vercel Workflow (`apps/web/workflows/draw-lifecycle.ts`,
not yet written - M4), triggered by a per-minute Vercel Cron.

- **Cron - scheduler:** finds draws past `cutoff_at` still `selling`, starts/resumes
  that draw's workflow run; creates the next scheduled draw ahead of time.
- **Cron - payment watcher:** polls the EVM RPC for transfers into the draw's single
  deposit address, writes `payments`, confirms tickets. Built in M3
  (`apps/web/app/api/cron/payments-tick/route.ts`) and manually triggered there;
  wiring it to an actual schedule is the remaining M4 work.
- **Workflow:** cutoff/order/hash -> threshold check (rollover if under, ending the run
  with no contract call) -> publish ticket list + call `fundDraw` -> durably await the
  qualifying Bitcoin block (an open-ended wait, potentially hours - exactly what
  Workflow's pause/resume exists for) -> compute winner via `rashnu-verifier` as a
  direct library import -> call `submitResult` -> publish final state.

**Idempotency is a hard requirement:** every step must be safe to re-run - on-chain
calls are guarded against `draws.status`/`fund_tx_hash` before dispatching, and
`drawId` uniqueness is enforced on-chain, so a retried step can never double-submit a
transaction that moves money.

**Operator wallet (v1):** a hot-wallet key in an encrypted Vercel environment variable.
Explicitly testnet-only - see the runbook's mainnet cutover checklist.

**Infra note:** minute-level Cron polling needs Vercel Pro (or an external scheduler
hitting a protected route instead).

## Public verification page

`/draws/[drawNumber]/verify` (not yet written - M4), entirely data-driven from
already-published facts, so a skeptic never has to trust the page's framing - only the
raw artifacts it links to: the canonical ticket-list CSV (hash recomputed client-side
in-browser as a self-check), a Basescan link to the `fundDraw` transaction, a direct
link to the qualifying block on a public explorer (not proxied by the platform), the
chosen transaction, the arithmetic spelled out with real numbers, the settlement
transaction, and a prominent "don't trust this page - verify it yourself" block with
the exact `npx rashnu-verifier` command and a link to the open-source verifier/contract
repos. A visible dispute channel (a GitHub issue template is enough for v1).

## Delivery milestones

- **M0 - Foundations.** ✅ Done. Monorepo scaffold, Next.js app deployed to Vercel,
  Neon Postgres provisioned + schema pushed, Foundry + OpenZeppelin scaffolded, CI
  workflow written.
- **M1 - RNG + Verifier core.** ✅ Done. `determineWinningTicket` (`src/rng.ts`) and
  `canonicalizeTicketList`/`hashTicketList` (`src/ticket-list.ts`) are built
  test-first against real-block golden fixtures (block 800000 for the happy path,
  block 100 for the genuinely-thin-block fallback). A live `MempoolSpaceSource`
  adapter and a `rashnu-verifier` CLI (`compute-winner`, `hash-tickets`) have been run
  end to end against the real Bitcoin network, reproducing the fixture's
  hand-verified answer exactly. The `mutator` mutation-kill-rate gate passes at 100%
  (59/59 mutants killed, 0 survived) across the RNG core, ticket-list, and
  argument-parsing logic - see `docs/runbook.md`'s Quality gates section for the exact
  commands and the one accepted, low-risk coverage gap. Open for later: the
  `--contract`/`--draw-id` CLI interface, which needs the contract (M2) to exist
  first, and wiring the quality gates into CI.
- **M2 - Smart contract.** ✅ Done. `LotteryPool.sol`, 37 Foundry tests (unit + a
  256-run fuzz test on the fee split + a 128,000-call invariant test + negative/
  reentrancy tests) at 100% line/statement/branch/function coverage. The invariant
  fuzzer found a real bug (see above) before anything else did. Deployed, verified on
  Basescan and Sourcify, and walked through manually end to end (fund → settle →
  payout) against real Sepolia test USDC - confirmed exact 85/15 split on-chain.
- **M3 - Purchase + reconciliation.** ✅ Done. SIWE wallet connect/sign-in (`wagmi` +
  `siwe` + `iron-session`), a buy-ticket flow against the draw's single deposit
  address (with an in-page "pay now" button that sends the USDC transfer directly
  from the buyer's connected wallet), a payment-watcher cron that scans USDC
  `Transfer` logs and reconciles cumulative payment against pending tickets
  (`lib/reconciliation.ts`, pure and unit-tested), and a minimal secret-gated admin
  dashboard to create draws and see ticket/payment summaries. Verified end to end
  against live Base Sepolia: real SIWE signature from a real wallet, a real on-chain
  USDC transfer, the cron correctly confirming exactly the right tickets.
  Two real bugs the live test surfaced, both fixed: (1) a failed API response can
  still mean its database write committed - a crashed `JSON.stringify` on a bigint
  left an orphaned extra "selling" draw row, which exposed a missing invariant
  (fixed by rejecting a second active draw outright, matching ADR-008's one-draw-
  at-a-time cadence); (2) Base's public RPC caps `eth_getLogs` at a 200-block range -
  the watcher now chunks requests instead of assuming a wide range is available.
- **M4 - Full lifecycle + public verification.** 🟡 In progress.
  `workflows/draw-lifecycle.ts` (Vercel Workflow SDK) implements the full pipeline -
  close sales, void unpaid tickets, commit the ticket-list hash, threshold check
  with rollover, fund on-chain, durably poll for the Bitcoin result, submit on-chain,
  read the authoritative payout split back from the emitted event, create the next
  draw. The scheduler route claims draws atomically so overlapping cron ticks can't
  double-start one. The public `/draws/[drawNumber]/verify` page and its
  `ticket-list.json`/`result.json` APIs are live, including a client-side hash
  recomputation via the Web Crypto API (confirmed matching in-browser, not just
  claimed by the server).
  First live run on Sepolia (draw #2, carried over from M3 testing) is underway as
  of this writing: ticket list hashed, 3 tickets correctly voided-or-confirmed,
  `fundDraw` landed on-chain and verified, now durably awaiting Bitcoin
  confirmations. Two real bugs found and fixed via this live run, not by
  inspection: (1) tickets confirmed before `confirmedAt` existed had `NULL` there,
  crashing hash computation - backfilled the real value from `payments`, no code
  defensiveness needed since new confirmations always set it now; (2) a workflow
  run that fails outright (exhausts retries) can't be picked back up by the
  scheduler, which only looks at `status='selling'` draws - added an admin
  `retry-workflow` endpoint.
  The rollover path is now verified live too (a second draw, inserted directly with
  a confirmed-ticket count deliberately below its threshold, past the admin
  endpoint's one-active-draw guard - that guard only lives there, not in the
  scheduler or workflow): status flips to `rolled_over` with no contract call, a
  linked next draw is created, and its ticket correctly carries forward as
  `confirmed` with its *original* `confirmedAt`, not a fabricated one. That test
  also caught a real bug: the verify page suggested recomputing a Bitcoin-derived
  winner for a draw that never reached that stage - fixed with a dedicated
  explanation for the rolled-over case (what's actually checkable: the published
  list really is under threshold, and its tickets really do reappear in the next
  draw's list) instead of a misleading CLI command.
  Draw #2 reached `settled` (qualifying block 975472, confirmed after the real
  ~110-minute wait for 6 confirmations - the first poll's 90-minute timeout wasn't
  a bug, just too short for this particular stretch of block times). This gave the
  first opportunity to actually perform the "don't trust this page" verification
  the whole platform is built around, end to end, with zero DB access:
  - `rashnu-verifier hash-tickets`, run standalone against only the published
    `ticket-list.json`, reproduced the exact hash committed on-chain in the
    `fundDraw` tx (decoded directly from a public Base Sepolia RPC) - matches.
  - `rashnu-verifier compute-winner`, run standalone against only the publicly
    committed cutoff/N/confirmations/ticketCount and live Bitcoin data, reproduced
    the exact qualifying block, winning txid, and winning ticket index the platform
    stored - matches.
  - The on-chain `DrawSettled` event (authoritative, read directly from the
    settlement tx's logs, not the DB) reproduced the exact winner, winning ticket
    index, payout, and fee the DB's `draw_results` row claims - matches.
  - The public `/draws/2/verify` page itself renders the settled state correctly
    (status, winner, 12.75/2.25 USDC split).
  This is real evidence the core anti-manipulation property holds, not just unit
  tests against fixtures. Still open: the "3-5 consecutive nights" exit criterion,
  which needs real elapsed time across multiple nights, not a technical gap.
- **M5 - Hardening (still testnet).** 🟡 In progress.
  - **Admin auth** ✅. The `/admin` page's own code comment claimed Vercel
    Authentication was the real gate keeping it off the public internet - false for
    the actual production domain (`lotto-ecru.vercel.app`), confirmed live (the page
    returned 200 to an unauthenticated request). Replaced the pasted-secret UI with
    the existing SIWE primitive: `getAdminActor` (`lib/admin-auth.ts`) accepts either
    a signed-in session on an `ADMIN_WALLET_ADDRESSES`-allow-listed wallet, or the
    `x-admin-secret` header (kept for the runbook's scripted curl commands only).
    Also wired up `audit_log`, unused since M0 - admin actions now record their
    actor. `ADMIN_WALLET_ADDRESSES` still needs to be set in Vercel for anyone to use
    the wallet path in production (pending the user's confirmation of which wallet).
  - **Age-attestation/ToS/odds-disclosure UI** ✅. Age attestation already existed
    (ADR-006); added `/legal` (eligibility, the exact odds formula, the 15%/85% fee
    split, rollover policy, dispute channel) and a live odds line on the buy page.
  - **Abuse protection** ✅ (partial). `/api/draws/[drawNumber]/tickets` allowed up
    to 1000 unpaid ticket rows per request with no limit on repeated calls; added a
    Postgres-backed fixed-window rate limiter (`lib/rate-limit.ts`,
    `rate_limit_buckets` table) - 10 req/min per wallet on ticket purchase, 30 req/min
    per IP on the pre-auth SIWE nonce/verify routes. Confirmed live (request 31 of 31
    rapid-fire nonce calls returned 429). Upstash Redis (the platform's documented
    preference for this) would be the next step if real traffic ever warrants it -
    not provisioned, since that needs an explicit go-ahead to create a new resource.
  - **Security review** ✅ (self-run, no `security-review` skill is installed).
    Found and fixed: both `/api/cron/*` routes had no authorization at all - a
    plain public GET anyone could trigger directly (RPC log scans, workflow
    starts), fixed with Vercel's documented `CRON_SECRET` bearer-token pattern
    (`lib/cron-auth.ts`); the admin secret and the new cron secret were compared
    with `===`, a timing oracle against a public endpoint, fixed with a
    hash-then-`timingSafeEqual` helper (`lib/timing-safe-equal.ts`); the session
    cookie never set an explicit `SameSite`, relying on browser-default Lax
    behavior - now explicit, since `/admin`'s POST routes authorize off that
    cookie alone. `CRON_SECRET` was set in Vercel production *before* deploying
    the check, specifically to avoid breaking the live nightly scheduler.
  - **Load testing** 🟡 (partial, with a real finding). A deliberately modest
    `autocannon` run against the live production domain got challenged by
    Vercel's own Security Checkpoint (bot mitigation) - and even a single plain
    `curl` from the same shell got the same 403 afterward, while the identical
    page loaded fine from an actual browser seconds later. This confirms the
    block is IP/behavior-scoped to this environment's sustained scripted traffic
    over the session (hours of polling loops, repeated curls), not a site-wide
    outage - real users are unaffected. Didn't attempt to work around the
    challenge (that's bot-detection evasion). Net takeaway: the platform's own
    edge-level abuse protection is real and already defends the site
    independently of anything in this app's own code - genuine load testing at
    volume needs a different vantage point than this shell's IP.
  - **Monitoring** ✅ (basic). `lib/draw-health.ts`'s `findStaleDraws` flags any
    non-terminal, past-cutoff draw more than 3h past cutoff (generous past the
    ~1-2h a real Bitcoin confirmation wait should take); `GET /api/admin/health`
    exposes it and the `/admin` page now shows a banner naming the exact
    retry-workflow command. Real alerting (pushing a notification anywhere) needs
    a messaging integration and a destination - the user's call, not assumed.
    Also fixed while building this: `draws.updatedAt` existed since M0 but no
    `.update(draws)` call ever set it, permanently stuck at creation time - fixed
    at the schema level with `$onUpdate` so no call site has to remember it.
  - **Publishing `rashnu-verifier` to npm** 🟡 (prepared, not published). `main`
    pointed straight at `src/*.ts` (monorepo-only resolution) and `bin/cli.js`
    pulled in `tsx` at runtime just to run its own CLI - neither works for an
    external npm consumer. Added `tsup` (bundles `cli.ts`/`index.ts`, emits
    `.d.ts`), removed `private: true`, added `files`/`exports`/repository
    metadata and a standalone README (what npm's registry page actually shows,
    not the repo root's), and verified via `npm pack --dry-run` that only
    `dist/`, `bin/`, and the README ship. Confirmed turbo's existing
    `dependsOn: ["^build"]` correctly builds `rashnu-verifier` before `apps/web`
    with zero `turbo.json` changes (deleted `dist/`, re-ran the full monorepo
    typecheck/lint/test/build from clean to be sure). `license` is set to the
    placeholder `"UNLICENSED"` - an actual license is the user's choice, not
    assumed. Actually running `npm publish` needs the user's own npm
    credentials and an explicit go-ahead; not attempted.
- **M6 - Mainnet cutover (separate, explicitly gated).** See the runbook's mainnet
  cutover checklist. Does not start until legal/licensing sign-off and a professional
  contract audit are both in hand.
- **M7 - TON pool + Telegram Mini App (separate track, not blocked by M6).** A
  second, independent payment pool on TON, reachable via a Telegram Mini App - see
  ADR-010 through ADR-014 in `decisions.md` and the full design in
  [`ton-pool.md`](./ton-pool.md). Purely additive: the existing Base/USDC pool,
  contract, and buyer flow are unchanged. Not started - full design research done
  and documented; next steps are the Tolk/Acton contract, the new `ton_*` tables,
  and the Mini App buy flow, roughly mirroring M2/M3's shape for the new chain.
