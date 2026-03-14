import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const WAREHOUSE_LOW_THRESHOLD = 10;

export default async function InventoryPage() {
    const tenantId = getTenantId();

    const rows = await prisma.warehouseStock.findMany({
        where: { tenantId },
        include: {
            product: {
                select: { id: true, apexSku: true, name: true, category: true },
            },
        },
        orderBy: { product: { name: "asc" } },
    });

    const totalUnits = rows.reduce((sum, r) => sum + r.onHand, 0);
    const totalSkus = rows.length;
    const lowItems = rows.filter((r) => r.onHand <= WAREHOUSE_LOW_THRESHOLD).length;

    return (
        <main className="p-6">
            <h1 className="text-xl font-semibold">Inventory</h1>
            <p className="mt-1 text-sm text-muted-foreground">
                Warehouse inventory management
            </p>

            {/* Metric cards */}
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <MetricCard label="Total Warehouse Units" value={totalUnits.toLocaleString()} />
                <MetricCard label="Total SKUs" value={String(totalSkus)} />
                <MetricCard label="Low Warehouse Items" value={String(lowItems)} />
            </div>

            {/* Warehouse inventory table */}
            <div className="mt-6 overflow-auto">
                <div className="min-w-[600px] rounded-xl border">
                    <div className="grid grid-cols-[1fr_120px_120px_120px_140px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
                        <div>Product Name</div>
                        <div>Apex SKU</div>
                        <div>Category</div>
                        <div>Stock On Hand</div>
                        <div>Last Updated</div>
                    </div>
                    {rows.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">
                            No warehouse stock data.
                        </div>
                    ) : (
                        rows.map((r) => (
                            <div
                                key={r.id}
                                className="grid grid-cols-[1fr_120px_120px_120px_140px] gap-2 border-b p-3 text-sm last:border-0"
                            >
                                <div className="truncate">{r.product.name}</div>
                                <div className="text-muted-foreground truncate">
                                    {r.product.apexSku ?? "—"}
                                </div>
                                <div className="text-muted-foreground truncate">
                                    {r.product.category ?? "—"}
                                </div>
                                <div className="flex items-center">
                                    {r.onHand}
                                    {r.onHand <= WAREHOUSE_LOW_THRESHOLD && (
                                        <span
                                            className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ml-2"
                                            title={`Below threshold (${WAREHOUSE_LOW_THRESHOLD})`}
                                        >
                                            LOW
                                        </span>
                                    )}
                                </div>
                                <div className="text-muted-foreground text-xs">
                                    {r.updatedAt.toLocaleDateString()}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </main>
    );
}

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold">{value}</div>
        </div>
    );
}
