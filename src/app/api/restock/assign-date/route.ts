import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AssignDateSchema = z.object({
  sessionId: z.string().uuid(),
  assignedDate: z.string(),
});

export async function POST(request: NextRequest) {
  try {
  const tenantId = getTenantId();

  const body = await request.json().catch(() => null);
  const parsed = AssignDateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { sessionId, assignedDate: dateStr } = parsed.data;
  const assignedDate = new Date(dateStr);
  if (isNaN(assignedDate.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const session = await prisma.restockSession.findFirst({
    where: { id: sessionId, tenantId },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.completedAt) {
    return NextResponse.json({ error: "Session already completed" }, { status: 409 });
  }

  try {
    const updated = await prisma.restockSession.update({
      where: { id: sessionId },
      data: { assignedDate },
    });

    return NextResponse.json({
      sessionId: updated.id,
      assignedDate: updated.assignedDate?.toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "A session already exists for this assigned date" },
      { status: 409 },
    );
  }
  } catch (err) {
    return handleApiError(err);
  }
}
