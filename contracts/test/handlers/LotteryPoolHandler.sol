// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LotteryPool} from "../../src/LotteryPool.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Drives LotteryPool through random, always-valid sequences of
/// fundDraw/submitResult/recoverStuckFunds for the invariant test. "Always valid"
/// matters: an invariant test proves properties that hold across *legitimate* usage,
/// so this handler skips a call outright rather than let it revert into a no-op -
/// clamping inputs to always succeed exercises far more real contract state than
/// bounding them to "won't revert."
contract LotteryPoolHandler is Test {
    LotteryPool public pool;
    MockERC20 public usdc;
    address public admin;
    address public operator;

    uint256[] public fundedDrawIds;
    mapping(uint256 => bool) public isFunded;
    uint256 public nextDrawId = 1;

    /// @dev Ghost accounting: tracks what the pool's balance *should* be, kept in
    /// lockstep with every call this handler makes - this is the independent oracle
    /// the invariant checks the real contract state against.
    uint256 public ghostOutstandingPot;

    constructor(LotteryPool pool_, MockERC20 usdc_, address admin_, address operator_) {
        pool = pool_;
        usdc = usdc_;
        admin = admin_;
        operator = operator_;
    }

    function fundDraw(uint256 amountSeed, uint256 ticketCountSeed) public {
        uint256 amount = bound(amountSeed, 1, 1_000_000_000_000);
        uint256 ticketCount = bound(ticketCountSeed, 1, 1_000_000);

        uint256 drawId = nextDrawId++;

        usdc.mint(admin, amount);
        vm.prank(admin);
        usdc.approve(address(pool), amount);
        vm.prank(admin);
        pool.fundDraw(drawId, amount, ticketCount, keccak256(abi.encode(drawId)), uint64(block.timestamp));

        fundedDrawIds.push(drawId);
        isFunded[drawId] = true;
        ghostOutstandingPot += amount;
    }

    function settleRandomDraw(uint256 drawIndexSeed, address winner, uint32 ticketIndexSeed) public {
        // The contract rejects a winner equal to its own or the token's address
        // (see LotteryPool.submitResult) - remap rather than skip, so the fuzzer's
        // frequent attempts at exactly these addresses still exercise a settlement.
        if (winner == address(0) || winner == address(pool) || winner == address(usdc)) {
            winner = address(uint160(uint256(keccak256(abi.encode(winner, "remapped-winner")))));
        }
        if (fundedDrawIds.length == 0) return;

        uint256 drawIndex = bound(drawIndexSeed, 0, fundedDrawIds.length - 1);
        uint256 drawId = fundedDrawIds[drawIndex];
        if (!isFunded[drawId]) return;

        LotteryPool.Draw memory draw = pool.getDraw(drawId);
        uint32 ticketIndex = uint32(bound(ticketIndexSeed, 0, draw.ticketCount - 1));

        vm.prank(operator);
        pool.submitResult(drawId, winner, keccak256(abi.encode(drawId, "tx")), ticketIndex);

        isFunded[drawId] = false;
        ghostOutstandingPot -= draw.potAmount;
    }

    function recoverRandomDraw(uint256 drawIndexSeed) public {
        if (fundedDrawIds.length == 0) return;

        uint256 drawIndex = bound(drawIndexSeed, 0, fundedDrawIds.length - 1);
        uint256 drawId = fundedDrawIds[drawIndex];
        if (!isFunded[drawId]) return;

        LotteryPool.Draw memory draw = pool.getDraw(drawId);
        uint256 timeoutAt = draw.fundedAt + pool.recoveryTimeout();
        if (block.timestamp < timeoutAt) {
            vm.warp(timeoutAt);
        }

        vm.prank(admin);
        pool.recoverStuckFunds(drawId);

        isFunded[drawId] = false;
        ghostOutstandingPot -= draw.potAmount;
    }
}
