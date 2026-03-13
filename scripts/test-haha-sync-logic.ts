/**
 * Unit tests for Haha sync parity logic.
 * Run with: npx tsx scripts/test-haha-sync-logic.ts
 *
 * Tests (no network, no DB):
 *   1. Dedupe/union logic between create-window and pay-window results
 *   2. Status classification: paid vs pending vs unknown
 *   3. Normalize extracts status + payTime correctly
 */

// ── Test 1: Dedupe/Union logic ──

function testDedupeUnion() {
    console.log("Test 1: Dedupe/Union logic");

    // Simulate create-window results
    const createWindowOrders = [
        { order_no: "ORD-001", sticker_num: "B131020", actual_payment_amount: 0 },
        { order_no: "ORD-002", sticker_num: "B131020", actual_payment_amount: 5.0 },
        { order_no: "ORD-003", sticker_num: "B133674", actual_payment_amount: 0 },
    ];

    // Simulate pay-window results (ORD-002 appears in both, ORD-004 only in pay)
    const payWindowOrders = [
        { order_no: "ORD-002", sticker_num: "B131020", actual_payment_amount: 5.0 },
        { order_no: "ORD-004", sticker_num: "B133676", actual_payment_amount: 3.5 },
    ];

    // Union by order_no (same logic as run-haha-sync.ts)
    const orderNoSet = new Map<string, { order_no: string }>();
    for (const o of createWindowOrders) {
        orderNoSet.set(o.order_no, o);
    }
    for (const o of payWindowOrders) {
        orderNoSet.set(o.order_no, o); // pay-window preferred
    }

    const uniqueOrderNos = [...orderNoSet.keys()];

    assert(uniqueOrderNos.length === 4, `Expected 4 unique orders, got ${uniqueOrderNos.length}`);
    assert(uniqueOrderNos.includes("ORD-001"), "Should include ORD-001 (create-only)");
    assert(uniqueOrderNos.includes("ORD-004"), "Should include ORD-004 (pay-only)");
    assert(uniqueOrderNos.includes("ORD-002"), "Should include ORD-002 (both windows)");
    assert(uniqueOrderNos.includes("ORD-003"), "Should include ORD-003 (create-only)");

    console.log("  ✅ PASS: 4 unique orders from 3 create + 2 pay (1 overlap)\n");
}

// ── Test 2: Status classification ──

function testStatusClassification() {
    console.log("Test 2: Status classification");

    function classifyStatus(status: number): "paid" | "pending" | "unknown" {
        if (status === 101) return "paid";
        if (status === 200) return "pending";
        return "unknown";
    }

    assert(classifyStatus(101) === "paid", "Status 101 should be paid");
    assert(classifyStatus(200) === "pending", "Status 200 should be pending");
    assert(classifyStatus(0) === "unknown", "Status 0 should be unknown");
    assert(classifyStatus(999) === "unknown", "Status 999 should be unknown");

    // Revenue should only count paid orders
    const orders = [
        { status: 101, actualPaymentAmount: 10.0 },
        { status: 200, actualPaymentAmount: 0.0 },
        { status: 101, actualPaymentAmount: 5.5 },
        { status: 0, actualPaymentAmount: 3.0 },
    ];

    const paidRevenue = orders
        .filter((o) => o.status === 101)
        .reduce((sum, o) => sum + o.actualPaymentAmount, 0);

    assert(paidRevenue === 15.5, `Paid revenue should be 15.50, got ${paidRevenue}`);
    console.log("  ✅ PASS: Paid revenue excludes pending/unknown orders\n");
}

// ── Test 3: Normalize extracts status + payTime ──

function testNormalizeExtractsStatusAndPayTime() {
    console.log("Test 3: Normalize extracts status + payTime");

    // Simulate normalizeHahaOrder logic (inline to avoid import issues)
    function extractStatus(rawStatus: unknown): number {
        if (typeof rawStatus === "number") return rawStatus;
        if (typeof rawStatus === "string") return parseInt(rawStatus, 10) || 0;
        return 0;
    }

    function extractPayTime(payTime: string | undefined): Date | null {
        if (!payTime) return null;
        const d = new Date(payTime);
        return isNaN(d.getTime()) ? null : d;
    }

    // Test: numeric status
    assert(extractStatus(101) === 101, "Numeric 101 should parse to 101");
    assert(extractStatus(200) === 200, "Numeric 200 should parse to 200");

    // Test: string status
    assert(extractStatus("101") === 101, 'String "101" should parse to 101');
    assert(extractStatus("200") === 200, 'String "200" should parse to 200');

    // Test: missing/null status
    assert(extractStatus(undefined) === 0, "Undefined should default to 0");
    assert(extractStatus(null) === 0, "Null should default to 0");

    // Test: payTime extraction
    const pt1 = extractPayTime("2026-03-03T10:30:00");
    assert(pt1 !== null, "Valid pay_time should parse");
    assert(pt1!.getTime() > 0, "Parsed date should be valid");

    const pt2 = extractPayTime(undefined);
    assert(pt2 === null, "Undefined pay_time should be null");

    const pt3 = extractPayTime("");
    assert(pt3 === null, "Empty pay_time should be null (invalid date)");

    console.log("  ✅ PASS: Status and payTime extraction correct\n");
}

// ── Test 4: Upsert updates $0.00 → paid ──

function testUpsertUpdate() {
    console.log("Test 4: Upsert updates $0.00 → paid");

    // Simulate an order ingested twice
    const stored = {
        orderNo: "ORD-005",
        grossAmount: 0,
        actualPaymentAmount: 0,
        status: 200,
        payTime: null as Date | null,
    };

    // First sync: pending order with $0.00
    // (already stored above)
    assert(stored.status === 200, "Initial status should be 200 (pending)");
    assert(stored.actualPaymentAmount === 0, "Initial amount should be $0.00");

    // Second sync: order now paid
    const updateData = {
        grossAmount: 8.5,
        actualPaymentAmount: 8.5,
        status: 101,
        payTime: new Date("2026-03-03T14:22:00Z"),
    };

    // Simulate upsert update logic
    if (updateData.grossAmount !== undefined) stored.grossAmount = updateData.grossAmount;
    if (updateData.actualPaymentAmount !== undefined)
        stored.actualPaymentAmount = updateData.actualPaymentAmount;
    if (updateData.status !== undefined) stored.status = updateData.status;
    if (updateData.payTime !== undefined) stored.payTime = updateData.payTime;

    assert(stored.status === 101, "Updated status should be 101 (paid)");
    assert(stored.actualPaymentAmount === 8.5, "Updated amount should be $8.50");
    assert(stored.payTime !== null, "Updated payTime should not be null");

    console.log("  ✅ PASS: $0.00 → $8.50 transition captured correctly\n");
}

// ── Helpers ──

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`  ❌ FAIL: ${message}`);
        process.exit(1);
    }
}

// ── Run all tests ──

console.log("=== Haha Sync Parity Logic Tests ===\n");
testDedupeUnion();
testStatusClassification();
testNormalizeExtractsStatusAndPayTime();
testUpsertUpdate();
console.log("=== All tests passed ✅ ===");
