// Rashnu TON pool - storage, messages, errors.
//
// Role split mirrors LotteryPool.sol exactly: adminAddress (treasury - registers
// and funds draws) and operatorAddress (submits results) are separate, so the
// automation that runs the draw lifecycle can hold the operator key without also
// holding treasury authority.
//
// Funding is split into two steps because of how TON jetton transfers actually
// work (see docs/ton-pool.md): RegisterDraw carries the business data (ticket
// count, hash, cutoff) as a plain message; the USDT itself arrives afterward as a
// standard jetton TransferNotificationForRecipient, matched back to the right
// draw via `pendingFundingDrawId` below. There is no single message that
// carries both, the way the EVM `fundDraw` call does.

enum DrawStatus {
    AwaitingFunds = 0
    Funded = 1
    Settled = 2
}

enum Errors {
    NotAdmin = 100
    NotOperator = 101
    DrawAlreadyExists = 102
    DrawNotFound = 103
    DrawNotAwaitingFunds = 104
    DrawNotFunded = 105
    WinningTicketIndexOutOfBounds = 106
    NotOurJettonWallet = 107
    FundingNotFromAdmin = 108
    RecoverTooEarly = 109
    InvalidMessage = 0xFFFF
}

// Settlement is only known from SubmitResult onward - split into its own ref
// (Cell<SettlementRecord>) so the "live" Draw struct a funded-but-unsettled draw
// carries stays small. TON cells cap inline serialization at 1023 bits; three
// addresses/hashes inline here would blow that budget on every draw, settled or
// not.
struct SettlementRecord {
    winnerAddress: address
    winningTxId: uint256
    winningTicketIndex: uint32
}

struct Draw {
    status: DrawStatus
    ticketCount: uint32
    ticketListHash: uint256
    cutoffTimestamp: uint64
    potAmount: coins
    fundedAt: uint64
    settlement: Cell<SettlementRecord>?
}

type DrawsMap = map<uint64, Draw>

// Same reasoning as Draw/SettlementRecord: four-plus address-sized fields would
// overflow a single cell's 1023-bit inline limit, so the less frequently
// checked configuration lives in its own ref, leaving only what's checked on
// nearly every incoming message (adminAddress, operatorAddress) inline.
struct Config {
    feeRecipientAddress: address
    feeBps: uint16
    recoveryTimeoutSecs: uint32
    jettonMinterAddress: address
    jettonWalletCode: cell
}

struct Storage {
    adminAddress: address
    operatorAddress: address
    myJettonWalletAddress: address?
    config: Cell<Config>
    draws: DrawsMap
    // v1 simplification, documented not hidden: at most one draw is ever
    // AwaitingFunds at a time (mirrors the existing EVM platform's own
    // app-level "one active draw" invariant, enforced here at the contract
    // level instead). This is what lets incoming USDT get matched to the
    // right draw without parsing a jetton forward payload's TL/B encoding -
    // if simultaneous TON draws are ever wanted, this needs revisiting to
    // actually decode a drawId from the payload instead.
    pendingFundingDrawId: uint64?
}

fun Storage.load(): Storage {
    return Storage.fromCell(contract.getData());
}

fun Storage.save(self) {
    contract.setData(self.toCell());
}

// Admin-only, plain message (no jettons involved). Registers a draw's
// committed parameters before any money moves - the TON-side equivalent of
// the ordering guarantee `fundDraw` gives on the EVM side: this commitment
// exists on-chain before the funding jetton transfer, and well before the
// Bitcoin block used for randomness can exist.
struct (0x52440001) RegisterDraw {
    drawId: uint64
    ticketCount: uint32
    ticketListHash: uint256
    cutoffTimestamp: uint64
}

// Operator-only, plain message.
struct (0x52440002) SubmitResult {
    drawId: uint64
    winnerAddress: address
    winningTxId: uint256
    winningTicketIndex: uint32
}

// Admin-only, plain message - escape hatch after recoveryTimeoutSecs, mirroring
// LotteryPool.sol's recoverStuckFunds.
struct (0x52440003) RecoverStuckFunds {
    drawId: uint64
}
