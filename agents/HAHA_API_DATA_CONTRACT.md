# HAHA Data Contract Agent (Grabpod / Antigravity)
**Purpose:** Ensure Claude (or any dev agent) consistently and correctly ingests + aggregates HAHA data with **HAHA as the single source of truth** for transactional sales/orders, and avoids hallucinated fields.

This document is **grounded in real terminal evidence** from a live HAHA `/open/order/{order_no}` response captured on 2026-03-04.

---

## 0) Non-negotiable rules

1) **Never invent fields.** Only use fields confirmed in HAHA API responses (print raw JSON when unsure).
2) **Do not rely on seed/mock business data** for anything that should come from HAHA (orders, sales, device usage).
3) Treat HAHA responses as authoritative; if the UI needs extra columns (APEX number, cost, tax, user email), those must come from a **separate internal dataset** (e.g., your own SKU/cost mapping table). Do not pretend HAHA provides them.

---

## 1) Verified HAHA order detail shape (evidence-based)

From a real terminal dump:

### Order detail response (top-level)
- `success`: string (example: `"true"`)
- `code`: number (success is `1000`)
- `message`: string (can contain non-human-readable codes)
- `data`: object
- `timestamp`: number
- `errorInfo`: nullable
- `errorMessage`: string

### `data` fields (order-level)
**These are confirmed present:**
- `order_no`: string  
- `sticker_num`: string  
- `device_address`: string  
- `device_name`: string  
- `currency_symbol`: string  
- `receivable`: string (money, often string)  
- `consumption_time`: string `"YYYY-MM-DD HH:mm:ss"`  
- `create_time`: string `"YYYY-MM-DD HH:mm:ss"`  
- `pay_time`: string `"YYYY-MM-DD HH:mm:ss"` or null  
- `pay_user_card`: string (masked)  
- `pay_method_label`: string (can be a label/code)  
- `actual_payment_amount`: number (but may vary; see type rules)  
- `product_list`: array of product rows

### `product_list[]` fields (product-level)
**These are confirmed present:**
- `product_no`: string  
- `product_name`: string  
- `amount`: number (quantity)  
- `price_unit`: string (money string)  
- `actual_payment_amount`: string (money string — note type mismatch vs order-level)  
- `total_price`: string (money string)  
- `receivable`: string (money string)

---

## 2) Field mapping to dashboard/report columns

### Columns you CAN populate directly from HAHA (detail response)
| Desired Column | Source |
|---|---|
| Product | `product_list[].product_name` |
| Order number | `data.order_no` |
| Sales volume (quantity) | `product_list[].amount` (product-level) |
| Items subtotal | Derive: sum of `product_list[].total_price` (string→number) OR use `data.receivable` depending on definition |
| Amount Received | Prefer order-level `data.actual_payment_amount` |
| Amount Receivable | `data.receivable` |
| Device number | `data.sticker_num` |
| User Card | `data.pay_user_card` |
| Status | **Not in detail response shown** (usually present in order list; verify there) |
| Creation time | `data.create_time` |
| Payment time | `data.pay_time` |

### Columns you CANNOT get from HAHA (must come from elsewhere)
| Desired Column | Why |
|---|---|
| APEX number | Not provided in order detail response |
| Tax | Not provided |
| Cost | Not provided |
| User email | Not provided |

**Rule:** If UI requires APEX/cost/tax/email, display `—` unless you can join with a verified internal mapping table.

---

## 3) Money + type handling (critical to avoid incorrect totals)

HAHA returns money fields inconsistently as **strings or numbers**.

### Confirmed inconsistency (from evidence)
- `data.actual_payment_amount` was a **number**: `3.74`
- `product_list[].actual_payment_amount` was a **string**: `"3.74"`

### Required parsing rules
1) Create a `parseMoney(value)` utility:
   - Accepts `string | number | null | undefined`
   - If string: trim and parse decimal
   - If number: use as-is
   - If null/empty: return null (NOT 0 silently)
   - Throw a descriptive error if parsing fails (include field name and raw value)

2) Never do `Number(x) || 0` on money.
   - This masks parsing failures and can drift totals quietly.

3) Use **decimal-safe** math for aggregation if possible:
   - Convert to integer cents (multiply by 100 and round) before summing.
   - Or use a decimal library if already in repo.

---

## 4) Time window rules (to match HAHA app totals)

HAHA supports filtering by:
- **pay_time window**: `pay_start_time`, `pay_end_time`
- **create_time window**: `start_time`, `end_time`

**Rule:** Dashboards that reflect “sales” should generally aggregate by **payment time**, not creation time.

### Recommended daily window
To compute totals for a day D (local business day):
- `pay_start_time = D`
- `pay_end_time = D + 1 day`

**Important:** Keep window logic consistent across backend and UI.

---

## 5) Pagination rules (must fetch all pages)

When pulling order list:
- Always request `limit <= 100`
- Loop `page = 1..pageCount`
- Stop only after retrieving all pages (do not assume `count` fits in one page)

**Anti-bug rule:** If you only pull page 1, totals will be too low.

---

## 6) Aggregation definitions (be explicit)

When computing dashboard metrics, define each metric precisely:

### A) Total Revenue (recommended)
Sum of **order-level** actual payment:
- `SUM(order.actual_payment_amount)` from order list
- Or from order detail if you fetch per order (slower)

### B) Total Receivable
- `SUM(order.receivable)` (note: may differ from received)

### C) Orders Count
- Count of orders included in the window after filtering.

### D) Items Sold
- `SUM(order.total_amount)` (from order list) OR sum of product_list amounts (detail).

---

## 7) Status filtering rules (avoid counting unpaid/in-progress)

HAHA order list provides a `status` enum.
**Rule:** When computing paid sales, include only statuses that represent completed payment.

Suggested safe default:
- Include `status == 101` (Paid)
- Exclude unpaid/in-progress/unknown statuses unless business explicitly wants them

If your app includes additional statuses (like partial paid), document it and include it intentionally.

---

## 8) Required verification commands (every change)

Before merging anything affecting HAHA ingestion:
1) Run a terminal dump script that prints raw JSON for:
   - Order list for a date window
   - One order detail
2) Copy/paste the raw JSON snippet into the PR or dev notes as evidence.
3) Run:
   - `pnpm lint`
   - `pnpm build`

---

## 9) “No hallucinations” operating procedure for Claude

If asked “Can we grab field X from HAHA?” Claude must:

1) Run or request a terminal dump of the relevant endpoint.
2) Search for the field name in the raw response.
3) Answer:
   - ✅ Yes: show exact JSON path (e.g., `data.pay_time`)
   - ❌ No: say “not present in HAHA response” and propose where it could come from (internal mapping table), WITHOUT guessing.

---

## 10) Open issues to confirm next (do not assume)

1) Order list response shape in your environment (verify raw `/open/order`):
   - Confirm presence and types of:
     - `status`
     - `total_amount`
     - `actual_payment_amount` type (string vs number)
2) Whether HAHA app “Sales” uses:
   - actual received vs receivable
   - paid-only statuses
   - pay_time vs create_time

---

## Appendix: Evidence snippet (from terminal)

Order detail evidence included:
- `data.order_no`, `data.sticker_num`, `data.receivable`, `data.actual_payment_amount`
- `product_list[0].product_no`, `product_list[0].product_name`, `product_list[0].amount`, etc.

This document must be updated if HAHA response shape changes.