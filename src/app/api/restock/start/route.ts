import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const StartSchema = z.object({
  sessionId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
  const tenantId = getTenantId();

  const body = await request.json().catch(() => null);
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { sessionId } = parsed.data;

  const session = await prisma.restockSession.findFirst({
    where: { id: sessionId, tenantId },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.completedAt) {
    return NextResponse.json({ error: "Session already completed" }, { status: 409 });
  }
  if (session.startedAt) {
    return NextResponse.json({ error: "Session already started" }, { status: 409 });
  }

  const updated = await prisma.restockSession.update({
    where: { id: sessionId },
    data: { startedAt: new Date() },
  });

  return NextResponse.json({
    sessionId: updated.id,
    startedAt: updated.startedAt?.toISOString(),
  });
  } catch (err) {
    return handleApiError(err);
  }
}
