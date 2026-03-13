import { getToken, listOrders } from "../src/lib/vendors/haha/client";

async function main() {
    const token = await getToken();

    // Test 1: bounded mode like the poller
    console.log("\n--- TEST 1: BOUNDED (pay_start_time / pay_end_time) ---");
    const boundedOrders = await listOrders(token, {
        pay_start_time: "2026-03-05",
        pay_end_time: "2026-03-07",
    });
    console.log(`Bounded fetched: ${boundedOrders.length} orders`);
    if (boundedOrders.length > 0) {
        const dates = boundedOrders.map(o => o.pay_time).sort();
        console.log(`Earliest pay_time: ${dates[0]}`);
        console.log(`Latest pay_time: ${dates[dates.length - 1]}`);
    }

    // Test 2: unbounded mode with start_time/end_time
    console.log("\n--- TEST 2: CREATE TIME (start_time / end_time) ---");
    const createOrders = await listOrders(token, {
        start_time: "2026-03-05",
        end_time: "2026-03-07",
    });
    console.log(`Create fetched: ${createOrders.length} orders`);
    if (createOrders.length > 0) {
        const dates = createOrders.map(o => o.create_time).sort();
        console.log(`Earliest create_time: ${dates[0]}`);
        console.log(`Latest create_time: ${dates[dates.length - 1]}`);
    }
}

main().catch(console.error);
