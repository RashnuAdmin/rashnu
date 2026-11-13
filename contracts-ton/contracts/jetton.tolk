// Minimal jetton-standard (TEP-74) message shapes and the address-derivation
// needed to safely receive and send USDT. This contract is not a jetton
// implementation itself - it only needs enough of the standard to talk to one.
//
// Opcodes (0x7362d09c, 0x0f8a7ea5) and field layouts match the real,
// widely-deployed jetton standard exactly - verified against the official
// ton-blockchain/acton-contracts reference jetton-v2.1 implementation, not
// invented. Getting these wrong wouldn't fail loudly; it would mean messages
// a real jetton-wallet sends never get understood, or messages we send to it
// never get understood.

type ForwardPayloadRemainder = RemainingBitsAndRefs

// Real jetton-wallet -> us, when someone transfers USDT to our jetton-wallet.
// `transferInitiator` is the actual payer - the TON equivalent of `msg.sender`
// on the EVM side, and exactly what ADR-013/ADR-005's "payment attribution is
// just the sender address" principle is built on here.
struct (0x7362d09c) TransferNotificationForRecipient {
    queryId: uint64
    jettonAmount: coins
    transferInitiator: address?
    forwardPayload: ForwardPayloadRemainder
}

// Us -> our own jetton-wallet, to move USDT we hold out to someone else (payouts,
// fee split, stuck-funds recovery). The jetton-wallet does the actual transfer;
// we never touch another owner's jetton-wallet directly.
struct (0x0f8a7ea5) AskToTransfer {
    queryId: uint64
    jettonAmount: coins
    transferRecipient: address
    sendExcessesTo: address?
    customPayload: cell?
    forwardTonAmount: coins
    forwardPayload: ForwardPayloadRemainder
}

struct WalletStorage {
    jettonBalance: coins
    ownerAddress: address
    minterAddress: address
}

// The forged-notification guard (see docs/ton-pool.md): anyone can send a
// message shaped like TransferNotificationForRecipient directly. This computes
// the address our *own* jetton-wallet deterministically has - from our own
// address as owner, the real minter, and the real jetton-wallet code - so
// `onInternalMessage` can check the sender actually is that address before
// trusting the message's contents at all.
fun calcOurJettonWalletAddress(
    ourAddress: address,
    jettonMinterAddress: address,
    jettonWalletCode: cell,
): address {
    val emptyStorage: WalletStorage = {
        jettonBalance: 0,
        ownerAddress: ourAddress,
        minterAddress: jettonMinterAddress,
    };
    val deployed: AutoDeployAddress = {
        stateInit: { code: jettonWalletCode, data: emptyStorage.toCell() },
    };
    return deployed.calculateAddress();
}
