import type { TraceVerdict } from "./stellar/generated/reasoning-registry";

/** Maps a contract-side TraceVerdict to a display label/variant for trade attribution UI. */
export function describeVerdict(verdict: TraceVerdict): { label: string; variant: "ok" | "warning"; reason?: string } {
  if (verdict.tag === "Flagged") {
    return { label: "Flagged", variant: "warning", reason: verdict.values[0] };
  }
  return { label: "Verified", variant: "ok" };
}
