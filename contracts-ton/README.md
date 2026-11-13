# rashnu-ton-pool

The TON-native escrow/payout contract for Rashnu's parallel TON pool - see
[`../docs/ton-pool.md`](../docs/ton-pool.md) for the full design and
[`../docs/decisions.md`](../docs/decisions.md) ADR-010 through ADR-014 for why
each choice here was made. Built with [Acton](https://ton-blockchain.github.io/acton/)
in [Tolk](https://docs.ton.org/tolk/overview).

Status: contract implemented and tested (access control, the funding lifecycle,
settlement, timeout-gated recovery, and the forged-jetton-notification guard -
18 tests, including two fuzz tests on the fee-split arithmetic). **Not yet
deployed anywhere** - deployment needs real decisions first (the actual TON
testnet USDT minter address, its jetton-wallet code, real admin/operator/
feeRecipient addresses), not placeholder values. See "Open questions" in
`docs/ton-pool.md`.

## Commands

```bash
acton build   # compile
acton test    # run the test suite (unit + fuzz)
acton check   # lint
acton fmt     # format (--check to verify without writing)
```

## Layout

```
contracts/RashnuTonPool.tolk   the contract
contracts/types.tolk           storage, messages, errors
contracts/jetton.tolk          minimal jetton-standard (TEP-74) interop -
                                 just enough to safely receive/send USDT
tests/RashnuTonPool.test.tolk  the test suite
wrappers/RashnuTonPool.gen.tolk auto-generated (acton wrapper RashnuTonPool --test) -
                                 do not hand-edit, regenerate instead
```

## A known, documented gap

`onBouncedMessage` doesn't yet do anything beyond accepting the bounce. A
bounced payout (the jetton-wallet rejecting an `AskToTransfer`) currently has
no retry path or on-chain marker for an operator to notice - see the comment
at that function and `docs/ton-pool.md`'s gas/bounce note. Needs real
gas-benchmarking via Acton's tooling before this is production-ready either
way, not just before that specific gap is closed.
