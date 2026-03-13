import { prisma } from '../src/lib/prisma'
import fs from 'fs'

async function main() {
    try {
        const syncRun = await prisma.syncRun.create({
            data: { tenantId: 'dev-tenant', vendor: 'haha', status: 'running' }
        })
        console.log("Created successfully!", syncRun)
    } catch (e: unknown) {
        fs.writeFileSync('error_create.json', JSON.stringify(e, null, 2))
        console.error("Wrote exact Prisma error to error_create.json")
        process.exit(1)
    }
}

main().finally(() => prisma.$disconnect())
