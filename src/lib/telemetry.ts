/**
 * Local-only, opt-in interaction telemetry (PRD section 11). No network calls,
 * no addresses, no secrets. Disabled by default; while disabled nothing is
 * recorded and no analytics claims may be made from this module.
 */
export type TelemetryEventName =
  | "page_view"
  | "join_open"
  | "wallet_connected"
  | "quote_confirmed"
  | "approval_sent"
  | "join_sent"
  | "join_verified"
  | "claim_verified"
  | "recovery_used";

export interface TelemetryRecord {
  name: TelemetryEventName;
  at: number;
  chainId?: number;
  groupId?: string;
  hash?: string;
  kind?: string;
}

const STORE_KEY = "pinhaotuan.telemetry.v1";
const ENABLED_KEY = "pinhaotuan.telemetry.enabled";
const MAX_RECORDS = 2000;

let enabled = false;
try {
  enabled = localStorage.getItem(ENABLED_KEY) === "1";
} catch {
  enabled = false;
}

export function isTelemetryEnabled(): boolean {
  return enabled;
}

export function setTelemetryEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(ENABLED_KEY, value ? "1" : "0");
  } catch {
    /* Storage unavailable: keep in-memory flag only. */
  }
}

export function recordEvent(
  name: TelemetryEventName,
  data: {
    chainId?: number;
    groupId?: string;
    hash?: string;
    kind?: string;
  } = {},
): void {
  if (!enabled) return;
  const record: TelemetryRecord = { name, at: Date.now(), ...data };
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || "[]") as
      | TelemetryRecord[]
      | null;
    const next = Array.isArray(list) ? list : [];
    next.push(record);
    while (next.length > MAX_RECORDS) next.shift();
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* Never let local logging break a transaction flow. */
  }
}

export function exportableEvents(): TelemetryRecord[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearTelemetry(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* Nothing to clear. */
  }
}
