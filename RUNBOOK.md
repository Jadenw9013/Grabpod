# Haha ↔ GrabPod Parity Check Runbook

## Purpose

Compare order data in GrabPod's database against the Haha app to verify sync accuracy.

## Key Concepts

| Term | Meaning |
|---|---|
| **Paid** (status=101) | Order fully paid — should match Haha app "Sales" |
| **Pending** (status=200) | In-progress, may show $0.00 — expected to differ |
| **Unknown** (status=0) | Status not provided by API (legacy orders) |

> **Note:** The Haha API uses day-level granularity (YYYY-MM-DD). Minute-level parity is not achievable.

## Step-by-Step

### 1. Choose a date to verify

Pick a date where you can see the Haha app's Sales totals. Typically today or yesterday.

### 2. Note the Haha app numbers

Open the Haha app → Sales view for that date. Record:
- **Paid order count**
- **Total paid amount** (actual_payment_amount)

### 3. Run the parity check

```powershell
# Replace YYYY-MM-DD with your date
Invoke-RestMethod "http://localhost:3000/api/dev/haha-parity-check?date=2026-03-03" | ConvertTo-Json -Depth 3
```

Or use curl:
```bash
curl "http://localhost:3000/api/dev/haha-parity-check?date=2026-03-03"
```

### 4. Compare results

| Haha App | GrabPod Endpoint | Should Match? |
|---|---|---|
| Paid order count | `paid.count` | ✅ Yes |
| Total paid amount | `paid.sumActualPayment` | ✅ Yes (within rounding) |
| N/A | `pending.count` | ⚠️ Expected to differ |

### 5. Acceptable tolerances

- **Paid count**: should match exactly (±0)
- **Paid sum**: should match within $0.01 (floating-point rounding)
- **Pending orders**: expected to NOT match — they haven't completed payment
- **Unknown (status=0)**: legacy orders synced before status tracking was added; will resolve on next sync

### 6. If numbers don't match

1. **Run a fresh sync**: `POST http://localhost:3000/api/sync/haha`
2. **Re-run parity check** after sync completes
3. **Check for pending→paid transitions**: Pending orders may have been paid since last sync
4. **Verify the lookback window**: Default is 5 days. If the order was created >5 days ago, increase `lookbackDays`

### 7. Sync frequency recommendation

| Use Case | Frequency |
|---|---|
| Financial reporting | Daily (end of day) |
| Operational dashboard | Every 2-4 hours |
| Near-real-time | Every 15 min (risk: rate limiting) |

## Technical Notes

- Dual-window fetch: sync queries both `start_time` (create date) AND `pay_start_time` (pay date)
- Orders are deduped by `order_no` (upsert)
- $0.00 → paid transitions are captured on re-sync (status + amount updated)
- All queries tenant-scoped
