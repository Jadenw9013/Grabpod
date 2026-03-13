import { prisma } from '../src/lib/prisma'
import fs from 'fs'

async function main() {
    try {
        const count = await prisma.syncRun.count()
        console.log("Connected successfully! SyncRun count:", count)
    } catch (e: unknown) {
        fs.writeFileSync('error.json', JSON.stringify(e, null, 2))
        console.error("Wrote exact Prisma error to error.json")
        process.exit(1)
    }
}

main().finally(() => prisma.$disconnect())
