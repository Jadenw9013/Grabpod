/**
 * scripts/haha_verify_fields.ts
 *
 * Prints RAW HAHA API responses so we can verify exactly which fields exist.
 * Reuses the repo's signature logic and getToken() — does NOT modify any
 * existing code.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/haha_verify_fields.ts 2026-03-03
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local / .env manually (dotenv is not installed in this repo)
function loadEnvFile(filePath: string): void {
    try {
        const envFile = readFileSync(filePath, "utf-8");
        for (const line of envFile.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            // Strip surrounding quotes
            if ((val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (!process.env[key]) process.env[key] = val;
        }
    } catch {
        // file missing is fine
    }
}

// Try .env.local first (Next.js convention), then .env
const root = resolve(__dirname, "..");
loadEnvFile(resolve(root, ".env.local"));
loadEnvFile(resolve(root, ".env"));

import {
    buildSignature,
    generateNonce,
    generateTimestamp,
} from "../src/lib/vendors/haha/signature";
import { getToken } from "../src/lib/vendors/haha/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env var: ${name}`);
    return v;
}

/**
 * Raw signed GET — returns the FULL response body (not just `.data`).
 */
async function rawSignedGet(
    path: string,
    params: Record<string, string>,
    token: string,
): Promise<unknown> {
    const host = requireEnv("HAHA_HOST");
    const appKey = requireEnv("HAHA_APPKEY");
    const appSecret = requireEnv("HAHA_APPSECRET");

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

    return res.json();
}

// ---------------------------------------------------------------------------
// Safe money parser (per HAHA_API_DATA_CONTRACT.md)
// ---------------------------------------------------------------------------

function parseMoney(value: unknown, context: string): number {
    if (typeof value === "number") {
        if (Number.isNaN(value)) throw new Error(`NaN for ${context}`);
        return value;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") return 0;
        const parsed = parseFloat(trimmed);
        if (Number.isNaN(parsed)) throw new Error(`Cannot parse "${trimmed}" as number for ${context}`);
        return parsed;
    }
    if (value === null || value === undefined) return 0;
    throw new Error(`Unexpected type ${typeof value} for ${context}`);
}

// ---------------------------------------------------------------------------
// Types for raw HAHA order list items
// ---------------------------------------------------------------------------

interface RawOrder {
    order_no: string;
    sticker_num: string;
    status: number | string;
    actual_payment_amount: number | string;
    receivable: number | string;
    total_amount: number | string;
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const date = process.argv[2] ?? "2026-03-03";
    const pay_start_time = date;

    // Next day for an inclusive daily window
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    const pay_end_time =
        process.argv[3] ?? d.toISOString().slice(0, 10);

    console.log(
        `\nQuerying orders: ${pay_start_time} → ${pay_end_time}\n`,
    );

    // 1) Authenticate (reuses existing token cache / logic)
    const token = await getToken();

    // 2) Order LIST — fetch ALL pages (raw responses)
    const allOrders: RawOrder[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const rawResp = await rawSignedGet("/open/order", {
            pay_start_time,
            pay_end_time,
            limit: "100",
            page: String(page),
        }, token);

        if (page === 1) {
            console.log("=== HAHA ORDER LIST RESPONSE (page 1) ===\n");
            console.log(JSON.stringify(rawResp, null, 2));
        }

        const resp = rawResp as Record<string, unknown>;
        const data = resp?.data as Record<string, unknown> | undefined;
        const list = (data?.list ?? []) as RawOrder[];
        allOrders.push(...list);

        // Update total pages from response
        totalPages = (data?.pageCount as number) ?? 1;
        if (list.length < 100) break; // no more data
        page++;
    }

    if (page > 1) {
        console.log(`\n[Fetched ${page} page(s), ${allOrders.length} total orders]`);
    }

    // 3) Compute PARITY METRICS
    console.log("\n=== PARITY METRICS ===\n");

    // All orders (any status)
    const allCount = allOrders.length;
    let allSumActual = 0;
    let allSumReceivable = 0;
    let allItemsSold = 0;

    for (const o of allOrders) {
        allSumActual += parseMoney(o.actual_payment_amount, `order ${o.order_no} actual_payment_amount`);
        allSumReceivable += parseMoney(o.receivable, `order ${o.order_no} receivable`);
        allItemsSold += parseMoney(o.total_amount, `order ${o.order_no} total_amount`);
    }

    // Paid-only (status = 101) — this is what HAHA app reports
    const paidOrders = allOrders.filter((o) => {
        const s = typeof o.status === "string" ? parseInt(o.status, 10) : o.status;
        return s === 101;
    });
    const paidCount = paidOrders.length;
    let paidSumActual = 0;
    let paidSumReceivable = 0;
    let paidItemsSold = 0;

    for (const o of paidOrders) {
        paidSumActual += parseMoney(o.actual_payment_amount, `order ${o.order_no} actual_payment_amount`);
        paidSumReceivable += parseMoney(o.receivable, `order ${o.order_no} receivable`);
        paidItemsSold += parseMoney(o.total_amount, `order ${o.order_no} total_amount`);
    }

    // Status breakdown
    const statusCounts: Record<number, number> = {};
    for (const o of allOrders) {
        const s = typeof o.status === "string" ? parseInt(o.status, 10) : (o.status ?? 0);
        statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    console.log("ALL ORDERS (any status):");
    console.log(`  orderCount:         ${allCount}`);
    console.log(`  sumActualPayment:   $${(Math.round(allSumActual * 100) / 100).toFixed(2)}`);
    console.log(`  sumReceivable:      $${(Math.round(allSumReceivable * 100) / 100).toFixed(2)}`);
    console.log(`  itemsSold:          ${allItemsSold}`);

    console.log(`\nPAID ONLY (status=101) — compare to HAHA app:`);
    console.log(`  orderCount:         ${paidCount}`);
    console.log(`  sumActualPayment:   $${(Math.round(paidSumActual * 100) / 100).toFixed(2)}`);
    console.log(`  sumReceivable:      $${(Math.round(paidSumReceivable * 100) / 100).toFixed(2)}`);
    console.log(`  itemsSold:          ${paidItemsSold}`);

    console.log(`\nSTATUS BREAKDOWN:`);
    for (const [s, c] of Object.entries(statusCounts).sort()) {
        const label = s === "101" ? "paid" : s === "200" ? "pending" : "other";
        console.log(`  status=${s} (${label}): ${c} orders`);
    }

    // 4) Order DETAIL — pick the first order_no from the list
    const firstOrderNo: string | undefined = allOrders[0]?.order_no;

    if (!firstOrderNo) {
        console.log(
            "\nNo orders returned for that window — " +
            "cannot call /open/order/{order_no}.",
        );
        process.exit(0);
    }

    const detailResponse = await rawSignedGet(
        `/open/order/${firstOrderNo}`,
        {},
        token,
    );

    console.log("\n=== HAHA ORDER DETAIL RESPONSE ===\n");
    console.log(JSON.stringify(detailResponse, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
