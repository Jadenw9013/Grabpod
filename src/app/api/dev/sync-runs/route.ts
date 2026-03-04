import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/dev/sync-runs
 * Dev-only: list recent SyncRun rows to check for errors.
 */
export async function GET() {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const tenantId = getTenantId();
    const runs = await prisma.syncRun.findMany({
        where: { tenantId },
        orderBy: { startedAt: "desc" },
        take: 10,
    });

    return NextResponse.json({ tenantId, runs });
}
