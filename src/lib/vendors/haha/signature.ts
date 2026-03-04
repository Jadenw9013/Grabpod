import { createHmac, randomUUID } from "crypto";

/**
 * Haha Open Platform HMAC-SHA256 request signing (per vendor PDF).
 *
 * Algorithm:
 *   1. Merge all query params + common headers (nonce, timestamp, appkey) into one map
 *   2. Exclude the "signature" key itself
 *   3. Trim all values
 *   4. Sort by key alphabetically
 *   5. Build string: "key1=value1&key2=value2&..."
 *   6. HMAC-SHA256(string, appsecret) → lowercase hex
 */
export function buildSignature(opts: {
  /** Query parameters for the request */
  params: Record<string, string>;
  /** Common header values: nonce, timestamp, appkey */
  headers: { nonce: string; timestamp: string; appkey: string };
  appSecret: string;
}): string {
  const { params, headers, appSecret } = opts;

  // Merge params + header fields into one map (excluding "signature")
  const merged: Record<string, string> = { ...params };
  merged["nonce"] = headers.nonce;
  merged["timestamp"] = headers.timestamp;
  merged["appkey"] = headers.appkey;

  // Sort by key, trim values, build key=value&... string
  const signingString = Object.keys(merged)
    .sort()
    .map((k) => `${k}=${String(merged[k]).trim()}`)
    .join("&");

  return createHmac("sha256", appSecret)
    .update(signingString)
    .digest("hex");
}

export function generateNonce(): string {
  return randomUUID().replace(/-/g, "");
}

export function generateTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}
