import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/dev/debug
 *
 * Dev-only diagnostic endpoint. Returns tenant validity and row counts.
 * Never exposes secrets. 404 in production.
 */
export async function GET() {
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

    // Check if tenant exists
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, createdAt: true },
    });

    // Get DB fingerprint (no password)
    const dbUrl = process.env.DATABASE_URL ?? "not set";
    let dbFingerprint = "unknown";
    try {
        const url = new URL(dbUrl);
        dbFingerprint = `${url.hostname}:${url.port}${url.pathname}`;
    } catch {
        dbFingerprint = dbUrl.includes("@")
            ? dbUrl.split("@").pop() ?? "parse-error"
            : "parse-error";
    }

    // Counts for this tenant
    const [machines, products, warehouseStock, orderHeaders, orderLines, syncRuns] =
        await Promise.all([
            prisma.machine.count({ where: { tenantId } }),
            prisma.product.count({ where: { tenantId } }),
            prisma.warehouseStock.count({ where: { tenantId } }),
            prisma.orderHeader.count({ where: { tenantId } }),
            prisma.orderLine.count({
                where: { order: { tenantId } },
            }),
            prisma.syncRun.count({ where: { tenantId } }),
        ]);

    // Also get total counts (all tenants) to detect tenant mismatch
    const [totalMachines, totalProducts, totalOrders] = await Promise.all([
        prisma.machine.count(),
        prisma.product.count(),
        prisma.orderHeader.count(),
    ]);

    // List all tenant IDs in DB
    const allTenants = await prisma.tenant.findMany({
        select: { id: true, name: true },
    });

    // Relationship validation
    const [machinesWithLocation, inventorySnapshots, contracts, locations] =
        await Promise.all([
            prisma.machine.count({ where: { tenantId, locationId: { not: null } } }),
            prisma.inventorySnapshot.count({ where: { tenantId } }),
            prisma.contract.count({ where: { tenantId } }),
            prisma.location.count({ where: { tenantId } }),
        ]);

    return NextResponse.json({
        tenantId,
        tenantExists: !!tenant,
        tenant,
        dbFingerprint,
        counts: {
            machines,
            products,
            warehouseStock,
            orderHeaders,
            orderLines,
            syncRuns,
            inventorySnapshots,
            locations,
            contracts,
        },
        relationships: {
            machinesWithLocation,
            machinesWithoutLocation: machines - machinesWithLocation,
            // OrderHeader.machineId is required (non-nullable FK) so all orders have machines
            ordersWithMachine: orderHeaders,
        },
        totalCounts: {
            machines: totalMachines,
            products: totalProducts,
            orderHeaders: totalOrders,
        },
        allTenantsInDb: allTenants,
        diagnosis:
            !tenant
                ? `⚠ Tenant "${tenantId}" does NOT exist in DB. Data may exist under a different tenant ID.`
                : machines === 0 && totalMachines > 0
                    ? `⚠ Tenant "${tenantId}" exists but has 0 machines. ${totalMachines} machines exist under other tenants.`
                    : machines === 0
                        ? `⚠ No data at all. Run an import or sync first.`
                        : `✅ Tenant has data: ${machines} machines, ${orderHeaders} orders.`,
    });
}
