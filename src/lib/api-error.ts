import { NextResponse } from "next/server";
import { TenantError } from "./tenant";

/**
 * Handles known error types and returns appropriate HTTP responses.
 * Use in catch blocks of API route handlers.
 */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof TenantError) {
    return NextResponse.json({ error: "Unauthorized: tenant not configured" }, { status: 401 });
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
