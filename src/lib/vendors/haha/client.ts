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

/** Raw order from GET /open/order list */
export interface HahaOrderSummary {
  order_no: string;
  sticker_num: string;
  create_time: string;
  receivable: number | string;
  actual_payment_amount: number | string;
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
// Token
// ---------------------------------------------------------------------------

/**
 * POST /open/auth/gettoken
 * Body: { appkey, appsecret }
 * Success: code === 1000, data.access_token
 *
 * Note: Haha API returns "message" (not "msg") in its responses.
 * We accept both for resilience.
 */
export async function getToken(): Promise<string> {
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

  if (body.code !== 1000 || !body.data?.access_token) {
    throw new Error(
      `Haha gettoken error: code=${body.code} message=${errorMsg} ` +
      `data=${JSON.stringify(body.data)}`,
    );
  }

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
