import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LA_TZ = "America/Los_Angeles";

/** Midnight on a LA-local date expressed as a UTC instant. */
function laToUtc(year: number, month: number, day: number): Date {
    const probe = new Date(Date.UTC(year, month, day, 12));
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: LA_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "longOffset",
    }).formatToParts(probe);
    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-08:00";
    const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
    const offsetSign = match?.[1] === "+" ? 1 : -1;
    const offsetHours = parseInt(match?.[2] ?? "8", 10);
    const offsetMinutes = parseInt(match?.[3] ?? "0", 10);
    const offsetMs = offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000;
    return new Date(Date.UTC(year, month, day) - offsetMs);
}

/**
 * GET /api/analytics/dashboard-kpis?window=today|thisMonth|previousMonth
 *
 * Returns per-device KPIs:
 *   - grossRevenue (sum of actualPaymentAmount from OrderHeader)
 *   - netRevenue   (gross * (1 - ccFeeRate) * (1 - profitShareRate))
 *   - orderCount
 *
 * Window boundaries are LA-local (America/Los_Angeles) to match the
 * dashboard page stat cards which also use LA-local boundaries.
 *
     * Net revenue formula:
 *   net = gross * (1 - creditCardFeeRate) * (1 - profitShareRate)
 *   - profitShareRate = profitShareUnder1000 if gross < 1000, else profitShareOver1000
 *   - If no contract found for the machine's location, rates default to 0.
 */
export async function GET(request: NextRequest) {
    try {
        const tenantId = getTenantId();

        const windowParam =
            request.nextUrl.searchParams.get("window") ?? "thisMonth";

        // Compute LA-local date bounds (consistent with dashboard/page.tsx)
        const now = new Date();
        const laDateStr = new Intl.DateTimeFormat("en-CA", {
            timeZone: LA_TZ,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(now);
        const [yStr, mStr, dStr] = laDateStr.split("-");
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10) - 1; // 0-indexed
        const d = parseInt(dStr, 10);

        let start: Date;
        let end: Date;

        switch (windowParam) {
            case "today": {
                start = laToUtc(y, m, d);
                end = laToUtc(y, m, d + 1);
                break;
            }
            case "previousMonth": {
                const prevM = m - 1;
                start = laToUtc(prevM < 0 ? y - 1 : y, prevM < 0 ? 11 : prevM, 1);
                end = laToUtc(y, m, 1);
                break;
            }
            default: {
                // thisMonth
                const nextM = m + 1;
                start = laToUtc(y, m, 1);
                end = laToUtc(nextM > 11 ? y + 1 : y, nextM > 11 ? 0 : nextM, 1);
                break;
            }
        }

        // Per-device gross revenue + order count
        const deviceRows = await prisma.$queryRawUnsafe<
            {
                machineId: string;
                stickerNum: string | null;
                vendorMachineId: string | null;
                locationId: string | null;
                locationName: string | null;
                grossRevenue: number;
                orderCount: number;
            }[]
        >(
            `SELECT
         oh."machineId",
         m."stickerNum",
         m."vendorMachineId",
         m."locationId",
         l."name" AS "locationName",
         COALESCE(SUM(oh."actualPaymentAmount"), 0)::float AS "grossRevenue",
         COUNT(*)::int AS "orderCount"
       FROM "OrderHeader" oh
       JOIN "Machine" m ON oh."machineId" = m."id"
       LEFT JOIN "Location" l ON m."locationId" = l."id"
       WHERE oh."tenantId" = $1
         AND oh."payTime" IS NOT NULL
         AND oh."payTime" >= $2
         AND oh."payTime" < $3
         AND oh."status" = 101
       GROUP BY oh."machineId", m."stickerNum", m."vendorMachineId", m."locationId", l."name"
       ORDER BY "grossRevenue" DESC`,
            tenantId,
            start,
            end,
        );

        // Load contracts by locationId for net revenue computation
        const contracts = await prisma.contract.findMany({
            where: { tenantId },
            select: {
                locationId: true,
                creditCardFeeRate: true,
                profitShareUnder1000: true,
                profitShareOver1000: true,
            },
        });
        const contractByLocation = new Map(
            contracts.map((c) => [c.locationId, c]),
        );

        // Compute net revenue per device
        const devices = deviceRows.map((row) => {
            const contract = row.locationId
                ? contractByLocation.get(row.locationId)
                : undefined;

            const ccFeeRate = contract?.creditCardFeeRate ?? 0;

            // Choose profit share rate based on gross revenue threshold.
            // Using per-device for the given window as the threshold basis.
            let profitShareRate = 0;
            if (contract) {
                if (
                    row.grossRevenue >= 1000 &&
                    contract.profitShareOver1000 !== null
                ) {
                    profitShareRate = contract.profitShareOver1000;
                } else if (contract.profitShareUnder1000 !== null) {
                    profitShareRate = contract.profitShareUnder1000;
                }
            }

            // Note: Not subtracting sales tax from net revenue here based on typical
            // vending operator contract models. Tax is usually remitted separately.
            const netRevenue =
                row.grossRevenue * (1 - ccFeeRate) * (1 - profitShareRate);

            return {
                machineId: row.machineId,
                machineName: row.stickerNum ?? row.vendorMachineId ?? row.machineId.slice(0, 8),
                deviceNumber: row.vendorMachineId ?? row.stickerNum ?? null,
                locationName: row.locationName ?? "Unassigned",
                grossRevenue: Math.round(row.grossRevenue * 100) / 100,
                netRevenue: Math.round(netRevenue * 100) / 100,
                orderCount: row.orderCount,
                // userCard tracking requires advanced API data extraction which is currently stubbed
                uniqueCards: null as number | null,
                repeatCustomerRate: null as number | null,
            };
        });

        // Totals
        const totalGross = devices.reduce((s, d) => s + d.grossRevenue, 0);
        const totalNet = devices.reduce((s, d) => s + d.netRevenue, 0);
        const totalOrders = devices.reduce((s, d) => s + d.orderCount, 0);

        return NextResponse.json({
            window: windowParam,
            range: { start: start.toISOString(), end: end.toISOString() },
            devices,
            totals: {
                grossRevenue: Math.round(totalGross * 100) / 100,
                netRevenue: Math.round(totalNet * 100) / 100,
                orderCount: totalOrders,
                uniqueCards: null,
                repeatCustomerRate: null,
            },
        });
    } catch (err) {
        return handleApiError(err);
    }
}
