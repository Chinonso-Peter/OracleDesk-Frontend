import type { xdr } from "@stellar/stellar-sdk";
import { bundledSpec, getSpecEntryName } from "./contract-check";

export type SetsFunction = "split" | "merge";

/** Function names declared by a contract spec. */
export function specFunctionNames(entries: readonly xdr.ScSpecEntry[]): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.switch().name === "scSpecEntryFunctionV0") names.add(getSpecEntryName(entry));
  }
  return names;
}

/**
 * Whether market-core declares every given function. Defaults to the pinned
 * bindings; pass the on-chain spec (from `parseSpecFromWasm`) once it is known.
 * Split/merge UI must stay hidden until this is true for both.
 */
export function marketCoreSupports(
  fns: readonly SetsFunction[],
  entries: readonly xdr.ScSpecEntry[] = bundledSpec("marketCore"),
): boolean {
  const names = specFunctionNames(entries);
  return fns.every(fn => names.has(fn));
}

/** Complete sets a holder can merge back into collateral at par. */
export function mergeMax(yes: bigint, no: bigint): bigint {
  if (yes <= 0n || no <= 0n) return 0n;
  return yes < no ? yes : no;
}
