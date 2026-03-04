"use client";

import { useCallback, useEffect, useState } from "react";

interface DeviceKpi {
    machineId: string;
    machineName: string;
    deviceNumber: string | null;
    locationName: string;
    grossRevenue: number;
    netRevenue: number;
    orderCount: number;
    uniqueCards: number | null;
    repeatCustomerRate: number | null;
}

interface KpiData {
    window: string;
    range: { start: string; end: string };
    devices: DeviceKpi[];
    totals: {
        grossRevenue: number;
        netRevenue: number;
        orderCount: number;
        uniqueCards: number | null;
        repeatCustomerRate: number | null;
    };
}

type Window = "today" | "thisMonth" | "previousMonth";

const WINDOW_LABELS: Record<Window, string> = {
    today: "Today",
    thisMonth: "This Month",
    previousMonth: "Previous Month",
};

export function DeviceKpisTable() {
    const [windowParam, setWindowParam] = useState<Window>("thisMonth");
    const [data, setData] = useState<KpiData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async (w: Window) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/analytics/dashboard-kpis?window=${w}`);
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Error ${res.status}`);
            }
            setData(await res.json());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData(windowParam);
    }, [windowParam, fetchData]);

    const fmt = (n: number) =>
        n.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">Device KPIs</h2>
                <div className="flex gap-1 rounded-lg border p-0.5 text-xs">
                    {(Object.entries(WINDOW_LABELS) as [Window, string][]).map(
                        ([key, label]) => (
                            <button
                                key={key}
                                onClick={() => setWindowParam(key)}
                                className={`rounded-md px-2 py-0.5 transition-colors ${windowParam === key
                                        ? "bg-primary text-primary-foreground"
                                        : "hover:bg-muted"
                                    }`}
                            >
                                {label}
                            </button>
                        ),
                    )}
                </div>
            </div>

            {loading && (
                <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
            )}
            {error && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                    {error}
                </div>
            )}

            {data && !loading && (
                <>
                    {/* Summary cards */}
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border p-3">
                            <div className="text-xs text-muted-foreground">
                                Gross Revenue
                            </div>
                            <div className="mt-0.5 text-xl font-semibold">
                                ${fmt(data.totals.grossRevenue)}
                            </div>
                        </div>
                        <div className="rounded-xl border p-3">
                            <div className="text-xs text-muted-foreground">Net Revenue</div>
                            <div className="mt-0.5 text-xl font-semibold">
                                ${fmt(data.totals.netRevenue)}
                            </div>
                        </div>
                        <div className="rounded-xl border p-3">
                            <div className="text-xs text-muted-foreground">Total Orders</div>
                            <div className="mt-0.5 text-xl font-semibold">
                                {data.totals.orderCount}
                            </div>
                        </div>
                    </div>

                    {/* Per-device table */}
                    <div className="mt-3 overflow-auto rounded-xl border">
                        <div className="min-w-[650px]">
                            <div className="grid grid-cols-[1fr_1fr_100px_100px_70px] gap-2 border-b p-3 text-xs font-medium text-muted-foreground">
                                <div>Device</div>
                                <div>Location</div>
                                <div className="text-right">Gross Rev</div>
                                <div className="text-right">Net Rev</div>
                                <div className="text-right">Orders</div>
                            </div>

                            {data.devices.length === 0 ? (
                                <p className="p-3 text-sm text-muted-foreground">
                                    No orders in this period.
                                </p>
                            ) : (
                                <>
                                    {data.devices.map((d) => (
                                        <div
                                            key={d.machineId}
                                            className="grid grid-cols-[1fr_1fr_100px_100px_70px] gap-2 border-b p-3 text-sm"
                                        >
                                            <div className="truncate">{d.machineName}</div>
                                            <div className="truncate text-muted-foreground">
                                                {d.locationName}
                                            </div>
                                            <div className="text-right">${fmt(d.grossRevenue)}</div>
                                            <div className="text-right">${fmt(d.netRevenue)}</div>
                                            <div className="text-right">{d.orderCount}</div>
                                        </div>
                                    ))}
                                    {/* Totals footer */}
                                    <div className="grid grid-cols-[1fr_1fr_100px_100px_70px] gap-2 p-3 text-sm font-semibold">
                                        <div>Total</div>
                                        <div />
                                        <div className="text-right">
                                            ${fmt(data.totals.grossRevenue)}
                                        </div>
                                        <div className="text-right">
                                            ${fmt(data.totals.netRevenue)}
                                        </div>
                                        <div className="text-right">{data.totals.orderCount}</div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
