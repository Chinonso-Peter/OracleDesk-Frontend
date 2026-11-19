import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { marketCoreSupports, mergeMax, specFunctionNames } from "../capabilities";
import { bundledSpec } from "../contract-check";

const fn = (name: string) =>
  xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({ doc: "", name, inputs: [], outputs: [] }));

describe("market-core capabilities", () => {
  it("reads function names from a spec", () => {
    expect(specFunctionNames([fn("split"), fn("buy")])).toEqual(new Set(["split", "buy"]));
  });

  it("needs both split and merge", () => {
    expect(marketCoreSupports(["split", "merge"], [fn("split"), fn("merge")])).toBe(true);
    expect(marketCoreSupports(["split", "merge"], [fn("split")])).toBe(false);
  });

  it("matches the pinned bindings", () => {
    const names = specFunctionNames(bundledSpec("marketCore"));
    expect(marketCoreSupports(["split", "merge"])).toBe(names.has("split") && names.has("merge"));
  });

  it("merges only complete sets", () => {
    expect(mergeMax(5n, 3n)).toBe(3n);
    expect(mergeMax(0n, 9n)).toBe(0n);
    expect(mergeMax(-1n, 9n)).toBe(0n);
  });
});
