import { UserFacingError } from "./errors";
import type { Signer } from "./clients";
import { asSignerAddress, type SignerAddress } from "./identity";
import type { IntegrityResult, ContractKey } from "./contract-check";
import type { MonitorStatus } from "./integrity-monitor";
import { NETWORK_LABEL, NETWORK_PASSPHRASE, TESTNET_PASSPHRASE } from "./config";

export interface WriteGuardContext {
  signer: Signer | null;
  isWrongNetwork: boolean;
  isWatching?: boolean;
  watchedAddress?: string | null;
  accountFunded?: boolean;
  updatePending?: boolean;
  integrity?: Record<string, IntegrityResult> | null;
  monitorStatus?: MonitorStatus;
  target?: ContractKey | "usdc";
  rpcStatus?: string;
  walletNetworkConfirmed?: boolean;
}

/**
 * Pure assertion validating all write prerequisites:
 * 1. App bundle is up to date (no pending service worker update)
 * 2. Wallet is connected
 * 3. Connected wallet is on the correct network (Testnet)
 * 4. User is not currently in watch-only mode for another address
 * 5. On-chain contract specification matches bundled bindings
 * 6. Account is funded with XLM
 *
 * Returns a branded SignerAddress.
 */
export function assertCanWrite(ctx: WriteGuardContext): SignerAddress {
  if (ctx.updatePending) {
    throw new UserFacingError({ kind: "unknown", message: "Reload to update OracleDesk before signing." });
  }
  if (!ctx.signer) {
    throw new UserFacingError({ kind: "disconnected", message: "Connect your wallet first." });
  }
  if (ctx.isWrongNetwork) {
    throw new UserFacingError({ kind: "wrong-network", message: `Switch your wallet to ${NETWORK_LABEL} and try again.` });
  }
  if (ctx.rpcStatus === "mismatch") {
    throw new UserFacingError({ kind: "wrong-network", message: "The RPC is on a different Stellar network. Signing is disabled." });
  }
  if (ctx.walletNetworkConfirmed === false) {
    throw new UserFacingError({ kind: "wrong-network", message: `Confirm your wallet is on ${NETWORK_LABEL} first in the wallet menu.` });
  }
  if (ctx.isWatching && ctx.watchedAddress && ctx.watchedAddress !== ctx.signer.publicKey) {
    throw new UserFacingError({
      kind: "disconnected",
      message: "You're viewing another address. Connect your own wallet to trade.",
    });
  }

  if (ctx.monitorStatus === "initial" || ctx.monitorStatus === "rechecking") {
    throw new UserFacingError({
      kind: "contract",
      message: "Verifying contracts… try again in a moment.",
    });
  }

  if (ctx.monitorStatus === "failed") {
    throw new UserFacingError({
      kind: "contract",
      message: "This app is out of date with the deployed contracts. Trading is disabled until it's updated.",
    });
  }

  // Blocking on mainnet for unchecked RPC status; allowed with warning on testnet
  if (ctx.monitorStatus === "unchecked" && NETWORK_PASSPHRASE !== TESTNET_PASSPHRASE) {
    throw new UserFacingError({
      kind: "contract",
      message: "Contract integrity could not be verified due to RPC connectivity issues. Signing disabled on mainnet.",
    });
  }

  if (ctx.integrity && ctx.target) {
    const res = ctx.integrity[ctx.target];
    if (res && (res.status === "mismatch" || res.status === "not-found" || res.status === "wrong-kind")) {
      throw new UserFacingError({
        kind: "contract",
        message: "This app is out of date with the deployed contracts. Trading is disabled until it's updated.",
      });
    }
  }

  if (ctx.accountFunded === false) {
    throw new UserFacingError({
      kind: "account-not-found",
      message: "Your Stellar account isn't activated yet. Fund it with XLM first.",
    });
  }
  return asSignerAddress(ctx.signer);
}
