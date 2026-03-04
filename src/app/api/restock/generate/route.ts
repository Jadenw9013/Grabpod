import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const GenerateSchema = z.object({
  assignedDate: z.string().optional(),
  machineIds: z.array(z.string().uuid()).optional(),
}).optional();

export async function POST(request: NextRequest) {
  try {
  const tenantId = getTenantId();

  const body = await request.json().catch(() => undefined);
  const parsed = GenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const opts = parsed.data ?? {};
  const assignedDate = opts.assignedDate ? new Date(opts.assignedDate) : null;

  if (assignedDate && isNaN(assignedDate.getTime())) {
    return NextResponse.json({ error: "Invalid assignedDate" }, { status: 400 });
  }

  // --- Idempotency: if assignedDate is provided, check for existing open session ---
  // "Open" means completedAt is null. The @@unique([tenantId, assignedDate]) constraint
  // prevents duplicates at DB level, but we check here for a helpful message.
  if (assignedDate) {
    const existing = await prisma.restockSession.findUnique({
      where: { tenantId_assignedDate: { tenantId, assignedDate } },
      select: { id: true, completedAt: true },
    });
    if (existing) {
      if (!existing.completedAt) {
        // Return the existing open session instead of creating a duplicate
        const lines = await prisma.restockSessionLine.findMany({
          where: { sessionId: existing.id },
        });
        return NextResponse.json({
          sessionId: existing.id,
          lineCount: lines.length,
          deduplicated: true,
          message: "Session already exists for this date; returning existing.",
        });
      }
      // If completed, reject — generate a new one with a different date or no date
      return NextResponse.json(
        { error: "A completed session already exists for this assigned date." },
        { status: 409 },
      );
    }
  }

  // --- Load inventory snapshots ---
  const machineFilter = opts.machineIds?.length
    ? { id: { in: opts.machineIds }, tenantId }
    : { tenantId };

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: {
      tenantId,
      machine: machineFilter,
    },
    include: {
      machine: { select: { id: true, stickerNum: true } },
      product: { select: { id: true, name: true, apexSku: true } },
    },
  });

  // --- Compute needed units and sort ---
  const needed = snapshots
    .map((s) => ({
      machineId: s.machineId,
      productId: s.productId,
      capacity: s.capacity,
      onHand: s.onHand,
      isLow: s.isLow,
      neededUnits: Math.max(0, s.capacity - s.onHand),
      // % depletion: how much of capacity is consumed (higher = more urgent)
      depletionPct: s.capacity > 0 ? (s.capacity - s.onHand) / s.capacity : 0,
      machineStickerNum: s.machine.stickerNum,
      productName: s.product.name,
    }))
    .filter((n) => n.neededUnits > 0);

  if (needed.length === 0) {
    return NextResponse.json({
      sessionId: null,
      lineCount: 0,
      message: "No machines need restocking.",
    });
  }

  // Sort: LOW items first, then by depletion % descending
  needed.sort((a, b) => {
    if (a.isLow !== b.isLow) return a.isLow ? -1 : 1;
    return b.depletionPct - a.depletionPct;
  });

  // --- Create session + lines ---
  const session = await prisma.restockSession.create({
    data: {
      tenantId,
      assignedDate,
      lines: {
        create: needed.map((n) => ({
          machineId: n.machineId,
          productId: n.productId,
          neededUnits: n.neededUnits,
          beforeStockRemain: n.onHand,
        })),
      },
    },
    include: { lines: true },
  });

  // --- Build per-machine summary ---
  const machineMap = new Map<string, { stickerNum: string | null; lineCount: number; totalNeeded: number }>();
  for (const n of needed) {
    const entry = machineMap.get(n.machineId) ?? {
      stickerNum: n.machineStickerNum,
      lineCount: 0,
      totalNeeded: 0,
    };
    entry.lineCount++;
    entry.totalNeeded += n.neededUnits;
    machineMap.set(n.machineId, entry);
  }

  return NextResponse.json({
    sessionId: session.id,
    lineCount: session.lines.length,
    assignedDate: assignedDate?.toISOString() ?? null,
    machines: [...machineMap.entries()].map(([machineId, info]) => ({
      machineId,
      stickerNum: info.stickerNum,
      lineCount: info.lineCount,
      totalNeeded: info.totalNeeded,
    })),
  });
  } catch (err) {
    return handleApiError(err);
  }
}
