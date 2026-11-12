// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {LotteryPool} from "../src/LotteryPool.sol";

/// @notice Deploys LotteryPool. All configuration comes from environment variables
/// so the same script deploys to testnet now and mainnet later (mainnet cutover is
/// config/deployment, not a code change - see docs/decisions.md ADR-001).
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY   - pays gas and becomes the broadcaster (not necessarily admin)
///   USDC_ADDRESS           - the ERC20 this pool escrows (test USDC on Sepolia)
///   POOL_ADMIN_ADDRESS     - gets DEFAULT_ADMIN_ROLE (treasury-controlling; EOA on
///                            testnet, must be a Safe multisig before mainnet)
///   POOL_OPERATOR_ADDRESS  - gets OPERATOR_ROLE (the result-submitting address)
///   FEE_RECIPIENT_ADDRESS  - receives the platform's cut
/// Optional (defaults shown):
///   FEE_BPS                - default 1500 (15%)
///   RECOVERY_TIMEOUT_SECS  - default 604800 (7 days)
contract DeployLotteryPool is Script {
    function run() external returns (LotteryPool pool) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address admin = vm.envAddress("POOL_ADMIN_ADDRESS");
        address operator = vm.envAddress("POOL_OPERATOR_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT_ADDRESS");
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(1500)));
        uint256 recoveryTimeout = vm.envOr("RECOVERY_TIMEOUT_SECS", uint256(7 days));

        vm.startBroadcast(deployerKey);
        pool = new LotteryPool(usdc, admin, operator, feeRecipient, feeBps, recoveryTimeout);
        vm.stopBroadcast();

        console.log("LotteryPool deployed:", address(pool));
        console.log("  usdc:          ", usdc);
        console.log("  admin:         ", admin);
        console.log("  operator:      ", operator);
        console.log("  feeRecipient:  ", feeRecipient);
        console.log("  feeBps:        ", feeBps);
        console.log("  recoveryTimeout:", recoveryTimeout);
    }
}
