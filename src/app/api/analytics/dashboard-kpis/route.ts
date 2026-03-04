import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/dashboard-kpis?window=today|thisMonth|previousMonth
 *
 * Returns per-device KPIs:
 *   - grossRevenue (sum of actualPaymentAmount from OrderHeader)
 *   - netRevenue   (gross * (1 - ccFeeRate) * (1 - profitShareRate))
 *   - orderCount
 *
 * Net revenue formula (temporary, see TODOs):
 *   net = gross * (1 - creditCardFeeRate) * (1 - profitShareRate)
 *   - profitShareRate = profitShareUnder1000 if gross < 1000, else profitShareOver1000
 *   - If no contract found for the machine's location, rates default to 0.
 *
 * TODO: confirm with owner whether sales tax should also be subtracted
 * TODO: add userCard field to OrderHeader to enable Unique Cards + Repeat Rate
 * TODO: add order status field if filtering by completed-only is needed
 */
export async function GET(request: NextRequest) {
    try {
        const tenantId = getTenantId();

        const windowParam =
            request.nextUrl.searchParams.get("window") ?? "thisMonth";

        // Compute UTC date bounds
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        let start: Date;
        let end: Date;

        switch (windowParam) {
            case "today": {
                start = new Date(Date.UTC(y, m, now.getUTCDate()));
                end = new Date(Date.UTC(y, m, now.getUTCDate() + 1));
                break;
            }
            case "previousMonth": {
                start = new Date(Date.UTC(y, m - 1, 1));
                end = new Date(Date.UTC(y, m, 1));
                break;
            }
            default: {
                // thisMonth
                start = new Date(Date.UTC(y, m, 1));
                end = new Date(Date.UTC(y, m + 1, 1));
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
         AND oh."createdAt" >= $2
         AND oh."createdAt" < $3
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

            // Choose profit share rate based on gross revenue threshold
            // TODO: confirm threshold is per-device-per-month (currently: per-device for this window)
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

            // TODO: confirm whether sales tax should be subtracted here
            // Currently NOT subtracting tax to avoid double-subtraction
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
                // TODO: add userCard to OrderHeader + normalize from Haha API to enable these
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
                // TODO: compute from userCard field once added to schema
                uniqueCards: null,
                repeatCustomerRate: null,
            },
        });
    } catch (err) {
        return handleApiError(err);
    }
}
