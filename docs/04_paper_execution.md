# 04 Paper Execution (Orders, Positions, PnL)

## 1. Position sizing
Inputs:
- marginUSDT
- leverage

Compute notional and quantity:
- `notional = marginUSDT * leverage`
- `qtyRaw = notional / entryPrice`

Then apply exchange-like rounding from instruments-info:
- price rounded to tickSize
- qty rounded down to qtyStep; enforce minQty

## 2. TP/SL derived from ROI (from margin)
For ROI targets based on margin and leverage:

Let:
- `rTP = tpRoiPct / 100`
- `rSL = slRoiPct / 100`
- `L   = leverage`

### LONG
- `tpPrice = entryPrice * (1 + rTP / L)`
- `slPrice = entryPrice * (1 - rSL / L)`

### SHORT
- `tpPrice = entryPrice * (1 - rTP / L)`
- `slPrice = entryPrice * (1 + rSL / L)`

## 3. Exit rule
Close when mark touches TP/SL:
- if mark touches TP first -> close at TP level price
- if mark touches SL first -> close at SL level price
- if both touched within same second, decide by first observed touch (based on tick processing order)

Exit is executed at the **level price** (TP/SL), not at current mark.

## 4. Fees (base, no VIP)
Config defaults:
- makerRate = 0.0001
- takerRate = 0.0006

v1 assumption:
- Entry and exit are limit-touch style -> use makerRate for fee estimation.

Fee model:
- `fee = executedNotional * feeRate`
- executedNotional ≈ price * qty

Apply:
- entry fee at entry fill
- exit fee at position close

## 5. Funding payments
At each funding timestamp:
- fundingPayment = positionNotional * fundingRate
- sign: LONG pays if fundingRate > 0; SHORT receives (and vice versa for negative rate)

Funding is included into realized PnL and ROI.

## 6. STOP behavior
On STOP:
- cancel all open entry orders
- close all open positions immediately using the same touch/price rules (implementation choice: close at current mark rounded to tickSize)
- freeze UI updates after stop confirmation
