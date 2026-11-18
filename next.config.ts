import type { NextConfig } from "next";
import { CONTRACT_MANIFEST } from "./lib/stellar/generated/contract-manifest";

/**
 * Build-time identity check (issue #122). The browser banner shows the same
 * information at runtime; this warns loudly at build time when NEXT_PUBLIC_*
 * overrides ship contract ids that differ from the pinned deployment
 * manifest, and `ORACLEDESK_REQUIRE_CANONICAL=1` (build-only, never
 * NEXT_PUBLIC_) turns that into a failed build for official deploys.
 *
 * Deliberately independent of lib/stellar/config.ts: next.config runs in
 * Node before the client bundle exists, so it re-derives the comparison
 * from the same env names and manifest values.
 */
function identityOverrideWarnings(): { canonical: boolean; overridden: string[] } {
  const canonicalOf: ReadonlyArray<[key: string, envName: string, canonical: string]> = [
    ["marketCore", "NEXT_PUBLIC_MARKET_CORE_CONTRACT_ID", CONTRACT_MANIFEST.contracts.marketCore],
    ["treasury", "NEXT_PUBLIC_TREASURY_CONTRACT_ID", CONTRACT_MANIFEST.contracts.treasury],
    ["resolver", "NEXT_PUBLIC_RESOLVER_CONTRACT_ID", CONTRACT_MANIFEST.contracts.resolver],
    [
      "reasoningRegistry",
      "NEXT_PUBLIC_REASONING_REGISTRY_CONTRACT_ID",
      CONTRACT_MANIFEST.contracts.reasoningRegistry,
    ],
    ["usdc", "NEXT_PUBLIC_USDC_CONTRACT_ID", CONTRACT_MANIFEST.contracts.usdc],
    ["paymentsRecipient", "NEXT_PUBLIC_PAYMENTS_RECIPIENT", CONTRACT_MANIFEST.contracts.treasury],
  ];

  const overridden = canonicalOf
    .filter(([, envName, canonical]) => {
      const raw = process.env[envName];
      return Boolean(raw && raw.trim()) && raw!.trim() !== canonical;
    })
    .map(([key]) => key);

  const passphrase =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim() || "Test SDF Network ; September 2015";
  const manifestApplies = passphrase === "Test SDF Network ; September 2015" && CONTRACT_MANIFEST.network === "testnet";

  return { canonical: manifestApplies && overridden.length === 0, overridden };
}

const identity = identityOverrideWarnings();
if (!identity.canonical) {
  const detail =
    identity.overridden.length > 0
      ? `overridden: ${identity.overridden.join(", ")}`
      : "no contract manifest exists for this network passphrase";
  const message = `OracleDesk build identity: NON-CANONICAL (${detail}). The app will show a warning banner.`;
  if (process.env.ORACLEDESK_REQUIRE_CANONICAL === "1") {
    throw new Error(`${message} ORACLEDESK_REQUIRE_CANONICAL=1 is set, so this build fails.`);
  }
  console.warn(`\n⚠️  ${message}\n`);
}

const nextConfig: NextConfig = {
  /**
   * The seven demo-only routes retired by issue #49. Their UI moved to
   * components/demo/ and renders only in the noindex design gallery at
   * /dev/gallery when NEXT_PUBLIC_ENABLE_DEMO_ROUTES is set; the old URLs go
   * to real destinations (see lib/demo/retired-routes.ts, which CI checks).
   */
  async redirects() {
    return [
      { source: "/wallet-demo", destination: "/portfolio/wallets", permanent: true },
      { source: "/buy-yes-demo", destination: "/markets", permanent: true },
      { source: "/buy-no-demo", destination: "/markets", permanent: true },
      { source: "/execution-terminal", destination: "/markets", permanent: true },
      { source: "/transaction-status", destination: "/tx", permanent: true },
      { source: "/transaction-success", destination: "/tx", permanent: true },
      { source: "/transaction-failed", destination: "/tx", permanent: true },
    ];
  },
};

export default nextConfig;
