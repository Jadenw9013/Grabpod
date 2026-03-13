/**
 * Pure math-derived metrics computed from the Top Products truth dataset.
 *
 * All calculations use cent-based integer arithmetic to avoid floating-point drift.
 * No DB calls — these are deterministic functions over the product rows.
 */

import type { TopProductRow } from "./topProductsTruth";

// ── Cent-safe arithmetic helpers ──────────────────────────────────────────

/** Convert dollars to integer cents (rounds to nearest cent). */
function toCents(dollars: number): number {
    return Math.round(dollars * 100);
}

/** Convert integer cents back to dollars. */
function toDollars(cents: number): number {
    return cents / 100;
}

// ── Derived metrics ──────────────────────────────────────────────────────

export interface DerivedTotals {
    totalRevenue: number;
    totalUnits: number;
    avgUnitPrice: number;
    productCount: number;
}

export interface DerivedProductRow {
    productId: string;
    name: string;
    apexSku: string | null;
    category: string | null;
    units: number;
    revenue: number;
    shareOfRevenue: number;
    /** null if Product.cost is not available */
    unitCost: number | null;
    totalCost: number | null;
    profit: number | null;
    marginPct: number | null;
}

export interface DerivedMetrics {
    totals: DerivedTotals;
    products: DerivedProductRow[];
}

/**
 * Compute all derived metrics from a Top Products truth dataset.
 *
 * Money sums are performed in integer cents. Units are coerced to integers.
 */
export function computeDerivedMetrics(
    rows: TopProductRow[],
): DerivedMetrics {
    // Sum in cents to avoid floating drift
    let totalRevenueCents = 0;
    let totalUnits = 0;

    for (const row of rows) {
        totalRevenueCents += toCents(row.revenue);
        // Units should be integers; coerce safely
        totalUnits += Math.round(row.totalQty);
    }

    const totalRevenue = toDollars(totalRevenueCents);
    const avgUnitPrice = totalUnits === 0 ? 0 : totalRevenue / totalUnits;

    const products: DerivedProductRow[] = rows.map((row) => {
        const units = Math.round(row.totalQty);
        const revenue = toDollars(toCents(row.revenue)); // round-trip to snap to cents

        const shareOfRevenue =
            totalRevenueCents === 0 ? 0 : toCents(row.revenue) / totalRevenueCents;

        // Cost/margin — only if Product.cost is non-null
        let unitCost: number | null = null;
        let totalCost: number | null = null;
        let profit: number | null = null;
        let marginPct: number | null = null;

        if (row.cost !== null && row.cost !== undefined) {
            unitCost = toDollars(toCents(row.cost));
            const totalCostCents = units * toCents(row.cost);
            totalCost = toDollars(totalCostCents);
            const profitCents = toCents(row.revenue) - totalCostCents;
            profit = toDollars(profitCents);
            marginPct =
                toCents(row.revenue) === 0
                    ? 0
                    : profitCents / toCents(row.revenue);
        }

        return {
            productId: row.productId,
            name: row.name,
            apexSku: row.apexSku,
            category: row.category,
            units,
            revenue,
            shareOfRevenue,
            unitCost,
            totalCost,
            profit,
            marginPct,
        };
    });

    return {
        totals: {
            totalRevenue,
            totalUnits,
            avgUnitPrice: toDollars(toCents(avgUnitPrice)), // snap to cents
            productCount: rows.length,
        },
        products,
    };
}
