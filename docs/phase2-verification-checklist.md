# Phase 2 — Manual Verification Checklist

Run `pnpm dev` first, then execute these curl commands against `http://localhost:3000`.

## 1. Tenant auth hardening (401 on missing tenant)

Temporarily unset `DEV_TENANT_ID` in `.env`, restart the dev server, then:

```bash
# Should return 401, not 500
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/warehouse/stock
# Expected: 401

curl -s http://localhost:3000/api/warehouse/stock | jq .
# Expected: {"error":"Unauthorized: tenant not configured"}
```

Restore `DEV_TENANT_ID` and restart.

## 2. Upload validation

```bash
# a) Missing file field → 400
curl -s -X POST http://localhost:3000/api/import/product-sales-details-xlsx | jq .
# Expected: {"error":"Invalid form data"} or {"error":"Missing \"file\" field..."}

# b) Wrong extension → 400
echo "not xlsx" > /tmp/test.txt
curl -s -X POST -F "file=@/tmp/test.txt" http://localhost:3000/api/import/product-sales-details-xlsx | jq .
# Expected: {"error":"Only .xlsx and .xls files are accepted"}

# c) Same for orders-xlsx
curl -s -X POST -F "file=@/tmp/test.txt" http://localhost:3000/api/import/orders-xlsx | jq .
# Expected: {"error":"Only .xlsx and .xls files are accepted"}
```

## 3. Restock complete — transaction safety

```bash
# a) Generate a session first
curl -s -X POST http://localhost:3000/api/restock/generate \
  -H "Content-Type: application/json" -d '{}' | jq .
# Note the sessionId (or "No machines need restocking" if no inventory)

# b) Complete with invalid session → 404
curl -s -X POST http://localhost:3000/api/restock/complete \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"00000000-0000-0000-0000-000000000000","updates":[{"machineId":"00000000-0000-0000-0000-000000000001","productId":"00000000-0000-0000-0000-000000000001","newStockRemain":5}]}' | jq .
# Expected: {"error":"Session not found"} with status 404

# c) Payload too large → 400
# (501 items in updates array should fail Zod .max(500) validation)
```

## 4. Profitability API

```bash
# a) This month
curl -s "http://localhost:3000/api/analytics/profitability?month=this" | jq .
# Expected: {"range":{"start":"...","end":"..."},"topProducts":[...]}
# Verify start/end are UTC month boundaries

# b) Previous month
curl -s "http://localhost:3000/api/analytics/profitability?month=previous" | jq .
# Verify range.start is first of previous month in UTC
```

## 5. Restock sessions list

```bash
curl -s http://localhost:3000/api/restock/sessions | jq .
# Expected: array of sessions with durationMinutes computed
```

## 6. Health check (no tenant needed)

```bash
curl -s http://localhost:3000/api/health/db | jq .
# Expected: {"ok":true}
```

## 7. force-dynamic verification

All DB-backed pages should have `export const dynamic = "force-dynamic"`.
Verify in build output: pages marked with `f` (Dynamic) are:
- /dashboard, /machines, /machines/[machineId], /rankings, /restock-queue, /sync
- API routes are all dynamic by nature

Static pages (marked `o`): /, /_not-found, /imports, /product-import, /profitability, /restock-sessions
(These are client components that fetch data at runtime, so static shell is correct.)
