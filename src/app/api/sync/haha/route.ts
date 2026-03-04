import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { runHahaSync } from "@/lib/sync/run-haha-sync";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
  const tenantId = getTenantId();
  const result = await runHahaSync(tenantId);
  const status = result.status === "error" ? 502 : 200;
  return NextResponse.json(result, { status });
  } catch (err) {
    return handleApiError(err);
  }
}
