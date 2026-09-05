#!/usr/bin/env node
/**
 * Honest unit checks for PRD F-09 recovery helpers (no chain, no wallet).
 * Node cannot strip TypeScript types by default on 22.x, so this script
 * re-executes itself with --experimental-strip-types when needed.
 */
import { spawnSync } from "node:child_process";

if (!process.execArgv.includes("--experimental-strip-types")) {
  const rerun = spawnSync(
    process.execPath,
    ["--experimental-strip-types", new URL(import.meta.url).pathname],
    { stdio: "inherit" },
  );
  process.exit(rerun.status ?? 1);
}

const { validatePending, planScanWindow, SCAN_BATCH_BLOCKS, SCAN_CONCURRENCY } =
  await import("../src/lib/pending.ts");

let pass = 0;
const failures = [];
function check(name, condition) {
  if (condition) pass += 1;
  else failures.push(name);
}

const valid = {
  kind: "join",
  phase: "submitted",
  chainId: 10143,
  contract: "0xf6ac320e7c4e865a72c588c89be23ff12ca543c3",
  groupId: "1",
  account: "0x39fb9c5d645712dde3cd5601e2ccdfcd1089719a",
  hash: "0x" + "ab".repeat(32),
  nonce: 7,
  createdAt: 1757040000000,
  amount: "60000000",
  message: "ok",
  startBlock: "59807942",
  to: "0xf6ac320e7c4e865a72c588c89be23ff12ca543c3",
  data: "0x1234abcd",
  scanCursor: "59808000",
};

check("valid pending accepted", validatePending(valid) !== null);
check(
  "restored pending normalizes phase elsewhere (not here)",
  validatePending({ ...valid, phase: "unknown" }) !== null,
);
const tampered = [
  ["bad chainId", { ...valid, chainId: 1 }],
  ["bad kind", { ...valid, kind: "steal" }],
  ["bad phase", { ...valid, phase: "yolo" }],
  ["bad contract address", { ...valid, contract: "0x123" }],
  ["bad account address", { ...valid, account: "nope" }],
  ["bad to address", { ...valid, to: "0xzz" }],
  ["bad hash", { ...valid, hash: "0x1234" }],
  ["negative startBlock", { ...valid, startBlock: "-1" }],
  ["float nonce", { ...valid, nonce: 1.5 }],
  ["negative nonce", { ...valid, nonce: -1 }],
  ["float createdAt", { ...valid, createdAt: 1.5 }],
  ["odd hex data", { ...valid, data: "0x123" }],
  ["empty data", { ...valid, data: "0x" }],
  ["bad scanCursor", { ...valid, scanCursor: "next" }],
  ["bad amount", { ...valid, amount: "10.5" }],
  ["bad groupId", { ...valid, groupId: "one" }],
  ["non-object", "nope"],
];
for (const [name, value] of tampered)
  check("rejected: " + name, validatePending(value) === null);

// Bounded scan: 64-block windows, resumable cursor, never below start block.
const w1 = planScanWindow(1000n, 1200n, SCAN_BATCH_BLOCKS, 1000n);
check("window bounded to 64", w1.to - w1.from + 1n === SCAN_BATCH_BLOCKS);
check("cursor advances", w1.nextCursor === 1064n);
check("window not done", w1.done === false);
const w2 = planScanWindow(w1.nextCursor, 1200n, SCAN_BATCH_BLOCKS, 1000n);
check("second window continues", w2.from === 1064n);
const w3 = planScanWindow(1165n, 1200n, SCAN_BATCH_BLOCKS, 1000n);
check("final window clamps to latest", w3.to === 1200n && w3.done === true);
const w4 = planScanWindow(900n, 1200n, SCAN_BATCH_BLOCKS, 1000n);
check("cursor clamped to floor", w4.from === 1000n);
const w5 = planScanWindow(1300n, 1200n, SCAN_BATCH_BLOCKS, 1000n);
check("stale cursor marks done", w5.done === true);
check("concurrency configured", SCAN_CONCURRENCY === 4);
// A huge range never produces an unbounded window in one pass.
const w6 = planScanWindow(0n, 10_000_000n, SCAN_BATCH_BLOCKS, 0n);
check("huge range stays bounded", w6.to - w6.from + 1n === SCAN_BATCH_BLOCKS);

if (failures.length) {
  console.error("FAILED:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log(
  `test-recovery-unit: ${pass} checks passed (pending validation + bounded scan)`,
);
