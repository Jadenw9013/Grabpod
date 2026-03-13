import { getToken, listOrders, getOrderDetail } from "../src/lib/vendors/haha/client";
import { normalizeHahaOrder } from "../src/lib/vendors/haha/normalize";
import { upsertOrders } from "../src/lib/ingest/upsert-orders";
import { prisma } from "../src/lib/prisma";

async function main() {
    const tenantId = process.env.DEV_TENANT_ID;
    if (!tenantId) throw new Error("Missing DEV_TENANT_ID");

    const token = await getToken();
    console.log("Fetching orders from 2026-03-06...");
    const orders = await listOrders(token, {
        pay_start_time: "2026-03-06",
        pay_end_time: "2026-03-07",
    });

    console.log(`Found ${orders.length} orders for 2026-03-06`);
    if (orders.length === 0) return;

    const sampleOrder = orders[0];
    console.log("Sample List Order:", JSON.stringify(sampleOrder, null, 2));

    const detail = await getOrderDetail(token, sampleOrder.order_no);
    // Merge status
    if (sampleOrder.status !== undefined && detail.status === undefined) {
        detail.status = sampleOrder.status;
    }
    console.log("Sample Detail:", JSON.stringify(detail, null, 2));

    const normalized = normalizeHahaOrder(detail);
    console.log("Normalized:", JSON.stringify(normalized, null, 2));

    console.log("Upserting...");
    const result = await upsertOrders(tenantId, [normalized]);
    console.log("Upsert Result:", JSON.stringify(result, null, 2));

    // Check DB manually directly after
    const after = await prisma.orderHeader.findUnique({ where: { orderNo: sampleOrder.order_no } });
    console.log("DB OrderHeader after:", JSON.stringify(after, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
