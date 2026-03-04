import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SetStockSchema = z.object({
  productId: z.string().uuid(),
  onHand: z.number().int().min(0),
});

export async function POST(request: NextRequest) {
  try {
  const tenantId = getTenantId();

  const body = await request.json().catch(() => null);
  const parsed = SetStockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { productId, onHand } = parsed.data;

  // Verify product belongs to this tenant
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json(
      { error: "Product not found for this tenant" },
      { status: 404 },
    );
  }

  // Upsert by (tenantId, productId)
  const stock = await prisma.warehouseStock.upsert({
    where: { tenantId_productId: { tenantId, productId } },
    update: { onHand },
    create: { tenantId, productId, onHand },
  });

  return NextResponse.json(stock);
  } catch (err) {
    return handleApiError(err);
  }
}
