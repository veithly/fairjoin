import { useEffect, useState, type FormEvent } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { isAddress, type Address } from "viem";
import { useAppController } from "./hooks/useAppController";
import type { ActionKind, CreateInput } from "./types";
import { Activity } from "./components/Activity";
import { Receipt } from "./components/Receipt";
import { Host } from "./components/Host";
import { GroupCatalog } from "./components/GroupCatalog";
import { Diagnostics, PendingWarning } from './components/Diagnostics';
import { recordEvent } from './lib/telemetry';
import { TestTokenFaucet } from "./components/Faucet";
import {
  TransactionDialog,
  type DialogRequest,
} from "./components/TransactionDialog";
import {
  AddressText,
  ExplorerLink,
  Modal,
  Notice,
  absoluteLink,
  destination,
  same,
} from "./components/shared";
import "./styles.css";
import './components/catalog.css';
import "./polish.css";
import {isEnglish, languageHref} from './lib/i18n';
import { i18nText } from "./lib/i18n";

function parseRoute(hash: string) {
  const [path = "/", query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  const match = /^\/g\/(\d+)(?:\/receipt\/(0x[a-fA-F0-9]{40}))?\/?$/.exec(path);
  if (match && (!match[2] || isAddress(match[2])))
    return {
      page: match[2] ? "receipt" : "activity",
      id: BigInt(match[1]),
      address: match[2] as Address | undefined,
      params,
    };
  if (path === "/host")
    return {
      page: "host",
      id: /^\d+$/.test(params.get("group") || "")
        ? BigInt(params.get("group")!)
        : null,
      address: undefined,
      params,
    };
  return {
    page: path === "/" || path === "" ? "home" : "missing",
    id: null,
    address: undefined,
    params,
  };
}
export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    document.title = i18nText("GPT Pro 20x 拼车 · FAIRJOIN");
    document.documentElement.lang = isEnglish() ? 'en' : 'zh-CN';
  }, []);
  const route = parseRoute(hash);
  const c = useAppController(route.id);
  const d = c.deployment;
  // FAIRJOIN_MAIN_CASE_REDIRECT: the deployed GPT Pro case is the first screen.
  useEffect(() => {
    if (d?.demoGroupId && (!hash || hash === "#/" || hash === "#")) {
      window.location.hash = destination(`/g/${d.demoGroupId}`, d);
    }
  }, [d, hash]);
  useEffect(()=>{recordEvent('page_view',{chainId:d?.chainId,groupId:route.id?.toString()});},[hash,d?.chainId]);
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [toast, setToast] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const [receiptPicker, setReceiptPicker] = useState(false);
  const [receiptAddress, setReceiptAddress] = useState("");
  const [lastGroup, setLastGroup] = useState<bigint | null>(route.id);
  useEffect(() => {
    const update = () => {
      setHash(window.location.hash);
      setRequest(null);
      setReceiptPicker(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (route.id !== null) setLastGroup(route.id);
  }, [route.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const mismatch = Boolean(
    d &&
      ((route.params.has("chainId") &&
        Number(route.params.get("chainId")) !== d.chainId) ||
        (route.params.has("contract") &&
          !same(route.params.get("contract") || "", d.contract))),
  );
  const selected = route.id ?? lastGroup;
  const demoReady = /^\d+$/.test(d?.demoGroupId ?? "");
  const hostHref = destination("/host", d);
  function openAction(kind: ActionKind) {
    if (c.pending) {
      setRequest({ kind: c.pending.kind, account: c.pending.account });
      return;
    }
    c.clearTransaction();
    setRequest({
      kind,
      account: route.page === "receipt" ? route.address : c.account,
    });
  }
  function create(value: CreateInput) {
    if (c.pending) {
      openAction(c.pending.kind);
      return;
    }
    c.clearTransaction();
    setRequest({ kind: "create", create: value, account: c.account });
  }
  async function share(receipt = false) {
    if (!d || route.id === null) return;
    const path =
      receipt && route.address
        ? `/g/${route.id}/receipt/${route.address}`
        : `/g/${route.id}`;
    const link = absoluteLink(path, d);
    try {
      await navigator.clipboard.writeText(link);
      setToast(i18nText("已复制公开链接，包含网络与合约身份。"));
    } catch {
      setCopyFallback(link);
    }
  }
  function openLink(event: FormEvent) {
    event.preventDefault();
    setLinkError("");
    let value = linkText.trim();
    if (/^\d+$/.test(value)) {
      window.location.hash = destination(`/g/${value}`, d);
      return;
    }
    try {
      if (!value.startsWith("#") && !value.startsWith("/"))
        value = new URL(value).hash;
      const parsed = parseRoute(value);
      if (parsed.page !== "activity" && parsed.page !== "receipt")
        throw Error();
      window.location.hash = value.startsWith("#") ? value : `#${value}`;
    } catch {
      setLinkError(i18nText("请输入有效的活动编号或拼好团分享链接，例如 #/g/0。"));
    }
  }
  function myReceipt() {
    if (selected === null) {
      setToast(i18nText("请先打开一个活动，再查看该团的个人收据。"));
      return;
    }
    if (c.account)
      window.location.hash = destination(
        `/g/${selected}/receipt/${c.account}`,
        d,
      );
    else {
      setReceiptAddress("");
      setReceiptPicker(true);
    }
  }
  const environment = !d
    ? i18nText("部署尚未连接 · 未读取活动与资产")
    : d.local
      ? i18nText("{0} · 本地开发链 · {1} 无真实价值", d.name, d.symbol)
      : d.chainId === 143
        ? i18nText("{0} · 主网真实资产，请核对风险", d.name)
        : i18nText("{0} · {1} 无真实价值", d.name, d.symbol);
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {i18nText("跳到主要内容")}
      </a>
      <div
        className={`environment ${d?.chainId === 143 && !d.local ? "live" : ""}`}
      >
        {environment}
      </div>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href={destination('/', d)}
            aria-label={i18nText("拼好团，查看全部活动")}
          >
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              {i18nText("拼好团")}<small>{i18nText("同价团 · 一起分摊")}</small>
            </span>
          </a>
          <nav aria-label={i18nText("产品页面")}>
            <a
              href={d && demoReady ? destination(`/g/${d.demoGroupId}`, d) : destination('/', d)}
              aria-current={route.page === "home" || route.page === "activity" ? "page" : undefined}
            >
              {i18nText("活动")}
            </a>
            <button
              onClick={myReceipt}
              aria-current={route.page === "receipt" ? "page" : undefined}
            >
              {i18nText("我的收据")}
            </button>
            <a
              href={hostHref}
              aria-current={route.page === "host" ? "page" : undefined}
            >
              {i18nText("主办方")}
            </a>
          </nav>
          <div className="wallet-control">
            <a className="language-switch" href={languageHref(isEnglish()?'zh':'en')} aria-label={isEnglish()?'Switch to Chinese':'Switch to English'}>{isEnglish()?'ZH':'EN'}</a>
            <ConnectButton
              label={i18nText("连接钱包")}
              chainStatus="icon"
              showBalance={false}
              accountStatus="address"
            />
          </div>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={`container ${route.page === "activity" ? "with-mobile-action" : ""}`}
      >
        <PendingWarning controller={c}/>
        {c.pending && (
          <Notice role="status">
            <strong>{i18nText("有一笔原交易需要继续核实。")}</strong> {i18nText("刷新不会重发交易。")}
            <button
              className="text-button"
              onClick={() => openAction(c.pending!.kind)}
            >
              {i18nText("查看并恢复原交易")}
            </button>
          </Notice>
        )}
        {c.wrongNetwork && (
          <Notice>
            {i18nText("钱包网络与本活动不同，当前仍可只读浏览。")}
            <button
              className="text-button"
              onClick={() =>
                void c
                  .switchNetwork()
                  .catch((error) =>
                    setToast(
                      error instanceof Error ? error.message : i18nText("切网未完成"),
                    ),
                  )
              }
            >
              {i18nText("切换到")} {d?.name}
            </button>
          </Notice>
        )}
        {c.error && (
          <Notice tone="danger" role="alert">
            {c.error}{" "}
            <button className="text-button" onClick={() => void c.refresh()}>
              {i18nText("重新读取状态")}
            </button>
          </Notice>
        )}
        {c.stale && c.snapshot && (
          <Notice>
            {i18nText("最新数据尚未同步，付款与退款操作暂停。最后同步：")}
            {new Date(c.snapshot.fetchedAt).toLocaleTimeString("zh-CN")}。
            <button className="text-button" onClick={() => void c.refresh()}>
              {i18nText("刷新链上快照")}
            </button>
          </Notice>
        )}
        {c.configurationError || !d ? (
          <section className="startup">
            <span className="brand-statement">{i18nText("固定总价，一起分摊。")}</span>
            <h1>{i18nText("先把真实活动接上。")}</h1>
            <p className="lead">
              {i18nText("后来的人加入，先来的人退差价。拼好团只展示可从合约重新读取的活动，不用模拟余额代替真实报名。")}
            </p>
            <Notice
              tone={c.configurationError ? "danger" : ""}
              role={c.configurationError ? "alert" : "status"}
            >
              {c.configurationError || i18nText("正在读取部署配置与验证网络，请稍候。")}
            </Notice>
            <p>
              {i18nText("运行环境需要有效的公开部署配置")} <code>public/deployment.json</code>
              {i18nText("，包含网络、业务合约与资产地址；不会在网页中请求或保存私钥。")}
            </p>
            <button
              className="secondary"
              onClick={() => window.location.reload()}
            >
              {i18nText("重新读取部署配置")}
            </button>
          </section>
        ) : mismatch ? (
          <section className="empty-state">
            <h1>{i18nText("链接环境不匹配。")}</h1>
            <Notice tone="danger">
              {i18nText("该链接指定的网络或合约不是当前部署。同一个活动编号在不同网络上并非同一个团，因此已停止加载与付款。")}
            </Notice>
            <p>
              {i18nText("当前网络：")}{d.name}（{d.chainId}）
            </p>
            <AddressText value={d.contract} />
            <p>{i18nText("请从可信主办方获取对应部署链接，不要仅删除网络参数继续付款。")}</p>
          </section>
        ) : route.page === "host" ? (
          <Host
            controller={c}
            selectedId={route.id}
            initialCreate={route.params.get('new') === '1'}
            selectGroup={(id) => {
              window.location.hash = `${destination("/host", d)}&group=${id}`;
            }}
            onCreate={create}
            onAction={openAction}
            onShare={() => void share()}
          />
        ) : route.page === "home" || route.page === "missing" ? (
          <section className="home-hero">
            <h1>
              {route.page === "missing" ? (
                i18nText("这条路径没有对应的活动。")
              ) : (
                <>
                  <span className="hero-line">{i18nText("GPT Pro 20x 拼车，")}</span>
                  <span className="hero-line">{i18nText("先上车也不多付。")}</span>
                </>
              )}
            </h1>
            {route.page === "home" && (
              <p className="lead">{i18nText("固定总价 200，四人各付 50；第五人付 40，先来的每人领回 10。")}</p>
            )}
            <p className="test-notice">
              {i18nText("测试网演示 · 使用无价值 FJUSD 测试币 · 不售卖账号或会员使用权")}
            </p>
            <div className="home-actions">
              {demoReady ? (
                <a
                  className="primary"
                  href={destination(`/g/${d.demoGroupId}`, d)}
                >
                  {i18nText("打开 GPT Pro 20x 拼车 →")}
                </a>
              ) : (
                <button className="primary" disabled>
                  {i18nText("示例团尚未配置")}
                </button>
              )}
              <a className="secondary" href={`${hostHref}&new=1`}>
                {i18nText("我是主办方，创建新团")}
              </a>
            </div>
            <GroupCatalog deployment={d} />
            <details className="utility-tools">
              <summary>{i18nText("实用工具")}</summary>
              <form className="open-group" onSubmit={openLink}>
                <label htmlFor="activity-link">{i18nText("活动链接或编号")}</label>
                <div>
                  <input
                    id="activity-link"
                    value={linkText}
                    onChange={(event) => setLinkText(event.target.value)}
                    placeholder={i18nText("粘贴活动分享链接或输入编号")}
                    required
                    aria-describedby="link-error"
                  />
                  <button className="secondary" type="submit">
                    {i18nText("打开活动 →")}
                  </button>
                </div>
                <p
                  id="link-error"
                  className="error-text"
                  role={linkError ? "alert" : undefined}
                >
                  {linkError}
                </p>
              </form>
              <TestTokenFaucet controller={c} />
              <details className="boundary-notice">
                <summary>{i18nText("资金、账号与额度边界")}</summary>
                <p><a className="text-button" href="https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers" target="_blank" rel="noreferrer">{i18nText("核对 OpenAI 官方 Pro 档位与使用限制 ↗")}</a></p>
                <p>
                  {i18nText("「GPT Pro 20x 拼车」是费用分摊演示，不是会员销售或共享账号服务。ChatGPT Pro 的 200 美元/月档位提供相对 Plus 的 20x 使用额度，不代表 20 个席位；OpenAI 不允许共享账号或转售访问权。本演示没有购买会员、取得厂商授权或交付账号。产品与 OpenAI 没有合作或代理关系。多人独立使用应选择适用的团队授权方案。价格及规则核对日期：2026-09-05。")}
                </p>
                <p>
                  {i18nText("链上资产为本项目发行的测试代币")} {d.symbol}{i18nText("，仅在 Monad 测试网\n                  10143 使用，无任何价值，也不是 Circle\n                  USDC。这里不是活动市场；公开浏览无需连接钱包，创建和付款才需要签名。")}
                </p>
              </details>
              <div className="home-links">
                <a href="/proof/settlement.json" target="_blank" rel="noreferrer">{i18nText("核对主活动创建与付款证据 ↗")}</a>
                <a href={`${hostHref}&new=1`}>{i18nText("用这套规则发起自己的团 →")}</a>
              </div>
            </details>
          </section>
        ) : c.snapshot && c.snapshot.group.id === route.id ? (
          route.page === "receipt" && route.address ? (
            <Receipt
              controller={c}
              address={route.address}
              onAction={openAction}
              onShare={() => void share(true)}
            />
          ) : (
            <Activity
              controller={c}
              onAction={openAction}
              onShare={() => void share()}
            />
          )
        ) : (
          <section className="empty-state" role="status">
            <h1>{c.loading ? i18nText("正在读取真实活动") : i18nText("活动暂时无法读取")}</h1>
            <p>
              {i18nText("活动 #")}{route.id?.toString()} · {d.name}
            </p>
            {c.loading ? (
              <div className="skeleton" />
            ) : (
              <>
                <p>{i18nText("请核对活动编号、网络与业务合约，或重新读取最新状态。")}</p>
                <button className="primary" onClick={() => void c.refresh()}>
                  {i18nText("重新读取活动")}
                </button>
              </>
            )}
          </section>
        )}
        <Diagnostics controller={c}/>
        <footer className="site-footer">
          <div>
            <strong>{i18nText("拼好团 · 规则 v1")}</strong>
            <p>{i18nText("固定总价 / 差价归你 / 非履约担保")}</p>
          </div>
          {d && (
            <div>
              <span>
                {d.name} · chainId {d.chainId}
              </span>
              <ExplorerLink deployment={d} address={d.contract}>
                {i18nText("核对业务合约")}
              </ExplorerLink>
              <details className="footer-chain-details">
                <summary>{i18nText("合约地址与数据快照")}</summary>
                <AddressText value={d.contract} />
                <p>
                  {i18nText("资产：")}{d.symbol} · {d.decimals} {i18nText("位精度")}
                </p>
                <AddressText value={d.token} />
                {c.snapshot && (
                  <p>
                    {i18nText("快照 #")}{c.snapshot.blockNumber.toString()} {i18nText("· 最后同步")}{" "}
                    {new Date(c.snapshot.fetchedAt).toLocaleString("zh-CN")}
                  </p>
                )}
              </details>
            </div>
          )}
        </footer>
      </main>
      {request && d && !mismatch && (
        <TransactionDialog
          controller={c}
          request={request}
          onClose={() => setRequest(null)}
        />
      )}
      {receiptPicker && (
        <Modal title={i18nText("打开公开收据")} onClose={() => setReceiptPicker(false)}>
          <p>{i18nText("输入原付款钱包地址即可公开查看，不需要连接或签名。")}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!isAddress(receiptAddress)) {
                setToast(i18nText("请输入完整有效的钱包地址"));
                return;
              }
              setReceiptPicker(false);
              window.location.hash = destination(
                `/g/${selected}/receipt/${receiptAddress}`,
                d,
              );
            }}
          >
            <label className="form-field">
              {i18nText("原付款钱包地址")}
              <input
                value={receiptAddress}
                onChange={(event) => setReceiptAddress(event.target.value)}
                placeholder="0x…"
                required
              />
            </label>
            <button className="primary wide" type="submit">
              {i18nText("读取公开收据")}
            </button>
          </form>
          <ConnectButton label={i18nText("或连接原付款钱包")} />
        </Modal>
      )}
      {copyFallback && (
        <Modal title={i18nText("复制公开链接")} onClose={() => setCopyFallback("")}>
          <p>{i18nText("浏览器未允许自动复制，请选择下方完整链接并复制。")}</p>
          <textarea
            className="copy-link"
            readOnly
            value={copyFallback}
            onFocus={(event) => event.target.select()}
            aria-label={i18nText("包含部署身份的完整分享链接")}
          />
          <button className="secondary" onClick={() => setCopyFallback("")}>
            {i18nText("完成")}
          </button>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
