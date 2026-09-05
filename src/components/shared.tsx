import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUnits } from "viem";
import type { Deployment, Group, Snapshot, ChainEvent } from "../types";
import { i18nText } from "../lib/i18n";

export const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
export const same = (a?: string, b?: string) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
export function exact(value: bigint, decimals = 6) {
  const text = formatUnits(value, decimals);
  return text.includes(".") ? text : `${text}.00`;
}
export function Amount({
  value,
  deployment,
  large = false,
}: {
  value: bigint;
  deployment: Deployment;
  large?: boolean;
}) {
  return (
    <span className={large ? "amount amount-large" : "amount"}>
      {value > 0n && value < 10n ** BigInt(Math.max(0, deployment.decimals - 2)) && !large ? <span title={i18nText("精确值 {0}", exact(value, deployment.decimals))}>＜ 0.01 <small>（{exact(value, deployment.decimals)}）</small></span> : exact(value, deployment.decimals)} <small>{deployment.symbol}</small>
    </span>
  );
}
export function date(value: bigint) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(value) * 1000));
}
export const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export function closed(group: Group, timestamp: bigint) {
  return group.status !== 0 || timestamp >= group.deadline;
}
export function refundable(group: Group, timestamp: bigint) {
  return (
    group.status === 1 ||
    group.status === 2 ||
    (!group.funded && timestamp >= group.deadline)
  );
}
export function stateLabel(group: Group, timestamp: bigint) {
  if (group.status === 1) return i18nText("已取消 · 可退回剩余款");
  if (refundable(group, timestamp)) return i18nText("未成团 · 可退款");
  if (group.status === 3) return i18nText("已结算");
  if (timestamp >= group.deadline) return i18nText("报名截止 · 待结算");
  if (group.members.filter((m) => m.active).length >= group.capacity)
    return i18nText("已满员 · 等待截止");
  if (group.funded) return i18nText("已成团 · 继续报名");
  return i18nText("预报名中 · 还差 {0} 人", group.minimum - group.members.filter((m) => m.active).length);
}
export function Status({ snapshot }: { snapshot: Snapshot }) {
  const { group, timestamp } = snapshot;
  return (
    <span
      className={`badge ${refundable(group, timestamp) || !group.funded ? "warning" : "positive"}`}
    >
      {stateLabel(group, timestamp)}
    </span>
  );
}
export function destination(path: string, deployment?: Deployment | null) {
  return `#${path}${deployment ? `?chainId=${deployment.chainId}&contract=${deployment.contract}` : ""}`;
}
export function absoluteLink(path: string, deployment: Deployment) {
  const url = new URL(window.location.href);
  url.hash = destination(path, deployment).slice(1);
  return url.toString();
}
export function exportJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          data,
          (_, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AddressText({ value }: { value: string }) {
  const ref = useRef<HTMLElement>(null); const [notice, setNotice] = useState('');
  async function copy() { try { await navigator.clipboard.writeText(value); setNotice(i18nText('已复制')); } catch { const range = document.createRange(); if(ref.current){range.selectNodeContents(ref.current);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);} setNotice(i18nText('请复制选中的完整内容')); } }
  return <span className="address-block"><code ref={ref} className="address">{value}</code>{/^0x[0-9a-f]+$/i.test(value)&&<button type="button" className="copy-address" onClick={()=>void copy()} aria-label={i18nText("复制 {0}", value)}>{i18nText("复制")}</button>}<span className="copy-feedback" role="status">{notice}</span></span>;
}
export function DeadlineCountdown({snapshot}:{snapshot:Snapshot}) {const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);const seconds=Number(snapshot.group.deadline-snapshot.timestamp)-Math.floor((now-snapshot.fetchedAt)/1000);if(snapshot.group.status!==0)return null;const d=Math.floor(Math.max(0,seconds)/86400),h=Math.floor(Math.max(0,seconds)%86400/3600),m=Math.floor(Math.max(0,seconds)%3600/60),s=Math.max(0,seconds)%60;return <p className="deadline-inline">{seconds>0?i18nText("预计报名剩余 {0}{1}时 {2}分 {3}秒", d?d+i18nText('天 '):'', h, m, s):i18nText('报名时间已到，正在核对截止状态')} {i18nText("· 以交易执行时的链上时间为准")}</p>}
export function exportLedger(snapshot:Snapshot,deployment:Deployment) {exportJson(`FAIRJOIN_${deployment.chainId}_${snapshot.group.id}_ledger.json`,{product:'FAIRJOIN',schemaVersion:1,source:'contract reads at snapshotBlock',warning:'Export is editable; use these identifiers to verify on chain. Test tokens have no monetary value.',chainId:deployment.chainId,contract:deployment.contract,token:deployment.token,decimals:deployment.decimals,symbol:deployment.symbol,snapshotBlock:snapshot.blockNumber,snapshotTimestamp:snapshot.timestamp,eventsCompleteTo:snapshot.eventsCompleteTo,group:snapshot.group,events:snapshot.events});}
export function exportLedgerCsv(snapshot:Snapshot,deployment:Deployment) {const cell=(v:unknown)=>'"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const rows=[['chainId','groupId','wallet','paidRaw','returnedRaw','shareRaw','claimableRaw','decimals','token','snapshotBlock'],...snapshot.group.members.map(m=>[deployment.chainId,snapshot.group.id,m.address,m.paid,m.returned,m.share,m.claimable,deployment.decimals,deployment.token,snapshot.blockNumber])];const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`FAIRJOIN_${snapshot.group.id}_ledger.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function Notice({
  children,
  tone = "",
  role,
}: {
  children: ReactNode;
  tone?: string;
  role?: "alert" | "status";
}) {
  return (
    <div className={`notice ${tone}`} role={role}>
      {children}
    </div>
  );
}
export function ExplorerLink({
  deployment,
  hash,
  address,
  children,
}: {
  deployment: Deployment;
  hash?: string;
  address?: string;
  children: ReactNode;
}) {
  if (!/^https?:\/\//.test(deployment.explorerUrl))
    return <span className="fine">{children} {i18nText("· 本地链无区块浏览器")}</span>;
  return (
    <a
      href={`${deployment.explorerUrl.replace(/\/$/, "")}/${hash ? "tx" : "address"}/${hash || address}`}
      target="_blank"
      rel="noreferrer"
    >
      {children} ↗
    </a>
  );
}
export function Rules() {
  return (
    <section className="rules" id="rules">
      <h2>{i18nText("先把规则说清楚。")}</h2>
      <div className="rule-list">
        <div>
          <h3>{i18nText("成团前，可以退出")}</h3>
          <p>
            {i18nText("未到报名截止且尚未成团，可退出并退回预报名款。截止未成团，剩余款项可退回原钱包。")}
          </p>
        </div>
        <div>
          <h3>{i18nText("成团后，共同分摊")}</h3>
          <p>
            {i18nText("成团后不支持个人退团。后来的人加入，先来的人产生可领差价，需要主动领取才转入钱包。")}
          </p>
        </div>
        <div>
          <h3>{i18nText("截止后，本金可以支付")}</h3>
          <p>
            {i18nText("报名截止后，主办方可领取固定本金；本工具不担保活动履约。活动开始不等于结算条件。")}
          </p>
        </div>
      </div>
      <details>
        <summary>{i18nText("展开完整分摊与资金规则")}</summary>
        <p>
          {i18nText("固定总价、人数、时间、收款地址和活动资料发布后不可修改。每个钱包最多占一个有效名额，不代表唯一自然人。按同一规则均分，前余数个名额多承担一个最小单位，差额不归平台。网络手续费另计，平台费为\n          0。")}
        </p>
        <p>
          {i18nText("截止前主办方可取消全团，成员领取剩余退款，已领金额不重复退回。取消或未成团退款没有领取期限；链、代币冻结、钱包密钥和网络可用性仍可能影响访问。报名、退出与取消以实际交易执行时的链上时间和顺序为准。")}
        </p>
        <p>
          {i18nText("不要直接向合约转账，直接转入不会获得名额。参与地址与资金记录公开可查，缩略地址不代表匿名。请自行判断主办方的履约能力。")}
        </p>
      </details>
    </section>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="close-button"
          onClick={onClose}
          aria-label={i18nText("关闭对话框")}
          autoFocus
        >
          ×
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function PriceSteps({
  cost,
  minimum,
  capacity,
  count,
  decimals,
  symbol,
}: {
  cost: bigint;
  minimum: number;
  capacity: number;
  count?: number;
  decimals: number;
  symbol: string;
}) {
  return (
    <section className="price-section">
      <h2>{i18nText("总价不变，人数一起分。")}</h2>
      <div className="steps">
        {Array.from(
          { length: capacity - minimum + 1 },
          (_, index) => minimum + index,
        ).map((n) => (
          <div
            key={n}
            className={`price-step ${count === n ? "current" : count !== undefined && n === Math.max(minimum, count + 1) ? "projected" : ""}`}
          >
            <span>{n} {i18nText("人共同分摊")}</span>
            <strong>{exact(cost / BigInt(n), decimals)}</strong>
            <small>
              {count === n
                ? i18nText("当前人数")
                : n === capacity
                  ? i18nText("满员参考价")
                  : i18nText("人数预测")}
            </small>
          </div>
        ))}
      </div>
      <p className="fine">
        {symbol} {i18nText("·\n        显示整除基础值，前余数个名额多承担一个最小单位。最终人数不保证，网络费另计。")}
      </p>
    </section>
  );
}
export function Ledger({
  snapshot,
  deployment,
}: {
  snapshot: Snapshot;
  deployment: Deployment;
}) {
  const g = snapshot.group;
  return (
    <details className="ledger">
      <summary>{i18nText("公开账本 · 区块")} {snapshot.blockNumber.toString()}</summary>
      <div className="utility-actions"><button type="button" className="secondary" onClick={()=>exportLedger(snapshot,deployment)}>{i18nText("导出完整账本 JSON")}</button><button type="button" className="secondary" onClick={()=>exportLedgerCsv(snapshot,deployment)}>{i18nText("导出账本 CSV")}</button></div>
      <div
        className="table-wrap"
        tabIndex={0}
        aria-label={i18nText("成员账本，可横向滚动")}
      >
        <table>
          <thead>
            <tr>
              <th>{i18nText("成员钱包")}</th>
              <th>{i18nText("累计支付")}</th>
              <th>{i18nText("已退回")}</th>
              <th>{refundable(g,snapshot.timestamp) ? i18nText("活动应摊（已终止）") : g.funded ? i18nText("当前应摊") : i18nText("预报名款")}</th>
              <th>{i18nText("可领取")}</th>
            </tr>
          </thead>
          <tbody>
            {g.members.map((m) => (
              <tr key={m.address}>
                <td>
                  <a
                    href={destination(
                      `/g/${g.id}/receipt/${m.address}`,
                      deployment,
                    )}
                  >
                    {short(m.address)}
                  </a>
                  {!m.active && i18nText("（已退出）")}
                </td>
                <td>{exact(m.paid, deployment.decimals)}</td>
                <td>{exact(m.returned, deployment.decimals)}</td>
                <td>{exact(m.share, deployment.decimals)}</td>
                <td className="positive">
                  {exact(m.claimable, deployment.decimals)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">
        {i18nText("单位：")}{deployment.symbol}{i18nText("。团内余额")}{" "}
        {exact(g.balance, deployment.decimals)} {i18nText("= 本金储备／待收本金")}{" "}
        {exact(g.reserve, deployment.decimals)} {i18nText("+ 可领款项")}{" "}
        {exact(g.totalClaimable, deployment.decimals)}
        {i18nText("。退出地址的完整记录也可按收据地址直接查询。")}
      </p>
    </details>
  );
}
const eventLabels: Record<string, string> = {
  GroupCreated: i18nText("活动创建"),
  Joined: i18nText("报名付款"),
  LeftBeforeFunded: i18nText("退出并退回预报名款"),
  FundingReached: i18nText("达到成团人数"),
  PriceUpdated: i18nText("差价权利变化（尚未转账）"),
  Claimed: i18nText("实际领取"),
  Cancelled: i18nText("活动取消"),
  Finalized: i18nText("截止结算"),
  OrganizerPaid: i18nText("主办方本金转出"),
};
export function Timeline({
  events,
  deployment,
  incompleteTo,
}: {
  events: ChainEvent[];
  deployment: Deployment;
  incompleteTo?: bigint;
}) {
  return (
    <section className="timeline">
      <h2>{i18nText("链上记录")}</h2>
      {incompleteTo !== undefined && (
        <p className="error-text" role="status">
          {i18nText("事件历史仅同步到区块")} {incompleteTo.toString()}{i18nText("，之后的记录暂时缺失；余额与资格以合约快照为准。")}
        </p>
      )}
      {events.length ? (
        [...events].reverse().map((e) => (
          <article className="timeline-item" key={`${e.hash}:${e.logIndex}`}>
            <div>
              <strong>{e.name === 'Claimed' ? (e.refundKind === 1 ? i18nText('取消退款已领取') : e.refundKind === 2 ? i18nText('未成团退款已领取') : i18nText('差价已领取')) : e.name === 'Finalized' ? (e.status === 2 ? i18nText('到期未成团已确认') : i18nText('截止结算已确认')) : eventLabels[e.name] || e.name}</strong>
              {e.amount !== undefined && e.amount > 0n && (
                <span>
                  {" "}
                  · <Amount value={e.amount} deployment={deployment} />
                </span>
              )}
              <p className="fine">
                {i18nText("区块")} {e.blockNumber.toString()} {i18nText("· 交易序号")} {e.transactionIndex}{" "}
                {i18nText("· 事件")} {e.logIndex}
              </p>
              {e.name === 'OrganizerPaid' && e.payoutAddress && <p className="fine">{i18nText("本金实际收款地址")} <AddressText value={e.payoutAddress}/></p>}
              <ExplorerLink deployment={deployment} hash={e.hash}>
                {i18nText("查看交易")} {short(e.hash)}
              </ExplorerLink>
            </div>
          </article>
        ))
      ) : (
        <p className="fine">{i18nText("当前读取范围没有记录。余额与资格以合约快照为准。")}</p>
      )}
      <p className="fine">
        {i18nText("差价权利变化不是钱包到账；只有实际领取记录表示退款转账。")}
      </p>
    </section>
  );
}
