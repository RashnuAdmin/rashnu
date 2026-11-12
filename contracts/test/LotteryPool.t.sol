// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LotteryPool} from "../src/LotteryPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {ReentrantERC20} from "./mocks/ReentrantERC20.sol";

contract LotteryPoolTest is Test {
    LotteryPool pool;
    MockERC20 usdc;

    address admin = makeAddr("admin");
    address operator = makeAddr("operator");
    address feeRecipient = makeAddr("feeRecipient");
    address treasury = makeAddr("treasury"); // funds draws; admin and treasury are the same role here
    address winner = makeAddr("winner");

    uint16 constant FEE_BPS = 1500; // 15%
    uint256 constant RECOVERY_TIMEOUT = 7 days;
    uint256 constant TICKET_PRICE = 5_000_000; // 5 USDC, 6 decimals
    uint256 constant TICKET_COUNT = 100;
    uint256 constant POT = TICKET_PRICE * TICKET_COUNT; // 500 USDC
    bytes32 constant TICKET_LIST_HASH = keccak256("ticket list");
    bytes32 constant WINNING_TX_ID = keccak256("winning tx");

    function setUp() public {
        usdc = new MockERC20();
        pool = new LotteryPool(address(usdc), admin, operator, feeRecipient, FEE_BPS, RECOVERY_TIMEOUT);

        usdc.mint(admin, 1_000_000_000_000);
        vm.prank(admin);
        usdc.approve(address(pool), type(uint256).max);
    }

    function fundDraw1() internal {
        vm.prank(admin);
        pool.fundDraw(1, POT, TICKET_COUNT, TICKET_LIST_HASH, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    function test_constructor_revertsOnZeroUsdc() public {
        vm.expectRevert(bytes("usdc=0"));
        new LotteryPool(address(0), admin, operator, feeRecipient, FEE_BPS, RECOVERY_TIMEOUT);
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(bytes("admin=0"));
        new LotteryPool(address(usdc), address(0), operator, feeRecipient, FEE_BPS, RECOVERY_TIMEOUT);
    }

    function test_constructor_revertsOnZeroOperator() public {
        vm.expectRevert(bytes("operator=0"));
        new LotteryPool(address(usdc), admin, address(0), feeRecipient, FEE_BPS, RECOVERY_TIMEOUT);
    }

    function test_constructor_revertsOnZeroFeeRecipient() public {
        vm.expectRevert(bytes("feeRecipient=0"));
        new LotteryPool(address(usdc), admin, operator, address(0), FEE_BPS, RECOVERY_TIMEOUT);
    }

    function test_constructor_revertsOnFeeBpsOver100Percent() public {
        vm.expectRevert(bytes("feeBps>100%"));
        new LotteryPool(address(usdc), admin, operator, feeRecipient, 10_001, RECOVERY_TIMEOUT);
    }

    // ---------------------------------------------------------------------
    // fundDraw
    // ---------------------------------------------------------------------

    function test_fundDraw_pullsFundsAndRecordsDraw() public {
        uint256 adminBalanceBefore = usdc.balanceOf(admin);

        vm.expectEmit(true, false, false, false);
        emit LotteryPool.DrawFunded(1, POT, TICKET_COUNT, TICKET_LIST_HASH, uint64(block.timestamp));
        fundDraw1();

        assertEq(usdc.balanceOf(address(pool)), POT);
        assertEq(usdc.balanceOf(admin), adminBalanceBefore - POT);

        LotteryPool.Draw memory draw = pool.getDraw(1);
        assertEq(draw.potAmount, POT);
        assertEq(draw.ticketCount, TICKET_COUNT);
        assertEq(draw.ticketListHash, TICKET_LIST_HASH);
        assertEq(uint8(draw.status), uint8(LotteryPool.DrawStatus.Funded));
    }

    function test_fundDraw_revertsForNonAdmin() public {
        vm.prank(winner);
        vm.expectRevert();
        pool.fundDraw(1, POT, TICKET_COUNT, TICKET_LIST_HASH, uint64(block.timestamp));
    }

    function test_fundDraw_revertsIfDrawAlreadyExists() public {
        fundDraw1();
        vm.prank(admin);
        vm.expectRevert(bytes("draw already exists"));
        pool.fundDraw(1, POT, TICKET_COUNT, TICKET_LIST_HASH, uint64(block.timestamp));
    }

    function test_fundDraw_revertsOnZeroAmount() public {
        vm.prank(admin);
        vm.expectRevert(bytes("amount=0"));
        pool.fundDraw(1, 0, TICKET_COUNT, TICKET_LIST_HASH, uint64(block.timestamp));
    }

    function test_fundDraw_revertsOnZeroTicketCount() public {
        vm.prank(admin);
        vm.expectRevert(bytes("ticketCount=0"));
        pool.fundDraw(1, POT, 0, TICKET_LIST_HASH, uint64(block.timestamp));
    }

    function test_fundDraw_revertsWhenPaused() public {
        vm.prank(admin);
        pool.pause();

        vm.prank(admin);
        vm.expectRevert();
        pool.fundDraw(1, POT, TICKET_COUNT, TICKET_LIST_HASH, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // submitResult
    // ---------------------------------------------------------------------

    function test_submitResult_paysWinnerAndFeeRecipientExactly() public {
        fundDraw1();

        uint256 expectedFee = (POT * FEE_BPS) / 10_000;
        uint256 expectedPayout = POT - expectedFee;

        vm.prank(operator);
        pool.submitResult(1, winner, WINNING_TX_ID, 42);

        assertEq(usdc.balanceOf(winner), expectedPayout);
        assertEq(usdc.balanceOf(feeRecipient), expectedFee);
        assertEq(usdc.balanceOf(address(pool)), 0);
        assertEq(expectedPayout + expectedFee, POT);

        LotteryPool.Draw memory draw = pool.getDraw(1);
        assertEq(uint8(draw.status), uint8(LotteryPool.DrawStatus.Settled));
        assertEq(draw.winner, winner);
        assertEq(draw.winningTicketIndex, 42);
    }

    function test_submitResult_revertsForNonOperator() public {
        fundDraw1();
        vm.prank(admin); // admin is not operator
        vm.expectRevert();
        pool.submitResult(1, winner, WINNING_TX_ID, 42);
    }

    function test_submitResult_revertsIfDrawNotFunded() public {
        vm.prank(operator);
        vm.expectRevert(bytes("draw not funded"));
        pool.submitResult(1, winner, WINNING_TX_ID, 42);
    }

    function test_submitResult_revertsOnDoubleSettle() public {
        fundDraw1();
        vm.prank(operator);
        pool.submitResult(1, winner, WINNING_TX_ID, 42);

        vm.prank(operator);
        vm.expectRevert(bytes("draw not funded"));
        pool.submitResult(1, winner, WINNING_TX_ID, 42);
    }

    function test_submitResult_revertsOnZeroWinner() public {
        fundDraw1();
        vm.prank(operator);
        vm.expectRevert(bytes("winner=0"));
        pool.submitResult(1, address(0), WINNING_TX_ID, 42);
    }

    /// @dev Regression for a real finding from the invariant fuzzer: a winner equal
    /// to the pool's own address makes the payout self-transfer and get stuck while
    /// the draw still records as cleanly Settled.
    function test_submitResult_revertsOnWinnerEqualToPool() public {
        fundDraw1();
        vm.prank(operator);
        vm.expectRevert(bytes("winner=pool"));
        pool.submitResult(1, address(pool), WINNING_TX_ID, 42);
    }

    function test_submitResult_revertsOnWinnerEqualToToken() public {
        fundDraw1();
        vm.prank(operator);
        vm.expectRevert(bytes("winner=token"));
        pool.submitResult(1, address(usdc), WINNING_TX_ID, 42);
    }

    function test_submitResult_revertsOnOutOfBoundsTicketIndex() public {
        fundDraw1();
        vm.prank(operator);
        vm.expectRevert(bytes("ticket index out of bounds"));
        pool.submitResult(1, winner, WINNING_TX_ID, uint32(TICKET_COUNT)); // == count, so OOB
    }

    function test_submitResult_revertsWhenPaused() public {
        fundDraw1();
        vm.prank(admin);
        pool.pause();

        vm.prank(operator);
        vm.expectRevert();
        pool.submitResult(1, winner, WINNING_TX_ID, 42);
    }

    function testFuzz_submitResult_feeSplitNeverLeaksOrOverflows(uint256 pot, uint16 feeBps) public {
        pot = bound(pot, 1, 1_000_000_000_000); // up to 1,000,000 USDC
        feeBps = uint16(bound(feeBps, 0, 10_000));

        MockERC20 freshUsdc = new MockERC20();
        LotteryPool freshPool =
            new LotteryPool(address(freshUsdc), admin, operator, feeRecipient, feeBps, RECOVERY_TIMEOUT);
        freshUsdc.mint(admin, pot);
        vm.prank(admin);
        freshUsdc.approve(address(freshPool), pot);

        vm.prank(admin);
        freshPool.fundDraw(1, pot, 1, TICKET_LIST_HASH, uint64(block.timestamp));

        vm.prank(operator);
        freshPool.submitResult(1, winner, WINNING_TX_ID, 0);

        uint256 payout = freshUsdc.balanceOf(winner);
        uint256 fee = freshUsdc.balanceOf(feeRecipient);

        assertEq(payout + fee, pot, "payout + fee must equal pot exactly");
        assertEq(fee, (pot * feeBps) / 10_000, "fee must match the formula exactly");
        assertEq(freshUsdc.balanceOf(address(freshPool)), 0, "nothing should be left in the pool");
    }

    /// @dev Two layers make this harder to test honestly than it looks:
    /// (1) Checks-effects-interactions alone already blocks a reentrant call back
    ///     into the *same* draw (its status flips to Settled before any transfer
    ///     runs) - so the attack must target a *different*, still-Funded draw to
    ///     say anything about nonReentrant specifically.
    /// (2) submitResult is onlyRole(OPERATOR_ROLE), and a reentrant call's
    ///     msg.sender is the malicious token, not the operator - so by default the
    ///     access-control check blocks it regardless of nonReentrant, proving
    ///     nothing about the guard. This test grants the token OPERATOR_ROLE to
    ///     factor that out, isolating what nonReentrant alone contributes as
    ///     defense-in-depth - verified by temporarily removing it from
    ///     submitResult and confirming this test then fails (it does; restored
    ///     immediately after confirming).
    function test_submitResult_blocksReentrancyIntoADifferentDraw() public {
        ReentrantERC20 badToken = new ReentrantERC20();
        LotteryPool badPool = new LotteryPool(address(badToken), admin, operator, feeRecipient, FEE_BPS, RECOVERY_TIMEOUT);

        bytes32 operatorRole = badPool.OPERATOR_ROLE();
        vm.prank(admin);
        badPool.grantRole(operatorRole, address(badToken));

        badToken.mint(admin, POT * 2);
        vm.prank(admin);
        badToken.approve(address(badPool), POT * 2);
        vm.prank(admin);
        badPool.fundDraw(1, POT, TICKET_COUNT, TICKET_LIST_HASH, uint64(block.timestamp));
        vm.prank(admin);
        badPool.fundDraw(2, POT, TICKET_COUNT, TICKET_LIST_HASH, uint64(block.timestamp));

        // Settling draw 1 triggers badToken.transfer(winner, ...), whose hook attacks
        // draw 2 - still Funded, and untouched by draw 1's state changes - calling
        // back in as the token itself, which now holds OPERATOR_ROLE too.
        badToken.armAttack(badPool, 2, winner, WINNING_TX_ID, 42);

        vm.prank(operator);
        vm.expectRevert();
        badPool.submitResult(1, winner, WINNING_TX_ID, 42);
    }

    // ---------------------------------------------------------------------
    // recoverStuckFunds
    // ---------------------------------------------------------------------

    function test_recoverStuckFunds_returnsPotAfterTimeout() public {
        fundDraw1();
        skip(RECOVERY_TIMEOUT);

        vm.prank(admin);
        pool.recoverStuckFunds(1);

        assertEq(usdc.balanceOf(admin), 1_000_000_000_000 - POT + POT); // round-tripped back
        LotteryPool.Draw memory draw = pool.getDraw(1);
        assertEq(uint8(draw.status), uint8(LotteryPool.DrawStatus.Recovered));
    }

    function test_recoverStuckFunds_revertsBeforeTimeout() public {
        fundDraw1();
        vm.prank(admin);
        vm.expectRevert(bytes("recovery timeout not elapsed"));
        pool.recoverStuckFunds(1);
    }

    function test_recoverStuckFunds_revertsForNonAdmin() public {
        fundDraw1();
        skip(RECOVERY_TIMEOUT);
        vm.prank(winner);
        vm.expectRevert();
        pool.recoverStuckFunds(1);
    }

    function test_recoverStuckFunds_revertsIfAlreadySettled() public {
        fundDraw1();
        vm.prank(operator);
        pool.submitResult(1, winner, WINNING_TX_ID, 42);

        skip(RECOVERY_TIMEOUT);
        vm.prank(admin);
        vm.expectRevert(bytes("draw not funded"));
        pool.recoverStuckFunds(1);
    }

    function test_recoverStuckFunds_worksEvenWhenPaused() public {
        fundDraw1();
        skip(RECOVERY_TIMEOUT);

        vm.prank(admin);
        pool.pause();

        vm.prank(admin);
        pool.recoverStuckFunds(1); // must not revert - the safety valve works during an emergency pause

        assertEq(uint8(pool.getDraw(1).status), uint8(LotteryPool.DrawStatus.Recovered));
    }

    // ---------------------------------------------------------------------
    // Admin setters / pause
    // ---------------------------------------------------------------------

    function test_setFeeBps_revertsOver100Percent() public {
        vm.prank(admin);
        vm.expectRevert(bytes("feeBps>100%"));
        pool.setFeeBps(10_001);
    }

    function test_setFeeBps_updatesAndAffectsNextSettlement() public {
        vm.prank(admin);
        pool.setFeeBps(5000); // 50%
        assertEq(pool.feeBps(), 5000);

        fundDraw1();
        vm.prank(operator);
        pool.submitResult(1, winner, WINNING_TX_ID, 42);
        assertEq(usdc.balanceOf(winner), POT / 2);
        assertEq(usdc.balanceOf(feeRecipient), POT / 2);
    }

    function test_setFeeRecipient_revertsForNonAdmin() public {
        vm.prank(winner);
        vm.expectRevert();
        pool.setFeeRecipient(winner);
    }

    function test_setFeeRecipient_revertsOnZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(bytes("feeRecipient=0"));
        pool.setFeeRecipient(address(0));
    }

    function test_setFeeRecipient_updatesAndAffectsNextSettlement() public {
        address newRecipient = makeAddr("newFeeRecipient");
        vm.prank(admin);
        pool.setFeeRecipient(newRecipient);
        assertEq(pool.feeRecipient(), newRecipient);

        fundDraw1();
        vm.prank(operator);
        pool.submitResult(1, winner, WINNING_TX_ID, 42);
        assertGt(usdc.balanceOf(newRecipient), 0);
        assertEq(usdc.balanceOf(feeRecipient), 0);
    }

    function test_setRecoveryTimeout_updatesAndAffectsRecoverability() public {
        vm.prank(admin);
        pool.setRecoveryTimeout(1 days);
        assertEq(pool.recoveryTimeout(), 1 days);

        fundDraw1();
        skip(1 days);
        vm.prank(admin);
        pool.recoverStuckFunds(1); // would have reverted under the old 7-day timeout
        assertEq(uint8(pool.getDraw(1).status), uint8(LotteryPool.DrawStatus.Recovered));
    }

    function test_setRecoveryTimeout_revertsForNonAdmin() public {
        vm.prank(winner);
        vm.expectRevert();
        pool.setRecoveryTimeout(1 days);
    }

    function test_pause_onlyAdmin() public {
        vm.prank(winner);
        vm.expectRevert();
        pool.pause();
    }

    function test_unpause_restoresOperation() public {
        vm.prank(admin);
        pool.pause();
        vm.prank(admin);
        pool.unpause();

        fundDraw1(); // must succeed again
        assertEq(uint8(pool.getDraw(1).status), uint8(LotteryPool.DrawStatus.Funded));
    }
}
