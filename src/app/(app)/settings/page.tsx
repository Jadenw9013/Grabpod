import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
    const tenantId = getTenantId();

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, createdAt: true },
    });

    // Last 5 sync runs
    const recentSyncs = await prisma.syncRun.findMany({
        where: { tenantId },
        orderBy: { startedAt: "desc" },
        take: 5,
        select: {
            id: true,
            vendor: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            message: true,
            importedOrders: true,
            importedLines: true,
            createdProducts: true,
            createdMachines: true,
        },
    });

    // Check if a sync is currently running
    const hasRunningSync = recentSyncs.some((s) => s.status === "running");

    // Environment info (non-secret)
    const hahaConfigured = !!(
        process.env.HAHA_HOST &&
        process.env.HAHA_APPKEY &&
        process.env.HAHA_APPSECRET
    );

    return (
        <main className="p-6">
            <h1 className="text-xl font-semibold">Settings</h1>

            {/* ── Tenant Info ── */}
            <section className="mt-6 rounded-xl border p-4">
                <h2 className="text-lg font-medium">Tenant</h2>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    <div>
                        <span className="text-muted-foreground">ID: </span>
                        <span className="font-mono text-xs">{tenant?.id ?? "—"}</span>
                    </div>
                    <div>
                        <span className="text-muted-foreground">Name: </span>
                        {tenant?.name ?? "—"}
                    </div>
                    <div>
                        <span className="text-muted-foreground">Created: </span>
                        {tenant?.createdAt
                            ? new Date(tenant.createdAt).toLocaleDateString()
                            : "—"}
                    </div>
                </div>
            </section>

            {/* ── Integrations ── */}
            <section className="mt-6 rounded-xl border p-4">
                <h2 className="text-lg font-medium">Integrations</h2>

                <div className="mt-3 rounded border p-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-medium">Haha Vending API</h3>
                            <p className="text-xs text-muted-foreground">
                                {hahaConfigured
                                    ? "✅ Credentials configured"
                                    : "⚠ Missing HAHA_HOST, HAHA_APPKEY, or HAHA_APPSECRET"}
                            </p>
                        </div>
                        <SettingsClient
                            hahaConfigured={hahaConfigured}
                            hasRunningSync={hasRunningSync}
                        />
                    </div>

                    {/* Recent Sync Runs */}
                    {recentSyncs.length > 0 && (
                        <div className="mt-3">
                            <h4 className="text-xs font-medium text-muted-foreground">
                                Recent Syncs
                            </h4>
                            <div className="mt-1 space-y-1">
                                {recentSyncs.map((s) => (
                                    <div
                                        key={s.id}
                                        className="flex items-center gap-3 text-xs"
                                    >
                                        <span
                                            className={`inline-block w-2 h-2 rounded-full ${s.status === "success"
                                                    ? "bg-green-500"
                                                    : s.status === "error"
                                                        ? "bg-red-500"
                                                        : "bg-yellow-500 animate-pulse"
                                                }`}
                                        />
                                        <span className="w-16 capitalize">{s.status}</span>
                                        <span className="text-muted-foreground">
                                            {new Date(s.startedAt).toLocaleString(undefined, {
                                                month: "short",
                                                day: "numeric",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </span>
                                        {s.status === "success" && (
                                            <span className="text-muted-foreground">
                                                {s.importedOrders} orders · {s.importedLines} lines ·{" "}
                                                {s.createdMachines} new machines · {s.createdProducts}{" "}
                                                new products
                                            </span>
                                        )}
                                        {s.status === "error" && s.message && (
                                            <span
                                                className="truncate text-muted-foreground"
                                                title={s.message}
                                            >
                                                {s.message.slice(0, 80)}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* ── Configuration ── */}
            <section className="mt-6 rounded-xl border p-4">
                <h2 className="text-lg font-medium">Configuration</h2>
                <div className="mt-2 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                            Target Days Until Restock
                        </span>
                        <span className="font-medium">3 days</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                        TODO: Add TenantSettings model to make this configurable.
                        Currently hardcoded in LOW threshold computation.
                    </p>
                </div>
            </section>
        </main>
    );
}
