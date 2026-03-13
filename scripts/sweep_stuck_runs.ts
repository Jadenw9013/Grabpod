import { prisma } from "../src/lib/prisma";

async function main() {
    const result = await prisma.syncRun.updateMany({
        where: { status: "running" },
        data: { status: "error", message: "manual sweep", finishedAt: new Date() }
    });
    console.log(`Swept ${result.count} running SyncRun rows.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
