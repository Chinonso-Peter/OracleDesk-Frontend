# Privacy: what this app collects

OracleDesk is usable with **no** error reporting and **no** analytics. Both
are opt-in, stored as choices in your browser only, and never enabled
implicitly. This document is the field-by-field inventory; it doubles as the
changelog (entries appended when an event or field changes).

## Error reports (`NEXT_PUBLIC_ERROR_REPORTING_DSN`)

Off unless the deployment sets a DSN **and** you consent. Consent lives in
`localStorage.oracledesk_error_reporting` (`granted` / `denied`), defaults to
**denied**, and Do Not Track (`navigator.doNotTrack === "1"`) and Global
Privacy Control are always treated as denied regardless of the stored value.

### Fields collected

| Field | Content |
| --- | --- |
| `id`, `timestamp` | Client-generated reference id (8 characters, shown in the UI) and ISO time |
| `release` | `NEXT_PUBLIC_BUILD_SHA` (commit the bundle was built from), else `dev` |
| `environment` | Network label (`Stellar Testnet` / `Stellar`) |
| `route` | Pathname only — never query strings or fragments |
| `level` | `error` / `warning` / `info` |
| `kind`, `code` | From `UserFacingError`: classification (`contract`, `network`, `rejected`, …) and contract error name (e.g. `SlippageExceeded`) |
| `apiCode`, `httpStatus` | Backend error envelope code and HTTP status |
| `message`, `stack` | Redacted error message and stack frames (browser-extension frames dropped) |
| `walletModule` | Wallet module id when known (e.g. `freighter`), else omitted |
| `breadcrumbs` | Route changes and mutation start/success/rejection markers — no amounts, no addresses |
| `tags` | `feature`, `error_name`, `wallet_module`, `contained_secret` (flag only) |
| `extra` | Explicitly attached context only; currently `txHash` on the paid-but-not-activated premium path |

### What is redacted before sending

Applied field-by-field and then again to the serialized event — if a JWT or
secret-seed pattern survives the second pass, the **whole event is dropped**:

- JWTs → `[jwt]`; Stellar secret seeds → `[secret]` (+ `contained_secret` tag).
- Public addresses (G/C/M StrKeys) → `G:1a2b3c4d`, the first 8 hex of
  HMAC-SHA256 with a random per-install salt (`localStorage.oracledesk_redact_salt`).
  The same address correlates within one install; nothing links across installs.
  Public contract ids from `CONTRACTS` are allowlisted and stay intact.
- Base64 runs over 80 characters (XDR, signatures) → `[xdr:<length>]`.
- URLs keep scheme + host + path; query strings and fragments are dropped.
- 64-hex strings stay (public transaction hashes) unless adjacent to
  `secret`/`priv`/`seed` wording.
- Object walk: depth ≤ 5, keys matching
  `token|authorization|signature|signed|secret|xdr|envelope|password` dropped,
  strings capped at 1 kB, arrays at 20 items, cycles broken.

Never collected: your wallet address in clear text, JWTs, secret seeds,
signatures, XDR, Authorization headers, exact amounts, form contents.

### Limits

10 events per minute; identical level+kind+code+message within 60 seconds is
sent once. Re-entrancy guard prevents error loops. Reporting failing never
breaks the app (send errors are swallowed).

### Opt-out

Settings → Privacy → turn off "Send anonymous error reports"; or clear site
data; or simply never answer the one-time prompt (it defaults to no).

## Analytics (`NEXT_PUBLIC_ANALYTICS_PROVIDER`)

_Not yet configured: this section is added with the analytics rollout._

## Changelog

- 2026-11-18: initial error-reporting inventory (issues #123).
