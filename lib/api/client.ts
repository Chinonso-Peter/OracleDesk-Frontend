import type { UserScope } from "@/lib/query/scope";
import { currentTrace, newTrace, toTraceparent, type TraceCtx } from "@/lib/observability/tracing";

export interface ApiRequestOptions { expectScope?: UserScope; signal?: AbortSignal; trace?: TraceCtx }
const sessionListeners = new Set<() => void>();
const authInvalidListeners = new Set<() => void>();
export function onAuthSessionChanged(listener: () => void) {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
export function onAuthInvalid(listener: () => void) {
  authInvalidListeners.add(listener);
  return () => { authInvalidListeners.delete(listener); };
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  /** Seconds from the response's `Retry-After` header (429 / 409), when the backend sent one. */
  retryAfterSeconds?: number;
  /** First 8 hex of the client trace id sent as `traceparent` / `X-Request-Id` (issue #124), for log correlation. */
  requestId?: string;

  constructor(error: ApiErrorPayload, status: number, retryAfterSeconds?: number, requestId?: string) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.status = status;
    this.details = error.details;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** `Retry-After` is either delay-seconds or an HTTP date (RFC 9110 §10.2.3). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error: ApiErrorPayload | null;
  meta?: unknown;
}

type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface ApiResponse<T> {
  data: T;
  meta?: unknown;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://oracledesk-backend.onrender.com/api/v1";
const TOKEN_KEY = "oracledesk_token";
const USER_ID_KEY = "oracledesk_user_id";
const WALLET_KEY = "oracledesk_wallet";
const SESSION_KEY = "oracledesk_session_id";

function getBrowserStorage() {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

function buildUrl(path: string, params?: QueryParams) {
  const url = new URL(path.replace(/^\//, ""), `${API_URL.replace(/\/$/, "")}/`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
}

export function getStoredToken() {
  return getBrowserStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function getStoredSessionId() {
  if (!getStoredToken()) return null;
  const storage = getBrowserStorage();
  // Upgrade sessions saved before scope ids existed without putting JWTs in keys.
  let id = storage?.getItem(SESSION_KEY) ?? null;
  if (!id && storage && typeof storage.setItem === "function") {
    try { id = crypto.randomUUID(); storage.setItem(SESSION_KEY, id); }
    catch { return null; }
  }
  return id;
}

export function storeAuthSession(session: { token: string; userId: string; walletAddress: string }) {
  const storage = getBrowserStorage();
  storage?.setItem(TOKEN_KEY, session.token);
  storage?.setItem(USER_ID_KEY, session.userId);
  storage?.setItem(WALLET_KEY, session.walletAddress);
  storage?.setItem(SESSION_KEY, crypto.randomUUID());
  sessionListeners.forEach((listener) => listener());
}

/** Wallet address the stored session belongs to, if any. */
export function getStoredSessionWallet() {
  const storage = getBrowserStorage();
  return storage?.getItem(TOKEN_KEY) ? storage.getItem(WALLET_KEY) : null;
}

export function clearAuthSession() {
  const storage = getBrowserStorage();
  storage?.removeItem(TOKEN_KEY);
  storage?.removeItem(USER_ID_KEY);
  storage?.removeItem(WALLET_KEY);
  storage?.removeItem(SESSION_KEY);
  sessionListeners.forEach((listener) => listener());
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  params?: QueryParams,
  options: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const assertScope = () => {
    const expected = options.expectScope;
    if (expected && (expected.sessionId !== getStoredSessionId() ||
        (expected.sessionId !== null && expected.wallet !== getStoredSessionWallet()))) {
      throw new ApiError({ code: "SCOPE_CHANGED", message: "Your account changed; this result was not applied." }, 0);
    }
    options.signal?.throwIfAborted();
  };
  assertScope();
  const token = getStoredToken();
  const requestSessionId = getStoredSessionId();
  const headers = new Headers(init.headers);

  // Issue #124: correlate this request with the active operation (or a fresh
  // trace) so backend logs and client reports share one reference id.
  const trace = options.trace ?? currentTrace() ?? newTrace();
  const requestId = trace.traceId.slice(0, 8);
  if (!headers.has("traceparent")) headers.set("traceparent", toTraceparent(trace));
  if (!headers.has("X-Request-Id")) headers.set("X-Request-Id", requestId);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      ...init,
      signal: options.signal ?? init.signal,
      headers,
    });
  } catch (error) {
    // Standard browser error for network failures (including ECONNREFUSED)
    if (error instanceof TypeError && (error.message === "Failed to fetch" || error.message.includes("NetworkError"))) {
      throw new ApiError(
        {
          code: "BACKEND_UNREACHABLE",
          message: `Could not connect to the API server. Please ensure the backend is running at ${API_URL}`,
        },
        0,
        undefined,
        requestId,
      );
    }
    throw error;
  }

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  const apiError = envelope?.error;
  // An old response (including a 401) must never affect a newer session.
  assertScope();

  if (!response.ok || envelope?.ok === false) {
    if (token && token === getStoredToken() && requestSessionId === getStoredSessionId() && ["TOKEN_EXPIRED", "INVALID_TOKEN", "UNAUTHORIZED"].includes(apiError?.code ?? "")) {
      clearAuthSession();
      authInvalidListeners.forEach((listener) => listener());
    }

    // Prefer the backend's own id when it echoes one (issue #124).
    const serverRequestId = response.headers.get("x-request-id") ?? undefined;

    throw new ApiError(
      apiError ?? {
        code: `HTTP_${response.status}`,
        message: response.statusText || "Request failed",
      },
      response.status,
      parseRetryAfter(response.headers.get("Retry-After")),
      serverRequestId ?? requestId,
    );
  }

  return {
    data: envelope?.data as T,
    meta: envelope?.meta,
  };
}

/**
 * Enhanced error handling with JWT expiry detection.
 * Returns true if the error indicates an expired or invalid token that needs re-auth.
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.code === "TOKEN_EXPIRED" || error.code === "INVALID_TOKEN" || error.code === "UNAUTHORIZED" || error.status === 401;
  }
  return false;
}

export const apiClient = {
  get<T>(path: string, params?: QueryParams, options?: ApiRequestOptions) {
    return request<T>(path, { method: "GET" }, params, options);
  },

  post<T>(path: string, body?: unknown, headers?: HeadersInit, options?: ApiRequestOptions) {
    return request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
    }, undefined, options);
  },

  put<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return request<T>(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    }, undefined, options);
  },

  patch<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
    return request<T>(path, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    }, undefined, options);
  },
  delete<T>(path: string) {
    return request<T>(path, { method: "DELETE" });
  },
};
