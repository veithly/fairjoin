import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, defineChain, encodeDeployData, encodeFunctionData, http, isAddress, parseUnits, toHex } from 'viem';

// Intentionally local-only. No RPC override, mnemonic, private key or testnet
// branch: use the development node's unlocked throwaway accounts instead.
assert.equal(process.argv.length, 2, 'This local-only command accepts no arguments.');
const rpcUrl = 'http://127.0.0.1:8545';
const chain = defineChain({ id: 31337, name: 'FAIRJOIN Local Development',
  nativeCurrency: { name: 'Local Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }, testnet: true });
const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15000, retryCount: 0 }), pollingInterval: 100 });
assert.equal(await client.getChainId(), 31337, 'Refusing to deploy outside local chain 31337.');
const addresses = await client.request({ method: 'eth_accounts' });
assert(addresses.length >= 5 && addresses.every(address => isAddress(address)), 'Start npm run chain with unlocked local accounts.');
async function sendLocal(from, to, data) {
  assert.equal(await client.getChainId(), 31337, 'Local chain identity changed.');
  const destination = to ? { to } : {};
  const gas = await client.estimateGas({ account: from, ...destination, data, value: 0n });
  // Ganache's unlocked-account endpoint needs explicit gas. Never fall back to
  // a wallet namespace or repeat an unknown broadcast under another method.
  return client.request({ method: 'eth_sendTransaction', params: [{ from,
    ...destination, data, value: '0x0', gas: toHex(gas + gas / 5n) }] }, { retryCount: 0 });
}
const walletFor = account => ({
  deployContract: ({ abi, bytecode, args }) => sendLocal(account, undefined, encodeDeployData({ abi, bytecode, args })),
  writeContract: ({ address, abi, functionName, args }) => sendLocal(account, address, encodeFunctionData({ abi, functionName, args })),
});
const host = walletFor(addresses[0]);
const artifact = async name => JSON.parse(await readFile(`artifacts/contracts/${name}.json`, 'utf8'));
const core = await artifact('Pinhaotuan'), tokenArtifact = await artifact('TestUSDC');
const transactions = [];
async function confirmed(hash, action) {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 });
  assert.equal(receipt.status, 'success', `Local transaction reverted: ${action}`);
  transactions.push({ action, hash, blockNumber: String(receipt.blockNumber) });
  return receipt;
}
async function deploy(art, args, label) {
  const receipt = await confirmed(await host.deployContract({ abi: art.abi, bytecode: art.bytecode, args }), label);
  assert(receipt.contractAddress, 'Missing deployed contract address');
  return { address: receipt.contractAddress, blockNumber: receipt.blockNumber };
}
const token = await deploy(tokenArtifact, [], 'deploy-local-test-token');
const contract = await deploy(core, [token.address], 'deploy-business-contract');
for (const address of addresses.slice(0, 5)) {
  await confirmed(await host.writeContract({ address: token.address, abi: tokenArtifact.abi,
    functionName: 'mint', args: [address, parseUnits('1000', 6)] }), 'fund-local-account');
}
const now = (await client.getBlock()).timestamp;
await confirmed(await host.writeContract({ address: contract.address, abi: core.abi,
  functionName: 'createGroup', args: [{ cost: parseUnits('60', 6), minParticipants: 3,
    capacity: 6, deadline: now + 3600n, startsAt: now + 7200n, payoutAddress: addresses[0],
    metadataJson: JSON.stringify({ title: '本地开发 · 固定费用工作坊',
      summary: '本机开发夹具。固定总预算60，三人成团，最多六人；不提供任何真实服务。',
      publicLocation: 'Local chain 31337', hostName: 'Local test organizer' }) }] }), 'create-local-group');
const groupId = (await client.readContract({ address: contract.address, abi: core.abi, functionName: 'groupCount' })) - 1n;
for (const address of addresses.slice(1, 4)) {
  const wallet = walletFor(address);
  const [amount, version, terms] = await client.readContract({ address: contract.address,
    abi: core.abi, functionName: 'quoteJoin', args: [groupId] });
  await confirmed(await wallet.writeContract({ address: token.address, abi: tokenArtifact.abi,
    functionName: 'approve', args: [contract.address, amount] }), 'approve-local-entry');
  const timestamp = (await client.getBlock()).timestamp;
  await confirmed(await wallet.writeContract({ address: contract.address, abi: core.abi,
    functionName: 'join', args: [groupId, version, amount, timestamp + 90n, terms] }), 'join-local-group');
}
const group = await client.readContract({ address: contract.address, abi: core.abi, functionName: 'getGroup', args: [groupId] });
assert.equal(group.funded, true);
assert.equal(group.activeMembers.length, 3);
assert.equal(group.paidTotal, parseUnits('60', 6));
const deployment = { chainId: chain.id, name: chain.name, rpcUrl, contract: contract.address,
  token: token.address, decimals: 6, symbol: 'TestUSDC', explorerUrl: '',
  deploymentBlock: String(contract.blockNumber), local: true, demoGroupId: String(groupId),
  demoReceiptAddress: addresses[1], assetType: 'local-test-token',
  assetDisclosure: 'Local throwaway development asset; no value; not Circle USDC or membership.' };
await mkdir('public', { recursive: true });
await mkdir('artifacts', { recursive: true });
await writeFile('public/deployment.json', JSON.stringify(deployment, null, 2) + '\n');
await writeFile('artifacts/local-deployment.json', JSON.stringify({ deployment, transactions }, null, 2) + '\n');
console.log(JSON.stringify({ chainId: chain.id, contract: contract.address, token: token.address,
  groupId: String(groupId), fundedMembers: 3, configuration: 'public/deployment.json',
  note: 'Only local chain 31337 was used. Restore deployment.json to return to Monad Testnet.' }, null, 2));
