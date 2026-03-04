import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { SyncNowButton } from "./sync-now-button";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const tenantId = getTenantId();

  const runs = await prisma.syncRun.findMany({
    where: { tenantId },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return (
    <main className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sync Status</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Last 20 sync runs from the Haha vendor API.
          </p>
        </div>
        <SyncNowButton />
      </div>

      <div className="mt-4 rounded-xl border">
        <div className="grid grid-cols-7 gap-2 border-b p-3 text-xs text-muted-foreground">
          <div>Started</div>
          <div>Finished</div>
          <div>Status</div>
          <div>Orders</div>
          <div>Lines</div>
          <div>New Products</div>
          <div>Message</div>
        </div>
        {runs.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No sync runs yet. Click &ldquo;Sync Now&rdquo; or wait for the
            scheduled Inngest cron (every 10 min).
          </div>
        ) : (
          runs.map((run) => (
            <div
              key={run.id}
              className="grid grid-cols-7 gap-2 border-b p-3 text-xs last:border-0"
            >
              <div>{formatDate(run.startedAt)}</div>
              <div>{run.finishedAt ? formatDate(run.finishedAt) : "-"}</div>
              <div>
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                    run.status === "success"
                      ? "bg-green-100 text-green-700"
                      : run.status === "error"
                        ? "bg-red-100 text-red-700"
                        : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {run.status}
                </span>
              </div>
              <div>{run.importedOrders}</div>
              <div>{run.importedLines}</div>
              <div>{run.createdProducts}</div>
              <div className="truncate" title={run.message ?? ""}>
                {run.message ?? "-"}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
