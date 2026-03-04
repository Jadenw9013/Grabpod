#!/usr/bin/env node

/**
 * Haha Open Platform — Token Smoke Test
 *
 * Deterministic POST to /open/auth/gettoken for diagnosing 1401 errors.
 * Never prints full appsecret or token.
 *
 * Environment variables:
 *   HAHA_HOST      (default: https://thorapi.hahabianli.com)
 *   HAHA_APPKEY    (required)
 *   HAHA_APPSECRET (required)
 */

const host = process.env.HAHA_HOST || "https://thorapi.hahabianli.com";
const appkey = process.env.HAHA_APPKEY;
const appsecret = process.env.HAHA_APPSECRET;

/* ── Validate ── */
const missing = [];
if (!appkey) missing.push("HAHA_APPKEY");
if (!appsecret) missing.push("HAHA_APPSECRET");
if (missing.length) {
    console.error(`❌  Missing env var(s): ${missing.join(", ")}`);
    console.error("   Set them before running this script. See docs/debug-haha.md");
    process.exit(1);
}

/* ── Redact helpers ── */
const redact = (s) =>
    s.length <= 6 ? "***" : `${s.slice(0, 3)}...${s.slice(-3)}`;

/* ── Request ── */
const url = `${host.replace(/\/+$/, "")}/open/auth/gettoken`;
const payload = JSON.stringify({ appkey, appsecret });

console.log("╔══════════════════════════════════════════");
console.log("║  Haha Token Smoke Test");
console.log("╠══════════════════════════════════════════");
console.log(`║  Host:            ${host}`);
console.log(`║  URL:             ${url}`);
console.log(`║  appkey:          ${redact(appkey)} (${appkey.length} chars)`);
console.log(`║  appsecret len:   ${appsecret.length} chars`);
console.log(`║  Payload bytes:   ${Buffer.byteLength(payload, "utf8")}`);
console.log(`║  Content-Type:    application/json`);
console.log("╠══════════════════════════════════════════");

try {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
    });

    console.log(`║  HTTP Status:     ${res.status} ${res.statusText}`);

    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        console.log("║  Raw body (not JSON):");
        console.log(`║  ${text.slice(0, 500)}`);
        console.log("╚══════════════════════════════════════════");
        process.exit(2);
    }

    console.log("║");
    console.log("║  Response JSON:");
    console.log(`║    success:   ${json.success}`);
    console.log(`║    code:      ${json.code}`);
    console.log(`║    message:   ${JSON.stringify(json.message)}`);
    if (json.data) {
        // Redact token if present
        const data = { ...json.data };
        if (data.token) data.token = redact(data.token);
        if (data.access_token) data.access_token = data.access_token;
        console.log(`║    data:      ${JSON.stringify(data)}`);
    }
    if (json.timestamp) {
        console.log(`║    timestamp: ${json.timestamp} (${new Date(json.timestamp * 1000).toISOString()})`);
    }

    console.log("╠══════════════════════════════════════════");

    if (json.code === 1401) {
        console.log("║");
        console.log("║  ⚠  Haha returned 1401 Authentication failed.");
        console.log("║");
        console.log("║  Common causes:");
        console.log("║    1) appkey / appsecret mismatch");
        console.log("║    2) Open Platform permission not enabled for this merchant");
        console.log("║    3) Credentials belong to a different environment (test vs prod)");
        console.log("║");
        console.log("║  Action: provide this full output to vendor support.");
        console.log("║");
    }

    console.log("╚══════════════════════════════════════════");
    process.exit(json.success ? 0 : 1);
} catch (err) {
    console.error(`║  ❌  Network error: ${err.message}`);
    console.log("╚══════════════════════════════════════════");
    process.exit(2);
}
