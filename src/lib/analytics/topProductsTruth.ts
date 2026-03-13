/**
 * Top Products "truth" query — the single source of truth for product-level metrics.
 *
 * This function returns EXACTLY the same rows as the Reports → Top Products table.
 * All downstream KPI totals must be derived from this dataset, not computed separately.
 *
 * Query formula: SUM(ol."quantity" * ol."unitPrice") grouped by product.
 */

import { prisma } from "@/lib/prisma";

export interface TopProductRow {
    productId: string;
    name: string;
    apexSku: string | null;
    category: string | null;
    totalQty: number;
    revenue: number;
    cost: number | null;
}

export interface TopProductsParams {
    tenantId: string;
    /** Inclusive start of the date window (payTime >= start). */
    start?: Date;
    /** Exclusive end of the date window (payTime < end). */
    end?: Date;
    /** If provided, limit to this machine only. */
    machineId?: string;
    /** If provided, limit to this location only. */
    locationId?: string;
    /** Max rows to return (default: no limit). */
    limit?: number;
}

/**
 * Fetch the Top Products truth dataset.
 *
 * Filters:
 *   - tenant
 *   - paid orders only (status = 101, payTime IS NOT NULL)
 *   - optional date window on payTime
 *   - optional machineId / locationId
 *
 * Sorted by revenue DESC. If no limit is provided, all products are returned.
 */
export async function getTopProductsTruth(
    params: TopProductsParams,
): Promise<TopProductRow[]> {
    const { tenantId, start, end, machineId, locationId, limit } = params;

    // Build WHERE clauses dynamically
    const conditions: string[] = [
        `oh."tenantId" = $1`,
        `oh."status" = 101`,
        `oh."payTime" IS NOT NULL`,
    ];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (start) {
        conditions.push(`oh."payTime" >= $${idx}`);
        values.push(start);
        idx++;
    }
    if (end) {
        conditions.push(`oh."payTime" < $${idx}`);
        values.push(end);
        idx++;
    }
    if (machineId) {
        conditions.push(`oh."machineId" = $${idx}`);
        values.push(machineId);
        idx++;
    }
    if (locationId) {
        conditions.push(`m."locationId" = $${idx}`);
        values.push(locationId);
        idx++;
    }

    const joinMachine = locationId
        ? `JOIN "Machine" m ON oh."machineId" = m."id"`
        : "";

    const limitClause = limit ? `LIMIT ${Math.max(1, Math.floor(limit))}` : "";

    const sql = `
    SELECT
      ol."productId",
      p."name",
      p."apexSku",
      p."category",
      COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty",
      COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue",
      p."cost"
    FROM "OrderLine" ol
    JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
    ${joinMachine}
    JOIN "Product" p ON ol."productId" = p."id"
    WHERE ${conditions.join("\n      AND ")}
    GROUP BY ol."productId", p."name", p."apexSku", p."category", p."cost"
    ORDER BY "revenue" DESC
    ${limitClause}
  `;

    return prisma.$queryRawUnsafe<TopProductRow[]>(sql, ...values);
}
