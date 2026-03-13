/**
 * Verify latest paid order
 */
import { readFileSync } from "fs";
import { resolve } from "path";

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

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is missing in .env.local");
    }
    const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString }),
    });

    const latest = await prisma.orderHeader.findFirst({
        where: { status: 101 },
        orderBy: { payTime: "desc" },
        select: { orderNo: true, payTime: true, actualPaymentAmount: true },
    });
    console.log("Latest paid order:");
    console.dir(latest, { depth: null });
    await prisma.$disconnect();
}

main().catch(console.error);
