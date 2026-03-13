import { prisma } from '../src/lib/prisma'

async function main() {
    const tenantId = 'dev-tenant'
    await prisma.tenant.upsert({
        where: { id: tenantId },
        update: {},
        create: { id: tenantId, name: 'Grabpod Dev Tenant' }
    })
    console.log("Seeded tenant:", tenantId)
}

main().finally(() => prisma.$disconnect())
