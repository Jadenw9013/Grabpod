import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
    const tenantId = getTenantId();

    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const thisMonthStart = new Date(Date.UTC(y, m, 1));
    const thisMonthEnd = new Date(Date.UTC(y, m + 1, 1));
    const prevMonthStart = new Date(Date.UTC(y, m - 1, 1));
    const prevMonthEnd = thisMonthStart;

    // Locations with machine count
    const locations = await prisma.location.findMany({
        where: { tenantId },
        include: {
            machines: { select: { id: true, stickerNum: true, status: true } },
            contracts: {
                select: {
                    id: true,
                    inceptionDate: true,
                    taxRate: true,
                    creditCardFeeRate: true,
                    profitShareUnder1000: true,
                    profitShareOver1000: true,
                },
            },
        },
        orderBy: { name: "asc" },
    });

    // Revenue by location (this month + previous month)
    const thisMonthRevByLocation = await prisma.$queryRawUnsafe<
        { locationId: string | null; revenue: number; orderCount: number }[]
    >(
        `SELECT m."locationId",
            COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue",
            COUNT(DISTINCT oh."orderNo")::int AS "orderCount"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     JOIN "Machine" m ON oh."machineId" = m."id"
     WHERE oh."tenantId" = $1
       AND oh."createdAt" >= $2 AND oh."createdAt" < $3
     GROUP BY m."locationId"`,
        tenantId,
        thisMonthStart,
        thisMonthEnd,
    );

    const prevMonthRevByLocation = await prisma.$queryRawUnsafe<
        { locationId: string | null; revenue: number }[]
    >(
        `SELECT m."locationId",
            COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     JOIN "Machine" m ON oh."machineId" = m."id"
     WHERE oh."tenantId" = $1
       AND oh."createdAt" >= $2 AND oh."createdAt" < $3
     GROUP BY m."locationId"`,
        tenantId,
        prevMonthStart,
        prevMonthEnd,
    );

    // Revenue by machine (this month) for detail
    const thisMonthRevByMachine = await prisma.$queryRawUnsafe<
        { machineId: string; revenue: number; orderCount: number }[]
    >(
        `SELECT oh."machineId",
            COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue",
            COUNT(DISTINCT oh."orderNo")::int AS "orderCount"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     WHERE oh."tenantId" = $1
       AND oh."createdAt" >= $2 AND oh."createdAt" < $3
     GROUP BY oh."machineId"`,
        tenantId,
        thisMonthStart,
        thisMonthEnd,
    );

    // LOW counts by machine
    const lowByMachine = await prisma.$queryRawUnsafe<
        { machineId: string; lowCount: number }[]
    >(
        `SELECT "machineId", COUNT(*)::int AS "lowCount"
     FROM "InventorySnapshot"
     WHERE "tenantId" = $1 AND "isLow" = true
     GROUP BY "machineId"`,
        tenantId,
    );

    // Last sync
    const lastSync = await prisma.syncRun.findFirst({
        where: { tenantId, status: "success" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
    });

    // Build lookup maps
    const thisRevMap = new Map(thisMonthRevByLocation.map((r) => [r.locationId, r]));
    const prevRevMap = new Map(prevMonthRevByLocation.map((r) => [r.locationId, r]));
    const machineRevMap = new Map(thisMonthRevByMachine.map((r) => [r.machineId, r]));
    const lowMap = new Map(lowByMachine.map((r) => [r.machineId, r.lowCount]));

    // LOW count per location
    function locationLowCount(machineIds: string[]): number {
        return machineIds.reduce((sum, id) => sum + (lowMap.get(id) ?? 0), 0);
    }

    const fmt = (n: number) =>
        n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate = (d: Date | null) =>
        d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

    return (
        <main className="p-6">
            <h1 className="text-xl font-semibold">Locations</h1>

            {locations.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                    No locations configured. Add locations via Settings or seed beta data.
                </p>
            ) : (
                <div className="mt-4 space-y-6">
                    {/* Summary Table */}
                    <div className="overflow-auto rounded-xl border">
                        <div className="min-w-[700px]">
                            <div className="grid grid-cols-[1fr_80px_100px_100px_80px_120px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
                                <div>Location</div>
                                <div className="text-right"># Machines</div>
                                <div className="text-right">Revenue (This Mo)</div>
                                <div className="text-right">Revenue (Prev Mo)</div>
                                <div className="text-right">LOW Items</div>
                                <div className="text-right">Last Sync</div>
                            </div>
                            {locations.map((loc) => {
                                const machineIds = loc.machines.map((m) => m.id);
                                const thisRev = thisRevMap.get(loc.id)?.revenue ?? 0;
                                const prevRev = prevRevMap.get(loc.id)?.revenue ?? 0;
                                const lowCount = locationLowCount(machineIds);

                                return (
                                    <div
                                        key={loc.id}
                                        className="grid grid-cols-[1fr_80px_100px_100px_80px_120px] gap-2 border-b p-3 text-sm"
                                    >
                                        <div className="font-medium">{loc.name}</div>
                                        <div className="text-right">{loc.machines.length}</div>
                                        <div className="text-right">${fmt(thisRev)}</div>
                                        <div className="text-right">${fmt(prevRev)}</div>
                                        <div className="text-right">
                                            {lowCount > 0 ? (
                                                <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                                    {lowCount}
                                                </span>
                                            ) : (
                                                "0"
                                            )}
                                        </div>
                                        <div className="text-right text-xs text-muted-foreground">
                                            {fmtDate(lastSync?.finishedAt ?? null)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Location Details */}
                    {locations.map((loc) => (
                        <div key={loc.id} className="rounded-xl border p-4">
                            <h2 className="text-lg font-medium">{loc.name}</h2>
                            {loc.address && (
                                <p className="text-xs text-muted-foreground">{loc.address}</p>
                            )}

                            {/* Machines in this location */}
                            <h3 className="mt-3 text-sm font-medium text-muted-foreground">
                                Machines ({loc.machines.length})
                            </h3>
                            {loc.machines.length === 0 ? (
                                <p className="mt-1 text-xs text-muted-foreground">No machines assigned.</p>
                            ) : (
                                <div className="mt-1 overflow-auto">
                                    <div className="min-w-[500px]">
                                        <div className="grid grid-cols-[1fr_100px_80px_80px] gap-2 border-b pb-1 text-xs text-muted-foreground">
                                            <div>Machine</div>
                                            <div className="text-right">Revenue (Mo)</div>
                                            <div className="text-right">LOW</div>
                                            <div className="text-right">Status</div>
                                        </div>
                                        {loc.machines.map((machine) => {
                                            const rev = machineRevMap.get(machine.id)?.revenue ?? 0;
                                            const low = lowMap.get(machine.id) ?? 0;
                                            return (
                                                <Link
                                                    key={machine.id}
                                                    href={`/machines/${machine.id}`}
                                                    className="grid grid-cols-[1fr_100px_80px_80px] gap-2 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                                                >
                                                    <div>{machine.stickerNum ?? machine.id.slice(0, 8)}</div>
                                                    <div className="text-right">${fmt(rev)}</div>
                                                    <div className="text-right">
                                                        {low > 0 ? (
                                                            <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                                                {low}
                                                            </span>
                                                        ) : (
                                                            "0"
                                                        )}
                                                    </div>
                                                    <div className="text-right capitalize">{machine.status}</div>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Contract summary */}
                            {loc.contracts.length > 0 && (
                                <>
                                    <h3 className="mt-4 text-sm font-medium text-muted-foreground">
                                        Contract
                                    </h3>
                                    {loc.contracts.map((c) => (
                                        <div
                                            key={c.id}
                                            className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4"
                                        >
                                            <div>
                                                <span className="text-muted-foreground">Tax Rate: </span>
                                                {((c.taxRate ?? 0) * 100).toFixed(1)}%
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">CC Fee: </span>
                                                {((c.creditCardFeeRate ?? 0) * 100).toFixed(1)}%
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Profit Share &lt;$1k: </span>
                                                {c.profitShareUnder1000 !== null
                                                    ? `${(c.profitShareUnder1000 * 100).toFixed(0)}%`
                                                    : "—"}
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Profit Share ≥$1k: </span>
                                                {c.profitShareOver1000 !== null
                                                    ? `${(c.profitShareOver1000 * 100).toFixed(0)}%`
                                                    : "—"}
                                            </div>
                                            {c.inceptionDate && (
                                                <div className="col-span-2 sm:col-span-4">
                                                    <span className="text-muted-foreground">Effective: </span>
                                                    {new Date(c.inceptionDate).toLocaleDateString()}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </main>
    );
}
