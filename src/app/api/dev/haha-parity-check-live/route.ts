import { getTenantId } from "@/lib/tenant";
import { getToken, listOrders } from "@/lib/vendors/haha/client";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_PAGES = 10;
const TIMEOUT_MS = 30_000;

/**
 * GET /api/dev/haha-parity-check-live?date=YYYY-MM-DD
 *
 * LIVE vendor check — calls the Haha API to get order list for a single date.
 * Use this only for vendor troubleshooting, NOT for routine parity checks.
 *
 * Guardrails:
 *   - Single-date window only (no lookback)
 *   - pay_start_time/pay_end_time preferred (matches Haha app Sales view)
 *   - Capped at MAX_PAGES pages (1000 orders)
 *   - Hard timeout budget (30s), returns partial results if exceeded
 *   - NO per-order detail calls (uses list-level fields only)
 */
export async function GET(request: NextRequest) {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const t0 = performance.now();
    getTenantId(); // validate tenant exists

    const dateStr = request.nextUrl.searchParams.get("date");
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return NextResponse.json(
            { error: "Required: ?date=YYYY-MM-DD" },
            { status: 400 },
        );
    }

    // Compute next day for end bound
    const dateObj = new Date(dateStr + "T00:00:00Z");
    const nextDay = new Date(dateObj);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDate =
        nextDay.getUTCFullYear() +
        "-" +
        String(nextDay.getUTCMonth() + 1).padStart(2, "0") +
        "-" +
        String(nextDay.getUTCDate()).padStart(2, "0");

    let token: string;
    try {
        const tToken = performance.now();
        token = await getToken();
        console.log(
            `[parity-live] Token fetched in ${Math.round(performance.now() - tToken)}ms`,
        );
    } catch (err) {
        return NextResponse.json(
            {
                error: `Token failed: ${err instanceof Error ? err.message : err}`,
            },
            { status: 502 },
        );
    }

    // Fetch order list using pay_* filters (single day, bounded)
    const tList = performance.now();
    let timedOut = false;

    try {
        const orders = await Promise.race([
            listOrders(token, {
                pay_start_time: dateStr,
                pay_end_time: endDate,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)),
                    TIMEOUT_MS,
                ),
            ),
        ]);

        const tListEnd = performance.now();
        const listMs = Math.round(tListEnd - tList);

        // Classify from list-level fields
        const totalCount = orders.length;
        const totalSum =
            Math.round(
                orders.reduce((s, o) => {
                    const raw = o.actual_payment_amount;
                    const amt =
                        typeof raw === "string" ? parseFloat(raw)
                            : typeof raw === "number" ? raw
                                : 0;
                    if (Number.isNaN(amt)) {
                        console.warn(
                            `[parity-live] NaN actual_payment_amount for order ${o.order_no}: ${JSON.stringify(raw)}`,
                        );
                        return s;
                    }
                    return s + amt;
                }, 0) * 100,
            ) / 100;

        const tEnd = performance.now();

        return NextResponse.json({
            date: dateStr,
            mode: "live-vendor",
            source: "Haha API (pay_start_time/pay_end_time)",
            orderCount: totalCount,
            sumActualPayment: totalSum,
            timedOut,
            timing: {
                totalMs: Math.round(tEnd - t0),
                listFetchMs: listMs,
                hahaApiCalls: 1, // list endpoint (possibly multi-page internally)
                detailCalls: 0,
            },
            note:
                "Live vendor query. Compare orderCount and sumActualPayment to Haha app Sales view. " +
                `Fetched using pay_start_time=${dateStr}, pay_end_time=${endDate}. ` +
                `Max ${MAX_PAGES} pages.`,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        timedOut = message.includes("Timeout");

        return NextResponse.json({
            date: dateStr,
            mode: "live-vendor",
            error: message,
            timedOut,
            timing: {
                totalMs: Math.round(performance.now() - t0),
            },
            note: timedOut
                ? "Request timed out. The Haha API may be slow or the date range has too many orders."
                : "Haha API call failed. Check credentials and connectivity.",
        });
    }
}
