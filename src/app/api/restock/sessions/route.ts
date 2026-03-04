import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
  const tenantId = getTenantId();

  const sessions = await prisma.restockSession.findMany({
    where: { tenantId },
    include: {
      lines: {
        include: {
          session: false,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const result = sessions.map((s) => ({
    id: s.id,
    assignedDate: s.assignedDate?.toISOString() ?? null,
    startedAt: s.startedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    lineCount: s.lines.length,
    totalNeeded: s.lines.reduce((sum, l) => sum + l.neededUnits, 0),
    durationMinutes:
      s.startedAt && s.completedAt
        ? Math.round(
            (s.completedAt.getTime() - s.startedAt.getTime()) / 60000,
          )
        : null,
  }));

  return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
