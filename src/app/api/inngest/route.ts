import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { hahaSyncOrders } from "@/inngest/functions/hahaSyncOrders";
import { computeLowInventory } from "@/inngest/functions/computeLowInventory";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [hahaSyncOrders, computeLowInventory],
});
