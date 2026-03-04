import { inngest } from "../client";
import { prisma } from "@/lib/prisma";

const LOW_THRESHOLD_DAYS = 3;
const PRIMARY_WINDOW_DAYS = 14;
const FALLBACK_WINDOW_DAYS = 7;

/**
 * Daily Inngest job: computes avgDailySales, daysOfCover, and isLow
 * for every InventorySnapshot row.
 *
 * Algorithm per (machineId, productId):
 *   1. Sum OrderLine.quantity for orders in the last 14 days.
 *   2. avgDailySales = totalQty / 14.
 *   3. If avgDailySales is 0 (no sales in 14 days), try 7-day window.
 *   4. daysOfCover = onHand / avgDailySales (null if avgDailySales is 0).
 *   5. isLow = daysOfCover != null && daysOfCover <= LOW_THRESHOLD_DAYS.
 */
export const computeLowInventory = inngest.createFunction(
  { id: "compute-low-inventory" },
  { cron: "0 3 * * *" }, // daily at 3 AM
  async () => {
    const tenantId = process.env.DEV_TENANT_ID;
    if (!tenantId) {
      throw new Error("DEV_TENANT_ID is not configured");
    }

    const now = new Date();
    const cutoff14 = new Date(now.getTime() - PRIMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const cutoff7 = new Date(now.getTime() - FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Load all inventory snapshots for this tenant
    const snapshots = await prisma.inventorySnapshot.findMany({
      where: { tenantId },
      select: { id: true, machineId: true, productId: true, onHand: true },
    });

    if (snapshots.length === 0) {
      return { updated: 0, message: "No inventory snapshots found" };
    }

    // Gather unique machineIds for batch query
    const machineIds = [...new Set(snapshots.map((s) => s.machineId))];

    // Fetch 14-day sales: sum quantity per (machineId, productId)
    // Raw query needed because OrderLine doesn't have machineId directly.
    const salesData14 = await prisma.$queryRawUnsafe<
      { machineId: string; productId: string; totalQty: number }[]
    >(
      `SELECT oh."machineId", ol."productId", COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       WHERE oh."tenantId" = $1
         AND oh."machineId" = ANY($2)
         AND oh."createdAt" >= $3
       GROUP BY oh."machineId", ol."productId"`,
      tenantId,
      machineIds,
      cutoff14,
    );

    // Build lookup: "machineId|productId" -> totalQty
    const sales14Map = new Map<string, number>();
    for (const row of salesData14) {
      sales14Map.set(`${row.machineId}|${row.productId}`, row.totalQty);
    }

    // Fetch 7-day sales (fallback) — only needed for pairs with zero 14-day sales
    const zeroSalesPairs = snapshots.filter(
      (s) => !sales14Map.has(`${s.machineId}|${s.productId}`) || sales14Map.get(`${s.machineId}|${s.productId}`) === 0,
    );

    const sales7Map = new Map<string, number>();
    if (zeroSalesPairs.length > 0) {
      const salesData7 = await prisma.$queryRawUnsafe<
        { machineId: string; productId: string; totalQty: number }[]
      >(
        `SELECT oh."machineId", ol."productId", COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty"
         FROM "OrderLine" ol
         JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
         WHERE oh."tenantId" = $1
           AND oh."machineId" = ANY($2)
           AND oh."createdAt" >= $3
         GROUP BY oh."machineId", ol."productId"`,
        tenantId,
        [...new Set(zeroSalesPairs.map((s) => s.machineId))],
        cutoff7,
      );

      for (const row of salesData7) {
        sales7Map.set(`${row.machineId}|${row.productId}`, row.totalQty);
      }
    }

    // Compute and update each snapshot
    let updated = 0;
    let lowCount = 0;

    for (const snap of snapshots) {
      const key = `${snap.machineId}|${snap.productId}`;

      // Try 14-day window first
      let totalQty = sales14Map.get(key) ?? 0;
      let windowDays = PRIMARY_WINDOW_DAYS;

      // Fallback to 7-day window if no 14-day sales
      if (totalQty === 0) {
        totalQty = sales7Map.get(key) ?? 0;
        windowDays = FALLBACK_WINDOW_DAYS;
      }

      const avgDailySales = totalQty > 0 ? totalQty / windowDays : 0;
      const daysOfCover = avgDailySales > 0 ? snap.onHand / avgDailySales : null;
      const isLow = daysOfCover !== null && daysOfCover <= LOW_THRESHOLD_DAYS;

      await prisma.inventorySnapshot.update({
        where: { id: snap.id },
        data: { avgDailySales, daysOfCover, isLow },
      });

      updated++;
      if (isLow) lowCount++;
    }

    return { updated, lowCount, message: `Computed LOW status for ${updated} snapshots, ${lowCount} marked LOW` };
  },
);
