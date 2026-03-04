import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { resolveColumns, getCell, type ColumnKey } from "@/lib/xlsx-columns";
import { parseProductDetails } from "@/lib/parse-product-details";
import { upsertOrders, type NormalizedOrder } from "@/lib/ingest/upsert-orders";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/**
 * Accepted order statuses for import. Orders with other statuses (e.g. cancelled,
 * refunded) are skipped. If no status column exists, all rows are imported.
 */
const ACCEPTED_STATUSES = new Set([
  "completed", "complete", "paid", "delivered", "finished", "success",
]);

export async function POST(request: NextRequest) {
  try {
  const tenantId = getTenantId();

  // --- Parse multipart file ---
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing "file" field in form data' },
      { status: 400 },
    );
  }

  // --- Validate file extension and size ---
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.` },
      { status: 400 },
    );
  }
  const fileName = file instanceof File ? file.name : "";
  if (fileName && !/\.xlsx?$/i.test(fileName)) {
    return NextResponse.json(
      { error: "Only .xlsx and .xls files are accepted" },
      { status: 400 },
    );
  }

  // --- Read XLSX ---
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return NextResponse.json({ error: "No sheets found in file" }, { status: 400 });
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[sheetName],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "Sheet is empty" }, { status: 400 });
  }

  // --- Resolve columns ---
  const headers = Object.keys(rows[0]);
  let mapping: Record<ColumnKey, string | null>;
  try {
    mapping = resolveColumns(headers);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Column mapping failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Determine import mode: "classic" (has quantity column) vs "details" (has productDetails column)
  const hasQuantityCol = !!mapping.quantity;
  const hasDetailsCol = !!mapping.productDetails;

  if (!hasQuantityCol && !hasDetailsCol) {
    return NextResponse.json(
      {
        error:
          "Cannot determine import format. " +
          "Need either a 'quantity' column (classic) or a 'product details' column. " +
          `Available headers: [${headers.join(", ")}]`,
      },
      { status: 400 },
    );
  }

  // --- Convert XLSX rows to NormalizedOrder[] ---
  // Group rows by orderNo since one order may span multiple XLSX rows
  const orderMap = new Map<string, NormalizedOrder>();
  const parseSkipped: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed + header row

    // --- Order No ---
    const orderNoRaw = getCell(row, mapping, "orderNo");
    if (!orderNoRaw) {
      parseSkipped.push({ row: rowNum, reason: "Missing order number" });
      continue;
    }
    const orderNo = String(orderNoRaw).trim();
    if (!orderNo) {
      parseSkipped.push({ row: rowNum, reason: "Empty order number" });
      continue;
    }

    // --- Status filter: skip non-completed orders ---
    // Accept rows where status is missing (no status column) or status indicates completion.
    const statusRaw = String(getCell(row, mapping, "status") ?? "").trim().toLowerCase();
    if (statusRaw && !ACCEPTED_STATUSES.has(statusRaw)) {
      parseSkipped.push({ row: rowNum, reason: `Skipped status: ${statusRaw}` });
      continue;
    }

    // --- Created At (uses "Creation time" column from Haha XLSX) ---
    const createdAtRaw = getCell(row, mapping, "createdAt");
    let createdAt: Date;
    if (createdAtRaw instanceof Date) {
      createdAt = createdAtRaw;
    } else if (typeof createdAtRaw === "number") {
      createdAt = excelDateToJS(createdAtRaw);
    } else if (createdAtRaw) {
      createdAt = new Date(String(createdAtRaw));
    } else {
      // No timestamp column found — use current time as fallback
      createdAt = new Date();
    }
    if (isNaN(createdAt.getTime())) {
      parseSkipped.push({ row: rowNum, reason: `Missing or invalid creation time: ${createdAtRaw}` });
      continue;
    }

    // --- Machine identifier (mapped from "Device number" in Haha XLSX) ---
    const machineIdentifier = String(getCell(row, mapping, "machineId") ?? "").trim();
    if (!machineIdentifier) {
      parseSkipped.push({ row: rowNum, reason: "Missing device number" });
      continue;
    }

    // --- Amounts ---
    // grossAmount ← "Amount Receivable" (expected revenue before adjustments)
    // actualPaymentAmount ← "Amount Received" (actual collected revenue, used for analytics)
    const grossAmount = Number(getCell(row, mapping, "grossAmount")) || 0;
    const actualPaymentAmount = Number(getCell(row, mapping, "actualPayment")) || 0;

    // --- Build line items depending on mode ---
    const lineItems: NormalizedOrder["lineItems"] = [];

    if (hasQuantityCol && !hasDetailsCol) {
      const qtyRaw = getCell(row, mapping, "quantity");
      const quantity = Number(qtyRaw);
      if (isNaN(quantity) || quantity <= 0) {
        parseSkipped.push({ row: rowNum, reason: `Invalid quantity: ${qtyRaw}` });
        continue;
      }
      const name = String(getCell(row, mapping, "productName") ?? "").trim();
      const sku = String(getCell(row, mapping, "sku") ?? "").trim() || undefined;
      const unitPrice = Number(getCell(row, mapping, "unitPrice")) || 0;
      const category = String(getCell(row, mapping, "category") ?? "").trim() || undefined;
      lineItems.push({ name, sku, quantity, unitPrice, category });
    } else {
      const detailsRaw = String(getCell(row, mapping, "productDetails") ?? "").trim();
      if (!detailsRaw) {
        parseSkipped.push({ row: rowNum, reason: "Missing product details" });
        continue;
      }
      const parsed = parseProductDetails(detailsRaw);
      for (const skip of parsed.skipped) {
        parseSkipped.push({ row: rowNum, reason: `Parse skip: ${skip.reason} (${skip.text})` });
      }
      if (parsed.items.length === 0) {
        parseSkipped.push({ row: rowNum, reason: "Unparseable product details" });
        continue;
      }
      for (const item of parsed.items) {
        lineItems.push({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? 0,
        });
      }
    }

    // Merge into existing order or create new
    const existing = orderMap.get(orderNo);
    if (existing) {
      existing.lineItems.push(...lineItems);
    } else {
      orderMap.set(orderNo, {
        orderNo,
        createdAt,
        machineIdentifier,
        grossAmount,
        actualPaymentAmount,
        lineItems,
      });
    }
  }

  // --- Upsert via unified function ---
  const normalizedOrders = [...orderMap.values()];
  const stats = await upsertOrders(tenantId, normalizedOrders);

  return NextResponse.json({
    importedOrders: stats.importedOrders,
    importedLines: stats.importedLines,
    createdProducts: stats.createdProducts,
    createdMachines: stats.createdMachines,
    skippedRows: [
      ...parseSkipped.map((s) => ({ row: s.row, reason: s.reason })),
      ...stats.skippedRows.map((s) => ({ row: s.index, reason: s.reason })),
    ],
  });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Convert Excel serial date number to JS Date */
function excelDateToJS(serial: number): Date {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(epoch.getTime() + serial * 86400000);
}
