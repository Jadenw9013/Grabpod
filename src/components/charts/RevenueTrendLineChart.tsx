"use client";

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";

export interface RevenueTrendPoint {
    label: string;
    thisMonth: number;
    previousMonth: number;
}

const currencyFormatter = (v: number) =>
    `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function RevenueTrendLineChart({
    data,
}: {
    data: RevenueTrendPoint[];
}) {
    if (data.length === 0) {
        return (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                No daily breakdown yet
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#888" }}
                    axisLine={{ stroke: "#d4d4d4" }}
                    tickLine={false}
                />
                <YAxis
                    tickFormatter={currencyFormatter}
                    tick={{ fontSize: 11, fill: "#888" }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                />
                <Tooltip
                    formatter={(value: string | number | readonly (string | number)[] | undefined) => currencyFormatter(Number(value) || 0)}
                    contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e5e5e5",
                        borderRadius: 6,
                        fontSize: 12,
                    }}
                />
                <Legend
                    align="right"
                    verticalAlign="top"
                    iconType="line"
                    wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                />
                <Line
                    type="monotone"
                    dataKey="thisMonth"
                    name="This Month"
                    stroke="#404040"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#404040" }}
                />
                <Line
                    type="monotone"
                    dataKey="previousMonth"
                    name="Previous Month"
                    stroke="#a3a3a3"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    activeDot={{ r: 4, fill: "#a3a3a3" }}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}
