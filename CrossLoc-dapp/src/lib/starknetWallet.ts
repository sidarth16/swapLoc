// lib/starknetWallet.ts
export function getInjectedStarknetProvider(prefer = "braavos") {
  if (typeof window === "undefined") return null;
  const s = (window as any).starknet;
  if (!s) return null;

  // If multiple providers injected (EIP-1193 style)
  if (s.providers && Array.isArray(s.providers)) {
    // Try to pick Braavos first, then any wallet
    const found =
      s.providers.find((p: any) => p.isBraavos) ||
      s.providers.find((p: any) => p.isArgentX) ||
      s.providers.find((p: any) => p.isBraavos || p.isArgentX || p.selectedAddress) ||
      s.providers[0];
    return found;
  }

  // Single injected provider
  return s;
}

export async function connectStarknetWallet(provider?: any) {
  const p = provider || getInjectedStarknetProvider();
  if (!p) throw new Error("No injected Starknet provider found (Braavos/ArgentX).");

  // Many wallets support enable() or request({ method: 'starknet_requestAccounts' })
  try {
    if (typeof p.enable === "function") {
      await p.enable();
    } else if (typeof p.request === "function") {
      // Standard-ish
      await p.request({ method: "starknet_requestAccounts" });
    } else if (p.enableWallet) {
      await p.enableWallet();
    }
  } catch (err) {
    // ignore; some wallets auto-approve in certain contexts
  }

  // Try to read accounts
  let accounts = [];
  try {
    if (typeof p.selectedAddress === "string" && p.selectedAddress.length) {
      accounts = [p.selectedAddress];
    } else if (typeof p.request === "function") {
      const res = await p.request({ method: "starknet_accounts" }).catch(() => null);
      if (Array.isArray(res) && res.length) accounts = res;
    } else if (Array.isArray(p.accounts)) {
      accounts = p.accounts;
    }
  } catch (err) {
    // ignore
  }

  // fallback: p.account or p.selectedAddress
  if (accounts.length === 0) {
    if (p.account) accounts = [p.account];
    else if (p.selectedAddress) accounts = [p.selectedAddress];
  }

  const address = accounts[0];
  if (!address) throw new Error("No Starknet account found after connecting the wallet.");

  return { provider: p, address };
}
