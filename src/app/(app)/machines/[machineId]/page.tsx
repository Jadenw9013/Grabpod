import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { notFound } from "next/navigation";
import { InventoryTable } from "./inventory-table";
import { SalesHistoryLineChart } from "@/components/charts/SalesHistoryLineChart";

export const dynamic = "force-dynamic";

export default async function MachineDetailPage({
  params,
}: {
  params: Promise<{ machineId: string }>;
}) {
  const { machineId } = await params;
  const tenantId = getTenantId();

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, tenantId },
    include: { location: true },
  });

  if (!machine) notFound();

  const inventory = await prisma.inventorySnapshot.findMany({
    where: { machineId },
    include: { product: { select: { name: true, category: true } } },
    orderBy: { product: { name: "asc" } },
  });

  // ── Sales data ──
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const todayStart = new Date(Date.UTC(y, m, now.getUTCDate()));
  const todayEnd = new Date(Date.UTC(y, m, now.getUTCDate() + 1));
  const thisMonthStart = new Date(Date.UTC(y, m, 1));
  const thisMonthEnd = new Date(Date.UTC(y, m + 1, 1));
  const prevMonthStart = new Date(Date.UTC(y, m - 1, 1));
  const prevMonthEnd = thisMonthStart;

  const [todayRevRows, thisMonthRevRows, prevMonthRevRows, top3Products] =
    await Promise.all([
      prisma.$queryRawUnsafe<{ revenue: number }[]>(
        `SELECT COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
         FROM "OrderLine" ol
         JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
         WHERE oh."machineId" = $1 AND oh."createdAt" >= $2 AND oh."createdAt" < $3`,
        machineId, todayStart, todayEnd,
      ),
      prisma.$queryRawUnsafe<{ revenue: number }[]>(
        `SELECT COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
         FROM "OrderLine" ol
         JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
         WHERE oh."machineId" = $1 AND oh."createdAt" >= $2 AND oh."createdAt" < $3`,
        machineId, thisMonthStart, thisMonthEnd,
      ),
      prisma.$queryRawUnsafe<{ revenue: number }[]>(
        `SELECT COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
         FROM "OrderLine" ol
         JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
         WHERE oh."machineId" = $1 AND oh."createdAt" >= $2 AND oh."createdAt" < $3`,
        machineId, prevMonthStart, prevMonthEnd,
      ),
      prisma.$queryRawUnsafe<{ name: string; revenue: number }[]>(
        `SELECT p."name",
                COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
         FROM "OrderLine" ol
         JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
         JOIN "Product" p ON ol."productId" = p."id"
         WHERE oh."machineId" = $1
           AND oh."createdAt" >= $2 AND oh."createdAt" < $3
         GROUP BY p."id", p."name"
         ORDER BY "revenue" DESC
         LIMIT 3`,
        machineId, thisMonthStart, thisMonthEnd,
      ),
    ]);

  const todayRev = todayRevRows[0]?.revenue ?? 0;
  const thisMonthRev = thisMonthRevRows[0]?.revenue ?? 0;
  const prevMonthRev = prevMonthRevRows[0]?.revenue ?? 0;

  // ── Restock History from InventoryEvent ──
  const restockHistory = await prisma.inventoryEvent.findMany({
    where: { machineId, reason: { contains: "restock" } },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Aggregate restock events by session/date
  const restockByDate = new Map<
    string,
    { date: Date; products: string[]; totalUnits: number; performedBy: string }
  >();
  for (const ev of restockHistory) {
    const dateKey = ev.createdAt.toISOString().slice(0, 10);
    const existing = restockByDate.get(dateKey);
    if (existing) {
      existing.products.push(ev.product.name);
      existing.totalUnits += ev.change;
    } else {
      restockByDate.set(dateKey, {
        date: ev.createdAt,
        products: [ev.product.name],
        totalUnits: ev.change,
        performedBy: "—", // TODO: Wire to user who performed the restock
      });
    }
  }

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <main className="p-6">
      {/* ── Header (§6.1) ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {machine.stickerNum ?? "Machine"}{" "}
            <span className="text-muted-foreground font-normal text-base">
              {machine.location?.name ?? "No location"}
            </span>
          </h1>
          <div className="mt-1 flex gap-4 text-sm text-muted-foreground">
            <span>
              Status:{" "}
              <span className="text-foreground">{machine.status === "active" ? "Online" : "Offline"}</span>
            </span>
            <span>
              Last Sync:{" "}
              <span className="text-foreground">
                {machine.lastSeen ? machine.lastSeen.toLocaleString() : "Never"}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Total Products Offered (§6.2) ── */}
      <div className="mt-4 rounded-xl border p-4 w-fit">
        <div className="text-sm text-muted-foreground">Total Products Offered</div>
        <div className="text-2xl font-semibold">{inventory.length} products</div>
      </div>

      {/* ── Current Inventory Table (§6.2) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Current Inventory</h2>
        <InventoryTable
          machineId={machine.id}
          rows={inventory.map((i) => ({
            id: i.id,
            productId: i.productId,
            productName: i.product.name,
            category: i.product.category,
            onHand: i.onHand,
            capacity: i.capacity,
            isLow: i.isLow,
            daysOfCover: i.daysOfCover,
          }))}
        />
      </div>

      {/* ── Sales Summary (§6.3) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Sales Summary</h2>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <div className="text-sm text-muted-foreground">Revenue Today</div>
            <div className="text-xl font-semibold">${fmt(todayRev)}</div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-sm text-muted-foreground">Revenue This Month</div>
            <div className="text-xl font-semibold">${fmt(thisMonthRev)}</div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-sm text-muted-foreground">Top 3 Products</div>
            {top3Products.length === 0 ? (
              <div className="text-sm text-muted-foreground mt-1">No sales data</div>
            ) : (
              <div className="mt-1 space-y-0.5">
                {top3Products.map((p, i) => (
                  <div key={i} className="text-sm truncate">
                    {i + 1}. {p.name}{" "}
                    <span className="text-muted-foreground">${fmt(p.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sales History Chart (§6.4) ── */}
      <div className="mt-6">
        <div className="rounded-xl border p-4">
          <h2 className="text-lg font-medium mb-3">Sales History</h2>
          <SalesHistoryLineChart
            data={[
              { label: "Total", thisMonth: thisMonthRev, previousMonth: prevMonthRev },
            ]}
          />
        </div>
      </div>

      {/* ── Restock History (§6.5) ── */}
      <div className="mt-6">
        <h2 className="text-lg font-medium">Restock History</h2>
        <div className="mt-2 overflow-auto">
          <div className="min-w-[500px] rounded-xl border">
            <div className="grid grid-cols-4 gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
              <div>Date</div>
              <div>Products Restocked</div>
              <div>Total Units</div>
              <div>Performed By</div>
            </div>
            {restockByDate.size === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                No restock history for this machine.
              </div>
            ) : (
              Array.from(restockByDate.values()).map((entry, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-4 gap-2 border-b p-3 text-sm last:border-0"
                >
                  <div>{entry.date.toLocaleDateString()}</div>
                  <div className="truncate">{entry.products.length} products</div>
                  <div>{entry.totalUnits}</div>
                  <div className="text-muted-foreground">{entry.performedBy}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

