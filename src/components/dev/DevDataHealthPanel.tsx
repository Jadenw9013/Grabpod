"use client";

/**
 * Dev-only data health panel for the dashboard.
 * Shows row counts. No seeding — all data comes from Haha API sync.
 * Hidden in production (server-rendered check gates it in the parent).
 */
export function DevDataHealthPanel({
    machines,
    locations,
    lowStockAlerts,
}: {
    machines: number;
    locations: number;
    lowStockAlerts: number;
}) {
    return (
        <div className="mt-2 rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium">Data Health:</span>{" "}
            {machines} machines · {locations} locations · {lowStockAlerts} low stock alerts
        </div>
    );
}
