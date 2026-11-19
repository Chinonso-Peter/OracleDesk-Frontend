# Requests for the contracts repo

Things this repo would like changed in
[OracleDesk-SmartContract](https://github.com/OracleDesk/OracleDesk-SmartContract)
(`oracledesk-stellar/`). The frontend works around each one; none of them
block the port. File them there, not here.

## 1. Doc fix: wrong path to the FPMM TypeScript port

`docs/frontend-integration.md` line 73 says the sell-side math lives at
`agents/core/src/fpmm.ts`. The file is `agents/core/fpmm.ts` (there is no
`src/` directory under `agents/core`).

Verified with:

```bash
ls contracts/oracledesk-stellar/agents/core/src   # No such file or directory
ls contracts/oracledesk-stellar/agents/core/fpmm.ts
```

## 2. Publish the FPMM math with the bindings

`agents/core/fpmm.ts` is the only TypeScript implementation of the
contract's pricing math, and every client that wants `priceYesBps` or
"sell N shares" needs it. Today each consumer copies it out of `agents/`
(this repo does so in `scripts/sync-bindings.mjs`). Shipping it as part of a
bindings package, or as a tiny `@oracledesk/fpmm` package, would give it a
version number and remove the copy step.

## 3. A way to get test USDC

`deployments/testnet.json` points at a self-issued test USDC: the classic
asset `USDC:<deployer G-address>` wrapped in a Stellar Asset Contract
(`scripts/deploy-testnet.sh`, `stellar contract asset deploy`). A tester's
account needs a trustline to that asset, and only the deployer key can
`mint`. There is no faucet, so a new tester cannot get collateral without
asking a maintainer to mint by hand. A small, rate-limited
faucet script (or an admin `mint` helper in `scripts/`) would make the manual
test plan in `docs/manual-test.md` self-serve.

## 4. Export `ResolutionSpec` in the resolver bindings

The resolver contract hashes `ResolutionSpec` (an enum wrapping
`PriceConfig` or `SignerConfig`), but because no entrypoint takes it as an
argument it is not in the generated TypeScript. Off-chain code that needs
the commitment hash has to rebuild the XDR by hand. A no-op view function
that takes a `ResolutionSpec`, or a `spec_hash(spec) -> BytesN<32>` view,
would put the type in the spec and let clients ask the contract for the
hash instead of re-implementing it.


## 5. `grossForShares` in FPMM can round up, causing `calcSell` to require more shares than requested

In `agents/core/fpmm.ts` (and `contracts/market-core/src/math.rs`), `grossForShares` computes the gross complete sets to burn for a desired `sharesIn`:

```ts
const root = isqrt(disc);
const gross = (b - root) / 2n;
```

Because `root = isqrt(disc) = floor(sqrt(disc))`, subtracting `root` computes `b - floor(sqrt) = ceil(b - sqrt)`. The subsequent integer division by 2 can result in `ceil(exactRoot)` rather than `floor(exactRoot)`.
When this estimated `gross` is converted to `collateralOut` and passed to `calcSell` (or on-chain `sell`), `calcSell` computes `sharesIn` which can exceed the requested `sharesIn` by 1 to 3 base units (especially in skewed markets where $r_{sold} > r_{other}$).
Because the frontend pads `max_shares_in` by `maxIn(shares, slippageBps) + 1n`, at 0 slippage `max_shares_in = shares + 1n`. When `calcSell.sharesIn == shares + 2n`, on-chain `sell` reverts with `SlippageExceeded` or `InsufficientShares`.

### Counterexample
- Reserves: `rSold = 1000000000n`, `rOther = 555451858n`, `feeBps = 0n`
- `sharesIn = 55n`
- `collateralOutForShares` returns `20n`
- `calcSell(1000000000n, 555451858n, 20n, 0n)` produces `sharesIn = 57n`
- Difference: $57 - 55 = 2$ base units ($> +1$ padding)

### Replay Command
```bash
stellar contract invoke --id $MARKET_CORE --network localnet -- quote_sell --market_id <id> --outcome '"No"' --collateral_out 20
```

### Proposed Fix
Ensure `grossForShares` computes a true floor, e.g. using `ceil_isqrt` or checking `calcSell(rSold, rOther, gross, feeBps).sharesIn <= sharesIn` and decrementing `gross` if it overshoots.
