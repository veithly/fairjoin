import {
  createPublicClient,
  fallback,
  http,
  isAddress,
  zeroAddress,
  decodeEventLog,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { pinhaotuanAbi, testTokenAbi } from "../generated/abi";
import { local, monad } from "../providers";
import type {
  Deployment,
  Member,
  Snapshot,
  Metadata,
  JoinQuote,
} from "../types";
import { i18nText } from "./i18n";
export const groupAbi: Abi = pinhaotuanAbi;
export const tokenAbi: Abi = testTokenAbi;
export type Reader = PublicClient;
export function reader(d: Deployment): Reader {
  const urls = [d.rpcUrl, ...(d.rpcUrls ?? [])];
  return createPublicClient({
    chain: d.chainId === 31337 ? local : monad,
    // Read-only failover. Writes never use this transport: the wallet
    // broadcasts exactly once and there is no auto-retry or re-submission.
    transport:
      urls.length > 1
        ? fallback(urls.map((u) => http(u, { timeout: 4000, retryCount: 0 })), { retryCount: 0 })
        : http(urls[0], { timeout: 4000, retryCount: 0 }),
    cacheTime: 0,
  });
}

function rpcUrlOk(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Verify every configured read endpoint actually serves the expected chain. */
export async function verifyRpcEndpoints(
  d: Deployment,
): Promise<{ url: string; ok: boolean; chainId?: number; error?: string }[]> {
  const urls = [d.rpcUrl, ...(d.rpcUrls ?? [])];
  return Promise.all(
    urls.map(async (url) => {
      try {
        const probe = createPublicClient({
          chain: d.chainId === 31337 ? local : monad,
          transport: http(url, { timeout: 3500, retryCount: 0 }),
          cacheTime: 0,
        });
        const chainId = await probe.getChainId();
        return chainId === d.chainId
          ? { url, ok: true, chainId }
          : { url, ok: false, chainId, error: i18nText("chainId 不匹配") };
      } catch (e) {
        return {
          url,
          ok: false,
          error: e instanceof Error ? e.message.slice(0, 120) : i18nText("探测失败"),
        };
      }
    }),
  );
}
export async function loadDeployment(): Promise<Deployment> {
  const response = await fetch("/deployment.json", { cache: "no-store" });
  if (!response.ok)
    throw new Error(i18nText("未找到部署配置，请先部署测试合约并发布 deployment.json。"));
  const v = await response.json();
  if (
    ![31337, 10143].includes(v.chainId) ||
    !isAddress(v.contract) ||
    !isAddress(v.token) ||
    v.contract === zeroAddress ||
    v.token === zeroAddress ||
    !Number.isInteger(v.decimals) ||
    v.decimals !== 6
  )
    throw new Error(
      i18nText("部署身份无效：仅支持本地 31337 或 Monad 测试网 10143，以及 6 位精度的指定测试代币。"),
    );
  const rpc = new URL(v.rpcUrl);
  if (!["http:", "https:"].includes(rpc.protocol))
    throw new Error(i18nText("RPC 地址必须使用 HTTP 或 HTTPS。"));
  if (
    v.rpcUrls !== undefined &&
    (!Array.isArray(v.rpcUrls) || !v.rpcUrls.every((u: unknown) => rpcUrlOk(u)))
  )
    throw new Error(i18nText("备用 RPC 地址必须是 HTTP 或 HTTPS URL。"));
  if (v.explorerUrl && new URL(v.explorerUrl).protocol !== "https:")
    throw new Error(i18nText("区块浏览器必须使用 HTTPS。"));
  if (
    (v.demoGroupId !== undefined && !/^\d+$/.test(String(v.demoGroupId))) ||
    (v.demoReceiptAddress !== undefined && !isAddress(v.demoReceiptAddress))
  )
    throw new Error(i18nText("示例团配置无效：编号须为非负整数，收据须为有效地址。"));
  const d: Deployment = {
    ...v,
    name: v.name || (v.chainId === 31337 ? i18nText("本地测试链") : i18nText("Monad 测试网")),
    symbol: v.symbol || "FJUSD",
    explorerUrl: v.explorerUrl || "",
    local: v.chainId === 31337,
    deploymentBlock: BigInt(v.deploymentBlock ?? 0),
  };
  if (d.deploymentBlock < 0n) throw new Error(i18nText("部署区块不能为负数。"));
  const probes = await verifyRpcEndpoints(d);
  const validUrls = [...new Set(probes.filter(p => p.ok && p.chainId === d.chainId).map(p => p.url))];
  if(!validUrls.length) throw new Error(i18nText('没有通过网络身份检查的 RPC；交易已停用，请重新读取部署配置。'));
  d.rpcUrl = validUrls[0];
  d.rpcUrls = validUrls.slice(1);
  await validateDeployment(reader(d), d);
  return d;
}
export async function validateDeployment(c: Reader, d: Deployment) {
  const [chainId, code, tokenCode, token, decimals] = await Promise.all([
    c.getChainId(),
    c.getCode({ address: d.contract }),
    c.getCode({ address: d.token }),
    c.readContract({
      address: d.contract,
      abi: groupAbi,
      functionName: "token",
    }),
    c.readContract({
      address: d.token,
      abi: tokenAbi,
      functionName: "decimals",
    }),
  ]);
  if (
    chainId !== d.chainId ||
    !code ||
    code === "0x" ||
    !tokenCode ||
    tokenCode === "0x" ||
    String(token).toLowerCase() !== d.token.toLowerCase() ||
    Number(decimals) !== d.decimals
  )
    throw new Error(
      i18nText("RPC 网络、合约代码或代币身份不匹配，已停用交易。请核对部署配置。"),
    );
}
export async function memberAt(
  c: Reader,
  d: Deployment,
  id: bigint,
  address: Address,
  blockNumber: bigint,
): Promise<Member> {
  const r = (await c.readContract({
    address: d.contract,
    abi: groupAbi,
    functionName: "getMember",
    args: [id, address],
    blockNumber,
  })) as {
    paidTotal: bigint;
    returnedTotal: bigint;
    activeIndexPlusOne: number;
    joinedAt: bigint;
    share: bigint;
    claimable: bigint;
  };
  return {
    address,
    paid: r.paidTotal,
    returned: r.returnedTotal,
    active: r.activeIndexPlusOne > 0,
    joinedAt: r.joinedAt,
    share: r.share,
    claimable: r.claimable,
  };
}
interface EventCache {
  scannedTo: bigint;
  events: Snapshot["events"];
}

const eventCaches = new Map<string, EventCache>();
const eventJobs = new Map<string, Promise<EventCache>>();
const REORG_OVERLAP_BLOCKS = 24n;
const LOG_CHUNK = 1000n;

function cacheKey(d: Deployment) {
  return (
    d.chainId +
    ":" +
    d.contract.toLowerCase() +
    ":" +
    d.deploymentBlock.toString()
  );
}

function sortEvents(events: Snapshot["events"]) {
  return events.sort((a, b) =>
    a.blockNumber < b.blockNumber
      ? -1
      : a.blockNumber > b.blockNumber
        ? 1
        : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex,
  );
}

function decodeLogs(
  logs: Awaited<ReturnType<Reader["getLogs"]>>,
): Snapshot["events"] {
  const decoded: Snapshot["events"] = [];
  for (const log of logs) {
    try {
      const e = decodeEventLog({
        abi: pinhaotuanAbi,
        data: log.data,
        topics: log.topics,
      });
      const args = e.args as Record<string, unknown>;
      if (!log.transactionHash || log.blockNumber === null || log.logIndex === null)
        continue;
      decoded.push({
        name: e.eventName,
        groupId: args.groupId as bigint | undefined,
        actor: (args.member ?? args.organizer ?? args.actor) as
          | Address
          | undefined,
        amount: args.amount as bigint | undefined,
        refundKind:
          args.refundKind === undefined
            ? undefined
            : Number(args.refundKind),
        payoutAddress: args.payoutAddress as Address | undefined,
        status: args.status === undefined ? undefined : Number(args.status),
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        transactionIndex: log.transactionIndex ?? 0,
      });
    } catch {
      /* Ignore unrelated events; ledger reads remain authoritative. */
    }
  }
  return decoded;
}

async function readLogRange(c: Reader, d: Deployment, fromBlock: bigint, toBlock: bigint): Promise<Awaited<ReturnType<Reader['getLogs']>>> {
  try { return await c.getLogs({address:d.contract,fromBlock,toBlock}); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (toBlock <= fromBlock || !/range.{0,30}(large|limit|exceed)|maximum.{0,30}block|limit.{0,30}block/i.test(detail)) throw error;
    const middle=(fromBlock+toBlock)/2n;
    const left=await readLogRange(c,d,fromBlock,middle);
    const right=await readLogRange(c,d,middle+1n,toBlock);
    return [...left,...right];
  }
}

async function scanLogs(
  c: Reader,
  d: Deployment,
  from: bigint,
  to: bigint,
  cache: EventCache,
): Promise<void> {
  for (let start = from; start <= to; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n < to ? start + LOG_CHUNK - 1n : to;
    const fresh = decodeLogs(
      await readLogRange(c, d, start, end),
    );
    if (end > cache.scannedTo) cache.scannedTo = end;
    if (fresh.length || cache.events.length) {
      cache.events = [
        ...new Map(
          [...cache.events.filter((e) => e.blockNumber < start || e.blockNumber > end), ...fresh].map((e) => [e.hash + ":" + e.logIndex, e]),
        ).values(),
      ];
      sortEvents(cache.events);
    }
  }
}

async function runEventScan(
  c: Reader,
  d: Deployment,
  key: string,
  toBlock: bigint,
): Promise<EventCache> {
  let cache = eventCaches.get(key);
  if (!cache) {
    cache = { scannedTo: d.deploymentBlock - 1n, events: [] };
    eventCaches.set(key, cache);
  }
  const next = cache.scannedTo + 1n;
  const overlapStart =
    next > d.deploymentBlock && next - REORG_OVERLAP_BLOCKS > d.deploymentBlock
      ? next - REORG_OVERLAP_BLOCKS
      : d.deploymentBlock;
  // Bound history catch-up so an older deployment cannot block the payment UI.
  const batchEnd = overlapStart + 1999n < toBlock ? overlapStart + 1999n : toBlock;
  await scanLogs(c, d, overlapStart, batchEnd, cache);
  return cache;
}

/**
 * Incremental cached event history for one chain+contract. Concurrent callers
 * coalesce onto the same scan. On failure the partial cache is kept and the
 * snapshot reports honestly how far history is complete; financial state
 * always comes from contract reads at the requested block instead.
 */
export async function eventsUpTo(
  c: Reader,
  d: Deployment,
  toBlock: bigint,
): Promise<{ events: Snapshot["events"]; completeTo: bigint }> {
  const key = cacheKey(d);
  for (let round = 0; round < 2; round++) {
    const cache = eventCaches.get(key);
    if (cache && cache.scannedTo >= toBlock)
      return {
        events: cache.events.filter((e) => e.blockNumber <= toBlock),
        completeTo: toBlock,
      };
    const running = eventJobs.get(key);
    const job =
      running ??
      runEventScan(c, d, key, toBlock).finally(() => {
        eventJobs.delete(key);
      });
    if (!running) eventJobs.set(key, job);
    try {
      const complete = await Promise.race([job.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 700))]);
      if (!complete) break;
    } catch {
      /* Partial cache remains; report incomplete history truthfully. */
    }
  }
  const cache = eventCaches.get(key);
  const completeTo = cache
    ? cache.scannedTo < toBlock
      ? cache.scannedTo
      : toBlock
    : d.deploymentBlock - 1n;
  return {
    events: (cache?.events ?? []).filter((e) => e.blockNumber <= completeTo),
    completeTo,
  };
}

export async function snapshotAt(
  c: Reader,
  d: Deployment,
  id: bigint,
  blockNumber: bigint,
): Promise<Snapshot> {
  const [r, block] = await Promise.all([
    c.readContract({
      address: d.contract,
      abi: groupAbi,
      functionName: "getGroup",
      args: [id],
      blockNumber,
    }) as Promise<{
      organizer: Address;
      payoutAddress: Address;
      cost: bigint;
      minimum: number;
      capacity: number;
      deadline: bigint;
      startsAt: bigint;
      policyVersion: number;
      metadataJson: string;
      termsHash: Hash;
      funded: boolean;
      status: number;
      rosterVersion: bigint;
      activeMembers: readonly Address[];
      paidTotal: bigint;
      returnedTotal: bigint;
      revenueWithdrawn: bigint;
    }>,
    c.getBlock({ blockNumber }),
  ]);
  const members = await Promise.all(
    r.activeMembers.map((a) => memberAt(c, d, id, a, blockNumber)),
  );
  let metadata: Metadata = {
    title: i18nText("链上活动"),
    summary: "",
    publicLocation: "",
    hostName: "",
  };
  try {
    const m = JSON.parse(r.metadataJson);
    metadata = Object.fromEntries(
      Object.entries(metadata).map(([key, fallback]) => [
        key,
        typeof m?.[key] === "string" ? m[key] : fallback,
      ]),
    ) as unknown as Metadata;
  } catch {
    /* Untrusted metadata cannot invalidate financial reads. */
  }
  const { events, completeTo } = await eventsUpTo(c, d, blockNumber);
  // Never mix events of other groups (or events without a groupId) into this
  // group's timeline; every contract event here carries an indexed groupId.
  const groupEvents = events.filter((e) => e.groupId !== undefined && e.groupId === id);
  const totalClaimable = members.reduce((sum, m) => sum + m.claimable, 0n);
  const balance = r.paidTotal - r.returnedTotal - r.revenueWithdrawn;
  return {
    group: {
      id,
      organizer: r.organizer,
      payoutAddress: r.payoutAddress,
      cost: r.cost,
      minimum: Number(r.minimum),
      capacity: Number(r.capacity),
      deadline: r.deadline,
      startsAt: r.startsAt,
      metadata,
      termsHash: r.termsHash,
      funded: r.funded,
      status: Number(r.status),
      rosterVersion: r.rosterVersion,
      members,
      paidTotal: r.paidTotal,
      returnedTotal: r.returnedTotal,
      revenueWithdrawn: r.revenueWithdrawn,
      balance,
      reserve: balance - totalClaimable,
      totalClaimable,
    },
    blockNumber,
    timestamp: block.timestamp,
    fetchedAt: Date.now(),
    events: [
      ...new Map(
        groupEvents.map((e) => [e.hash + ":" + e.logIndex, e]),
      ).values(),
    ],
    eventsCompleteTo: completeTo,
  };
}
export async function quoteAt(
  c: Reader,
  d: Deployment,
  s: Snapshot,
): Promise<JoinQuote> {
  const g = s.group;
  const r = (await c.readContract({
    address: d.contract,
    abi: groupAbi,
    functionName: "quoteJoin",
    args: [g.id],
    blockNumber: s.blockNumber,
  })) as readonly [bigint, bigint, Hash];
  const count = g.members.length + 1;
  const n = BigInt(count);
  return {
    amount: r[0],
    rosterVersion: r[1],
    termsHash: r[2],
    quoteExpiry:
      s.timestamp + 90n < g.deadline ? s.timestamp + 90n : g.deadline,
    blockNumber: s.blockNumber,
    count: g.members.length,
    deltas: g.members.map((m, i) => {
      const share =
        count >= g.minimum
          ? g.cost / n + (BigInt(i) < g.cost % n ? 1n : 0n)
          : m.paid - m.returned;
      const next = m.paid - m.returned - share;
      return {
        address: m.address,
        amount: next > m.claimable ? next - m.claimable : 0n,
      };
    }),
  };
}
export function message(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/reject|denied|4001/i.test(text))
    return i18nText("已拒绝钱包签名，未确认任何付款。");
  if (/QUOTE|MAX|CLOSED|expired/i.test(text))
    return i18nText("报价或名单已变化，或报名已经截止。请刷新报价后重新确认。");
  if (/insufficient funds/i.test(text))
    return i18nText("原生手续费币不足，请补充测试 ETH / MON 后重试。");
  if (/allowance/i.test(text))
    return i18nText("代币授权不足，请先精确授权，再重新确认加入。");
  return i18nText("操作未完成：{0}。请检查钱包、网络和链上记录后重试。", text.slice(0, 320));
}
