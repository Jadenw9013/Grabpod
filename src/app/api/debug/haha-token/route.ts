import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/debug/haha-token
 *
 * Server-only smoke test for Haha Open Platform token endpoint.
 * Returns redacted diagnostics — never exposes appsecret or full token.
 *
 * In production, requires `x-debug-token` header matching <DEBUG_TOKEN env var>.
 */
export async function GET(req: Request) {
    // ── Production guard ──
    if (process.env.NODE_ENV === "production") {
        const debugToken = process.env.DEBUG_TOKEN;
        if (!debugToken) {
            return NextResponse.json(
                { error: "DEBUG_TOKEN env var not set. Cannot access debug endpoint in production." },
                { status: 500 },
            );
        }
        if (req.headers.get("x-debug-token") !== debugToken) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }

    // ── Read env ──
    const host = process.env.HAHA_HOST || "https://thorapi.hahabianli.com";
    const appkey = process.env.HAHA_APPKEY;
    const appsecret = process.env.HAHA_APPSECRET;

    const missing: string[] = [];
    if (!appkey) missing.push("HAHA_APPKEY");
    if (!appsecret) missing.push("HAHA_APPSECRET");
    if (missing.length) {
        return NextResponse.json(
            { error: `Missing env var(s): ${missing.join(", ")}` },
            { status: 500 },
        );
    }

    const redact = (s: string) =>
        s.length <= 6 ? "***" : `${s.slice(0, 3)}...${s.slice(-3)}`;

    // TS narrowing: we returned early if either was falsy
    const key = appkey as string;
    const secret = appsecret as string;

    const tokenUrl = `${host.replace(/\/+$/, "")}/open/auth/gettoken`;
    const payload = JSON.stringify({ appkey: key, appsecret: secret });

    const diagnostics: Record<string, unknown> = {
        host,
        url: tokenUrl,
        appkeyPreview: redact(key),
        appkeyLength: key.length,
        appsecretLength: secret.length,
        payloadBytes: Buffer.byteLength(payload, "utf8"),
    };

    try {
        const res = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
        });

        diagnostics.httpStatus = res.status;
        diagnostics.httpStatusText = res.statusText;

        const text = await res.text();
        let json: Record<string, unknown>;
        try {
            json = JSON.parse(text);
        } catch {
            diagnostics.rawBody = text.slice(0, 500);
            return NextResponse.json(diagnostics);
        }

        // Redact any token in data
        if (json.data && typeof json.data === "object") {
            const data = { ...(json.data as Record<string, unknown>) };
            if (typeof data.token === "string") data.token = redact(data.token);
            if (typeof data.access_token === "string") data.access_token = redact(data.access_token);
            json.data = data;
        }

        diagnostics.hahaResponse = json;

        if (json.code === 1401) {
            diagnostics.hint =
                "Haha returned 1401 Authentication failed. This usually means (1) appkey/appsecret mismatch, or (2) Open Platform permission not enabled for this merchant. Provide this output to vendor support.";
        }

        return NextResponse.json(diagnostics);
    } catch (err) {
        diagnostics.networkError = err instanceof Error ? err.message : String(err);
        return NextResponse.json(diagnostics, { status: 502 });
    }
}
