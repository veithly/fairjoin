import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWalletClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  encodeFunctionData,
  decodeEventLog,
  isAddress,
  parseUnits,
  zeroAddress,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import { pinhaotuanAbi, demoTokenAbi } from "../generated/abi";
import type {
  ActionRequest,
  AppController,
  Deployment,
  GasEstimate,
  JoinQuote,
  PendingAction,
  RpcStatus,
  Snapshot,
} from "../types";
import {
  groupAbi,
  tokenAbi,
  loadDeployment,
  reader,
  validateDeployment,
  verifyRpcEndpoints,
  memberAt,
  snapshotAt,
  quoteAt,
  message,
} from "../lib/chain";
import {
  SCAN_BATCH_BLOCKS,
  SCAN_CONCURRENCY,
  clearPendingStorage,
  loadPending,
  planScanWindow,
  savePending,
  validatePending,
  watchPendingStorage,
  type StoredPending,
} from "../lib/pending";
import { recordEvent } from "../lib/telemetry";
import { local, monad } from "../providers";
import { i18nText } from "../lib/i18n";
import { checkMinedSemantics, hasExactFaucetMint, requireCancellationNonce } from "../lib/receiptVerification";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const FAUCET_UNITS = 1000n;

export function useAppController(groupId: bigint | null): AppController {
  const { address, isConnected, chainId: accountChainId } = useAccount();
  const configuredChainId = useChainId();
  const chainId = accountChainId ?? configuredChainId;
  const { data: wallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [deployment, setDeployment] = useState<Deployment | null>(null),
    [configurationError, setConfigurationError] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [quote, setQuote] = useState<JoinQuote | null>(null),
    [loading, setLoading] = useState(true);
  const [restored] = useState(() => loadPending());
  const [pending, setPending] = useState<StoredPending | null>(restored.pending),
    [transaction, setTransaction] = useState<PendingAction | null>(
      restored.pending,
    ),
    [pendingWarning, setPendingWarning] = useState<string | null>(
      restored.warning,
    ),
    [rpcStatus, setRpcStatus] = useState<RpcStatus | null>(null);
  const [tokenBalance, setTokenBalance] = useState(0n),
    [nativeBalance, setNativeBalance] = useState(0n),
    [allowance, setAllowance] = useState(0n),
    [organizerGroups, setOrganizerGroups] = useState<bigint[]>([]);
  const [lastRead, setLastRead] = useState(0),
    [now, setNow] = useState(Date.now());
  const pendingRef = useRef(pending),
    busy = useRef(false),
    floor = useRef(0n),
    scope = useRef("");
  scope.current = `${deployment?.contract}:${groupId}:${address}`;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  /** Persist + publish a pending action. Returns false when storage failed. */
  const persist = useCallback((p: StoredPending): boolean => {
    const saved = savePending(p);
    let next = p;
    if (!saved.ok && p.hash) {
      next = {
        ...p,
        message:
          (p.message ? p.message + " " : "") +
          i18nText("⚠ 本地存储写入失败，无法持久化该交易哈希；请立即手动记录该哈希。"),
      };
    }
    pendingRef.current = next;
    setPending(next);
    setTransaction(next);
    return saved.ok;
  }, []);
  const finish = useCallback((p: StoredPending) => {
    clearPendingStorage();
    pendingRef.current = null;
    setPending(null);
    setTransaction(p);
  }, []);
  useEffect(() => {
    let active = true;
    loadDeployment()
      .then((d) => {
        if (active) setDeployment(d);
        verifyRpcEndpoints(d)
          .then((endpoints) => {
            if (active) setRpcStatus({ checkedAt: Date.now(), endpoints });
          })
          .catch(() => {
            /* Reader status is advisory; validateDeployment gates writes. */
          });
      })
      .catch((e) => {
        if (active) setConfigurationError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Cross-tab pending protection: adopt a foreign pending record only when
  // idle, and warn instead of silently racing another tab mid-write.
  useEffect(
    () =>
      watchPendingStorage((raw) => {
        if (busy.current || raw === null) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        const v = validatePending(parsed);
        if (!v) return;
        const current = pendingRef.current;
        if (!current) {
          const adopted = { ...v, phase: "unknown" as const };
          pendingRef.current = adopted;
          setPending(adopted);
          setTransaction(adopted);
          setPendingWarning(null);
          setError(i18nText("已接续另一标签页的待核实交易；本页不会重复提交。"));
        } else if (
          (current.hash ?? "") !== (v.hash ?? "") ||
          current.nonce !== v.nonce
        ) {
          setError(
            i18nText("另一标签页更新了待核实交易；请以最新状态为准，避免多页同时操作。"),
          );
        }
      }),
    [],
  );
  const refresh = useCallback(async () => {
    if (!deployment) {
      setLoading(true);
      try {
        const d = await loadDeployment();
        setDeployment(d);
        setConfigurationError(null);
      } catch (e) {
        setConfigurationError(message(e));
      } finally {
        setLoading(false);
      }
      return;
    }
    const current = scope.current;
    const c = reader(deployment);
    try {
      const b = await c.getBlock();
      if (b.number < floor.current) throw new Error(i18nText("RPC 尚未同步已确认区块"));
      const [s, values] = await Promise.all([
        groupId === null ? null : snapshotAt(c, deployment, groupId, b.number),
        address
          ? Promise.all([
              c.readContract({
                address: deployment.token,
                abi: tokenAbi,
                functionName: "balanceOf",
                args: [address],
                blockNumber: b.number,
              }),
              c.getBalance({ address, blockNumber: b.number }),
              c.readContract({
                address: deployment.token,
                abi: tokenAbi,
                functionName: "allowance",
                args: [address, deployment.contract],
                blockNumber: b.number,
              }),
            ])
          : [0n, 0n, 0n],
      ]);
      const q =
        s &&
        s.group.status === 0 &&
        s.timestamp < s.group.deadline &&
        s.group.members.length < s.group.capacity
          ? await quoteAt(c, deployment, s)
          : null;
      if (current !== scope.current || b.number < floor.current) return;
      floor.current = b.number;
      setSnapshot(s);
      setQuote(q);
      setTokenBalance(values[0] as bigint);
      setNativeBalance(values[1] as bigint);
      setAllowance(values[2] as bigint);
      setLastRead(Date.now());
      setError(null);
    } catch (e) {
      if (current === scope.current) setError(message(e));
    } finally {
      if (current === scope.current) setLoading(false);
    }
  }, [deployment, groupId, address]);
  useEffect(() => {
    setSnapshot(null);
    setQuote(null);
    setLastRead(0);
    setTokenBalance(0n);
    setAllowance(0n);
    setNativeBalance(0n);
    setLoading(!!deployment);
    void refresh();
    let running = false;
    const t = setInterval(() => {
      if (!running) {
        running = true;
        void refresh().finally(() => {
          running = false;
        });
      }
    }, 4000);
    return () => clearInterval(t);
  }, [refresh, deployment]);
  const refreshQuote = useCallback(async () => {
    if (!deployment || groupId === null) return null;
    const current = scope.current;
    try {
      const c = reader(deployment);
      const b = await c.getBlock();
      if (b.number < floor.current) throw new Error(i18nText("RPC 区块落后"));
      const s = await snapshotAt(c, deployment, groupId, b.number);
      const q = await quoteAt(c, deployment, s);
      if (current !== scope.current || b.number < floor.current) return null;
      floor.current = b.number;
      setSnapshot(s);
      setQuote(q);
      setLastRead(Date.now());
      return q;
    } catch (e) {
      setError(message(e));
      setQuote(null);
      return null;
    }
  }, [deployment, groupId]);
  const loadOrganizerGroups = useCallback(async () => {
    if (!deployment || !address) {
      setOrganizerGroups([]);
      return;
    }
    const current = scope.current;
    try {
      const c = reader(deployment);
      const blockNumber = await c.getBlockNumber();
      const ids: bigint[] = [];
      for (let cursor = 0n; ; cursor += 24n) {
        const page = (await c.readContract({
          address: deployment.contract,
          abi: groupAbi,
          functionName: "getOrganizerGroups",
          args: [address, cursor, 24n],
          blockNumber,
        })) as readonly bigint[];
        ids.push(...page);
        if (page.length < 24) break;
      }
      if (current === scope.current) setOrganizerGroups(ids);
    } catch (e) {
      setError(message(e));
    }
  }, [deployment, address]);
  useEffect(() => {
    setOrganizerGroups([]);
    void loadOrganizerGroups();
  }, [loadOrganizerGroups]);
  const verify = useCallback(
    async (original: StoredPending, hash: Hash) => {
      let p = original;
      if (
        !deployment ||
        p.chainId !== deployment.chainId ||
        p.contract.toLowerCase() !== deployment.contract.toLowerCase()
      )
        throw new Error(i18nText("请切回原部署核实交易"));
      const c = reader(deployment);
      const candidate = await c.getTransaction({ hash });
      if(candidate.from.toLowerCase() !== p.account.toLowerCase() || (p.nonce !== undefined && candidate.nonce !== p.nonce))
        throw new Error(i18nText('该哈希不属于原钱包的同一 nonce 操作；原待核实记录已保留。'));
      if(p.nonce === undefined && (candidate.to?.toLowerCase() !== p.to.toLowerCase() || candidate.input !== p.data || candidate.value !== 0n))
        throw new Error(i18nText('缺少 nonce 时仅接受完整请求完全匹配的原交易；不会清除待核实状态。'));
      const receipt = await c.getTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        finish({
          ...p,
          hash,
          phase: "reverted",
          message: i18nText("链上交易回滚；仍可能消耗网络费。"),
        });
        return;
      }
      persist({
        ...p,
        hash,
        phase: "verifying",
        message: i18nText("交易已上链，正在核对账本。"),
      });
      // Accept the receipt only if it is exactly the persisted request on the
      // same chain: from, to, input, value and nonce must all match.
      const tx = candidate;
      if (
        tx.from.toLowerCase() !== p.account.toLowerCase() ||
        tx.to?.toLowerCase() !== p.to.toLowerCase() ||
        tx.input !== p.data ||
        tx.value !== 0n ||
        (p.nonce !== undefined && tx.nonce !== p.nonce)
      ) {
        finish({
          ...p,
          hash,
          phase: "reverted",
          message: i18nText("原交易被其他操作替换或取消，不是本次操作成功。请刷新状态。"),
        });
        return;
      }
      const blockNumber = receipt.blockNumber;
      const verificationWarning = await checkMinedSemantics(async () => {
      if (p.kind === "approve" || p.kind === "revoke") {
        const a = await c.readContract({
          address: deployment.token,
          abi: tokenAbi,
          functionName: "allowance",
          args: [p.account, deployment.contract],
          blockNumber,
        });
        if (a !== BigInt(p.amount ?? "0"))
          throw new Error(i18nText("授权读回不匹配，请核对后续交易"));
      } else if (p.kind === "faucet") {
        const mint = FAUCET_UNITS * 10n ** BigInt(deployment.decimals);
        if (!hasExactFaucetMint(receipt.logs, deployment.token, p.account, mint))
          throw new Error(
            i18nText("水龙头铸造数量与 1000 {0} 预期不符，不能确认到账", deployment.symbol),
          );
      } else {
        let id = BigInt(p.groupId);
        if (p.kind === "create") {
          let created: bigint | undefined;
          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== deployment.contract.toLowerCase())
              continue;
            try {
              const e = decodeEventLog({
                abi: pinhaotuanAbi,
                data: log.data,
                topics: log.topics,
              });
              if (e.eventName === "GroupCreated") created = e.args.groupId;
            } catch {
              /* Unrelated event. */
            }
          }
          if (created === undefined)
            throw new Error(i18nText("缺少创建活动事件，无法确认编号"));
          id = created;
          p = { ...p, groupId: id.toString() };
        }
        const s = await snapshotAt(c, deployment, id, blockNumber);
        const m = await memberAt(c, deployment, id, p.account, blockNumber);
        if (
          p.kind === "create" &&
          s.group.organizer.toLowerCase() !== p.account.toLowerCase()
        )
          throw new Error(i18nText("创建后组织者不匹配"));
        if (p.kind === "join" && !m.active)
          throw new Error(i18nText("区块末名额无效，请检查后续交易"));
        if (p.kind === "leave" && m.active)
          throw new Error(i18nText("退出后名额仍然有效"));
        if (p.kind === "cancel" && s.group.status !== 1)
          throw new Error(i18nText("取消后状态不匹配"));
        if (p.kind === "finalize" && ![2, 3].includes(s.group.status))
          throw new Error(i18nText("结算后状态不匹配"));
        if (p.kind === "withdraw" && s.group.revenueWithdrawn !== s.group.cost)
          throw new Error(i18nText("本金收款账本不匹配"));
        if (p.kind === "claim" || p.kind === "leave") {
          const before = await memberAt(
            c,
            deployment,
            id,
            p.account,
            blockNumber - 1n,
          );
          if (m.returned <= before.returned)
            throw new Error(i18nText("累计退回未增加，不能确认到账"));
        }
      }
      });
      if (blockNumber > floor.current) floor.current = blockNumber;
      finish({
        ...p,
        hash,
        phase: "confirmed",
        verificationWarning,
        message: verificationWarning
          ? i18nText("交易已上链并匹配原请求，但账本核对异常；请查看收据，不要重复提交。") + " " + verificationWarning
          : p.kind === "approve"
            ? i18nText("精确授权已确认，尚未报名。请查看新报价并再次确认加入。")
            : p.kind === "revoke"
              ? i18nText("授权额度已撤销；此操作不是退款。")
              : p.kind === "faucet"
                ? i18nText("已核实铸造 1000 {0} 测试代币到账。", deployment.symbol)
                : i18nText("交易与链上账本已核实。"),
      });
      if (!verificationWarning && (p.kind === "join" || p.kind === "claim"))
        recordEvent(p.kind === "join" ? "join_verified" : "claim_verified", {
          chainId: p.chainId,
          groupId: p.groupId,
          hash,
        });
      await refresh();
      await loadOrganizerGroups();
    },
    [deployment, finish, persist, refresh, loadOrganizerGroups],
  );
  const recover = useCallback(async () => {
    const p = pendingRef.current;
    if (!p || !deployment || busy.current) return;
    busy.current = true;
    try {
      if (
        p.chainId !== deployment.chainId ||
        p.contract.toLowerCase() !== deployment.contract.toLowerCase()
      )
        throw new Error(i18nText("请切回原部署，不会重复提交交易"));
      const c = reader(deployment);
      recordEvent("recovery_used", {
        chainId: p.chainId,
        groupId: p.groupId,
        hash: p.hash,
      });
      for (const knownHash of [...new Set([p.queryHash, p.hash].filter((h): h is Hash => Boolean(h)))]) {
        try {
          await verify(p, knownHash);
          return;
        } catch (e) {
          if (
            !/not found|could not be found/i.test(
              e instanceof Error ? e.message : String(e),
            )
          )
            throw e;
        }
      }
      if (p.nonce === undefined) {
        persist({
          ...p,
          phase: "unknown",
          message:
            i18nText("缺少 nonce 记录，无法自动扫描替换交易；请用原哈希或钱包记录查询，不要重复付款。"),
        });
        return;
      }
      const latest = await c.getBlockNumber();
      const nonce = await c.getTransactionCount({
        address: p.account,
        blockTag: "latest",
      });
      if (nonce > p.nonce) {
        // Bounded, resumable scan: at most SCAN_BATCH_BLOCKS blocks per pass,
        // SCAN_CONCURRENCY blocks fetched in parallel, cursor persisted.
        const start = BigInt(p.startBlock);
        const cursor = p.scanCursor !== undefined ? BigInt(p.scanCursor) : start;
        const window = planScanWindow(cursor, latest, SCAN_BATCH_BLOCKS, start);
        if (window.from <= window.to) {
          for (
            let b = window.from;
            b <= window.to;
            b += BigInt(SCAN_CONCURRENCY)
          ) {
            const group = Array.from(
              { length: SCAN_CONCURRENCY },
              (_, i) => b + BigInt(i),
            ).filter((n) => n <= window.to);
            const blocks = await Promise.all(
              group.map((n) =>
                c.getBlock({ blockNumber: n, includeTransactions: true }),
              ),
            );
            for (const block of blocks) {
              for (const t of block.transactions) {
                if (typeof t === "string") continue;
                if (
                  t.from.toLowerCase() === p.account.toLowerCase() &&
                  BigInt(t.nonce) === BigInt(p.nonce)
                ) {
                  await verify(
                    { ...p, scanCursor: window.nextCursor.toString() },
                    t.hash,
                  );
                  return;
                }
              }
            }
          }
        }
        if (!window.done) {
          const scanned = window.to - start + 1n;
          const total = latest - start + 1n;
          persist({
            ...p,
            scanCursor: window.nextCursor.toString(),
            phase: "unknown",
            message: i18nText("同 nonce 交易已上链但本批未找到：已顺序扫描 {0} / {1} 个区块（至 {2}，最新 {3}），将继续分批扫描；不会重复提交。", scanned.toString(), total.toString(), window.to.toString(), latest.toString()),
          });
          return;
        }
        persist({
          ...p,
          phase: "unknown",
          message:
            i18nText("该 nonce 已被占用，但扫描区间内未找到匹配交易（可能由其他工具提交）。请勿重复付款，可用下方哈希查询框核对。"),
        });
        return;
      }
      if (p.groupId !== "-1")
        await memberAt(c, deployment, BigInt(p.groupId), p.account, latest);
      persist({
        ...p,
        phase: "unknown",
        message:
          i18nText("尚未查到可核实收据。请在原钱包检查、加速或取消待处理交易；不要重复付款。"),
      });
      await refresh();
    } catch (e) {
      if (pendingRef.current)
        persist({
          ...pendingRef.current,
          phase: "unknown",
          message: message(e),
        });
      setError(message(e));
    } finally {
      busy.current = false;
    }
  }, [deployment, verify, persist, refresh]);
  const recoverWithHash = useCallback(
    async (hash: string) => {
      const p = pendingRef.current;
      if (!p) throw new Error(i18nText("当前没有待核实交易"));
      const h = hash.trim();
      if (!HASH_RE.test(h))
        throw new Error(i18nText("请输入 0x 开头、64 位十六进制的交易哈希"));
      recordEvent("recovery_used", {
        chainId: p.chainId,
        groupId: p.groupId,
        hash: h,
      });
      if(busy.current) throw new Error(i18nText('正在核实原交易，请勿并行提交查询。'));
      busy.current = true;
      try {
        await verify(p, h as Hash);
      } catch (e) {
        const text = message(e);
        const notFound = /not found|could not be found/i.test(
          e instanceof Error ? e.message : String(e),
        );
        persist({
          ...p,
          ...(notFound ? { queryHash: h as Hash } : {}),
          phase: "unknown",
          message: notFound
            ? i18nText("该哈希在链上暂无收据，可能尚未上链或哈希有误；请勿重复付款。")
            : text,
        });
        setError(notFound ? i18nText("该哈希暂无链上收据，不能确认结果。") : text);
      } finally { busy.current = false; }
    },
    [verify, persist],
  );
  const markPendingCancelled = useCallback(async () => {
    const p = pendingRef.current;
    if (!p) throw new Error(i18nText("当前没有待核实交易"));
    if (p.hash)
      throw new Error(
        i18nText("已记录交易哈希，不能标记为“仅钱包取消”；请按哈希查询原交易。"),
      );
    if (!deployment) throw new Error(i18nText("部署尚未通过校验"));
    if (busy.current) throw new Error(i18nText("正在核实原交易，请勿并行提交查询。"));
    if (p.chainId !== deployment.chainId || p.contract.toLowerCase() !== deployment.contract.toLowerCase())
      throw new Error(i18nText("请切回原部署核实交易"));
    const nonce = requireCancellationNonce(p);
    const c = reader(deployment);
    busy.current = true;
    try {
      const [latestCount, pendingCount] = await Promise.all([
        c.getTransactionCount({ address: p.account, blockTag: "latest" }),
        c.getTransactionCount({ address: p.account, blockTag: "pending" }),
      ]);
      if (latestCount > nonce)
        throw new Error(
          i18nText("链上已出现该 nonce 的交易，状态未知，不能直接标记取消；请查询原交易。"),
        );
      if (pendingCount > nonce)
        throw new Error(
          i18nText("交易池中疑似仍有该 nonce 的待处理交易；请先在钱包确认取消或等待其失效。"),
        );
    finish({
      ...p,
      phase: "rejected",
      message: i18nText("已按用户确认解除本地等待；当前节点未发现该 nonce 的交易。这不会取消已在其他节点传播的交易，请继续核对钱包。"),
    });
    } finally { busy.current = false; }
  }, [deployment, finish]);
  /** Shared request builder for execute() and estimateAction(). */
  const buildAction = useCallback(
    async (
      request: ActionRequest,
    ): Promise<{
      to: Address;
      abi: Abi;
      functionName: string;
      args: readonly unknown[];
      amount?: bigint;
    }> => {
      if (!deployment) throw new Error(i18nText("部署尚未通过校验"));
      const c = reader(deployment);
      let functionName: string;
      let args: readonly unknown[];
      let to = deployment.contract;
      let abi: Abi = groupAbi;
      let amount: bigint | undefined;
      if (request.kind === "create") {
        const i = request.create;
        const title = (i?.title ?? "").trim();
        const summary = (i?.summary ?? "").trim();
        const hostName = (i?.hostName ?? "").trim();
        const publicLocation = (i?.publicLocation ?? "").trim();
        if (
          !i ||
          !isAddress(i.payoutAddress) ||
          i.payoutAddress === zeroAddress ||
          i.payoutAddress.toLowerCase() ===
            deployment.contract.toLowerCase() ||
          !Number.isInteger(i.minParticipants) ||
          !Number.isInteger(i.capacity) ||
          i.minParticipants < 2 ||
          i.minParticipants > i.capacity ||
          i.capacity > 12
        )
          throw new Error(
            i18nText("请填写标题及收款地址，人数满足 2 ≤ 最低人数 ≤ 容量 ≤ 12"),
          );
        if (!title || Array.from(title).length > 60)
          throw new Error(i18nText("活动名称须为 1—60 字"));
        if (!summary || Array.from(summary).length > 240)
          throw new Error(i18nText("活动简述须为 1—240 字"));
        if (!hostName) throw new Error(i18nText("请填写主办方显示名"));
        if (!publicLocation) throw new Error(i18nText("请填写活动形式或公开地点"));
        if (!/^\d+(\.\d{1,6})?$/.test(i.cost))
          throw new Error(i18nText("总价最多 6 位小数"));
        const cost = parseUnits(i.cost, deployment.decimals);
        const unit = 10n ** BigInt(deployment.decimals);
        if (cost < unit || cost > 1000n * unit)
          throw new Error(i18nText("总价须在 1–1000 {0} 之间", deployment.symbol));
        const deadline = BigInt(
            Math.floor(new Date(i.deadline).getTime() / 1000),
          ),
          startsAt = BigInt(Math.floor(new Date(i.startsAt).getTime() / 1000));
        const b = await c.getBlock();
        if (deadline < b.timestamp + 600n || startsAt < deadline + 1800n)
          throw new Error(i18nText("截止至少在 10 分钟后，开始至少在截止 30 分钟后"));
        const metadataJson = JSON.stringify({
          title,
          summary,
          publicLocation,
          hostName,
        });
        if (new TextEncoder().encode(metadataJson).length > 2048)
          throw new Error(i18nText("公开信息超过 2048 字节，请缩短"));
        functionName = "createGroup";
        args = [
          {
            cost,
            minParticipants: i.minParticipants,
            capacity: i.capacity,
            deadline,
            startsAt,
            payoutAddress: i.payoutAddress,
            metadataJson,
          },
        ];
      } else if (request.kind === "faucet") {
        if (
          deployment.chainId !== 10143 ||
          deployment.symbol !== "FJUSD" ||
          deployment.assetType !== "project-demo-token"
        )
          throw new Error(
            i18nText("水龙头仅在 Monad 测试网 10143 的项目测试代币 FJUSD 上开放"),
          );
        to = deployment.token;
        abi = demoTokenAbi as unknown as Abi;
        functionName = "faucet";
        args = [];
        amount = FAUCET_UNITS * 10n ** BigInt(deployment.decimals);
      } else {
        if (groupId === null) throw new Error(i18nText("缺少活动编号"));
        if (request.kind === "approve" || request.kind === "join") {
          const q = request.quote;
          if (!q) throw new Error(i18nText("请先获取并确认报价"));
          const b = await c.getBlock();
          if (
            b.number < q.blockNumber ||
            b.timestamp >= q.quoteExpiry ||
            q.quoteExpiry > b.timestamp + 90n
          )
            throw new Error(i18nText("报价失效，请重新获取"));
          const fresh = (await c.readContract({
            address: deployment.contract,
            abi: groupAbi,
            functionName: "quoteJoin",
            args: [groupId],
            blockNumber: b.number,
          })) as readonly [bigint, bigint, Hash];
          if (
            fresh[0] !== q.amount ||
            fresh[1] !== q.rosterVersion ||
            fresh[2] !== q.termsHash
          )
            throw new Error(i18nText("报价或名单已变化，请重新确认"));
          amount = q.amount;
          if (request.kind === "approve") {
            to = deployment.token;
            abi = tokenAbi;
            functionName = "approve";
            args = [deployment.contract, amount];
          } else {
            functionName = "join";
            args = [
              groupId,
              q.rosterVersion,
              q.amount,
              q.quoteExpiry,
              q.termsHash,
            ];
          }
        } else if (request.kind === "revoke") {
          to = deployment.token;
          abi = tokenAbi;
          functionName = "approve";
          amount = 0n;
          args = [deployment.contract, 0n];
        } else {
          const methods = {
            claim: "claim",
            leave: "leaveBeforeFunded",
            cancel: "cancel",
            finalize: "finalize",
            withdraw: "withdrawOrganizer",
          } as const;
          functionName = methods[request.kind];
          args = [groupId];
        }
      }
      return { to, abi, functionName, args, amount };
    },
    [deployment, groupId],
  );
  const estimateAction = useCallback(
    async (request: ActionRequest): Promise<GasEstimate | null> => {
      if (!deployment || !address) return null;
      try {
        const c = reader(deployment);
        const a = await buildAction(request);
        // Pre-sign estimate from a real eth_estimateGas + gas price. It is a
        // display hint only: the wallet's final fee is not guaranteed.
        const gas = await c.estimateContractGas({
          address: a.to,
          abi: a.abi,
          functionName: a.functionName,
          args: a.args,
          account: address,
        });
        const gasPrice = await c.getGasPrice();
        return { gas, gasPrice, total: gas * gasPrice };
      } catch {
        return null;
      }
    },
    [deployment, address, buildAction],
  );
  const execute = useCallback(
    async (request: ActionRequest) => {
      if (busy.current) return;
      busy.current = true;
      let p: StoredPending | null = null;
      let signatureRequested = false;
      try {
        if (pendingRef.current)
          throw new Error(i18nText("已有待核实交易，请先恢复原交易"));
        if (!deployment || configurationError)
          throw new Error(i18nText("部署尚未通过校验"));
        const stored = loadPending();
        if(stored.warning) { setPendingWarning(stored.warning); throw new Error(i18nText('本地交易记录无法安全恢复，已阻止新签名。请先核对并处理保留的记录。')); }
        if(stored.pending) { persist(stored.pending); throw new Error(i18nText('另一标签页有待核实交易，已接续原记录，不重复发送。')); }
        if (!isConnected || !address || !wallet)
          throw new Error(i18nText("请先连接钱包"));
        if (
          chainId !== deployment.chainId ||
          (await wallet.getChainId()) !== deployment.chainId
        )
          throw new Error(i18nText("钱包网络错误，请切换测试网络"));
        if (!lastRead || Date.now() - lastRead > 10000)
          throw new Error(i18nText("数据超过 10 秒未同步，请刷新再确认"));
        const c = reader(deployment);
        await validateDeployment(c, deployment);
        const a = await buildAction(request);
        const data = encodeFunctionData(a);
        await c.simulateContract({
          address: a.to,
          abi: a.abi,
          functionName: a.functionName,
          args: a.args,
          account: address,
        });
        const [nonce, startBlock] = await Promise.all([
          c.getTransactionCount({ address, blockTag: "pending" }),
          c.getBlockNumber(),
        ]);
        if (
          (await wallet.getChainId()) !== deployment.chainId ||
          (await wallet.getAddresses())[0]?.toLowerCase() !==
            address.toLowerCase()
        )
          throw new Error(i18nText("钱包身份已切换，请重新确认"));
        p = {
          kind: request.kind,
          phase:
            request.kind === "approve" || request.kind === "revoke"
              ? "approval-signature"
              : "join-signature",
          chainId: deployment.chainId,
          contract: deployment.contract,
          groupId: groupId?.toString() ?? "-1",
          account: address,
          nonce,
          startBlock: startBlock.toString(),
          to: a.to,
          data,
          amount: a.amount?.toString(),
          createdAt: Date.now(),
          message: i18nText("请在钱包核对并签名；此时尚未确认交易。"),
        };
        // Storage must be writable BEFORE requesting the signature; otherwise
        // an interrupted flow could not be recovered safely.
        if (!persist(p))
          throw new Error(
            i18nText("本地存储不可用：已阻止签名。签名前必须能保存待核实状态，否则中断后无法安全恢复。"),
          );
        signatureRequested = true;
        const hash = await wallet.sendTransaction({
          account: address,
          chain: deployment.chainId === 31337 ? local : monad,
          to: a.to,
          data,
          nonce,
        });
        if (request.kind === "approve" || request.kind === "revoke")
          recordEvent("approval_sent", {
            chainId: deployment.chainId,
            groupId: p.groupId,
            hash,
          });
        else if (request.kind === "join")
          recordEvent("join_sent", {
            chainId: deployment.chainId,
            groupId: p.groupId,
            hash,
          });
        p = {
          ...p,
          hash,
          phase:
            request.kind === "approve" || request.kind === "revoke"
              ? "approval-pending"
              : "submitted",
          message: i18nText("已广播，等待链上确认并读回账本。"),
        };
        persist(p);
        const receipt = await c.waitForTransactionReceipt({
          hash,
          timeout: 60000,
          onReplaced: (replacement) => {
            p = { ...p!, hash: replacement.transaction.hash };
            persist(p);
          },
        });
        await verify(p, receipt.transactionHash);
      } catch (e) {
        const text = message(e);
        setError(text);
        if (p) {
          if (
            !signatureRequested || (!p.hash &&
            /reject|denied|4001/i.test(
              e instanceof Error ? e.message : String(e),
            ))
          )
            finish({ ...p, phase: "rejected", message: text });
          else
            persist({
              ...p,
              phase: "unknown",
              message: i18nText("{0} 请核实原交易，不要重复提交。", text),
            });
        }
      } finally {
        busy.current = false;
      }
    },
    [
      deployment,
      configurationError,
      isConnected,
      address,
      wallet,
      chainId,
      lastRead,
      groupId,
      persist,
      finish,
      verify,
      buildAction,
    ],
  );
  const readMember = useCallback(
    async (a: Address) => {
      if (!deployment || groupId === null || !isAddress(a))
        throw new Error(i18nText("缺少有效活动或收据地址"));
      const c = reader(deployment);
      const s = snapshotRef.current;
      const n =
        s?.group.id === groupId ? s.blockNumber : await c.getBlockNumber();
      if (n < floor.current) throw new Error(i18nText("RPC 尚未同步已确认区块"));
      return memberAt(c, deployment, groupId, a, n);
    },
    [deployment, groupId],
  );
  return {
    deployment,
    configurationError,
    snapshot,
    loading,
    error,
    stale: !lastRead || now - lastRead > 10000,
    account: address,
    connected: isConnected,
    wrongNetwork: isConnected && !!deployment && chainId !== deployment.chainId,
    tokenBalance,
    nativeBalance,
    allowance,
    quote,
    pending,
    transaction,
    pendingWarning,
    rpcStatus,
    organizerGroups,
    refresh,
    refreshQuote,
    connect: () => openConnectModal?.(),
    switchNetwork: async () => {
      if (deployment)
        try {
          await switchChainAsync({ chainId: deployment.chainId });
        } catch (e) {
          setError(message(e));
        }
    },
    execute,
    recover,
    recoverWithHash,
    markPendingCancelled,
    estimateAction,
    clearTransaction: () => {
      if (!pendingRef.current) setTransaction(null);
      else setError(i18nText("待核实交易不能清除，请先查询原交易。"));
    },
    loadOrganizerGroups,
    readMember,
  };
}
