"use client";
import { Icon } from "@/components/ui/icon";

import React, { useEffect, useState } from "react";
import type { ResolutionSpec } from "@/lib/api/markets";
import {
  formatResolutionSpec,
  verifyResolutionCommitment,
  type ResolutionVerificationResult,
} from "@/lib/stellar/resolution-spec";
import { formatHashHex } from "@/lib/stellar/market-question";

export interface ResolverStatusPanelProps {
  /**
   * The resolver state machine on-chain:
   * e.g., "Unconfigured", "SignersPending", "Finalized", "Expired", "Disputed".
   */
  resolverState: string;
  /**
   * The revealed resolution spec payload from the backend.
   * If null/undefined, the spec has not yet been revealed.
   */
  resolutionSpec?: ResolutionSpec | null;
  /**
   * The resolution_hash committed on-chain in the market-core/resolver contract.
   */
  resolutionHash?: Buffer | Uint8Array | string | null;
  /**
   * Optional market status from market-core (e.g. "Active", "Resolving", "Resolved").
   */
  marketStatus?: string;
  className?: string;
}

export function ResolverStatusPanel({
  resolverState,
  resolutionSpec,
  resolutionHash,
  marketStatus,
  className = "",
}: ResolverStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [verification, setVerification] = useState<ResolutionVerificationResult | null>(null);

  useEffect(() => {
    void verifyResolutionCommitment(resolutionSpec, resolutionHash).then((res) => {
      setVerification(res);
    });
  }, [resolutionSpec, resolutionHash]);

  const hashString = formatHashHex(resolutionHash);
  const formattedWords = formatResolutionSpec(resolutionSpec);

  return (
    <div
      className={`border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest transition-all ${className}`}
    >
      {/* Header bar / Summary Toggle */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-low transition-colors"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <Icon name="verified_user" className="text-secondary text-lg" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-headline-sm text-sm font-bold text-on-surface">
                Resolver Rule Integrity
              </span>
              {/* Badge based on verification state */}
              {verification?.status === "verified" ? (
                <span className="bg-secondary/10 text-secondary border border-secondary/20 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase flex items-center gap-1">
                  <Icon name="check_circle" filled className="text-[12px]" />
                  Verified Spec
                </span>
              ) : verification?.status === "mismatch" ? (
                <span className="bg-error/15 text-error border border-error px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase flex items-center gap-1">
                  <Icon name="error" className="text-[12px]" />
                  Spec Mismatch
                </span>
              ) : verification?.status === "unsupported" ? (
                <span className="bg-surface-container-high text-on-surface-variant border border-outline-variant px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase flex items-center gap-1">
                  <Icon name="help_outline" className="text-[12px]" />
                  Verification Unsupported
                </span>
              ) : verification?.status === "unconfigured" ? (
                <span className="bg-surface-container text-on-surface-variant border border-outline-variant/60 px-2 py-0.5 rounded text-[10px] font-medium tracking-wider uppercase">
                  No Commitment
                </span>
              ) : (
                <span className="bg-surface-container text-on-surface-variant border border-outline-variant/60 px-2 py-0.5 rounded text-[10px] font-medium tracking-wider uppercase">
                  Unrevealed
                </span>
              )}
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {verification?.status === "verified"
                ? "Revealed resolution rule strictly matches the on-chain SHA-256 commitment."
                : verification?.status === "mismatch"
                  ? "CRITICAL: The revealed rule does NOT match the committed hash on-chain!"
                  : verification?.status === "unsupported"
                    ? "Specialized rule kind (e.g. Committee/Hybrid): hash verification is not supported in the web client."
                    : "Resolution commitment check details and plain-language rule interpretation."}
            </p>
          </div>
        </div>

        <Icon name={isOpen ? "expand_less" : "expand_more"} className="text-on-surface-variant text-sm" />
      </button>

      {/* Panel Content */}
      {isOpen && (
        <div className="p-5 space-y-4 border-t border-outline-variant bg-surface">
          {/* Status Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
              <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
                RESOLVER STATE <SourceTag source="chain" />
              </span>
              <span className="font-data-mono text-body-md text-on-surface font-semibold">
                {resolverState}
              </span>
            </div>

            {marketStatus && (
              <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
                <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
                  MARKET-CORE STATUS <SourceTag source="chain" />
                </span>
                <span className="font-data-mono text-body-md text-on-surface font-semibold">
                  {marketStatus}
                </span>
              </div>
            )}
          </div>

          {/* Revealed Spec in Plain Words */}
          <div className="p-4 bg-surface-container-lowest rounded-lg border border-outline-variant">
            <div className="flex items-center justify-between mb-2">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                REVEALED RESOLUTION SPEC <SourceTag source="backend" />
              </span>
              {verification?.status === "verified" ? (
                <span className="text-[11px] font-bold text-secondary flex items-center gap-1">
                  <Icon name="check_circle" filled className="text-xs" />
                  Matches on-chain commitment
                </span>
              ) : verification?.status === "mismatch" ? (
                <span className="text-[11px] font-bold text-error flex items-center gap-1">
                  <Icon name="error" className="text-xs" />
                  Hash mismatch (do not trust!)
                </span>
              ) : verification?.status === "unsupported" ? (
                <span className="text-[11px] font-medium text-on-surface-variant flex items-center gap-1">
                  <Icon name="help_outline" className="text-xs" />
                  Rule kind not evaluated
                </span>
              ) : null}
            </div>

            {resolutionSpec ? (
              <p className="font-body-md text-on-surface font-medium leading-relaxed">
                {formattedWords}
              </p>
            ) : (
              <p className="text-sm text-on-surface-variant italic">
                A market without a revealed spec has not yet disclosed its resolution rule on-chain.
              </p>
            )}
          </div>

          {/* Commitment Hash Verification Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
              <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
                COMMITTED HASH (ON-CHAIN) <SourceTag source="chain" />
              </span>
              <code className="text-xs break-all font-data-mono text-on-surface block">
                {hashString ? hashString : "No commitment hash on-chain"}
              </code>
            </div>

            <div className="p-3 bg-surface-container-low rounded-lg border border-outline-variant/60">
              <span className="font-label-caps text-label-caps text-on-surface-variant block mb-1">
                RECOMPUTED SPEC HASH (LOCAL)
              </span>
              <code
                className={`text-xs break-all font-data-mono block ${
                  verification?.status === "verified"
                    ? "text-secondary font-bold"
                    : verification?.status === "mismatch"
                      ? "text-error font-bold"
                      : "text-on-surface-variant"
                }`}
              >
                {verification?.computedHash ?? (
                  verification?.status === "unsupported"
                    ? "N/A (unsupported kind)"
                    : resolutionSpec
                      ? "Computing…"
                      : "No revealed spec to hash"
                )}
              </code>
            </div>
          </div>

          {/* Strong Warning on Mismatch */}
          {verification?.status === "mismatch" && (
            <div
              role="alert"
              className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-xs flex items-center gap-2"
            >
              <Icon name="error" className="text-base" />
              <div>
                <span className="font-bold">CRITICAL WARNING: </span>
                The backend&apos;s displayed resolution spec does not hash to the on-chain commitment hash.
                The market may settle according to different rules!
              </div>
            </div>
          )}

          {/* Non-alarming Info on Unsupported */}
          {verification?.status === "unsupported" && (
            <div
              role="note"
              className="p-3 bg-surface-container border border-outline-variant rounded-lg text-on-surface-variant text-xs flex items-center gap-2"
            >
              <Icon name="info" className="text-base text-on-surface-variant" />
              <div>
                <span className="font-semibold text-on-surface">Notice: </span>
                This market uses an advanced resolver rule ({resolutionSpec?.kind}). The client cannot independently verify this commitment format, so no claim is made either way.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SourceTag({ source }: { source: "chain" | "backend" }) {
  return (
    <span
      className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ml-1 ${
        source === "chain"
          ? "bg-secondary/15 text-secondary"
          : "bg-surface-container-high text-on-surface-variant"
      }`}
    >
      {source}
    </span>
  );
}
