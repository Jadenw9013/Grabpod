# Debugging Haha Open Platform Auth

We currently receive `code: 1401` (Authentication failed, message `{"L006936":[]}`) when calling the Haha token endpoint. This doc explains how to reproduce and gather diagnostics for vendor support.

## Environment Variables

| Var | Required | Default |
|---|---|---|
| `HAHA_HOST` | No | `https://thorapi.hahabianli.com` |
| `HAHA_APPKEY` | Yes | — |
| `HAHA_APPSECRET` | Yes | — |

## Option 1: Node Script (local / CI)

```powershell
# PowerShell
$env:HAHA_APPKEY="your-appkey-here"
$env:HAHA_APPSECRET="your-appsecret-here"
node .\scripts\haha-smoke-test.mjs
```

```bash
# bash / CI
HAHA_APPKEY=your-appkey-here HAHA_APPSECRET=your-appsecret-here node scripts/haha-smoke-test.mjs
```

The script prints redacted diagnostics (never the full secret) and exits non-zero on failure.

## Option 2: Debug API Route (deployed)

```
GET /api/debug/haha-token
```

**Production guard**: requires `x-debug-token` header that matches the `DEBUG_TOKEN` env var on the server.

```bash
curl -H "x-debug-token: YOUR_DEBUG_TOKEN" "https://your-app.vercel.app/api/debug/haha-token"
```

In development (`NODE_ENV !== "production"`), no token is required:

```
http://localhost:3000/api/debug/haha-token
```

## What 1401 Means

Haha error `1401` with message `{"L006936":[]}` indicates authentication failure. Common causes:

1. **appkey / appsecret mismatch** — double-check credentials in merchant dashboard
2. **Open Platform not enabled** — the merchant account may not have API access activated
3. **Wrong environment** — test vs production credentials

**Action**: copy the full script output or API response JSON and send it to Haha vendor support.
