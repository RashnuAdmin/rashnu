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
