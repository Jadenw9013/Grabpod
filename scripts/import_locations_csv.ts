/**
 * scripts/import_locations_csv.ts
 *
 * Import machines + locations from a CSV file into the DB.
 * Idempotent: uses upserts so running twice is safe.
 *
 * Usage:
 *   npx tsx scripts/import_locations_csv.ts locations.csv
 *   npx tsx scripts/import_locations_csv.ts locations.csv --tenant=my-tenant-id
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────────────

function loadEnvFile(filePath: string): void {
    try {
        const envFile = readFileSync(filePath, "utf-8");
        for (const line of envFile.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
            ) {
                val = val.slice(1, -1);
            }
            if (!process.env[key]) process.env[key] = val;
        }
    } catch {
        // file missing is fine
    }
}

const root = resolve(__dirname, "..");
loadEnvFile(resolve(root, ".env.local"));
loadEnvFile(resolve(root, ".env"));

// ── Prisma client (standalone — can't use @/lib/prisma path aliases) ─────

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrisma(): PrismaClient {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is missing in .env.local");
    }
    return new PrismaClient({
        adapter: new PrismaPg({ connectionString }),
    });
}

// ── CSV parser (handles quoted fields with commas) ───────────────────────

function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // skip escaped quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            fields.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    fields.push(current.trim());
    return fields;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
    // Parse args
    const args = process.argv.slice(2);
    const csvArg = args.find((a) => !a.startsWith("--")) ?? "locations.csv";
    const tenantArg = args.find((a) => a.startsWith("--tenant="));
    const tenantId = tenantArg?.split("=")[1] ?? "dev-tenant";

    const csvPath = resolve(process.cwd(), csvArg);
    console.log(`\nImporting: ${csvPath}`);
    console.log(`Tenant:    ${tenantId}\n`);

    const raw = readFileSync(csvPath, "utf-8");
    const lines = raw.split("\n").map((l) => l.replace(/\r$/, ""));

    // Parse header
    const header = parseCSVLine(lines[0]);
    const stickerIdx = header.indexOf("stickerNum");
    const nameIdx = header.indexOf("name");
    const addressIdx = header.indexOf("address");

    if (stickerIdx === -1 || nameIdx === -1 || addressIdx === -1) {
        throw new Error(
            `CSV must have columns: stickerNum, name, address. Found: ${header.join(", ")}`,
        );
    }

    // Parse rows
    interface Row {
        stickerNum: string;
        name: string;
        address: string;
    }
    const rows: Row[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = parseCSVLine(line);
        const stickerNum = fields[stickerIdx];
        const name = fields[nameIdx];
        const address = fields[addressIdx];

        if (!stickerNum || !name || !address) {
            console.warn(`  ⚠ Skipping row ${i + 1}: missing stickerNum/name/address`);
            continue;
        }
        rows.push({ stickerNum, name, address });
    }

    console.log(`Parsed ${rows.length} valid rows.\n`);

    // Connect to DB
    const prisma = createPrisma();

    // Ensure tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
        throw new Error(`Tenant "${tenantId}" not found in DB. Create it first.`);
    }

    let createdLocations = 0;
    let updatedLocations = 0;
    let createdMachines = 0;
    let updatedMachines = 0;

    // Dedupe locations by name (multiple machines can share a location)
    const locationByName = new Map<string, string>(); // name -> locationId

    for (const row of rows) {
        // ── Upsert Location ──
        let locationId = locationByName.get(row.name);

        if (!locationId) {
            // Check if location already exists in DB by name + tenant
            const existing = await prisma.location.findFirst({
                where: { tenantId, name: row.name },
                select: { id: true, address: true },
            });

            if (existing) {
                // Update address if changed
                if (existing.address !== row.address) {
                    await prisma.location.update({
                        where: { id: existing.id },
                        data: { address: row.address },
                    });
                    updatedLocations++;
                    console.log(`  ↻ Updated location: ${row.name}`);
                }
                locationId = existing.id;
            } else {
                const loc = await prisma.location.create({
                    data: { tenantId, name: row.name, address: row.address },
                });
                locationId = loc.id;
                createdLocations++;
                console.log(`  ✚ Created location: ${row.name}`);
            }

            locationByName.set(row.name, locationId);
        }

        // ── Upsert Machine ──
        // Machine.stickerNum is @unique, so we can use findUnique
        const existingMachine = await prisma.machine.findUnique({
            where: { stickerNum: row.stickerNum },
            select: { id: true, locationId: true },
        });

        if (existingMachine) {
            if (existingMachine.locationId !== locationId) {
                await prisma.machine.update({
                    where: { stickerNum: row.stickerNum },
                    data: { locationId },
                });
                updatedMachines++;
                console.log(`  ↻ Updated machine: ${row.stickerNum} → ${row.name}`);
            }
        } else {
            await prisma.machine.create({
                data: {
                    tenantId,
                    stickerNum: row.stickerNum,
                    locationId,
                },
            });
            createdMachines++;
            console.log(`  ✚ Created machine: ${row.stickerNum} → ${row.name}`);
        }
    }

    console.log(`\n── Import Summary ──`);
    console.log(`  Locations: ${createdLocations} created, ${updatedLocations} updated`);
    console.log(`  Machines:  ${createdMachines} created, ${updatedMachines} updated`);

    // Verify
    const locCount = await prisma.location.count({ where: { tenantId } });
    const machCount = await prisma.machine.count({ where: { tenantId } });
    const assignedCount = await prisma.machine.count({
        where: { tenantId, locationId: { not: null } },
    });
    console.log(`\n── DB Totals ──`);
    console.log(`  Locations: ${locCount}`);
    console.log(`  Machines:  ${machCount} (${assignedCount} with locations)\n`);

    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
