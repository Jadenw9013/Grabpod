import { prisma } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/**
 * Exact required/optional headers — no aliases, no guessing.
 */
const REQUIRED_HEADERS = ["Apex Number", "Product Name"] as const;

export async function POST(request: NextRequest) {
  try {
  const tenantId = getTenantId();

  // --- Parse multipart ---
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

  // --- Strict header validation ---
  const headers = Object.keys(rows[0]);
  const missingRequired = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingRequired.length > 0) {
    return NextResponse.json(
      {
        error: `Missing required headers: ${missingRequired.join(", ")}. ` +
          `Found: [${headers.join(", ")}]`,
      },
      { status: 400 },
    );
  }

  const hasCost = headers.includes("Cost");
  const hasCategory = headers.includes("Category");
  const hasVendorProductNo = headers.includes("Vendor Product No");

  // --- Pre-load existing products by apexSku for this tenant ---
  const existing = await prisma.product.findMany({
    where: { tenantId, apexSku: { not: null } },
    select: { id: true, apexSku: true },
  });
  const productByApex = new Map(
    existing.map((p) => [p.apexSku!, p.id]),
  );

  // --- Process rows ---
  const stats = {
    createdProducts: 0,
    updatedProducts: 0,
    skippedRows: [] as { rowNumber: number; reason: string }[],
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // 1-indexed + header

    // --- Apex SKU (required, no transformation) ---
    const apexSkuRaw = row["Apex Number"];
    if (apexSkuRaw === undefined || apexSkuRaw === null || apexSkuRaw === "") {
      stats.skippedRows.push({ rowNumber, reason: "Missing or blank Apex Number" });
      continue;
    }
    const apexSku = String(apexSkuRaw).trim();
    if (!apexSku) {
      stats.skippedRows.push({ rowNumber, reason: "Blank Apex Number after trim" });
      continue;
    }

    // --- Product Name (required) ---
    const nameRaw = row["Product Name"];
    if (nameRaw === undefined || nameRaw === null || nameRaw === "") {
      stats.skippedRows.push({ rowNumber, reason: "Missing or blank Product Name" });
      continue;
    }
    const name = String(nameRaw).trim();
    if (!name) {
      stats.skippedRows.push({ rowNumber, reason: "Blank Product Name after trim" });
      continue;
    }

    // --- Optional fields ---
    const cost = hasCost ? parseOptionalFloat(row["Cost"]) : null;
    const category = hasCategory ? parseOptionalString(row["Category"]) : null;
    const vendorProductNo = hasVendorProductNo
      ? parseOptionalString(row["Vendor Product No"])
      : null;

    // --- Upsert by (tenantId, apexSku) ---
    try {
      const existingId = productByApex.get(apexSku);

      if (existingId) {
        await prisma.product.update({
          where: { id: existingId },
          data: {
            name,
            ...(cost !== null ? { cost } : {}),
            ...(category !== null ? { category } : {}),
            ...(vendorProductNo !== null ? { vendorProductNo } : {}),
          },
        });
        stats.updatedProducts++;
      } else {
        const created = await prisma.product.create({
          data: {
            tenantId,
            apexSku,
            name,
            cost,
            category,
            vendorProductNo,
          },
        });
        productByApex.set(apexSku, created.id);
        stats.createdProducts++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      stats.skippedRows.push({ rowNumber, reason: message });
    }
  }

  return NextResponse.json(stats);
  } catch (err) {
    return handleApiError(err);
  }
}

function parseOptionalFloat(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function parseOptionalString(val: unknown): string | null {
  if (val === undefined || val === null || val === "") return null;
  const s = String(val).trim();
  return s || null;
}
