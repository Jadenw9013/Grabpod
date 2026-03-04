"use client";

import { useCallback, useEffect, useState } from "react";

export const dynamic = "force-dynamic";

interface ProductRow {
  productId: string;
  apexSku: string | null;
  name: string;
  category: string | null;
  totalQty: number;
  revenue: number;
  cost: number | null;
  margin: number | null;
  hasCost: boolean;
}

interface ProfitabilityData {
  range: { start: string; end: string };
  topProducts: ProductRow[];
}

export default function ProfitabilityPage() {
  const [month, setMonth] = useState<"this" | "previous">("this");
  const [data, setData] = useState<ProfitabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (m: string) => {
    try {
      const res = await fetch(`/api/analytics/profitability?month=${m}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Error ${res.status}`);
      }
      const d = await res.json();
      setData(d as ProfitabilityData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(month);
  }, [month, fetchData]);

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totals = data?.topProducts.reduce(
    (acc, r) => ({
      qty: acc.qty + r.totalQty,
      revenue: acc.revenue + r.revenue,
      cost: acc.cost + (r.cost ?? 0),
      margin: acc.margin + (r.margin ?? 0),
    }),
    { qty: 0, revenue: 0, cost: 0, margin: 0 },
  );

  return (
    <main className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Profitability</h1>
        <div className="flex gap-1 rounded-lg border p-0.5 text-sm">
          <button
            onClick={() => { setLoading(true); setMonth("this"); }}
            className={`rounded-md px-3 py-1 ${month === "this" ? "bg-primary text-primary-foreground" : ""}`}
          >
            This Month
          </button>
          <button
            onClick={() => { setLoading(true); setMonth("previous"); }}
            className={`rounded-md px-3 py-1 ${month === "previous" ? "bg-primary text-primary-foreground" : ""}`}
          >
            Previous Month
          </button>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Top products by revenue. Margin shown only where product cost is available.
      </p>

      {loading && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && !loading && (
        <div className="mt-4 overflow-auto">
          <div className="min-w-[700px]">
            {/* Header */}
            <div className="grid grid-cols-[40px_1fr_100px_80px_90px_90px_90px] gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
              <div>#</div>
              <div>Product</div>
              <div>SKU</div>
              <div className="text-right">Qty</div>
              <div className="text-right">Revenue</div>
              <div className="text-right">Cost</div>
              <div className="text-right">Margin</div>
            </div>

            {data.topProducts.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No sales data for this period.
              </p>
            )}

            {data.topProducts.map((r, idx) => (
              <div
                key={r.productId}
                className="grid grid-cols-[40px_1fr_100px_80px_90px_90px_90px] gap-2 border-b py-2 text-sm"
              >
                <div className="text-muted-foreground">{idx + 1}</div>
                <div className="truncate">{r.name}</div>
                <div className="truncate text-muted-foreground">
                  {r.apexSku ?? "-"}
                </div>
                <div className="text-right">{r.totalQty}</div>
                <div className="text-right">{fmt(r.revenue)}</div>
                <div className="text-right">
                  {r.hasCost ? fmt(r.cost!) : (
                    <span className="text-muted-foreground">n/a</span>
                  )}
                </div>
                <div className="text-right">
                  {r.margin !== null ? (
                    <span className={r.margin < 0 ? "font-semibold" : ""}>
                      {fmt(r.margin)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">n/a</span>
                  )}
                </div>
              </div>
            ))}

            {/* Totals row */}
            {totals && data.topProducts.length > 0 && (
              <div className="grid grid-cols-[40px_1fr_100px_80px_90px_90px_90px] gap-2 py-2 text-sm font-semibold">
                <div />
                <div>Total (shown)</div>
                <div />
                <div className="text-right">{totals.qty}</div>
                <div className="text-right">{fmt(totals.revenue)}</div>
                <div className="text-right">{fmt(totals.cost)}</div>
                <div className="text-right">{fmt(totals.margin)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
