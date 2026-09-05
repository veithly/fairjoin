import type { ActionKind, AppController } from "../types";
import { TestTokenFaucet } from './Faucet';
import {
  AddressText,
  Amount,
  DeadlineCountdown,
  Ledger,
  Notice,
  PriceSteps,
  Rules,
  Status,
  closed,
  date,
  destination,
  exact,
  refundable,
  same,
  short,
  timezone,
} from "./shared";
import { i18nText } from "../lib/i18n";

export type OpenAction = (kind: ActionKind) => void;
export function Activity({
  controller: c,
  onAction,
  onShare,
}: {
  controller: AppController;
  onAction: OpenAction;
  onShare: () => void;
}) {
  const s = c.snapshot!;
  const g = s.group;
  const d = c.deployment!;
  const members = g.members.filter((m) => m.active);
  const mine = g.members.find((m) => same(m.address, c.account));
  const isClosed = closed(g, s.timestamp);
  const refund = refundable(g, s.timestamp);
  const full = members.length >= g.capacity;
  const canJoin = !isClosed && !full && !mine?.active;
  const quote = c.quote;
  const blocked = c.stale || Boolean(c.error) || c.loading;
  const caption = mine?.claimable
    ? refund
      ? i18nText("现在可退回")
      : i18nText("现在可领差价")
    : mine?.active
      ? g.funded
        ? i18nText("我的当前应摊")
        : i18nText("我的预报名款")
      : !canJoin
        ? i18nText("报名已经结束")
        : g.funded
          ? i18nText("现在加入，实际支付")
          : i18nText("现在预报名");
  const amount = mine?.claimable
    ? mine.claimable
    : mine?.active
      ? mine.share
      : canJoin
        ? quote?.amount
        : undefined;
  const label = c.pending
    ? i18nText("查看待核实交易")
    : blocked
      ? i18nText("重新读取最新状态")
      : mine && (mine.active || mine.paid > 0n)
        ? mine.claimable > 0n
          ? refund
            ? i18nText("退回原钱包")
            : i18nText("领取我的差价")
          : i18nText("查看我的收据")
        : !canJoin
          ? full && !isClosed
            ? i18nText("名额已满")
            : i18nText("报名已结束")
          : quote
            ? g.funded
              ? i18nText("支付 {0} 并加入", exact(quote.amount, d.decimals))
              : i18nText("支付预报名款")
            : i18nText("正在核对报价");
  function primary() {
    if (c.pending) {
      onAction(c.pending.kind);
      return;
    }
    if (blocked) {
      void c.refresh();
      return;
    }
    if (mine && (mine.active || mine.paid > 0n)) {
      if (mine.claimable > 0n) onAction("claim");
      else
        window.location.hash = destination(
          `/g/${g.id}/receipt/${mine.address}`,
          d,
        );
      return;
    }
    onAction("join");
  }
  const disabled =
    !c.pending && !blocked && !mine?.paid && (!canJoin || !quote);
  const cta = (
    <button
      className={`primary wide ${mine?.claimable ? "refund-button" : ""}`}
      disabled={disabled}
      onClick={primary}
    >
      {label}
      <span aria-hidden="true">→</span>
    </button>
  );
  return (
    <>
      <div className="utility-actions"><a className="text-button" href={destination('/',d)}>{i18nText("← 查看其他拼团活动")}</a>{same(g.organizer,c.account)&&<a className="text-button" href={`${destination('/host',d)}&group=${g.id}`}>{i18nText("管理这个团 →")}</a>}</div>
      <div className="hero-grid">
        <div className="hero-main">
          <section className="hero-intro">
            <div className="intro-line">
              <span>{i18nText("固定总价 · 一起分摊")}</span>
              <Status snapshot={s} />
            </div>
            <h1>{g.metadata.title}</h1>
            {d.demoGroupId === String(g.id) && (
              <p className="lead">
                <span className="stat-label">{i18nText("页面解读 · 非链上原文")}</span>
                {i18nText("固定总价 200 的 GPT Pro 20x 拼车：新人上车，老成员少付。")}
              </p>
            )}
            <DeadlineCountdown snapshot={s}/>
            <details className="activity-details">
              <summary>{i18nText("活动详情")}</summary>
              <p className="lead">{g.metadata.summary}</p>
              <div className="meta">
                <span>
                  {i18nText("时间 ·")} {date(g.startsAt)} · {timezone}
                </span>
                <span>{i18nText("地点 ·")} {g.metadata.publicLocation}</span>
                <span>{i18nText("主办方 ·")} {g.metadata.hostName}</span>
              </div>
              <details className="host-identity">
                <summary>{i18nText("核对主办方钱包")} {short(g.organizer)}</summary>
                <AddressText value={g.organizer} />
                <p className="fine">{i18nText("显示名由主办方填写，不代表身份认证。")}</p>
              </details>
            </details>
            <div className="contract-line">
              <div>
                <span className="stat-label">{i18nText("固定活动总价")}</span>
                <strong>
                  <Amount value={g.cost} deployment={d} />
                </strong>
              </div>
              <div>
                <span className="stat-label">
                  {refund ? i18nText("终止时名单") : i18nText("当前人数")}
                </span>
                <strong>
                  {members.length}
                  <small> / {g.capacity} {i18nText("人")}</small>
                </strong>
              </div>
              <div>
                <span className="stat-label">{i18nText("最低成团人数")}</span>
                <strong>
                  {g.minimum}
                  <small> {i18nText("人")}</small>
                </strong>
              </div>
            </div>
          </section>
          <div className="mechanism-section">
            <section className="impact">
              <div className="impact-top">
                <div>
                  <h2>
                    {refund
                      ? i18nText("剩余款项，归原付款人。")
                      : !g.funded
                        ? i18nText("先报名，不用一个人承担总价。")
                        : canJoin && quote
                          ? i18nText("你加入，大家的应摊一起降低。")
                          : i18nText("这笔共同费用，按同一规则分摊。")}
                  </h2>
                  <p>
                    {refund
                      ? i18nText("已领取部分已抵扣，不会重复退钱。")
                      : !g.funded
                        ? i18nText("凑满 {0} 人开团；尚未成团且未截止，可个人退出。", g.minimum)
                        : canJoin && quote
                          ? i18nText("第 {0} 个名额，形成现有成员的新差价。", members.length + 1)
                          : i18nText("本金与每个人的可领取款项独立记账。")}
                  </p>
                </div>
                <strong className="impact-count">
                  {members.length}
                  <span> / </span>
                  {g.capacity}
                </strong>
              </div>
              {quote && canJoin && (
                <div className="impact-bottom">
                  {quote.deltas.length &&
                  quote.deltas.some((x) => x.amount > 0n) ? (
                    <>
                      <strong>{i18nText("加入后新增可领差价")}</strong>
                      <div className="delta-list">
                        {quote.deltas.map((x) => (
                          <span key={x.address}>
                            {short(x.address)}{" "}
                            <b>+{exact(x.amount, d.decimals)}</b>
                          </span>
                        ))}
                      </div>
                      <small>{d.symbol} {i18nText("· 产生领取权，不是已经到账")}</small>
                    </>
                  ) : (
                    <span>
                      {i18nText("本次预报名不承诺已产生差价，成团时按整数规则核对。")}
                    </span>
                  )}
                </div>
              )}
            </section>
            <details className="activity-details">
              <summary>{i18nText("价格演算 · 各人数下的应摊")}</summary>
              <PriceSteps
                cost={g.cost}
                minimum={g.minimum}
                capacity={g.capacity}
                count={g.funded ? members.length : undefined}
                decimals={d.decimals}
                symbol={d.symbol}
              />
            </details>
            <section className="members-section">
              <div className="section-head">
                <h2>
                  {refund
                    ? i18nText("保留名单与退款权利")
                    : i18nText("每一个名额，都有一笔明白账。")}
                </h2>
                <span className="fine">
                  {members.length} / {g.capacity} {i18nText("人")}
                </span>
              </div>
              <p className="member-empty-summary">
                {i18nText("已上车")} {members.length} {i18nText("人")}
                {members.length < g.capacity &&
                  i18nText(" · {0} {1} 个名额", isClosed ? i18nText("未使用名额") : i18nText("还剩"), g.capacity - members.length)}
              </p>
              <details className="activity-details">
                <summary>{i18nText("完整成员名单")}</summary>
                <div className="members">
                  {members.map((m, index) => (
                    <a
                      className={`member ${same(m.address, c.account) ? "mine" : ""}`}
                      href={destination(`/g/${g.id}/receipt/${m.address}`, d)}
                      key={m.address}
                    >
                      <div className="member-title">
                        <span className="seat-number">{index + 1}</span>
                        <span>
                          {short(m.address)}
                          {same(m.address, c.account) ? i18nText(" · 你") : ""}
                        </span>
                      </div>
                      <strong>{exact(m.share, d.decimals)}</strong>
                      <span className="fine">
                        {refund
                          ? i18nText("活动应摊")
                          : g.funded
                            ? i18nText("当前应摊")
                            : i18nText("预报名款")}
                      </span>
                      <span className={m.claimable > 0n ? "positive" : "fine"}>
                        {m.claimable > 0n
                          ? i18nText("可领取 {0}", exact(m.claimable, d.decimals))
                          : i18nText("暂无可领余额")}
                      </span>
                    </a>
                  ))}
                </div>
                <p className="fine">
                  {d.symbol} {i18nText("· 地址为真实链上名单，点击查看公开收据。")}
                </p>
              </details>
            </section>
            <section className="money-location" data-testid="money-ledger">
              <h2>{i18nText("钱在哪里？")}</h2>
              <dl className="rows">
                <div>
                  <dt>
                    {g.funded
                      ? g.status === 3
                        ? i18nText("主办方待收本金")
                        : i18nText("固定本金储备")
                      : i18nText("预报名池")}
                  </dt>
                  <dd>
                    <Amount value={g.reserve} deployment={d} />
                  </dd>
                </div>
                <div>
                  <dt>{i18nText("参与者可领款项")}</dt>
                  <dd className="positive">
                    <Amount value={g.totalClaimable} deployment={d} />
                  </dd>
                </div>
                <div>
                  <dt>{i18nText("主办方已收到")}</dt>
                  <dd>
                    <Amount value={g.revenueWithdrawn} deployment={d} />
                  </dd>
                </div>
                <div>
                  <dt>{i18nText("团内记账余额")}</dt>
                  <dd>
                    <Amount value={g.balance} deployment={d} />
                  </dd>
                </div>
              </dl>
              <p className="fine">
                {g.revenueWithdrawn > 0n
                  ? i18nText("本金已经转出，未领取差价仍保留在合约中。")
                  : refund
                    ? i18nText("活动已经终止，本金不再属于主办方；原成员可领取剩余退款。")
                    : g.status === 3
                      ? i18nText("结算已确认，本金尚未转到主办方收款钱包。")
                      : i18nText("本金保留到报名截止，满员不会提前释放。")}{" "}
                {i18nText("报名截止：")}{date(g.deadline)} · {timezone}。
              </p>
              {g.status === 0 && s.timestamp >= g.deadline && (
                <button
                  className="secondary"
                  disabled={blocked || Boolean(c.pending)}
                  onClick={() => onAction("finalize")}
                >
                  {g.funded ? i18nText("确认截止结算") : i18nText("确认未成团状态")}
                </button>
              )}
            </section>
            <details className="activity-details">
              <summary>{i18nText("活动规则")}</summary>
              <Rules />
            </details>
            <details className="activity-details">
              <summary>{i18nText("公开账本")}</summary>
              <Ledger snapshot={s} deployment={d} />
            </details>
          </div>
        </div>
        <aside className="payment-card">
          <span className="paper-mark" aria-hidden="true" />
          <p className="stat-label">{caption}</p>
          {amount !== undefined ? (
            <Amount value={amount} deployment={d} large />
          ) : (
            <p className="quote-unavailable">
              {canJoin ? i18nText("正在读取真实报价") : i18nText("不再接受付款")}
            </p>
          )}
          <div className="quote-message">
            {mine?.claimable ? (
              i18nText("这笔钱已经归你，但尚未转入钱包。领取不需要主办方批准。")
            ) : canJoin ? (
              <>
                {g.funded
                  ? i18nText("加入后共 {0} 人。", members.length + 1)
                  : i18nText("还差 {0} 人成团。", g.minimum - members.length)}
                <br />
                {i18nText("实际扣款按本次确认报价，不使用满员参考价。")}
              </>
            ) : (
              i18nText("你仍可浏览公开账本与历史收据。")
            )}
          </div>
          {cta}
          <button className="text-button wide" onClick={onShare}>
            {i18nText("复制活动链接")}
          </button>
          <p className="payment-note">
            {i18nText("平台费 0 ·")} {d.local ? i18nText("本地 ETH") : "MON"}{" "}
            {i18nText("网络手续费另计。点击不会锁定名额，实际结果以链上执行为准。")}
          </p>
          <div className="critical">
            <strong>{i18nText("成团后不支持个人退团。")}</strong>
            <br />
            {i18nText("报名截止后本金可支付给主办方；本工具不担保活动履约。")}
          </div>
          {mine?.active && !g.funded && !isClosed && (
            <button
              className="text-button"
              disabled={blocked || Boolean(c.pending)}
              onClick={() => onAction("leave")}
            >
              {i18nText("成团前退出并退款")}
            </button>
          )}
          {c.allowance > 0n && (
            <button
              className="text-button"
              disabled={Boolean(c.pending)}
              onClick={() => onAction("revoke")}
            >
              {i18nText("查看并撤销剩余额度")}
            </button>
          )}
          {c.stale && <Notice>{i18nText("快照已过期，付款已停用。请重新读取。")}</Notice>}
          {(!c.connected || c.tokenBalance === 0n) && <details className="inline-help"><summary>{i18nText("准备测试币和 MON")}</summary><TestTokenFaucet controller={c}/></details>}
        </aside>
      </div>
      <div className="mobile-action">
        <div>
          <small>{caption}</small>
          {amount !== undefined && (
            <span>
              {exact(amount, d.decimals)} <small>{d.symbol}</small>
            </span>
          )}
        </div>
        {cta}
      </div>
    </>
  );
}
