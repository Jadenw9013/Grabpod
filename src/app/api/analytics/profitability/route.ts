import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/profitability?month=this|previous
 *
 * Returns Top 20 products by revenue for the selected calendar month.
 * Joins OrderLine -> Product to get cost; margin = revenue - cost.
 * Products without cost are included but flagged with hasCost: false.
 */
export async function GET(request: NextRequest) {
  try {
  const tenantId = getTenantId();

  const monthParam = request.nextUrl.searchParams.get("month") ?? "this";

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let start: Date;
  let end: Date;

  if (monthParam === "previous") {
    start = new Date(Date.UTC(y, m - 1, 1));
    end = new Date(Date.UTC(y, m, 1));
  } else {
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 1));
  }

  // Raw SQL: group by productId, sum qty and revenue, join product for cost
  const rows = await prisma.$queryRawUnsafe<
    {
      productId: string;
      apexSku: string | null;
      name: string;
      category: string | null;
      cost: number | null;
      totalQty: number;
      revenue: number;
    }[]
  >(
    `SELECT
       ol."productId",
       p."apexSku",
       p."name",
       p."category",
       p."cost",
       COALESCE(SUM(ol."quantity"), 0)::float AS "totalQty",
       COALESCE(SUM(ol."quantity" * ol."unitPrice"), 0)::float AS "revenue"
     FROM "OrderLine" ol
     JOIN "OrderHeader" oh ON ol."orderNo" = oh."orderNo"
     JOIN "Product" p ON ol."productId" = p."id"
     WHERE oh."tenantId" = $1
       AND oh."createdAt" >= $2
       AND oh."createdAt" < $3
     GROUP BY ol."productId", p."apexSku", p."name", p."category", p."cost"
     ORDER BY "revenue" DESC
     LIMIT 20`,
    tenantId,
    start,
    end,
  );

  const topProducts = rows.map((r) => {
    const hasCost = r.cost !== null && r.cost !== undefined;
    const totalCost = hasCost ? r.totalQty * r.cost! : null;
    const margin = totalCost !== null ? r.revenue - totalCost : null;

    return {
      productId: r.productId,
      apexSku: r.apexSku,
      name: r.name,
      category: r.category,
      totalQty: r.totalQty,
      revenue: Math.round(r.revenue * 100) / 100,
      cost: totalCost !== null ? Math.round(totalCost * 100) / 100 : null,
      margin: margin !== null ? Math.round(margin * 100) / 100 : null,
      hasCost,
    };
  });

  return NextResponse.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    topProducts,
  });
  } catch (err) {
    return handleApiError(err);
  }
}
