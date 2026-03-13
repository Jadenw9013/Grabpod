import { prisma } from '../src/lib/prisma'

async function main() {
    const runs = await prisma.syncRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 3
    })
    console.log(JSON.stringify(runs, null, 2))
}

main().finally(() => prisma.$disconnect())
