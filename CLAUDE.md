# rashnu

Verifiable lottery platform. See `docs/architecture.md` for how it works, `docs/decisions.md` for why it's built this way, and `docs/runbook.md` for operating it (including the mainnet cutover checklist). Read those before making architectural changes — this file is just conventions.

## Engineering discipline

- Follow the `ub-mode` skill (`.claude/skills/ub-mode/SKILL.md`) on every change: First Make It Work (TDD, architecture-first) → Then Make It Right (root-cause fixes, CRAP/duplication/mutation gates) → Practice (small commits, context hygiene).
- The `ponytail` plugin is active (project-scoped): default to reuse/stdlib/one-liner before writing custom code. Use `/ponytail-review` for flow-based review and `/ponytail band` for a live cost/token dashboard.

## Context hygiene

- Keep this file short — pointers and rules, not prose or examples.
- Push exploration/research/large tool output into forks or subagents; keep the main thread to decisions and summaries.
- Once the repo has more than one component (e.g. contracts vs. web app), split this into directory-scoped `CLAUDE.md` files instead of growing this one.
