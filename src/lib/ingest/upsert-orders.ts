import { prisma } from "@/lib/prisma";

/**
 * A single normalized order to ingest.
 */
export interface NormalizedOrder {
  orderNo: string;
  createdAt: Date;
  /** Sticker number or vendor machine ID — used to resolve/create Machine */
  machineIdentifier: string;
  grossAmount?: number;
  actualPaymentAmount?: number;
  /** Vendor order status: 101=paid, 200=pending, 0=unknown */
  status?: number;
  /** Payment timestamp (null if not yet paid) */
  payTime?: Date | null;
  lineItems: {
    sku?: string;
    name: string;
    quantity: number;
    unitPrice: number;
    category?: string;
  }[];
}

export interface UpsertStats {
  importedOrders: number;
  importedLines: number;
  createdProducts: number;
  createdMachines: number;
  skippedRows: { index: number; reason: string }[];
}

/**
 * Idempotent order ingestion. Upserts OrderHeader by orderNo, upserts OrderLine
 * by (orderNo, productId). Resolves or creates Machine and Product records.
 *
 * Shared by XLSX import and Haha API sync.
 */
export async function upsertOrders(
  tenantId: string,
  orders: NormalizedOrder[],
): Promise<UpsertStats> {
  const stats: UpsertStats = {
    importedOrders: 0,
    importedLines: 0,
    createdProducts: 0,
    createdMachines: 0,
    skippedRows: [],
  };

  // --- Pre-load caches for tenant ---
  const existingMachines = await prisma.machine.findMany({
    where: { tenantId },
    select: { id: true, stickerNum: true, vendorMachineId: true },
  });
  const machineBySticker = new Map(
    existingMachines.filter((m) => m.stickerNum).map((m) => [m.stickerNum!, m.id]),
  );
  const machineByVendorId = new Map(
    existingMachines.filter((m) => m.vendorMachineId).map((m) => [m.vendorMachineId!, m.id]),
  );

  const existingProducts = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, vendorProductNo: true, name: true },
  });
  const productBySku = new Map(
    existingProducts.filter((p) => p.vendorProductNo).map((p) => [p.vendorProductNo!, p.id]),
  );
  const productByName = new Map(
    existingProducts.map((p) => [p.name.toLowerCase(), p.id]),
  );

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];

    try {
      // --- Validate order ---
      if (!order.orderNo) {
        stats.skippedRows.push({ index: i, reason: "Missing order number" });
        continue;
      }
      if (!order.machineIdentifier) {
        stats.skippedRows.push({ index: i, reason: "No machine identifier" });
        continue;
      }
      if (!order.lineItems.length) {
        stats.skippedRows.push({ index: i, reason: "No line items" });
        continue;
      }

      // --- Resolve Machine ---
      const mid = order.machineIdentifier;
      let machineId =
        machineBySticker.get(mid) ??
        machineByVendorId.get(mid) ??
        null;

      if (!machineId) {
        // Try findFirst as a safety net (handles concurrent imports / cache misses)
        const existing = await prisma.machine.findFirst({
          where: {
            tenantId,
            OR: [
              { stickerNum: mid },
              { vendorMachineId: mid },
            ],
          },
          select: { id: true },
        });

        if (existing) {
          machineId = existing.id;
        } else {
          // Create stub machine — always set stickerNum + vendorMachineId
          // Haha sticker_nums start with "B" (e.g., B133674), not "GP-"
          const newMachine = await prisma.machine.create({
            data: {
              tenantId,
              stickerNum: mid,
              vendorMachineId: mid,
              status: "active",
            },
          });
          machineId = newMachine.id;
          stats.createdMachines++;
        }

        // Update caches
        machineBySticker.set(mid, machineId);
        machineByVendorId.set(mid, machineId);
      }

      // --- Upsert OrderHeader ---
      await prisma.orderHeader.upsert({
        where: { orderNo: order.orderNo },
        update: {
          grossAmount: order.grossAmount ?? undefined,
          actualPaymentAmount: order.actualPaymentAmount ?? undefined,
          // Only update status/payTime with non-degrading values:
          // status=0 (unknown) must not overwrite a stored 101; null must not clear a valid payTime.
          ...(order.status ? { status: order.status } : {}),
          ...(order.payTime ? { payTime: order.payTime } : {}),
        },
        create: {
          orderNo: order.orderNo,
          tenantId,
          machineId,
          grossAmount: order.grossAmount ?? 0,
          actualPaymentAmount: order.actualPaymentAmount ?? 0,
          status: order.status ?? 0,
          payTime: order.payTime ?? null,
          createdAt: order.createdAt,
        },
      });
      stats.importedOrders++;

      // --- Upsert OrderLines ---
      for (const item of order.lineItems) {
        let productId: string | null = null;

        // Try SKU first
        if (item.sku) {
          productId = productBySku.get(item.sku) ?? null;
        }
        // Fallback to name (case-insensitive)
        if (!productId && item.name) {
          productId = productByName.get(item.name.toLowerCase()) ?? null;
        }
        // Create placeholder if still missing
        if (!productId) {
          const name = item.name || `Unknown Product (${item.sku || order.orderNo})`;
          const newProduct = await prisma.product.create({
            data: {
              tenantId,
              vendorProductNo: item.sku || null,
              name,
              category: item.category || null,
            },
          });
          productId = newProduct.id;
          if (item.sku) productBySku.set(item.sku, productId);
          productByName.set(name.toLowerCase(), productId);
          stats.createdProducts++;
        }

        await prisma.orderLine.upsert({
          where: { orderNo_productId: { orderNo: order.orderNo, productId } },
          update: { quantity: item.quantity, unitPrice: item.unitPrice },
          create: {
            orderNo: order.orderNo,
            productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          },
        });
        stats.importedLines++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      stats.skippedRows.push({ index: i, reason: message });
    }
  }

  return stats;
}
