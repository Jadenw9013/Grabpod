import "server-only";

export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantError";
  }
}

export function getTenantId(): string {
  const tid = process.env.DEV_TENANT_ID;
  if (!tid) throw new TenantError("DEV_TENANT_ID missing (dev-only tenant bootstrap)");
  return tid;
}
