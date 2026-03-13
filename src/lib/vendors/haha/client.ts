import { buildSignature, generateNonce, generateTimestamp } from "./signature";

/**
 * Haha Open Platform API client — endpoints per vendor PDF.
 *
 *   POST /open/auth/gettoken     — retrieve access_token
 *   GET  /open/order              — list orders (paginated)
 *   GET  /open/order/{order_no}   — order detail with product_list
 */

interface HahaConfig {
  host: string;
  appKey: string;
  appSecret: string;
}

/** Raw order from GET /open/order list (per Open Platform spec) */
export interface HahaOrderSummary {
  order_no: string;
  sticker_num: string;
  device_name?: string;
  status?: number | string;
  create_time: string;
  pay_time?: string;
  receivable: number | string;
  actual_payment_amount: number | string;
  total_amount?: number | string;
  is_refund?: number | string;
  refund_price?: number | string;
  source?: string;
  [key: string]: unknown;
}

/** Raw product from order detail product_list */
export interface HahaProductItem {
  product_no: string;
  product_name: string;
  amount: number | string;
  price_unit: number | string;
  actual_payment_amount?: number | string;
  receivable?: number | string;
  [key: string]: unknown;
}

/** Raw order detail from GET /open/order/{order_no} */
export interface HahaOrderDetail {
  order_no: string;
  sticker_num: string;
  create_time: string;
  pay_time?: string;
  status?: number | string;
  receivable: number | string;
  actual_payment_amount: number | string;
  product_list: HahaProductItem[];
  [key: string]: unknown;
}

function getConfig(): HahaConfig {
  const host = process.env.HAHA_HOST;
  const appKey = process.env.HAHA_APPKEY;
  const appSecret = process.env.HAHA_APPSECRET;

  if (!host || !appKey || !appSecret) {
    throw new Error(
      "Haha API credentials not configured. " +
      "Set HAHA_HOST, HAHA_APPKEY, and HAHA_APPSECRET in .env",
    );
  }

  return { host, appKey, appSecret };
}

// ---------------------------------------------------------------------------
// Token (cached — spec says valid for 15 days)
// ---------------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;

// Cache for 12 days (safety margin on 15-day spec validity)
const TOKEN_CACHE_MS = 12 * 24 * 60 * 60 * 1000;

/**
 * POST /open/auth/gettoken
 * Body: { appkey, appsecret }
 * Success: code === 1000, data.access_token
 *
 * Token is cached in memory for 12 days (spec allows 15).
 * Accepts both "msg" and "message" from Haha responses.
 */
export async function getToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const { host, appKey, appSecret } = getConfig();

  const res = await fetch(`${host}/open/auth/gettoken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appkey: appKey, appsecret: appSecret }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Haha gettoken failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as {
    code?: number;
    msg?: string;
    message?: string | Record<string, unknown>;
    data?: { access_token?: string };
  };

  const errorMsg =
    typeof body.message === "string"
      ? body.message
      : body.msg ?? JSON.stringify(body.message) ?? "no message";

  // Handle specific auth error codes per spec
  if (body.code === 1401 || body.code === 1402 || body.code === 1403) {
    cachedToken = null; // Invalidate cache on auth errors
    throw new Error(
      `Haha auth error (${body.code}): ${errorMsg}. ` +
      "Check appkey/appsecret configuration.",
    );
  }

  if (body.code !== 1000 || !body.data?.access_token) {
    throw new Error(
      `Haha gettoken error: code=${body.code} message=${errorMsg} ` +
      `data=${JSON.stringify(body.data)}`,
    );
  }

  // Cache the token
  cachedToken = {
    value: body.data.access_token,
    expiresAt: Date.now() + TOKEN_CACHE_MS,
  };

  console.log("[haha] Token acquired and cached (12-day window)");
  return body.data.access_token;
}

// ---------------------------------------------------------------------------
// Signed GET helper
// ---------------------------------------------------------------------------

/**
 * Signed GET request to the Haha API.
 * Returns the `data` property from the response body.
 *
 * Accepts both "msg" and "message" from Haha responses.
 */
async function signedGet<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const { host, appKey, appSecret } = getConfig();
  const timestamp = generateTimestamp();
  const nonce = generateNonce();

  const signature = buildSignature({
    params,
    headers: { nonce, timestamp, appkey: appKey },
    appSecret,
  });

  const qs = new URLSearchParams(params).toString();
  const url = `${host}${path}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      nonce,
      timestamp,
      appkey: appKey,
      signature,
      Authorization: token,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Haha API ${path} failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as {
    code?: number;
    msg?: string;
    message?: string | Record<string, unknown>;
    data?: T;
  };

  if (body.code !== 1000) {
    const errorMsg =
      typeof body.message === "string"
        ? body.message
        : body.msg ?? JSON.stringify(body);

    // Handle specific error codes per spec
    if (body.code === 1401 || body.code === 1402 || body.code === 1403) {
      cachedToken = null; // Invalidate token on auth errors
      throw new Error(
        `Haha auth error (${body.code}): ${errorMsg}. Token may be expired.`,
      );
    }
    if (body.code === -429) {
      throw new Error(
        `Haha rate limited (${body.code}): ${errorMsg}. Retry later.`,
      );
    }

    throw new Error(
      `Haha API ${path} error: code=${body.code} msg=${errorMsg}`,
    );
  }

  return body.data as T;
}

// ---------------------------------------------------------------------------
// Order list
// ---------------------------------------------------------------------------

/** Pagination envelope from GET /open/order */
interface HahaOrderListData {
  count: number;
  pageCount: number;
  pageNow: number;
  pageSize: number;
  list: HahaOrderSummary[];
  // Legacy fields (accept if present)
  total?: number;
}

/**
 * GET /open/order — paginated order list.
 * Fetches all pages automatically.
 *
 * Uses data.count + data.pageCount for pagination (matches live API).
 * Accepts start_time/end_time or pay_start_time/pay_end_time (YYYY-MM-DD).
 */
export async function listOrders(
  token: string,
  opts: {
    start_time?: string;
    end_time?: string;
    pay_start_time?: string;
    pay_end_time?: string;
    sticker_num?: string;
  } = {},
): Promise<HahaOrderSummary[]> {
  const allOrders: HahaOrderSummary[] = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const params: Record<string, string> = {
      page: String(page),
      limit: String(limit),
    };

    // Prefer pay_* params if provided
    if (opts.pay_start_time) params.pay_start_time = opts.pay_start_time;
    else if (opts.start_time) params.start_time = opts.start_time;

    if (opts.pay_end_time) params.pay_end_time = opts.pay_end_time;
    else if (opts.end_time) params.end_time = opts.end_time;

    if (opts.sticker_num) params.sticker_num = opts.sticker_num;

    const data = await signedGet<HahaOrderListData>(
      "/open/order",
      params,
      token,
    );

    if (!data?.list?.length) break;

    allOrders.push(...data.list);

    // Use pageCount for total pages (primary), fallback to count-based calc
    const totalPages = data.pageCount ?? Math.ceil((data.count ?? data.total ?? 0) / limit);
    if (page >= totalPages || data.list.length < limit) break;
    page++;
  }

  return allOrders;
}

// ---------------------------------------------------------------------------
// Order detail
// ---------------------------------------------------------------------------

/**
 * GET /open/order/{order_no} — single order with product_list.
 */
export async function getOrderDetail(
  token: string,
  orderNo: string,
): Promise<HahaOrderDetail> {
  return signedGet<HahaOrderDetail>(`/open/order/${orderNo}`, {}, token);
}
