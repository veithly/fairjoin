import assert from "node:assert/strict";
import ganache from "ganache";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
const artifact = (name) =>
  JSON.parse(readFileSync(`artifacts/contracts/${name}.json`, "utf8"));
const p = artifact("Pinhaotuan"),
  t = artifact("TestUSDC");
const provider = ganache.provider({
  chain: { chainId: 31337, hardfork: "shanghai" },
  wallet: { deterministic: true, totalAccounts: 14 },
  logging: { quiet: true },
});
const chain = defineChain({
  id: 31337,
  name: "test",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost"] } },
});
const transport = custom(provider, { retryCount: 0 });
const client = createPublicClient({
  chain,
  transport,
  cacheTime: 0,
  pollingInterval: 10,
});
const wallets = Object.values(provider.getInitialAccounts()).map((a) =>
  createWalletClient({
    account: privateKeyToAccount(a.secretKey),
    chain,
    transport,
    cacheTime: 0,
  }),
);
const addresses = wallets.map((w) => w.account.address);
const unit = 1_000_000n;
let passed = 0;
const check = (label) => {
  console.log(`PASS ${label}`);
  passed++;
};
async function receipt(hash) {
  const r = await client.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", `reverted ${hash}`);
  return r;
}
async function deploy(art, args = []) {
  return (
    await receipt(
      await wallets[0].deployContract({
        abi: art.abi,
        bytecode: art.bytecode,
        args,
        gas: 8_000_000n,
      }),
    )
  ).contractAddress;
}
const token = await deploy(t),
  contract = await deploy(p, [token]);
const read = (functionName, args = []) =>
  client.readContract({ address: contract, abi: p.abi, functionName, args });
const tokenRead = (functionName, args = []) =>
  client.readContract({ address: token, abi: t.abi, functionName, args });
async function send(w, functionName, args = [], isToken = false) {
  const request = {
    account: wallets[w].account,
    address: isToken ? token : contract,
    abi: isToken ? t.abi : p.abi,
    functionName,
    args,
  };
  await client.simulateContract(request);
  return receipt(
    await wallets[w].writeContract({ ...request, gas: 6_000_000n }),
  );
}
async function rejects(fn, label) {
  await assert.rejects(fn, undefined, label);
}
const now = async () => (await client.getBlock()).timestamp;
async function time(timestamp) {
  await provider.request({
    method: "evm_setTime",
    params: [Number(timestamp) * 1000],
  });
  await provider.request({ method: "evm_mine", params: [] });
}
async function create(
  cost = 60n * unit,
  minimum = 3,
  capacity = 6,
  extra = {},
) {
  const timestamp = await now();
  const params = {
    cost,
    minParticipants: minimum,
    capacity,
    deadline: timestamp + 1200n,
    startsAt: timestamp + 3600n,
    payoutAddress: addresses[0],
    metadataJson: '{"title":"Test"}',
    ...extra,
  };
  const id = await read("groupCount");
  await send(0, "createGroup", [params]);
  return id;
}
const group = (id) => read("getGroup", [id]);
const member = (id, w) => read("getMember", [id, addresses[w]]);
const balance = (w) => tokenRead("balanceOf", [addresses[w]]);
async function join(id, w, q) {
  q ||= await read("quoteJoin", [id]);
  await send(w, "join", [id, q[1], q[0], (await now()) + 90n, q[2]]);
  return q[0];
}
async function invariant(id) {
  const g = await group(id);
  let liabilities = 0n,
    shares = 0n;
  for (const address of g.activeMembers) {
    const m = await read("getMember", [id, address]);
    assert(m.paidTotal >= m.returnedTotal + m.claimable);
    liabilities += m.claimable;
    shares += m.share;
  }
  const b = g.paidTotal - g.returnedTotal - g.revenueWithdrawn;
  const effectiveFailed = !g.funded && (await now()) >= g.deadline;
  if (g.status === 1 || g.status === 2 || effectiveFailed)
    assert.equal(b, liabilities);
  else if (g.funded) {
    assert.equal(shares, g.cost);
    assert.equal(b, g.cost - g.revenueWithdrawn + liabilities);
  } else
    assert.equal(
      b,
      BigInt(g.activeMembers.length) *
        ((g.cost + BigInt(g.minimum) - 1n) / BigInt(g.minimum)),
    );
}
try {
  for (let i = 0; i < wallets.length; i++) {
    await send(0, "mint", [addresses[i], 100000n * unit], true);
    await send(i, "approve", [contract, 100000n * unit], true);
  }
  const id = await create();
  for (let i = 1; i <= 3; i++) {
    assert.equal(await join(id, i), 20n * unit);
    if (i < 3) {
      await rejects(() => send(0, "withdrawOrganizer", [id]), "early payout");
      await rejects(
        () => send(i, "claim", [id]),
        "prefunding claim must not retain free seat",
      );
    }
    await invariant(id);
  }
  assert.equal((await group(id)).funded, true);
  check("AC01 deposits and no early principal");
  assert.equal(await join(id, 4), 15n * unit);
  for (let i = 1; i <= 3; i++)
    assert.equal((await member(id, i)).claimable, 5n * unit);
  await send(1, "claim", [id]);
  const claimedVersion = (await group(id)).rosterVersion;
  assert.equal(await join(id, 5), 12n * unit);
  assert.equal((await member(id, 1)).claimable, 3n * unit);
  await invariant(id);
  assert.equal(await join(id, 6), 10n * unit);
  for (let i = 1; i <= 6; i++) {
    assert.equal((await member(id, i)).share, 10n * unit);
    if ((await member(id, i)).claimable) await send(i, "claim", [id]);
  }
  assert.equal((await group(id)).returnedTotal, 37n * unit);
  assert.equal(claimedVersion, 4n);
  await invariant(id);
  await rejects(() => send(1, "claim", [id]), "double claim");
  await rejects(() => send(1, "leaveBeforeFunded", [id]), "funded leave");
  check("AC02/03/04/08 refunds total37 and immutable membership after funding");
  const cancelled = await create();
  for (let i = 1; i <= 4; i++) await join(cancelled, i);
  await send(1, "claim", [cancelled]);
  await send(0, "cancel", [cancelled]);
  for (const [i, value] of [
    [1, 15n],
    [2, 20n],
    [3, 20n],
    [4, 15n],
  ]) {
    assert.equal((await member(cancelled, i)).claimable, value * unit);
    await send(i, "claim", [cancelled]);
  }
  await invariant(cancelled);
  check("AC05 cancellation preserves prior refunds");
  const leave = await create(100n * unit);
  await join(leave, 1);
  await join(leave, 2);
  await send(1, "leaveBeforeFunded", [leave]);
  assert.equal((await member(leave, 2)).activeIndexPlusOne, 1);
  await join(leave, 1);
  assert.equal((await member(leave, 1)).activeIndexPlusOne, 2);
  assert.equal((await member(leave, 1)).paidTotal, 66_666_668n);
  await invariant(leave);
  check("AC07 leave compresses and rejoin retains history");
  const guarded = await create(60n * unit, 2, 3);
  await join(guarded, 1);
  await join(guarded, 2);
  const q = await read("quoteJoin", [guarded]);
  const before = await balance(4);
  await rejects(
    () => send(4, "join", [guarded, q[1], q[0] - 1n, 9_999_999_999n, q[2]]),
    "invalid max",
  );
  await rejects(
    () => send(4, "join", [guarded, q[1], q[0], 1n, q[2]]),
    "expired",
  );
  await rejects(
    () =>
      send(4, "join", [
        guarded,
        q[1],
        q[0],
        9_999_999_999n,
        "0x" + "00".repeat(32),
      ]),
    "terms",
  );
  await join(guarded, 3, q);
  await rejects(() => join(guarded, 4, q), "last slot");
  assert.equal(await balance(4), before);
  await invariant(guarded);
  check("AC09/10 last slot and invalid quotes never debit");
  const failure = await create();
  await join(failure, 1);
  await join(failure, 2);
  const deadline = (await group(failure)).deadline;
  await time(deadline - 1n);
  await rejects(() => send(0, "finalize", [failure]), "early finalize");
  await time(deadline);
  await rejects(() => join(failure, 3), "deadline join");
  await rejects(
    () => send(1, "leaveBeforeFunded", [failure]),
    "deadline leave",
  );
  await rejects(() => send(0, "cancel", [failure]), "deadline cancel");
  await send(1, "claim", [failure]);
  assert.equal((await group(failure)).status, 2);
  await time(deadline + 1n);
  await send(2, "claim", [failure]);
  await invariant(failure);
  check("AC06/12 deadline boundaries and lazy failed refunds");
  const rounding = await create(100n * unit, 3, 3);
  for (let i = 1; i <= 3; i++) await join(rounding, i);
  assert.deepEqual(
    await Promise.all(
      [1, 2, 3].map(async (i) => (await member(rounding, i)).share),
    ),
    [33_333_334n, 33_333_333n, 33_333_333n],
  );
  await invariant(rounding);
  await time((await group(rounding)).deadline);
  await send(5, "finalize", [rounding]);
  await rejects(() => send(0, "finalize", [rounding]), "double finalize");
  await send(0, "withdrawOrganizer", [rounding]);
  await rejects(
    () => send(0, "withdrawOrganizer", [rounding]),
    "double payout",
  );
  await invariant(rounding);
  check("AC11/13/19 rounding and fixed principal payout");
  const blocked = await create();
  for (let i = 1; i <= 4; i++) await join(blocked, i);
  await send(0, "setBlockedRecipient", [addresses[1], true], true);
  const mBefore = await member(blocked, 1);
  await rejects(() => send(1, "claim", [blocked]), "blocked transfer");
  assert.deepEqual(await member(blocked, 1), mBefore);
  await send(2, "claim", [blocked]);
  await send(0, "setBlockedRecipient", [addresses[1], false], true);
  await send(1, "claim", [blocked]);
  await send(0, "setFee", [true], true);
  const gBefore = await group(blocked);
  await rejects(() => join(blocked, 5), "fee deposit");
  assert.deepEqual(await group(blocked), gBefore);
  await rejects(() => send(3, "claim", [blocked]), "fee refund");
  await send(0, "setFee", [false], true);
  await invariant(blocked);
  check("AC14 transfer failures atomically preserve rights");
  const isolated = await create();
  const old = await group(blocked);
  await send(7, "transfer", [contract, 7n * unit], true);
  await join(isolated, 8);
  assert.deepEqual(await group(blocked), old);
  await invariant(isolated);
  check("AC15 multi-group and unsolicited tokens stay isolated");
  for (const cost of [0n, 999999n, 1000000001n])
    await rejects(() => create(cost), "cost bounds");
  await rejects(() => create(60n * unit, 1, 6), "min");
  await rejects(() => create(60n * unit, 3, 13), "cap");
  await rejects(() => create(60n * unit, 3, 6, { deadline: 1n }), "time");
  await rejects(
    () => create(60n * unit, 3, 6, { metadataJson: "a".repeat(2049) }),
    "metadata",
  );
  await rejects(
    () => create(60n * unit, 3, 6, { payoutAddress: "0x" + "00".repeat(20) }),
    "zero payout",
  );
  await rejects(() => send(1, "cancel", [isolated]), "cancel permission");
  await rejects(
    () => send(1, "withdrawOrganizer", [isolated]),
    "withdraw permission",
  );
  check("create and organizer authorization boundaries");
  let seed = 91827;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let run = 0; run < 16; run++) {
    const min = 2 + rand(4),
      cap = min + rand(13 - min),
      cost = unit + BigInt(rand(999000001));
    const g = await create(cost, min, cap);
    let prior = new Map();
    for (let i = 1; i <= cap; i++) {
      await join(g, i);
      if (i < min && rand(3) === 0) {
        await send(i, "leaveBeforeFunded", [g]);
        await invariant(g);
        await join(g, i);
      }
      const state = await group(g);
      for (let j = 1; j <= i; j++) {
        const m = await member(g, j);
        if (state.funded && prior.has(j)) assert(m.share <= prior.get(j));
        if (state.funded) prior.set(j, m.share);
        if (m.claimable && rand(2)) await send(j, "claim", [g]);
      }
      await invariant(g);
    }
    if (rand(2)) await send(0, "cancel", [g]);
    else {
      await time((await group(g)).deadline);
      await send(0, "withdrawOrganizer", [g]);
    }
    for (let i = 1; i <= cap; i++)
      if ((await member(g, i)).claimable) await send(i, "claim", [g]);
    await invariant(g);
    await rejects(() => join(g, 13), "terminal join");
  }
  check(
    "16 seeded randomized ledger sequences preserve conservation and monotonic shares",
  );
  console.log(`${passed} behavioral groups passed against deployed Solidity`);
} finally {
  await provider.disconnect();
}
