import { useEffect, useState, type FormEvent } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { isAddress, parseUnits, zeroAddress } from "viem";
import type { AppController, CreateInput } from "../types";
import type { OpenAction } from "./Activity";
import { HostGroupList } from './GroupCatalog';
import {
  AddressText,
  Amount,
  Ledger,
  Notice,
  PriceSteps,
  Status,
  date,
  destination,
  exact,
  exportJson,
  exportLedger,
  refundable,
  same,
  timezone,
} from "./shared";
import { i18nText } from "../lib/i18n";
const emptyDraft: CreateInput = {
  title: i18nText("GPT Pro 20x 拼车"),
  summary:
    i18nText("GPT Pro 20x 费用分摊演示：固定总价 200 FJUSD，后来加入，先来的人领差价。FJUSD 为无价值测试币；不购买或提供会员，不共享个人账号、密码或额度。"),
  hostName: "",
  publicLocation: "",
  cost: "200",
  minParticipants: 4,
  capacity: 8,
  deadline: "",
  startsAt: "",
  payoutAddress: "",
};
export function validateCreate(
  value: CreateInput,
  decimals: number,
  contract?: string,
): Partial<Record<keyof CreateInput, string>> {
  const errors: Partial<Record<keyof CreateInput, string>> = {};
  if (!value.title.trim() || Array.from(value.title).length > 60)
    errors.title = i18nText("请输入 1—60 字的活动名称");
  if (!value.summary.trim() || Array.from(value.summary).length > 240)
    errors.summary = i18nText("请输入 1—240 字的活动简述");
  if (!value.hostName.trim()) errors.hostName = i18nText("请输入主办方显示名");
  if (!value.publicLocation.trim())
    errors.publicLocation = i18nText("请输入活动形式或公开地点");
  try {
    if (
      !new RegExp(`^\\d+(\\.\\d{1,${Math.min(6, decimals)}})?$`).test(
        value.cost,
      )
    )
      throw Error();
    const amount = parseUnits(value.cost, decimals);
    if (
      amount < 10n ** BigInt(decimals) ||
      amount > 1000n * 10n ** BigInt(decimals)
    )
      throw Error();
  } catch {
    errors.cost = i18nText("总价须在 1—1,000 之间，最多 6 位小数");
  }
  if (
    !Number.isInteger(value.minParticipants) ||
    value.minParticipants < 2 ||
    value.minParticipants > 12
  )
    errors.minParticipants = i18nText("最低人数须为 2—12 的整数");
  if (
    !Number.isInteger(value.capacity) ||
    value.capacity < value.minParticipants ||
    value.capacity > 12
  )
    errors.capacity = i18nText("人数上限不能小于最低人数，且最多 12 人");
  const deadline = Date.parse(value.deadline);
  const start = Date.parse(value.startsAt);
  if (!Number.isFinite(deadline) || deadline < Date.now() + 600000)
    errors.deadline = i18nText("截止须至少晚于当前时间 10 分钟");
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(deadline) ||
    start < deadline + 1800000
  )
    errors.startsAt = i18nText("活动开始须晚于截止至少 30 分钟");
  if (
    !isAddress(value.payoutAddress) ||
    value.payoutAddress.toLowerCase() === zeroAddress ||
    Boolean(contract && same(value.payoutAddress, contract))
  )
    errors.payoutAddress = i18nText("请输入有效非零收款地址，发布后不能修改");
  if (
    new TextEncoder().encode(
      JSON.stringify({
        title: value.title,
        summary: value.summary,
        hostName: value.hostName,
        publicLocation: value.publicLocation,
      }),
    ).byteLength > 2048
  )
    errors.summary = i18nText("公开活动信息超过 2,048 UTF-8 字节，请缩短");
  return errors;
}
export function Host({
  controller: c,
  selectedId,
  initialCreate = false,
  selectGroup,
  onCreate,
  onAction,
  onShare,
}: {
  controller: AppController;
  selectedId: bigint | null;
  initialCreate?: boolean;
  selectGroup: (id: bigint) => void;
  onCreate: (value: CreateInput) => void;
  onAction: OpenAction;
  onShare: () => void;
}) {
  const [tab, setTab] = useState<"list" | "create" | "manage">(
    initialCreate ? 'create' : selectedId !== null ? "manage" : "list",
  );
  useEffect(() => { if (initialCreate) setTab('create'); else if (selectedId !== null) setTab('manage'); }, [selectedId, initialCreate]);
  const [draft, setDraft] = useState<CreateInput>(emptyDraft);
  const [errors, setErrors] = useState<
    Partial<Record<keyof CreateInput, string>>
  >({});
  const [storageMessage, setStorageMessage] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const d = c.deployment!;
  const key = `pinhaotuan:draft:${d.chainId}:${d.contract.toLowerCase()}:${c.account?.toLowerCase() || "visitor"}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          Object.keys(emptyDraft).some(
            (field) =>
              typeof parsed[field] !==
              typeof emptyDraft[field as keyof CreateInput],
          )
        )
          throw Error();
        setDraft(parsed);
      } else {
        const visitorKey = `pinhaotuan:draft:${d.chainId}:${d.contract.toLowerCase()}:visitor`;
        const visitor = c.account && loadedKey === visitorKey ? localStorage.getItem(visitorKey) : null;
        const carried = visitor ? JSON.parse(visitor) : emptyDraft;
        if(Object.keys(emptyDraft).some(field=>typeof carried[field]!==typeof emptyDraft[field as keyof CreateInput])) throw Error('Invalid draft');
        setDraft({ ...carried, payoutAddress: carried.payoutAddress || c.account || '' });
      }
      setStorageMessage(i18nText("草稿仅保存在此浏览器，尚未发布。"));
    } catch {
      setDraft({ ...emptyDraft, payoutAddress: c.account || "" });
      setStorageMessage(i18nText("本地草稿无法恢复，未发布链上活动。请重新填写。"));
    }
    setLoadedKey(key);
  }, [key, c.account]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try {
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      setStorageMessage(
        i18nText("浏览器无法保存草稿。请不要关闭页面，链上发布不受影响。"),
      );
    }
  }, [draft, key, loadedKey]);
  useEffect(() => {
    if (c.connected) void c.loadOrganizerGroups();
  }, [c.connected, c.account]);
  let previewCost: bigint | null = null;
  try {
    if (/^\d+(\.\d{1,6})?$/.test(draft.cost))
      previewCost = parseUnits(draft.cost, d.decimals);
  } catch {
    /* Invalid drafts remain editable. */
  }
  const validPreview =
    previewCost !== null &&
    Number.isInteger(draft.minParticipants) &&
    Number.isInteger(draft.capacity) &&
    draft.minParticipants >= 2 &&
    draft.capacity >= draft.minParticipants &&
    draft.capacity <= 12;
  function update(field: keyof CreateInput, value: string) {
    setDraft((old) => ({
      ...old,
      [field]:
        field === "capacity" || field === "minParticipants"
          ? Number(value)
          : value,
    }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateCreate(draft, d.decimals, d.contract);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`field-${first}`)?.focus();
      return;
    }
    onCreate({ ...draft });
  }
  const templates = [{name:'GPT Pro 20x',title:i18nText('GPT Pro 20x 拼车'),cost:'200',min:4,cap:8},{name:'Claude Max 20x',title:i18nText('Claude Max 20x 拼车'),cost:'200',min:4,cap:8},{name:i18nText('小班工作坊'),title:i18nText('一起做作品 · 小班工作坊'),cost:'60',min:3,cap:6},{name:i18nText('场地分摊'),title:i18nText('周末场地 · 一起分摊'),cost:'120',min:4,cap:6}];
  function preset(t:typeof templates[number]) {setDraft(old=>({...old,title:t.title,cost:t.cost,minParticipants:t.min,capacity:t.cap,summary:t.name.includes('20x')?i18nText('会员费用规模的分摊演示，FJUSD测试币无价值。不购买或交付会员、账号或额度；不得共享个人账号。'):i18nText('固定活动总价，后来加入，先来的人领取差价。测试币无价值，本示例不提供实际服务。')}));setErrors({});setStorageMessage(i18nText('已应用模板，尚未发布；请填写真实公开资料并核对条款。'));}
  async function importDraft(file?:File) {if(!file)return;try{if(file.size>16384)throw Error(i18nText('草稿文件超过16KB'));const raw=JSON.parse(await file.text());const v=raw.draft||raw;if(Object.keys(emptyDraft).some(field=>typeof v[field]!==typeof emptyDraft[field as keyof CreateInput]))throw Error(i18nText('草稿字段类型不匹配'));setDraft(Object.fromEntries(Object.keys(emptyDraft).map(field=>[field,v[field]])) as unknown as CreateInput);setErrors({});setStorageMessage(i18nText('草稿已导入本地，尚未上链；请重新核对所有字段和收款地址。'));}catch(e){setStorageMessage(e instanceof Error?i18nText("导入失败：{0}", e.message):i18nText('草稿格式无效'));}}
  const fields: {
    name: keyof CreateInput;
    label: string;
    type?: string;
    hint?: string;
  }[] = [
    {
      name: "title",
      label: i18nText("活动名称"),
      hint: i18nText("{0} / 60 字", Array.from(draft.title).length),
    },
    {
      name: "summary",
      label: i18nText("活动简述"),
      hint: i18nText("1—240 字。所有内容公开上链，不填写会议口令、私人地址或身份信息。"),
    },
    { name: "hostName", label: i18nText("主办方显示名") },
    { name: "publicLocation", label: i18nText("活动形式／公开地点") },
    {
      name: "cost",
      label: i18nText("固定总价 · {0}", d.symbol),
      hint: i18nText("1—1,000；最多 6 位小数；平台费 0"),
    },
    { name: "minParticipants", label: i18nText("最低成团人数"), type: "number" },
    { name: "capacity", label: i18nText("人数上限"), type: "number" },
    {
      name: "deadline",
      label: i18nText("报名截止 · {0}", timezone),
      type: "datetime-local",
    },
    {
      name: "startsAt",
      label: i18nText("活动开始 · {0}", timezone),
      type: "datetime-local",
    },
    {
      name: "payoutAddress",
      label: i18nText("固定收款钱包"),
      hint: i18nText("默认当前钱包。确认完整地址后发布，之后不能修改。"),
    },
  ];
  const s = c.snapshot;
  const g = s?.group;
  const own = g && same(g.organizer, c.account);
  const canCancel = own && g.status === 0 && s!.timestamp < g.deadline;
  const canWithdraw =
    own &&
    g.funded &&
    s!.timestamp >= g.deadline &&
    (g.status === 0 || g.status === 3) &&
    g.revenueWithdrawn === 0n;
  const blocked = c.stale || Boolean(c.error) || Boolean(c.pending);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="stat-label">{i18nText("主办方工作台")}</p>
          <h1>{i18nText("只定总价，不用反复算账。")}</h1>
          <p className="fine">{i18nText("固定条款公开，参与者差价独立保留。")}</p>
        </div>
      </div>
      <div className="tabs" aria-label={i18nText("主办方页面内容")}>
        <button aria-pressed={tab === "list"} onClick={() => setTab("list")}>
          {i18nText("我的团")}
        </button>
        <button
          aria-pressed={tab === "create"}
          onClick={() => setTab("create")}
        >
          {i18nText("创建新团")}
        </button>
        {selectedId !== null && (
          <button
            aria-pressed={tab === "manage"}
            onClick={() => setTab("manage")}
          >
            {i18nText("管理本团")}
          </button>
        )}
      </div>
      {tab === "list" && (
        <section className="host-list">
          <h2>{i18nText("我创建的活动")}</h2>
          {!c.connected ? (
            <>
              <p>
                {i18nText("连接创建活动时的钱包，读取该地址的团。公开活动无需连接即可浏览。")}
              </p>
              <ConnectButton label={i18nText("连接主办方钱包")} />
            </>
          ) : (
            <>
              <button
                className="text-button"
                onClick={() => void c.loadOrganizerGroups()}
              >
                {i18nText("刷新我的团")}
              </button>
              {c.organizerGroups.length ? (
                <HostGroupList deployment={d} ids={c.organizerGroups} onManage={id=>{selectGroup(id);setTab('manage')}}/>
              ) : (
                <Notice>
                  {i18nText("当前钱包尚无已读取到的活动。可以创建新团，或刷新链上列表。")}
                </Notice>
              )}
            </>
          )}
        </section>
      )}
      {tab === "create" && (
        <div className="create-grid">
          <form onSubmit={submit} noValidate className="host-form">
            <h2>{i18nText("先把规则说清楚。")}</h2>
            <p className="fine" role="status">{storageMessage}</p>
            <div className="templates" aria-label={i18nText("活动模板")}>{templates.map(t=><button key={t.name} type="button" onClick={()=>preset(t)}>{t.name}</button>)}</div>
            <div className="utility-actions"><button type="button" className="text-button" onClick={()=>exportJson('FAIRJOIN-local-draft.json',{draft,unpublished:true,containsPublicMetadataOnly:true})}>{i18nText("导出本地草稿")}</button><label className="text-button">{i18nText("导入草稿")}<input type="file" aria-label={i18nText("导入草稿")} accept=".json,application/json" onChange={e=>void importDraft(e.target.files?.[0])}/></label></div>
            {Object.keys(errors).some(
              (field) => errors[field as keyof CreateInput],
            ) && (
              <Notice tone="danger" role="alert">
                <strong>{i18nText("请修正以下字段：")}</strong>
                <ul>
                  {Object.entries(errors)
                    .filter(([, error]) => error)
                    .map(([field, error]) => (
                      <li key={field}>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
                            document.getElementById(`field-${field}`)?.focus()
                          }
                        >
                          {error}
                        </button>
                      </li>
                    ))}
                </ul>
              </Notice>
            )}
            <div className="form-grid">
              {fields.map((field) => (
                <div
                  className={`form-field ${["title", "summary", "payoutAddress"].includes(field.name) ? "full" : ""}`}
                  key={field.name}
                >
                  <label htmlFor={`field-${field.name}`}>{field.label}</label>
                  {field.name === "summary" ? (
                    <textarea
                      id={`field-${field.name}`}
                      value={draft[field.name]}
                      onChange={(event) =>
                        update(field.name, event.target.value)
                      }
                      onBlur={()=>setErrors(old=>({...old,[field.name]:validateCreate(draft,d.decimals,d.contract)[field.name]}))}
                      aria-invalid={Boolean(errors[field.name])}
                      aria-describedby={`hint-${field.name}`}
                      required
                    />
                  ) : (
                    <input
                      id={`field-${field.name}`}
                      type={field.type || "text"}
                      inputMode={field.name === "cost" ? "decimal" : undefined}
                      min={field.type === "number" ? 2 : undefined}
                      max={field.type === "number" ? 12 : undefined}
                      step={field.type === "number" ? 1 : undefined}
                      value={draft[field.name]}
                      onChange={(event) =>
                        update(field.name, event.target.value)
                      }
                      onBlur={() =>
                        setErrors((old) => ({
                          ...old,
                          [field.name]: validateCreate(draft, d.decimals, d.contract)[
                            field.name
                          ],
                        }))
                      }
                      aria-invalid={Boolean(errors[field.name])}
                      aria-describedby={`hint-${field.name}`}
                      required
                    />
                  )}
                  <small
                    id={`hint-${field.name}`}
                    className={errors[field.name] ? "error-text" : ""}
                  >
                    {errors[field.name] || field.hint}
                  </small>
                </div>
              ))}
            </div>
            <div className="critical">
              <strong>{i18nText("发布后全部条款不可修改。")}</strong>
              <p>
                {i18nText("资料与地址将公开上链。需要变更时请创建新团；旧团只能在截止前按规则取消。")}
              </p>
            </div>
            <button
              type="submit"
              className="primary"
              disabled={Boolean(c.pending)}
            >
              {i18nText("预览并确认固定条款 →")}
            </button>
          </form>
          <aside className="create-preview">
            <p className="stat-label">{i18nText("发布前预览 · 尚未上链")}</p>
            <h2>{draft.title || i18nText("填写你的活动名称")}</h2>
            {validPreview && previewCost !== null ? (
              <>
                <p>
                  {i18nText("固定总价")} <Amount value={previewCost} deployment={d} />
                </p>
                <div className="quote-message">
                  {i18nText("预报名款")}{" "}
                  <strong>
                    {exact(
                      (previewCost + BigInt(draft.minParticipants) - 1n) /
                        BigInt(draft.minParticipants),
                      d.decimals,
                    )}{" "}
                    {d.symbol}
                  </strong>
                </div>
                <PriceSteps
                  cost={previewCost}
                  minimum={draft.minParticipants}
                  capacity={draft.capacity}
                  decimals={d.decimals}
                  symbol={d.symbol}
                />
              </>
            ) : (
              <p className="fine">
                {i18nText("填写有效的总价和人数后，显示预报名款与价格阶梯。")}
              </p>
            )}
            <p className="fine">
              {i18nText("满员参考不是保证。主办方只收固定总价，后续新增款项形成参与者可领取差价。")}
            </p>
          </aside>
        </div>
      )}
      {tab === "manage" &&
        (g && s && g.id === selectedId ? (
          <>
            <div className="section-head">
              <div>
                <h2>{g.metadata.title}</h2>
                <Status snapshot={s} />
              </div>
              <button className="secondary" onClick={onShare}>
                {i18nText("复制活动链接")}
              </button>
            </div>
            <div className="host-stats">
              <div>
                <span className="stat-label">{i18nText("当前／保留名单")}</span>
                <strong>
                  {g.members.filter((m) => m.active).length} / {g.capacity}
                </strong>
              </div>
              <div>
                <span className="stat-label">{i18nText("固定总价")}</span>
                <Amount value={g.cost} deployment={d} />
              </div>
              <div>
                <span className="stat-label">{i18nText("本金储备／应收")}</span>
                <Amount value={g.reserve} deployment={d} />
              </div>
              <div>
                <span className="stat-label">{i18nText("参与者可领款项")}</span>
                <Amount value={g.totalClaimable} deployment={d} />
              </div>
            </div>
            <section className="host-management">
              <h2>
                {refundable(g,s.timestamp)
                  ? i18nText('活动已终止，剩余款项归参与者。')
                  : g.revenueWithdrawn > 0n
                  ? i18nText("本金已收到，差价仍归参与者。")
                  : g.status === 3
                    ? i18nText("已结算，本金尚未转出。")
                    : i18nText("本金保留到报名截止。")}
              </h2>
              <p>
                {i18nText("报名截止：")}{date(g.deadline)} · {timezone}
              </p>
              <p>{i18nText("固定收款地址")}</p>
              <AddressText value={g.payoutAddress} />
              {!own && (
                <Notice>
                  {i18nText("当前钱包不是创建此团的主办方，管理操作不可用。请连接原创建钱包。")}
                </Notice>
              )}
              <div className="host-actions">
                {canWithdraw && (
                  <button
                    className="primary"
                    disabled={blocked}
                    onClick={() => onAction("withdraw")}
                  >
                    {g.status === 3 ? i18nText("收取") : i18nText("结算并收取")}{" "}
                    {exact(g.cost, d.decimals)} {d.symbol}
                  </button>
                )}
                {canCancel && (
                  <button
                    className="danger-outline"
                    disabled={blocked}
                    onClick={() => onAction("cancel")}
                  >
                    {i18nText("取消这个团")}
                  </button>
                )}
                <button className="secondary" onClick={()=>exportLedger(s,d)}>{i18nText("导出本团账本")}</button>
                <button className="text-button" onClick={()=>{setDraft({...emptyDraft,title:g.metadata.title,summary:g.metadata.summary,hostName:g.metadata.hostName,publicLocation:g.metadata.publicLocation,cost:exact(g.cost,d.decimals),minParticipants:g.minimum,capacity:g.capacity,payoutAddress:c.account||g.payoutAddress,deadline:'',startsAt:''});setTab('create');setErrors({});setStorageMessage(i18nText('已复制条款为新草稿，原活动不变；请重新选择日期与收款地址。'));}}>{i18nText("复制条款创建新团")}</button>
                <a className="secondary" href={destination(`/g/${g.id}`, d)}>
                  {i18nText("查看公开活动")}
                </a>
              </div>
              {g.revenueWithdrawn > 0n ? (
                <Notice tone="good">
                  {i18nText("已收到")} <Amount value={g.revenueWithdrawn} deployment={d} />
                  {i18nText("。成功转账与账本已核对。")}
                </Notice>
              ) : (
                <p className="fine">
                  {s.timestamp < g.deadline
                    ? i18nText("报名截止后且已成团才可收取；满员不能提前领取。")
                    : i18nText("报名已截止，取消不再开放。本版不处理履约争议退款。")}
                </p>
              )}
            </section>
            <Ledger snapshot={s} deployment={d} />
          </>
        ) : (
          <section className="empty-state" role="status">
            <h2>{c.loading ? i18nText("正在读取活动") : i18nText("请读取你要管理的活动")}</h2>
            {c.error && <Notice tone="danger">{c.error}</Notice>}
            <button className="secondary" onClick={() => void c.refresh()}>
              {i18nText("重新读取活动")}
            </button>
          </section>
        ))}
    </>
  );
}
