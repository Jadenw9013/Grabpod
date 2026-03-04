"use client";

import { useState } from "react";

export const dynamic = "force-dynamic";

interface ImportResult {
  importedOrders: number;
  importedLines: number;
  createdProducts: number;
  createdMachines: number;
  skippedRows: { row: number; reason: string }[];
}

export default function ImportsPage() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploading(true);
    setResult(null);
    setError(null);

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];

    if (!file) {
      setError("Please select a file.");
      setUploading(false);
      return;
    }

    const body = new FormData();
    body.append("file", file);

    try {
      const res = await fetch("/api/import/orders-xlsx", {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
      } else {
        setResult(data as ImportResult);
      }
    } catch {
      setError("Network error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Import Orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload an XLSX file with order details. Re-uploading the same file is safe (idempotent).
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-3">
        <div>
          <label htmlFor="file" className="block text-sm font-medium mb-1">
            XLSX File
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".xlsx,.xls"
            className="text-sm file:mr-3 file:rounded file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
        </div>
        <button
          type="submit"
          disabled={uploading}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {uploading ? "Importing..." : "Import"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Orders" value={result.importedOrders} />
            <StatCard label="Lines" value={result.importedLines} />
            <StatCard label="New Products" value={result.createdProducts} />
            <StatCard label="New Machines" value={result.createdMachines} />
          </div>

          {result.skippedRows.length > 0 && (
            <div className="rounded-xl border">
              <div className="border-b p-3 text-sm font-medium">
                Skipped Rows ({result.skippedRows.length})
              </div>
              <div className="max-h-60 overflow-auto">
                {result.skippedRows.map((s, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[60px_1fr] gap-2 border-b p-2 text-xs last:border-0"
                  >
                    <div className="text-muted-foreground">Row {s.row}</div>
                    <div>{s.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
