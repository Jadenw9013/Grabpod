import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/dev/seed-beta
 *
 * Dev-only endpoint to populate InventorySnapshot, WarehouseStock,
 * and a sample Contract+Location for beta testing.
 *
 * Idempotent: uses upsert / skipDuplicates. Safe to call multiple times.
 * Returns 404 in production.
 */
export async function POST() {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let tenantId: string;
    try {
        tenantId = getTenantId();
    } catch (err) {
        return NextResponse.json(
            { error: `getTenantId() failed: ${err instanceof Error ? err.message : String(err)}` },
            { status: 500 },
        );
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
        return NextResponse.json(
            { error: `Tenant "${tenantId}" does not exist in DB` },
            { status: 400 },
        );
    }

    const stats = {
        created: { inventorySnapshots: 0, warehouseStocks: 0, locations: 0, contracts: 0 },
        skipped: { inventorySnapshots: 0, warehouseStocks: 0, locations: 0, contracts: 0 },
    };

    // ── Load machines and products for this tenant ──
    const machines = await prisma.machine.findMany({
        where: { tenantId },
        select: { id: true, stickerNum: true },
    });

    const products = await prisma.product.findMany({
        where: { tenantId },
        select: { id: true, name: true },
    });

    if (machines.length === 0 || products.length === 0) {
        return NextResponse.json({
            tenantId,
            error: "No machines or products found. Run a sync first.",
            machineCount: machines.length,
            productCount: products.length,
            ...stats,
        });
    }

    // ── Find top products by sales volume (for realistic assignment) ──
    const topProductRows = await prisma.$queryRawUnsafe<{ productId: string; totalQty: number }[]>(
        `SELECT ol."productId", COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     WHERE oh."tenantId" = $1
     GROUP BY ol."productId"
     ORDER BY "totalQty" DESC
     LIMIT 25`,
        tenantId,
    );

    // Use top-selling products, fallback to first 20 products
    const productIds =
        topProductRows.length > 0
            ? topProductRows.map((r) => r.productId)
            : products.slice(0, 20).map((p) => p.id);

    // ── Seeded random helper (deterministic per machine+product for idempotency) ──
    function seededRandom(machineIdx: number, productIdx: number): number {
        // Simple hash for deterministic "randomness"
        const hash = ((machineIdx * 31 + productIdx * 17 + 7) % 100) / 100;
        return hash;
    }

    // ── A) InventorySnapshot ──
    // Load existing to skip
    const existingSnaps = await prisma.inventorySnapshot.findMany({
        where: { tenantId },
        select: { machineId: true, productId: true },
    });
    const existingSnapKeys = new Set(existingSnaps.map((s) => `${s.machineId}:${s.productId}`));

    const snapsToCreate: {
        tenantId: string;
        machineId: string;
        productId: string;
        capacity: number;
        onHand: number;
        isLow: boolean;
        daysOfCover: number | null;
        avgDailySales: number | null;
    }[] = [];

    for (let mi = 0; mi < machines.length; mi++) {
        const machine = machines[mi];
        // Each machine gets a subset of products (8-15 products)
        const productsPerMachine = 8 + (mi % 8);
        const assignedProducts = productIds.slice(0, productsPerMachine);

        for (let pi = 0; pi < assignedProducts.length; pi++) {
            const productId = assignedProducts[pi];
            const key = `${machine.id}:${productId}`;

            if (existingSnapKeys.has(key)) {
                stats.skipped.inventorySnapshots++;
                continue;
            }

            const r = seededRandom(mi, pi);
            const capacity = 10 + Math.floor(r * 15); // 10-24
            const onHand = Math.floor(r * capacity * 1.2); // 0 to slightly above capacity (capped below)
            const cappedOnHand = Math.min(onHand, capacity);
            const pctRemaining = capacity > 0 ? cappedOnHand / capacity : 0;
            const isLow = pctRemaining < 0.25;
            const avgDaily = 0.5 + r * 3; // 0.5-3.5 units/day
            const daysOfCover = avgDaily > 0 ? cappedOnHand / avgDaily : null;

            snapsToCreate.push({
                tenantId,
                machineId: machine.id,
                productId,
                capacity,
                onHand: cappedOnHand,
                isLow,
                daysOfCover: daysOfCover ? Math.round(daysOfCover * 10) / 10 : null,
                avgDailySales: Math.round(avgDaily * 100) / 100,
            });
        }
    }

    if (snapsToCreate.length > 0) {
        const result = await prisma.inventorySnapshot.createMany({
            data: snapsToCreate,
            skipDuplicates: true,
        });
        stats.created.inventorySnapshots = result.count;
    }

    // ── B) WarehouseStock ──
    const existingWarehouse = await prisma.warehouseStock.findMany({
        where: { tenantId },
        select: { productId: true },
    });
    const existingWarehouseIds = new Set(existingWarehouse.map((w) => w.productId));

    const warehouseToCreate: { tenantId: string; productId: string; onHand: number }[] = [];

    for (const productId of productIds) {
        if (existingWarehouseIds.has(productId)) {
            stats.skipped.warehouseStocks++;
            continue;
        }
        // Default warehouse stock: 50-150 units
        const hash = (productId.charCodeAt(0) * 31 + productId.charCodeAt(1) * 17) % 100;
        const onHand = 50 + hash;
        warehouseToCreate.push({ tenantId, productId, onHand });
    }

    if (warehouseToCreate.length > 0) {
        const result = await prisma.warehouseStock.createMany({
            data: warehouseToCreate,
            skipDuplicates: true,
        });
        stats.created.warehouseStocks = result.count;
    }

    // ── C) Sample Location + Contract ──
    const existingLocations = await prisma.location.count({ where: { tenantId } });

    if (existingLocations === 0) {
        const location = await prisma.location.create({
            data: {
                tenantId,
                name: "Main Office Building",
                address: "123 Beta Test Lane",
                cluster: "Downtown",
            },
        });
        stats.created.locations = 1;

        // Create a sample contract for this location
        await prisma.contract.create({
            data: {
                tenantId,
                locationId: location.id,
                inceptionDate: new Date("2025-01-01"),
                taxRate: 0.08,
                creditCardFeeRate: 0.03,
                profitShareUnder1000: 0.15,
                profitShareOver1000: 0.20,
            },
        });
        stats.created.contracts = 1;

        // Assign some machines to this location (first 3)
        const unassigned = await prisma.machine.findMany({
            where: { tenantId, locationId: null },
            take: 3,
            select: { id: true },
        });
        if (unassigned.length > 0) {
            await prisma.machine.updateMany({
                where: { id: { in: unassigned.map((m) => m.id) } },
                data: { locationId: location.id },
            });
        }
    } else {
        stats.skipped.locations = existingLocations;

        // Check if contract exists
        const existingContracts = await prisma.contract.count({ where: { tenantId } });
        if (existingContracts === 0) {
            // Create contract for the first location
            const firstLocation = await prisma.location.findFirst({
                where: { tenantId },
                select: { id: true },
            });
            if (firstLocation) {
                await prisma.contract.create({
                    data: {
                        tenantId,
                        locationId: firstLocation.id,
                        inceptionDate: new Date("2025-01-01"),
                        taxRate: 0.08,
                        creditCardFeeRate: 0.03,
                        profitShareUnder1000: 0.15,
                        profitShareOver1000: 0.20,
                    },
                });
                stats.created.contracts = 1;
            }
        } else {
            stats.skipped.contracts = existingContracts;
        }
    }

    // ── Final counts ──
    const [snapCount, warehouseCount, locationCount, contractCount] = await Promise.all([
        prisma.inventorySnapshot.count({ where: { tenantId } }),
        prisma.warehouseStock.count({ where: { tenantId } }),
        prisma.location.count({ where: { tenantId } }),
        prisma.contract.count({ where: { tenantId } }),
    ]);

    return NextResponse.json({
        tenantId,
        ...stats,
        totals: {
            inventorySnapshots: snapCount,
            warehouseStocks: warehouseCount,
            locations: locationCount,
            contracts: contractCount,
        },
    });
}
