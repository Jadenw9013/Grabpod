import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import Link from "next/link";
import { RevenueTrendLineChart } from "@/components/charts/RevenueTrendLineChart";
import { DevDataHealthPanel } from "@/components/dev/DevDataHealthPanel";
import { DeviceKpisTable } from "@/components/dashboard/DeviceKpisTable";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const tenantId = getTenantId();

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const todayStart = new Date(Date.UTC(y, m, now.getUTCDate()));
  const todayEnd = new Date(Date.UTC(y, m, now.getUTCDate() + 1));
  const thisMonthStart = new Date(Date.UTC(y, m, 1));
  const thisMonthEnd = new Date(Date.UTC(y, m + 1, 1));
  const prevMonthStart = new Date(Date.UTC(y, m - 1, 1));
  const prevMonthEnd = thisMonthStart;

  const [
    totalMachineCount,
    lowStockCount,
    locationCount,
    todayRevRows,
    thisMonthRevRows,
    prevMonthRevRows,
    topProducts,
    restockPriority,
  ] = await Promise.all([
    prisma.machine.count({ where: { tenantId } }),
    prisma.inventorySnapshot.count({ where: { tenantId, isLow: true } }),
    prisma.location.count({ where: { tenantId } }),
    // Today revenue
    prisma.$queryRawUnsafe<{ revenue: number }[]>(
      `SELECT COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       WHERE oh."tenantId" = $1 AND oh."createdAt" >= $2 AND oh."createdAt" < $3`,
      tenantId, todayStart, todayEnd,
    ),
    // This month revenue
    prisma.$queryRawUnsafe<{ revenue: number }[]>(
      `SELECT COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       WHERE oh."tenantId" = $1 AND oh."createdAt" >= $2 AND oh."createdAt" < $3`,
      tenantId, thisMonthStart, thisMonthEnd,
    ),
    // Previous month revenue
    prisma.$queryRawUnsafe<{ revenue: number }[]>(
      `SELECT COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       WHERE oh."tenantId" = $1 AND oh."createdAt" >= $2 AND oh."createdAt" < $3`,
      tenantId, prevMonthStart, prevMonthEnd,
    ),
    // Top 10 Products by revenue (no category filter — Haha import doesn't provide categories)
    prisma.$queryRawUnsafe<{ name: string; totalQty: number; revenue: number }[]>(
      `SELECT p."name",
              COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty",
              COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       JOIN "Product" p ON ol."productId" = p."id"
       WHERE oh."tenantId" = $1
         AND oh."createdAt" >= $2 AND oh."createdAt" < $3
       GROUP BY p."id", p."name"
       ORDER BY "revenue" DESC
       LIMIT 10`,
      tenantId, thisMonthStart, thisMonthEnd,
    ),
    // Restock priority (LOW items aggregated by machine, top 5)
    prisma.$queryRawUnsafe<
      {
        machineId: string;
        stickerNum: string | null;
        locationName: string | null;
        lowCount: number;
        avgDaysOfCover: number | null;
        totalNeeded: number;
      }[]
    >(
      `SELECT
         m."id" AS "machineId",
         m."stickerNum",
         l."name" AS "locationName",
         COUNT(*)::int AS "lowCount",
         AVG(i."daysOfCover")::float AS "avgDaysOfCover",
         SUM(GREATEST(i."capacity" - i."onHand", 0))::int AS "totalNeeded"
       FROM "InventorySnapshot" i
       JOIN "Machine" m ON i."machineId" = m."id"
       LEFT JOIN "Location" l ON m."locationId" = l."id"
       WHERE i."tenantId" = $1 AND i."isLow" = true
       GROUP BY m."id", m."stickerNum", l."name"
       ORDER BY "avgDaysOfCover" ASC NULLS LAST
       LIMIT 5`,
      tenantId,
    ),
  ]);

  // Machines below 50% stock — aggregated per machine
  const allSnaps = await prisma.inventorySnapshot.findMany({
    where: { tenantId, capacity: { gt: 0 } },
    select: {
      machineId: true,
      onHand: true,
      capacity: true,
      isLow: true,
      machine: {
        select: {
          stickerNum: true,
          status: true,
          location: { select: { name: true } },
        },
      },
    },
  });

  // Group by machine
  const machineMap = new Map<
    string,
    {
      stickerNum: string | null;
      locationName: string | null;
      status: string;
      totalOnHand: number;
      totalCapacity: number;
      hasLow: boolean;
      machineId: string;
    }
  >();
  for (const s of allSnaps) {
    const existing = machineMap.get(s.machineId);
    if (existing) {
      existing.totalOnHand += s.onHand;
      existing.totalCapacity += s.capacity;
      if (s.isLow) existing.hasLow = true;
    } else {
      machineMap.set(s.machineId, {
        machineId: s.machineId,
        stickerNum: s.machine.stickerNum,
        locationName: s.machine.location?.name ?? null,
        status: s.machine.status,
        totalOnHand: s.onHand,
        totalCapacity: s.capacity,
        hasLow: s.isLow,
      });
    }
  }

  const belowHalfMachines = Array.from(machineMap.values())
    .filter((m) => m.totalCapacity > 0 && m.totalOnHand < m.totalCapacity * 0.5)
    .sort(
      (a, b) =>
        a.totalOnHand / a.totalCapacity - b.totalOnHand / b.totalCapacity,
    );

  // Count machines needing attention (below 50% OR has LOW items)
  const machinesNeedingAttention = Array.from(machineMap.values()).filter(
    (m) => m.hasLow || (m.totalCapacity > 0 && m.totalOnHand < m.totalCapacity * 0.5),
  ).length;

  const todayRev = todayRevRows[0]?.revenue ?? 0;
  const thisRev = thisMonthRevRows[0]?.revenue ?? 0;
  const prevRev = prevMonthRevRows[0]?.revenue ?? 0;
  const revChange = prevRev > 0 ? ((thisRev - prevRev) / prevRev) * 100 : null;

  // TODO: Net revenue requires contract profit-share deduction; using gross for now
  const todayNet = todayRev;

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      {/* Dev-only data health panel */}
      {process.env.NODE_ENV !== "production" && (
        <DevDataHealthPanel
          machines={totalMachineCount}
          locations={locationCount}
          lowStockAlerts={lowStockCount}
        />
      )}

      {/* ── 6 Metric Cards (§5.1) ── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Revenue (Today)" value={`$${fmt(todayRev)}`} />
        <StatCard
          label="Net Revenue (Today)"
          value={`$${fmt(todayNet)}`}
          sub="TODO: deduct profit share"
        />
        <StatCard label="Machines Needing Attention" value={String(machinesNeedingAttention)} />
        <StatCard label="Low Stock Alerts" value={String(lowStockCount)} />
        <StatCard label="Active Locations" value={String(locationCount)} />
        <StatCard
          label="This Month Revenue"
          value={`$${fmt(thisRev)}`}
          sub={
            revChange !== null
              ? `${revChange >= 0 ? "+" : ""}${revChange.toFixed(1)}% vs prev`
              : "No prior data"
          }
        />
      </div>

      {/* ── Revenue Chart — This Month vs Previous Month (§5.2) ── */}
      <div className="mt-6">
        <div className="rounded-xl border p-4">
          <h2 className="text-lg font-medium mb-3">This Month vs Previous Month</h2>
          <RevenueTrendLineChart
            data={[
              { label: "Total", thisMonth: thisRev, previousMonth: prevRev },
            ]}
          />
        </div>
      </div>

      {/* ── Device KPIs (§5.new) ── */}
      <DeviceKpisTable />

      {/* ── Top 10 Products by Revenue (§5.3) ── */}
      <div className="mt-6">
        <TopList title="Top 10 Products" items={topProducts} />
      </div>

      {/* ── Machines Below 50% Stock (§5.4) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Machines Below 50% Stock</h2>
        <div className="mt-2 overflow-auto">
          <div className="min-w-[650px] rounded-xl border">
            <div className="grid grid-cols-[1fr_1fr_80px_100px_80px_100px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
              <div>Machine Name</div>
              <div>Location</div>
              <div>Stock %</div>
              <div>Revenue at Risk</div>
              <div>Status</div>
              <div>Suggested Units</div>
            </div>
            {belowHalfMachines.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                All machines above 50% stock.
              </div>
            ) : (
              belowHalfMachines.map((m) => {
                const pct = Math.round((m.totalOnHand / m.totalCapacity) * 100);
                const suggested = m.totalCapacity - m.totalOnHand;
                return (
                  <div
                    key={m.machineId}
                    className="grid grid-cols-[1fr_1fr_80px_100px_80px_100px] gap-2 p-3 text-sm items-center"
                  >
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/machines/${m.machineId}`}
                        className="hover:underline"
                      >
                        {m.stickerNum ?? m.machineId.slice(0, 8)}
                      </Link>
                      {m.hasLow && <LowBadge />}
                    </div>
                    <div className="text-muted-foreground truncate">{m.locationName ?? "—"}</div>
                    <div>{pct}%</div>
                    <div className="text-muted-foreground">—</div>
                    {/* TODO: Compute revenue at risk from sales velocity */}
                    <div className="text-muted-foreground">{m.status}</div>
                    <div>{suggested}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Restock Priority List — Top 5 Urgent Machines (§5.5) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Restock Priority List (Top 5 Urgent Machines)</h2>
        <div className="mt-2 overflow-auto">
          <div className="min-w-[650px] rounded-xl border">
            <div className="grid grid-cols-[1fr_1fr_80px_100px_100px_100px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
              <div>Machine</div>
              <div>Location</div>
              <div>Stock %</div>
              <div>Revenue at Risk</div>
              <div>Suggested Units</div>
              <div>Priority Score</div>
            </div>
            {restockPriority.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                No LOW items currently.
              </div>
            ) : (
              restockPriority.map((r) => (
                <div
                  key={r.machineId}
                  className="grid grid-cols-[1fr_1fr_80px_100px_100px_100px] gap-2 p-3 text-sm items-center"
                >
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/machines/${r.machineId}`}
                      className="hover:underline"
                    >
                      {r.stickerNum ?? r.machineId.slice(0, 8)}
                    </Link>
                    <LowBadge />
                  </div>
                  <div className="text-muted-foreground truncate">{r.locationName ?? "—"}</div>
                  <div>—</div>
                  {/* TODO: Stock % per machine needs total capacity lookup */}
                  <div className="text-muted-foreground">—</div>
                  {/* TODO: Revenue at risk */}
                  <div>{r.totalNeeded}</div>
                  <div className="font-medium">
                    {r.avgDaysOfCover !== null
                      ? r.avgDaysOfCover.toFixed(1)
                      : "—"}
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

/* ── Shared components ── */

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function TopList({
  title,
  items,
}: {
  title: string;
  items: { name: string; totalQty: number; revenue: number }[];
}) {
  const maxRev = items.reduce((max, i) => Math.max(max, i.revenue), 0);
  return (
    <div>
      <h2 className="text-lg font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No data for this month.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {items.map((item, idx) => {
            const pct = maxRev > 0 ? (item.revenue / maxRev) * 100 : 0;
            return (
              <div key={idx} className="flex items-center gap-3 text-sm">
                <div className="w-5 text-muted-foreground text-right">{idx + 1}</div>
                <div className="flex-1 truncate">{item.name}</div>
                <div className="w-32">
                  <div className="h-3 rounded bg-muted overflow-hidden">
                    <div
                      className="h-full rounded bg-gray-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="w-20 text-right text-muted-foreground">
                  ${item.revenue.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function LowBadge() {
  return (
    <span
      className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 cursor-help"
      title="LOW = Not enough inventory to cover next restock window based on sales velocity"
    >
      LOW
    </span>
  );
}
