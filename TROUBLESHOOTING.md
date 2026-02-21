# TROUBLESHOOTING.md

## WS disconnected / reconnecting
**Symptoms**
- Runtime page shows reconnecting state.
- Errors with `scope=BYBIT_WS` and `code=RECONNECTING`.

**Checks**
1. Verify backend is running (`/api/health`).
2. Check internet connectivity to Bybit public WS.
3. Review backend logs for reconnect loop attempts.

**Notes**
- Temporary reconnecting is expected during network blips.
- Strategy signal quality may degrade while feed is unstable.

---

## No symbols in universe
**Symptoms**
- Session starts but symbols count is 0 or unexpectedly low.

**Likely cause**
- Universe filters too strict.

**Actions**
- Lower `minVolatility24hPct`.
- Lower `minTurnover24hUSDT`.
- Increase `maxSymbols` (within practical performance limits).
- Use **Reset to defaults** to return to known-good baseline.

---

## `dataReady=false` / many STALE symbols
**Symptoms**
- Symbols table shows `STALE` gate badge.
- Strategy does not trigger on affected symbols.

**Likely cause**
- Missing/invalid funding fields or stale/missing ticker data for those symbols.

**Actions**
1. Wait for WS data warm-up after session start.
2. Confirm Bybit public feeds are stable.
3. Restart session if stale condition persists.

---

## Always COOLDOWN
**Symptoms**
- Session state remains `COOLDOWN`.
- `COOLDOWN` gate shown broadly.

**Likely causes**
- `beforeMin`/`afterMin` window too large.
- Funding timestamp parse or source-data issue.

**Actions**
1. Reduce cooldown values (or restore defaults 15/10).
2. Verify `nextFundingTime` fields are present and parseable.
3. Check event stream for repeated `cooldown_entered` without `cooldown_exited`.

---

## No trades
**Symptoms**
- Bot runs but no `signal_fired` / no orders.

**Likely causes**
- Thresholds too high for current market.
- Funding sign filter rejects candidates (LONG requires positive funding, SHORT negative).
- Cooldown window blocks evaluation.
- Symbols not `ARMED` / gates blocking.

**Actions**
1. Check symbols columns `priceMovePct`, `oivMovePct`, `funding.rate`, and `gates`.
2. Confirm thresholds and cooldown values are realistic.
3. Check statuses: only `ARMED` symbols can be evaluated.

---

## Eventlog not written
**Symptoms**
- No `data/sessions/<sessionId>/events.jsonl` file.

**Likely causes**
- Missing directory permissions.
- Invalid runtime path or process user mismatch.
- Session fails before writer initialization.

**Actions**
1. Verify write permissions to `data/` and `data/sessions/`.
2. Start session and confirm `session_started` appears in UI events.
3. Check backend startup path and logs for filesystem errors.
