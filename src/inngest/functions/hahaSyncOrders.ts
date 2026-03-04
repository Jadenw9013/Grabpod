import { inngest } from "../client";
import { runHahaSync } from "@/lib/sync/run-haha-sync";

/**
 * Scheduled Inngest function: syncs recent orders from the Haha Open Platform
 * every 10 minutes. Delegates entirely to the shared runHahaSync() runner.
 */
export const hahaSyncOrders = inngest.createFunction(
  { id: "haha-sync-orders" },
  { cron: "*/10 * * * *" },
  async () => {
    const tenantId = process.env.DEV_TENANT_ID;
    if (!tenantId) {
      throw new Error("DEV_TENANT_ID is not configured");
    }

    return runHahaSync(tenantId);
  },
);
