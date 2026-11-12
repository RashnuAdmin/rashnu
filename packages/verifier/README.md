# rashnu-verifier

Independently verify a [Rashnu](https://github.com/RashnuAdmin/rashnu) draw's
fairness - standalone, dependency-light, and with no reliance on the Rashnu platform
or website. Run it yourself, from any machine, using only public data.

Rashnu's whole premise is that you shouldn't have to trust it: every draw's result is
derived deterministically from (1) the full ticket list, published and hash-committed
before the draw's cutoff, and (2) a Bitcoin block that doesn't exist yet at that
cutoff. This package is the actual implementation of that recomputation - the same
code Rashnu itself runs to produce the "official" result, not a reimplementation that
could quietly drift from it.

## Install

```
npx rashnu-verifier <command> [...flags]
```

No install step needed - `npx` fetches and runs it. Or install it globally/locally
with `npm install -g rashnu-verifier` / `npm install rashnu-verifier`.

## Commands

### `compute-winner` - recompute the Bitcoin-derived winning ticket index

```
rashnu-verifier compute-winner \
  --cutoff <unix-seconds> \
  --rng-n <n> \
  --confirmations <k> \
  --tickets <total-tickets-sold>
```

All four flags come from values a draw publishes before its result can exist (its
cutoff timestamp, its RNG parameters, and its final confirmed ticket count) - see the
draw's own verify page for the exact numbers to pass. Fetches live Bitcoin data from
[mempool.space](https://mempool.space)'s public API (the only network dependency this
package has).

Outputs either:

```json
{ "status": "pending", "reason": "..." }
```

while the qualifying Bitcoin block doesn't have enough confirmations yet, or:

```json
{
  "status": "resolved",
  "qualifyingBlockHeight": 975472,
  "qualifyingBlockHash": "...",
  "qualifyingBlockTimestamp": 1794428965,
  "winningTxId": "...",
  "winningTxIndexInBlock": 3,
  "winningTicketIndex": 0
}
```

`winningTicketIndex` is the index (0-based, into the published ticket list) of the
winning ticket.

### `hash-tickets` - recompute a published ticket list's commitment hash

```
rashnu-verifier hash-tickets --file <path-to-ticket-list.json>
```

`--file` is a JSON array of `{ ticketIndex, buyerWalletAddress, ticketPublicId,
confirmedAt }` objects - the exact shape a draw's `ticket-list.json` endpoint
publishes. Outputs `{ "ticketCount": N, "sha256": "..." }`. Compare this hash against
the one the platform committed on-chain (in its `fundDraw` transaction, before the
qualifying Bitcoin block above could exist) - a match means the published list is
exactly what was committed to, not edited afterward.

## Using it as a library

```ts
import { determineWinningTicket, MempoolSpaceSource, canonicalizeTicketList, hashTicketList } from "rashnu-verifier";

const result = await determineWinningTicket(new MempoolSpaceSource(), {
  cutoffUnixSeconds: 1794427275,
  rngN: 3,
  confirmationsRequired: 6,
  totalTicketsSold: 3,
});
```

`BitcoinBlockSource` is an interface, not a fixed implementation - supply your own if
you'd rather read Bitcoin data from a different source (a local node, a different
explorer) than mempool.space.

## The algorithm, briefly

1. Find `H`, the first Bitcoin block mined after the cutoff timestamp (by block
   height, not by whichever block a watcher happened to see live).
2. Wait for `H` to reach the required confirmations.
3. If `H` has fewer than `N` transactions (including the coinbase as position 1),
   advance to `H+1` and repeat.
4. Take the `N`th transaction in `H` (1-indexed, coinbase = position 1).
5. `winning_index = txid (as a big integer) mod total_tickets_sold`.

Full spec, rationale, and the fixed-column canonical CSV format `hash-tickets` hashes:
[`architecture.md`](https://github.com/RashnuAdmin/rashnu/blob/main/docs/architecture.md#rng-algorithm---the-locked-precise-spec).

## Found a discrepancy?

That's the point of this package existing - [open an
issue](https://github.com/RashnuAdmin/rashnu/issues/new) with your own
recomputed result and where it diverges from the platform's.
