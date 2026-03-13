/**
 * HAHA Background Sync Poller
 *
 * Runs a bounded sync every POLL_INTERVAL_MS (default: 2 min) while the server is alive.
 * Syncs a rolling 2-day window by payTime so the DB stays close to HAHA's live data.
 *
 * Singleton guard: only one poller per process (survives hot-reloads via globalThis).
 *
 * Sync formula:
 *   pay_start_time = today (LA) - 2 days
 *   pay_end_time   = today (LA) + 1 day (exclusive → catches today + boundary)
 */

import { runHahaSync } from "./run-haha-sync";
import { prisma } from "@/lib/prisma";

const LA_TZ = "America/Los_Angeles";
const DEFAULT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const BACKOFF_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (on rate limit)
const TIMEOUT_MS = 5 * 60 * 1000; // 5 min hard timeout
const LOOKBACK_DAYS = 2;

const globalRef = globalThis as unknown as {
    __HAHA_POLLER_STARTED__?: boolean;
    __HAHA_POLLER_TIMER__?: ReturnType<typeof setInterval>;
    __HAHA_POLLER_RUNNING__?: boolean;
};

/** Get LA-local today as YYYY-MM-DD. */
function todayLA(): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: LA_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

/** Add days to a YYYY-MM-DD string. */
function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + "T12:00:00Z"); // noon UTC to avoid DST edge
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

let currentIntervalMs = DEFAULT_INTERVAL_MS;

async function tick() {
    if (globalRef.__HAHA_POLLER_RUNNING__) {
        console.log("[haha-poller] Sync already in-flight — skipping overlapping tick");
        return;
    }

    const tenantId = process.env.DEV_TENANT_ID;
    if (!tenantId) {
        console.warn("[haha-poller] DEV_TENANT_ID not set — skipping tick");
        return;
    }

    const today = todayLA();
    const payStart = addDays(today, -LOOKBACK_DAYS);
    const payEnd = addDays(today, 1); // exclusive, so includes today

    globalRef.__HAHA_POLLER_RUNNING__ = true;
    const t0 = Date.now();
    try {
        console.log(
            `[haha-poller] Tick: ${payStart} → ${payEnd} (window=${LOOKBACK_DAYS + 1}d)`,
        );

        const result = await Promise.race([
            runHahaSync(tenantId, { payStart, payEnd }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)
            )
        ]);

        const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
            `[haha-poller] ✓ ${result.importedOrders} orders, ${result.importedLines} lines in ${durationSec}s (${result.status})`,
        );

        // Reset to normal interval after success
        if (currentIntervalMs !== DEFAULT_INTERVAL_MS) {
            currentIntervalMs = DEFAULT_INTERVAL_MS;
            reschedule();
        }
    } catch (err: unknown) {
        const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
        const msg = err instanceof Error ? err.message : String(err);

        // Rate limit: back off
        if (msg.includes("-429") || msg.includes("rate limit")) {
            console.warn(
                `[haha-poller] ⚠ Rate limited after ${durationSec}s — backing off to ${BACKOFF_INTERVAL_MS / 1000}s`,
            );
            if (currentIntervalMs !== BACKOFF_INTERVAL_MS) {
                currentIntervalMs = BACKOFF_INTERVAL_MS;
                reschedule();
            }
        } else if (msg.includes("timeout")) {
            console.error(`[haha-poller] ✗ Timeout after ${durationSec}s — marking stuck runs as failed`);
            // Sweep any stuck runs in the DB to avoid permanent "running" pileup
            await prisma.syncRun.updateMany({
                where: { tenantId, vendor: 'haha', status: 'running' },
                data: { status: 'error', message: 'timeout (60s exceeded)', finishedAt: new Date() }
            }).catch(() => { });
        } else {
            console.error(
                `[haha-poller] ✗ Error after ${durationSec}s: ${msg}`,
            );
        }
    } finally {
        globalRef.__HAHA_POLLER_RUNNING__ = false;
    }
}

function reschedule() {
    if (globalRef.__HAHA_POLLER_TIMER__) {
        clearInterval(globalRef.__HAHA_POLLER_TIMER__);
    }
    globalRef.__HAHA_POLLER_TIMER__ = setInterval(tick, currentIntervalMs);
    console.log(
        `[haha-poller] Rescheduled to every ${currentIntervalMs / 1000}s`,
    );
}

/**
 * Start the HAHA poller. Safe to call multiple times (idempotent).
 * Only starts in development mode.
 */
export function startHahaPoller() {
    if (process.env.NODE_ENV === "production") return;
    if (globalRef.__HAHA_POLLER_STARTED__) return;

    globalRef.__HAHA_POLLER_STARTED__ = true;
    currentIntervalMs = DEFAULT_INTERVAL_MS;

    console.log(
        `[haha-poller] Starting (interval=${DEFAULT_INTERVAL_MS / 1000}s, lookback=${LOOKBACK_DAYS}d)`,
    );

    // First tick after a short delay (let server finish booting)
    setTimeout(tick, 5_000);
    globalRef.__HAHA_POLLER_TIMER__ = setInterval(tick, currentIntervalMs);
}

/**
 * Run one sync tick immediately and return the result.
 * Useful for the /api/dev/sync-haha-now endpoint.
 */
export async function runPollerTickNow() {
    if (globalRef.__HAHA_POLLER_RUNNING__) {
        throw new Error("Sync already in-flight. Please wait.");
    }

    const tenantId = process.env.DEV_TENANT_ID;
    if (!tenantId) {
        throw new Error("DEV_TENANT_ID not set");
    }

    const today = todayLA();
    const payStart = addDays(today, -LOOKBACK_DAYS);
    const payEnd = addDays(today, 1);

    globalRef.__HAHA_POLLER_RUNNING__ = true;
    const t0 = Date.now();
    try {
        const result = await Promise.race([
            runHahaSync(tenantId, { payStart, payEnd }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)
            )
        ]);
        const durationMs = Date.now() - t0;

        // Get max payTime in DB to return to client
        const latest = await prisma.orderHeader.findFirst({
            where: { tenantId, status: 101 },
            orderBy: { payTime: "desc" },
            select: { payTime: true },
        });

        return {
            ...result,
            durationMs,
            window: { payStart, payEnd },
            maxPayTimeInDb: latest?.payTime ?? null,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("timeout")) {
            await prisma.syncRun.updateMany({
                where: { tenantId, vendor: 'haha', status: 'running' },
                data: { status: 'error', message: 'timeout manual (60s exceeded)', finishedAt: new Date() }
            }).catch(() => { });
            throw new Error("Sync timed out after 60 seconds. Stuck runs marked as failed.");
        }
        throw err;
    } finally {
        globalRef.__HAHA_POLLER_RUNNING__ = false;
    }
}
