import { decodeEventLog, parseAbi, zeroAddress, type Address, type Hex } from "viem";

const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** Only logs of this transaction prove this faucet mint. Block-end balances
 * may include unrelated transfers and must not invalidate the receipt. */
export function hasExactFaucetMint(
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[],
  token: Address,
  account: Address,
  amount: bigint,
): boolean {
  let total = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== token.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: transferAbi, data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (event.args.from.toLowerCase() === zeroAddress &&
          event.args.to.toLowerCase() === account.toLowerCase()) total += event.args.value;
    } catch { /* Unrelated event; never use another transaction's logs. */ }
  }
  return total === amount;
}

/** Call only AFTER chain, sender, nonce, target, calldata, value and successful
 * receipt are verified. Semantic read failures are terminal warnings, not an
 * invitation to repeat a mined transaction or hold an app-wide write lock. */
export async function checkMinedSemantics(check: () => Promise<void>): Promise<string | undefined> {
  try { await check(); return undefined; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** Old records without nonce cannot establish that a request was unbroadcast. */
export function requireCancellationNonce(p: { nonce?: number; hash?: Hex; queryHash?: Hex }): number {
  if (p.hash || p.queryHash) throw new Error("已记录交易哈希，请核实原交易，不能直接解除等待。");
  if (p.nonce === undefined) throw new Error("原记录缺少 nonce，不能确认未广播；请从原钱包找回交易哈希并核实。");
  return p.nonce;
}
