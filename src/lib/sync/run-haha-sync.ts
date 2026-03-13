import { prisma } from "@/lib/prisma";
import { getToken, listOrders, getOrderDetail } from "@/lib/vendors/haha/client";
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
 * Run a full Haha sync cycle:
 *   1. Create SyncRun (status="running")
 *   2. Fetch token
 *   3. List orders for the date range (default: last 2 days)
 *   4. Fetch detail for each order (includes product_list)
 *   5. Normalize + upsert via shared ingestion
 *   6. Update SyncRun with counters + final status
 *
 * @param tenantId      - tenant to scope all data
 * @param lookbackDays  - how many days back to fetch (default 2)
 */
export async function runHahaSync(
  tenantId: string,
  lookbackDays = 2,
): Promise<SyncResult> {
  // Create tracking row
  const syncRun = await prisma.syncRun.create({
    data: { tenantId, vendor: VENDOR, status: "running" },
  });

  try {
    // 1. Token
    const token = await getToken();

    // 2. Date window: last N days → today, formatted YYYY-MM-DD HH:mm:ss
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - lookbackDays);

    const startDate = fmtDate(start);
    const endDate = fmtDate(now);

    console.log(`[haha-sync] Fetching orders from ${startDate} to ${endDate}`);

    // 3. List orders (paginated, all pages)
    const orderSummaries = await listOrders(token, {
      start_time: startDate,
      end_time: endDate,
    });

    console.log(`[haha-sync] Found ${orderSummaries.length} orders`);

    // 4. Fetch detail for each order (includes product_list)
    // Process sequentially to avoid rate-limiting
    const details = [];
    for (const summary of orderSummaries) {
      try {
        const detail = await getOrderDetail(token, summary.order_no);
        details.push(detail);
      } catch (err) {
        console.error(`[haha-sync] Error fetching detail for order ${summary.order_no}:`, err);
        // Continue processing other orders even if one fails
      }
    }

    console.log(`[haha-sync] Fetched ${details.length} order details out of ${orderSummaries.length}`);

    // 5. Normalize
    const normalized = details.map(normalizeHahaOrder);

    // 6. Upsert
    const stats = await upsertOrders(tenantId, normalized);

    // 7. Mark success
    const message = stats.skippedRows.length
      ? `${stats.skippedRows.length} rows skipped`
      : null;

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        importedOrders: stats.importedOrders,
        importedLines: stats.importedLines,
        createdProducts: stats.createdProducts,
        createdMachines: stats.createdMachines,
        skippedRows: stats.skippedRows.length,
        message,
      },
    });

    console.log(
      `[haha-sync] Done: ${stats.importedOrders} orders, ${stats.importedLines} lines, ` +
      `${stats.createdMachines} machines created, ${stats.createdProducts} products created`,
    );

    return {
      syncRunId: syncRun.id,
      status: "success",
      message,
      importedOrders: stats.importedOrders,
      importedLines: stats.importedLines,
      createdProducts: stats.createdProducts,
      createdMachines: stats.createdMachines,
      skippedRows: stats.skippedRows.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Truncate error message to avoid DB overflow
    const truncated = message.length > 500 ? message.slice(0, 500) + "..." : message;

    try {
      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: { status: "error", finishedAt: new Date(), message: truncated },
      });
    } catch {
      console.error("[haha-sync] Failed to update SyncRun with error:", truncated);
    }

    console.error("[haha-sync] Sync failed:", truncated);

    return {
      syncRunId: syncRun.id,
      status: "error",
      message: truncated,
      importedOrders: 0,
      importedLines: 0,
      createdProducts: 0,
      createdMachines: 0,
      skippedRows: 0,
    };
  }
}
