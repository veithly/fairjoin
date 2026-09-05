import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { Address } from "viem";
import type { AppController, Member, Snapshot } from "../types";
import { memberAt, reader } from '../lib/chain';
import type { OpenAction } from "./Activity";
import {
  AddressText,
  Amount,
  ExplorerLink,
  Ledger,
  Notice,
  Status,
  Timeline,
  destination,
  exact,
  exportJson,
  refundable,
  same,
} from "./shared";
import { i18nText } from "../lib/i18n";

export function Receipt({
  controller: c,
  address,
  onAction,
  onShare,
}: {
  controller: AppController;
  address: Address;
  onAction: OpenAction;
  onShare: () => void;
}) {
  const [member, setMember] = useState<Member | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(true);
  const [retry, setRetry] = useState(0);
  const currentSnapshot = c.snapshot!;
  const [receiptSnapshot,setReceiptSnapshot] = useState<Snapshot | null>(null);
  const s = receiptSnapshot ?? currentSnapshot;
  const d = c.deployment!;
  const g = s.group;
  const receiptScope = `${d.chainId}:${d.contract}:${currentSnapshot.group.id}:${address.toLowerCase()}`;
  const loadedScope = useRef("");
  useEffect(() => {
    let live = true;
    const scopeChanged = loadedScope.current !== receiptScope;
    setReading(scopeChanged);
    setError("");
    if (scopeChanged) setMember(null);
    memberAt(reader(d),d,currentSnapshot.group.id,address,currentSnapshot.blockNumber)
      .then((value) => {
        if (live) { loadedScope.current = receiptScope; setReceiptSnapshot(currentSnapshot); setMember(value); }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : i18nText("收据读取失败"));
      })
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [address, currentSnapshot.blockNumber, currentSnapshot.group.id, retry, receiptScope]);
  if (reading || (!error && loadedScope.current !== receiptScope))
    return (
      <section className="empty-state" role="status">
        <h1>{i18nText("正在核对这份收据")}</h1>
        <p>{i18nText("读取原付款地址的累计账本，不依赖此浏览器的历史。")}</p>
        <div className="skeleton" />
      </section>
    );
  if (error || !member)
    return (
      <section className="empty-state">
        <h1>{i18nText("暂时无法读取收据")}</h1>
        <Notice tone="danger" role="alert">
          {error || i18nText("该地址的账本尚不可用")}
        </Notice>
        <button className="primary" onClick={() => setRetry((x) => x + 1)}>
          {i18nText("重新查询收据")}
        </button>
      </section>
    );
  const m = member;
  const refund = refundable(g, s.timestamp);
  const mine = same(address, c.account);
  const blocked = c.stale || Boolean(c.error) || Boolean(c.pending);
  const events = s.events.filter(
    (e) =>
      same(e.actor, address) ||
      [
        "PriceUpdated",
        "FundingReached",
        "Cancelled",
        "Finalized",
        "OrganizerPaid",
      ].includes(e.name),
  );
  function download() {
    exportJson(i18nText("拼好团_{0}_{1}_receipt.json", g.id, address), {
      product: i18nText("拼好团"),
      source: "contract state and chain event logs",
      warning:
        i18nText("JSON 可被修改；请使用以下标识重新查询链上数据，不将文件本身视为不可伪造凭证。"),
      exportedAt: new Date().toISOString(),
      chainId: d.chainId,
      contract: d.contract,
      token: d.token,
      decimals: d.decimals,
      symbol: d.symbol,
      groupId: g.id,
      termsHash: g.termsHash,
      policyVersion: 1,
      address,
      snapshotBlock: s.blockNumber,
      snapshotTimestamp: s.timestamp,
      eventsCompleteTo: s.eventsCompleteTo,
      networkMode: d.local ? 'local-test' : 'monad-testnet',
      monetaryValue: false,
      member: m,
      events,
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="stat-label">
            {g.metadata.title} {i18nText("· 活动 #")}{g.id.toString()}
          </p>
          <h1>{mine ? i18nText("你的") : i18nText("公开")}{i18nText("同价收据。")}</h1>
          <p className="fine">{i18nText("原付款地址的累计记录，未连接钱包也能核对。")}</p>
        </div>
        <div className="utility-actions"><button className="secondary" onClick={download}>{i18nText("导出收据 JSON")}</button><button className="secondary" onClick={()=>window.print()}>{i18nText("打印／保存收据")}</button></div>
      </div>
      {m.paid === 0n ? (
        <section className="empty-state">
          <h2>{i18nText("这个钱包尚未参加本团。")}</h2>
          <AddressText value={address} />
          <p>{i18nText("付款成功并获得名额后，这里会出现可公开核对的收据。")}</p>
          <a className="primary" href={destination(`/g/${g.id}`, d)}>
            {i18nText("返回活动查看报价")}
          </a>
        </section>
      ) : (
        <div className="receipt-grid">
          <section className="receipt-paper">
            <div className="paper-head">
              <strong>{i18nText("拼好团 · 同价收据")}</strong>
              <Status snapshot={s} />
            </div>
            <p className="stat-label">
              {refund || !m.active
                ? i18nText("活动应摊")
                : g.funded
                  ? i18nText("当前应摊")
                  : i18nText("预报名款")}
            </p>
            <Amount value={m.share} deployment={d} large />
            <dl className="rows">
              <div>
                <dt>{i18nText("累计支付")}</dt>
                <dd>
                  <Amount value={m.paid} deployment={d} />
                </dd>
              </div>
              <div>
                <dt>{i18nText("累计已退回")}</dt>
                <dd>
                  <Amount value={m.returned} deployment={d} />
                </dd>
              </div>
              <div>
                <dt>{refund ? i18nText("剩余可退回") : i18nText("现在可领差价")}</dt>
                <dd className="positive">
                  <Amount value={m.claimable} deployment={d} />
                </dd>
              </div>
            </dl>
            <div className="equation-box">
              <strong>{i18nText("每一笔，都对得上。")}</strong>
              <p>
                {exact(m.paid, d.decimals)} − {exact(m.returned, d.decimals)} −{" "}
                {exact(m.claimable, d.decimals)} = {exact(m.share, d.decimals)}{" "}
                {d.symbol}
              </p>
              <p className="fine">
                {i18nText("钱包当前净流出")} {exact(m.paid - m.returned, d.decimals)}
                {i18nText("；领取后为")} {exact(m.share, d.decimals)}
                {i18nText("。网络费另计。累计支付包含退出后重新报名的历史。")}
              </p>
            </div>
            {m.returned === m.paid && (
              <Notice tone="good">
                {i18nText("已退回全部款项；该地址当前不承担活动费用。")}
              </Notice>
            )}
            <details className="compact-details">
            <summary>{i18nText("链上记录")}</summary>
            <Timeline
              events={events}
              deployment={d}
              incompleteTo={
                s.eventsCompleteTo < s.blockNumber ? s.eventsCompleteTo : undefined
              }
            />
            </details>
          </section>
          <aside>
            <section className="claim-card">
              <p className="stat-label">
                {refund ? i18nText("现在还可退回") : i18nText("现在可领取")}
              </p>
              <Amount value={m.claimable} deployment={d} large />
              <p>
                {refund
                  ? i18nText("已领金额已抵扣，剩余退款仍归原付款人。")
                  : i18nText("可领差价尚未转入钱包。可以留待以后累积领取，不会因主办方收款而失效。")}
              </p>
              {!c.connected ? (
                <ConnectButton label={i18nText("连接原付款钱包")} />
              ) : !mine ? (
                <Notice tone="warning">
                  {i18nText("当前钱包与收据地址不匹配。请在上方钱包入口切换到原付款地址；不能将此退款领到其他地址。")}
                </Notice>
              ) : m.claimable > 0n ? (
                <button
                  className="primary refund-button wide"
                  disabled={blocked}
                  onClick={() => onAction("claim")}
                >
                  {c.pending
                    ? i18nText("原交易正在核实")
                    : refund
                      ? i18nText("退回原钱包")
                      : i18nText("领取到原钱包")}
                </button>
              ) : (
                <p className="fine">
                  {m.active && !g.funded && !refund
                    ? i18nText("尚未成团，预报名款仍在合约中。")
                    : i18nText("当前没有可领取余额。")}
                </p>
              )}
              {mine &&
                m.active &&
                !g.funded &&
                !refund &&
                g.status === 0 &&
                s.timestamp < g.deadline && (
                  <button
                    className="secondary wide"
                    disabled={blocked}
                    onClick={() => onAction("leave")}
                  >
                    {i18nText("成团前退出并退款")}
                  </button>
                )}
            </section>
            <section className="account-panel">
              <h3>{i18nText("原付款钱包")}</h3>
              <AddressText value={address} />
              <button className="text-button" onClick={onShare}>
                {i18nText("复制公开收据链接")}
              </button>
              <a className="text-button" href={destination(`/g/${g.id}`, d)}>
                {i18nText("返回活动")}
              </a>
              {mine && c.allowance > 0n && (
                <button
                  className="text-button"
                  disabled={Boolean(c.pending)}
                  onClick={() => onAction("revoke")}
                >
                  {i18nText("撤销剩余授权")} {exact(c.allowance, d.decimals)}
                </button>
              )}
            </section>
          </aside>
        </div>
      )}
      <details className="verification">
        <summary>{i18nText("公开验证 · 网络、合约与记录来源")}</summary>
        <dl className="rows">
          <div>
            <dt>{i18nText("网络")}</dt>
            <dd>
              {d.name} · {d.chainId}
            </dd>
          </div>
          <div>
            <dt>{i18nText("业务合约")}</dt>
            <dd>
              <AddressText value={d.contract} />
            </dd>
          </div>
          <div>
            <dt>{i18nText("资产地址")}</dt>
            <dd>
              <AddressText value={d.token} />
            </dd>
          </div>
          <div>
            <dt>{i18nText("规则哈希")}</dt>
            <dd>
              <AddressText value={g.termsHash} />
            </dd>
          </div>
          <div>
            <dt>{i18nText("快照区块")}</dt>
            <dd>{s.blockNumber.toString()}</dd>
          </div>
        </dl>
        <ExplorerLink deployment={d} address={d.contract}>
          {i18nText("查看业务合约")}
        </ExplorerLink>
        <p className="fine">
          {i18nText("规则 v1 · 资产精度")} {d.decimals} {i18nText("位。导出的 JSON\n          是查询线索，不是不可修改的链上证明。")}
        </p>
      </details>
      <Ledger snapshot={s} deployment={d} />
    </>
  );
}
