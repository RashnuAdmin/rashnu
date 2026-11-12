// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LotteryPool
/// @notice Payout/escrow only (see docs/decisions.md ADR-003 in the main repo): holds
/// a draw's pot and pays it out once a result is submitted. It cannot verify the
/// Bitcoin-derived randomness itself - fraud-resistance comes from fundDraw's
/// ticketListHash commitment provably predating the randomness source, plus the RNG
/// algorithm (packages/verifier) being open-source and independently re-runnable by
/// anyone. Ticket sales happen off-chain; this contract never sees individual
/// tickets, only each draw's aggregate pot and ticket count.
contract LotteryPool is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    enum DrawStatus {
        None,
        Funded,
        Settled,
        Recovered
    }

    struct Draw {
        uint256 potAmount;
        uint256 ticketCount;
        bytes32 ticketListHash;
        uint64 cutoffTimestamp;
        DrawStatus status;
        address winner;
        uint256 payoutAmount;
        uint256 feeAmount;
        bytes32 winningTxId;
        uint32 winningTicketIndex;
        uint256 fundedAt;
        uint256 settledAt;
    }

    IERC20 public immutable usdc;
    address public feeRecipient;
    uint16 public feeBps;
    uint256 public recoveryTimeout;

    mapping(uint256 => Draw) public draws;

    event DrawFunded(
        uint256 indexed drawId, uint256 amount, uint256 ticketCount, bytes32 ticketListHash, uint64 cutoffTimestamp
    );
    event DrawSettled(
        uint256 indexed drawId,
        address winner,
        bytes32 winningTxId,
        uint32 winningTicketIndex,
        uint256 payoutAmount,
        uint256 feeAmount
    );
    event StuckFundsRecovered(uint256 indexed drawId, address to, uint256 amount);
    event FeeRecipientUpdated(address newFeeRecipient);
    event FeeBpsUpdated(uint16 newFeeBps);
    event RecoveryTimeoutUpdated(uint256 newRecoveryTimeout);

    constructor(
        address usdcAddress,
        address admin,
        address operator,
        address feeRecipient_,
        uint16 feeBps_,
        uint256 recoveryTimeout_
    ) {
        require(usdcAddress != address(0), "usdc=0");
        require(admin != address(0), "admin=0");
        require(operator != address(0), "operator=0");
        require(feeRecipient_ != address(0), "feeRecipient=0");
        require(feeBps_ <= 10_000, "feeBps>100%");

        usdc = IERC20(usdcAddress);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        recoveryTimeout = recoveryTimeout_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
    }

    /// @notice Commits a draw's pot and ticket-list hash on-chain, pulling `amount`
    /// USDC from the caller (who must have pre-approved this contract). Must be
    /// called before the qualifying Bitcoin block used for this draw's randomness
    /// can exist - that ordering, not anything this contract checks, is the actual
    /// anti-manipulation property.
    function fundDraw(uint256 drawId, uint256 amount, uint256 ticketCount, bytes32 ticketListHash, uint64 cutoffTimestamp)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenNotPaused
    {
        require(draws[drawId].status == DrawStatus.None, "draw already exists");
        require(amount > 0, "amount=0");
        require(ticketCount > 0, "ticketCount=0");

        draws[drawId] = Draw({
            potAmount: amount,
            ticketCount: ticketCount,
            ticketListHash: ticketListHash,
            cutoffTimestamp: cutoffTimestamp,
            status: DrawStatus.Funded,
            winner: address(0),
            payoutAmount: 0,
            feeAmount: 0,
            winningTxId: bytes32(0),
            winningTicketIndex: 0,
            fundedAt: block.timestamp,
            settledAt: 0
        });

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit DrawFunded(drawId, amount, ticketCount, ticketListHash, cutoffTimestamp);
    }

    /// @notice Settles a funded draw: splits the pot by feeBps and pays the winner
    /// and fee recipient atomically. The only check this contract can make on the
    /// off-chain-computed result is that the index is in bounds - it cannot verify
    /// the Bitcoin math itself.
    function submitResult(uint256 drawId, address winner, bytes32 winningTxId, uint32 winningTicketIndex)
        external
        nonReentrant
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        Draw storage draw = draws[drawId];
        require(draw.status == DrawStatus.Funded, "draw not funded");
        require(winner != address(0), "winner=0");
        // A winner of this contract's own address, or the token's, would make the
        // payout self-transfer and get stuck while still recording the draw as
        // cleanly settled - found by the invariant fuzzer trying exactly this
        // address, not something a human reviewer thought to check for by hand.
        require(winner != address(this), "winner=pool");
        require(winner != address(usdc), "winner=token");
        require(winningTicketIndex < draw.ticketCount, "ticket index out of bounds");

        uint256 pot = draw.potAmount;
        uint256 feeAmount = (pot * feeBps) / 10_000;
        uint256 payoutAmount = pot - feeAmount;

        draw.status = DrawStatus.Settled;
        draw.winner = winner;
        draw.payoutAmount = payoutAmount;
        draw.feeAmount = feeAmount;
        draw.winningTxId = winningTxId;
        draw.winningTicketIndex = winningTicketIndex;
        draw.settledAt = block.timestamp;

        usdc.safeTransfer(winner, payoutAmount);
        if (feeAmount > 0) {
            usdc.safeTransfer(feeRecipient, feeAmount);
        }

        emit DrawSettled(drawId, winner, winningTxId, winningTicketIndex, payoutAmount, feeAmount);
    }

    /// @notice Owner-only escape hatch: returns a funded-but-never-settled draw's pot
    /// to the caller once `recoveryTimeout` has elapsed since funding. Guards against
    /// a lost or compromised operator key permanently stranding a pot. Deliberately
    /// not gated by whenNotPaused - pausing is for halting normal operation, not for
    /// blocking the one function that exists to recover from an emergency.
    function recoverStuckFunds(uint256 drawId) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        Draw storage draw = draws[drawId];
        require(draw.status == DrawStatus.Funded, "draw not funded");
        require(block.timestamp >= draw.fundedAt + recoveryTimeout, "recovery timeout not elapsed");

        uint256 amount = draw.potAmount;
        draw.status = DrawStatus.Recovered;

        usdc.safeTransfer(msg.sender, amount);

        emit StuckFundsRecovered(drawId, msg.sender, amount);
    }

    function setFeeRecipient(address newFeeRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeRecipient != address(0), "feeRecipient=0");
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(newFeeRecipient);
    }

    function setFeeBps(uint16 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeBps <= 10_000, "feeBps>100%");
        feeBps = newFeeBps;
        emit FeeBpsUpdated(newFeeBps);
    }

    function setRecoveryTimeout(uint256 newRecoveryTimeout) external onlyRole(DEFAULT_ADMIN_ROLE) {
        recoveryTimeout = newRecoveryTimeout;
        emit RecoveryTimeoutUpdated(newRecoveryTimeout);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getDraw(uint256 drawId) external view returns (Draw memory) {
        return draws[drawId];
    }
}
