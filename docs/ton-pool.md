# TON pool - design (Telegram Mini App)

**Status:** the contract (`contracts-ton/`) is implemented and tested - 18
tests covering access control, the full funding/settlement/recovery lifecycle,
and the forged-jetton-notification guard, including two fuzz tests on the
fee-split arithmetic. Not yet deployed anywhere real. The Mini App's auth/identity
layer is implemented and tested: `lib/telegram-init-data.ts` (Telegram user
verification) and `lib/ton-proof.ts` (TON wallet verification), both hand-rolled
against stable published specs rather than the churning SDK wrapper packages -
see the "Update (implementation time)" notes on ADR-013/ADR-014. The `/api/tg/*`
routes, the Mini App page itself (`apps/web/app/tg/`), the bot webhook, and the
`ton_*` database/purchase flow are not yet started.

A second, independent payment pool on TON, reachable via a Telegram Mini App.
**Purely additive**: the existing Base/USDC pool, its contract, its web buyer
flow, and the `rashnu-verifier` RNG/verification logic are all unchanged. See
`docs/decisions.md` ADR-010 through ADR-014 for why each choice below was made,
including the explicit caveat that this ecosystem moves fast enough that language/
tooling/SDK names should be re-verified at actual implementation time, not trusted
from this snapshot indefinitely.

## Scope boundary

- No bridge of any kind between the two pools. A TON buyer and a Base buyer are
  playing in two separate pots.
- The only thing genuinely shared is the *mechanism* of RNG, not any seed, key, or
  contract - see "Shared RNG, precisely" below; "shared seed" in ADR-004/010 means
  "same Bitcoin block can resolve both pools' winners independently," not a
  literal shared secret.
- No cross-pool buyer identity linking in v1 (ADR-013). A Base buyer and a TON
  buyer are different people as far as the system is concerned, even if the same
  human operates both wallets.

## Monorepo additions

```
/rashnu
  contracts-ton/               New sibling to contracts/ - Tolk contract, Acton
                                 project config, its own test suite. Not inside
                                 contracts/ itself: different language, different
                                 toolchain, different dependency model entirely -
                                 forcing it into the Foundry project would be worse
                                 than two clearly-separated sibling directories.
  apps/web/app/tg/              New route segment for the Telegram Mini App UI
                                 (reuses the existing Next.js app rather than a
                                 separate deployable - see "Why one app" below).
  apps/web/app/api/tg/          New API routes: Telegram bot webhook, TON-pool
                                 ticket purchase/auth endpoints, mirroring the
                                 existing /api/draws/* shape but TON-specific.
```

**Why one Next.js app, not a separate deployable:** the Mini App needs its own
UI/UX (TON Connect instead of wagmi, Telegram-platform constraints) but shares
almost everything else - the database, the draw-lifecycle workflow engine, the
RNG/verifier package, the admin dashboard, rate limiting, audit logging. Standing
up a second deployable for a UI-only difference would duplicate infrastructure
decisions (env vars, cron auth, session handling) for no real benefit at this
scale. Revisit only if the Mini App's build/deploy needs diverge enough to justify
the split later.

## The TON contract (Tolk, via Acton)

Conceptually mirrors `LotteryPool.sol`'s lifecycle (fundDraw -> await Bitcoin block
-> submitResult -> payout) but is **not a line-by-line port** - TON's execution
model is different enough that the implementation needs its own design pass:

- **Async message-passing, not synchronous calls.** A jetton (USDT) transfer is
  two hops: the sender's jetton-wallet sub-contract moves balance, then sends a
  `TransferNotification` message to *our* contract's own dedicated jetton-wallet,
  which forwards it to our main contract logic. There's no single atomic
  transaction spanning "buyer pays" and "contract records payment" the way an EVM
  `transferFrom` call can be.
- **Forged-notification check (the TON equivalent of a reentrancy guard).**
  Anyone can send a message shaped like a `TransferNotification` directly to our
  contract. It must verify the *sender* of that message is genuinely our own
  jetton-wallet address, not just trust the message's shape - documented in
  multiple TON security writeups as a real, exploited footgun, not a
  hypothetical.
- **Gas-per-message accounting, not a single gas limit.** Every outbound message
  (including the payout transfers) needs enough attached value to cover its own
  execution and, if it fails, its bounce-back. Under-provisioning gas on an
  outbound message is a real way to strand funds, not just fail loudly - "bounced
  messages" return remaining value, but only if the original message carried
  enough gas to pay for the bounce, and a bounce cannot itself bounce again.
- **Roles.** Same shape as `LotteryPool.sol` - an admin/treasury role (funds draws)
  and a separate operator role (submits results), so the automation that runs the
  draw lifecycle can hold the operator key without also holding treasury
  authority - the same reasoning as the existing contract's role split.

**Test bar:** the same rigor `LotteryPool.sol` was held to - unit tests, plus
fuzz/invariant tests via Acton's tooling (fee-split arithmetic, balance
reconciliation, the forged-notification guard specifically) before calling this
done, not just before shipping to mainnet. **Met**: 18 tests in
`contracts-ton/tests/RashnuTonPool.test.tolk`, including two fuzz tests (256
runs each) on the fee-split arithmetic and dedicated tests for the
forged-notification guard specifically (wrong sender, wrong transferInitiator).

**Implementation note on funding, decided while building, not pre-decided
above:** matching a jetton `TransferNotification` back to the right draw would
normally mean decoding a `drawId` out of the transfer's forward payload (a
TL/B `Either Cell ^Cell` structure). v1 sidesteps this: `RegisterDraw` sets
`pendingFundingDrawId`, and the next accepted `TransferNotification` funds
that specific draw - mirroring the existing EVM platform's own app-level "one
active draw at a time" invariant, just enforced here at the contract level.
Documented in `types.tolk` at the `pendingFundingDrawId` field. If
simultaneous TON draws are ever wanted, this needs revisiting to actually
decode a `drawId` from the payload instead.

**Known, documented gap, not yet closed:** `onBouncedMessage` doesn't do
anything beyond accepting the bounce - a bounced payout currently has no
retry path or on-chain marker for an operator to notice. The gas amount
attached to outbound jetton transfers (`JETTON_TRANSFER_GAS`) is also a
placeholder, not a benchmarked figure. Both need real work via Acton's gas
tooling before this is production-ready.

**Reference points, not templates to copy blindly:** Lotshot (a CertiK-audited,
fully on-chain instant-win lottery on TON - the closest direct domain match) and
STON.fi (Trail-of-Bits-audited DEX, for general production-TON-contract rigor).
Worth a close read of their actual audit reports before leaning on either as
precedent, not just their existence.

## Data model additions

New tables, not new columns on the existing ones - TON addresses aren't
0x-prefixed EVM addresses and forcing them into the same column format (or reusing
`buyers`/`tickets`/`draws` with a `chain` discriminator) would complicate every
existing EVM-pool query with a condition it doesn't need:

```
ton_buyers         (wallet_address PK [TON format], age_attested, age_attested_at, created_at)
ton_draws          (id, draw_number, cutoff_at, status, ticket_price_usdt,
                    min_tickets_threshold, rng_n, confirmations_required,
                    jetton_wallet_address, contract_draw_id, ticket_list_hash?,
                    fund_tx_hash?, ...)  -- mirrors `draws` structurally
ton_tickets        (id, public_id, draw_id, buyer_wallet_address, status,
                    ticket_index?, confirmed_at?, ...)  -- mirrors `tickets`
ton_payments       (...)  -- mirrors `payments`, USDT amounts not USDC
ton_draw_results   (...)  -- mirrors `draw_results`
```

The draw-lifecycle **workflow logic itself** (close sales -> hash ticket list ->
threshold check -> fund -> await Bitcoin block -> compute winner -> submit result
-> payout -> create next draw) is the same shape and reuses `rashnu-verifier`
unchanged - only the on-chain interaction steps (fund/submit, using a TON SDK
instead of viem) and the table names differ. Whether this becomes a second,
near-duplicate workflow file or a parameterized single workflow is an
implementation decision for when this is actually built, not pre-decided here.

## Shared RNG, precisely

"Independent parallel pool sharing the same RNG seed" (ADR-004/010) means: if the
TON pool's draw and a Base pool draw happen to share the same cutoff time, the
*same* qualifying Bitcoin block and winning transaction can resolve both,
independently:

```
winning_index_base = txid_int mod total_tickets_sold_base_pool
winning_index_ton  = txid_int mod total_tickets_sold_ton_pool
```

Same `rashnu-verifier` function (`determineWinningTicket`), called twice with each
pool's own `totalTicketsSold`. No new RNG code needed - this is already how the
function works; it just hasn't been called twice against the same block before.
The pools don't have to share a cutoff time, though - this is an option the
scheduling can take advantage of, not a requirement the architecture imposes.

## Telegram Mini App - auth and buy flow

1. User opens the Mini App from the bot. Telegram supplies `initData` - a signed
   string proving *which* Telegram user this is, verified server-side by
   `lib/telegram-init-data.ts` (HMAC-SHA256 keyed by `HMAC-SHA256("WebAppData",
   BOT_TOKEN)` over the sorted payload, hand-rolled against Telegram's own stable
   docs rather than the churning `@telegram-apps`/`@tma.js` wrapper packages - see
   ADR-014's update). Never trust the client-parsed `initDataUnsafe` object for
   anything authorization-relevant, and check `auth_date` for staleness - the same
   discipline as every other auth path in this project. On success the Telegram
   user id is stored in the `rashnu_tg_session` cookie (`lib/tg-session.ts`).
2. User connects a TON wallet via `@tonconnect/ui-react`, then signs a TON Proof
   payload (domain+nonce-bound, Ed25519). The server issues the nonce
   (`generateTonProofPayload()`, stored in the session) and verifies the wallet's
   signed reply (`verifyTonProof()` in `lib/ton-proof.ts`, using `@ton/core`'s
   `Address` to parse the wallet address and `@ton/crypto`'s `signVerify` for the
   Ed25519 check) - hand-rolled against the TON Connect spec directly; see
   ADR-013's update for why (no ready-made verification primitive actually exists
   in `@ton/ton`, despite that ADR's original wording). This establishes the TON
   wallet identity (ADR-013) - separate from, and not linked to, the Telegram user
   identity from step 1 unless explicitly stored as a mapping (useful for
   notifications - see below - but not required for buying). `lib/ton-proof.ts`
   documents a known v1 simplification: it trusts the wallet-supplied
   `Account.publicKey` directly, even though `@tonconnect/sdk`'s own types mark
   that field "not authoritative" - the documented alternative (parsing
   `walletStateInit` per wallet version, or calling `get_public_key()` on-chain)
   is real but nontrivial, and worth revisiting before mainnet, not before v1.
3. Buyer purchases tickets; pays USDT (jetton transfer) from the same connected
   wallet to the draw's published jetton-wallet address - mirrors ADR-005's
   "payment attribution is just the sender address" principle exactly, on TON's
   own token-transfer mechanics.
4. Optional: store a `(telegram_user_id, ton_wallet_address)` mapping, populated
   once a user completes step 2 inside the Mini App, so the bot can push
   "ticket confirmed" / "you won draw #N" notifications without the user needing
   to check the app. This is additive and can ship after the core buy flow works.

**Mini-App-specific TON Connect requirement, easy to miss:** a publicly-hosted
`tonconnect-manifest.json` (the app's identity, shown to wallets during
connection) and `actionsConfiguration.twaReturnUrl` set on `TonConnectUIProvider`,
so that an external wallet app's approval flow returns the user back into the
Telegram WebView afterward. This doesn't exist in a plain-web TON Connect
integration and isn't optional for the Mini App context specifically.

**Another easy-to-miss wrinkle, caught during implementation:** `next.config.ts`'s
existing `headers()` sent a blanket `X-Frame-Options: DENY` on every route - fine
for the Base buyer flow, fatal for the Mini App, since Telegram Web renders Mini
Apps inside an `<iframe>` and that header would have blocked it from ever loading
there. Fixed by excluding `/tg/*` from that rule and giving it its own
`Content-Security-Policy: frame-ancestors` instead, scoped to Telegram's own
origins (`web.telegram.org`, `oauth.telegram.org`) rather than dropping frame
protection entirely.

## What's explicitly NOT changing

- `LotteryPool.sol`, its deployed address, its history - untouched.
- The Base/USDC buyer flow, SIWE auth, existing rate limiting, admin dashboard
  (gets TON-pool draws added to its view, not replaced).
- `rashnu-verifier`'s actual RNG/hashing logic - reused as-is, called once per
  pool.
- The age-attestation/ToS/odds-disclosure principle (ADR-006 and the `/legal`
  page's content) - applies to the TON pool too, needs its own UI treatment
  inside the Mini App's constraints, not a policy change.

## Open questions for implementation time (not pre-decided here)

- Exact cadence/cutoff relationship between the two pools (same schedule, offset,
  fully independent) - a scheduling choice, not an architectural one.
- Whether the draw-lifecycle workflow becomes one parameterized implementation or
  two near-duplicate files - revisit once the TON-side on-chain interaction code
  exists and its actual shape is known.
- Telegram bot command surface beyond "open the Mini App" (e.g. `/mytickets`,
  `/odds`) - a product decision, not architecturally blocking.
