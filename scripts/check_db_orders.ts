import { prisma } from "../src/lib/prisma";

async function main() {
    const latest = await prisma.orderHeader.findMany({
        where: { status: 101 },
        orderBy: { payTime: "desc" },
        select: { orderNo: true, payTime: true },
        take: 5,
    });
    console.log(JSON.stringify(latest, null, 2));

    const countToday = await prisma.orderHeader.count({
        where: {
            status: 101,
            payTime: {
                gte: new Date('2026-03-06T08:00:00Z'), // LA Midnight
                lt: new Date('2026-03-07T08:00:00Z')
            }
        }
    });
    console.log(`DB Count for 2026-03-06 (LA): ${countToday}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
