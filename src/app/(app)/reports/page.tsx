import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
    const tenantId = getTenantId();

    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const thisMonthStart = new Date(Date.UTC(y, m, 1));
    const thisMonthEnd = new Date(Date.UTC(y, m + 1, 1));

    // ── Metrics ──
    const [totalRevRows, totalOrderCount, lowItemCount, completedRestocks] =
        await Promise.all([
            prisma.$queryRawUnsafe<{ revenue: number }[]>(
                `SELECT COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
         FROM "OrderLine" ol
         JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
         WHERE oh."tenantId" = $1
           AND oh."createdAt" >= $2 AND oh."createdAt" < $3`,
                tenantId,
                thisMonthStart,
                thisMonthEnd,
            ),
            prisma.orderHeader.count({
                where: {
                    tenantId,
                    createdAt: { gte: thisMonthStart, lt: thisMonthEnd },
                },
            }),
            prisma.inventorySnapshot.count({
                where: { tenantId, isLow: true },
            }),
            prisma.restockSession.count({
                where: {
                    tenantId,
                    completedAt: { not: null },
                },
            }),
        ]);

    const totalRevenue = totalRevRows[0]?.revenue ?? 0;
    const avgOrderValue = totalOrderCount > 0 ? totalRevenue / totalOrderCount : 0;

    // ── Revenue by Location ──
    const revenueByLocation = await prisma.$queryRawUnsafe<
        {
            locationId: string | null;
            locationName: string | null;
            revenue: number;
            orderCount: number;
            machineCount: number;
        }[]
    >(
        `SELECT m."locationId",
            l."name" AS "locationName",
            COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue",
            COUNT(DISTINCT oh."orderNo")::int AS "orderCount",
            COUNT(DISTINCT m."id")::int AS "machineCount"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     JOIN "Machine" m ON oh."machineId" = m."id"
     LEFT JOIN "Location" l ON m."locationId" = l."id"
     WHERE oh."tenantId" = $1
       AND oh."createdAt" >= $2 AND oh."createdAt" < $3
     GROUP BY m."locationId", l."name"
     ORDER BY "revenue" DESC`,
        tenantId,
        thisMonthStart,
        thisMonthEnd,
    );

    // ── Revenue by Machine ──
    const revenueByMachine = await prisma.$queryRawUnsafe<
        {
            machineId: string;
            stickerNum: string | null;
            locationName: string | null;
            revenue: number;
            orderCount: number;
            lowCount: number;
        }[]
    >(
        `SELECT oh."machineId",
            m."stickerNum",
            l."name" AS "locationName",
            COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue",
            COUNT(DISTINCT oh."orderNo")::int AS "orderCount",
            COALESCE((
              SELECT COUNT(*)::int FROM "InventorySnapshot" i
              WHERE i."machineId" = m."id" AND i."isLow" = true
            ), 0) AS "lowCount"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     JOIN "Machine" m ON oh."machineId" = m."id"
     LEFT JOIN "Location" l ON m."locationId" = l."id"
     WHERE oh."tenantId" = $1
       AND oh."createdAt" >= $2 AND oh."createdAt" < $3
     GROUP BY oh."machineId", m."stickerNum", m."id", l."name"
     ORDER BY "revenue" DESC`,
        tenantId,
        thisMonthStart,
        thisMonthEnd,
    );

    // ── Top Products ──
    const topProducts = await prisma.$queryRawUnsafe<
        {
            productId: string;
            name: string;
            apexSku: string | null;
            totalQty: number;
            revenue: number;
            cost: number | null;
        }[]
    >(
        `SELECT ol."productId",
            p."name",
            p."apexSku",
            COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty",
            COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue",
            p."cost"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     JOIN "Product" p ON ol."productId" = p."id"
     WHERE oh."tenantId" = $1
       AND oh."createdAt" >= $2 AND oh."createdAt" < $3
     GROUP BY ol."productId", p."name", p."apexSku", p."cost"
     ORDER BY "revenue" DESC
     LIMIT 20`,
        tenantId,
        thisMonthStart,
        thisMonthEnd,
    );

    const fmt = (n: number) =>
        n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const monthLabel = thisMonthStart.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
    });

    return (
        <main className="p-6">
            <h1 className="text-xl font-semibold">Reports</h1>
            <p className="mt-1 text-xs text-muted-foreground">
                {monthLabel} · UTC month boundaries
            </p>

            {/* ── Metric Cards ── */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <MetricCard label="Total Revenue" value={`$${fmt(totalRevenue)}`} />
                <MetricCard label="Total Orders" value={String(totalOrderCount)} />
                <MetricCard label="Avg Order Value" value={`$${fmt(avgOrderValue)}`} />
                <MetricCard label="LOW Items" value={String(lowItemCount)} />
                <MetricCard label="Restocks Completed" value={String(completedRestocks)} />
            </div>

            {/* ── Revenue by Location ── */}
            <div className="mt-6">
                <h2 className="text-lg font-medium">Revenue by Location</h2>
                <div className="mt-2 overflow-auto rounded-xl border">
                    <div className="min-w-[500px]">
                        <div className="grid grid-cols-[1fr_100px_80px_80px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
                            <div>Location</div>
                            <div className="text-right">Revenue</div>
                            <div className="text-right">Orders</div>
                            <div className="text-right">Machines</div>
                        </div>
                        {revenueByLocation.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">No data.</p>
                        ) : (
                            revenueByLocation.map((r, i) => (
                                <div
                                    key={r.locationId ?? `unassigned-${i}`}
                                    className="grid grid-cols-[1fr_100px_80px_80px] gap-2 border-b p-3 text-sm"
                                >
                                    <div>{r.locationName ?? "Unassigned"}</div>
                                    <div className="text-right">${fmt(r.revenue)}</div>
                                    <div className="text-right">{r.orderCount}</div>
                                    <div className="text-right">{r.machineCount}</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* ── Revenue by Machine ── */}
            <div className="mt-6">
                <h2 className="text-lg font-medium">Revenue by Machine</h2>
                <div className="mt-2 overflow-auto rounded-xl border">
                    <div className="min-w-[600px]">
                        <div className="grid grid-cols-[1fr_1fr_100px_80px_60px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
                            <div>Machine</div>
                            <div>Location</div>
                            <div className="text-right">Revenue</div>
                            <div className="text-right">Orders</div>
                            <div className="text-right">LOW</div>
                        </div>
                        {revenueByMachine.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">No data.</p>
                        ) : (
                            revenueByMachine.map((r) => (
                                <div
                                    key={r.machineId}
                                    className="grid grid-cols-[1fr_1fr_100px_80px_60px] gap-2 border-b p-3 text-sm"
                                >
                                    <div>{r.stickerNum ?? r.machineId.slice(0, 8)}</div>
                                    <div className="text-muted-foreground">
                                        {r.locationName ?? "Unassigned"}
                                    </div>
                                    <div className="text-right">${fmt(r.revenue)}</div>
                                    <div className="text-right">{r.orderCount}</div>
                                    <div className="text-right">
                                        {Number(r.lowCount) > 0 ? (
                                            <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                                {Number(r.lowCount)}
                                            </span>
                                        ) : (
                                            "0"
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* ── Top Products ── */}
            <div className="mt-6">
                <h2 className="text-lg font-medium">Top Products</h2>
                <div className="mt-2 overflow-auto rounded-xl border">
                    <div className="min-w-[600px]">
                        <div className="grid grid-cols-[1fr_90px_80px_100px_100px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
                            <div>Product</div>
                            <div>SKU</div>
                            <div className="text-right">Units</div>
                            <div className="text-right">Revenue</div>
                            <div className="text-right">Margin</div>
                        </div>
                        {topProducts.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">No data.</p>
                        ) : (
                            topProducts.map((p) => {
                                const hasCost = p.cost !== null;
                                const totalCost = hasCost ? p.totalQty * p.cost! : null;
                                const margin =
                                    totalCost !== null ? p.revenue - totalCost : null;
                                return (
                                    <div
                                        key={p.productId}
                                        className="grid grid-cols-[1fr_90px_80px_100px_100px] gap-2 border-b p-3 text-sm"
                                    >
                                        <div className="truncate">{p.name}</div>
                                        <div className="truncate text-muted-foreground">
                                            {p.apexSku ?? "—"}
                                        </div>
                                        <div className="text-right">{p.totalQty}</div>
                                        <div className="text-right">${fmt(p.revenue)}</div>
                                        <div className="text-right">
                                            {margin !== null ? (
                                                <span className={margin < 0 ? "font-semibold" : ""}>
                                                    ${fmt(margin)}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">n/a</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}

function MetricCard({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
    );
}
