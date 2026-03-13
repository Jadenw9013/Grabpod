import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { getTopProductsTruth } from "@/lib/analytics/topProductsTruth";
import { computeDerivedMetrics } from "@/lib/analytics/derivedFromTopProducts";

export const dynamic = "force-dynamic";

// ── LA-local boundaries (shared with dashboard) ──────────────────────────
const LA_TZ = "America/Los_Angeles";

function laToUtc(year: number, month: number, day: number): Date {
    const probe = new Date(Date.UTC(year, month, day, 12));
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: LA_TZ,
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

function getLAMonthBoundaries() {
    const now = new Date();
    const laDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: LA_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
    const [yStr, mStr] = laDateStr.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10) - 1;
    const thisMonthStart = laToUtc(y, m, 1);
    const nextM = m + 1;
    const thisMonthEnd = laToUtc(nextM > 11 ? y + 1 : y, nextM > 11 ? 0 : nextM, 1);
    return { thisMonthStart, thisMonthEnd };
}

// ── Main page ────────────────────────────────────────────────────────────

export default async function ReportsPage() {
    const tenantId = getTenantId();
    const { thisMonthStart, thisMonthEnd } = getLAMonthBoundaries();

    // ── Truth dataset: Top Products (the ONLY source for product-level metrics) ──
    const truthProducts = await getTopProductsTruth({
        tenantId,
        start: thisMonthStart,
        end: thisMonthEnd,
    });
    const derived = computeDerivedMetrics(truthProducts);

    // ── Metrics not derivable from Top Products (keep separate queries) ──
    const [totalOrderCount, lowItemCount, completedRestocks] =
        await Promise.all([
            prisma.orderHeader.count({
                where: {
                    tenantId,
                    status: 101,
                    payTime: { gte: thisMonthStart, lt: thisMonthEnd },
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

    // Avg order value: derived from truth totalRevenue / order count
    const avgOrderValue = totalOrderCount > 0 ? derived.totals.totalRevenue / totalOrderCount : 0;

    // ── Revenue by Location (not derivable from Top Products — separate query) ──
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
       AND oh."status" = 101
       AND oh."payTime" IS NOT NULL
       AND oh."payTime" >= $2 AND oh."payTime" < $3
     GROUP BY m."locationId", l."name"
     ORDER BY "revenue" DESC`,
        tenantId,
        thisMonthStart,
        thisMonthEnd,
    );

    // ── Revenue by Machine (not derivable from Top Products — separate query) ──
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
       AND oh."status" = 101
       AND oh."payTime" IS NOT NULL
       AND oh."payTime" >= $2 AND oh."payTime" < $3
     GROUP BY oh."machineId", m."stickerNum", m."id", l."name"
     ORDER BY "revenue" DESC`,
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
                {monthLabel} · America/Los_Angeles boundaries
            </p>

            {/* ── Metric Cards (revenue from truth dataset) ── */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <MetricCard label="Total Revenue" value={`$${fmt(derived.totals.totalRevenue)}`} />
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

            {/* ── Top Products (from truth dataset) ── */}
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
                        {derived.products.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">No data.</p>
                        ) : (
                            derived.products.map((p) => (
                                <div
                                    key={p.productId}
                                    className="grid grid-cols-[1fr_90px_80px_100px_100px] gap-2 border-b p-3 text-sm"
                                >
                                    <div className="truncate">{p.name}</div>
                                    <div className="truncate text-muted-foreground">
                                        {p.apexSku ?? "—"}
                                    </div>
                                    <div className="text-right">{p.units}</div>
                                    <div className="text-right">${fmt(p.revenue)}</div>
                                    <div className="text-right">
                                        {p.profit !== null ? (
                                            <span className={p.profit < 0 ? "font-semibold" : ""}>
                                                ${fmt(p.profit)}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">n/a</span>
                                        )}
                                    </div>
                                </div>
                            ))
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
