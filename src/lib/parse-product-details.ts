/**
 * Parses the "Product details" text cell from XLSX into structured line items.
 *
 * Supported patterns per item (one item per line or semicolon-separated):
 *   "Product Name x2"
 *   "Product Name × 2"
 *   "Product Name x2 ¥5.00"
 *   "Product Name *2"
 *   "Product Name"          → quantity defaults to 1
 */

export interface ParsedLineItem {
    name: string;
    quantity: number;
    unitPrice?: number;
}

export interface ParseResult {
    items: ParsedLineItem[];
    skipped: { text: string; reason: string }[];
}

// Matches trailing quantity: "x2", "× 2", "*2", "x 2"
const QTY_RE = /\s*[x×*]\s*(\d+)\s*$/i;

// Matches trailing price: "¥5.00", "$5", "￥10.5"
const PRICE_RE = /\s*[¥$￥]\s*([\d.]+)\s*$/;

export function parseProductDetails(raw: string): ParseResult {
    const result: ParseResult = { items: [], skipped: [] };

    if (!raw || typeof raw !== "string") {
        return result;
    }

    // Split by newlines or semicolons
    const segments = raw.split(/[;\n\r]+/).map((s) => s.trim()).filter(Boolean);

    for (const segment of segments) {
        let text = segment;

        // Extract price (if present) before quantity
        let unitPrice: number | undefined;
        const priceMatch = text.match(PRICE_RE);
        if (priceMatch) {
            unitPrice = parseFloat(priceMatch[1]);
            text = text.slice(0, priceMatch.index).trim();
        }

        // Extract quantity
        let quantity = 1;
        const qtyMatch = text.match(QTY_RE);
        if (qtyMatch) {
            quantity = parseInt(qtyMatch[1], 10);
            text = text.slice(0, qtyMatch.index).trim();
        }

        const name = text.trim();
        if (!name) {
            result.skipped.push({ text: segment, reason: "Empty product name after parsing" });
            continue;
        }
        if (quantity <= 0) {
            result.skipped.push({ text: segment, reason: `Invalid quantity: ${quantity}` });
            continue;
        }

        result.items.push({ name, quantity, ...(unitPrice !== undefined ? { unitPrice } : {}) });
    }

    return result;
}
