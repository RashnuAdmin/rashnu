# Decision log

Lightweight ADRs for the choices that shape this platform. Each one was deliberated
explicitly (most via a product/architecture interview) rather than defaulted into -
record the "why" here so a later change is a deliberate amendment to this log, not a
silent drift away from it.

---

### ADR-001: Real-money is the goal; testnet is the actual v1 deliverable

**Status:** Accepted.

**Context:** Real-money lottery/gambling is regulated in nearly every jurisdiction -
licensing, age/KYC, AML, and tax requirements vary widely, and operating without them
can carry serious penalties. Jurisdiction and licensing were explicitly left
undecided.

**Decision:** The engineering goal is a complete, working system on **testnet** (fake
money). Mainnet is a separate, explicitly-gated milestone (see ADR and the runbook's
mainnet cutover checklist) that does not start until legal/licensing sign-off exists -
a hard external gate, not an engineering decision.

**Consequences:** Nearly all v1 code is mainnet-ready by construction (same contract,
same logic, different config) - the cutover milestone is almost entirely
config/deployment/process, not new code.

---

### ADR-002: RNG anchored to confirmed Bitcoin block data, not live mempool state

**Status:** Accepted.

**Context:** The original idea ("the hash of the Nth transaction on Bitcoin after time
T") is ambiguous if "after time T" means mempool order - different nodes see different
pending transactions, and that view isn't preserved for someone checking a year later.

**Decision:** Anchor to confirmed block data: "the Nth transaction in the first
Bitcoin block mined after cutoff time T," using block height (not timestamp) as the
tiebreaker, with a required-confirmations wait and a thin-block fallback. See
[`architecture.md`](./architecture.md#rng-algorithm---the-locked-precise-spec) for the
full spec.

**Consequences:** Permanently and identically reproducible by anyone, forever, via any
block explorer - the core property the entire "verify it yourself" pitch depends on.

---

### ADR-003: Smart contract scope narrowed to payout/escrow only

**Status:** Accepted.

**Context:** A Bitcoin light-client bridge would let the contract verify Bitcoin data
on-chain itself, but that's significant added complexity or cost for v1. The user had
no strong preference beyond "use a smart contract if it helps transparency."

**Decision:** The contract holds the pot and executes payout once a result is
submitted by a designated operator address; ticket sales stay off-chain. The
contract's one enforceable check is that the winning index is in-bounds - it cannot
verify the Bitcoin math itself.

**Consequences:** This is **publicly falsifiable, not literally trustless** - stated
honestly on the verification page, not oversold. Fraud-resistance comes from the
funding commitment predating the randomness source (see `fundDraw` in
`architecture.md`) plus the RNG algorithm being open-source and independently
re-runnable, not from on-chain verification of Bitcoin data.

---

### ADR-004: Payment rail - USDC on Base (Base Sepolia for v1)

**Status:** Accepted.

**Context:** Compared alternatives: USDC on an EVM L2, USDT on TON, USDT on Tron
(TRC-20), Solana. All four are "easy to buy, low fee, fast" in practice; the
differentiator for a real-money product is how mature and auditable the
smart-contract security tooling is, since a contract bug directly moves real money.

**Decision:** USDC on an EVM L2 (Base), chosen for the largest auditor pool and most
battle-tested contract patterns, plus a reputable, regulator-friendly stablecoin and a
Coinbase-backed fiat onramp path. Base Sepolia testnet for v1; mainnet deferred to the
ADR-001 cutover gate.

**Consequences:** Other rails (TON, Tron) remain real future options for user
acquisition - the architecture keeps the payment rail behind a clean boundary so a
second rail can be added later as an **independent parallel pool sharing the same RNG
seed**, not a cross-chain bridge (bridging adds security risk this project doesn't
need to take on).

---

### ADR-005: Purchase/custody model - platform intake, single deposit address per draw

**Status:** Accepted (supersedes an earlier, more complex proposal).

**Context:** The user's original idea was "check the wallet to verify tickets are
paid for," implying one wallet people check, not a direct-to-contract purchase flow. A
draft plan proposed a unique HD-derived deposit address per purchase request for
payment attribution.

**Decision:** Buyers authenticate via wallet connect (Sign-In With Ethereum) and pay
from that same wallet to **one published deposit address per draw**. Attribution is
simply the sender address - no per-purchase address or memo scheme is needed, since
the payer is already a known, wallet-authenticated identity and sender addresses are
unique per buyer by construction.

**Consequences:** Simpler key management (no HD derivation/rotation bookkeeping),
matches the original "check the wallet" framing exactly, and removes a whole class of
attribution-ambiguity bugs that the simpler design doesn't need to solve.

---

### ADR-006: Compliance - self-attested age gate only for v1

**Status:** Accepted, explicitly provisional.

**Context:** Real licenses typically require real KYC; integrated ID verification
(Stripe Identity, Persona, etc.) is slower to ship and its exact requirements depend on
the jurisdiction decision still pending under ADR-001.

**Decision:** Ship a simple age checkbox (18+/21+) for v1. Explicitly acknowledged as
likely insufficient once a real license exists.

**Consequences:** Revisit before ADR-001's mainnet cutover - this is a known gap, not
an oversight.

---

### ADR-007: Low-ticket-sales handling - roll the pot over

**Status:** Accepted.

**Decision:** If a draw doesn't clear `min_tickets_threshold`, mark it `rolled_over`,
carry its tickets forward (not refunded), and fold its uncollected pot into the next
draw's `fundDraw` amount. No on-chain rollover function exists - the contract simply
isn't funded for a rolled-over draw.

**Consequences:** Keeps user funds in play rather than refunding, at the cost of a
small amount of cross-draw bookkeeping in `tickets.rolled_from_ticket_id` and
`draws.rolled_from_draw_id` / `rolled_into_draw_id`.

---

### ADR-008: v1 feature scope - one ticket type, one recurring draw

**Status:** Accepted.

**Decision:** v1 ships only the core verifiable draw (not pick-your-numbers, not
scratch cards - those are deferred) on a single recurring fixed-time cadence (nightly
cutoff).

**Consequences:** Other ticket types described in the original product idea
(pick-your-numbers, scratch cards) are real future work, but only once they can follow
the same verifiability approach as the core draw - they are out of scope until then,
not abandoned.

---

### ADR-009: Monorepo and language tooling choices

**Status:** Accepted.

**Decision:**

- pnpm workspaces + Turborepo for the TypeScript side.
- TypeScript pinned to **5.9.x**, not the newly-released 7.x, even though 7.x is
  `npm`'s `latest` tag - because Next.js's own scaffolder (`create-next-app@latest` as
  of this writing) still defaults to TypeScript 5.x, which signals the wider ecosystem
  (eslint plugins, type-aware tooling) hasn't caught up to 7.x yet. Revisit this pin
  periodically.
- Foundry for contracts, with `forge-std` and OpenZeppelin vendored as **pinned git
  submodules** (not plain committed files) - this is the standard Foundry convention
  and gives exact, auditable version pins via `.gitmodules`, which matters for a
  security-sensitive contract that outside auditors will clone and build.
- `vercel` CLI pinned as a workspace devDependency rather than installed globally, to
  avoid depending on any particular machine's global npm permissions and to keep the
  CLI version reproducible per-repo.

---

### ADR-010: A second, TON-native payment rail - parallel pool, not a replacement

**Status:** Accepted.

**Context:** Telegram made TON the exclusive blockchain for in-Mini-App crypto
payments (January 2025) - so reaching buyers inside Telegram itself effectively
requires TON support, not just "another wallet connector" on the existing EVM flow.
This is exactly the scenario ADR-004 already anticipated: "a second rail can be
added later as an independent parallel pool sharing the same RNG seed, not a
cross-chain bridge."

**Decision:** Add a second, fully independent pool denominated and settled on TON,
reachable via a Telegram Mini App. The existing Base/USDC pool, its contract, its
web buyer flow, and its verifier logic are **unchanged** - this is purely additive.
The two pools share only the RNG mechanism conceptually (see ADR below on shared
seed), never funds, contracts, or buyer identity. No bridge of any kind connects
them - a TON buyer and a Base buyer are simply playing in two separate pots that
happen to resolve via the same kind of Bitcoin-anchored randomness.

**Consequences:** This is real new engineering, not a config change - roughly
re-doing M2 (smart contract) and the relevant parts of M3 (purchase flow,
reconciliation, buyer identity) for a second chain. See `docs/ton-pool.md` for the
full design. Scoped as its own milestone track (M7+), not folded into M5/M6, which
are specific to the existing EVM platform's hardening and mainnet path.

---

### ADR-011: TON contract language and tooling - Tolk + Acton

**Status:** Accepted, with an explicit re-verify-before-building caveat.

**Context:** TON's contract-language landscape moved through three distinct phases
within 2026 alone: FunC (original) -> Tact (recommended through early 2026) -> Tolk
(current, as of this writing). Tooling moved in lockstep: Blueprint (the
FunC/Tact-era dev framework) is now itself deprecated in favor of Acton, a newer
unified toolchain with a browser IDE ("Acton Studio") and built-in fuzz/mutation
testing support. This was verified two ways before writing it down here: a
dedicated research pass, then an independent spot-check search specifically because
"Tact deprecated already" was surprising enough to doubt - both confirmed Tolk is
TON's own officially recommended current language and Tact's own GitHub repo
self-reports as deprecated.

**Decision:** Build the TON contract in **Tolk**, using **Acton** as the dev/test
toolchain (compile, deploy, test against Acton's sandbox-based local TVM emulator -
the TON analog to Foundry's `forge test`). Explicitly reject Tact/Blueprint despite
their broader existing community tutorials/examples - writing new code against an
already-deprecated stack would be a mistake caught immediately by any later
reviewer or auditor.

**Consequences:** This ecosystem is unusually fast-moving (three transitions in one
calendar year) - **re-verify the current recommended language/toolchain at actual
implementation time**, don't trust this ADR's snapshot blindly if meaningful time
has passed since it was written. Mirror the existing EVM contract's testing
discipline: fuzz + invariant tests via Acton's tooling before calling the TON
contract done, the same bar `LotteryPool.sol` was held to (see ADR process in M2).

---

### ADR-012: TON pool stablecoin - USDT, not USDC

**Status:** Accepted, explicitly flagged as a known departure from ADR-004's
original reasoning.

**Context:** ADR-004 chose USDC specifically for being "a reputable,
regulator-friendly stablecoin." On TON, there is **no native Circle-issued USDC** -
only unofficial wrapped/bridged imitations exist, which this project won't use
(consistent with ADR-004's own anti-bridge stance). **USDT, by contrast, has been
natively issued on TON (not bridged) since April 2024**, jointly announced by
Tether and the TON Foundation, and is the deep-liquidity, widely-supported
stablecoin standard there (TEP-74 jetton).

**Decision:** The TON pool is denominated and settled in native TON USDT, not
USDC. This is a real, user-facing product difference from the Base pool, not a
cosmetic one - stated plainly here rather than implied to be equivalent.

**Consequences:** Ticket prices and payouts for the TON pool are in USDT. If
Circle ever issues real native USDC on TON, revisit this ADR - the preference for
USDC's reputation (ADR-004) hasn't changed, only the lack of an actual option on
this chain.

---

### ADR-013: TON buyer identity - TON Proof, a separate namespace from EVM buyers

**Status:** Accepted.

**Context:** ADR-005 made the EVM pool's buyer identity *and* payment source the
same wallet, authenticated via SIWE. TON Connect has a direct analog - **TON
Proof** - but it's a structurally different mechanism: the wallet signs a
domain-and-nonce-bound payload (`"ton-proof-item-v2/" ++ Address ++ AppDomain ++
Timestamp ++ Payload`), verified server-side as an **Ed25519** signature, not the
secp256k1/EIP-191 path our existing `siwe` dependency handles. The official `@ton/ton`
package exposes the verification primitive directly (no mature pre-built
"ton-siwe"-equivalent library worth depending on, unlike the EVM side) - wrap it
ourselves, consistent with how deliberately thin `lib/session.ts`/`lib/admin-auth.ts`
already are.

**Decision:** TON buyers authenticate via TON Proof, using the same
"wallet-is-identity-is-payment-source" principle as ADR-005, just on TON's own
cryptography. A TON wallet address is **not** the same buyer identity as an EVM
wallet address - there is no account-linking between the two pools in v1. Someone
who has bought tickets on the Base pool and wants to buy TON-pool tickets signs in
again, separately, with their TON wallet.

**Consequences:** Two separate buyer/identity tables (or a clear discriminator
column - see `docs/ton-pool.md` for the exact schema approach), since TON
addresses aren't 0x-prefixed EVM addresses and shouldn't be forced into the same
column format. Cross-pool account linking is explicitly out of scope unless asked
for later - adding it now would be solving a problem nobody's raised yet.

---

### ADR-014: Telegram Mini App platform - `@telegram-apps/sdk` + TON Connect

**Status:** Accepted, with the same re-verify caveat as ADR-011 - this stack also
renamed itself mid-2026.

**Context:** The Telegram Mini App SDK space also churned: the older `@twa-dev/sdk`
is deprecated, merged into **`@telegram-apps/sdk`** / **`@telegram-apps/sdk-react`**
(the current official, Telegram-maintained SDK as of writing). Server-side
verification of a Mini App's `initData` (the cryptographically-signed proof of
*which* Telegram user opened the app - HMAC-SHA256 keyed by
`HMAC-SHA256("WebAppData", BOT_TOKEN)` over the sorted payload) itself moved
packages mid-cycle: `@telegram-apps/init-data-node` is already deprecated in favor
of **`@tma.js/init-data-node`**.

**Decision:** Build the Mini App with `@telegram-apps/sdk-react` for the
Telegram-side UI/platform integration, `@tma.js/init-data-node` for server-side
`initData` verification (never trust the client-parsed `initDataUnsafe` object for
anything authorization-relevant - only the raw signed string, verified
server-side, with a constant-time comparison matching the discipline in
`lib/timing-safe-equal.ts`, and an `auth_date` staleness check), and
`@tonconnect/ui-react` for wallet connection. The Mini-App-specific TON Connect
wrinkle: it needs its own publicly-hosted `tonconnect-manifest.json` and
`actionsConfiguration.twaReturnUrl` set on `TonConnectUIProvider` so an external
wallet-approval flow returns the user back into the Telegram WebView - this
doesn't exist in a plain-web TON Connect integration and is easy to miss.

**Consequences:** Same re-verify-before-building note as ADR-011 - two renames in
one package's short lifetime is a strong signal to re-check current package names
at actual implementation time, not trust this list indefinitely.
