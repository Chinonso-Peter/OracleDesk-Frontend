import { apiClient, clearAuthSession, getStoredSessionWallet, getStoredToken, storeAuthSession, isAuthError, type ApiRequestOptions } from "./client";
import { validateSEP10Challenge, type SEP10ValidationError } from "@/lib/stellar/sep10-validator";
import { isTokenExpired, getTokenTTL, getReAuthPromise, setReAuthPromise, isReAuthInFlight, waitForReAuth } from "./jwt-manager";
import { broadcastSessionChange } from "./cross-tab-sync";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "@/lib/stellar/config";
import { NetworkMismatchError } from "@/lib/stellar/network-check";
import { sha256Hex } from "@/lib/stellar/trace";
import { withOperation } from "@/lib/observability/tracing";

export interface AuthSession {
  token: string;
  userId: string;
  walletAddress: string;
}

export interface AuthChallenge {
  /** Base64 transaction envelope to sign with the wallet (never submitted). */
  transaction: string;
  networkPassphrase: string;
  expiresAt: string;
}

export async function requestChallenge(address: string, options?: ApiRequestOptions) {
  const { data } = await apiClient.post<AuthChallenge>("/auth/challenge", { address }, undefined, options);
  return data;
}

export async function verifyChallenge(
  address: string,
  signed: string,
  isCurrent: () => boolean = () => true,
  options?: ApiRequestOptions,
  headers?: HeadersInit,
) {
  const { data } = await apiClient.post<AuthSession>("/auth/verify", { address, signed }, headers, options);
  if (!isCurrent() || data.walletAddress !== address) throw new Error("Your account changed; sign in again.");
  storeAuthSession(data);
  broadcastSessionChange(data.token, data.walletAddress);
  return data;
}

/**
 * Validate SEP-10 challenge before signing.
 * Throws if the challenge is invalid or expired.
 */
export function validateChallenge(challenge: AuthChallenge): SEP10ValidationError | null {
  return validateSEP10Challenge(challenge, NETWORK_PASSPHRASE);
}

/** SHA-256 of the challenge XDR envelope (base64 decoded), sent as `X-Challenge-Hash`. */
async function challengeHash(transaction: string): Promise<string> {
  let bytes: Uint8Array;
  try {
    const binary = atob(transaction);
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    bytes = new TextEncoder().encode(transaction); // not base64: hash it as-is
  }
  return sha256Hex(bytes);
}

/**
 * SEP-10 style login: the backend issues a challenge transaction, the wallet
 * signs it (signTransaction works in every Stellar wallet), the backend
 * verifies the signature and returns a JWT.
 *
 * Validates the challenge before signing to prevent signing malformed transactions.
 *
 * Runs as one traced operation (issue #124): both requests share one
 * `traceparent`, and the verify request carries `X-Challenge-Hash` so the
 * backend can prove the signature it verifies is over the challenge it issued.
 */
export async function signInWithWallet(
  address: string,
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>,
  isCurrent: () => boolean = () => true,
): Promise<AuthSession> {
  return withOperation("sign-in", async (ctx) => {
    const trace = { trace: ctx };
    const challenge = await requestChallenge(address, trace);

    if (challenge.networkPassphrase !== NETWORK_PASSPHRASE) {
      throw new NetworkMismatchError(NETWORK_PASSPHRASE, challenge.networkPassphrase);
    }
    // XDR does not itself encode a passphrase; parsing here ensures the envelope
    // is valid, and the exact advertised passphrase check above binds the hash.
    TransactionBuilder.fromXDR(challenge.transaction, NETWORK_PASSPHRASE);

    // Validate challenge before signing
    const validationError = validateChallenge(challenge);
    if (validationError) {
      throw new Error(`Invalid SEP-10 challenge: ${validationError.message}`);
    }

    if (!isCurrent()) throw new Error("Your account changed; sign in again.");
    const signed = await signTransaction(challenge.transaction, challenge.networkPassphrase);
    if (!isCurrent()) throw new Error("Your account changed; sign in again.");
    return verifyChallenge(address, signed, isCurrent, trace, {
      "X-Challenge-Hash": await challengeHash(challenge.transaction),
    });
  });
}

/**
 * Check if stored JWT is expired and needs refresh.
 * Useful for preemptive re-auth before making API calls.
 */
export function isStoredTokenExpired(): boolean {
  const token = getStoredToken();
  return !token || isTokenExpired(token);
}

/**
 * Get TTL of stored JWT (time until expiry in milliseconds).
 * Returns 0 if token is invalid or expired.
 */
export function getStoredTokenTTL(): number {
  const token = getStoredToken();
  return token ? getTokenTTL(token) : 0;
}

/**
 * Single-flight re-authentication: ensures only one re-auth request is in flight.
 * Subsequent calls wait for the first one to complete instead of spawning new requests.
 *
 * This prevents the "thundering herd" problem when many API calls fail with 401
 * simultaneously and all try to re-auth at once.
 */
export async function ensureAuthWithSingleFlight(
  address: string,
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>,
): Promise<AuthSession> {
  // Check if re-auth is already in flight
  if (isReAuthInFlight()) {
    await waitForReAuth();
    // After waiting, return the current session (it may still fail if re-auth failed)
    const token = getStoredToken();
    const wallet = getStoredSessionWallet();
    if (!token || !wallet) throw new Error("Re-authentication failed");
    return { token, userId: "", walletAddress: wallet };
  }

  // Start new re-auth attempt
  const reAuthPromise = signInWithWallet(address, signTransaction);
  setReAuthPromise(reAuthPromise.then(() => undefined));

  try {
    const session = await reAuthPromise;
    setReAuthPromise(null);
    return session;
  } catch (error) {
    setReAuthPromise(null);
    throw error;
  }
}

export { clearAuthSession, getStoredSessionWallet, getStoredToken, isAuthError };
