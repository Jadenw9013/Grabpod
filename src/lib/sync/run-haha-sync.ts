import { prisma } from "@/lib/prisma";
import {
  getToken,
  listOrders,
  getOrderDetail,
} from "@/lib/vendors/haha/client";
import type { HahaOrderSummary } from "@/lib/vendors/haha/client";
import { normalizeHahaOrder } from "@/lib/vendors/haha/normalize";
import { upsertOrders } from "@/lib/ingest/upsert-orders";

const VENDOR = "haha";

export interface SyncResult {
  syncRunId: string;
  status: "success" | "error";
  message: string | null;
  importedOrders: number;
  importedLines: number;
  createdProducts: number;
  createdMachines: number;
  skippedRows: number;
}

/**
 * Format a Date as YYYY-MM-DD HH:mm:ss string (UTC).
 */
function fmtDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Run a Haha sync cycle.
 *
 * Two modes:
 *   A) **Bounded** (payStart + payEnd provided):
 *      Single pay-time window fetch. Fast, targeted.
 *   B) **Full** (no date params):
 *      Dual-window fetch (create-time + pay-time) with lookback.
 *      Catches both new and recently-paid orders.
 *
 * @param tenantId      - tenant to scope all data
 * @param opts.payStart - optional YYYY-MM-DD start (pay_start_time)
 * @param opts.payEnd   - optional YYYY-MM-DD end (pay_end_time, exclusive)
 * @param opts.lookbackDays - days back for full sync (default 5)
 */
export async function runHahaSync(
  tenantId: string,
  opts: {
    payStart?: string;
    payEnd?: string;
    lookbackDays?: number;
  } = {},
): Promise<SyncResult> {
  const { payStart, payEnd, lookbackDays = 5 } = opts;
  const bounded = !!(payStart && payEnd);

  // 0. DB Single-flight lock (protects across overlapping ticks)
  console.log(`[haha-sync] [START] tenant=${tenantId} bounded=${bounded} payStart=${payStart} payEnd=${payEnd} lookbackDays=${lookbackDays}`);

  const activeRun = await prisma.syncRun.findFirst({
    where: { tenantId, vendor: VENDOR, status: "running" }
  });

  if (activeRun) {
    if (Date.now() - activeRun.startedAt.getTime() < 5 * 60 * 1000) {
      console.warn(`[haha-sync] Aborting: syncRun ${activeRun.id} is already in-progress.`);
      return {
        syncRunId: activeRun.id,
        status: "error",
        message: "Another sync is currently in progress",
        importedOrders: 0, importedLines: 0, createdProducts: 0, createdMachines: 0, skippedRows: 0,
      };
    } else {
      console.warn(`[haha-sync] Sweeping stale running syncRun ${activeRun.id}`);
      await prisma.syncRun.update({
        where: { id: activeRun.id },
        data: { status: "error", message: "timeout (stuck run swept by new sync)", finishedAt: new Date() }
      }).catch(() => { });
    }
  }

  // Create tracking row
  const syncRun = await prisma.syncRun.create({
    data: { tenantId, vendor: VENDOR, status: "running" },
  });

  let isSuccess = false;
  let finalMessage: string | null = "Unknown error or timeout during sync";
  let finalStats = { importedOrders: 0, importedLines: 0, createdProducts: 0, createdMachines: 0, skippedRows: 0 };

  try {
    // 1. Token
    const token = await getToken();

    // Map of order_no → list-level row (retains status, which is NOT in detail response)
    const orderMap = new Map<string, HahaOrderSummary>();
    // 2. Date window: last N days → today, formatted YYYY-MM-DD HH:mm:ss
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - lookbackDays);

    if (bounded) {
      // ── Bounded mode: single pay-time window ──
      console.log(
        `[haha-sync] Bounded pay-time fetch: ${payStart} → ${payEnd}`,
      );

      const orders = await listOrders(token, {
        pay_start_time: payStart,
        pay_end_time: payEnd,
      });
      console.log(
        `[haha-sync] Pay-time window: ${orders.length} orders`,
      );

      for (const o of orders) orderMap.set(o.order_no, o);
    } else {
      // ── Full mode: dual-window fetch ──
      const now = new Date();
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - lookbackDays);
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

      const startDate = fmtDate(start);
      const endDate = fmtDate(tomorrow);

      console.log(`[haha-sync] Dual-window fetch: ${startDate} to ${endDate}`);

      // Create-time window (new orders)
      const createWindowOrders = await listOrders(token, {
        start_time: startDate,
        end_time: endDate,
      });
      console.log(
        `[haha-sync] Create-time window: ${createWindowOrders.length} orders`,
      );

      // Pay-time window (recently-paid orders)
      const payWindowOrders = await listOrders(token, {
        pay_start_time: startDate,
        pay_end_time: endDate,
      });
      console.log(
        `[haha-sync] Pay-time window: ${payWindowOrders.length} orders`,
      );

      // Union by order_no (deduplicate, prefer pay-window row)
      for (const o of createWindowOrders) {
        orderMap.set(o.order_no, o);
      }
      for (const o of payWindowOrders) {
        orderMap.set(o.order_no, o);
      }
    }

    const uniqueOrderNos = [...orderMap.keys()];
    console.log(
      `[haha-sync] ${bounded ? "Bounded" : "Union"} (deduplicated): ${uniqueOrderNos.length} unique orders`,
    );

    // 4. Fetch detail for each order (parallel batches of 5 to avoid rate-limiting)
    const BATCH_SIZE = 3;
    const details = [];
    let detailErrors = 0;
    for (let i = 0; i < uniqueOrderNos.length; i += BATCH_SIZE) {
      const batch = uniqueOrderNos.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (orderNo) => {
          const detail = await getOrderDetail(token, orderNo);
          // Detail response confirmed to omit status (HAHA_API_DATA_CONTRACT.md §2).
          // Prefer list-row status; fall back to 101 for bounded (pay-time) syncs
          // because every order returned by pay_start_time/pay_end_time is paid.
          if (detail.status === undefined || detail.status === null) {
            const listRow = orderMap.get(orderNo);
            detail.status = listRow?.status ?? (bounded ? 101 : undefined);
          }
          return detail;
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          details.push(r.value);
        } else {
          detailErrors++;
          console.warn(
            `[haha-sync] Failed to fetch detail: ${r.reason instanceof Error ? r.reason.message : r.reason}`,
          );
        }
      }
    }

    console.log(
      `[haha-sync] Fetched ${details.length} order details (${detailErrors} errors)`,
    );

    // Log timestamp ranges for auditability
    if (details.length > 0) {
      const createTimes = details.map((d) => d.create_time).sort();
      const payTimes = details
        .filter((d) => d.pay_time)
        .map((d) => d.pay_time!)
        .sort();
      const statuses = details.map((d) => d.status);
      const paidCount = statuses.filter((s) => s === 101 || s === "101").length;
      const pendingCount = statuses.filter(
        (s) => s === 200 || s === "200",
      ).length;

      console.log(
        `[haha-sync] create_time range: ${createTimes[0]} → ${createTimes[createTimes.length - 1]}`,
      );
      if (payTimes.length > 0) {
        console.log(
          `[haha-sync] pay_time range: ${payTimes[0]} → ${payTimes[payTimes.length - 1]}`,
        );
      }
      console.log(
        `[haha-sync] Status breakdown: ${paidCount} paid (101), ${pendingCount} pending (200), ${details.length - paidCount - pendingCount} other`,
      );
    }
    // 5. Normalize
    const normalized = details.map(normalizeHahaOrder);

    // 6. Upsert
    const stats = await upsertOrders(tenantId, normalized);

    // 7. Mark success
    finalMessage = [
      bounded
        ? `mode=bounded(${payStart}→${payEnd})`
        : `mode=full`,
      `orders=${uniqueOrderNos.length}`,
      detailErrors > 0 ? `detail-errors=${detailErrors}` : null,
      stats.skippedRows.length
        ? `skipped=${stats.skippedRows.length}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    finalStats = {
      importedOrders: stats.importedOrders,
      importedLines: stats.importedLines,
      createdProducts: stats.createdProducts,
      createdMachines: stats.createdMachines,
      skippedRows: stats.skippedRows.length,
    };
    isSuccess = true;

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Truncate error message to avoid DB overflow
    finalMessage = msg.length > 500 ? msg.slice(0, 500) + "..." : msg;
    console.error("[haha-sync] Sync failed:", finalMessage);
  } finally {
    // 8. Guarantee finalization under all exit paths
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: isSuccess ? "success" : "error",
        finishedAt: new Date(),
        message: finalMessage,
        ...finalStats,
      },
    }).catch(err => {
      console.error("[haha-sync] Failed to finalize SyncRun:", err);
    });

    if (isSuccess) {
      console.log(
        `[haha-sync] [END] Success. importedOrders=${finalStats.importedOrders}, ` +
        `importedLines=${finalStats.importedLines}, createdMachines=${finalStats.createdMachines}, ` +
        `createdProducts=${finalStats.createdProducts}, skipped=${finalStats.skippedRows}`
      );
    } else {
      console.error(`[haha-sync] [END] Failed. finalMessage=${finalMessage}`);
    }
  }

  return {
    syncRunId: syncRun.id,
    status: isSuccess ? "success" : "error",
    message: finalMessage,
    ...finalStats,
  };
}
