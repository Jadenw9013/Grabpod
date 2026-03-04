import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  productId: z.string().uuid(),
  onHand: z.number().int().min(0),
  capacity: z.number().int().min(0),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> },
) {
  try {
  const { machineId } = await params;
  const tenantId = getTenantId();

  // Validate body
  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { productId, onHand, capacity } = parsed.data;

  // Verify machine belongs to tenant
  const machine = await prisma.machine.findFirst({
    where: { id: machineId, tenantId },
  });
  if (!machine) {
    return NextResponse.json({ error: "Machine not found" }, { status: 404 });
  }

  // Get current snapshot for delta calculation
  const existing = await prisma.inventorySnapshot.findUnique({
    where: { machineId_productId: { machineId, productId } },
  });

  const previousOnHand = existing?.onHand ?? 0;
  const delta = onHand - previousOnHand;

  // Upsert snapshot
  const snapshot = await prisma.inventorySnapshot.upsert({
    where: { machineId_productId: { machineId, productId } },
    update: { onHand, capacity, updatedAt: new Date() },
    create: { tenantId, machineId, productId, onHand, capacity },
  });

  // Write audit event if onHand changed
  if (delta !== 0) {
    await prisma.inventoryEvent.create({
      data: {
        tenantId,
        machineId,
        productId,
        change: delta,
        reason: "manual_adjust",
      },
    });
  }

  return NextResponse.json(snapshot);
  } catch (err) {
    return handleApiError(err);
  }
}
