// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LotteryPool} from "../../src/LotteryPool.sol";

/// @notice Standard ERC20.transfer never calls back into the recipient, so
/// LotteryPool's nonReentrant guard is defense-in-depth against a non-standard or
/// malicious token (e.g. one with transfer hooks), not against USDC itself. This
/// mock's transfer() calls back into the pool to prove that guard actually blocks a
/// reentrant call, rather than assuming it does because the modifier is present.
contract ReentrantERC20 is ERC20 {
    LotteryPool public target;
    uint256 public reentrantDrawId;
    address public reentrantWinner;
    bytes32 public reentrantTxId;
    uint32 public reentrantTicketIndex;
    bool public attack;

    constructor() ERC20("Reentrant Mock", "RMOCK") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function armAttack(LotteryPool target_, uint256 drawId, address winner_, bytes32 txId, uint32 ticketIndex)
        external
    {
        target = target_;
        reentrantDrawId = drawId;
        reentrantWinner = winner_;
        reentrantTxId = txId;
        reentrantTicketIndex = ticketIndex;
        attack = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (attack) {
            attack = false; // only once, so the test fails loudly (not an infinite loop) if the guard is missing
            target.submitResult(reentrantDrawId, reentrantWinner, reentrantTxId, reentrantTicketIndex);
        }
        return ok;
    }
}
