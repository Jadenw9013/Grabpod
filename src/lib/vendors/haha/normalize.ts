import type { HahaOrderDetail } from "./client";
import type { NormalizedOrder } from "@/lib/ingest/upsert-orders";

/**
 * Parse a number from a value that may be string or number.
 * Throws with context if parsing fails.
 */
export function parseNumber(
  value: unknown,
  context: string,
): number {
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      throw new Error(`NaN number for ${context}`);
    }
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return 0;
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      throw new Error(
        `Cannot parse "${trimmed}" as number for ${context}`,
      );
    }
    return parsed;
  }
  if (value === null || value === undefined) return 0;
  throw new Error(`Unexpected type ${typeof value} for ${context}`);
}

/**
 * Convert a Haha order detail (with product_list) into our NormalizedOrder format.
 * Uses parseNumber for safe money/quantity conversion.
 *
 * Status mapping:
 *   101 = paid (counts toward revenue)
 *   200 = pending (in-progress, amount may be $0)
 *   other / missing = unknown (0)
 */
export function normalizeHahaOrder(detail: HahaOrderDetail): NormalizedOrder {
  const orderNo = detail.order_no;

  // Extract status safely — Haha may return it as number or string
  const rawStatus = detail.status;
  const status = typeof rawStatus === "number"
    ? rawStatus
    : typeof rawStatus === "string"
      ? parseInt(rawStatus, 10) || 0
      : 0;

  // HAHA API returns un-zoned timestamps in Beijing Time (UTC+8).
  // E.g., "2026-03-07 07:53:43". We must append "+08:00" before passing to Date()
  // to prevent Node from interpreting it as UTC or local server time.
  const createTime = new Date(detail.create_time.replace(" ", "T") + "+08:00");
  const payTime = detail.pay_time
    ? new Date(detail.pay_time.replace(" ", "T") + "+08:00")
    : null;

  return {
    orderNo,
    createdAt: !isNaN(createTime.getTime()) ? createTime : new Date(),
    machineIdentifier: detail.sticker_num,
    grossAmount: parseNumber(
      detail.receivable,
      `order ${orderNo} receivable`,
    ),
    actualPaymentAmount: parseNumber(
      detail.actual_payment_amount,
      `order ${orderNo} actual_payment_amount`,
    ),
    status,
    payTime: payTime && !isNaN(payTime.getTime()) ? payTime : null,
    lineItems: (detail.product_list ?? []).map((p) => ({
      sku: p.product_no || undefined,
      name: p.product_name,
      quantity: parseNumber(p.amount, `order ${orderNo} product ${p.product_no} amount`),
      unitPrice: parseNumber(p.price_unit, `order ${orderNo} product ${p.product_no} price_unit`),
    })),
  };
}
