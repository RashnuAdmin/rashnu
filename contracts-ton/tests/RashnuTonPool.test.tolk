import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/testing/fuzz"
import "@contracts/RashnuTonPool"
import "@contracts/jetton"
import "@contracts/types"
import "@wrappers/RashnuTonPool.gen"

const DRAW_ID: uint64 = 1
const TICKET_COUNT: uint32 = 3
const TICKET_LIST_HASH: uint256 = 0x1234
const CUTOFF: uint64 = 1_800_000_000
const FEE_BPS: uint16 = 1500 // 15%, matching LotteryPool.sol's default
const RECOVERY_TIMEOUT_SECS: uint32 = 7 * 24 * 60 * 60

// -- Access control and draw registration --

get fun `test deploy exposes admin and operator`() {
    val (contract, roles) = setupTest();
    expect(contract.adminAddress()).toEqual(roles.admin.address);
    expect(contract.operatorAddress()).toEqual(roles.operatorAcct.address);
}

get fun `test register draw by admin succeeds`() {
    val (contract, roles) = setupTest();

    val res = contract.sendRegisterDraw(
        roles.admin.address,
        DRAW_ID,
        TICKET_COUNT,
        TICKET_LIST_HASH,
        CUTOFF,
    );
    expect(res).toHaveSuccessfulTx<RegisterDraw>({ from: roles
            .admin
            .address, to: contract.address });

    val draw = contract.getDraw(DRAW_ID)!;
    expect(draw.status).toEqual(DrawStatus.AwaitingFunds);
    expect(draw.ticketCount).toEqual(TICKET_COUNT);
    expect(draw.ticketListHash).toEqual(TICKET_LIST_HASH);
}

get fun `test register draw by non-admin fails`() {
    val (contract, roles) = setupTest();

    val res = contract.sendRegisterDraw(
        roles.attacker.address,
        DRAW_ID,
        TICKET_COUNT,
        TICKET_LIST_HASH,
        CUTOFF,
    );
    expect(res).toHaveFailedTx({ from: roles
            .attacker
            .address, to: contract.address, exitCode: Errors.NotAdmin });
    expect(contract.getDraw(DRAW_ID)).toEqual(null);
}

get fun `test register draw twice for same drawId fails`() {
    val (contract, roles) = setupTest();

    contract.sendRegisterDraw(roles.admin.address, DRAW_ID, TICKET_COUNT, TICKET_LIST_HASH, CUTOFF);
    val res = contract.sendRegisterDraw(
        roles.admin.address,
        DRAW_ID,
        TICKET_COUNT,
        TICKET_LIST_HASH,
        CUTOFF,
    );
    expect(res).toHaveFailedTx({ from: roles
            .admin
            .address, to: contract.address, exitCode: Errors.DrawAlreadyExists });
}

// -- Funding (the forged-notification guard is the whole point of these) --

get fun `test funding notification from wrong sender is rejected`() {
    val (contract, roles) = setupTest();
    contract.sendRegisterDraw(roles.admin.address, DRAW_ID, TICKET_COUNT, TICKET_LIST_HASH, CUTOFF);

    // Anyone can craft a message shaped exactly like a real jetton-wallet's
    // TransferNotificationForRecipient - this is exactly the attack the
    // sender-address check in onInternalMessage exists to stop.
    val res = contract.sendTransferNotificationForRecipient(
        roles.attacker.address,
        0,
        grams("10"),
        roles.admin.address,
        createEmptyCell().beginParse(),
    );
    expect(res).toHaveFailedTx({ from: roles
            .attacker
            .address, to: contract.address, exitCode: Errors.NotOurJettonWallet });
}

get fun `test funding notification with wrong transferInitiator is rejected`() {
    val (contract, roles) = setupTest();
    contract.sendRegisterDraw(roles.admin.address, DRAW_ID, TICKET_COUNT, TICKET_LIST_HASH, CUTOFF);

    val jettonWallet = ourJettonWalletAddress(contract, roles);
    val res = contract.sendTransferNotificationForRecipient(
        jettonWallet,
        0,
        grams("10"),
        roles.attacker.address,
        createEmptyCell().beginParse(),
    );
    expect(
        res,
    ).toHaveFailedTx({ from: jettonWallet, to: contract.address, exitCode: Errors.FundingNotFromAdmin });
}

get fun `test funding transitions AwaitingFunds to Funded`() {
    val (contract, roles) = setupTest();
    contract.sendRegisterDraw(roles.admin.address, DRAW_ID, TICKET_COUNT, TICKET_LIST_HASH, CUTOFF);

    val jettonWallet = ourJettonWalletAddress(contract, roles);
    val res = contract.sendTransferNotificationForRecipient(
        jettonWallet,
        0,
        grams("300"),
        roles.admin.address,
        createEmptyCell().beginParse(),
    );
    expect(
        res,
    ).toHaveSuccessfulTx<TransferNotificationForRecipient>({ from: jettonWallet, to: contract.address });

    val draw = contract.getDraw(DRAW_ID)!;
    expect(draw.status).toEqual(DrawStatus.Funded);
    expect(draw.potAmount).toEqual(grams("300"));
}

get fun `test funding with no draw registered fails`() {
    val (contract, roles) = setupTest();

    val jettonWallet = ourJettonWalletAddress(contract, roles);
    val res = contract.sendTransferNotificationForRecipient(
        jettonWallet,
        0,
        grams("300"),
        roles.admin.address,
        createEmptyCell().beginParse(),
    );
    expect(
        res,
    ).toHaveFailedTx({ from: jettonWallet, to: contract.address, exitCode: Errors.DrawNotFound });
}

// -- Settlement --

get fun `test submit result by non-operator fails`() {
    val (contract, roles) = setupFundedDraw();

    val res = contract.sendSubmitResult(
        roles.attacker.address,
        DRAW_ID,
        roles.attacker.address,
        0xABCD,
        0,
    );
    expect(res).toHaveFailedTx({ from: roles
            .attacker
            .address, to: contract.address, exitCode: Errors.NotOperator });
}

get fun `test submit result on a draw that was never funded fails`() {
    val (contract, roles) = setupTest();
    contract.sendRegisterDraw(roles.admin.address, DRAW_ID, TICKET_COUNT, TICKET_LIST_HASH, CUTOFF);

    val res = contract.sendSubmitResult(
        roles.operatorAcct.address,
        DRAW_ID,
        roles.attacker.address,
        0xABCD,
        0,
    );
    expect(res).toHaveFailedTx({ from: roles
            .operatorAcct
            .address, to: contract.address, exitCode: Errors.DrawNotFunded });
}

get fun `test submit result rejects an out-of-bounds winning ticket index`() {
    val (contract, roles) = setupFundedDraw();

    val res = contract.sendSubmitResult(
        roles.operatorAcct.address,
        DRAW_ID,
        roles.attacker.address,
        0xABCD,
        TICKET_COUNT,
    );
    expect(res).toHaveFailedTx({ from: roles
            .operatorAcct
            .address, to: contract.address, exitCode: Errors.WinningTicketIndexOutOfBounds });
}

get fun `test submit result settles the draw and records the settlement`() {
    val (contract, roles) = setupFundedDraw();
    val winner = testing.treasury("winner");

    val res = contract.sendSubmitResult(
        roles.operatorAcct.address,
        DRAW_ID,
        winner.address,
        0xABCD,
        1,
    );
    expect(res).toHaveSuccessfulTx<SubmitResult>({ from: roles
            .operatorAcct
            .address, to: contract.address });

    val draw = contract.getDraw(DRAW_ID)!;
    expect(draw.status).toEqual(DrawStatus.Settled);

    val settlement = contract.getSettlement(DRAW_ID)!;
    expect(settlement.winnerAddress).toEqual(winner.address);
    expect(settlement.winningTxId).toEqual(0xABCD);
    expect(settlement.winningTicketIndex).toEqual(1);
}

get fun `test submit result cannot be called twice on the same draw`() {
    val (contract, roles) = setupFundedDraw();
    val winner = testing.treasury("winner");

    contract.sendSubmitResult(roles.operatorAcct.address, DRAW_ID, winner.address, 0xABCD, 1);
    val res2 = contract.sendSubmitResult(
        roles.operatorAcct.address,
        DRAW_ID,
        winner.address,
        0xABCD,
        1,
    );
    expect(res2).toHaveFailedTx({ from: roles
            .operatorAcct
            .address, to: contract.address, exitCode: Errors.DrawNotFunded });
}

// -- Recovery --

get fun `test recover stuck funds before the timeout fails`() {
    val (contract, roles) = setupFundedDraw();

    val res = contract.sendRecoverStuckFunds(roles.admin.address, DRAW_ID);
    expect(res).toHaveFailedTx({ from: roles
            .admin
            .address, to: contract.address, exitCode: Errors.RecoverTooEarly });
}

get fun `test recover stuck funds by non-admin fails`() {
    val (contract, roles) = setupFundedDraw();

    val res = contract.sendRecoverStuckFunds(roles.attacker.address, DRAW_ID);
    expect(res).toHaveFailedTx({ from: roles
            .attacker
            .address, to: contract.address, exitCode: Errors.NotAdmin });
}

get fun `test recover stuck funds after the timeout settles the draw`() {
    val (contract, roles) = setupFundedDraw();

    testing.setNow(testing.getNow() + RECOVERY_TIMEOUT_SECS + 1);
    val res = contract.sendRecoverStuckFunds(roles.admin.address, DRAW_ID);
    expect(res).toHaveSuccessfulTx<RecoverStuckFunds>({ from: roles
            .admin
            .address, to: contract.address });

    val draw = contract.getDraw(DRAW_ID)!;
    expect(draw.status).toEqual(DrawStatus.Settled);
}

// -- Fee-split arithmetic: payout + fee == pot, exactly, for any input --
// Mirrors the equivalent fuzz test on LotteryPool.sol's identical split.

@test.fuzz
get fun `test fee split always accounts for the full pot`(potAmount: int, feeBpsRaw: int) {
    val pot = fuzz.bound(potAmount, 0, 1_000_000_000_000) as coins;
    val feeBps = fuzz.bound(feeBpsRaw, 0, 10000) as uint16;

    val (payout, fee) = computeFeeSplit(pot, feeBps);
    expect(payout + fee).toEqual(pot);
}

@test.fuzz
get fun `test fee split never pays the winner more than the pot`(potAmount: int, feeBpsRaw: int) {
    val pot = fuzz.bound(potAmount, 0, 1_000_000_000_000) as coins;
    val feeBps = fuzz.bound(feeBpsRaw, 0, 10000) as uint16;

    val (payout, _fee) = computeFeeSplit(pot, feeBps);
    expect(payout <= pot).toBeTrue();
}

// -- Test setup helpers --

struct Roles {
    admin: Treasury
    operatorAcct: Treasury
    feeRecipient: Treasury
    attacker: Treasury
}

fun setupTest(): (RashnuTonPool, Roles) {
    val roles: Roles = {
        admin: testing.treasury("admin"),
        operatorAcct: testing.treasury("operator"),
        feeRecipient: testing.treasury("feeRecipient"),
        attacker: testing.treasury("attacker"),
    };

    val contract = RashnuTonPool.fromStorage({
        adminAddress: roles.admin.address,
        operatorAddress: roles.operatorAcct.address,
        myJettonWalletAddress: null,
        config: ({
            feeRecipientAddress: roles.feeRecipient.address,
            feeBps: FEE_BPS,
            recoveryTimeoutSecs: RECOVERY_TIMEOUT_SECS,
            jettonMinterAddress: testing.treasury("jettonMinter").address,
            jettonWalletCode: createEmptyCell(),
        } as Config).toCell(),
        draws: ([] as DrawsMap),
        pendingFundingDrawId: null,
    });
    val res = contract.deploy(roles.admin.address, { value: grams("1") });
    expect(res).toHaveSuccessfulDeploy({ to: contract.address });

    return (contract, roles);
}

// Computes the same address onInternalMessage derives for an incoming
// TransferNotificationForRecipient, from the same (owner, minter, code)
// inputs the test's own deployed storage used - so tests can simulate a
// message genuinely "from our own jetton-wallet" without deploying one.
fun ourJettonWalletAddress(contract: RashnuTonPool, _roles: Roles): address {
    return calcOurJettonWalletAddress(
        contract.address,
        testing.treasury("jettonMinter").address,
        createEmptyCell(),
    );
}

fun setupFundedDraw(): (RashnuTonPool, Roles) {
    val (contract, roles) = setupTest();
    contract.sendRegisterDraw(roles.admin.address, DRAW_ID, TICKET_COUNT, TICKET_LIST_HASH, CUTOFF);

    val jettonWallet = ourJettonWalletAddress(contract, roles);
    contract.sendTransferNotificationForRecipient(
        jettonWallet,
        0,
        grams("300"),
        roles.admin.address,
        createEmptyCell().beginParse(),
    );

    return (contract, roles);
}
