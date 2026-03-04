/**
 * Column-mapping helper for XLSX imports.
 * Normalizes headers (trim + lowercase) and resolves via alias map.
 */

export type ColumnKey =
  | "orderNo"
  | "machineId"
  | "productName"
  | "productDetails"
  | "sku"
  | "quantity"
  | "unitPrice"
  | "grossAmount"
  | "actualPayment"
  | "createdAt"
  | "category"
  | "status";

const ALIASES: Record<ColumnKey, string[]> = {
  orderNo: [
    "order no", "order_no", "order number", "orderno", "order id",
  ],
  machineId: [
    "machine id", "machine_id", "machine no", "sticker", "sticker no",
    "device id", "device no", "device number", "equipment id", "equipment no",
  ],
  productName: [
    "product name", "product", "item name", "commodity name", "goods name",
    "item", "commodity",
  ],
  productDetails: [
    "product details", "commodity details", "item details", "goods details",
  ],
  sku: [
    "apex number", "product no", "product_no", "sku", "vendor product no",
    "commodity no", "item no", "goods no", "apex no",
  ],
  quantity: [
    "quantity", "qty", "count", "num", "sale quantity", "sales quantity",
  ],
  unitPrice: [
    "unit price", "price", "unit_price", "sale price", "selling price",
  ],
  grossAmount: [
    "gross amount", "gross", "total amount", "total", "amount",
    "order amount", "gross total", "amount receivable",
  ],
  actualPayment: [
    "actual payment", "actual payment amount", "payment", "payment amount",
    "real payment", "actual amount", "net amount", "amount received",
  ],
  createdAt: [
    "created at", "created_at", "order time", "date", "time",
    "create time", "order date", "created time", "created date",
    "creation time", "payment time",
  ],
  category: [
    "category", "product category", "commodity category", "item category",
  ],
  status: [
    "status", "order status",
  ],
};

const REQUIRED_KEYS: ColumnKey[] = ["orderNo"];

/**
 * Given the raw header strings from a sheet, returns a mapping from
 * ColumnKey -> actual header string found in the sheet.
 * Throws with a helpful message if any required columns are missing.
 */
export function resolveColumns(
  rawHeaders: string[],
): Record<ColumnKey, string | null> {
  const normalized = rawHeaders.map((h) => String(h).trim().toLowerCase());

  const mapping = {} as Record<ColumnKey, string | null>;

  for (const [key, aliases] of Object.entries(ALIASES) as [ColumnKey, string[]][]) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    mapping[key] = idx >= 0 ? rawHeaders[idx] : null;
  }

  const missing = REQUIRED_KEYS.filter((k) => !mapping[k]);
  if (missing.length > 0) {
    const available = rawHeaders.join(", ");
    throw new Error(
      `Missing required columns: ${missing.join(", ")}. ` +
      `Available headers: [${available}]`,
    );
  }

  return mapping;
}

/**
 * Extract a value from a row using the resolved column mapping.
 */
export function getCell(
  row: Record<string, unknown>,
  mapping: Record<ColumnKey, string | null>,
  key: ColumnKey,
): unknown {
  const header = mapping[key];
  if (!header) return undefined;
  return row[header];
}
