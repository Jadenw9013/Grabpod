import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/dev/seed-beta
 *
 * Dev-only diagnostic endpoint. Reports current data counts.
 * Does NOT seed any business data — all business entities must come
 * from the Haha API via /api/sync/haha.
 *
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

    // Report-only: no seeding. All business data comes from Haha API.
    const [
        machineCount,
        productCount,
        orderCount,
        orderLineCount,
        snapCount,
        warehouseCount,
        locationCount,
        contractCount,
        syncRunCount,
    ] = await Promise.all([
        prisma.machine.count({ where: { tenantId } }),
        prisma.product.count({ where: { tenantId } }),
        prisma.orderHeader.count({ where: { tenantId } }),
        prisma.orderLine.count(),
        prisma.inventorySnapshot.count({ where: { tenantId } }),
        prisma.warehouseStock.count({ where: { tenantId } }),
        prisma.location.count({ where: { tenantId } }),
        prisma.contract.count({ where: { tenantId } }),
        prisma.syncRun.count({ where: { tenantId } }),
    ]);

    return NextResponse.json({
        tenantId,
        message: "Report only. All business data must come from Haha API sync.",
        counts: {
            machines: machineCount,
            products: productCount,
            orders: orderCount,
            orderLines: orderLineCount,
            inventorySnapshots: snapCount,
            warehouseStocks: warehouseCount,
            locations: locationCount,
            contracts: contractCount,
            syncRuns: syncRunCount,
        },
    });
}
