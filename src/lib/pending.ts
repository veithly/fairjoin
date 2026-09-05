import { isAddress, type Address, type Hex } from "viem";
import type { ActionKind, PendingAction, TxPhase } from "../types";

/**
 * Pending-action persistence and validation (PRD F-09). Storage is treated as
 * untrusted: a restored record must pass strict structural validation before
 * it can influence any transaction decision. A corrupt record is reported,
 * never silently dropped or crashed on.
 */
export const PENDING_STORAGE_KEY = "pinhaotuan.pending.v1";

export type StoredPending = PendingAction & {
  startBlock: string;
  to: Address;
  data: Hex;
  scanCursor?: string;
};

/** Bounded replacement-scan policy: 64 blocks per pass, 4 fetched in parallel. */
export const SCAN_BATCH_BLOCKS = 64n;
export const SCAN_CONCURRENCY = 4;

const ACTION_KINDS: readonly ActionKind[] = [
  "approve",
  "join",
  "claim",
  "leave",
  "cancel",
  "finalize",
  "withdraw",
  "revoke",
  "create",
  "faucet",
];
const TX_PHASES: readonly TxPhase[] = [
  "idle",
  "quoting",
  "approval-signature",
  "approval-pending",
  "join-signature",
  "submitted",
  "verifying",
  "confirmed",
  "rejected",
  "reverted",
  "unknown",
];
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;

function isUintString(value: unknown): boolean {
  return typeof value === "string" && /^\d+$/.test(value) && value !== "";
}

/** Strict validation of an untrusted persisted pending action. */
export function validatePending(raw: unknown): StoredPending | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (
    typeof p.kind !== "string" ||
    !ACTION_KINDS.includes(p.kind as ActionKind) ||
    typeof p.phase !== "string" ||
    !TX_PHASES.includes(p.phase as TxPhase) ||
    (p.chainId !== 31337 && p.chainId !== 10143) ||
    typeof p.contract !== "string" ||
    !isAddress(p.contract) ||
    typeof p.account !== "string" ||
    !isAddress(p.account) ||
    typeof p.to !== "string" ||
    !isAddress(p.to) ||
    typeof p.groupId !== "string" ||
    !/^-?\d+$/.test(p.groupId) ||
    typeof p.createdAt !== "number" ||
    !Number.isInteger(p.createdAt) ||
    p.createdAt <= 0 ||
    !isUintString(p.startBlock) ||
    typeof p.data !== "string" ||
    !HEX_RE.test(p.data) ||
    p.data === "0x"
  )
    return null;
  if (p.hash !== undefined && typeof p.hash !== "string") return null;
  if (p.hash !== undefined && !HASH_RE.test(p.hash)) return null;
  if (p.queryHash !== undefined && (typeof p.queryHash !== "string" || !HASH_RE.test(p.queryHash))) return null;
  if (p.verificationWarning !== undefined && typeof p.verificationWarning !== "string") return null;
  if (
    p.nonce !== undefined &&
    (!Number.isInteger(p.nonce) || (p.nonce as number) < 0)
  )
    return null;
  if (p.scanCursor !== undefined && !isUintString(p.scanCursor)) return null;
  if (p.amount !== undefined && !/^\d+$/.test(String(p.amount))) return null;
  if (p.message !== undefined && typeof p.message !== "string") return null;
  return { ...(p as unknown as StoredPending) };
}

export interface PendingLoadResult {
  pending: StoredPending | null;
  warning: string | null;
}

export function loadPending(): PendingLoadResult {
  let text: string | null = null;
  try {
    text = localStorage.getItem(PENDING_STORAGE_KEY);
  } catch {
    return {
      pending: null,
      warning: "本地存储不可用：无法恢复上次未完成交易的状态，也不会自动提交任何交易。",
    };
  }
  if (text === null) return { pending: null, warning: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      pending: null,
      warning: "本地待核实交易记录已损坏：原始记录已保留，请用钱包与区块浏览器手动核对，未自动清除。",
    };
  }
  const valid = validatePending(parsed);
  if (!valid)
    return {
      pending: null,
      warning: "本地待核实交易记录未通过完整性校验：原始记录已保留，请手动核对钱包记录与交易哈希。",
    };
  return { pending: { ...valid, phase: "unknown" }, warning: null };
}

export function savePending(p: StoredPending): { ok: boolean } {
  try {
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(p));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function clearPendingStorage(): void {
  try {
    localStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    /* Nothing removable. */
  }
}

/** Cross-tab observation via the storage event; no polling. */
export function watchPendingStorage(
  onChange: (raw: string | null) => void,
): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === PENDING_STORAGE_KEY || event.key === null)
      onChange(event.newValue);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export interface ScanWindow {
  from: bigint;
  to: bigint;
  nextCursor: bigint;
  done: boolean;
}

/**
 * Pure planner for the bounded replacement scan: the next window of at most
 * batch blocks starting at cursor, never below deploymentFloor. The caller
 * fetches blocks inside the window with SCAN_CONCURRENCY parallel requests.
 * done means the scan reached latest.
 */
export function planScanWindow(
  cursor: bigint,
  latest: bigint,
  batch: bigint = SCAN_BATCH_BLOCKS,
  deploymentFloor: bigint = 0n,
): ScanWindow {
  const safeCursor = cursor < deploymentFloor ? deploymentFloor : cursor;
  if (latest < safeCursor)
    return {
      from: safeCursor,
      to: safeCursor - 1n,
      nextCursor: safeCursor,
      done: true,
    };
  const to = safeCursor + batch - 1n < latest ? safeCursor + batch - 1n : latest;
  return {
    from: safeCursor,
    to,
    nextCursor: to + 1n,
    done: to >= latest,
  };
}
