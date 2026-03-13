/**
 * Next.js Instrumentation Hook
 *
 * This file is automatically loaded by Next.js at server startup.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Used here to start the HAHA background sync poller in dev mode.
 */

export async function register() {
    // Only run on the Node.js server runtime (not edge)
    if (process.env.NEXT_RUNTIME === "nodejs") {
        const { startHahaPoller } = await import("@/lib/sync/haha-poller");
        startHahaPoller();
    }
}
