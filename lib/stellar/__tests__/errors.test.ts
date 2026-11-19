import { describe, expect, it } from "vitest";
import { describeError } from "../errors";

describe("describeError", () => {
  it("maps market-core contract errors by code", () => {
    const slip = describeError(new Error("HostError: Error(Contract, #12)\nEvent log: ..."));
    expect(slip).toMatchObject({ kind: "contract", code: "SlippageExceeded" });
    expect(slip.message).toMatch(/price moved/i);

    const closed = describeError("simulation failed: Error(Contract, #9)");
    expect(closed).toMatchObject({ kind: "contract", code: "MarketClosed" });
    expect(closed.message).toMatch(/closed/i);
  });

  it("uses the contract's own table", () => {
    expect(describeError("Error(Contract, #5)", "treasury").code).toBe("TradeCapExceeded");
    expect(describeError("Error(Contract, #5)", "marketCore").code).toBe("InvalidProbability");
  });

  it("maps unknown code in known table to generic contract message with number", () => {
    const unknownCode = describeError("Error(Contract, #9999)", "marketCore");
    expect(unknownCode.kind).toBe("contract");
    expect(unknownCode.message).toMatch(/error 9999/);
    expect(unknownCode.code).toBeUndefined();
  });

  it("maps bare contract name through FRIENDLY", () => {
    const bare = describeError("Transaction failed: SlippageExceeded occurred in execution");
    expect(bare.kind).toBe("contract");
    expect(bare.code).toBe("SlippageExceeded");
    expect(bare.message).toMatch(/price moved/i);
  });

  it("recognises wrong network error", () => {
    const wrongNet = describeError(new Error("Wrong network selected: switch to testnet"));
    expect(wrongNet.kind).toBe("wrong-network");
    expect(wrongNet.message).toMatch(/Testnet/);
  });

  it("recognises wallet rejection", () => {
    expect(describeError({ code: -4, message: "The user rejected this request." }).kind).toBe("rejected");
    expect(describeError(new Error("User declined access")).kind).toBe("rejected");
  });

  it("rejection beats trustline and balance text (precedence in both directions)", () => {
    const rejAndTrust = describeError("User rejected request because trustline entry is missing");
    expect(rejAndTrust.kind).toBe("rejected");

    const trustAndRej = describeError("trustline entry is missing: request was rejected by user");
    expect(trustAndRej.kind).toBe("rejected");
  });

  it("recognises balance and trustline failures before contract codes", () => {
    // A SAC failure inside market_core.buy carries the token's own code.
    expect(describeError("Error(Contract, #10) ... balance is not sufficient to spend").kind).toBe("insufficient-balance");
    expect(describeError("Error(Contract, #13) ... trustline entry is missing for account").kind).toBe("no-trustline");
  });

  it("textOf reads nested error.message and cause", () => {
    const innerError = new Error("insufficient balance in account");
    const outerError = new Error("Transaction simulation failed", { cause: innerError });
    expect(describeError(outerError).kind).toBe("insufficient-balance");

    const objectWithNestedMessage = {
      error: { message: "Wrong network detected" },
    };
    expect(describeError(objectWithNestedMessage).kind).toBe("wrong-network");
  });

  it("null and undefined map to unknown", () => {
    expect(describeError(null).kind).toBe("unknown");
    expect(describeError(undefined).kind).toBe("unknown");
  });

  it("falls back to a readable message", () => {
    expect(describeError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(describeError(42).message).toMatch(/something went wrong/i);
  });
});
