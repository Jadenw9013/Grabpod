import { prisma } from "../src/lib/prisma";

const LA_TZ = "America/Los_Angeles";

function laToUtc(year: number, month: number, day: number): Date {
    const probe = new Date(Date.UTC(year, month, day, 12));
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: LA_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "longOffset",
    }).formatToParts(probe);
    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-08:00";
    const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
    const offsetSign = match?.[1] === "+" ? 1 : -1;
    const offsetHours = parseInt(match?.[2] ?? "8", 10);
    const offsetMinutes = parseInt(match?.[3] ?? "0", 10);
    const offsetMs = offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000;
    return new Date(Date.UTC(year, month, day) - offsetMs);
}

async function main() {
    const tenantId = process.env.DEV_TENANT_ID;
    const now = new Date();
    const laDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: LA_TZ, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(now);
    const [yStr, mStr, dStr] = laDateStr.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10) - 1;
    const d = parseInt(dStr, 10);

    const start = laToUtc(y, m, d);
    const end = laToUtc(y, m, d + 1);

    console.log(`Checking DB for orders in LA today: ${start.toISOString()} to ${end.toISOString()}`);

    const todayOrders = await prisma.orderHeader.findMany({
        where: {
            tenantId,
            status: 101,
            payTime: { gte: start, lt: end }
        },
        select: { orderNo: true, payTime: true, actualPaymentAmount: true }
    });

    console.log(`Found ${todayOrders.length} orders for today:`);
    console.log(todayOrders);
}

main().catch(console.error).finally(() => prisma.$disconnect());
