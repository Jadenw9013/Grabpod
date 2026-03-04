"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncNowButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);

    try {
      const res = await fetch("/api/sync/haha", { method: "POST" });
      const data = await res.json();

      if (data.status === "success") {
        setMessage(
          `Synced ${data.importedOrders} orders, ${data.importedLines} lines`,
        );
      } else {
        setMessage(data.message ?? `Error (${res.status})`);
      }

      router.refresh();
    } catch {
      setMessage("Network error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={syncing}
        className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {syncing ? "Syncing..." : "Sync Now"}
      </button>
      {message && (
        <span className="text-sm text-muted-foreground">{message}</span>
      )}
    </div>
  );
}
