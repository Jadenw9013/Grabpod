import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/dev/haha-parity-check?date=YYYY-MM-DD
 *
 * DB-ONLY parity check. Does NOT call the Haha API.
 * Returns paid/pending/unknown order counts + sums for a given date.
 * Fast: target < 500ms.
 *
 * For live vendor comparison, use /api/dev/haha-parity-check-live instead.
 */
export async function GET(request: NextRequest) {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const t0 = performance.now();
    const tenantId = getTenantId();

    const dateStr = request.nextUrl.searchParams.get("date");
    const dateToCheck = dateStr ? new Date(dateStr + "T00:00:00Z") : new Date();

    const y = dateToCheck.getUTCFullYear();
    const m = dateToCheck.getUTCMonth();
    const d = dateToCheck.getUTCDate();
    const dayStart = new Date(Date.UTC(y, m, d));
    const dayEnd = new Date(Date.UTC(y, m, d + 1));

    // DB query 1: orders created on this date
    const tQ1 = performance.now();
    const orders = await prisma.orderHeader.findMany({
        where: {
            tenantId,
            createdAt: { gte: dayStart, lt: dayEnd },
        },
        select: {
            orderNo: true,
            status: true,
            grossAmount: true,
            actualPaymentAmount: true,
            payTime: true,
            createdAt: true,
        },
    });
    const tQ1End = performance.now();

    // DB query 2: orders paid on this date (may have been created earlier)
    const tQ2 = performance.now();
    const paidOnDate = await prisma.orderHeader.findMany({
        where: {
            tenantId,
            payTime: { gte: dayStart, lt: dayEnd },
        },
        select: {
            orderNo: true,
            status: true,
            grossAmount: true,
            actualPaymentAmount: true,
            payTime: true,
            createdAt: true,
        },
    });
    const tQ2End = performance.now();

    // Union by orderNo
    const allMap = new Map(orders.map((o) => [o.orderNo, o]));
    for (const o of paidOnDate) {
        allMap.set(o.orderNo, o);
    }
    const all = [...allMap.values()];

    const paid = all.filter((o) => o.status === 101);
    const pending = all.filter((o) => o.status === 200);
    const unknown = all.filter((o) => o.status !== 101 && o.status !== 200);

    const sum = (arr: typeof all) =>
        Math.round(
            arr.reduce((s, o) => s + o.actualPaymentAmount, 0) * 100,
        ) / 100;

    const tEnd = performance.now();

    const timing = {
        totalMs: Math.round(tEnd - t0),
        queryCreatedMs: Math.round(tQ1End - tQ1),
        queryPaidMs: Math.round(tQ2End - tQ2),
        hahaApiCalls: 0,
    };

    console.log(
        `[parity-check] DB-only for ${dayStart.toISOString().slice(0, 10)}: ` +
        `${timing.totalMs}ms total, ${timing.queryCreatedMs}ms q1, ${timing.queryPaidMs}ms q2, ` +
        `${all.length} orders (${paid.length} paid, ${pending.length} pending, ${unknown.length} unknown)`,
    );

    return NextResponse.json({
        date: dayStart.toISOString().slice(0, 10),
        tenantId,
        mode: "db-only",
        createdOnDate: orders.length,
        paidOnDate: paidOnDate.length,
        unionTotal: all.length,
        paid: { count: paid.length, sumActualPayment: sum(paid) },
        pending: { count: pending.length, sumActualPayment: sum(pending) },
        unknown: { count: unknown.length, sumActualPayment: sum(unknown) },
        total: { count: all.length, sumActualPayment: sum(all) },
        timing,
        note:
            "DB-only query. Compare 'paid.count' and 'paid.sumActualPayment' to Haha app Sales view. " +
            "Pending orders (status=200) are expected to differ until payment completes.",
    });
}
