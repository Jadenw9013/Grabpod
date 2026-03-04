import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateItem = z.object({
  machineId: z.string().uuid(),
  productId: z.string().uuid(),
  newStockRemain: z.number().int().min(0),
});

const CompleteSchema = z.object({
  sessionId: z.string().uuid(),
  updates: z.array(UpdateItem).min(1).max(500),
});

interface UpdateResult {
  machineId: string;
  productId: string;
  previousOnHand: number;
  newOnHand: number;
  delta: number;
  warehouseDeducted: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
  const tenantId = getTenantId();

  const body = await request.json().catch(() => null);
  const parsed = CompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { sessionId, updates } = parsed.data;

  // --- Load session and verify tenant ownership (outside transaction for early exit) ---
  const session = await prisma.restockSession.findFirst({
    where: { id: sessionId, tenantId },
    include: { lines: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.completedAt) {
    return NextResponse.json({ error: "Session already completed" }, { status: 409 });
  }

  // --- Process all updates in a single transaction ---
  const now = new Date();

  const results = await prisma.$transaction(async (tx) => {
    const txResults: UpdateResult[] = [];

    // Re-check completedAt inside transaction to prevent TOCTOU race
    const sessionCheck = await tx.restockSession.findUnique({
      where: { id: sessionId },
      select: { completedAt: true },
    });
    if (sessionCheck?.completedAt) {
      throw new Error("ALREADY_COMPLETED");
    }

    for (const update of updates) {
      const { machineId, productId, newStockRemain } = update;

      // Load current machine inventory
      const snapshot = await tx.inventorySnapshot.findUnique({
        where: { machineId_productId: { machineId, productId } },
      });

      if (!snapshot || snapshot.tenantId !== tenantId) {
        txResults.push({
          machineId, productId,
          previousOnHand: 0, newOnHand: 0, delta: 0, warehouseDeducted: 0,
          error: "Inventory snapshot not found for this tenant",
        });
        continue;
      }

      // Validate against capacity
      if (snapshot.capacity > 0 && newStockRemain > snapshot.capacity) {
        txResults.push({
          machineId, productId,
          previousOnHand: snapshot.onHand, newOnHand: snapshot.onHand, delta: 0, warehouseDeducted: 0,
          error: `newStockRemain (${newStockRemain}) exceeds capacity (${snapshot.capacity})`,
        });
        continue;
      }

      const previousOnHand = snapshot.onHand;
      const delta = newStockRemain - previousOnHand;

      // If delta > 0, we're adding stock to machine -> deduct from warehouse
      let warehouseDeducted = 0;
      if (delta > 0) {
        const warehouse = await tx.warehouseStock.findUnique({
          where: { tenantId_productId: { tenantId, productId } },
        });

        const warehouseOnHand = warehouse?.onHand ?? 0;
        if (warehouseOnHand < delta) {
          txResults.push({
            machineId, productId,
            previousOnHand, newOnHand: previousOnHand, delta: 0, warehouseDeducted: 0,
            error: `Insufficient warehouse stock: need ${delta}, have ${warehouseOnHand}`,
          });
          continue;
        }

        // Deduct warehouse atomically with check
        await tx.warehouseStock.update({
          where: { tenantId_productId: { tenantId, productId } },
          data: { onHand: { decrement: delta } },
        });
        warehouseDeducted = delta;
      }

      // Update machine inventory
      await tx.inventorySnapshot.update({
        where: { machineId_productId: { machineId, productId } },
        data: { onHand: newStockRemain, updatedAt: now },
      });

      // Write InventoryEvent
      await tx.inventoryEvent.create({
        data: {
          tenantId,
          machineId,
          productId,
          change: delta,
          reason: "restock",
          sessionId,
        },
      });

      // Update session line item with afterStockRemain
      await tx.restockSessionLine.updateMany({
        where: { sessionId, machineId, productId },
        data: { afterStockRemain: newStockRemain },
      });

      txResults.push({
        machineId, productId,
        previousOnHand, newOnHand: newStockRemain,
        delta, warehouseDeducted,
      });
    }

    // Mark session complete inside transaction
    await tx.restockSession.update({
      where: { id: sessionId },
      data: {
        startedAt: session.startedAt ?? now,
        completedAt: now,
      },
    });

    return txResults;
  });

  return NextResponse.json({
    sessionId,
    completedAt: now.toISOString(),
    results,
  });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_COMPLETED") {
      return NextResponse.json({ error: "Session already completed" }, { status: 409 });
    }
    return handleApiError(err);
  }
}
