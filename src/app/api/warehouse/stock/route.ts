import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
  const tenantId = getTenantId();

  const rows = await prisma.warehouseStock.findMany({
    where: { tenantId },
    include: {
      product: {
        select: { id: true, apexSku: true, name: true, category: true },
      },
    },
    orderBy: { product: { name: "asc" } },
  });

  const data = rows.map((r) => ({
    productId: r.productId,
    apexSku: r.product.apexSku,
    name: r.product.name,
    category: r.product.category,
    onHand: r.onHand,
    updatedAt: r.updatedAt,
  }));

  return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
