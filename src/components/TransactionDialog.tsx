import { useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther, parseUnits, type Address } from "viem";
import type {
  ActionKind,
  AppController,
  CreateInput,
  JoinQuote,
  Member,
  TxPhase,
} from "../types";
import { recordEvent } from "../lib/telemetry";
import { validateCreate } from "./Host";
import {
  AddressText,
  Amount,
  ExplorerLink,
  Modal,
  Notice,
  date,
  destination,
  exact,
  refundable,
  same,
  short,
  timezone,
} from "./shared";
import { i18nText } from "../lib/i18n";

const titles: Record<ActionKind, string> = {
  approve: i18nText("授权本次精确金额"),
  join: i18nText("核对报名与付款"),
  claim: i18nText("领取到原付款钱包"),
  leave: i18nText("成团前退出并退款"),
  cancel: i18nText("确认取消这个团"),
  finalize: i18nText("确认截止结算"),
  withdraw: i18nText("收取固定本金"),
  revoke: i18nText("撤销剩余授权"),
  create: i18nText("确认不可修改的活动条款"),
  faucet: i18nText("领取测试代币"),
};
const phases: Record<TxPhase, string> = {
  idle: i18nText("核对操作"),
  quoting: i18nText("正在核对最新价格"),
  "approval-signature": i18nText("请在钱包确认本次授权"),
  "approval-pending": i18nText("授权已提交，尚未报名"),
  "join-signature": i18nText("请在钱包确认这次操作"),
  submitted: i18nText("交易已提交，正在确认"),
  verifying: i18nText("正在核对链上账本"),
  confirmed: i18nText("交易与账本已核对"),
  rejected: i18nText("签名已取消，操作未完成"),
  reverted: i18nText("交易未完成"),
  unknown: i18nText("暂时无法确认，请勿重复付款"),
};
export interface DialogRequest {
  kind: ActionKind;
  create?: CreateInput;
  account?: Address;
}
export function TransactionDialog({
  controller: c,
  request,
  onClose,
}: {
  controller: AppController;
  request: DialogRequest;
  onClose: () => void;
}) {
  const [consent, setConsent] = useState(false);
  const [quote, setQuote] = useState<JoinQuote | null>(
    request.kind === "join" ? c.quote : null,
  );
  const [oldQuote, setOldQuote] = useState<JoinQuote | null>(null);
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [now, setNow] = useState(Date.now());
  const [actor, setActor] = useState<Address | undefined>(
    request.account || c.account,
  );
  const [manualHash, setManualHash] = useState("");
  const [cancelChecked, setCancelChecked] = useState(false);
  const [fee, setFee] = useState<{ total: bigint } | null>(null);
  const d = c.deployment!;
  const g = c.snapshot?.group;
  const kind = request.kind === "approve" ? "join" : request.kind;
  const tx = c.transaction || c.pending;
  const phase = tx?.phase || "idle";
  const activeTx =
    tx && !["idle", "rejected", "reverted", "confirmed"].includes(phase);
  const success = tx?.phase === "confirmed";
  const warning = success ? tx.verificationWarning : undefined;
  const approvalSuccess = success && tx.kind === "approve";
  const failure = phase === "rejected" || phase === "reverted";
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    recordEvent("join_open", {
      chainId: d.chainId,
      groupId: c.snapshot?.group.id.toString(),
      kind: request.kind,
    });
    if (c.connected) recordEvent("wallet_connected", { chainId: d.chainId });
  }, []);
  useEffect(() => {
    setConsent(false);
    if (!actor && c.account) setActor(c.account);
  }, [c.account]);
  useEffect(() => {
    if (!g || !actor || !["claim", "leave"].includes(kind)) return;
    let live = true;
    c.readMember(actor)
      .then((value) => {
        if (live) setMember(value);
      })
      .catch((error) => {
        if (live)
          setLocalError(
            error instanceof Error ? error.message : i18nText("无法核对原付款钱包"),
          );
      });
    return () => {
      live = false;
    };
  }, [actor, g?.id, c.snapshot?.blockNumber, c.readMember, kind]);
  async function updateQuote() {
    setBusy(true);
    setConsent(false);
    setLocalError("");
    try {
      const next = await c.refreshQuote();
      setOldQuote(quote);
      setQuote(next);
      if (!next)
        setLocalError(i18nText("当前不能获取可执行报价，请返回活动核对名额与截止时间。"));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : i18nText("报价读取失败"));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (kind === "join" && !activeTx && !success) void updateQuote();
  }, []);
  const chainNow = c.snapshot
    ? c.snapshot.timestamp +
      BigInt(Math.max(0, Math.floor((now - c.snapshot.fetchedAt) / 1000)))
    : BigInt(Math.floor(now / 1000));
  const quoteInvalid =
    kind === "join" &&
    (!quote ||
      chainNow >= quote.quoteExpiry ||
      (g && quote.rosterVersion !== g.rosterVersion));
  const changed =
    quote &&
    oldQuote &&
    (quote.amount !== oldQuote.amount ||
      quote.rosterVersion !== oldQuote.rosterVersion);
  const mismatched = actor && c.account && !same(actor, c.account);
  const needsApproval = kind === "join" && quote && c.allowance < quote.amount;
  const amount =
    kind === "join"
      ? quote?.amount
      : kind === "claim"
        ? member?.claimable
        : kind === "leave" && member
          ? member.paid - member.returned
          : kind === "withdraw"
            ? g?.cost
            : kind === "revoke"
              ? c.allowance
              : undefined;
  const requiresGroup = kind !== "create" && kind !== "revoke";
  const dataBlocked = requiresGroup && (!g || c.stale || Boolean(c.error));
  const insufficient =
    kind === "join" && amount !== undefined && c.tokenBalance < amount;
  const noGas = c.connected && c.nativeBalance === 0n;
  useEffect(() => {
    let live = true;
    setFee(null);
    void c
      .estimateAction({
        kind: needsApproval ? "approve" : kind,
        quote: quote || undefined,
        create: request.create,
      })
      .then((value) => {
        if (live) setFee(value ? { total: value.total } : null);
      });
    return () => {
      live = false;
    };
  }, [
    kind,
    needsApproval,
    quote?.amount,
    quote?.rosterVersion,
    c.account,
    c.estimateAction,
  ]);
  const stateInvalid = Boolean(
    g &&
      c.snapshot &&
      ((kind === "join" &&
        (g.status !== 0 ||
          chainNow >= g.deadline ||
          g.members.filter((m) => m.active).length >= g.capacity ||
          g.members.some((m) => m.active && same(m.address, c.account)))) ||
        (kind === "leave" &&
          (g.funded ||
            g.status !== 0 ||
            chainNow >= g.deadline ||
            !member?.active)) ||
        (kind === "claim" && (!member || member.claimable === 0n)) ||
        (kind === "cancel" &&
          (g.status !== 0 ||
            chainNow >= g.deadline ||
            !same(g.organizer, c.account))) ||
        (kind === "withdraw" &&
          (!g.funded ||
            chainNow < g.deadline ||
            g.revenueWithdrawn > 0n ||
            !same(g.organizer, c.account) ||
            ![0, 3].includes(g.status))) ||
        (kind === "finalize" && (g.status !== 0 || chainNow < g.deadline))),
  );
  async function submit() {
    if (busy) return;
    setLocalError("");
    if (kind === "create" && request.create) {
      const errors = validateCreate(request.create, d.decimals);
      if (Object.keys(errors).length) {
        setLocalError(Object.values(errors).join("；"));
        return;
      }
    }
    setBusy(true);
    try {
      await c.execute({
        kind: needsApproval ? "approve" : kind,
        quote: quote || undefined,
        create: request.create,
      });
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : i18nText("操作未完成，请重新核对"),
      );
    } finally {
      setBusy(false);
      setConsent(false);
    }
  }
  async function retry() {
    c.clearTransaction();
    setConsent(false);
    setLocalError("");
    if (kind === "join") await updateQuote();
    else {
      setBusy(true);
      try {
        await c.refresh();
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : i18nText("读取失败"));
      } finally {
        setBusy(false);
      }
    }
  }
  const successText =
    tx?.kind === "join"
      ? i18nText("你的名额已确认。")
      : tx?.kind === "claim"
        ? i18nText("款项已领取到原付款钱包。")
        : tx?.kind === "leave"
          ? i18nText("已退出，预报名款已退回。")
          : tx?.kind === "cancel"
            ? i18nText("活动已取消，成员可领取剩余退款。")
            : tx?.kind === "withdraw"
                ? i18nText("固定本金已转入收款钱包。")
                : tx?.kind === "faucet"
                  ? i18nText("已领取 1,000 测试代币并核实到账。")
                : tx?.kind === "finalize"
                ? i18nText("截止状态已在链上确认。")
                : tx?.kind === "create"
                  ? i18nText("活动已发布，固定条款已生效。")
                  : tx?.kind === "revoke"
                    ? i18nText("剩余授权已撤销，未发生退款。")
                    : i18nText("授权完成，尚未报名。");
  return (
    <Modal
      title={warning ? i18nText("交易已上链，请人工核对收据") : activeTx || success || failure ? phases[phase] : titles[kind]}
      onClose={onClose}
    >
      {activeTx ? (
        <>
          <div className="transaction-state" role="status">
            <span className="status-symbol">
              {phase === "unknown" ? "?" : "…"}
            </span>
            <h3>{phases[phase]}</h3>
            <p>
              {phase === "unknown"
                ? i18nText("超时不等于失败。请查询原交易，不要再次付款。")
                : phase.includes("signature")
                  ? i18nText("在钱包中核对金额、网络和合约；拒绝签名不会获得报名资格。")
                  : i18nText("有交易哈希不等于已完成。正在等待收据并回读资格与资金账本。")}
            </p>
          </div>
          {tx && (
            <>
              <p className="fine">{i18nText("原动作：")}{titles[tx.kind]} {i18nText("· 原钱包")}</p>
              <AddressText value={tx.account} />
              {tx.hash ? (
                <>
                  <ExplorerLink deployment={d} hash={tx.hash}>
                    {i18nText("查看原交易")}
                  </ExplorerLink>
                  <AddressText value={tx.hash} />
                </>
              ) : (
                <Notice>
                  {i18nText("尚未取得交易哈希。可能已发送，请先查询钱包记录和链上状态。")}
                </Notice>
              )}
              {tx.message && <Notice>{tx.message}</Notice>}
              {c.pendingWarning && <Notice>{c.pendingWarning}</Notice>}
            </>
          )}
          {c.rpcStatus && (
            <p className="fine">
              {i18nText("读取节点：")}{c.rpcStatus.endpoints.filter((e) => e.ok).length}/
              {c.rpcStatus.endpoints.length} {i18nText("可用；读取失败会自动切换备用节点，\n              但不会自动重发任何交易。")}
            </p>
          )}
          <div className="manual-recovery">
            <label className="fine" htmlFor="manual-hash">
              {i18nText("已从钱包或浏览器记录找到原交易哈希？在此核对：")}
            </label>
            <input
              id="manual-hash"
              data-testid="manual-hash-input"
              value={manualHash}
              placeholder={i18nText("0x…（64 位十六进制）")}
              onChange={(event) => setManualHash(event.target.value.trim())}
            />
            <button
              className="secondary"
              data-testid="manual-hash-submit"
              disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(manualHash)}
              onClick={async () => {
                setBusy(true);
                try {
                  await c.recoverWithHash(manualHash);
                } catch (e) {
                  setLocalError(
                    e instanceof Error ? e.message : i18nText("哈希查询失败"),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {i18nText("按此哈希核实")}
            </button>
            <p className="fine">
              {i18nText("仅接受与原请求完全一致（同一链、同钱包、同合约、同数据与\n              nonce）的收据，不会重复提交交易。")}
            </p>
          </div>
          {!tx?.hash && !tx?.queryHash && (
            <div className="cancel-unbroadcast">
              <label className="consent">
                <input
                  type="checkbox"
                  data-testid="cancel-unbroadcast-check"
                  checked={cancelChecked}
                  onChange={(event) => setCancelChecked(event.target.checked)}
                />
                <span>
                  {i18nText("我已在钱包中确认这笔请求已取消，且未广播任何交易。")}
                </span>
              </label>
              <button
                className="secondary"
                data-testid="cancel-unbroadcast-submit"
                disabled={!cancelChecked || busy || tx?.nonce === undefined}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await c.markPendingCancelled();
                    setCancelChecked(false);
                  } catch (e) {
                    setLocalError(
                      e instanceof Error ? e.message : i18nText("无法标记为已取消"),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {i18nText("记录为“已取消、未广播”")}
              </button>
              <p className="fine">
                {i18nText("仅当链上与交易池都查不到该 nonce 时才会接受；有任何不确定，\n                请先用哈希查询。")}
              </p>
            </div>
          )}
          <div className="dialog-actions">
            <button className="secondary" onClick={onClose}>
              {i18nText("关闭，稍后查看")}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await c.recover();
                } catch (e) {
                  setLocalError(
                    e instanceof Error ? e.message : i18nText("原交易查询失败"),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {i18nText("查询原交易")}
            </button>
          </div>
        </>
      ) : success ? (
        <>
          <div
            className={`transaction-state ${approvalSuccess || warning ? "" : "confirmed"}`}
            role="status"
          >
            <span className="status-symbol">{warning ? "!" : approvalSuccess ? "1" : "✓"}</span>
            <h3>{warning ? i18nText("交易已确认，账本需人工核对。") : successText}</h3>
            {warning && <Notice>{tx.message}</Notice>}
            {tx?.amount && (
              <p>
                <Amount value={BigInt(tx.amount)} deployment={d} />
              </p>
            )}
          </div>
          {approvalSuccess ? (
            <>
              <Notice>
                {i18nText("仅授权了本次金额，尚未报名。下一步将重新读取报价，再次确认后才付款。")}
              </Notice>
              <button className="primary wide" disabled={busy} onClick={retry}>
                {i18nText("重新报价，核对报名付款")}
              </button>
            </>
          ) : (
            <>
              {!warning && tx?.kind === "join" && quote && (
                <Notice tone="good">
                  {i18nText("原成员新增可领差价：")}
                  {quote.deltas.length
                    ? quote.deltas
                        .map(
                          (delta) =>
                            `${short(delta.address)} +${exact(delta.amount, d.decimals)}`,
                        )
                        .join("；")
                    : i18nText("尚未产生")}{" "}
                  {d.symbol}{i18nText("。这些款项尚未转入他们的钱包。")}
                </Notice>
              )}
              {tx?.hash && (
                <ExplorerLink deployment={d} hash={tx.hash}>
                  {i18nText("查看这笔真实交易")}
                </ExplorerLink>
              )}
              {tx && ["join", "claim", "leave"].includes(tx.kind) && (
                <a
                  className="primary wide"
                  onClick={onClose}
                  href={destination(
                    `/g/${tx.groupId}/receipt/${tx.account}`,
                    d,
                  )}
                >
                  {i18nText("查看原钱包收据")}
                </a>
              )}
              {!warning && tx?.kind === "create" && (
                <a
                  className="primary wide"
                  onClick={onClose}
                  href={destination(`/g/${tx.groupId}`, d)}
                >
                  {i18nText("打开已发布活动")}
                </a>
              )}
              <button className="secondary wide" onClick={onClose}>
                {i18nText("返回页面")}
              </button>
            </>
          )}
        </>
      ) : failure ? (
        <>
          <Notice tone="danger" role="alert">
            {tx?.message ||
              (phase === "rejected"
                ? i18nText("你取消了签名，本次操作尚未完成。")
                : i18nText("合约未完成操作，状态已回滚。已上链的失败交易可能产生网络费。"))}
          </Notice>
          {c.allowance > 0n && (
            <p>{i18nText("授权可能仍存在。可返回活动或收据，使用“撤销剩余授权”。")}</p>
          )}
          {tx?.hash && (
            <ExplorerLink deployment={d} hash={tx.hash}>
              {i18nText("查看未完成交易")}
            </ExplorerLink>
          )}
          <div className="dialog-actions">
            <button className="secondary" onClick={onClose}>
              {i18nText("返回页面")}
            </button>
            <button className="primary" onClick={retry}>
              {i18nText("重新核对，不自动付款")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="stat-label">
            {kind === "create" ? request.create?.title : g?.metadata.title}
          </p>
          {amount !== undefined && (
            <Amount value={amount} deployment={d} large />
          )}
          {kind === "create" && request.create && (
            <div className="create-confirm">
              <p>{request.create.summary}</p>
              <dl className="rows">
                <div>
                  <dt>{i18nText("固定总价")}</dt>
                  <dd>
                    <Amount
                      value={parseUnits(request.create.cost, d.decimals)}
                      deployment={d}
                    />
                  </dd>
                </div>
                <div>
                  <dt>{i18nText("最低／最多")}</dt>
                  <dd>
                    {request.create.minParticipants} / {request.create.capacity}{" "}
                    {i18nText("人")}
                  </dd>
                </div>
                <div>
                  <dt>{i18nText("报名截止")}</dt>
                  <dd>
                    {date(
                      BigInt(
                        Math.floor(Date.parse(request.create.deadline) / 1000),
                      ),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{i18nText("活动开始")}</dt>
                  <dd>
                    {date(
                      BigInt(
                        Math.floor(Date.parse(request.create.startsAt) / 1000),
                      ),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{i18nText("活动地点")}</dt>
                  <dd>{request.create.publicLocation}</dd>
                </div>
                <div>
                  <dt>{i18nText("主办方显示名")}</dt>
                  <dd>{request.create.hostName}</dd>
                </div>
                <div>
                  <dt>{i18nText("固定收款地址")}</dt>
                  <dd>
                    <AddressText value={request.create.payoutAddress} />
                  </dd>
                </div>
              </dl>
              <p className="fine">
                {i18nText("所有时间显示于")} {timezone}{i18nText("，以 UNIX 秒上链。")}
              </p>
            </div>
          )}
          <dl className="rows">
            <div>
              <dt>{i18nText("环境／资产")}</dt>
              <dd>
                {d.name} · {d.symbol}
              </dd>
            </div>
            <div>
              <dt>{i18nText("规则／活动")}</dt>
              <dd>
                v1 · {kind === "create" ? i18nText("创建后生成活动编号") : `#${g?.id}`}
              </dd>
            </div>
            <div>
              <dt>{i18nText("平台费")}</dt>
              <dd>0 {d.symbol}</dd>
            </div>
            <div>
              <dt>{i18nText("网络手续费")}</dt>
              <dd>
                {fee
                  ? i18nText("预计 {0} {1}（估算值，以钱包实际执行为准）", formatEther(fee.total), d.local ? i18nText("本地 ETH") : "MON")
                  : i18nText("{0} · 暂无法估算，由钱包执行时决定", d.local ? i18nText("本地 ETH") : "MON")}
              </dd>
            </div>
            {c.connected && (
              <div>
                <dt>{i18nText("钱包资产余额")}</dt>
                <dd>
                  <Amount value={c.tokenBalance} deployment={d} />
                </dd>
              </div>
            )}
          </dl>
          <p className="fine">
            {kind === "withdraw" ? i18nText("固定收款钱包") : i18nText("本次操作钱包")}
          </p>
          <AddressText
            value={
              kind === "withdraw"
                ? g?.payoutAddress || ""
                : c.account || i18nText("尚未连接")
            }
          />
          <p className="fine">{i18nText("授权／调用的拼好团业务合约")}</p>
          <AddressText value={d.contract} />
          {kind === "join" && quote && (
            <>
              <div className="quote-message">
                <strong>{i18nText("加入后")} {quote.count + 1} {i18nText("人")}</strong>
                <p>
                  {i18nText("报价区块")} {quote.blockNumber.toString()} {i18nText("· 名单版本")}{" "}
                  {quote.rosterVersion.toString()}
                </p>
                <p>
                  {i18nText("报价有效至")} {date(quote.quoteExpiry)} · {timezone}{i18nText("，剩余")}{" "}
                  {Math.max(0, Number(quote.quoteExpiry - chainNow))} {i18nText("秒。")}
                </p>
                {quote.deltas.map((delta) => (
                  <p key={delta.address}>
                    {short(delta.address)} {i18nText("新增可领")}{" "}
                    {exact(delta.amount, d.decimals)} {d.symbol}
                  </p>
                ))}
              </div>
              {changed && (
                <Notice>
                  {i18nText("名单或金额变化：原报价")} {exact(oldQuote!.amount, d.decimals)} {i18nText("→\n                  新报价")} {exact(quote.amount, d.decimals)}
                  {i18nText("。即使金额降低，也需要重新确认。")}
                </Notice>
              )}
              {quoteInvalid && (
                <Notice role="alert">
                  {i18nText("报价已失效。先更新人数、金额与差价影响，再重新勾选确认。")}
                </Notice>
              )}
              <button
                className="secondary wide"
                disabled={busy}
                onClick={updateQuote}
              >
                {busy ? i18nText("正在读取报价…") : i18nText("更新并核对报价")}
              </button>
              <ol className="payment-steps">
                <li>
                  {c.allowance >= quote.amount
                    ? i18nText("授权额度已足够")
                    : i18nText("授权本次精确金额 {0}", exact(quote.amount, d.decimals))}
                </li>
                <li>{i18nText("授权后重新报价，确认报名付款")}</li>
              </ol>
            </>
          )}
          {kind === "leave" && (
            <Notice>
              {i18nText("若另一位成员先完成成团，退出交易将不再允许。成功退出时，退款与移除名额在同一笔交易完成。")}
            </Notice>
          )}
          {kind === "claim" && (
            <Notice>
              {g && c.snapshot && refundable(g, c.snapshot.timestamp)
                ? i18nText("取消或未成团的剩余退款，已退回部分已抵扣。")
                : i18nText("领取执行时的全部可领余额，最终金额可能因新成员加入而增加。")}{" "}
              {i18nText("只转入原付款钱包，不可选择其他收款地址。")}
            </Notice>
          )}
          {kind === "cancel" && (
            <Notice tone="danger">
              {i18nText("取消后不能恢复。所有参与者可领取剩余退款，你将无法领取本团本金。取消本身不会自动向成员转账。")}
            </Notice>
          )}
          {kind === "revoke" && (
            <Notice>
              {i18nText("将该资产对拼好团合约的授权额度设为\n              0。这是代币授权交易，不是退出或退款，需要")}{" "}
              {d.local ? i18nText("本地 ETH") : "MON"} {i18nText("手续费。")}
            </Notice>
          )}
          {kind === "withdraw" && (
            <Notice>
              {i18nText("仅收取固定本金，不会动用参与者未领取的差价。转入上方不可修改的收款钱包。")}
            </Notice>
          )}
          {!c.connected ? (
            <ConnectButton label={i18nText("连接钱包继续核对")} />
          ) : c.wrongNetwork ? (
            <button
              className="primary wide"
              onClick={() =>
                void c
                  .switchNetwork()
                  .catch((e) =>
                    setLocalError(
                      e instanceof Error ? e.message : i18nText("切网未完成"),
                    ),
                  )
              }
            >
              {i18nText("在钱包中切换到")} {d.name}
            </button>
          ) : (
            <>
              {mismatched && (
                <Notice tone="danger">
                  {i18nText("当前钱包与这笔动作的原钱包不匹配。请切回")} {actor}
                  {i18nText("，旧交易状态不会转给新地址。")}
                </Notice>
              )}
              {insufficient && (
                <Notice tone="danger">
                  {i18nText("资产余额不足，本次需")} {exact(amount!, d.decimals)}{i18nText("，钱包仅有")}{" "}
                  {exact(c.tokenBalance, d.decimals)} {d.symbol}
                  {i18nText("。请自行准备资产后刷新，不会代你入金。")}
                </Notice>
              )}
              {noGas && (
                <Notice>
                  {i18nText("钱包没有")} {d.local ? i18nText("本地 ETH") : "MON"}{" "}
                  {i18nText("网络手续费。请先准备手续费币，再刷新余额。")}
                </Notice>
              )}
              {dataBlocked && (
                <Notice>
                  {i18nText("最新快照不可用，当前不能发送交易。")}
                  <button
                    className="text-button"
                    onClick={() => void c.refresh()}
                  >
                    {i18nText("重新读取状态")}
                  </button>
                </Notice>
              )}
              {stateInvalid && (
                <Notice>
                  {i18nText("当前链上状态不允许此操作。请返回活动核对名额、退款余额与截止条件。")}
                </Notice>
              )}
              <label className="consent">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={consent}
                  onChange={(event) => {
                    setConsent(event.target.checked);
                    if (event.target.checked && kind === "join")
                      recordEvent("quote_confirmed", {
                        chainId: d.chainId,
                        groupId: c.snapshot?.group.id.toString(),
                      });
                  }}
                />
                <span>
                  {kind === "join"
                    ? i18nText("我已核对本次金额、钱包与差价影响；理解成团后不支持个人退团，报名截止后本金可支付给主办方，本工具不担保活动履约。")
                    : kind === "create"
                      ? i18nText("我已核对完整资料、金额、人数、时间及收款地址；理解这些公开条款发布后不可修改。")
                      : kind === "cancel"
                        ? i18nText("我确认取消全团，理解取消后不能恢复且我将无法领取本金。")
                        : i18nText("我已核对金额、网络与完整收款地址，理解本次操作及网络手续费。")}
                </span>
              </label>
              <button
                className={
                  kind === "cancel" ? "danger-button wide" : "primary wide"
                }
                disabled={
                  !consent ||
                  busy ||
                  Boolean(mismatched) ||
                  Boolean(insufficient) ||
                  noGas ||
                  Boolean(dataBlocked) ||
                  stateInvalid ||
                  Boolean(quoteInvalid)
                }
                onClick={submit}
              >
                {busy
                  ? i18nText("正在核对…")
                  : needsApproval
                    ? i18nText("第 1 步：授权本次金额")
                    : kind === "join"
                      ? i18nText("第 2 步：支付 {0} 并加入", quote ? exact(quote.amount, d.decimals) : "")
                      : kind === "cancel"
                        ? i18nText("确认取消这个团")
                        : kind === "create"
                          ? i18nText("确认条款并发布活动")
                          : titles[kind]}
              </button>
            </>
          )}
        </>
      )}
      {localError && (
        <Notice tone="danger" role="alert">
          {localError}
        </Notice>
      )}
      <p className="fine dialog-footnote">
        {i18nText("关闭只离开观察，不会取消已广播的交易。永远不需要向拼好团提供私钥或助记词。")}
      </p>
    </Modal>
  );
}
