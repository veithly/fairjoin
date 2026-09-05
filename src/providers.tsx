import "@rainbow-me/rainbowkit/styles.css";
import {
  connectorsForWallets,
  RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import {
  injectedWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineChain } from "viem";
import type { ReactNode } from "react";

export const monad = defineChain({
  id: 10143,
  name: "Monad 测试网",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
  testnet: true,
});
export const local = defineChain({
  id: 31337,
  name: "本地测试链",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
const connectors = connectorsForWallets(
  [
    {
      groupName: "连接钱包",
      wallets: [
        injectedWallet,
        ...(/^[0-9a-f]{32}$/i.test(projectId ?? "") && !/^0+$/.test(projectId!)
          ? [walletConnectWallet]
          : []),
      ],
    },
  ],
  { appName: "拼好团", projectId: projectId ?? "" },
);
export const wagmiConfig = createConfig({
  chains: [monad, local],
  connectors,
  transports: { [local.id]: http(), [monad.id]: http() },
});
const queryClient = new QueryClient();
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
