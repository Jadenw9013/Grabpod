import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { runHahaSync } from "@/lib/sync/run-haha-sync";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/sync/haha
 * POST /api/sync/haha?pay_start_time=2026-03-01&pay_end_time=2026-03-04
 *
 * Without params: full dual-window sync (lookback 5 days).
 * With params: bounded pay-time-window sync.
 *   - pay_end_time is exclusive (to cover Mar 1–3, pass end=Mar 4).
 *   - If only pay_start_time is provided, pay_end_time defaults to start + 1 day.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = getTenantId();
    const params = request.nextUrl.searchParams;

    const payStart = params.get("pay_start_time") ?? undefined;
    const payEnd = params.get("pay_end_time") ?? undefined;

    // Validate date formats
    if (payStart && !DATE_RE.test(payStart)) {
      return NextResponse.json(
        { error: `Invalid pay_start_time "${payStart}". Expected YYYY-MM-DD.` },
        { status: 400 },
      );
    }
    if (payEnd && !DATE_RE.test(payEnd)) {
      return NextResponse.json(
        { error: `Invalid pay_end_time "${payEnd}". Expected YYYY-MM-DD.` },
        { status: 400 },
      );
    }

    // Default pay_end_time to start + 1 day if only start is provided
    let resolvedPayEnd = payEnd;
    if (payStart && !payEnd) {
      const d = new Date(payStart + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      resolvedPayEnd = d.toISOString().slice(0, 10);
    }

    const result = await runHahaSync(tenantId, {
      payStart,
      payEnd: resolvedPayEnd,
    });

    const status = result.status === "error" ? 502 : 200;
    return NextResponse.json(
      {
        ...result,
        window: payStart
          ? { pay_start_time: payStart, pay_end_time: resolvedPayEnd, mode: "bounded" }
          : { mode: "full" },
      },
      { status },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
