/**
 * POST|GET /api/dev/sync-haha-now
 *
 * Manual catch-up sync — bypasses the background poller entirely.
 *
 * Query params:
 *   ?force=1  → ignore DB maxPayTime, sync last 7 days
 *
 * Default behaviour:
 *   - Window = last 48 hours (pay_start_time → pay_end_time)
 *   - If DB's max OrderHeader.payTime is older than 48h, expands window
 *     from (maxPayTime − 1 hour) to now
 *
 * Returns JSON with: runId, status, importedOrders, importedLines,
 * maxPayTimeInDbBefore, maxPayTimeInDbAfter, window, durationMs
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runHahaSync } from "@/lib/sync/run-haha-sync";

export const dynamic = "force-dynamic";

/** Format Date to YYYY-MM-DD */
function fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

async function handleManualSync(request: NextRequest) {
    const tenantId = process.env.DEV_TENANT_ID;
    if (!tenantId) {
        return NextResponse.json({ error: "DEV_TENANT_ID not set" }, { status: 500 });
    }

    const force = request.nextUrl.searchParams.get("force") === "1";
    const t0 = Date.now();

    try {
        // 1. Snapshot: max payTime in DB before sync
        const latestBefore = await prisma.orderHeader.findFirst({
            where: { tenantId, status: 101 },
            orderBy: { payTime: "desc" },
            select: { payTime: true },
        });
        const maxPayTimeBefore = latestBefore?.payTime ?? null;

        // 2. Compute sync window
        const now = new Date();
        let payStart: string;
        let payEnd: string;

        if (force) {
            // Force: last 7 days
            const start = new Date(now);
            start.setUTCDate(start.getUTCDate() - 7);
            payStart = fmtDate(start);
            payEnd = fmtDate(new Date(now.getTime() + 86400_000)); // tomorrow
            console.log(`[sync-haha-now] Force mode: 7-day window ${payStart} → ${payEnd}`);
        } else if (!maxPayTimeBefore || now.getTime() - maxPayTimeBefore.getTime() > 48 * 3600_000) {
            // DB is stale (>48h) or empty — expand window from maxPayTime-1h to now
            if (maxPayTimeBefore) {
                const expandedStart = new Date(maxPayTimeBefore.getTime() - 3600_000);
                payStart = fmtDate(expandedStart);
            } else {
                // No data at all — pull last 7 days
                const start = new Date(now);
                start.setUTCDate(start.getUTCDate() - 7);
                payStart = fmtDate(start);
            }
            payEnd = fmtDate(new Date(now.getTime() + 86400_000));
            console.log(`[sync-haha-now] Expanded window (stale DB): ${payStart} → ${payEnd}`);
        } else {
            // Normal: last 48 hours
            const start = new Date(now);
            start.setUTCDate(start.getUTCDate() - 2);
            payStart = fmtDate(start);
            payEnd = fmtDate(new Date(now.getTime() + 86400_000));
            console.log(`[sync-haha-now] Default 48h window: ${payStart} → ${payEnd}`);
        }

        // 3. Run bounded sync (reuses DB-level single-flight lock + finally from run-haha-sync)
        console.log(`[sync-haha-now] Starting manual sync: ${payStart} → ${payEnd}`);
        const result = await runHahaSync(tenantId, { payStart, payEnd });

        // 4. Snapshot: max payTime in DB after sync
        const latestAfter = await prisma.orderHeader.findFirst({
            where: { tenantId, status: 101 },
            orderBy: { payTime: "desc" },
            select: { payTime: true },
        });
        const maxPayTimeAfter = latestAfter?.payTime ?? null;

        const durationMs = Date.now() - t0;

        console.log(
            `[sync-haha-now] Done in ${durationMs}ms: ` +
            `${result.importedOrders} orders, ${result.importedLines} lines | ` +
            `maxPayTime: ${maxPayTimeBefore?.toISOString() ?? "null"} → ${maxPayTimeAfter?.toISOString() ?? "null"}`
        );

        return NextResponse.json({
            runId: result.syncRunId,
            status: result.status,
            message: result.message,
            importedOrders: result.importedOrders,
            importedLines: result.importedLines,
            createdProducts: result.createdProducts,
            createdMachines: result.createdMachines,
            skippedRows: result.skippedRows,
            window: { payStart, payEnd, force },
            maxPayTimeInDbBefore: maxPayTimeBefore?.toISOString() ?? null,
            maxPayTimeInDbAfter: maxPayTimeAfter?.toISOString() ?? null,
            durationMs,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[sync-haha-now] Error:", msg);

        // If it's the DB single-flight lock rejecting us
        if (msg.includes("in progress")) {
            return NextResponse.json({ error: msg }, { status: 429 });
        }

        return NextResponse.json(
            { error: msg, durationMs: Date.now() - t0 },
            { status: 500 },
        );
    }
}

export async function GET(request: NextRequest) {
    return handleManualSync(request);
}

export async function POST(request: NextRequest) {
    return handleManualSync(request);
}
