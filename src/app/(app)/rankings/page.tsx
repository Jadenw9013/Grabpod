import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function RankingsPage() {
  const tenantId = getTenantId();

  // Top 10 products by quantity sold
  const topGrouped = await prisma.orderLine.groupBy({
    by: ["productId"],
    where: { order: { tenantId } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 10,
  });

  // Bottom 10 products by quantity sold
  const bottomGrouped = await prisma.orderLine.groupBy({
    by: ["productId"],
    where: { order: { tenantId } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "asc" } },
    take: 10,
  });

  // Fetch product details for all ranked IDs
  const allProductIds = [
    ...topGrouped.map((g) => g.productId),
    ...bottomGrouped.map((g) => g.productId),
  ];
  const products = await prisma.product.findMany({
    where: { id: { in: allProductIds } },
    select: { id: true, name: true, category: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Revenue per product
  const revenueByProduct = await prisma.$queryRawUnsafe<
    { productId: string; revenue: number }[]
  >(
    `SELECT ol."productId",
            COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     WHERE oh."tenantId" = $1
     GROUP BY ol."productId"`,
    tenantId,
  );
  const revMap = new Map(revenueByProduct.map((r) => [r.productId, r.revenue]));

  // Count distinct locations per product
  const locCounts = await prisma.$queryRawUnsafe<
    { productId: string; locCount: number }[]
  >(
    `SELECT ol."productId",
            COUNT(DISTINCT m."locationId")::int AS "locCount"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     JOIN "Machine" m ON oh."machineId" = m."id"
     WHERE oh."tenantId" = $1
     GROUP BY ol."productId"`,
    tenantId,
  );
  const locMap = new Map(locCounts.map((l) => [l.productId, l.locCount]));

  const makeRanked = (grouped: typeof topGrouped) =>
    grouped.map((g) => ({
      productId: g.productId,
      name: productMap.get(g.productId)?.name ?? "Unknown",
      category: productMap.get(g.productId)?.category ?? "—",
      qty: g._sum.quantity ?? 0,
      revenue: revMap.get(g.productId) ?? 0,
      locationsActive: locMap.get(g.productId) ?? 0,
    }));

  const topRanked = makeRanked(topGrouped);
  const bottomRanked = makeRanked(bottomGrouped);

  // Performance by Location
  const locationPerf = await prisma.$queryRawUnsafe<
    { locationName: string; revenue: number; unitsSold: number }[]
  >(
    `SELECT l."name" AS "locationName",
            COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue",
            COALESCE(SUM(ol."quantity"), 0)::float AS "unitsSold"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     JOIN "Machine" m ON oh."machineId" = m."id"
     LEFT JOIN "Location" l ON m."locationId" = l."id"
     WHERE oh."tenantId" = $1
     GROUP BY l."name"
     ORDER BY "revenue" DESC`,
    tenantId,
  );

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Product Rankings</h1>

      {/* ── Filter row (§7.1) — UI-only, TODO: wire to backend ── */}
      <div className="mt-4 flex flex-wrap gap-3">
        <FilterSelect label="Date Range" options={["All Time", "This Month", "Last 30 Days"]} />
        <FilterSelect label="Location" options={["All Locations"]} />
        <FilterSelect label="Machine" options={["All Machines"]} />
        <FilterSelect label="Cluster Area" options={["All Clusters"]} />
        <FilterSelect label="Category" options={["All Categories"]} />
        {/* TODO: Wire filters to backend queries */}
      </div>

      {/* ── Top 10 Products (§7.2) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Top 10 Products (by quantity sold)</h2>
        <RankTable ranked={topRanked} fmt={fmt} />
      </div>

      {/* ── Lowest 10 Products (§7.3) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Lowest 10 Performing Products</h2>
        <RankTable ranked={bottomRanked} fmt={fmt} />
      </div>

      {/* ── Performance by Location (§7.4) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Performance by Location</h2>
        <div className="mt-2 overflow-auto">
          <div className="min-w-[400px] rounded-xl border">
            <div className="grid grid-cols-3 gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
              <div>Location</div>
              <div className="text-right">Revenue</div>
              <div className="text-right">Units Sold</div>
            </div>
            {locationPerf.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No data.</div>
            ) : (
              locationPerf.map((loc, idx) => {
                const maxRev = locationPerf[0]?.revenue ?? 1;
                const intensity = Math.round(
                  (loc.revenue / maxRev) * 100,
                );
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-3 gap-2 border-b p-3 text-sm last:border-0"
                    style={{
                      backgroundColor: `rgba(0, 0, 0, ${intensity * 0.001 + 0.02})`,
                    }}
                  >
                    <div>{loc.locationName ?? "Unassigned"}</div>
                    <div className="text-right">${fmt(loc.revenue)}</div>
                    <div className="text-right">{loc.unitsSold.toFixed(0)}</div>
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

function FilterSelect({
  label,
  options,
}: {
  label: string;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </label>
      <select className="rounded border bg-background px-2 py-1.5 text-sm">
        {options.map((opt) => (
          <option key={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function RankTable({
  ranked,
  fmt,
}: {
  ranked: {
    productId: string;
    name: string;
    category: string;
    qty: number;
    revenue: number;
    locationsActive: number;
  }[];
  fmt: (n: number) => string;
}) {
  return (
    <div className="mt-2 overflow-auto">
      <div className="min-w-[600px] rounded-xl border">
        <div className="grid grid-cols-[40px_1fr_100px_80px_90px_100px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
          <div>Rank</div>
          <div>Product Name</div>
          <div>Category</div>
          <div className="text-right">Units Sold</div>
          <div className="text-right">Revenue</div>
          <div className="text-right">Locations Active</div>
        </div>
        {ranked.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">No data.</div>
        ) : (
          ranked.map((r, idx) => (
            <div
              key={r.productId}
              className="grid grid-cols-[40px_1fr_100px_80px_90px_100px] gap-2 border-b p-3 text-sm last:border-0"
            >
              <div className="text-muted-foreground">{idx + 1}</div>
              <div className="truncate">{r.name}</div>
              <div className="text-muted-foreground truncate">{r.category}</div>
              <div className="text-right">{r.qty.toFixed(0)}</div>
              <div className="text-right">${fmt(r.revenue)}</div>
              <div className="text-right">{r.locationsActive}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
