/**
 * GET /api/dev/top-products-truth?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Debug endpoint: returns the Top Products truth dataset + derived totals.
 * Verifies that totalRevenue == SUM(row.revenue) and totalUnits == SUM(row.units).
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { getTopProductsTruth } from "@/lib/analytics/topProductsTruth";
import { computeDerivedMetrics } from "@/lib/analytics/derivedFromTopProducts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const tenantId = getTenantId();
        const startParam = request.nextUrl.searchParams.get("start");
        const endParam = request.nextUrl.searchParams.get("end");

        const start = startParam ? new Date(startParam) : undefined;
        const end = endParam ? new Date(endParam) : undefined;

        const products = await getTopProductsTruth({
            tenantId,
            start,
            end,
            limit: 20,
        });

        const derived = computeDerivedMetrics(products);

        // Parity verification
        const sumRevenue =
            Math.round(products.reduce((s, p) => s + p.revenue, 0) * 100) / 100;
        const sumUnits = Math.round(
            products.reduce((s, p) => s + p.totalQty, 0),
        );

        const parity = {
            totalRevenueMatches: derived.totals.totalRevenue === sumRevenue,
            totalUnitsMatches: derived.totals.totalUnits === sumUnits,
            sumRevenue,
            sumUnits,
        };

        return NextResponse.json({
            tenantId,
            window: { start: start?.toISOString() ?? null, end: end?.toISOString() ?? null },
            totals: derived.totals,
            parity,
            products: derived.products,
        });
    } catch (err) {
        return handleApiError(err);
    }
}
