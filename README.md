# Rashnu

A lottery platform where anyone can verify, themselves, that it's fair:

1. **Every ticket was paid for.** The platform publishes the full ticket list before
   each draw closes, hash-committed on-chain; you can check it against the pot.
2. **The winner was picked by a process nobody could rig.** The result is derived
   from a Bitcoin block that doesn't exist yet when sales close - specifically, a
   fixed transaction's hash in the first confirmed block after the cutoff, mod the
   number of tickets sold. Open-source, deterministic, and re-runnable by anyone via
   `rashnu-verifier`, with no dependency on trusting this website.

The platform takes a fixed cut of the pot (default 15%); the rest goes to the winner.

**Current status:** early build, testnet only. No real money changes hands yet - see
[`docs/decisions.md`](./docs/decisions.md) (ADR-001) for why, and
[`docs/runbook.md`](./docs/runbook.md) for the mainnet cutover checklist that has to
be cleared first.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) - how the system works: the RNG
  algorithm spec, the data model, the smart contract design, the draw lifecycle, the
  public verification page, and the delivery milestones.
- [`docs/decisions.md`](./docs/decisions.md) - why it's built this way: every locked
  product/architecture decision as a short ADR, with context and consequences.
- [`docs/runbook.md`](./docs/runbook.md) - how to run it: setup, environment
  variables, common commands, incident response, the mainnet cutover checklist.
- [`CLAUDE.md`](./CLAUDE.md) - engineering conventions for anyone (human or agent)
  working in this repo.

## Project layout

```
apps/web            Next.js app - buyer flow, admin, public /verify pages
packages/verifier    Standalone RNG/verification logic - the single source of truth,
                      published independently so anyone can run it unaided
packages/db          Drizzle schema + Neon client
contracts            Foundry project - the LotteryPool escrow/payout contract
docs                 architecture, decisions, runbook (see above)
```

## Quick start

```
git clone --recurse-submodules git@github.com:RashnuAdmin/rashnu.git
cd rashnu
pnpm install
pnpm exec vercel link && pnpm exec vercel env pull .env.local
cp .env.local apps/web/.env.local
pnpm dev
```

See [`docs/runbook.md`](./docs/runbook.md) for the full setup, every environment
variable, and the rest of the day-to-day commands (database, contracts, deploys).
