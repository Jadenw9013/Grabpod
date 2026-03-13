/**
 * One-shot script to delete seeded "Main Office Building" contract/location.
 * Run via: npx tsx scripts/cleanup-seed-contracts.ts
 *
 * Uses dotenv to load .env.local directly.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error("DATABASE_URL not found");
    process.exit(1);
}

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
});

async function main() {
    const tenantId = process.env.DEV_TENANT_ID || "dev-tenant";

    // Find the seeded location
    const loc = await prisma.location.findFirst({
        where: { tenantId, name: "Main Office Building" },
    });

    if (!loc) {
        console.log("No seeded 'Main Office Building' location found — nothing to delete.");
        return;
    }

    console.log(`Found seeded location: ${loc.id} (${loc.name})`);

    // Delete contracts attached to this location
    const delContracts = await prisma.contract.deleteMany({
        where: { locationId: loc.id },
    });
    console.log(`Deleted ${delContracts.count} seeded contract(s)`);

    // Unbind machines from this location
    const unbind = await prisma.machine.updateMany({
        where: { locationId: loc.id },
        data: { locationId: null },
    });
    console.log(`Unbound ${unbind.count} machine(s) from seeded location`);

    // Delete the location
    await prisma.location.delete({ where: { id: loc.id } });
    console.log("Deleted seeded location");

    console.log("✅ Seeded contract data removed.");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("Error:", e);
        process.exit(1);
    });
