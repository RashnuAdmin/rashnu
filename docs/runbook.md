# Runbook

Operational procedures. See [`architecture.md`](./architecture.md) for how the system
works and [`decisions.md`](./decisions.md) for why it's built this way.

## Prerequisites

- Node.js 22+, pnpm (`packageManager` field in the root `package.json` pins the exact
  version).
- Foundry (`forge`, `cast`, `anvil`) - install via `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
- Vercel CLI - installed as a workspace devDependency; run via `pnpm exec vercel ...`.
- `gh` (GitHub CLI), authenticated with access to `RashnuAdmin/rashnu`.
- `crapper`/`dryer`/`mutator` (the `ub-mode` skill's quality-gate tools) - not npm
  packages (those names are taken by unrelated packages); clone the real ones as
  siblings outside the repo:
  ```
  mkdir -p ~/tools/unclebob && cd ~/tools/unclebob
  git clone https://github.com/unclebob/crapper.git
  git clone https://github.com/unclebob/dryer.git
  git clone https://github.com/unclebob/mutator.git
  ```
  Each bootstraps its own Python `.venv` on first run. `mutator` requires `crapper`
  checked out as its sibling (`../crapper`) - the layout above already satisfies that.

## First-time setup

```
git clone --recurse-submodules git@github.com:RashnuAdmin/rashnu.git
cd rashnu
pnpm install
pnpm exec vercel link          # link to the `lotto` Vercel project
pnpm exec vercel env pull .env.local
cp .env.local apps/web/.env.local   # Next.js only reads .env.local from its own app dir
```

If you cloned without `--recurse-submodules`, run `git submodule update --init
--recursive` before touching `contracts/`.

## Deployment URLs

- **Production**: https://lotto-ecru.vercel.app (the `lotto-<team>.vercel.app` alias
  shown on the Vercel project overview is protected by Vercel Authentication/SSO and
  is NOT this - use the dashboard's "Domains" link under Production Deployment to find
  the real public alias if it ever changes).
- Public JSON APIs anyone can poll without auth: `/api/draws/:drawNumber/result.json`,
  `/api/draws/:drawNumber/ticket-list.json`.

## Environment variables

Provisioned automatically into `.env.local` by `vercel env pull` once the Neon
integration is installed (see `decisions.md` ADR-004/005 for why these exist):

| Variable | Source | Used by |
|---|---|---|
| `DATABASE_URL` | Neon (via Vercel Marketplace) | `packages/db`, `apps/web` |
| `BASE_SEPOLIA_RPC_URL` | Base's public endpoint works fine: `https://sepolia.base.org` (no key needed) | `contracts` deploy scripts, `packages/verifier`'s evm-reader |
| `BASE_RPC_URL` | set manually, mainnet only | same, post-cutover |
| `BASESCAN_API_KEY` | free Basescan account -> basescan.org/myapikey | contract verification (`forge verify-contract`) - also works for Etherscan V2-unified chains, see `contracts/foundry.toml`'s `[etherscan]` section |
| `USDC_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS` | Circle's real Base Sepolia test USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (verified on-chain - don't substitute a guess) | `contracts/script/Deploy.s.sol`; the `NEXT_PUBLIC_` copy is read client-side by `BuyTickets.tsx`'s "pay now" button |
| `DEPLOYER_PRIVATE_KEY`, `POOL_ADMIN_ADDRESS`, `POOL_OPERATOR_ADDRESS`, `FEE_RECIPIENT_ADDRESS` | generate fresh testnet-only wallets (`cast wallet new`) - never reuse a real wallet | `contracts/script/Deploy.s.sol` |
| `TREASURY_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY` | the same keys as `DEPLOYER_PRIVATE_KEY`/the operator wallet above, copied into `apps/web`'s env | `workflows/draw-lifecycle.ts` - signs `fundDraw`/`approve` (treasury) and `submitResult` (operator) directly from the workflow |
| `LOTTERY_POOL_ADDRESS` | the deployed contract address (see `architecture.md`) | `workflows/draw-lifecycle.ts` |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `lib/session.ts` (iron-session cookie encryption) |
| `ADMIN_SECRET` | any random string, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` | `lib/admin-auth.ts` - the scripted/curl path only (see below); the `/admin` page itself no longer uses this |
| `ADMIN_WALLET_ADDRESSES` | comma-separated wallet addresses, e.g. `0xabc...,0xdef...` | `lib/admin-auth.ts` - wallets allowed to use the `/admin` page via ordinary SIWE sign-in; optional, but required for anyone to use the page without the shared secret |
| `CRON_SECRET` | any random string, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` | `lib/cron-auth.ts` - both `/api/cron/*` routes require `authorization: Bearer $CRON_SECRET`; Vercel attaches this automatically on its own scheduled invocations once this env var exists, per [Vercel's cron jobs docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| `TELEGRAM_BOT_TOKEN` | from [@BotFather](https://t.me/botfather) on Telegram: `/newbot`, then copy the token it gives you | `lib/telegram.ts` - used by `/api/cron/health-check` to send stuck-draw alerts |
| `TELEGRAM_CHAT_ID` | the numeric chat id to send alerts to - add the bot to the target chat/group, send it any message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and read `message.chat.id` from the JSON | `lib/telegram.ts` |

**Never commit `.env.local`, `contracts/.env`, or any file containing a private key.**
They're gitignored; keep it that way. The deployed-testnet addresses, by contrast,
are public (see `architecture.md`'s LotteryPool section) and fine to reference in
docs/commits - only the keys themselves are secret.

**Gas for the operator address specifically:** `fundDraw` is called by the admin, but
`submitResult`/`recoverStuckFunds` are called by the operator - a *different* address
that needs its own small native-token balance to pay gas. Funding only the
deployer/admin and forgetting the operator produces a "gas required exceeds
allowance (0)" error at the `submitResult` step, not at deploy time - fund both.

## Common commands

```
# whole workspace
pnpm lint / pnpm typecheck / pnpm test / pnpm build

# database (packages/db)
pnpm --filter @lotto/db db:push       # push schema changes to Neon directly (dev)
pnpm --filter @lotto/db db:generate   # generate a migration file
pnpm --filter @lotto/db db:migrate    # apply migrations
pnpm --filter @lotto/db db:studio     # Drizzle Studio UI

# contracts
cd contracts
forge build
forge test -vvv                                          # unit + fuzz + invariant, all together
forge test --match-contract LotteryPoolInvariantTest      # just the invariant suite
forge coverage --no-match-coverage "test|mocks|handlers"  # line/branch coverage on src/ only

# deploy (reads DEPLOYER_PRIVATE_KEY/USDC_ADDRESS/POOL_ADMIN_ADDRESS/
# POOL_OPERATOR_ADDRESS/FEE_RECIPIENT_ADDRESS/FEE_BPS/RECOVERY_TIMEOUT_SECS from contracts/.env)
set -a && source .env && set +a
forge script script/Deploy.s.sol:DeployLotteryPool --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast

# verify (Sourcify needs no key; Basescan needs BASESCAN_API_KEY)
forge verify-contract <address> src/LotteryPool.sol:LotteryPool --chain-id 84532 \
  --verifier sourcify --constructor-args $(cast abi-encode "constructor(address,address,address,address,uint16,uint256)" ...)
forge verify-contract <address> src/LotteryPool.sol:LotteryPool --chain-id 84532 \
  --etherscan-api-key "$BASESCAN_API_KEY" --constructor-args ... --watch

# web app
pnpm --filter @lotto/web dev
pnpm --filter @lotto/web build

# deploy
pnpm exec vercel deploy            # preview
pnpm exec vercel deploy --prod     # production

# the rashnu-verifier CLI (see docs/architecture.md for the full command set)
pnpm --filter rashnu-verifier verify -- compute-winner --cutoff <unix-seconds> \
  --rng-n 3 --confirmations 6 --tickets <count>
pnpm --filter rashnu-verifier verify -- hash-tickets --file <path.json>
pnpm --filter rashnu-verifier test:integration   # hits the real mempool.space API
```

## Manually testing a full draw cycle (M4)

Note every draw-scoped URL below uses **drawNumber** (the public, sequential
number), never the internal `id` - Next.js requires one dynamic-segment name per
route-tree position, and the public-facing routes all standardized on
`drawNumber` (a real conflict hit while building this: mixing `[drawId]` and
`[drawNumber]` at the same path position crashed the app outright).

```
# 1. Create a draw (admin API - needs ADMIN_SECRET and a deposit address you control -
#    the treasury address is the simplest choice, since ADR-005 has it fund draws
#    from its own balance anyway)
curl -X POST http://localhost:3000/api/admin/draws \
  -H "content-type: application/json" -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"ticketPriceUsdc":"5000000","minTicketsThreshold":2,"cutoffAt":"2026-12-01T00:00:00","depositAddress":"0x...","confirmationsRequired":1}'
#    (confirmationsRequired defaults to 6 / ~60 min on real Bitcoin - drop it to 1
#    for a faster manual test; 6+ for anything you actually want to trust)

# 2. Sign in as a buyer - build and sign a real SIWE message with any private key
#    (swap in the nonce from `curl http://localhost:3000/api/auth/nonce` and the
#    buyer's own key), then POST { message, signature, ageAttested: true } to
#    /api/auth/verify, keeping cookies across requests (curl -b/-c, or a browser).

# 3. Buy tickets: POST { "quantity": N } to /api/draws/<drawNumber>/tickets
#    (authenticated) -> returns totalDueUsdc and the deposit address.

# 4. Actually pay: send that exact USDC amount from the buyer's wallet to the
#    deposit address (`cast send $USDC_ADDRESS "transfer(address,uint256)" ...`).

# 5. Reconcile: curl -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/payments-tick
#    -> the buyer's tickets should flip to "confirmed" in
#    /api/draws/<drawNumber>/my-tickets. (Both cron routes require this header -
#    Vercel sends it automatically on its own scheduled invocations once
#    CRON_SECRET is set as a project env var; locally you set it yourself.)

# 6. Once past cutoff, trigger the scheduler to claim and start the lifecycle workflow:
curl -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/scheduler
#    -> {"startedDrawIds":[<id>]}. From here it runs on its own: closes sales,
#    publishes the ticket-list hash, funds the contract, durably waits for the
#    Bitcoin result, submits it on-chain, and creates the next draw - no further
#    manual steps unless something fails outright.

# 7. Watch it: curl /api/draws/<drawNumber>/result.json repeatedly, or
npx workflow inspect runs --backend vercel --project lotto --team <team-slug>
npx workflow inspect run <runId> --backend vercel --project lotto --team <team-slug>
#    (run details are encrypted by default - vercel logs / `vercel logs <url>` shows
#    the same errors in plaintext, which is usually faster for debugging a failure)

# 8. If a run fails outright (exhausted retries - check via step 7, or the draw is
#    stuck at 'closed'/'funded'/etc. with no workflow progressing it), fix the
#    underlying issue, then retry it directly (the scheduler won't re-pick it up,
#    since it only looks at status='selling'):
curl -X POST http://localhost:3000/api/admin/draws/<id>/retry-workflow -H "x-admin-secret: $ADMIN_SECRET"
#    (note: this one path still takes the internal id, not drawNumber, since it's
#    an admin operational tool, not a public-facing route)

# 9. Once settled, check the public page: http://localhost:3000/draws/<drawNumber>/verify
```

**Known constraints hit while building this:**
- Base's public RPC caps `eth_getLogs` at a 200-block range (a 413 error, not
  silently truncated results) - the payment-watcher cron chunks its block-range
  queries because of this, not as a defensive guess.
- Vercel's Hobby plan only allows **daily** cron schedules (confirmed by a deploy
  rejection, not assumed) - `apps/web/vercel.json`'s `scheduler`/`payments-tick`
  crons run once a day each; both remain manually curlable in between for faster
  iteration or recovery.
- A ticket confirmed before the `confirmedAt` column existed (pre-M4 test data)
  will have it `NULL`, which crashes `closeSalesAndPublish`'s hash computation -
  backfill it from the corresponding `payments.confirmed_at` row if you ever hit
  old data like this; every ticket confirmed from M4 onward always gets a real
  value from the payment-watcher cron.

**At most one active draw at a time** (`status` in `selling`/`closed`/`published`/
`funded`/`awaiting_block`/`winner_computed`) is enforced by the admin create-draw
endpoint - creating a second one while any draw is still active is rejected with 409,
per ADR-008's one-recurring-draw cadence. If you ever see two draws both `selling`
in the same database, something bypassed this (e.g. a direct SQL insert) - it won't
happen through the API.

## Quality gates (`crapper` / `dryer` / `mutator`)

Required by the `ub-mode` skill before calling a unit of work done: every function's
CRAP score under 10, no significant duplication, and killed mutants on anything
non-trivial. Run from the repo root, against one package at a time:

```
# 1. Generate real coverage first (crapper/mutator read it from disk)
pnpm --filter rashnu-verifier test:coverage

# 2. Complexity + coverage -> CRAP score, gated at 10
~/tools/unclebob/crapper/crapper --root packages/verifier \
  --use-existing-coverage --threshold 10 src

# 3. Duplication
~/tools/unclebob/dryer/dryer packages/verifier/src

# 4. Mutation testing - the real test-quality gate, not just a coverage number.
#    Run per file/dir; the test command must be reachable from mutator's worker
#    copies, so pass an absolute path to vitest even though --root is relative.
~/tools/unclebob/mutator/mutator --root packages/verifier \
  --test-command "pnpm --dir /ABSOLUTE/PATH/TO/packages/verifier exec vitest run" \
  src/rng.ts src/ticket-list.ts
```

`crapper --threshold 10` and `mutator` both exit non-zero on failure, so either can
gate a pre-merge check once this is wired into CI (not yet done - see below).
`.metrics/`, `coverage/`, and `target/` are all gitignored output, not source.

**Current state (as of M1):** `packages/verifier`'s RNG core (`rng.ts`), ticket-list
canonicalization, and CLI argument parsing are all at 100% mutation-kill with zero
survivors. One known, accepted gap: `cli.ts`'s `computeWinner` success-path exit-code
line (`result.status === "pending"`) is UNCOVERED, not survived - it's only reached
past a real network call, which the unit suite deliberately doesn't mock. Low risk:
it's exit-code bookkeeping in a thin CLI wrapper, not the RNG logic itself.

**Not yet done:** wiring this into CI (these tools need a Python venv bootstrap per
run, which adds real CI time/complexity - worth doing once more packages have enough
code for the gate to matter continuously, not as a one-off local check).

**Solidity (`contracts/`):** `mutator` only covers Clojure/Java/Go/TypeScript/Rust/
Python - confirmed directly against its source, not assumed. For `LotteryPool.sol`,
Foundry's own fuzz testing (`testFuzz_*`, 256 runs on the fee-split math) and invariant
testing (`forge test --match-contract LotteryPoolInvariantTest`, a stateful handler
driving 128,000 randomized fundDraw/submitResult/recoverStuckFunds calls, asserting
the pool's balance always exactly matches outstanding pots) serve the same purpose -
and did find a real bug the unit tests alone had missed: a `winner` colliding with the
pool's or token's own address made a payout silently self-transfer and get stuck. Run
via `forge test` (all three suites run together) or `forge coverage` for line/branch
coverage - currently 100% across all four on `LotteryPool.sol`. A dedicated Solidity
mutation tool (e.g. Gambit) remains a candidate addition, not yet set up - the
invariant test already caught more than unit coverage alone would have, which was the
main thing a mutation-style gate was meant to protect against here.

## Incident response

**A draw's workflow is stuck (`awaiting_block` for far longer than expected).** First
check whether the run actually failed outright versus is still legitimately durably
sleeping: `npx workflow inspect runs --backend vercel --project lotto --team
<team-slug>` (status `failed` means it exhausted retries and needs a manual
`retry-workflow` call - see the runbook's M4 testing section, step 8; `running`
means it's genuinely still waiting, which is normal and can take over an hour on
real Bitcoin). For the actual error, `vercel logs` is faster than decrypting the
workflow run's own encrypted error field. Separately, check whether the Bitcoin
data source is reachable and whether a reorg pushed the qualifying block height
backward (step 2 of the RNG spec handles this automatically by recomputing, but a
source outage won't). Confirm `draws.status` and `fund_tx_hash` before touching
anything manually - every lifecycle step re-checks DB state before acting, so
retrying is normally sufficient and safe even if a previous attempt partially ran.

**A draw is `funded` but never reaches `settled` (operator key issue, workflow
crash-looped, etc.).** `LotteryPool.recoverStuckFunds(drawId)` is the owner-only escape
hatch, callable after a configurable timeout (default 7 days) funded-but-unsettled.
This returns the pot to the treasury without paying a winner - use only when
automated settlement is genuinely broken, and record why in `audit_log`.

**A payment doesn't match any pending ticket exactly (under/overpaid).** v1 handles
this by flagging for manual admin review, not auto-refunding (see the
"Underpaid/overpaid policy" note in `architecture.md`'s data model section). Resolve
manually; do not build ad hoc refund logic under incident pressure - if this becomes
common, it's a signal to build the refund flow properly, not to patch around it.

**Suspected RNG/verification mismatch reported publicly.** This is the most serious
class of incident, since it goes directly to the platform's core trust claim.
Reproduce independently using the `rashnu-verifier` CLI's `compute-winner` command
(see above) with the draw's published cutoff/rngN/confirmations/ticket-count before
responding - once M2's evm-reader lands, this becomes a single `--contract
--draw-id` invocation that reads those parameters itself. If the published result is
actually wrong, the dispute channel (GitHub issue template, per `architecture.md`) is
where this gets acknowledged publicly - do not quietly patch data.

## Mainnet cutover checklist (ADR-001 / M6)

Do not check any of these off casually - this gate exists specifically so that
"real money" isn't a silent side effect of normal development velocity.

- [ ] Written legal/licensing sign-off for the target jurisdiction(s) - a hard
      external gate, obtained from counsel, not inferred by the engineering team.
- [ ] Professional third-party security audit of `LotteryPool.sol`, findings resolved.
- [ ] Operator **and** owner keys migrated from hot EOA to a Safe multisig.
- [ ] Mainnet Base USDC address and mainnet RPC wired into config (not code changes).
- [ ] Fresh deployment to Base mainnet, Basescan-verified, matching the audited source
      exactly.
- [ ] KYC/age-verification approach re-evaluated against actual licensing
      requirements (see ADR-006 - self-attestation was explicitly provisional).
- [ ] A capped, monitored real-money soft launch (small max pot/ticket caps) with the
      contract's `pause()` kill-switch wired to on-call, before caps are lifted.
