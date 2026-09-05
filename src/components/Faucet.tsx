import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { demoTokenAbi } from "../generated/abi";
import { reader } from "../lib/chain";
import type { AppController, Deployment } from "../types";
import { ExplorerLink } from "./shared";
import { i18nText } from "../lib/i18n";

const MONAD_FAUCET = "https://faucet.monad.xyz";

export function TestTokenFaucet({ controller }: { controller: AppController }) {
  const d = controller.deployment;
  if (
    !d ||
    d.chainId !== 10143 ||
    d.symbol !== "FJUSD" ||
    d.assetType !== "project-demo-token"
  )
    return null;
  return <FaucetCard deployment={d} controller={controller} />;
}

function FaucetCard({
  deployment: d,
  controller: c,
}: {
  deployment: Deployment;
  controller: AppController;
}) {
  const { address, isConnected } = useAccount();
  const [nextClaimAt, setNextClaimAt] = useState<bigint | null>(null);
  const [chainNow, setChainNow] = useState(0n);
  const [fee, setFee] = useState<bigint | null>(null);
  const tx = c.transaction && c.transaction.kind === "faucet" ? c.transaction : null;
  // One faucet action at a time: the button stays disabled while ANY pending
  // transaction exists, and execute() serializes writes through the same gate.
  const busy = Boolean(c.pending);
  useEffect(() => {
    if (!address) {
      setNextClaimAt(null);
      return;
    }
    let live = true;
    const client = reader(d);
    const read = async () => {
      try {
        const block = await client.getBlock();
        const next = (await client.readContract({
          address: d.token,
          abi: demoTokenAbi,
          functionName: "nextClaimAt",
          args: [address],
          blockNumber: block.number,
        })) as bigint;
        if (live) {
          setNextClaimAt(next);
          setChainNow(block.timestamp);
        }
      } catch {
        if (live) setNextClaimAt(null);
      }
    };
    void read();
    const t = setInterval(() => void read(), 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [d, address, tx?.phase]);
  useEffect(() => {
    void c.estimateAction({ kind: "faucet" }).then((v) =>
      setFee(v ? v.total : null),
    );
  }, [c.estimateAction, d]);
  const cooling = nextClaimAt !== null && nextClaimAt > chainNow;
  const status =
    tx?.phase === "confirmed"
      ? tx.verificationWarning
        ? i18nText("交易已上链，请人工核对收据")
        : i18nText("已核实铸造 1,000 {0}。", d.symbol)
      : tx?.phase === "reverted"
        ? i18nText("交易回滚，未铸造任何测试代币；网络费可能已消耗。")
        : tx?.phase === "rejected"
          ? i18nText("钱包签名已取消，未发生任何转账。")
          : tx && tx.hash
            ? i18nText("交易已广播，正在等待链上确认并核实到账。")
            : tx
              ? i18nText("等待钱包签名。")
              : "";
  return (
    <section className="faucet-card" aria-labelledby="faucet-title">
      <div>
        <p className="stat-label" id="faucet-title">
          {i18nText("测试代币水龙头 · 仅 Monad 测试网 10143")}
        </p>
        <p className="fine">
          {i18nText("每次铸造 1,000")} {d.symbol}{i18nText("，每个地址每 24 小时可领一次。")}{d.symbol}
          {i18nText("是本项目发行的测试代币，无任何价值，也不是 Circle USDC。需要 MON\n          支付网络手续费")}
          {fee !== null ? i18nText("（预计 {0} MON，估算值）", formatEther(fee)) : ""}
          {i18nText("，可访问官方 Monad 水龙头。")}
        </p>
      </div>
      <div className="faucet-actions">
        <button
          data-testid="faucet-claim"
          disabled={busy || !isConnected || cooling}
          onClick={() => void c.execute({ kind: "faucet" })}
        >
          {busy
            ? i18nText("交易处理中，请勿重复提交…")
            : !isConnected
              ? i18nText("连接钱包后可领取")
              : cooling && nextClaimAt !== null
                ? i18nText("冷却中，下次可领约在区块时间 {0}（UNIX 秒）", nextClaimAt.toString())
                : i18nText("领取 1,000 {0}", d.symbol)}
        </button>
        <a
          className="text-button"
          href={MONAD_FAUCET}
          target="_blank"
          rel="noreferrer"
        >
          {i18nText("MON 官方水龙头 ↗")}
        </a>
      </div>
      {status && (
        <p
          className={tx?.phase === "reverted" ? "error-text" : "fine"}
          role={tx?.phase === "reverted" ? "alert" : "status"}
        >
          {status}
          {tx?.message ? ` ${tx.message}` : ""}
        </p>
      )}
      {tx?.hash && (
        <ExplorerLink deployment={d} hash={tx.hash}>
          {i18nText("查看水龙头交易")}
        </ExplorerLink>
      )}
      <p className="fine">
        {i18nText("领取由你的钱包签名并在链上执行；本页面不从服务器代领或自动注资。\n        若广播后超时，交易哈希会被保存并进入同一套恢复流程。")}
      </p>
    </section>
  );
}
