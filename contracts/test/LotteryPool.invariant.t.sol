// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LotteryPool} from "../src/LotteryPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {LotteryPoolHandler} from "./handlers/LotteryPoolHandler.sol";

/// @notice The contract's USDC balance must always exactly equal the sum of all
/// currently-Funded draws' pots, across any sequence of fundDraw/submitResult/
/// recoverStuckFunds calls - fundDraw adds exactly `amount`, and settlement/recovery
/// each remove exactly one draw's full pot, so no dust should ever accumulate or
/// leak. This is the invariant that would catch a rounding bug or an accounting
/// mistake that unit tests, which each only exercise one or two calls, could miss
/// across a long, randomized sequence.
contract LotteryPoolInvariantTest is Test {
    LotteryPool pool;
    MockERC20 usdc;
    LotteryPoolHandler handler;

    address admin = makeAddr("invariant-admin");
    address operator = makeAddr("invariant-operator");
    address feeRecipient = makeAddr("invariant-feeRecipient");

    function setUp() public {
        usdc = new MockERC20();
        pool = new LotteryPool(address(usdc), admin, operator, feeRecipient, 1500, 7 days);
        handler = new LotteryPoolHandler(pool, usdc, admin, operator);

        targetContract(address(handler));
    }

    function invariant_poolBalanceMatchesOutstandingPots() public view {
        assertEq(usdc.balanceOf(address(pool)), handler.ghostOutstandingPot());
    }
}
