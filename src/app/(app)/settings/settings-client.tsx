"use client";

import { useState } from "react";

/**
 * Client-side "Run Haha Sync Now" button for the Settings page.
 */
export function SettingsClient({
    hahaConfigured,
    hasRunningSync,
}: {
    hahaConfigured: boolean;
    hasRunningSync: boolean;
}) {
    const [syncing, setSyncing] = useState(hasRunningSync);
    const [result, setResult] = useState<string | null>(null);

    async function handleSync() {
        setSyncing(true);
        setResult(null);
        try {
            const res = await fetch("/api/sync/haha", { method: "POST" });
            const data = await res.json();
            if (data.status === "error") {
                setResult(`❌ ${data.message}`);
            } else {
                setResult(
                    `✅ ${data.importedOrders} orders, ${data.importedLines} lines imported`,
                );
            }
        } catch (err) {
            setResult(`❌ ${err instanceof Error ? err.message : "Network error"}`);
        } finally {
            setSyncing(false);
        }
    }

    return (
        <div className="flex flex-col items-end gap-1">
            <button
                onClick={handleSync}
                disabled={!hahaConfigured || syncing}
                className="rounded bg-gray-200 px-3 py-1 text-xs font-medium hover:bg-gray-300 disabled:opacity-50"
            >
                {syncing ? "Syncing..." : "Run Haha Sync Now"}
            </button>
            {result && <p className="text-[10px] max-w-[300px] text-right">{result}</p>}
        </div>
    );
}
