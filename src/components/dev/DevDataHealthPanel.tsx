"use client";

import { useState } from "react";

/**
 * Dev-only data health panel for the dashboard.
 * Shows row counts and a "Seed beta data" button.
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
    const [seeding, setSeeding] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    async function handleSeed() {
        setSeeding(true);
        setResult(null);
        try {
            const res = await fetch("/api/dev/seed-beta", { method: "POST" });
            const data = await res.json();
            if (data.error) {
                setResult(`❌ ${data.error}`);
            } else {
                const c = data.created;
                setResult(
                    `✅ Created: ${c.inventorySnapshots} snapshots, ${c.warehouseStocks} warehouse, ` +
                    `${c.locations} locations, ${c.contracts} contracts. Refresh page to see data.`,
                );
            }
        } catch (err) {
            setResult(`❌ ${err instanceof Error ? err.message : "Network error"}`);
        } finally {
            setSeeding(false);
        }
    }

    return (
        <div className="mt-2 rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
                <span>
                    <span className="font-medium">Data Health:</span>{" "}
                    {machines} machines · {locations} locations · {lowStockAlerts} low stock alerts
                </span>
                <button
                    onClick={handleSeed}
                    disabled={seeding}
                    className="rounded bg-gray-200 px-2 py-0.5 text-[10px] font-medium hover:bg-gray-300 disabled:opacity-50"
                >
                    {seeding ? "Seeding..." : "Seed beta data"}
                </button>
            </div>
            {result && (
                <div className="mt-1 text-[10px]">{result}</div>
            )}
        </div>
    );
}
