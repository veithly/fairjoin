import type { Address, Hash } from "viem";

export type ActionKind =
  | "approve"
  | "join"
  | "claim"
  | "leave"
  | "cancel"
  | "finalize"
  | "withdraw"
  | "revoke"
  | "create"
  | "faucet";
export type TxPhase =
  | "idle"
  | "quoting"
  | "approval-signature"
  | "approval-pending"
  | "join-signature"
  | "submitted"
  | "verifying"
  | "confirmed"
  | "rejected"
  | "reverted"
  | "unknown";
export interface Metadata {
  title: string;
  summary: string;
  publicLocation: string;
  hostName: string;
}
export interface CreateInput extends Metadata {
  cost: string;
  minParticipants: number;
  capacity: number;
  deadline: string;
  startsAt: string;
  payoutAddress: string;
}
export interface Member {
  address: Address;
  paid: bigint;
  returned: bigint;
  share: bigint;
  claimable: bigint;
  active: boolean;
  joinedAt: bigint;
}
export interface Group {
  id: bigint;
  organizer: Address;
  payoutAddress: Address;
  cost: bigint;
  minimum: number;
  capacity: number;
  deadline: bigint;
  startsAt: bigint;
  funded: boolean;
  status: number;
  rosterVersion: bigint;
  termsHash: Hash;
  metadata: Metadata;
  members: Member[];
  paidTotal: bigint;
  returnedTotal: bigint;
  revenueWithdrawn: bigint;
  balance: bigint;
  reserve: bigint;
  totalClaimable: bigint;
}
export interface JoinQuote {
  amount: bigint;
  rosterVersion: bigint;
  termsHash: Hash;
  quoteExpiry: bigint;
  blockNumber: bigint;
  count: number;
  deltas: { address: Address; amount: bigint }[];
}
export interface ChainEvent {
  name: string;
  groupId?: bigint;
  actor?: Address;
  amount?: bigint;
  /** Claimed only: 0 = PRICE_REBATE, 1 = GROUP_CANCELLED, 2 = GROUP_FAILED. */
  refundKind?: number;
  /** OrganizerPaid only: the fixed payout address actually paid. */
  payoutAddress?: Address;
  /** Finalized only: the on-chain status after settlement. */
  status?: number;
  hash: Hash;
  blockNumber: bigint;
  logIndex: number;
  transactionIndex: number;
}
export interface Snapshot {
  group: Group;
  blockNumber: bigint;
  timestamp: bigint;
  fetchedAt: number;
  events: ChainEvent[];
  eventsCompleteTo: bigint;
}
export interface Deployment {
  chainId: number;
  name: string;
  rpcUrl: string;
  contract: Address;
  token: Address;
  decimals: number;
  symbol: string;
  explorerUrl: string;
  /** Additional read-only RPC endpoints, each verified to serve chainId. */
  rpcUrls?: string[];
  /** Asset disclosure gate, e.g. project-demo-token for the FJUSD faucet. */
  assetType?: string;
  deploymentBlock: bigint;
  local: boolean;
  demoGroupId?: string;
  demoReceiptAddress?: string;
}
export interface PendingAction {
  kind: ActionKind;
  phase: TxPhase;
  chainId: number;
  contract: Address;
  groupId: string;
  account: Address;
  hash?: Hash;
  /** User-supplied hash retained when the RPC cannot find it yet. */
  queryHash?: Hash;
  /** Receipt matched, but a block-end semantic check needs manual review. */
  verificationWarning?: string;
  nonce?: number;
  /** Persisted cursor for the bounded replacement scan. */
  scanCursor?: string;
  createdAt: number;
  amount?: string;
  message?: string;
}
export interface ActionRequest {
  kind: ActionKind;
  quote?: JoinQuote;
  create?: CreateInput;
}
export interface AppController {
  readMember: (address: Address) => Promise<Member>;
}
export interface GasEstimate {
  gas: bigint;
  gasPrice: bigint;
  total: bigint;
}
export interface RpcEndpointStatus {
  url: string;
  ok: boolean;
  chainId?: number;
  error?: string;
}
export interface RpcStatus {
  checkedAt: number;
  endpoints: RpcEndpointStatus[];
}
export interface AppController {
  deployment: Deployment | null;
  configurationError: string | null;
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  account?: Address;
  connected: boolean;
  wrongNetwork: boolean;
  tokenBalance: bigint;
  nativeBalance: bigint;
  allowance: bigint;
  quote: JoinQuote | null;
  pending: PendingAction | null;
  transaction: PendingAction | null;
  /** Non-fatal warning about a corrupt or unreadable persisted pending record. */
  pendingWarning: string | null;
  rpcStatus: RpcStatus | null;
  organizerGroups: bigint[];
  refresh: () => Promise<void>;
  refreshQuote: () => Promise<JoinQuote | null>;
  connect: () => void;
  switchNetwork: () => Promise<void>;
  execute: (request: ActionRequest) => Promise<void>;
  recover: () => Promise<void>;
  /** Verify a user-supplied hash against the persisted original request. */
  recoverWithHash: (hash: string) => Promise<void>;
  /** Mark a never-broadcast wallet request cancelled after on-chain checks. */
  markPendingCancelled: () => Promise<void>;
  /** Pre-sign gas estimate; null when simulation is currently impossible. */
  estimateAction: (request: ActionRequest) => Promise<GasEstimate | null>;
  clearTransaction: () => void;
  loadOrganizerGroups: () => Promise<void>;
}
