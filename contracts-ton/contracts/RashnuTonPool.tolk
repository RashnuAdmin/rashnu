import "jetton"
import "types"

// TON-native escrow/payout for Rashnu's parallel TON pool. See
// docs/ton-pool.md for the full design and docs/decisions.md ADR-010 through
// ADR-014 for why each choice here was made. Conceptually mirrors
// LotteryPool.sol's lifecycle (fundDraw -> await Bitcoin block -> submitResult
// -> payout), but is not a line-by-line port - TON's async message-passing
// model needs its own validation/gas design, not a translation.
contract RashnuTonPool {
    author: "Rashnu"
    version: "0.1.0"
    description: "TON-native escrow/payout for Rashnu's parallel TON pool"
    storage: Storage
    incomingMessages: AllowedMessage
}

type AllowedMessage =
    | RegisterDraw
    | SubmitResult
    | RecoverStuckFunds
    | TransferNotificationForRecipient

// Gas forwarded alongside each outbound jetton transfer, covering our own
// jetton-wallet's execution plus notifying the final recipient. A placeholder,
// not a verified figure - needs real gas-benchmarking via Acton's tooling
// before this is production-ready (see docs/ton-pool.md's gas/bounce note).
const JETTON_TRANSFER_GAS: coins = grams("0.05")

fun onInternalMessage(in: InMessage) {
    val msg = lazy AllowedMessage.fromSlice(in.body);

    match (msg) {
        RegisterDraw => {
            var storage = lazy Storage.load();
            assert (in.senderAddress == storage.adminAddress) throw Errors.NotAdmin;

            val existing = storage.draws.get(msg.drawId);
            assert (!existing.isFound) throw Errors.DrawAlreadyExists;

            storage
                .draws
                .set(
                    msg.drawId,
                    {
                        status: DrawStatus.AwaitingFunds,
                        ticketCount: msg.ticketCount,
                        ticketListHash: msg.ticketListHash,
                        cutoffTimestamp: msg.cutoffTimestamp,
                        potAmount: 0,
                        fundedAt: 0,
                        settlement: null,
                    },
                );
            storage.pendingFundingDrawId = msg.drawId;
            storage.save();
        }

        TransferNotificationForRecipient => {
            var storage = lazy Storage.load();
            val config = storage.config.load();

            if (storage.myJettonWalletAddress == null) {
                storage.myJettonWalletAddress = calcOurJettonWalletAddress(
                    contract.getAddress(),
                    config.jettonMinterAddress,
                    config.jettonWalletCode,
                );
            }
            assert (
                in.senderAddress == storage.myJettonWalletAddress
            ) throw Errors.NotOurJettonWallet;
            assert (
                msg.transferInitiator != null && msg.transferInitiator == storage.adminAddress
            ) throw Errors.FundingNotFromAdmin;

            val drawId = storage.pendingFundingDrawId;
            assert (drawId != null) throw Errors.DrawNotFound;

            val found = storage.draws.get(drawId);
            assert (found.isFound) throw Errors.DrawNotFound;
            var draw = found.loadValue();
            assert (draw.status == DrawStatus.AwaitingFunds) throw Errors.DrawNotAwaitingFunds;

            draw.potAmount = msg.jettonAmount;
            draw.fundedAt = blockchain.now();
            draw.status = DrawStatus.Funded;
            storage.draws.set(drawId, draw);
            storage.pendingFundingDrawId = null;
            storage.save();
        }

        SubmitResult => {
            var storage = lazy Storage.load();
            assert (in.senderAddress == storage.operatorAddress) throw Errors.NotOperator;

            val found = storage.draws.get(msg.drawId);
            assert (found.isFound) throw Errors.DrawNotFound;
            var draw = found.loadValue();
            assert (draw.status == DrawStatus.Funded) throw Errors.DrawNotFunded;
            assert (
                msg.winningTicketIndex < draw.ticketCount
            ) throw Errors.WinningTicketIndexOutOfBounds;

            val config = storage.config.load();
            val (payoutAmount, feeAmount) = computeFeeSplit(draw.potAmount, config.feeBps);

            val myJettonWallet = storage.myJettonWalletAddress!;
            sendJettonsFromUs(myJettonWallet, msg.winnerAddress, payoutAmount);
            sendJettonsFromUs(myJettonWallet, config.feeRecipientAddress, feeAmount);

            val settlement: SettlementRecord = {
                winnerAddress: msg.winnerAddress,
                winningTxId: msg.winningTxId,
                winningTicketIndex: msg.winningTicketIndex,
            };
            draw.status = DrawStatus.Settled;
            draw.settlement = settlement.toCell();
            storage.draws.set(msg.drawId, draw);
            storage.save();
        }

        RecoverStuckFunds => {
            var storage = lazy Storage.load();
            assert (in.senderAddress == storage.adminAddress) throw Errors.NotAdmin;

            val found = storage.draws.get(msg.drawId);
            assert (found.isFound) throw Errors.DrawNotFound;
            var draw = found.loadValue();
            assert (draw.status == DrawStatus.Funded) throw Errors.DrawNotFunded;

            val config = storage.config.load();
            assert (
                blockchain.now() >= draw.fundedAt + config.recoveryTimeoutSecs
            ) throw Errors.RecoverTooEarly;

            sendJettonsFromUs(storage.myJettonWalletAddress!, storage.adminAddress, draw.potAmount);

            draw.status = DrawStatus.Settled;
            storage.draws.set(msg.drawId, draw);
            storage.save();
        }

        else => {
            assert (in.body.isEmpty()) throw Errors.InvalidMessage;
        }
    }
}

// Separated out so it's directly fuzz-testable without a full contract
// deployment/message round trip per run - mirrors how LotteryPool.sol's
// identical split was fuzz-tested on the EVM side (payout + fee == pot,
// exactly, for any input).
fun computeFeeSplit(potAmount: coins, feeBps: uint16): (coins, coins) {
    val feeAmount = potAmount * feeBps / 10000;
    val payoutAmount = potAmount - feeAmount;
    return (payoutAmount, feeAmount);
}

fun sendJettonsFromUs(myJettonWallet: address, to: address, amount: coins) {
    val transfer: AskToTransfer = {
        queryId: 0,
        jettonAmount: amount,
        transferRecipient: to,
        sendExcessesTo: null,
        customPayload: null,
        forwardTonAmount: 1,
        forwardPayload: createEmptyCell().beginParse(),
    };
    val outMsg = createMessage({
        bounce: BounceMode.Only256BitsOfBody,
        value: JETTON_TRANSFER_GAS,
        dest: myJettonWallet,
        body: transfer,
    });
    outMsg.send(SEND_MODE_REGULAR);
}

fun onBouncedMessage(_in: InMessageBounced) {
    // A bounced AskToTransfer means our jetton-wallet rejected the payout -
    // this needs real handling (retry path, or at minimum a durable on-chain
    // marker so an operator notices) before this is production-ready. Left as
    // an explicit gap, not silently swallowed - see docs/ton-pool.md's
    // gas/bounce note for why this matters.
}

get fun getDraw(drawId: uint64): Draw? {
    val storage = lazy Storage.load();
    val found = storage.draws.get(drawId);
    if (!found.isFound) {
        return null;
    }
    return found.loadValue();
}

get fun getSettlement(drawId: uint64): SettlementRecord? {
    val draw = getDraw(drawId);
    if (draw == null || draw.settlement == null) {
        return null;
    }
    return draw.settlement.load();
}

get fun adminAddress(): address {
    val storage = lazy Storage.load();
    return storage.adminAddress;
}

get fun operatorAddress(): address {
    val storage = lazy Storage.load();
    return storage.operatorAddress;
}
