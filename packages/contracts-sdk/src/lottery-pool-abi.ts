/**
 * Hand-extracted from contracts/out/LotteryPool.sol/LotteryPool.json after
 * `forge build` - only the functions/events the app actually calls, not the full
 * artifact. `as const` gives full type inference through viem (argument and return
 * types) without needing a codegen step. Regenerate by re-running:
 *
 *   cd contracts && forge build && python3 -c "
 *   import json
 *   data = json.load(open('out/LotteryPool.sol/LotteryPool.json'))
 *   wanted = [f for f in data['abi'] if f.get('name') in
 *     ('fundDraw','submitResult','getDraw','DrawFunded','DrawSettled')]
 *   print(json.dumps(wanted, indent=2))
 *   "
 *
 * if LotteryPool.sol's signatures change. A generated wagmi-cli pipeline
 * (architecture.md's original aspiration for this package) remains a nice-to-have,
 * not done here - this hand-maintained subset is simpler and sufficient for now.
 */
export const lotteryPoolAbi = [
  {
    type: "function",
    name: "fundDraw",
    inputs: [
      { name: "drawId", type: "uint256", internalType: "uint256" },
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "ticketCount", type: "uint256", internalType: "uint256" },
      { name: "ticketListHash", type: "bytes32", internalType: "bytes32" },
      { name: "cutoffTimestamp", type: "uint64", internalType: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitResult",
    inputs: [
      { name: "drawId", type: "uint256", internalType: "uint256" },
      { name: "winner", type: "address", internalType: "address" },
      { name: "winningTxId", type: "bytes32", internalType: "bytes32" },
      { name: "winningTicketIndex", type: "uint32", internalType: "uint32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getDraw",
    inputs: [{ name: "drawId", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct LotteryPool.Draw",
        components: [
          { name: "potAmount", type: "uint256", internalType: "uint256" },
          { name: "ticketCount", type: "uint256", internalType: "uint256" },
          { name: "ticketListHash", type: "bytes32", internalType: "bytes32" },
          { name: "cutoffTimestamp", type: "uint64", internalType: "uint64" },
          { name: "status", type: "uint8", internalType: "enum LotteryPool.DrawStatus" },
          { name: "winner", type: "address", internalType: "address" },
          { name: "payoutAmount", type: "uint256", internalType: "uint256" },
          { name: "feeAmount", type: "uint256", internalType: "uint256" },
          { name: "winningTxId", type: "bytes32", internalType: "bytes32" },
          { name: "winningTicketIndex", type: "uint32", internalType: "uint32" },
          { name: "fundedAt", type: "uint256", internalType: "uint256" },
          { name: "settledAt", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "DrawFunded",
    inputs: [
      { name: "drawId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "ticketCount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "ticketListHash", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "cutoffTimestamp", type: "uint64", indexed: false, internalType: "uint64" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "DrawSettled",
    inputs: [
      { name: "drawId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "winner", type: "address", indexed: false, internalType: "address" },
      { name: "winningTxId", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "winningTicketIndex", type: "uint32", indexed: false, internalType: "uint32" },
      { name: "payoutAmount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "feeAmount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
] as const;

export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "spender", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
