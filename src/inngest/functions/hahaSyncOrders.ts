import { inngest } from "../client";
import { runHahaSync } from "@/lib/sync/run-haha-sync";

const LA_TZ = "America/Los_Angeles";
const LOOKBACK_DAYS = 3; // days of pay-time history to fetch on each tick

/** LA-local today as YYYY-MM-DD. */
function todayLA(): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: LA_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

/** Shift a YYYY-MM-DD string by N days. */
function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + "T12:00:00Z"); // noon UTC avoids DST edge
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * Scheduled Inngest function: syncs recent orders from the Haha Open Platform
 * every 10 minutes. This is the production sync mechanism.
 *
 * Uses a bounded 3-day pay-time window with LA-local boundaries, consistent
 * with the dashboard display. Delegates to the shared runHahaSync() runner.
 *
 * Duplicate-sync prevention: runHahaSync() holds a DB-level lock via
 * SyncRun.status="running". If a concurrent Inngest invocation fires before
 * the previous one completes, it will abort immediately without writing data.
 *
 * Note: the dev-only haha-poller (setInterval) is intentionally disabled in
 * production because serverless environments have no persistent process.
 * This Inngest cron is the correct production-safe alternative.
 */
export const hahaSyncOrders = inngest.createFunction(
  { id: "haha-sync-orders" },
  { cron: "*/10 * * * *" },
  async () => {
    const tenantId = process.env.DEV_TENANT_ID;
    if (!tenantId) {
      throw new Error("DEV_TENANT_ID is not configured");
    }

    const today = todayLA();
    const payStart = addDays(today, -LOOKBACK_DAYS);
    const payEnd = addDays(today, 1); // exclusive upper bound — covers today fully

    return runHahaSync(tenantId, { payStart, payEnd });
  },
);
