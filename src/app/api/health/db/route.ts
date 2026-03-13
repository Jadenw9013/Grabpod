import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LA_TZ = "America/Los_Angeles";

/** Midnight on a LA-local date expressed as a UTC instant (same as dashboard-kpis). */
function laToUtc(year: number, month: number, day: number): Date {
  const probe = new Date(Date.UTC(year, month, day, 12));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const offsetPart = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT-08:00";
  const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetSign = match?.[1] === "+" ? 1 : -1;
  const offsetHours = parseInt(match?.[2] ?? "8", 10);
  const offsetMinutes = parseInt(match?.[3] ?? "0", 10);
  const offsetMs = offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000;
  return new Date(Date.UTC(year, month, day) - offsetMs);
}

/** Get LA-local today boundaries as UTC Date objects. */
function todayBoundsLA(): { start: Date; end: Date } {
  const now = new Date();
  const laDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: LA_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const [yStr, mStr, dStr] = laDateStr.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10) - 1; // 0-indexed
  const d = parseInt(dStr, 10);
  return { start: laToUtc(y, m, d), end: laToUtc(y, m, d + 1) };
}

/** Human-readable relative time (e.g. "2m ago", "3h ago"). */
function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export async function GET() {
  try {
    const tenantId = process.env.DEV_TENANT_ID ?? "dev-tenant";

    // 1. Basic connection check
    await prisma.$queryRaw`SELECT 1`;

    // 2. Telemetry: latest sync run
    const lastSync = await prisma.syncRun.findFirst({
      where: { tenantId, vendor: "haha" },
      orderBy: { startedAt: "desc" },
    });

    // 3. Telemetry: latest order ingested
    const lastOrder = await prisma.orderHeader.findFirst({
      where: { tenantId },
      orderBy: { payTime: "desc" },
    });

    // 4. Today's window: how many paid orders fall in today (LA time)?
    const { start, end } = todayBoundsLA();
    const todayOrders = await prisma.orderHeader.count({
      where: {
        tenantId,
        status: 101,
        payTime: { gte: start, lt: end },
      },
    });
    const todayRevenue = await prisma.orderHeader.aggregate({
      where: {
        tenantId,
        status: 101,
        payTime: { gte: start, lt: end },
      },
      _sum: { actualPaymentAmount: true },
    });

    return NextResponse.json({
      ok: true,
      lastSync: lastSync ? {
        status: lastSync.status,
        startedAt: lastSync.startedAt,
        finishedAt: lastSync.finishedAt,
        syncAge: lastSync.finishedAt ? timeAgo(lastSync.finishedAt) : lastSync.startedAt ? timeAgo(lastSync.startedAt) : null,
        importedOrders: lastSync.importedOrders,
        message: lastSync.message,
      } : null,
      lastOrder: lastOrder ? {
        orderNo: lastOrder.orderNo,
        payTime: lastOrder.payTime,
        age: lastOrder.payTime ? timeAgo(lastOrder.payTime) : null,
      } : null,
      todayWindow: {
        start: start.toISOString(),
        end: end.toISOString(),
        paidOrders: todayOrders,
        grossRevenue: todayRevenue._sum.actualPaymentAmount ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
