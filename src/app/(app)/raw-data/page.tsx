import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function RawDataPage() {
  const tenantId = getTenantId();

  // Fetch the latest 50 orders to verify accurate data pulling
  const orders = await prisma.orderHeader.findMany({
    where: { tenantId },
    orderBy: { payTime: "desc" },
    take: 50,
    include: {
      lines: {
        include: { product: true }
      },
      machine: true,
    },
  });

  return (
    <main className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Raw Data (Latest 50 Orders)</h1>
      </div>

      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Order No</th>
                <th className="p-3 font-medium">Machine</th>
                <th className="p-3 font-medium">Pay Time (UTC)</th>
                <th className="p-3 font-medium">Created At (UTC)</th>
                <th className="p-3 font-medium text-right">Gross</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    No orders synced yet.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.orderNo} className="hover:bg-muted/50 transition-colors">
                    <td className="p-3 font-mono text-xs">{order.orderNo}</td>
                    <td className="p-3">{order.machine.stickerNum ?? order.machine.vendorMachineId ?? order.machineId.slice(0, 8)}</td>
                    <td className="p-3 whitespace-nowrap">
                      {order.payTime ? order.payTime.toISOString().replace("T", " ").slice(0, 19) : "—"}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {order.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="p-3 text-right">
                      ${order.grossAmount.toFixed(2)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          order.status === 101
                            ? "bg-green-100 text-green-700"
                            : order.status === 200
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {order.status === 101 ? "Paid" : order.status === 200 ? "Pending" : `Other (${order.status})`}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground max-w-xs truncate">
                      {order.lines.map((l) => `${l.quantity}x ${l.product.name}`).join(", ")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
