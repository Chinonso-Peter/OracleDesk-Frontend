import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchAndVerifyTrace, ipfsUrl, verifyTraceHash } from "../trace";

// Same fixtures as x402/trace-verification.test.ts in the contracts repo.
describe("verifyTraceHash", () => {
  const content = new TextEncoder().encode('{"action":"buy","confidence":0.72}');
  const hash = createHash("sha256").update(content).digest("hex");

  it("verifies the exact bytes received from IPFS", async () => {
    expect(await verifyTraceHash(content, hash)).toBe(true);
    expect(await verifyTraceHash(content, `0x${hash}`)).toBe(true);
    expect(await verifyTraceHash(content, hash.toUpperCase())).toBe(true);
    expect(await verifyTraceHash(new TextEncoder().encode("{}"), hash)).toBe(false);
    expect(await verifyTraceHash(content, "not-a-hash")).toBe(false);
    // Boundary lengths and non-hex checks
    expect(await verifyTraceHash(content, "a".repeat(63))).toBe(false);
    expect(await verifyTraceHash(content, "a".repeat(65))).toBe(false);
    expect(await verifyTraceHash(content, "g".repeat(64))).toBe(false);
  });

  it("builds an encoded IPFS gateway URL", () => {
    expect(ipfsUrl("bafy trace", "https://ipfs.example/")).toBe("https://ipfs.example/bafy%20trace");
    expect(ipfsUrl("ipfs://bafyabc", "https://ipfs.example")).toBe("https://ipfs.example/bafyabc");
    // Strips only leading ipfs:// and only one trailing slash
    expect(ipfsUrl("ipfs://bafy/ipfs://nested", "https://ipfs.example//")).toBe("https://ipfs.example//bafy%2Fipfs%3A%2F%2Fnested");
    expect(ipfsUrl("bafyabc", "https://ipfs.example")).toBe("https://ipfs.example/bafyabc");
  });
});

describe("fetchAndVerifyTrace", () => {
  const body = '{"reasoning":"rates hold","edge":0.12}';
  const hash = createHash("sha256").update(body).digest("hex");
  const respond = (text: string, status = 200) => (async () => new Response(text, { status })) as typeof fetch;

  it("returns content only when it matches", async () => {
    const ok = await fetchAndVerifyTrace("bafy1", hash, respond(body));
    expect(ok.status).toBe("verified");
    expect(ok.status === "verified" && ok.content).toEqual({ reasoning: "rates hold", edge: 0.12 });

    // Accepts 0x-prefixed and upper-case on-chain hash
    const prefixedOk = await fetchAndVerifyTrace("bafy1", `0x${hash.toUpperCase()}`, respond(body));
    expect(prefixedOk.status).toBe("verified");
  });

  it("returns verified non-JSON content as text", async () => {
    const plainText = "raw explanation without json";
    const textHash = createHash("sha256").update(plainText).digest("hex");
    const res = await fetchAndVerifyTrace("bafy2", textHash, respond(plainText));
    expect(res).toEqual({ status: "verified", content: plainText, computedHash: textHash });
  });

  it("reports tampered content as a mismatch, without the content", async () => {
    const tampered = await fetchAndVerifyTrace("bafy1", hash, respond(body.replace("0.12", "0.99")));
    expect(tampered).toEqual({ status: "mismatch", computedHash: expect.any(String) });
    expect("content" in tampered).toBe(false);
  });

  it("reports gateway failures as unavailable with HTTP status or network reason", async () => {
    const fail504 = await fetchAndVerifyTrace("bafy1", hash, respond("", 504));
    expect(fail504.status).toBe("unavailable");
    if (fail504.status === "unavailable") {
      expect(fail504.reason).toContain("504");
    }

    const throwing = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    const failNetwork = await fetchAndVerifyTrace("bafy1", hash, throwing);
    expect(failNetwork.status).toBe("unavailable");
    if (failNetwork.status === "unavailable") {
      expect(failNetwork.reason).toMatch(/reach the IPFS gateway/i);
    }
  });
});
