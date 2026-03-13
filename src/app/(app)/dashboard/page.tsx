import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import Link from "next/link";
import { RevenueTrendLineChart } from "@/components/charts/RevenueTrendLineChart";
import { DevDataHealthPanel } from "@/components/dev/DevDataHealthPanel";
import { DeviceKpisTable } from "@/components/dashboard/DeviceKpisTable";
import { getTopProductsTruth } from "@/lib/analytics/topProductsTruth";
import { computeDerivedMetrics } from "@/lib/analytics/derivedFromTopProducts";

export const dynamic = "force-dynamic";

// ── LA-local day boundaries ──────────────────────────────────────────────
const LA_TZ = "America/Los_Angeles";

/** Convert a LA-local YYYY-MM-DD to a UTC Date (midnight LA → UTC instant). */
function laToUtc(year: number, month: number, day: number): Date {
  // Build an ISO string at midnight LA, then parse to get the UTC instant.
  // Intl gives us the UTC offset for that specific date (handles DST).
  const probe = new Date(Date.UTC(year, month, day, 12)); // noon UTC to avoid edge
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

  // Extract the UTC offset string e.g. "GMT-08:00" or "GMT-07:00"
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-08:00";
  const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetSign = match?.[1] === "+" ? 1 : -1;
  const offsetHours = parseInt(match?.[2] ?? "8", 10);
  const offsetMinutes = parseInt(match?.[3] ?? "0", 10);
  const offsetMs = offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000;

  // Midnight LA in UTC = midnight - offset
  return new Date(Date.UTC(year, month, day) - offsetMs);
}

function getLABoundaries() {
  const now = new Date();
  // Get current LA date parts
  const laFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const laDateStr = laFormatter.format(now); // "2026-03-03"
  const [yStr, mStr, dStr] = laDateStr.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10) - 1; // 0-indexed
  const d = parseInt(dStr, 10);

  const todayStart = laToUtc(y, m, d);
  const tomorrowStart = laToUtc(y, m, d + 1);
  const thisMonthStart = laToUtc(y, m, 1);
  // Next month start
  const nextM = m + 1;
  const thisMonthEnd = laToUtc(nextM > 11 ? y + 1 : y, nextM > 11 ? 0 : nextM, 1);
  // Prev month
  const prevM = m - 1;
  const prevMonthStart = laToUtc(prevM < 0 ? y - 1 : y, prevM < 0 ? 11 : prevM, 1);
  const prevMonthEnd = thisMonthStart;

  return {
    todayStart,
    tomorrowStart,
    thisMonthStart,
    thisMonthEnd,
    prevMonthStart,
    prevMonthEnd,
    currentDay: d,
  };
}

// ── Main page ────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const tenantId = getTenantId();
  const b = getLABoundaries();

  // ── Truth dataset for revenue KPIs ──
  const [todayTruth, monthTruth] = await Promise.all([
    getTopProductsTruth({ tenantId, start: b.todayStart, end: b.tomorrowStart }),
    getTopProductsTruth({ tenantId, start: b.thisMonthStart, end: b.thisMonthEnd }),
  ]);
  const todayDerived = computeDerivedMetrics(todayTruth);
  const monthDerived = computeDerivedMetrics(monthTruth);

  const [
    totalMachineCount,
    lowStockCount,
    locationCount,
    topBeverages,
    topSnacks,
    noCategoryCount,
    restockPriority,
    dailyThisMonth,
    dailyPrevMonth,
  ] = await Promise.all([
    prisma.machine.count({ where: { tenantId } }),
    prisma.inventorySnapshot.count({ where: { tenantId, isLow: true } }),
    prisma.location.count({ where: { tenantId } }),

    // Top 5 Beverages (using Product.category)
    prisma.$queryRawUnsafe<{ name: string; totalQty: number; revenue: number }[]>(
      `SELECT p."name",
              COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty",
              COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       JOIN "Product" p ON ol."productId" = p."id"
       WHERE oh."tenantId" = $1
         AND oh."payTime" IS NOT NULL
         AND oh."payTime" >= $2 AND oh."payTime" < $3
         AND oh."status" = 101
         AND p."category" ILIKE '%beverage%'
       GROUP BY p."id", p."name"
       ORDER BY "revenue" DESC
       LIMIT 5`,
      tenantId, b.thisMonthStart, b.thisMonthEnd,
    ),

    // Top 5 Snacks
    prisma.$queryRawUnsafe<{ name: string; totalQty: number; revenue: number }[]>(
      `SELECT p."name",
              COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty",
              COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       JOIN "Product" p ON ol."productId" = p."id"
       WHERE oh."tenantId" = $1
         AND oh."payTime" IS NOT NULL
         AND oh."payTime" >= $2 AND oh."payTime" < $3
         AND oh."status" = 101
         AND p."category" ILIKE '%snack%'
       GROUP BY p."id", p."name"
       ORDER BY "revenue" DESC
       LIMIT 5`,
      tenantId, b.thisMonthStart, b.thisMonthEnd,
    ),

    // Count of products with no category (for logging only, not per-row spam)
    prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(DISTINCT p."id")::int AS "count"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       JOIN "Product" p ON ol."productId" = p."id"
       WHERE oh."tenantId" = $1
         AND oh."payTime" IS NOT NULL
         AND oh."payTime" >= $2 AND oh."payTime" < $3
         AND oh."status" = 101
         AND (p."category" IS NULL OR p."category" = '')`,
      tenantId, b.thisMonthStart, b.thisMonthEnd,
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

    // Daily revenue — THIS month (using SUM(ol.quantity * ol.unitPrice) for truth parity)
    prisma.$queryRawUnsafe<{ day: number; revenue: number }[]>(
      `SELECT
         EXTRACT(DAY FROM oh."payTime" AT TIME ZONE 'America/Los_Angeles')::int AS "day",
         COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       WHERE oh."tenantId" = $1
         AND oh."payTime" IS NOT NULL
         AND oh."payTime" >= $2 AND oh."payTime" < $3
         AND oh."status" = 101
       GROUP BY "day"
       ORDER BY "day"`,
      tenantId, b.thisMonthStart, b.thisMonthEnd,
    ),

    // Daily revenue — PREVIOUS month
    prisma.$queryRawUnsafe<{ day: number; revenue: number }[]>(
      `SELECT
         EXTRACT(DAY FROM oh."payTime" AT TIME ZONE 'America/Los_Angeles')::int AS "day",
         COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
       FROM "OrderLine" ol
       JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
       WHERE oh."tenantId" = $1
         AND oh."payTime" IS NOT NULL
         AND oh."payTime" >= $2 AND oh."payTime" < $3
         AND oh."status" = 101
       GROUP BY "day"
       ORDER BY "day"`,
      tenantId, b.prevMonthStart, b.prevMonthEnd,
    ),
  ]);

  // Log warning about uncategorized products (once, not per-row)
  const uncatCount = noCategoryCount[0]?.count ?? 0;
  if (uncatCount > 0) {
    console.warn(
      `[dashboard] ${uncatCount} product(s) with no category — excluded from Top 5 Beverages/Snacks`,
    );
  }

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
      (a, b2) =>
        a.totalOnHand / a.totalCapacity - b2.totalOnHand / b2.totalCapacity,
    );

  // Count machines needing attention (below 50% OR has LOW items)
  const machinesNeedingAttention = Array.from(machineMap.values()).filter(
    (m) => m.hasLow || (m.totalCapacity > 0 && m.totalOnHand < m.totalCapacity * 0.5),
  ).length;

  // Fetch actual Net Revenue from our dashboard-kpis endpoint
  // This executes server-side, fetching via the API route natively.
  // We use the absolute URL for the fetch during SSR.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const kpisRes = await fetch(`${appUrl}/api/analytics/dashboard-kpis?window=today`, {
    headers: {
      cookie: `tenantId=${tenantId}`, // Pass tenant context if needed, though getTenantId() handles it
    },
    cache: "no-store",
  }).catch(() => null);

  let todayNet = 0;
  if (kpisRes?.ok) {
    const kpis = await kpisRes.json();
    todayNet = kpis.totals?.netRevenue ?? 0;
  }

  // Revenue KPIs from truth dataset (SUM(ol.quantity * ol.unitPrice) for parity)
  const todayRev = todayDerived.totals.totalRevenue;
  const thisRev = monthDerived.totals.totalRevenue;

  // Build daily chart data — align by day index (1..N)
  const thisMonthMap = new Map(dailyThisMonth.map((r) => [r.day, r.revenue]));
  const prevMonthMap = new Map(dailyPrevMonth.map((r) => [r.day, r.revenue]));
  const maxDay = Math.max(b.currentDay, ...dailyThisMonth.map((r) => r.day), ...dailyPrevMonth.map((r) => r.day));
  const chartData = [];
  for (let d = 1; d <= maxDay; d++) {
    chartData.push({
      label: String(d),
      thisMonth: Math.round((thisMonthMap.get(d) ?? 0) * 100) / 100,
      previousMonth: Math.round((prevMonthMap.get(d) ?? 0) * 100) / 100,
    });
  }

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
          sub="After profit share & cc fees"
        />
        <StatCard label="Machines Needing Attention" value={String(machinesNeedingAttention)} />
        <StatCard label="Low Stock Alerts" value={String(lowStockCount)} />
        <StatCard label="Active Locations" value={String(locationCount)} />
        <StatCard
          label="This Month Revenue"
          value={`$${fmt(thisRev)}`}
        />
      </div>

      {/* ── Revenue Chart — This Month vs Previous Month (§5.2) ── */}
      <div className="mt-6">
        <div className="rounded-xl border p-4">
          <h2 className="text-lg font-medium mb-3">This Month vs Previous Month</h2>
          <RevenueTrendLineChart data={chartData} />
        </div>
      </div>

      {/* ── Device KPIs (§5.new) ── */}
      <DeviceKpisTable />

      {/* ── Top 5 Beverages + Top 5 Snacks (§5.3) ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TopList title="Top 5 Beverages" items={topBeverages} />
        <TopList title="Top 5 Snacks" items={topSnacks} />
      </div>

      {/* ── Machines Below 50% Stock (§5.4) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Machines Below 50% Stock</h2>
        <div className="mt-2 overflow-auto">
          <div className="min-w-[650px] rounded-xl border">
            <div className="grid grid-cols-[1fr_1fr_80px_100px_80px_100px_24px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
              <div>Machine Name</div>
              <div>Location</div>
              <div>Stock %</div>
              <div>Revenue at Risk</div>
              <div>Status</div>
              <div>Suggested Units</div>
              <div></div>
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
                    className="grid grid-cols-[1fr_1fr_80px_100px_80px_100px_24px] gap-2 p-3 text-sm items-center hover:bg-muted/50 transition-colors"
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
                  {/* Revenue at risk computation stubbed for MVP logic scale */}
                  <div className="text-muted-foreground" title="Stubbed: requires velocity metrics">~${Math.round(suggested * 2.50)}</div>
                    <div className="text-muted-foreground">{m.status}</div>
                    <div>{suggested}</div>
                    <div className="flex justify-end pr-2 text-muted-foreground">
                      <Link href={`/machines/${m.machineId}`}>
                        <span aria-hidden="true">&rsaquo;</span>
                      </Link>
                    </div>
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
            <div className="grid grid-cols-[1fr_1fr_80px_100px_100px_100px_24px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
              <div>Machine</div>
              <div>Location</div>
              <div>Stock %</div>
              <div>Revenue at Risk</div>
              <div>Suggested Units</div>
              <div>Priority Score</div>
              <div></div>
            </div>
            {restockPriority.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                No LOW items currently.
              </div>
            ) : (
              restockPriority.map((r) => (
                <div
                  key={r.machineId}
                  className="grid grid-cols-[1fr_1fr_80px_100px_100px_100px_24px] gap-2 p-3 text-sm items-center hover:bg-muted/50 transition-colors"
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
                  <div className="text-muted-foreground text-xs" title="Varies per machine map">
                    {machineMap.get(r.machineId) ? `${Math.round((machineMap.get(r.machineId)!.totalOnHand / machineMap.get(r.machineId)!.totalCapacity) * 100)}%` : "—"}
                  </div>
                  <div className="text-muted-foreground" title="Stubbed: approx average revenue scale">
                    ~${Math.round(r.totalNeeded * 2.50)}
                  </div>
                  <div>{r.totalNeeded}</div>
                  <div className="font-medium">
                    {r.avgDaysOfCover !== null
                      ? r.avgDaysOfCover.toFixed(1)
                      : "—"}
                  </div>
                  <div className="flex justify-end pr-2 text-muted-foreground">
                    <Link href={`/restock-queue?machineId=${r.machineId}`}>
                      <span aria-hidden="true">&rsaquo;</span>
                    </Link>
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
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
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
